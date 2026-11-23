import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { ObjectId } from 'mongodb';
import { dashboardRouter, validateProfile, validTransition } from './dashboard.js';
test('profile updates strip authorization fields and reject invalid input', () => {
  const result = validateProfile({ name: ' Alice ', phone: '0123456789', address: 'Dhaka', image: 'https://example.com/a.jpg', role: 'admin', suspended: false, email: 'other@example.com' });
  assert.equal(result.name, 'Alice'); assert.equal(result.role, undefined); assert.equal(result.email, undefined);
  assert.throws(() => validateProfile({ ...result, name: '' }));
  assert.throws(() => validateProfile({ ...result, image: 'javascript:alert(1)' }));
});
test('rental transitions require paid bookings and enforce rental dates', () => {
  const now = new Date('2026-11-21T12:00:00Z');
  const booking = { paymentStatus: 'paid', bookingStatus: 'confirmed', startDate: '2026-11-21', endDate: '2026-11-21' };
  assert.equal(validTransition(booking, 'active', now), true);
  assert.equal(validTransition(booking, 'completed', now), false);
  assert.equal(validTransition({ ...booking, endDate: '2026-11-20' }, 'completed', now), true);
  assert.equal(validTransition({ ...booking, paymentStatus: 'unpaid' }, 'active', now), false);
  assert.equal(validTransition({ ...booking, bookingStatus: 'completed' }, 'active', now), false);
});
test('rental reads and changes remain scoped to owners and user management requires admin', async () => {
  const seen = [];
  const db = { collection: () => ({
    find: filter => { seen.push(filter); return { sort: () => ({ toArray: async () => [] }) }; },
    findOne: async filter => { seen.push(filter); return null; },
  }) };
  const app = express(); app.use(express.json());
  const verifyToken = (req,_res,next) => { req.user = { _id: 'owner-1', role: 'owner' }; next(); };
  const verifyOwner = (_req,_res,next) => next();
  const verifyAdmin = (_req,res) => res.sendStatus(403);
  const verifyRenter = (_req,res) => res.sendStatus(403);
  app.use('/api', dashboardRouter(db, { verifyToken, verifyOwner, verifyAdmin, verifyRenter }));
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.equal((await fetch(`${base}/owner/rentals`)).status, 200); assert.equal(seen[0].ownerId, 'owner-1');
    assert.equal((await fetch(`${base}/owner/rentals/123456789012345678901234/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) })).status, 404);
    assert.equal(seen[1].ownerId, 'owner-1');
    assert.equal((await fetch(`${base}/admin/users`)).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('customer owner requests reach admin and approval changes the account role', async () => {
  const customer = { _id: new ObjectId(), name: 'Asha', email: 'asha@example.com', role: 'customer' };
  const db = { collection: () => ({
    updateOne: async (filter, update) => {
      if (String(filter._id) !== String(customer._id) || customer.role !== filter.role || (filter['ownerRequest.status']?.$ne && customer.ownerRequest?.status === filter['ownerRequest.status'].$ne) || (typeof filter['ownerRequest.status'] === 'string' && customer.ownerRequest?.status !== filter['ownerRequest.status'])) return { matchedCount: 0 };
      for (const [key, value] of Object.entries(update.$set)) {
        if (key.startsWith('ownerRequest.')) customer.ownerRequest[key.slice(13)] = value;
        else customer[key] = value;
      }
      return { matchedCount: 1 };
    },
    find: () => ({ sort: () => ({ toArray: async () => customer.ownerRequest?.status === 'pending' && customer.role === 'customer' ? [customer] : [] }) }),
  }) };
  const app = express(); app.use(express.json());
  const verifyToken = (req,_res,next) => { req.user = req.headers['x-role'] === 'admin' ? { _id: new ObjectId(), role: 'admin' } : customer; next(); };
  const allow = role => (req,res,next) => req.user.role === role ? next() : res.sendStatus(403);
  app.use('/api', dashboardRouter(db, { verifyToken, verifyRenter: allow('customer'), verifyOwner: allow('owner'), verifyAdmin: allow('admin') }));
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const json = (path, method, body, role = 'customer') => fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-role': role }, body: body && JSON.stringify(body) });
  try {
    assert.equal((await json('/customer/owner-request', 'POST', { message: 'I have a well-maintained camera in Dhaka.' })).status, 201);
    assert.equal((await json('/customer/owner-request', 'POST', { message: 'Another camera I would like to list.' })).status, 409);
    const pending = await (await json('/admin/owner-requests', 'GET', null, 'admin')).json();
    assert.equal(pending.length, 1);
    assert.equal((await json(`/admin/owner-requests/${customer._id}`, 'PATCH', { status: 'rejected' }, 'admin')).status, 200);
    assert.equal(customer.role, 'customer');
    assert.equal((await json('/customer/owner-request', 'POST', { message: 'I have a camera and tripod available in Dhaka.' })).status, 201);
    assert.equal((await json(`/admin/owner-requests/${customer._id}`, 'PATCH', { status: 'approved' }, 'admin')).status, 200);
    assert.equal(customer.role, 'owner');
    assert.equal(customer.ownerRequest.status, 'approved');
    assert.equal((await json('/admin/owner-requests', 'GET', null, 'admin')).status, 200);
    assert.equal((await json('/customer/owner-request', 'GET')).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
