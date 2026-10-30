import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { request as httpRequest } from 'node:http';
import { createApi } from './http.mjs';
import { createAuth } from './auth.mjs';
import { migrate } from './db.mjs';
import { provisionAccounts } from './auth-setup.mjs';

const schema = `test_prod_${randomUUID().replaceAll('-','')}`;
const admin = new pg.Pool({connectionString:process.env.DATABASE_URL});
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
const secret = randomBytes(48).toString('hex'), password = randomBytes(24).toString('hex');
const origin = 'https://timenow.example';
let server, base, directory;
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await provisionAccounts(pool,createAuth(pool,{secret,baseURL:origin,provisioning:true}),password);
  directory = await mkdtemp(join(tmpdir(),'timenow-static-'));
  await mkdir(join(directory,'assets'));
  await writeFile(join(directory,'index.html'),'<!doctype html><title>TimeNow</title>');
  await writeFile(join(directory,'assets','app.js'),'console.log("app")');
  await writeFile(join(directory,'.env'),'secret');
  server = createApi(pool,{auth:createAuth(pool,{secret,baseURL:origin}),production:true,allowedOrigins:[origin],staticDirectory:directory,trustRailwayProxy:true});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if(server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  if(directory) await rm(directory,{recursive:true});
});
function request(path,options={}) {
  return new Promise((resolve,reject) => {
    const req = httpRequest(base+path,{method:options.method || 'GET',headers:{Host:'timenow.example',...options.headers}},res => {
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>{
        const headers=new Headers();
        for(let i=0;i<res.rawHeaders.length;i+=2) headers.append(res.rawHeaders[i],res.rawHeaders[i+1]);
        resolve(new Response(options.method === 'HEAD' ? null : Buffer.concat(chunks),{status:res.statusCode,headers}));
      });
    });
    req.on('error',reject); req.end(options.body);
  });
}
test('production serves public assets while protecting API and rejecting host/origin spoofing',async () => {
  const page = await request('/');
  assert.equal(page.status,200); assert.match(page.headers.get('content-type'),/text\/html/);
  assert.match(await page.text(),/TimeNow/);
  const asset = await request('/assets/app.js');
  assert.equal(asset.status,200); assert.match(asset.headers.get('cache-control'),/immutable/);
  assert.equal((await request('/',{method:'HEAD'})).headers.get('content-length'),String(Buffer.byteLength('<!doctype html><title>TimeNow</title>')));
  for (const path of ['/.env','/%2eenv','/assets/%2e%2e%2f.env','/server/auth.mjs','/missing.js']) assert.equal((await request(path)).status,404,path);
  assert.equal((await request('/api/workspace')).status,401);
  assert.equal((await request('/api/workspace',{headers:{Host:'evil.example','x-forwarded-host':'timenow.example'}})).status,403);
  assert.equal((await request('/api/workspace',{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await request('/api/health',{headers:{Host:'healthcheck.railway.app'}})).status,200);
});
test('production HTTPS login sets secure cookies and uses only the configured Railway edge IP',async () => {
  const signIn = (pass,headers={}) => request('/api/auth/sign-in/username',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','x-real-ip':'192.0.2.42',...headers},body:JSON.stringify({username:'ruben',password:pass})});
  const response = await signIn(password);
  assert.equal(response.status,200);
  assert.ok(response.headers.getSetCookie().some(cookie=>/; Secure/i.test(cookie)&&/; HttpOnly/i.test(cookie)));
  const cookie = response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  assert.equal((await request('/api/me',{headers:{Cookie:cookie}})).status,200);
  await pool.query('DELETE FROM auth_rate_limit');
  const statuses=[];
  for(let i=0;i<6;i++) statuses.push((await signIn('wrong-password',{'x-timenow-client-ip':`192.0.2.${i}`,'x-forwarded-for':`192.0.2.${i}`})).status);
  assert.deepEqual(statuses,[401,401,401,401,401,429]);
});
