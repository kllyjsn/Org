import { randomUUID } from 'node:crypto';
import { now, query } from './db.js';
import { canonicalPersonName } from './research.js';
import { linkedinSlug } from './csv.js';
import { rosterProviders } from './roster-providers.js';
import { rosterCounts, upsertRosterPeople } from './roster.js';

export interface RosterSyncJobRow {
  id: string; workspace_id: string; map_id: string; user_id: string; domain: string;
  status: 'queued' | 'running' | 'done' | 'failed'; events: Record<string, unknown>[];
  summary: Record<string, unknown> | null; error: string | null; created_at: string; updated_at: string;
}
export async function createRosterSyncJob(input: { workspaceId: string; mapId: string; userId: string; domain: string }) {
  const id = randomUUID(), timestamp = now();
  await query(
    `INSERT INTO roster_sync_jobs (id,workspace_id,map_id,user_id,domain,status,events,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,'queued','[]',$6,$6)`,
    [id, input.workspaceId, input.mapId, input.userId, input.domain.trim().toLowerCase(), timestamp]
  );
  const job = await getRosterSyncJob(id);
  if (!job) throw new Error('roster sync job was not created');
  return job;
}
export async function getRosterSyncJob(id: string) {
  return (await query<RosterSyncJobRow>('SELECT * FROM roster_sync_jobs WHERE id = $1', [id]))[0] ?? null;
}
async function save(id: string, fields: { status?: string; events?: Record<string, unknown>[]; summary?: unknown; error?: string | null }) {
  await query(
    `UPDATE roster_sync_jobs SET status = COALESCE($2,status), events = COALESCE($3,events),
      summary = COALESCE($4,summary), error = $5, updated_at = $6 WHERE id = $1`,
    [id, fields.status ?? null, fields.events ? JSON.stringify(fields.events) : null,
      fields.summary === undefined ? null : JSON.stringify(fields.summary), fields.error ?? null, now()]
  );
}
export async function runRosterSync(jobId: string) {
  const job = await getRosterSyncJob(jobId);
  if (!job || (job.status !== 'queued' && job.status !== 'running')) return job;
  await save(jobId, { status: 'running', events: [] });
  const events: Record<string, unknown>[] = [];
  const completed: Record<string, unknown>[] = [];
  try {
    for (const provider of rosterProviders()) {
      if (!provider.available()) {
        events.push({ provider: provider.id, status: 'skipped', message: 'not configured' });
        await save(jobId, { events });
        continue;
      }
      let fetched = 0;
      events.push({ provider: provider.id, status: 'fetching', fetched: 0 });
      await save(jobId, { events });
      try {
        const candidates = await provider.fetch(job.domain, {
          max: 2000, deadlineMs: Date.now() + 4 * 60_000,
          onProgress: (n) => { fetched = n; events[events.length - 1] = { provider: provider.id, status: 'fetching', fetched: n }; },
        });
        fetched = candidates.length;
        const result = await upsertRosterPeople(job.workspace_id, job.domain, candidates.map((candidate) => ({
          name: candidate.name, title: candidate.title, location: candidate.location,
          linkedin: candidate.linkedin, email: candidate.email,
          managerKey: candidate.managerLinkedin ? linkedinSlug(candidate.managerLinkedin) : candidate.managerName ? canonicalPersonName(candidate.managerName) : null,
          source: provider.id, sourceUrl: candidate.sourceUrl, confidence: 'medium', raw: candidate.raw,
          jobLevel: candidate.jobLevel, functionHint: candidate.functionHint,
        })));
        const done = { provider: provider.id, status: 'done', fetched, upserted: result.upserted };
        events[events.length - 1] = done; completed.push(done);
        await save(jobId, { events });
      } catch (error) {
        const failed = { provider: provider.id, status: 'failed', message: error instanceof Error ? error.message : String(error) };
        events[events.length - 1] = failed;
        await save(jobId, { events });
      }
    }
    const summary = completed.length === 0 && events.every((event) => event.status === 'skipped')
      ? { message: 'no providers configured' } : { providers: completed, total: await rosterCounts(job.workspace_id, job.domain) };
    await save(jobId, { status: 'done', events, summary });
  } catch (error) {
    await save(jobId, { status: 'failed', events, error: error instanceof Error ? error.message : String(error) });
  }
  return getRosterSyncJob(jobId);
}
