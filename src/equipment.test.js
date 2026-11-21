import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { equipmentRouter, validateEquipment } from './equipment.js';
const fixture = { name: 'Camera', description: 'A camera for filmmaking.', location: 'Dhaka', condition: 'Excellent', brand: 'Canon', model: 'R6', terms: 'Return in original condition.', category: 'Photography', rentalType: 'daily', price: 1200, quantity: 2, image: 'https://i.ibb.co/example/camera.jpg' };
test('validation rejects invalid prices, fractional quantities, categories and non-imgbb images', () => {
  for (const patch of [{ price: -1 }, { price: Infinity }, { quantity: 1.5 }, { category: 'invalid' }, { image: 'https://example.com/a.jpg' }, { name: ' ' }]) assert.throws(() => validateEquipment({ ...fixture, ...patch }));
  assert.equal(validateEquipment(fixture).price, 1200);
});
test('validation strips submitted owner and approval fields', () => {
  const result = validateEquipment({ ...fixture, ownerId: 'victim', status: 'approved' });
  assert.equal(result.ownerId, undefined); assert.equal(result.status, undefined);
});
test('owner creation, edit and deletion enforce server ownership and moderation rules', async () => {
  const writes = [];
  const collection = {
    insertOne: async item => { writes.push(item); return { insertedId: '123' }; },
    updateOne: async (filter, update) => { writes.push({ filter, update }); return { matchedCount: 1 }; },
  };
  const app = express(); app.use(express.json());
  const verifyToken = (req, _res, next) => { req.user = { _id: 'owner-1', name: 'Owner', role: req.headers['x-test-role'] || 'owner' }; next(); };
  const allow = role => (req, res, next) => req.user.role === role ? next() : res.sendStatus(403);
  app.use('/api', equipmentRouter({ collection: () => collection }, { verifyToken, verifyOwner: allow('owner'), verifyAdmin: allow('admin') }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, method, body, role) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await request('/equipment', 'POST', { ...fixture, ownerId: 'victim', status: 'approved' })).status, 201);
    assert.equal(writes[0].ownerId, 'owner-1'); assert.equal(writes[0].status, 'pending');
    const id = '123456789012345678901234';
    assert.equal((await request(`/equipment/${id}`, 'PATCH', fixture)).status, 200);
    assert.equal(writes[1].filter.ownerId, 'owner-1'); assert.equal(writes[1].update.$set.status, 'pending');
    assert.equal((await request(`/equipment/${id}`, 'DELETE')).status, 200);
    assert.equal(writes[2].filter.ownerId, 'owner-1'); assert.equal(writes[2].update.$set.archived, true);
    assert.equal((await request(`/admin/equipment/${id}/status`, 'PATCH', { status: 'approved' })).status, 403);
    assert.equal((await request('/equipment', 'POST', fixture, 'customer')).status, 403);
    assert.equal((await request('/equipment/not-an-id', 'GET')).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
