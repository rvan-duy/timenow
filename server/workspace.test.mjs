import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { migrate } from './db.mjs';
import { createApi } from './http.mjs';

// Use a disposable schema, never the workspace's actual tables.
const schema = `test_${randomUUID().replaceAll('-','')}`;
const admin = new pg.Pool({connectionString:process.env.DATABASE_URL});
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema},public`});
let server, base;
before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await migrate(pool); // Re-running migrations preserves data and does not fail.
  server = createApi(pool);
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});
async function api(path,method='GET',body,expected=200,headers={}) {
  const response = await fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},...(body === undefined ? {} : {body:JSON.stringify(body)})});
  const data = await response.json();
  assert.equal(response.status,expected,JSON.stringify(data));
  return data;
}
async function setup() {
  const c = await api('/customers','POST',{name:'Test customer',rate:null},201);
  const p = await api('/projects','POST',{name:'Test project',customerId:c.id},201);
  return {c,p};
}
const entry = projectId => ({projectId,date:'2026-10-30',minutes:90,description:'Integration test work'});

test('API saves, reloads, edits and voids entries with transactional before/after audit',async () => {
  const {p} = await setup();
  const e = await api('/time-entries','POST',entry(p.id),201);
  let state = await api('/workspace');
  let saved = state.entries.find(row => row.id === e.id);
  assert.equal(saved.minutes,90);
  assert.equal(saved.actor,'ruben');
  await api(`/time-entries/${e.id}`,'PATCH',{...entry(p.id),minutes:45,version:saved.version});
  await api(`/time-entries/${e.id}`,'PATCH',{...entry(p.id),minutes:60,version:saved.version},409);
  saved = (await api('/workspace')).entries.find(row => row.id === e.id);
  assert.equal(saved.minutes,45);
  await api(`/time-entries/${e.id}/void`,'POST',{version:saved.version},201);
  await api(`/time-entries/${e.id}`,'PATCH',{...entry(p.id),version:saved.version+1},409);
  const logs = (await pool.query('SELECT * FROM audit_log WHERE entity_id=$1 ORDER BY at',[e.id])).rows;
  assert.equal(logs.length,3);
  assert.equal(logs[1].before_data.minutes,90);
  assert.equal(logs[1].after_data.minutes,45);
  assert.equal(logs[2].after_data.status,'void');
  // A new connection sees committed data, independent of the app's process state.
  const connection = await pool.connect();
  try { assert.equal((await connection.query('SELECT status FROM time_entries WHERE id=$1',[e.id])).rows[0].status,'void'); }
  finally { connection.release(); }
});
test('validation, archive rules, actor attribution and bulk rollback',async () => {
  const {c,p} = await setup();
  await api('/time-entries','POST',{...entry(p.id),minutes:0},400);
  await api('/time-entries','POST',{...entry(p.id),date:'2026-02-30'},400);
  await api('/time-entries','POST',{...entry(p.id),actor:'fake-agent'},400);
  const before = await api('/workspace');
  await api('/time-entries/bulk','POST',{entries:[entry(p.id),entry(randomUUID())]},400);
  const after = await api('/workspace');
  assert.equal(after.entries.length,before.entries.length);
  assert.equal(after.history.length,before.history.length);
  await api(`/customers/${c.id}`,'PATCH',{rate:125});
  await api(`/customers/${c.id}`,'PATCH',{active:false});
  await api(`/customers/${c.id}`,'PATCH',{name:'Renamed customer'});
  await api('/time-entries','POST',entry(p.id),409);
  const state = await api('/workspace');
  assert.equal(state.customers.find(row => row.id === c.id).name,'Renamed customer');
  assert.equal(state.customers.find(row => row.id === c.id).rate,125);
  assert.equal(state.customers.find(row => row.id === c.id).active,false);
  await api(`/customers/${c.id}`,'PATCH',{active:true});
  await api('/time-entries/bulk','POST',{entries:[entry(p.id),entry(p.id)]},201);
  await api('/projects','POST',{name:'Wrong customer',customerId:randomUUID()},400);
});
test('billing rejects mixed customers, locks billed entries and prevents concurrent double billing',async () => {
  const {p} = await setup();
  const {p:other} = await setup();
  const a = await api('/time-entries','POST',entry(p.id),201);
  const b = await api('/time-entries','POST',entry(other.id),201);
  const before = await api('/billing-batches');
  await api('/billing-batches','POST',{entryIds:[a.id,b.id]},400);
  assert.equal((await api('/billing-batches')).length,before.length);
  const results = await Promise.all([1,2].map(() => fetch(base+'/billing-batches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entryIds:[a.id]})})));
  assert.deepEqual(results.map(r => r.status).sort(),[201,409]);
  const saved = (await api('/workspace')).entries.find(row => row.id === a.id);
  assert.equal(saved.status,'billed');
  assert.ok(saved.billingBatchId);
  assert.equal(saved.invoice,null); // References and rates are optional.
  await api(`/time-entries/${a.id}/void`,'POST',{version:saved.version},409);
  await api(`/time-entries/${a.id}`,'PATCH',{...entry(p.id),version:saved.version},409);
  await api('/billing-batches','POST',{entryIds:[b.id],externalInvoiceReference:'EXT-001'},201);
  assert.equal((await api('/workspace')).entries.find(row => row.id === b.id).invoice,'EXT-001');
});
test('database constraints and triggers protect records outside the API',async () => {
  const {p} = await setup();
  const a = await api('/time-entries','POST',entry(p.id),201);
  await assert.rejects(pool.query('UPDATE time_entries SET minutes=0 WHERE id=$1',[a.id]),e => e.code === '23514');
  await assert.rejects(pool.query('DELETE FROM time_entries WHERE id=$1',[a.id]),/must be voided/);
  await assert.rejects(pool.query('UPDATE audit_log SET actor=$1 WHERE entity_id=$2',['fake',a.id]),/append-only/);
  await api('/billing-batches','POST',{entryIds:[a.id]},201);
  await assert.rejects(pool.query('UPDATE time_entries SET minutes=1 WHERE id=$1',[a.id]),/read-only/);
});
test('audit failure rolls back the underlying mutation',async () => {
  await pool.query(`CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$`);
  await pool.query('CREATE TRIGGER fail_audit_insert BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_audit()');
  const before = await api('/workspace');
  try {
    await api('/customers','POST',{name:'Must roll back'},503);
    assert.equal((await api('/workspace')).customers.length,before.customers.length);
  } finally { await pool.query('DROP TRIGGER fail_audit_insert ON audit_log'); }
});
test('local development API rejects cross-site requests and unknown endpoints',async () => {
  await api('/workspace','GET',undefined,403,{Origin:'https://example.com'});
  await api('/customers','POST',{name:'Cross-site'},403,{'Sec-Fetch-Site':'cross-site'});
  await api('/missing','GET',undefined,404);
  await api('/time-entries','DELETE',undefined,405);
  assert.equal((await api('/health')).database,'connected');
});
