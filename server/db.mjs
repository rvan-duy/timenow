import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required. Configure the private .env file.');
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  pool.on('error', () => console.error('An idle database connection failed.'));
  return pool;
}
export async function transaction(pool, work, isolation = '') {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ${isolation}`);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate(pool) {
  const directory = new URL('../db/migrations/', import.meta.url);
  await transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(726463901)');
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
      if ((await db.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name])).rowCount) continue;
      await db.query(await readFile(new URL(name, directory), 'utf8'));
      await db.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
      console.log(`Applied migration ${name}`);
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  try { await migrate(pool); } finally { await pool.end(); }
}
