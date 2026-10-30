import { randomBytes } from 'node:crypto';
import { readFile, appendFile, chmod, writeFile, rename, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPool, migrate, transaction } from './db.mjs';
import { createAuth } from './auth.mjs';

export async function provisionAccounts(pool, auth, password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Use a password between 12 and 128 characters.');
  // Setup is an operator-only command. This auth instance is never mounted on HTTP.
  const context = await auth.$context;
  for (const [actor,kind,name] of [['ruben','human','Ruben'],['agent','agent','Agent']]) {
    const existing = (await pool.query('SELECT user_id FROM auth_identities WHERE actor=$1',[actor])).rows[0];
    if (existing) continue;
    let user = (await pool.query('SELECT id FROM auth_user WHERE username=$1',[actor])).rows[0];
    if (!user) {
      user = kind === 'human'
        ? (await auth.api.signUpEmail({body:{email:'ruben@timenow.invalid',name,username:actor,password}})).user
        : await context.internalAdapter.createUser({email:'agent@timenow.invalid',emailVerified:false,name,username:actor});
    }
    await pool.query('INSERT INTO auth_identities(user_id,actor,kind) VALUES($1,$2,$3)',[user.id,actor,kind]);
  }
}
export async function resetPassword(pool, auth, password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw new Error('Use a password between 12 and 128 characters.');
  const identity = (await pool.query("SELECT user_id FROM auth_identities WHERE actor='ruben'")).rows[0];
  if (!identity) throw new Error('Run auth:setup first.');
  const context = await auth.$context;
  const hash = await context.password.hash(password);
  await transaction(pool, async db => {
    const result = await db.query(`UPDATE auth_account SET password=$1,"updatedAt"=now() WHERE "userId"=$2 AND "providerId"='credential'`,[hash,identity.user_id]);
    if (result.rowCount !== 1) throw new Error('Expected one password account.');
    await db.query('DELETE FROM auth_session WHERE "userId"=$1',[identity.user_id]);
  });
}
export async function rotateAgentKey(pool, auth, save) {
  const identity = (await pool.query("SELECT user_id FROM auth_identities WHERE actor='agent'")).rows[0];
  if (!identity) throw new Error('Run auth:setup first.');
  const key = await auth.api.createApiKey({body:{userId:identity.user_id,name:'timenow-agent',expiresIn:365*24*60*60}});
  try { await save(key.key); }
  catch (error) { await pool.query('DELETE FROM auth_api_key WHERE id=$1',[key.id]); throw error; }
  await pool.query('UPDATE auth_api_key SET enabled=false WHERE "referenceId"=$1 AND id<>$2',[identity.user_id,key.id]);
  return key.id;
}
async function ensureSecret() {
  if (process.env.BETTER_AUTH_SECRET) return;
  if (process.env.NODE_ENV === 'production') throw new Error('Set BETTER_AUTH_SECRET before production provisioning.');
  const secret = randomBytes(48).toString('base64url');
  await appendFile('.env', `\nBETTER_AUTH_SECRET=${secret}\n`, {mode:0o600});
  await chmod('.env',0o600);
  process.env.BETTER_AUTH_SECRET = secret;
}
async function saveKey(key) {
  const destination = process.env.TIMENOW_AGENT_KEY_FILE || '.env.agent';
  const temporary = destination + '.tmp';
  try {
    await writeFile(temporary,`TIMENOW_AGENT_API_KEY=${key}\n`,{mode:0o600,flag:'wx'});
    await rename(temporary,destination);
  } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}
async function main() {
  const command = process.argv[2] || 'setup';
  if (!['setup','reset-password','rotate-agent-key'].includes(command)) throw new Error('Unknown setup command.');
  const passwordIndex = process.argv.indexOf('--password-file');
  if (command !== 'rotate-agent-key' && passwordIndex < 0) throw new Error('Supply --password-file with the path to a private password file.');
  const password = command === 'rotate-agent-key' ? null : await readFile(process.argv[passwordIndex+1] || '', 'utf8');
  await ensureSecret();
  const pool = createPool();
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(726463902)');
    await migrate(pool);
    const auth = createAuth(pool,{provisioning:command === 'setup'});
    if (command === 'setup') {
      await provisionAccounts(pool,auth,password);
      let keyFileExists = false;
      try { await readFile(process.env.TIMENOW_AGENT_KEY_FILE || '.env.agent'); keyFileExists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const activeKeys = await pool.query('SELECT id FROM auth_api_key WHERE enabled=true AND "expiresAt">now()');
      if (!keyFileExists || activeKeys.rowCount === 0) await rotateAgentKey(pool,auth,saveKey);
      console.log('Accounts ready: ruben (password) and agent (API key). Agent key saved to the private key file.');
    } else if (command === 'reset-password') {
      await resetPassword(pool,auth,password);
      console.log('Password updated; existing browser sessions revoked.');
    } else {
      await rotateAgentKey(pool,auth,saveKey);
      console.log('Agent key rotated in private .env.agent; previous keys revoked.');
    }
  } finally {
    await lock.query('SELECT pg_advisory_unlock(726463902)');
    lock.release(); await pool.end();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error.message?.startsWith('Use a password') ? error.message : 'Auth setup failed. Check database connectivity, configuration, and the private password file.');
  process.exitCode = 1;
});
