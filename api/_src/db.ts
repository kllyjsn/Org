import pg from 'pg';
import { runMigrations } from './migrations.js';

let pool: pg.Pool | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

export function now(): string {
  return new Date().toISOString();
}

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
      await runMigrations(pool!);
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
