import { randomUUID } from 'node:crypto';
import { now, query } from './db.js';
import {
  partialResult,
  runToCompletion,
  type ResearchCheckpoint,
  type ResearchEvent,
} from './research-pipeline.js';
import type { ResearchResult } from './research.js';

export type ResearchJobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface ResearchJobRow {
  id: string;
  workspace_id: string | null;
  user_id: string;
  map_id: string | null;
  domain: string;
  focus: string | null;
  status: ResearchJobStatus;
  checkpoint: ResearchCheckpoint;
  events: ResearchEvent[];
  partial: ResearchResult | null;
  result: ResearchResult | null;
  error: string | null;
  lease_until: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export async function createJob(input: {
  workspaceId?: string | null;
  userId: string;
  mapId?: string | null;
  domain: string;
  focus?: string | null;
  checkpoint: ResearchCheckpoint;
}): Promise<ResearchJobRow> {
  const id = randomUUID();
  const timestamp = now();
  await query(
    `INSERT INTO research_jobs
       (id, workspace_id, user_id, map_id, domain, focus, status, checkpoint,
        events, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'queued',$7,'[]',$8,$8)`,
    [
      id,
      input.workspaceId ?? null,
      input.userId,
      input.mapId ?? null,
      input.domain,
      input.focus ?? null,
      JSON.stringify(input.checkpoint),
      timestamp,
    ]
  );
  const job = await getJob(id);
  if (!job) throw new Error('research job was not created');
  return job;
}

export async function getJob(id: string): Promise<ResearchJobRow | null> {
  const rows = await query<ResearchJobRow>(
    'SELECT * FROM research_jobs WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function claimJob(
  id: string,
  leaseMs: number
): Promise<ResearchJobRow | null> {
  const timestamp = now();
  const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
  const rows = await query<ResearchJobRow>(
    `UPDATE research_jobs
        SET status = 'running', lease_until = $2, attempts = attempts + 1,
            updated_at = $3
      WHERE id = $1
        AND status IN ('queued','running')
        AND (lease_until IS NULL OR lease_until < $3)
      RETURNING *`,
    [id, leaseUntil, timestamp]
  );
  return rows[0] ?? null;
}

async function persistProgress(
  id: string,
  checkpoint: ResearchCheckpoint,
  partial: ResearchResult,
  events: ResearchEvent[],
  leaseMs: number
): Promise<void> {
  const timestamp = now();
  const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
  await query(
    `UPDATE research_jobs
        SET checkpoint = $2, partial = $3, events = $4, lease_until = $5,
            updated_at = $6
      WHERE id = $1 AND status = 'running'`,
    [
      id,
      JSON.stringify(checkpoint),
      JSON.stringify(partial),
      JSON.stringify(events.slice(-200)),
      leaseUntil,
      timestamp,
    ]
  );
}

export async function runJobTick(
  id: string,
  budgetMs: number
): Promise<ResearchJobRow | null> {
  const claimed = await claimJob(id, budgetMs + 15_000);
  if (!claimed) return getJob(id);
  const events = [...claimed.events].slice(-200);
  try {
    const checkpoint = await runToCompletion(claimed.checkpoint, {
      deadlineMs: Date.now() + budgetMs,
      emit: (event) => {
        events.push(event);
        if (events.length > 200) events.splice(0, events.length - 200);
      },
      persist: async (nextCheckpoint, partial) => {
        await persistProgress(
          id,
          nextCheckpoint,
          partial,
          events,
          budgetMs + 15_000
        );
      },
    });
    if (checkpoint.step === 'done') {
      const result = partialResult(checkpoint);
      await query(
        `UPDATE research_jobs
            SET status = 'done', checkpoint = $2, partial = $3, result = $3,
                events = $4, lease_until = NULL, updated_at = $5, error = NULL
          WHERE id = $1 AND status = 'running'`,
        [
          id,
          JSON.stringify(checkpoint),
          JSON.stringify(result),
          JSON.stringify(events.slice(-200)),
          now(),
        ]
      );
    } else {
      await query(
        `UPDATE research_jobs
            SET checkpoint = $2, partial = $3, events = $4,
                lease_until = NULL, updated_at = $5
          WHERE id = $1 AND status = 'running'`,
        [
          id,
          JSON.stringify(checkpoint),
          JSON.stringify(partialResult(checkpoint)),
          JSON.stringify(events.slice(-200)),
          now(),
        ]
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = await getJob(id);
    const attempts = current?.attempts ?? claimed.attempts;
    if (attempts >= 3) {
      await query(
        `UPDATE research_jobs
          SET status = 'failed', error = $2, lease_until = NULL,
                events = $3, updated_at = $4
          WHERE id = $1 AND status = 'running'`,
        [id, message, JSON.stringify(events.slice(-200)), now()]
      );
    } else {
      await query(
        `UPDATE research_jobs
            SET status = 'queued', error = NULL, lease_until = NULL,
                events = $2, updated_at = $3
          WHERE id = $1 AND status = 'running'`,
        [id, JSON.stringify(events.slice(-200)), now()]
      );
    }
  }
  return getJob(id);
}

export async function cancelJob(id: string): Promise<ResearchJobRow | null> {
  const rows = await query<ResearchJobRow>(
    `UPDATE research_jobs
        SET status = 'cancelled', lease_until = NULL, updated_at = $2
      WHERE id = $1 AND status IN ('queued','running')
      RETURNING *`,
    [id, now()]
  );
  return rows[0] ?? (await getJob(id));
}

export async function claimNextQueuedJob(): Promise<string | null> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM research_jobs
      WHERE status = 'queued'
         OR (status = 'running' AND (lease_until IS NULL OR lease_until < $1))
      ORDER BY created_at
      LIMIT 1`,
    [now()]
  );
  return rows[0]?.id ?? null;
}

export function startJobLoop(): () => void {
  const active = new Set<string>();
  const tick = async () => {
    while (active.size < 2) {
      const id = await claimNextQueuedJob();
      if (!id || active.has(id)) break;
      active.add(id);
      void runJobTick(id, 8 * 60_000)
        .catch(() => undefined)
        .finally(() => active.delete(id));
    }
  };
  const timer = setInterval(() => void tick(), 2_000);
  void tick();
  return () => clearInterval(timer);
}
