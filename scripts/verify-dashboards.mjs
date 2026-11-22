import assert from 'node:assert/strict';
import { loadEnvironment } from './environment.mjs';
loadEnvironment();
const base = new URL(process.env.BETTER_AUTH_URL || 'http://localhost:5000').origin;
const origin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
for (const role of ['owner', 'admin']) {
  let cookie;
  try {
    const prefix = `BOOTSTRAP_${role.toUpperCase()}`;
    if (!process.env[`${prefix}_EMAIL`] || !process.env[`${prefix}_PASSWORD`]) throw new Error('Missing configured account credentials');
    const login = await fetch(`${base}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ email: process.env[`${prefix}_EMAIL`], password: process.env[`${prefix}_PASSWORD`], rememberMe: false }), signal: AbortSignal.timeout(15000) });
    if (!login.ok) throw new Error('Account login failed');
    cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const response = await fetch(`${base}/api/auth/token`, { headers: { Cookie: cookie, Origin: origin }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('JWT retrieval failed');
    const { token } = await response.json();
    if (!token) throw new Error('JWT missing');
    const get = async path => {
      const result = await fetch(`${base}/api${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      if (!result.ok) throw new Error(`API check failed: ${path}`);
      return result.json();
    };
    const me = await get('/me'); assert.equal(me.role,role);
    const [analytics, rentals] = await Promise.all([get(`/${role}/analytics`),get(`/${role}/rentals`)]);
    assert.equal(analytics.bookings,rentals.length);
    assert.equal(analytics.revenue,rentals.filter(row => row.paymentStatus === 'paid').reduce((sum,row) => sum + row.total,0));
    assert.equal(analytics.monthly.length,12);
    if (role === 'owner') assert.ok(rentals.every(row => row.ownerId === me.id));
    const forbidden = await fetch(`${base}/api/${role === 'owner' ? 'admin' : 'owner'}/analytics`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(forbidden.status,403);
    console.log(JSON.stringify({ role, rentals: rentals.length, revenueMinor: analytics.revenue, monthlyPoints: analytics.monthly.length, roleIsolation: 'passed' }));
  } catch (error) { console.error(`${role} dashboard verification failed: ${error.name === 'AssertionError' ? 'data consistency assertion failed' : error.message.replace(/https?:\/\/\S+/g,'[URL]')}`); process.exitCode = 1; }
  finally {
    if (cookie) await fetch(`${base}/api/auth/sign-out`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000) }).catch(() => {});
  }
}
