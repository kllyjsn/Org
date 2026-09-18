import { randomUUID } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../crypto.js';
import { now, query } from '../db.js';
import { canonicalPersonName } from '../research.js';
import { normalizeEmail } from '../identity.js';
import { adapterFor } from './registry.js';
import type { CalendarEvent, EmailThread } from './types.js';
import type { MapRow, MapState, Person } from '../types.js';

export interface IntegrationRow {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: 'google' | 'microsoft';
  account_email: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string | null;
  status: 'connected' | 'error' | 'revoked';
  last_error: string | null;
  last_synced_at: string | null;
  created_at: string;
}

export interface Participant {
  email: string | null;
  name: string | null;
}

/**
 * Registrable-ish domain tail for "is this attendee at the account's company":
 * last two labels of the hostname part (handles subdomains crudely — good
 * enough since corporate domains rarely use multi-part public suffixes for
 * employee mail).
 */
function emailDomain(email: string): string {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  const labels = domain.split('.').filter(Boolean);
  return labels.length <= 2 ? domain : labels.slice(-2).join('.');
}

/**
 * Match calendar/email participants to mapped people. Exact email wins;
 * otherwise the name must match AND the participant must either have no
 * email or be at the account's domain — an external-domain same-name is a
 * different person. The integration owner's own account never matches.
 */
export function matchParticipants(
  participants: Participant[],
  people: Person[],
  companyDomain: string,
  ownerEmail?: string | null
): Map<string, Participant> {
  const matches = new Map<string, Participant>();
  const owner = normalizeEmail(ownerEmail);
  const domain = companyDomain.toLowerCase();
  for (const participant of participants) {
    const email = normalizeEmail(participant.email);
    if (email && owner && email === owner) continue;
    let hit: Person | undefined;
    if (email) {
      hit = people.find((person) => normalizeEmail(person.email) === email);
    }
    if (!hit && participant.name) {
      const participantDomain = email ? emailDomain(email) : null;
      const eligible = !participantDomain || participantDomain === domain;
      if (eligible) {
        const canonical = canonicalPersonName(participant.name);
        if (canonical) {
          hit = people.find(
            (person) => canonicalPersonName(person.name ?? '') === canonical
          );
        }
      }
    }
    if (hit && !matches.has(hit.id)) matches.set(hit.id, participant);
  }
  return matches;
}

export interface TouchStat {
  lastTouchAt: string | null;
  meetingCount: number;
  emailThreadCount: number;
  metWith: boolean;
}

export function deriveTouchStats(
  touchpoints: { personId: string; kind: string; occurredAt: string }[],
  nowMs = Date.now()
): Map<string, TouchStat> {
  const stats = new Map<string, TouchStat>();
  for (const touch of touchpoints) {
    const stat =
      stats.get(touch.personId) ??
      { lastTouchAt: null, meetingCount: 0, emailThreadCount: 0, metWith: false };
    // "Last touch" is about the past — a scheduled future meeting still
    // counts toward meetingCount but isn't contact that has happened yet.
    if (
      Date.parse(touch.occurredAt) <= nowMs &&
      (!stat.lastTouchAt || touch.occurredAt > stat.lastTouchAt)
    ) {
      stat.lastTouchAt = touch.occurredAt;
    }
    if (touch.kind === 'meeting') {
      stat.meetingCount += 1;
      if (Date.parse(touch.occurredAt) <= nowMs) stat.metWith = true;
    } else if (touch.kind === 'email') {
      stat.emailThreadCount += 1;
    }
    stats.set(touch.personId, stat);
  }
  return stats;
}

/**
 * Stamp derived touch stats onto people. `metWith` only ever flips on (a
 * meeting can prove contact, its absence proves nothing); `touchSource`
 * changes only on people whose stats actually changed.
 */
export function applyTouchStats(
  state: MapState,
  stats: Map<string, TouchStat>,
  provider: 'google' | 'microsoft'
): { state: MapState; changed: number } {
  let changed = 0;
  const people = (state.people ?? []).map((person) => {
    const stat = stats.get(person.id);
    if (!stat) return person;
    const lastTouchAt = stat.lastTouchAt ?? person.lastTouchAt ?? null;
    const next: Person = {
      ...person,
      lastTouchAt,
      meetingCount: stat.meetingCount,
      emailThreadCount: stat.emailThreadCount,
      metWith: person.metWith || stat.metWith,
    };
    const dirty =
      next.lastTouchAt !== (person.lastTouchAt ?? null) ||
      next.meetingCount !== (person.meetingCount ?? 0) ||
      next.emailThreadCount !== (person.emailThreadCount ?? 0) ||
      next.metWith !== person.metWith;
    if (!dirty) return person;
    changed += 1;
    return { ...next, touchSource: provider };
  });
  return { state: { ...state, people }, changed };
}

interface SyncResult {
  maps: number;
  touchpoints: number;
  peopleUpdated: number;
}

async function upsertTouchpoint(input: {
  workspaceId: string;
  mapId: string;
  personId: string;
  integrationId: string;
  kind: 'meeting' | 'email';
  externalId: string;
  occurredAt: string;
  subject: string | null;
  participants: Participant[];
}): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `INSERT INTO touchpoints
      (id, workspace_id, map_id, person_id, integration_id, kind,
       external_id, occurred_at, subject, participants, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (integration_id, external_id, person_id) DO NOTHING
     RETURNING id`,
    [
      randomUUID(),
      input.workspaceId,
      input.mapId,
      input.personId,
      input.integrationId,
      input.kind,
      input.externalId,
      input.occurredAt,
      input.subject,
      JSON.stringify(input.participants),
      now(),
    ]
  );
  return rows.length > 0;
}

async function syncCore(
  integration: IntegrationRow,
  accessToken: string
): Promise<SyncResult> {
  const adapter = adapterFor(integration.provider);
  if (!adapter) throw new Error(`unknown provider ${integration.provider}`);

  const nowMs = Date.now();
  const since = new Date(nowMs - 90 * 86_400_000).toISOString();
  const until = new Date(nowMs + 14 * 86_400_000).toISOString();

  const maps = await query<MapRow>(
    'SELECT * FROM maps WHERE workspace_id = $1',
    [integration.workspace_id]
  );

  // Calendar events → meeting touchpoints on each map's matched people.
  let events: CalendarEvent[] = [];
  try {
    events = await adapter.listEvents(accessToken, since, until);
  } catch (error) {
    console.error('calendar sync failed', error);
  }

  let inserted = 0;
  const emails = new Set<string>();
  for (const map of maps) {
    const state = map.state as MapState;
    const people = state.people ?? [];
    for (const person of people) {
      const email = normalizeEmail(person.email);
      if (email) emails.add(email);
    }
    for (const event of events) {
      const matches = matchParticipants(
        event.attendees,
        people,
        map.domain,
        integration.account_email
      );
      for (const personId of matches.keys()) {
        if (
          await upsertTouchpoint({
            workspaceId: integration.workspace_id,
            mapId: map.id,
            personId,
            integrationId: integration.id,
            kind: 'meeting',
            externalId: event.externalId,
            occurredAt: event.startsAt,
            subject: event.subject,
            participants: event.attendees,
          })
        ) {
          inserted += 1;
        }
      }
    }
  }

  // Email threads across the workspace's people → email touchpoints.
  let threads: EmailThread[] = [];
  const emailList = Array.from(emails).slice(0, 150);
  if (emailList.length > 0) {
    try {
      threads = await adapter.listThreads(accessToken, since, emailList);
    } catch (error) {
      console.error('email sync failed', error);
    }
  }
  for (const map of maps) {
    const people = (map.state as MapState).people ?? [];
    for (const thread of threads) {
      const matches = matchParticipants(
        thread.participants,
        people,
        map.domain,
        integration.account_email
      );
      for (const personId of matches.keys()) {
        if (
          await upsertTouchpoint({
            workspaceId: integration.workspace_id,
            mapId: map.id,
            personId,
            integrationId: integration.id,
            kind: 'email',
            externalId: thread.externalId,
            occurredAt: thread.lastMessageAt,
            subject: thread.subject,
            participants: thread.participants,
          })
        ) {
          inserted += 1;
        }
      }
    }
  }

  // Re-derive per-person touch stats and persist only changed maps.
  let peopleUpdated = 0;
  for (const map of maps) {
    const touches = await query<{
      person_id: string;
      kind: string;
      occurred_at: string;
    }>(
      'SELECT person_id, kind, occurred_at FROM touchpoints WHERE map_id = $1',
      [map.id]
    );
    const stats = deriveTouchStats(
      touches.map((touch) => ({
        personId: touch.person_id,
        kind: touch.kind,
        occurredAt: touch.occurred_at,
      })),
      nowMs
    );
    const { state: nextState, changed } = applyTouchStats(
      map.state as MapState,
      stats,
      integration.provider
    );
    if (changed > 0) {
      peopleUpdated += changed;
      await query('UPDATE maps SET state = $1, updated_at = $2 WHERE id = $3', [
        JSON.stringify(nextState),
        now(),
        map.id,
      ]);
    }
  }

  return { maps: maps.length, touchpoints: inserted, peopleUpdated };
}

/**
 * Full sync for one integration row: token refresh if due, provider pulls,
 * touchpoint upserts, per-map stat derivation. Status/last_error persist on
 * the integration either way.
 */
export async function syncIntegration(integrationId: string): Promise<SyncResult> {
  const rows = await query<IntegrationRow>(
    'SELECT * FROM integrations WHERE id = $1',
    [integrationId]
  );
  const integration = rows[0];
  if (!integration) throw new Error('integration not found');
  const adapter = adapterFor(integration.provider);
  if (!adapter) throw new Error(`unknown provider ${integration.provider}`);

  try {
    let accessToken = decryptSecret(integration.access_token);
    const expiryMs = integration.expires_at
      ? Date.parse(integration.expires_at)
      : Number.POSITIVE_INFINITY;
    if (expiryMs < Date.now() + 60_000 && integration.refresh_token) {
      const refreshed = await adapter.refresh(
        decryptSecret(integration.refresh_token)
      );
      accessToken = refreshed.accessToken;
      await query(
        'UPDATE integrations SET access_token = $1, expires_at = $2 WHERE id = $3',
        [
          encryptSecret(refreshed.accessToken),
          refreshed.expiresAt,
          integration.id,
        ]
      );
    }

    const result = await syncCore(integration, accessToken);
    await query(
      `UPDATE integrations
       SET status = 'connected', last_error = NULL, last_synced_at = $1
       WHERE id = $2`,
      [now(), integration.id]
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query(
      `UPDATE integrations
       SET status = 'error', last_error = $1 WHERE id = $2`,
      [message.slice(0, 400), integration.id]
    ).catch(() => undefined);
    throw error;
  }
}

/** Cron hook: sync the stalest healthy connection, one per tick. */
export async function syncNextDueIntegration(): Promise<{
  synced: boolean;
  integrationId?: string;
  result?: SyncResult;
}> {
  const due = await query<IntegrationRow>(
    `SELECT * FROM integrations
     WHERE status = 'connected'
     ORDER BY COALESCE(last_synced_at, '1970-01-01') ASC
     LIMIT 1`
  );
  const integration = due[0];
  if (!integration) return { synced: false };
  const result = await syncIntegration(integration.id);
  return { synced: true, integrationId: integration.id, result };
}
