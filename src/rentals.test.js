import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { ObjectId } from 'mongodb';
import { rentalPrice, peakQuantity, rentalService } from './rentals.js';
const now = new Date('2026-11-21T00:00:00Z');
const input = { startDate: '2026-11-21', endDate: '2026-11-21', quantity: 2 };
test('inclusive dates, quantity, weekly and monthly rounding use minor currency units', () => {
  assert.equal(rentalPrice({ price: 12.25, rentalType: 'daily' }, input, now).total, 2450);
  const weekly = rentalPrice({ price: 100, rentalType: 'weekly' }, { ...input, endDate: '2026-11-28' }, now);
  assert.equal(weekly.days, 8); assert.equal(weekly.units, 2); assert.equal(weekly.total, 40000);
  assert.equal(rentalPrice({ price: 500, rentalType: 'monthly' }, { ...input, endDate: '2026-12-21' }, now).units, 2);
});
test('invalid dates, past dates, fractional quantities and excessive totals are rejected', () => {
  for (const patch of [{ startDate: '2026-11-20' }, { endDate: '2026-11-20' }, { endDate: '2026-02-30' }, { quantity: 0 }, { quantity: 1.5 }, { quantity: 1000000 }]) assert.throws(() => rentalPrice({ price: 100, rentalType: 'daily' }, { ...input, ...patch }, now));
});
test('availability counts peak simultaneous demand rather than summing separate rentals', () => {
  const rows = [{ startDate: '2026-11-21', endDate: '2026-11-22', quantity: 2 }, { startDate: '2026-11-23', endDate: '2026-11-24', quantity: 3 }];
  assert.equal(peakQuantity(rows, '2026-11-21', '2026-11-24'), 3);
  assert.equal(peakQuantity([...rows, { startDate: '2026-11-22', endDate: '2026-11-23', quantity: 1 }], '2026-11-21', '2026-11-24'), 4);
});
test('signed payment webhook creates one booking/payment and rejects tampered totals and signatures', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder'; process.env.STRIPE_WEBHOOK_SECRET = 'whsec_placeholder';
  const hold = { _id: new ObjectId(), customerId: 'customer-1', ownerId: 'owner-1', total: 10000, currency: 'bdt', status: 'reserved', checkoutSessionId: 'cs_test_123' };
  const bookings = [], payments = [];
  const db = { collection: name => ({
    findOne: async () => hold,
    updateOne: async (_filter, update) => {
      if (name === 'holds') Object.assign(hold, update.$set);
      if (name === 'bookings') bookings.push(update.$setOnInsert);
      if (name === 'payments') payments.push(update.$setOnInsert);
    },
  }) };
  const client = { startSession: () => ({ withTransaction: async fn => fn(), endSession: async () => {} }) };
  const service = rentalService(db, client);
  const stripe = new Stripe('sk_test_placeholder');
  const event = { type: 'checkout.session.completed', data: { object: { id: 'cs_test_123', payment_status: 'paid', amount_total: 10000, currency: 'bdt', payment_intent: 'pi_test_123', metadata: { holdId: String(hold._id), customerId: 'customer-1' } } } };
  async function send(payload, valid = true) {
    const text = JSON.stringify(payload);
    let status = 200;
    const response = { status: value => { status = value; return response; }, json: () => status };
    const header = stripe.webhooks.generateTestHeaderString({ payload: text, secret: valid ? 'whsec_placeholder' : 'incorrect' });
    await service.webhook({ body: Buffer.from(text), headers: { 'stripe-signature': header } }, response);
    return status;
  }
  assert.equal(await send(event, false), 400);
  await send(event); await send(event);
  assert.equal(bookings.length, 1); assert.equal(payments.length, 1); assert.equal(hold.status, 'paid');
  event.data.object.amount_total = 1;
  await assert.rejects(() => send(event), /does not match/);
  delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_WEBHOOK_SECRET;
});
