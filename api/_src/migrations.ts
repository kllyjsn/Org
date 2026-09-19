import type pg from 'pg';
import { sql as init } from './migrations/0001-init.js';

interface Migration {
  id: string;
  sql: string;
}

// Ordered, append-only. Each entry runs once, in its own transaction, on the
// first connection that needs it. Never edit an applied migration — add the
// next one.
const MIGRATIONS: Migration[] = [{ id: '0001-init', sql: init }];

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`
  );
  const applied = new Set(
    (await pool.query<{ id: string }>('SELECT id FROM _migrations')).rows.map(
      (r) => r.id
    )
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    // Statements in one migration share a client so BEGIN/COMMIT hold.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      await client.query(
        'INSERT INTO _migrations (id, applied_at) VALUES ($1, $2)',
        [migration.id, new Date().toISOString()]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(`migration ${migration.id} failed: ${error}`);
    } finally {
      client.release();
    }
  }
}
