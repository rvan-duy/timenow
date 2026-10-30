import { createPool, migrate } from './db.mjs';
import { createApi } from './http.mjs';
import { createAuth } from './auth.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Production hosting is not configured yet; use the local development server.');
const pool = createPool();
try { await migrate(pool); } catch { await pool.end(); throw new Error('Database startup failed. Check DATABASE_URL and that PostgreSQL is running.'); }
const port = Number(process.env.API_PORT || 3001);
const auth = createAuth(pool);
const server = createApi(pool,{auth,allowedOrigins:auth.options.trustedOrigins});
server.listen(port,'127.0.0.1',() => console.log(`timenow API: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close(async () => { await pool.end(); process.exit(0); }));
