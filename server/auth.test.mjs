import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from './db.mjs';
import { createApi } from './http.mjs';
import { createAuth } from './auth.mjs';
import { provisionAccounts, resetPassword, rotateAgentKey } from './auth-setup.mjs';

const schema = `test_auth_${randomUUID().replaceAll('-','')}`;
const admin = new pg.Pool({connectionString:process.env.DATABASE_URL});
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
const secret = randomBytes(48).toString('hex');
const password = randomBytes(24).toString('hex');
const origin = 'http://localhost:5173';
let auth, server, base, agentKey;
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await provisionAccounts(pool,createAuth(pool,{secret,provisioning:true}),password);
  auth = createAuth(pool,{secret});
  await rotateAgentKey(pool,auth,async key => { agentKey=key; });
  server = createApi(pool,{auth});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
async function request(path,{method='GET',body,cookie,token,headers={}}={}) {
  return fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:`Bearer ${token}`} :{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function login(pass=password) {
  const response = await request('/auth/sign-in/username',{method:'POST',body:{username:'ruben',password:pass},headers:{Origin:origin}});
  assert.equal(response.status,200);
  const cookies=response.headers.getSetCookie();
  assert.ok(cookies.some(value=>/HttpOnly/i.test(value)&&/SameSite=Lax/i.test(value)));
  return cookies.map(value=>value.split(';')[0]).join('; ');
}

test('workspace endpoints reject unauthenticated requests; health remains public and signup closed',async () => {
  for(const path of ['/me','/workspace','/customers','/projects','/time-entries','/history','/billing-batches']) assert.equal((await request(path)).status,401,path);
  assert.equal((await request('/customers',{method:'POST',body:{name:'No access'}})).status,401);
  assert.equal((await request('/health')).status,200);
  for(const path of ['/auth/sign-up/email','/auth/api-key/create','/auth/update-user','/auth/request-password-reset']) assert.equal((await request(path,{method:'POST',body:{},headers:{Origin:origin}})).status,404,path);
  assert.equal((await pool.query('SELECT count(*) FROM auth_user')).rows[0].count,'2');
});
test('password login, trusted origin, authenticated mutation and logout revocation',async () => {
  assert.equal((await request('/auth/sign-in/username',{method:'POST',body:{username:'ruben',password:'incorrect'},headers:{Origin:origin}})).status,401);
  assert.equal((await request('/auth/sign-in/username',{method:'POST',body:{username:'ruben',password},headers:{Origin:'https://evil.example'}})).status,403);
  const cookie=await login();
  const me=await (await request('/me',{cookie})).json();
  assert.deepEqual(me,{actor:'ruben',kind:'human'});
  assert.equal((await request('/customers',{method:'POST',cookie,body:{name:'No Origin'}})).status,403);
  const created=await request('/customers',{method:'POST',cookie,headers:{Origin:origin},body:{name:'Human customer'}});
  assert.equal(created.status,201);
  const {id}=await created.json();
  assert.equal((await pool.query('SELECT actor FROM audit_log WHERE entity_id=$1',[id])).rows[0].actor,'ruben');
  assert.equal((await request('/auth/sign-out',{method:'POST',cookie,body:{},headers:{Origin:origin}})).status,200);
  assert.equal((await request('/workspace',{cookie})).status,401);
});
test('expired sessions and changed signing secrets reject old cookies',async () => {
  const cookie=await login();
  const other=createApi(pool,{auth:createAuth(pool,{secret:randomBytes(48).toString('hex')})});
  await new Promise(resolve=>other.listen(0,'127.0.0.1',resolve));
  try { assert.equal((await fetch(`http://127.0.0.1:${other.address().port}/api/me`,{headers:{Cookie:cookie}})).status,401); }
  finally { await new Promise(resolve=>other.close(resolve)); }
  await pool.query('UPDATE auth_session SET "expiresAt"=now()-interval \'1 minute\'');
  assert.equal((await request('/workspace',{cookie})).status,401);
});
test('agent key authenticates with agent attribution, remains hashed and cannot impersonate human',async () => {
  assert.deepEqual(await (await request('/me',{token:agentKey})).json(),{actor:'agent',kind:'agent'});
  const response=await request('/customers',{method:'POST',token:agentKey,body:{name:'Agent customer'}});
  assert.equal(response.status,201);
  const {id}=await response.json();
  assert.equal((await pool.query('SELECT actor FROM audit_log WHERE entity_id=$1',[id])).rows[0].actor,'agent');
  assert.notEqual((await pool.query('SELECT key FROM auth_api_key WHERE enabled=true')).rows[0].key,agentKey);
  assert.equal((await request('/workspace',{token:agentKey+'bad'})).status,401);
  assert.equal((await request('/customers',{method:'POST',token:agentKey,body:{name:'Spoof',actor:'ruben'}})).status,400);
  // Agent has no password credential and API keys are not accepted as browser sessions.
  const agentId=(await pool.query("SELECT user_id FROM auth_identities WHERE actor='agent'")).rows[0].user_id;
  assert.equal((await pool.query('SELECT count(*) FROM auth_account WHERE "userId"=$1',[agentId])).rows[0].count,'0');
  const humanId=(await pool.query("SELECT user_id FROM auth_identities WHERE actor='ruben'")).rows[0].user_id;
  const wrongOwner=await auth.api.createApiKey({body:{userId:humanId,name:'wrong-owner'}});
  assert.equal((await request('/workspace',{token:wrongOwner.key})).status,403);
});
test('HTTPS sessions use Secure cookies and agent rate limits are enforced',async () => {
  const secureAuth=createAuth(pool,{secret,baseURL:'https://timenow.example'});
  const response=await secureAuth.api.signInUsername({body:{username:'ruben',password},asResponse:true});
  assert.equal(response.status,200);
  assert.ok(response.headers.getSetCookie().some(value=>/; Secure/i.test(value)&&/; HttpOnly/i.test(value)));
  const agentId=(await pool.query("SELECT user_id FROM auth_identities WHERE actor='agent'")).rows[0].user_id;
  const limited=await auth.api.createApiKey({body:{userId:agentId,name:'limited',rateLimitMax:2,rateLimitTimeWindow:60000}});
  assert.equal((await request('/me',{token:limited.key})).status,200);
  assert.equal((await request('/me',{token:limited.key})).status,200);
  assert.equal((await request('/me',{token:limited.key})).status,429);
});
test('key expiry, rotation and revocation take effect immediately',async () => {
  await pool.query('UPDATE auth_api_key SET "expiresAt"=now()-interval \'1 minute\' WHERE enabled=true');
  assert.equal((await request('/workspace',{token:agentKey})).status,401);
  await rotateAgentKey(pool,auth,async key=>{agentKey=key;});
  assert.equal((await request('/workspace',{token:agentKey})).status,200);
  const old=agentKey;
  await rotateAgentKey(pool,auth,async key=>{agentKey=key;});
  assert.equal((await request('/workspace',{token:old})).status,401);
  assert.equal((await request('/workspace',{token:agentKey})).status,200);
  await pool.query('UPDATE auth_api_key SET enabled=false');
  assert.equal((await request('/workspace',{token:agentKey})).status,401);
});
test('setup is idempotent; password reset hashes the new password and revokes sessions',async () => {
  await pool.query('DELETE FROM auth_rate_limit');
  const cookie=await login();
  const replacement=randomBytes(24).toString('hex');
  await provisionAccounts(pool,createAuth(pool,{secret,provisioning:true}),replacement);
  assert.equal((await pool.query('SELECT count(*) FROM auth_user')).rows[0].count,'2');
  const stored=(await pool.query("SELECT password FROM auth_account WHERE \"providerId\"='credential'")).rows[0].password;
  assert.notEqual(stored,password);
  assert.notEqual(stored,replacement);
  await resetPassword(pool,auth,replacement);
  assert.equal((await request('/workspace',{cookie})).status,401);
  assert.equal((await request('/auth/sign-in/username',{method:'POST',body:{username:'ruben',password},headers:{Origin:origin}})).status,401);
  await login(replacement);
});
test('login rate limiting cannot be bypassed using a client-supplied IP header',async () => {
  await pool.query('DELETE FROM auth_rate_limit');
  const statuses=[];
  for(let i=0;i<6;i++) statuses.push((await request('/auth/sign-in/username',{method:'POST',body:{username:'ruben',password:'wrong-password'},headers:{Origin:origin,'x-timenow-client-ip':`192.0.2.${i+1}`,'x-forwarded-for':`192.0.2.${i+1}`}})).status);
  assert.deepEqual(statuses,[401,401,401,401,401,429]);
});
