import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { loadEnvironment } from './environment.mjs';

loadEnvironment();
const base = new URL(process.env.VERIFY_CLIENT_ORIGIN || 'https://gearharbor-client.vercel.app').origin;
const api = new URL(process.env.VERIFY_API_ORIGIN || 'https://server-a9.onrender.com').origin;
let cookie;
const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(20000) });
try {
  assert.ok(process.env.BOOTSTRAP_OWNER_EMAIL && process.env.BOOTSTRAP_OWNER_PASSWORD, 'Owner verification credentials are missing');
  const login = await request('/api/auth/sign-in/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ email: process.env.BOOTSTRAP_OWNER_EMAIL, password: process.env.BOOTSTRAP_OWNER_PASSWORD, rememberMe: false }),
  });
  assert.equal(login.status, 200, 'Owner login failed');
  cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  let userId;
  for (let pass = 0; pass < 2; pass++) {
    const response = await request('/api/auth/get-session', { headers: { Cookie: cookie, 'Cache-Control': 'no-cache' } });
    assert.equal(response.status, 200);
    const session = await response.json();
    assert.ok(session.user?.id);
    assert.equal(session.user.role, 'owner');
    if (userId) assert.equal(session.user.id, userId);
    userId = session.user.id;
  }
  console.log('Owner login and repeated uncached session requests: passed (API; browser reload is separate).');
} catch (error) {
  console.error('Owner session verification failed:', error.name === 'AssertionError' ? error.message.split('\n')[0] : error.name);
  process.exitCode = 1;
} finally {
  if (cookie) await request('/api/auth/sign-out', { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
}

try {
  assert.ok(process.env.STRIPE_WEBHOOK_SECRET, 'Local webhook secret is missing');
  // Unhandled event type exercises signature verification without creating payments or changing inventory.
  const payload = JSON.stringify({ id: `evt_local_probe_${Date.now()}`, object: 'event', type: 'gearharbor.verification', data: { object: {} }, livemode: false });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  for (const [label, header] of [['valid', signature], ['invalid', 't=1,v1=invalid']]) {
    const response = await fetch(`${api}/api/payments/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header }, body: payload, signal: AbortSignal.timeout(20000),
    });
    console.log(`Deployed webhook with ${label} signature: HTTP ${response.status}`);
    assert.equal(response.status, label === 'valid' ? 200 : 400);
  }
  console.log('Signed webhook transport passed; this is not a Stripe dashboard event delivery.');
} catch (error) {
  console.error('Webhook verification failed:', error.name === 'AssertionError' ? error.message.split('\n')[0] : error.name);
  process.exitCode = 1;
}
