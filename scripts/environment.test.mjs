import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectEnvironment } from './environment.mjs';
const valid = { MONGODB_URI: 'mongodb://localhost:27017', MONGODB_DB: 'gearharbor', BETTER_AUTH_SECRET: 'x'.repeat(48), BETTER_AUTH_URL: 'http://localhost:5000', CLIENT_ORIGIN: 'http://localhost:3000', GOOGLE_CLIENT_ID: 'placeholder', GOOGLE_CLIENT_SECRET: 'placeholder', STRIPE_SECRET_KEY: 'sk_test_placeholder', STRIPE_WEBHOOK_SECRET: 'whsec_placeholder', IMGBB_API_KEY: 'placeholder' };
test('environment diagnostics accept configured development settings', () => assert.deepEqual(inspectEnvironment(valid).problems, []));
test('diagnostics reject missing credentials and do not include secret values', () => {
  const secret = 'private-value-that-must-not-be-printed';
  const result = inspectEnvironment({ BETTER_AUTH_SECRET: secret, STRIPE_SECRET_KEY: secret });
  assert.ok(result.problems.some(p => p.includes('MONGODB_URI')));
  assert.ok(!JSON.stringify(result).includes(secret));
});
test('diagnostics reject production localhost, insecure origins and live Stripe keys', () => {
  const result = inspectEnvironment({ ...valid, NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_placeholder' });
  assert.equal(result.problems.length, 3);
  assert.ok(inspectEnvironment({ ...valid, CLIENT_ORIGIN: 'https://example.com/path' }).problems.length);
});
