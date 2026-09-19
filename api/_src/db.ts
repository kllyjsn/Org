import pg from 'pg';

let pool: pg.Pool | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

export function now(): string {
  return new Date().toISOString();
}

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TEXT;
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify','reset')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TEXT NOT NULL
);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS seller_profile JSONB;
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','member','viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  company_name TEXT,
  state JSONB NOT NULL,
  is_live_opportunity BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE maps ADD COLUMN IF NOT EXISTS is_live_opportunity BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS share_links (
  token TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  person_id TEXT,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS map_versions (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  state JSONB NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_briefings (
  map_id TEXT PRIMARY KEY REFERENCES maps(id) ON DELETE CASCADE,
  map_updated_at TEXT NOT NULL,
  seller_profile JSONB,
  briefing JSONB NOT NULL,
  generated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_strategies (
  map_id TEXT PRIMARY KEY REFERENCES maps(id) ON DELETE CASCADE,
  map_updated_at TEXT NOT NULL,
  seller_profile JSONB,
  insights JSONB NOT NULL,
  generated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS map_presence (
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_seen TEXT NOT NULL,
  cursor_x DOUBLE PRECISION,
  cursor_y DOUBLE PRECISION,
  selected_person_id TEXT,
  PRIMARY KEY (map_id, user_id)
);
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  map_id TEXT,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT,
  occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('bug','idea','research_quality','other')),
  message TEXT NOT NULL,
  page_path TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','resolved')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  map_id TEXT REFERENCES maps(id) ON DELETE SET NULL,
  domain TEXT NOT NULL,
  focus TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
  checkpoint JSONB NOT NULL,
  events JSONB NOT NULL DEFAULT '[]',
  partial JSONB,
  result JSONB,
  error TEXT,
  lease_until TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS research_jobs_status_idx
  ON research_jobs (status, created_at);
ALTER TABLE map_presence ADD COLUMN IF NOT EXISTS cursor_x DOUBLE PRECISION;
ALTER TABLE map_presence ADD COLUMN IF NOT EXISTS cursor_y DOUBLE PRECISION;
ALTER TABLE map_presence ADD COLUMN IF NOT EXISTS selected_person_id TEXT;
CREATE INDEX IF NOT EXISTS idx_maps_workspace ON maps(workspace_id);
CREATE INDEX IF NOT EXISTS idx_comments_map ON comments(map_id);
CREATE INDEX IF NOT EXISTS idx_map_versions_map ON map_versions(map_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_map_presence_map ON map_presence(map_id, last_seen DESC);
CREATE TABLE IF NOT EXISTS workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_ws ON workspace_invites(workspace_id);
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS access_scope TEXT NOT NULL DEFAULT 'all';
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS access_scope TEXT NOT NULL DEFAULT 'all';
ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS map_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS member_map_access (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id, map_id)
);
CREATE INDEX IF NOT EXISTS idx_member_map_access_user ON member_map_access(user_id, workspace_id);
CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  functions TEXT[] NOT NULL,
  min_seniority TEXT NOT NULL,
  title_keywords TEXT[] NOT NULL DEFAULT '{}',
  buying_role TEXT,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_personas_workspace ON personas(workspace_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_share_links_map ON share_links(map_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_workspace_time
  ON analytics_events(workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_user_time
  ON analytics_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_map_time
  ON analytics_events(map_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_user_dedupe
  ON analytics_events(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
DELETE FROM analytics_events
  WHERE occurred_at::timestamptz < NOW() - INTERVAL '24 months';
CREATE TABLE IF NOT EXISTS roster_people (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  person_key TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  "function" TEXT,
  seniority TEXT,
  location TEXT,
  linkedin TEXT,
  email TEXT,
  manager_key TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  confidence TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'suggested',
  map_person_id TEXT,
  raw JSONB,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (workspace_id, domain, person_key)
);
CREATE INDEX IF NOT EXISTS roster_people_ws_domain ON roster_people(workspace_id, domain);
CREATE TABLE IF NOT EXISTS extension_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS extension_tokens_user ON extension_tokens(user_id);
CREATE TABLE IF NOT EXISTS roster_sync_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  events JSONB NOT NULL DEFAULT '[]',
  summary JSONB,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at);
`;

async function getPool(): Promise<pg.Pool> {
  if (pool) return pool;
  const connectionString =
    process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('POSTGRES_URL/DATABASE_URL is not set');
  pool = new pg.Pool({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString)
      ? undefined
      : { rejectUnauthorized: false },
    max: 4,
  });
  if (!initPromise) {
    initPromise = (async () => {
      if (initialized) return;
      await pool!.query(DDL);
      initialized = true;
    })();
  }
  await initPromise;
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const p = await getPool();
  const res = await p.query<T>(text, params);
  return res.rows;
}
