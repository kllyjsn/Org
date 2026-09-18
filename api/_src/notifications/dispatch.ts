import { randomUUID } from 'node:crypto';
import { now, query } from '../db.js';
import { decryptSecret, encryptionKeyConfigured } from '../crypto.js';
import type { MapChangeAlert } from '../changes.js';
import type {
  AccountStrategyPlan,
  MapRow,
  MapState,
  Person,
} from '../types.js';
import {
  composeChangeAlert,
  composePreMeetingBrief,
  composeWeeklyCoverage,
  type Notice,
} from './compose.js';
import { toEmail, toSlackPayload } from './format.js';
import {
  briefDedupeKey,
  changeAlertDedupeKey,
  isoWeek,
  weeklyDedupeKey,
} from './schedule.js';
import { committeeCoverage } from './coverage.js';

function appUrl(): string {
  return process.env.PUBLIC_APP_URL || 'http://localhost:5173';
}

export type OutboxKind =
  | 'change_alert'
  | 'pre_meeting_brief'
  | 'weekly_coverage';

interface ChannelRow {
  id: string;
  workspace_id: string;
  kind: 'slack_webhook' | 'email';
  target: string;
  enabled: boolean;
}

interface OutboxRow {
  id: string;
  workspace_id: string;
  map_id: string | null;
  kind: OutboxKind;
  dedupe_key: string;
  payload: Notice;
  scheduled_for: string;
  sent_at: string | null;
  attempts: number;
  last_error: string | null;
}

export async function enqueue(
  kind: OutboxKind,
  workspaceId: string,
  mapId: string | null,
  payload: Notice,
  scheduledFor: string,
  dedupeKey: string
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `INSERT INTO notification_outbox
      (id, workspace_id, map_id, kind, dedupe_key, payload, scheduled_for, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [
      randomUUID(),
      workspaceId,
      mapId,
      kind,
      dedupeKey,
      JSON.stringify(payload),
      scheduledFor,
      now(),
    ]
  );
  return rows.length > 0;
}

async function postSlack(channel: ChannelRow, notice: Notice): Promise<void> {
  const url = decryptSecret(channel.target);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toSlackPayload(notice)),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`slack webhook failed (${res.status})`);
  }
}

async function memberEmails(
  workspaceId: string,
  kind: OutboxKind
): Promise<string[]> {
  const rows = await query<{ email: string }>(
    `SELECT u.email FROM workspace_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = $1
       AND m.notify_email = TRUE
       AND ($2::text <> 'pre_meeting_brief' OR m.notify_briefs = TRUE)`,
    [workspaceId, kind]
  );
  return rows.map((row) => row.email);
}

async function sendChannel(
  channel: ChannelRow,
  notice: Notice,
  kind: OutboxKind
): Promise<void> {
  if (channel.kind === 'slack_webhook') {
    await postSlack(channel, notice);
    return;
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('email not configured');
  const to = await memberEmails(channel.workspace_id, kind);
  if (to.length === 0) return;
  const email = toEmail(notice);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'TopDown <notifications@topdown.sh>',
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`resend failed (${res.status})`);
  }
}

export async function sendDue(limit = 20): Promise<{
  sent: number;
  failed: number;
}> {
  const due = await query<OutboxRow>(
    `SELECT * FROM notification_outbox
     WHERE sent_at IS NULL AND scheduled_for <= $1 AND attempts < 3
     ORDER BY scheduled_for ASC
     LIMIT $2`,
    [now(), limit]
  );
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    const channels = await query<ChannelRow>(
      `SELECT * FROM notification_channels
       WHERE workspace_id = $1 AND enabled = TRUE`,
      [row.workspace_id]
    );
    const notice = row.payload;
    let anySent = false;
    let lastError: string | null = null;
    for (const channel of channels) {
      try {
        await sendChannel(channel, notice, row.kind);
        anySent = true;
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'send failed';
      }
    }
    if (channels.length === 0) {
      lastError = 'no enabled channels';
    }
    if (anySent) {
      await query(
        `UPDATE notification_outbox SET sent_at = $1, last_error = $2
         WHERE id = $3`,
        [now(), lastError, row.id]
      );
      sent += 1;
    } else {
      // Never spin on a permanently unconfigurable channel.
      const attempts =
        lastError === 'email not configured' || lastError === 'no enabled channels'
          ? 3
          : row.attempts + 1;
      await query(
        `UPDATE notification_outbox SET attempts = $1, last_error = $2
         WHERE id = $3`,
        [attempts, lastError, row.id]
      );
      failed += 1;
    }
  }
  return { sent, failed };
}

/** Send a single notice through one channel (the "test" route). */
export async function sendThroughChannel(
  channelId: string,
  notice: Notice
): Promise<void> {
  const rows = await query<ChannelRow>(
    'SELECT * FROM notification_channels WHERE id = $1',
    [channelId]
  );
  const channel = rows[0];
  if (!channel) throw new Error('channel not found');
  await sendChannel(channel, notice, 'change_alert');
}

// ---------- producers ----------

/** Change alerts: called from refreshNextDueMap after a refresh merge. */
export async function enqueueChangeAlert(
  map: MapRow,
  previousState: MapState,
  nextState: MapState,
  alerts: MapChangeAlert[]
): Promise<boolean> {
  if (alerts.length === 0) return false;
  const peopleById = new Map(
    (nextState.people ?? []).filter(Boolean).map((p) => [p.id, p])
  );
  // person_removed alerts reference the baseline id → include it too.
  for (const person of previousState.people ?? []) {
    if (person && !peopleById.has(person.id)) peopleById.set(person.id, person);
  }
  const notice = composeChangeAlert(
    { id: map.id, name: map.name },
    alerts,
    nextState.meta?.strategy,
    appUrl(),
    peopleById
  );
  return enqueue(
    'change_alert',
    map.workspace_id,
    map.id,
    notice,
    now(),
    changeAlertDedupeKey(map.id, alerts)
  );
}

async function workspaceHasAudience(workspaceId: string): Promise<boolean> {
  const rows = await query<{ has: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM notification_channels
       WHERE workspace_id = $1 AND enabled = TRUE AND kind = 'slack_webhook'
     ) OR EXISTS(
       SELECT 1 FROM workspace_members
       WHERE workspace_id = $1 AND notify_email = TRUE AND notify_briefs = TRUE
     ) AS has`,
    [workspaceId]
  );
  return rows[0]?.has === true;
}

/** Briefs for meetings starting within BRIEF_LOOKAHEAD_MINUTES (default 45). */
export async function enqueuePreMeetingBriefs(
  nowMs = Date.now()
): Promise<{ enqueued: number }> {
  const windowStart = new Date(nowMs).toISOString();
  const windowMinutes = Number(process.env.BRIEF_LOOKAHEAD_MINUTES) || 45;
  const windowEnd = new Date(nowMs + windowMinutes * 60_000).toISOString();
  const meetings = await query<{
    external_id: string;
    occurred_at: string;
    subject: string | null;
    map_id: string;
    workspace_id: string;
    person_id: string;
  }>(
    `SELECT DISTINCT external_id, occurred_at, subject, map_id, workspace_id, person_id
     FROM touchpoints
     WHERE kind = 'meeting' AND occurred_at >= $1 AND occurred_at <= $2`,
    [windowStart, windowEnd]
  );
  const groups = new Map<
    string,
    {
      externalId: string;
      mapId: string;
      workspaceId: string;
      subject: string | null;
      occurredAt: string;
      personIds: Set<string>;
    }
  >();
  for (const row of meetings) {
    const key = `${row.map_id}:${row.external_id}`;
    const group =
      groups.get(key) ??
      {
        externalId: row.external_id,
        mapId: row.map_id,
        workspaceId: row.workspace_id,
        subject: row.subject,
        occurredAt: row.occurred_at,
        personIds: new Set<string>(),
      };
    group.personIds.add(row.person_id);
    groups.set(key, group);
  }

  let enqueued = 0;
  for (const group of groups.values()) {
    if (!(await workspaceHasAudience(group.workspaceId))) continue;
    const maps = await query<MapRow>('SELECT * FROM maps WHERE id = $1', [
      group.mapId,
    ]);
    const map = maps[0];
    if (!map) continue;
    const state = map.state as MapState;
    const attendees = (state.people ?? []).filter(
      (p): p is Person => Boolean(p) && group.personIds.has(p.id)
    );
    if (attendees.length === 0) continue;
    const coverage = committeeCoverage(state, nowMs);
    const notice = composePreMeetingBrief(
      { id: map.id, name: map.name },
      {
        subject: group.subject,
        startsAt: group.occurredAt,
        attendees,
      },
      state.meta?.strategy as AccountStrategyPlan | undefined,
      coverage,
      appUrl(),
      nowMs
    );
    if (
      await enqueue(
        'pre_meeting_brief',
        group.workspaceId,
        group.mapId,
        notice,
        now(),
        briefDedupeKey(group.externalId)
      )
    ) {
      enqueued += 1;
    }
  }
  return { enqueued };
}

/** Weekly roll-up on Mondays (UTC); dedupe key makes reruns idempotent. */
export async function enqueueWeeklyCoverage(
  nowMs = Date.now()
): Promise<{ enqueued: number }> {
  const date = new Date(nowMs);
  if (date.getUTCDay() !== 1) return { enqueued: 0 };
  const workspaces = await query<{ id: string; name: string }>(
    `SELECT DISTINCT w.id, w.name FROM workspaces w
     JOIN notification_channels c
       ON c.workspace_id = w.id AND c.enabled = TRUE
     WHERE EXISTS (
       SELECT 1 FROM workspace_members m
       WHERE m.workspace_id = w.id AND m.notify_email = TRUE
     ) OR c.kind = 'slack_webhook'`
  );
  let enqueued = 0;
  const week = isoWeek(date);
  for (const workspace of workspaces) {
    const maps = await query<MapRow>(
      'SELECT * FROM maps WHERE workspace_id = $1',
      [workspace.id]
    );
    if (maps.length === 0) continue;
    const notice = composeWeeklyCoverage(
      workspace.name,
      maps.map((map) => ({
        map: { id: map.id, name: map.name },
        coverage: committeeCoverage(map.state as MapState, nowMs),
      })),
      appUrl()
    );
    if (
      await enqueue(
        'weekly_coverage',
        workspace.id,
        null,
        notice,
        now(),
        weeklyDedupeKey(workspace.id, week)
      )
    ) {
      enqueued += 1;
    }
  }
  return { enqueued };
}

export function notificationsConfigured(): {
  encryption: boolean;
  email: boolean;
} {
  return {
    encryption: encryptionKeyConfigured(),
    email: Boolean(process.env.RESEND_API_KEY),
  };
}
