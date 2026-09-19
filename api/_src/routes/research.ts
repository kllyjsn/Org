import { streamSSE } from 'hono/streaming';
import { bad, param, type App } from '../http.js';
import { query } from '../db.js';
import {
  requireAuth,
  workspaceAccessFor,
  workspaceRoleFor,
} from '../authz.js';
import { DOMAIN_RE } from '../research.js';
import { initialCheckpoint } from '../research-pipeline.js';
import {
  cancelJob,
  createJob,
  getJob,
  runJobTick,
  type ResearchJobRow,
} from '../research-jobs.js';
import { perUser } from '../rate-limit.js';
import type { SellerProfile, UserRow } from '../types.js';

async function researchJobForUser(
  user: UserRow,
  id: string
): Promise<ResearchJobRow | null> {
  const job = await getJob(id);
  if (!job) return null;
  if (job.user_id === user.id) return job;
  if (!job.workspace_id) return null;
  const access = await workspaceAccessFor(user, job.workspace_id);
  if (!access) return null;
  if (access.scoped && job.map_id) {
    const rows = await query(
      `SELECT 1 FROM member_map_access
       WHERE workspace_id = $1 AND user_id = $2 AND map_id = $3`,
      [job.workspace_id, user.id, job.map_id]
    );
    if (!rows.length) return null;
  }
  return job;
}

function researchJobView(job: ResearchJobRow) {
  return {
    id: job.id,
    status: job.status,
    step: job.checkpoint.step,
    domain: job.domain,
    focus: job.focus,
    events: job.events,
    partial: job.partial,
    result: job.result,
    error: job.error,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

export function registerResearchRoutes(app: App): void {
  app.post('/api/research', requireAuth, perUser('research', 10, 60 * 60_000), async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    const domain =
      typeof body?.domain === 'string'
        ? body.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*/, '')
        : '';
    const focus =
      typeof body?.focus === 'string' ? body.focus.trim().slice(0, 300) : '';
    if (!DOMAIN_RE.test(domain)) return bad(c, 'enter a valid domain like acme.com');
    try {
      const workspaceId =
        typeof body?.workspaceId === 'string' ? body.workspaceId : '';
      if (workspaceId && !(await workspaceRoleFor(user, workspaceId))) {
        return bad(c, 'not a member', 403);
      }
      const scopeColumn = workspaceId ? 'workspace_id' : 'user_id';
      const scopeValue = workspaceId || user.id;
      const busyRows = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM research_jobs
         WHERE ${scopeColumn} = $1 AND status IN ('queued','running')`,
        [scopeValue]
      );
      if (Number(busyRows[0]?.count ?? 0) >= 2) {
        return c.json(
          {
            error: 'research already running for this workspace — wait for it to finish',
            code: 'research_busy',
          },
          429
        );
      }
      let sellerProfile: SellerProfile | null = null;
      if (workspaceId) {
        const workspaces = await query<{ seller_profile: SellerProfile | null }>(
          'SELECT seller_profile FROM workspaces WHERE id = $1',
          [workspaceId]
        );
        sellerProfile = workspaces[0]?.seller_profile ?? null;
      }
      const knownUrls = Array.isArray(body?.knownSources)
        ? body.knownSources
            .filter(
              (s: unknown): s is string =>
                typeof s === 'string' && /^https?:\/\//i.test(s)
            )
            .slice(0, 96)
        : [];
      const job = await createJob({
        workspaceId: workspaceId || null,
        userId: user.id,
        domain,
        focus: focus || null,
        checkpoint: initialCheckpoint({
          domain,
          focus: focus || null,
          sellerProfile,
          knownSources: knownUrls,
        }),
      });
      if (!process.env.VERCEL) {
        void runJobTick(job.id, 45_000).catch((error) => {
          console.error('research job tick failed', error);
        });
      }
      return c.json({ jobId: job.id }, 202);
    } catch (err) {
      console.error('research failed', err);
      return bad(c, 'research failed — try again or check LLM provider keys', 502);
    }
  });

  app.get('/api/research/jobs/:id/stream', requireAuth, async (c) => {
    const user = c.get('user');
    const id = param(c, 'id');
    const authorized = await researchJobForUser(user, id);
    if (!authorized) return bad(c, 'research job not found', 404);
    c.header('Cache-Control', 'no-cache');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const endAt = Date.now() + 50_000;
      const after = Number(c.req.query('after'));
      let sentEvents = Number.isFinite(after) ? Math.max(0, after) : 0;
      let sentPeople = -1;
      let tickStarted = false;
      while (Date.now() < endAt) {
        const job = await getJob(id);
        if (!job) {
          await stream.writeSSE({
            event: 'failed',
            data: JSON.stringify({ error: 'research job not found' }),
          });
          return;
        }
        const claimable =
          (job.status === 'queued' || job.status === 'running') &&
          (!job.lease_until || Date.parse(job.lease_until) < Date.now());
        if (claimable && !tickStarted) {
          tickStarted = true;
          const budget = Math.max(1_000, endAt - Date.now() - 3_000);
          void runJobTick(id, budget)
            .catch((error) => console.error('research stream tick failed', error))
            .finally(() => {
              tickStarted = false;
            });
        }
        for (const event of job.events.slice(sentEvents)) {
          await stream.writeSSE({
            event: 'progress',
            data: JSON.stringify(event),
          });
        }
        sentEvents = job.events.length;
        const peopleCount = job.partial?.people.length ?? 0;
        if (job.partial && peopleCount !== sentPeople) {
          sentPeople = peopleCount;
          await stream.writeSSE({
            event: 'partial',
            data: JSON.stringify(job.partial),
          });
        }
        if (job.status === 'done' && job.result) {
          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify(job.result),
          });
          return;
        }
        if (job.status === 'failed') {
          await stream.writeSSE({
            event: 'failed',
            data: JSON.stringify({ error: job.error ?? 'research failed' }),
          });
          return;
        }
        if (job.status === 'cancelled') {
          await stream.writeSSE({ event: 'cancelled', data: '{}' });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      await stream.writeSSE({ event: 'continue', data: '{}' });
    });
  });

  app.get('/api/research/jobs/:id', requireAuth, async (c) => {
    const user = c.get('user');
    const job = await researchJobForUser(user, param(c, 'id'));
    if (!job) return bad(c, 'research job not found', 404);
    return c.json({ job: researchJobView(job) });
  });

  app.post('/api/research/jobs/:id/cancel', requireAuth, async (c) => {
    const user = c.get('user');
    const job = await researchJobForUser(user, param(c, 'id'));
    if (!job) return bad(c, 'research job not found', 404);
    const cancelled = await cancelJob(job.id);
    return c.json({ job: cancelled ? researchJobView(cancelled) : researchJobView(job) });
  });
}
