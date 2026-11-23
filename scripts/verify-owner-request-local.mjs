import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { loadEnvironment } from './environment.mjs';

loadEnvironment();
const base = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:5000').origin;
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('This verification runs against a local API only.');
if (!process.env.BOOTSTRAP_ADMIN_EMAIL || !process.env.BOOTSTRAP_ADMIN_PASSWORD) throw new Error('Admin test credentials are missing.');
const origin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
const email = `owner-flow-${Date.now()}-${randomBytes(4).toString('hex')}@example.com`;
const password = `TestA${randomBytes(16).toString('hex')}z`;
const client = new MongoClient(process.env.MONGODB_URI);
const cookies = [];

async function call(path, { method = 'GET', body, cookie, token } = {}) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { Origin: origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  return { response, body: await response.json().catch(() => null) };
}

async function tokenFor(cookie) {
  const result = await call('/auth/token', { cookie });
  assert.equal(result.response.status, 200, 'JWT retrieval failed');
  return result.body.token;
}

try {
  await client.connect();
  const signup = await call('/auth/sign-up/email', { method: 'POST', body: { name: 'Owner Flow Check', email, password, image: 'https://example.com/test-profile.jpg' } });
  assert.equal(signup.response.status, 200, 'Temporary Customer registration failed');
  const customerCookie = signup.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  cookies.push(customerCookie);
  const customerToken = await tokenFor(customerCookie);
  assert.equal((await call('/me', { token: customerToken })).body.role, 'customer');

  const adminLogin = await call('/auth/sign-in/email', { method: 'POST', body: { email: process.env.BOOTSTRAP_ADMIN_EMAIL, password: process.env.BOOTSTRAP_ADMIN_PASSWORD, rememberMe: false } });
  assert.equal(adminLogin.response.status, 200, 'Admin login failed');
  const adminCookie = adminLogin.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  cookies.push(adminCookie);
  const adminToken = await tokenFor(adminCookie);
  const baseline = (await call('/admin/analytics', { token: adminToken })).body.ownerRequests;

  const message = 'I want to rent out a camera and tripod in Dhaka.';
  assert.equal((await call('/customer/owner-request', { method: 'POST', token: customerToken, body: { message } })).response.status, 201);
  assert.equal((await call('/customer/owner-request', { token: customerToken })).body.status, 'pending');
  assert.equal((await call('/customer/owner-request', { method: 'POST', token: customerToken, body: { message } })).response.status, 409);
  assert.equal((await call('/admin/analytics', { token: adminToken })).body.ownerRequests, baseline + 1);
  const pending = await call('/admin/owner-requests', { token: adminToken });
  assert.equal(pending.response.status, 200);
  const applicant = pending.body.find(user => user.email === email);
  assert.ok(applicant, 'Admin did not see the pending request');
  assert.equal((await call(`/admin/owner-requests/${applicant._id}`, { method: 'PATCH', token: adminToken, body: { status: 'approved' } })).response.status, 200);
  assert.equal((await call('/me', { token: customerToken })).body.role, 'owner');
  assert.equal((await call('/owner/access', { token: customerToken })).response.status, 200);
  assert.equal((await call('/customer/access', { token: customerToken })).response.status, 403);
  assert.equal((await call('/admin/analytics', { token: adminToken })).body.ownerRequests, baseline);
  console.log('PASS: real local Customer request, Admin count/review/approval, Owner role and access checks.');
} finally {
  const db = client.db(process.env.MONGODB_DB || 'gearharbor');
  try {
    const user = await db.collection('user').findOne({ email });
    if (user) {
      const ids = [String(user._id), user._id];
      await db.collection('session').deleteMany({ userId: { $in: ids } });
      await db.collection('account').deleteMany({ userId: { $in: ids } });
      await db.collection('user').deleteOne({ _id: user._id, email });
      console.log('Temporary Customer account removed.');
    }
  } finally { await client.close(); }
  for (const cookie of cookies) await call('/auth/sign-out', { method: 'POST', cookie, body: {} }).catch(() => {});
}
