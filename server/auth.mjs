import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins';
import { apiKey } from '@better-auth/api-key';
import { fromNodeHeaders } from 'better-auth/node';
import { AppError } from './workspace.mjs';

export function createAuth(pool, {
  secret = process.env.BETTER_AUTH_SECRET,
  baseURL = process.env.BETTER_AUTH_URL || 'http://localhost:5173',
  trustedOrigins = process.env.NODE_ENV !== 'production' && ['localhost','127.0.0.1'].includes(new URL(baseURL).hostname)
    ? [baseURL, baseURL.replace('localhost','127.0.0.1'), baseURL.replace('127.0.0.1','localhost')]
    : [baseURL],
  provisioning = false,
} = {}) {
  if (!secret || secret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters. Run npm run auth:setup.');
  return betterAuth({
    appName: 'timenow', database: pool, secret, baseURL, trustedOrigins,
    telemetry: { enabled: false },
    logger: { disabled: true }, // Credential failures are returned without logging request bodies or keys.
    emailAndPassword: { enabled: true, disableSignUp: !provisioning, minPasswordLength: 12, maxPasswordLength: 128, autoSignIn: false },
    user: { modelName: 'auth_user' },
    account: { modelName: 'auth_account' },
    verification: { modelName: 'auth_verification' },
    session: {
      modelName: 'auth_session', expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false }, disableSessionRefresh: true,
    },
    advanced: {
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      ipAddress: { ipAddressHeaders: ['x-timenow-client-ip'] },
    },
    rateLimit: {
      enabled: true, storage: 'database', modelName: 'auth_rate_limit', window: 60, max: 100,
      customRules: { '/sign-in/username': { window: 60, max: 5 } },
    },
    plugins: [username(), apiKey({
      schema: { apikey: { modelName: 'auth_api_key' } },
      defaultPrefix: 'tn_', enableSessionForAPIKeys: false,
      rateLimit: { enabled: true, timeWindow: 60000, maxRequests: 120 },
    })],
  });
}
export async function authenticate(auth, pool, req) {
  const authorization = req.headers.authorization;
  let userId, kind;
  if (authorization !== undefined) {
    const match = /^Bearer ([A-Za-z0-9_-]{16,512})$/.exec(authorization);
    if (!match) throw new AppError(401, 'Invalid agent credentials.');
    const result = await auth.api.verifyApiKey({ body: { key: match[1] } });
    if (!result.valid || !result.key) {
      if (result.error?.code === 'RATE_LIMITED') throw new AppError(429, 'Agent request limit reached. Try again shortly.');
      throw new AppError(401, 'Invalid or expired agent key.');
    }
    userId = result.key.referenceId;
    kind = 'agent';
  } else {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new AppError(401, 'Sign in to continue.');
    userId = session.user.id;
    kind = 'human';
  }
  const { rows: [identity] } = await pool.query('SELECT user_id, actor, kind FROM auth_identities WHERE user_id=$1 AND kind=$2', [userId,kind]);
  if (!identity) throw new AppError(403, 'This account cannot access the workspace.');
  return { userId: identity.user_id, actor: identity.actor, kind: identity.kind };
}
