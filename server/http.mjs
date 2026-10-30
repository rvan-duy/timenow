import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { serveStatic } from './static.mjs';
import { ZodError } from 'zod';
import { toNodeHandler } from 'better-auth/node';
import { authenticate } from './auth.mjs';
import { AppError, readWorkspace, saveRecord, logTime, logTimeBulk, changeTime, markEntriesBilled } from './workspace.mjs';

async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError(415,'Use application/json.');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 1024*1024) throw new AppError(413,'Request too large.');
  }
  try { return JSON.parse(body); } catch { throw new AppError(400,'Invalid JSON.'); }
}
export function createApi(pool, { auth, allowedOrigins = ['http://localhost:5173','http://127.0.0.1:5173'], production = false, staticDirectory, trustRailwayProxy = false } = {}) {
  if (!auth) throw new Error('Authentication is required.');
  const authHandler = toNodeHandler(auth);
  return createServer(async (req,res) => {
    res.setHeader('Content-Type','application/json');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    const send = (status,data) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url,'http://localhost');
      const path = url.pathname;
      // Health probes use Railway's own Host, and expose no workspace data.
      if (req.method === 'GET' && path === '/api/health') {
        await pool.query('SELECT 1'); return send(200,{status:'ok',database:'connected'});
      }
      const host = req.headers.host || '';
      const validHost = production
        ? allowedOrigins.some(origin => new URL(origin).host === host)
        : /^((localhost|127\.0\.0\.1)(:\d+)?)$/.test(host);
      if (!validHost) throw new AppError(403,'Host not allowed.');
      if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) throw new AppError(403,'Origin not allowed.');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403,'Cross-site access denied.');
      if (staticDirectory && path !== '/api' && !path.startsWith('/api/')) return await serveStatic(req,res,path,staticDirectory);
      if (path.startsWith('/api/auth/')) {
        const permitted = (req.method === 'POST' && ['/api/auth/sign-in/username','/api/auth/sign-out'].includes(path)) || (req.method === 'GET' && path === '/api/auth/get-session');
        if (!permitted) throw new AppError(404,'Endpoint not found.');
        if (req.method === 'POST' && !allowedOrigins.includes(req.headers.origin)) throw new AppError(403,'A trusted Origin is required.');
        // Railway overwrites X-Real-IP at its HTTPS edge. Never trust X-Forwarded-For.
        const edgeIP = req.headers['x-real-ip'];
        req.headers['x-timenow-client-ip'] = trustRailwayProxy && typeof edgeIP === 'string' && isIP(edgeIP) ? edgeIP : req.socket.remoteAddress;
        return await authHandler(req,res);
      }
      const identity = await authenticate(auth,pool,req);
      const actor = identity.actor;
      if (identity.kind === 'human' && req.method !== 'GET' && !allowedOrigins.includes(req.headers.origin)) throw new AppError(403,'A trusted Origin is required.');
      if (req.method === 'GET' && path === '/api/me') return send(200,{actor,kind:identity.kind});
      if (req.method === 'GET') {
        const statePaths = {'/api/customers':'customers','/api/projects':'projects','/api/time-entries':'entries','/api/history':'history'};
        if (path === '/api/workspace') return send(200,await readWorkspace(pool));
        if (statePaths[path]) {
          const state = await readWorkspace(pool);
          let rows = state[statePaths[path]];
          for (const key of ['status','projectId','customerId','actor']) {
            const value = url.searchParams.get(key);
            if (value) rows = rows.filter(row => key === 'customerId' && path === '/api/time-entries' ? state.projects.some(p => p.id === row.projectId && p.customerId === value) : row[key] === value);
          }
          const from = url.searchParams.get('from'), to = url.searchParams.get('to');
          if (from) rows = rows.filter(row => String(row.date || row.at?.toISOString()).slice(0,10) >= from);
          if (to) rows = rows.filter(row => String(row.date || row.at?.toISOString()).slice(0,10) <= to);
          return send(200,rows);
        }
        if (path === '/api/billing-batches') {
          return send(200,(await pool.query('SELECT id,customer_id AS "customerId",external_invoice_reference AS "externalInvoiceReference",total_minutes AS "totalMinutes",created_by AS actor,created_at AS "createdAt" FROM billing_batches ORDER BY created_at DESC')).rows);
        }
      }
      if (req.method === 'POST' || req.method === 'PATCH') {
        const record = /^\/api\/(customers|projects)(?:\/([^/]+))?$/.exec(path);
        let result;
        if (record && ((req.method === 'POST' && !record[2]) || (req.method === 'PATCH' && record[2]))) result = await saveRecord(pool,record[1],record[2],await readBody(req),actor);
        else if (req.method === 'POST' && path === '/api/time-entries') result = await logTime(pool,await readBody(req),actor);
        else if (req.method === 'POST' && path === '/api/time-entries/bulk') result = await logTimeBulk(pool,await readBody(req),actor);
        else if (req.method === 'POST' && path === '/api/billing-batches') result = await markEntriesBilled(pool,await readBody(req),actor);
        else {
          const entry = /^\/api\/time-entries\/([^/]+)(\/void)?$/.exec(path);
          if (entry && ((req.method === 'PATCH' && !entry[2]) || (req.method === 'POST' && entry[2]))) result = await changeTime(pool,entry[1],await readBody(req),actor,!!entry[2]);
          else throw new AppError(404,'Endpoint not found.');
        }
        return send(req.method === 'POST' ? 201 : 200,result);
      } else if (req.method !== 'GET') throw new AppError(405,'Method not allowed.');
      throw new AppError(404,'Endpoint not found.');
    } catch (error) {
      if (error instanceof ZodError) return send(400,{error:error.issues.map(issue => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; ')});
      if (error instanceof AppError) return send(error.status,{error:error.message});
      if (error.code === '23503' || error.code === '23514' || error.code === '22P02' || error.code === '22008') return send(400,{error:'The change violates a data constraint.'});
      if (error.code === '23505' || error.code === '40P01' || error.code === '40001') return send(409,{error:'Conflicting change. Reload and try again.'});
      console.error('API request failed', {code:error.code || 'unknown'});
      return send(503,{error:'Database unavailable. Your change could not be confirmed; reload before retrying.'});
    }
  });
}
