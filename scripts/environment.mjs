import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { configureMongoDns } from '../src/database-dns.js';
export function loadEnvironment() {
  config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });
  configureMongoDns();
}
export function inspectEnvironment(env) {
  const problems = [], warnings = [];
  for (const key of ['MONGODB_URI', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'CLIENT_ORIGIN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'IMGBB_API_KEY']) {
    if (!env[key]?.trim()) problems.push(`${key}: missing`);
  }
  if (env.MONGODB_URI && !/^mongodb(?:\+srv)?:\/\//.test(env.MONGODB_URI)) problems.push('MONGODB_URI: must use a MongoDB connection URI');
  if (env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length < 32) problems.push('BETTER_AUTH_SECRET: needs at least 32 characters');
  for (const key of ['BETTER_AUTH_URL', 'CLIENT_ORIGIN']) {
    if (!env[key]) continue;
    try {
      const url = new URL(env[key]);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
      if (env.NODE_ENV === 'production' && (url.protocol !== 'https:' || ['localhost','127.0.0.1'].includes(url.hostname))) problems.push(`${key}: production requires a public HTTPS origin`);
    } catch { problems.push(`${key}: must be a plain HTTP(S) origin without a path or credentials`); }
  }
  if (env.STRIPE_SECRET_KEY && !/^(sk_test_|rkcs_test_)/.test(env.STRIPE_SECRET_KEY)) problems.push('STRIPE_SECRET_KEY: use a Stripe test secret while validating the assignment');
  if (env.STRIPE_SECRET_KEY?.startsWith('rkcs_test_')) warnings.push('STRIPE_SECRET_KEY: claimable sandbox restricted key cannot create vendor Connect accounts; claim the sandbox and replace it with its full test secret key');
  if (env.STRIPE_WEBHOOK_SECRET && !env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) problems.push('STRIPE_WEBHOOK_SECRET: expected a webhook signing secret');
  if (!env.MONGODB_DB) warnings.push('MONGODB_DB: defaults to gearharbor');
  if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) warnings.push('Admin bootstrap credentials are not configured');
  if (!env.BOOTSTRAP_OWNER_EMAIL || !env.BOOTSTRAP_OWNER_PASSWORD) warnings.push('Owner bootstrap credentials are not configured');
  return { problems, warnings };
}
