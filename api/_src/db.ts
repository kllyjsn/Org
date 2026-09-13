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
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
ALTER TABLE map_presence ADD COLUMN IF NOT EXISTS cursor_x DOUBLE PRECISION;
ALTER TABLE map_presence ADD COLUMN IF NOT EXISTS cursor_y DOUBLE PRECISION;
ALTER TABLE map_presence ADD COLUMN IF NOT EXISTS selected_person_id TEXT;
CREATE INDEX IF NOT EXISTS idx_maps_workspace ON maps(workspace_id);
CREATE INDEX IF NOT EXISTS idx_comments_map ON comments(map_id);
CREATE INDEX IF NOT EXISTS idx_map_versions_map ON map_versions(map_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_map_presence_map ON map_presence(map_id, last_seen DESC);
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
