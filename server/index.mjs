import { createPool, migrate } from './db.mjs';
import { createApi } from './http.mjs';
import { createAuth } from './auth.mjs';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const production = process.env.NODE_ENV === 'production';
if (production) {
  const origin = new URL(process.env.BETTER_AUTH_URL || 'http://invalid');
  if (origin.protocol !== 'https:' || origin.origin !== process.env.BETTER_AUTH_URL) throw new Error('Production BETTER_AUTH_URL must be an HTTPS origin without a trailing slash.');
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) throw new Error('Production requires a separate BETTER_AUTH_SECRET of at least 32 characters.');
  await access(new URL('../dist/index.html', import.meta.url));
}

const pool = createPool();
try { await migrate(pool); } catch { await pool.end(); throw new Error('Database startup failed. Check DATABASE_URL and that PostgreSQL is running.'); }
const port = Number(process.env.PORT || process.env.API_PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
const auth = createAuth(pool);
const server = createApi(pool,{auth,allowedOrigins:auth.options.trustedOrigins,production,staticDirectory:production ? fileURLToPath(new URL('../dist/',import.meta.url)) : undefined,trustRailwayProxy:production && process.env.TRUST_RAILWAY_PROXY === 'true'});
server.listen(port,production ? '0.0.0.0' : '127.0.0.1',() => console.log(`timenow listening on port ${port}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close(async () => { await pool.end(); process.exit(0); }));
