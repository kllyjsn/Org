import { randomUUID } from 'node:crypto';
import { now, query } from './db.js';

export type ProductEventName =
  | 'map_created'
  | 'map_viewed'
  | 'map_refined'
  | 'source_opened'
  | 'briefing_opened'
  | 'strategy_opened'
  | 'briefing_action_selected'
  | 'account_agent_used'
  | 'deep_research_completed'
  | 'comment_added'
  | 'share_created'
  | 'live_opportunity_set'
  | 'roster_imported';

type EventProperties = Record<string, string | number | boolean | null>;

interface MapCreationMetricInput {
  creationMode: 'researched' | 'template' | 'blank';
  provider: string | null;
  researchedAt?: string | null;
  peopleCount: number;
  sourceCount: number;
  initiativeCount: number;
  edgeCount: number;
  researchStartedAt?: unknown;
  nowMs?: number;
}

interface EventInput {
  eventName: ProductEventName;
  userId: string;
  workspaceId: string;
  mapId?: string | null;
  properties?: EventProperties;
  dedupeKey?: string | null;
}

const CLIENT_EVENTS = new Set<ProductEventName>([
  'map_viewed',
  'source_opened',
  'briefing_opened',
  'strategy_opened',
  'briefing_action_selected',
  'deep_research_completed',
]);

const ENTRY_POINTS = new Set(['dashboard', 'direct', 'spotlight', 'toolbar']);
const SOURCE_SURFACES = new Set([
  'person',
  'initiative',
  'briefing',
  'change',
  'agent',
]);
const ACTION_TYPES = new Set([
  'focus_people',
  'open_strategy',
  'open_initiatives',
  'deep_research',
]);
const PROVENANCE = new Set(['sourced', 'map', 'hypothesis']);

function enumValue(
  value: unknown,
  allowed: Set<string>,
  fallback: string
): string {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

function countValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(500, Math.round(value)))
    : 0;
}

export function mapCreationMetrics({
  creationMode,
  provider,
  researchedAt,
  peopleCount,
  sourceCount,
  initiativeCount,
  edgeCount,
  researchStartedAt,
  nowMs = Date.now(),
}: MapCreationMetricInput): EventProperties {
  const useful =
    provider !== 'fixture' &&
    Boolean(researchedAt) &&
    peopleCount >= 3 &&
    sourceCount >= 2;
  const researchStartedAtMs =
    typeof researchStartedAt === 'string'
      ? Date.parse(researchStartedAt)
      : Number.NaN;
  const elapsedSeconds = Number.isFinite(researchStartedAtMs)
    ? Math.round((nowMs - researchStartedAtMs) / 1_000)
    : null;

  return {
    useful,
    creation_mode: creationMode,
    people_count: peopleCount,
    source_count: sourceCount,
    initiative_count: initiativeCount,
    estimated_minutes_saved:
      creationMode === 'researched'
        ? Math.min(180, peopleCount * 2 + initiativeCount * 5 + edgeCount)
        : 0,
    ...(elapsedSeconds !== null &&
    elapsedSeconds >= 0 &&
    elapsedSeconds <= 14_400
      ? { time_to_value_seconds: elapsedSeconds }
      : {}),
  };
}

export function sanitizeClientEvent(
  eventName: unknown,
  input: unknown
): { eventName: ProductEventName; properties: EventProperties } | null {
  if (typeof eventName !== 'string' || !CLIENT_EVENTS.has(eventName as ProductEventName)) {
    return null;
  }
  const name = eventName as ProductEventName;
  const properties =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};

  if (name === 'map_viewed' || name === 'briefing_opened' || name === 'strategy_opened') {
    return {
      eventName: name,
      properties: {
        entry: enumValue(properties.entry, ENTRY_POINTS, 'direct'),
      },
    };
  }
  if (name === 'source_opened') {
    return {
      eventName: name,
      properties: {
        surface: enumValue(properties.surface, SOURCE_SURFACES, 'person'),
      },
    };
  }
  if (name === 'briefing_action_selected') {
    return {
      eventName: name,
      properties: {
        action_type: enumValue(
          properties.actionType,
          ACTION_TYPES,
          'focus_people'
        ),
        provenance: enumValue(properties.provenance, PROVENANCE, 'map'),
      },
    };
  }
  return {
    eventName: name,
    properties: {
      added_count: countValue(properties.addedCount),
      enriched_count: countValue(properties.enrichedCount),
    },
  };
}

export async function recordProductEvent({
  eventName,
  userId,
  workspaceId,
  mapId = null,
  properties = {},
  dedupeKey = null,
}: EventInput): Promise<void> {
  await query(
    `INSERT INTO analytics_events
     (id, event_name, user_id, workspace_id, map_id, properties, dedupe_key, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [
      randomUUID(),
      eventName,
      userId,
      workspaceId,
      mapId,
      JSON.stringify(properties),
      dedupeKey,
      now(),
    ]
  );
}

interface MetricRow {
  maps_created: string;
  useful_maps: string;
  source_opens: string;
  briefing_opens: string;
  actions_taken: string;
  refinements: string;
  collaboration_actions: string;
  estimated_minutes_saved: string;
  first_useful_seconds: string | null;
}

interface RepeatRow {
  repeat_accounts: string;
}

interface WorkspaceMetricRow {
  active_users: string;
  maps_created: string;
  useful_maps: string;
  briefing_opens: string;
  actions_taken: string;
  collaboration_actions: string;
  contributors: string;
}

interface PlatformMetricRow {
  registered_users: string;
  activated_users: string;
  active_users_30d: string;
  retained_users_30d: string;
  maps_created: string;
  live_opportunity_maps: string;
  briefing_opens: string;
  actions_taken: string;
}

function number(value: string | null | undefined): number {
  return Number(value ?? 0);
}

export async function valueSummary(
  userId: string,
  workspaceId: string,
  includePlatform: boolean,
  scopedUserId: string | null = null
) {
  const personalRows = await query<MetricRow>(
    `SELECT
       COUNT(*) FILTER (WHERE event_name = 'map_created')::text AS maps_created,
       COUNT(*) FILTER (
         WHERE event_name = 'map_created'
           AND properties->>'useful' = 'true'
       )::text AS useful_maps,
       COUNT(*) FILTER (WHERE event_name = 'source_opened')::text AS source_opens,
       COUNT(*) FILTER (WHERE event_name = 'briefing_opened')::text AS briefing_opens,
       COUNT(*) FILTER (WHERE event_name = 'briefing_action_selected')::text AS actions_taken,
       COALESCE(SUM((properties->>'field_changes')::int) FILTER (
         WHERE event_name = 'map_refined'
       ), 0)::text AS refinements,
       COUNT(*) FILTER (
         WHERE event_name IN ('comment_added', 'share_created')
       )::text AS collaboration_actions,
       COALESCE(SUM((properties->>'estimated_minutes_saved')::int) FILTER (
         WHERE event_name = 'map_created'
       ), 0)::text AS estimated_minutes_saved,
       ((ARRAY_AGG(
         (properties->>'time_to_value_seconds')::int ORDER BY occurred_at
       ) FILTER (
         WHERE event_name = 'map_created'
           AND properties->>'useful' = 'true'
           AND properties ? 'time_to_value_seconds'
       ))[1])::text AS first_useful_seconds
     FROM analytics_events
     WHERE user_id = $1 AND workspace_id = $2`,
    [userId, workspaceId]
  );
  const repeatRows = await query<RepeatRow>(
    `SELECT COUNT(*)::text AS repeat_accounts FROM (
       SELECT map_id
       FROM analytics_events
       WHERE user_id = $1
         AND workspace_id = $2
         AND event_name = 'map_viewed'
         AND map_id IS NOT NULL
       GROUP BY map_id
       HAVING COUNT(DISTINCT occurred_at::date) >= 2
     ) repeated`,
    [userId, workspaceId]
  );
  const liveRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM maps WHERE workspace_id = $1 AND is_live_opportunity = TRUE
       AND ($2::text IS NULL OR id IN (
         SELECT map_id FROM member_map_access
         WHERE workspace_id = $1 AND user_id = $2
       ))`,
    [workspaceId, scopedUserId]
  );
  const workspaceRows = await query<WorkspaceMetricRow>(
    `SELECT
       COUNT(DISTINCT user_id)::text AS active_users,
       COUNT(*) FILTER (WHERE event_name = 'map_created')::text AS maps_created,
       COUNT(*) FILTER (
         WHERE event_name = 'map_created'
           AND properties->>'useful' = 'true'
       )::text AS useful_maps,
       COUNT(*) FILTER (WHERE event_name = 'briefing_opened')::text AS briefing_opens,
       COUNT(*) FILTER (WHERE event_name = 'briefing_action_selected')::text AS actions_taken,
       COUNT(*) FILTER (
         WHERE event_name IN ('comment_added', 'share_created')
       )::text AS collaboration_actions,
       COUNT(DISTINCT user_id) FILTER (
         WHERE event_name IN ('map_created', 'map_refined', 'comment_added', 'share_created')
       )::text AS contributors
     FROM analytics_events WHERE workspace_id = $1`,
    [workspaceId]
  );

  const personal = personalRows[0];
  const workspace = workspaceRows[0];
  const response: {
    personal: {
      mapsCreated: number;
      usefulMaps: number;
      sourceOpens: number;
      briefingOpens: number;
      actionsTaken: number;
      refinements: number;
      repeatAccounts: number;
      collaborationActions: number;
      liveOpportunityMaps: number;
      estimatedMinutesSaved: number;
      firstUsefulMapMinutes: number | null;
    };
    workspace: {
      activeUsers: number;
      contributors: number;
      mapsCreated: number;
      usefulMaps: number;
      briefingOpens: number;
      actionsTaken: number;
      collaborationActions: number;
      liveOpportunityMaps: number;
      briefingActionRate: number;
    };
    platform?: {
      registeredUsers: number;
      activatedUsers: number;
      activeUsers30d: number;
      retainedUsers30d: number;
      mapsCreated: number;
      liveOpportunityMaps: number;
      briefingActionRate: number;
    };
  } = {
    personal: {
      mapsCreated: number(personal?.maps_created),
      usefulMaps: number(personal?.useful_maps),
      sourceOpens: number(personal?.source_opens),
      briefingOpens: number(personal?.briefing_opens),
      actionsTaken: number(personal?.actions_taken),
      refinements: number(personal?.refinements),
      repeatAccounts: number(repeatRows[0]?.repeat_accounts),
      collaborationActions: number(personal?.collaboration_actions),
      liveOpportunityMaps: number(liveRows[0]?.count),
      estimatedMinutesSaved: number(personal?.estimated_minutes_saved),
      firstUsefulMapMinutes: personal?.first_useful_seconds
        ? Math.max(1, Math.round(number(personal.first_useful_seconds) / 60))
        : null,
    },
    workspace: {
      activeUsers: number(workspace?.active_users),
      contributors: number(workspace?.contributors),
      mapsCreated: number(workspace?.maps_created),
      usefulMaps: number(workspace?.useful_maps),
      briefingOpens: number(workspace?.briefing_opens),
      actionsTaken: number(workspace?.actions_taken),
      collaborationActions: number(workspace?.collaboration_actions),
      liveOpportunityMaps: number(liveRows[0]?.count),
      briefingActionRate: Math.min(
        100,
        Math.round(
          (number(workspace?.actions_taken) /
            Math.max(1, number(workspace?.briefing_opens))) *
            100
        )
      ),
    },
  };

  if (includePlatform) {
    const platformRows = await query<PlatformMetricRow>(
      `WITH activity AS (
         SELECT user_id,
                COUNT(DISTINCT occurred_at::date) FILTER (
                  WHERE occurred_at::timestamptz >= NOW() - INTERVAL '30 days'
                ) AS active_days_30d
         FROM analytics_events GROUP BY user_id
       )
       SELECT
         (SELECT COUNT(*) FROM users)::text AS registered_users,
         COUNT(DISTINCT user_id) FILTER (
           WHERE event_name = 'map_created'
             AND properties->>'useful' = 'true'
         )::text AS activated_users,
         (SELECT COUNT(*) FROM activity WHERE active_days_30d >= 1)::text AS active_users_30d,
         (SELECT COUNT(*) FROM activity WHERE active_days_30d >= 2)::text AS retained_users_30d,
         COUNT(*) FILTER (WHERE event_name = 'map_created')::text AS maps_created,
         (SELECT COUNT(*) FROM maps WHERE is_live_opportunity = TRUE)::text AS live_opportunity_maps,
         COUNT(*) FILTER (WHERE event_name = 'briefing_opened')::text AS briefing_opens,
         COUNT(*) FILTER (WHERE event_name = 'briefing_action_selected')::text AS actions_taken
       FROM analytics_events`
    );
    const platform = platformRows[0];
    response.platform = {
      registeredUsers: number(platform?.registered_users),
      activatedUsers: number(platform?.activated_users),
      activeUsers30d: number(platform?.active_users_30d),
      retainedUsers30d: number(platform?.retained_users_30d),
      mapsCreated: number(platform?.maps_created),
      liveOpportunityMaps: number(platform?.live_opportunity_maps),
      briefingActionRate: Math.min(
        100,
        Math.round(
          (number(platform?.actions_taken) /
            Math.max(1, number(platform?.briefing_opens))) *
            100
        )
      ),
    };
  }

  return response;
}
