import { createPool, migrate } from './db.mjs';
import { createApi } from './http.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Production authentication must be implemented before deploying this development API.');
const pool = createPool();
try { await migrate(pool); } catch { await pool.end(); throw new Error('Database startup failed. Check DATABASE_URL and that PostgreSQL is running.'); }
const port = Number(process.env.API_PORT || 3001);
const server = createApi(pool,{actor:process.env.LOCAL_ACTOR || 'ruben',allowedOrigins:(process.env.DEV_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',')});
server.listen(port,'127.0.0.1',() => console.log(`timenow API: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close(async () => { await pool.end(); process.exit(0); }));
