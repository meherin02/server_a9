import { Router } from 'express';
import { ObjectId } from 'mongodb';
import Stripe from 'stripe';
export function rentalPrice(item, input, now = new Date()) {
  const parse = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose valid rental dates.');
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) throw new Error('Choose valid rental dates.');
    return date;
  };
  const start = parse(input.startDate), end = parse(input.endDate);
  if (input.startDate < now.toISOString().slice(0,10) || end < start) throw new Error('Choose today or a future start, and an end on or after the start.');
  const days = Math.round((end - start) / 86400000) + 1;
  if (days > 366) throw new Error('Rentals cannot exceed 366 days.');
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) throw new Error('Choose a positive whole quantity.');
  const period = { daily: 1, weekly: 7, monthly: 30 }[item.rentalType];
  if (!period) throw new Error('Invalid equipment rental type.');
  const units = Math.ceil(days / period), unitAmount = Math.round(item.price * 100);
  const total = unitAmount * units * input.quantity;
  if (!Number.isSafeInteger(total) || total < 1 || total > 99999999) throw new Error('Rental total is outside the supported payment range.');
  return { startDate: input.startDate, endDate: input.endDate, quantity: input.quantity, days, units, unitAmount, total, currency: 'bdt' };
}
export function peakQuantity(rows, startDate, endDate) {
  const events = [];
  for (const row of rows) {
    const start = Math.max(Date.parse(row.startDate), Date.parse(startDate));
    const end = Math.min(Date.parse(row.endDate), Date.parse(endDate));
    if (start <= end) { events.push([start, row.quantity]); events.push([end + 86400000, -row.quantity]); }
  }
  const changes = new Map();
  for (const [day, value] of events) changes.set(day, (changes.get(day) || 0) + value);
  let current = 0, peak = 0;
  for (const [, change] of [...changes].sort((a,b) => a[0] - b[0])) { current += change; peak = Math.max(peak, current); }
  return peak;
}
export async function rentalIndexes(db) {
  await Promise.all([
    db.collection('favorites').createIndex({ customerId: 1, equipmentId: 1 }, { unique: true }),
    db.collection('bookings').createIndex({ checkoutSessionId: 1 }, { unique: true }),
    db.collection('payments').createIndex({ checkoutSessionId: 1 }, { unique: true }),
    db.collection('holds').createIndex({ equipmentId: 1, status: 1, startDate: 1, endDate: 1 }),
  ]);
}
export function rentalService(db, client, stripeClient) {
  const stripe = stripeClient || (process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null);
  const transaction = async work => { const session = client.startSession(); try { return await session.withTransaction(() => work(session)); } finally { await session.endSession(); } };
  async function finalize(checkout) {
    if (checkout.payment_status !== 'paid') return;
    await transaction(async session => {
      const hold = await db.collection('holds').findOne({ _id: new ObjectId(checkout.metadata.holdId) }, { session });
      if (!hold || checkout.amount_total !== hold.total || checkout.currency !== hold.currency || checkout.metadata.customerId !== hold.customerId || (hold.checkoutSessionId && hold.checkoutSessionId !== checkout.id)) throw new Error('Checkout does not match reservation.');
      if (hold.status === 'paid') return;
      if (!['reserved', 'creating'].includes(hold.status)) throw new Error('Reservation is not payable.');
      const bookingId = hold._id, paidAt = new Date();
      await db.collection('bookings').updateOne({ checkoutSessionId: checkout.id }, { $setOnInsert: { ...hold, _id: bookingId, checkoutSessionId: checkout.id, paymentStatus: 'paid', bookingStatus: 'confirmed', bookingDate: paidAt } }, { upsert: true, session });
      await db.collection('payments').updateOne({ checkoutSessionId: checkout.id }, { $setOnInsert: { bookingId: String(bookingId), checkoutSessionId: checkout.id, paymentIntentId: checkout.payment_intent, customerId: hold.customerId, ownerId: hold.ownerId, amount: hold.total, currency: hold.currency, status: 'paid', paidAt } }, { upsert: true, session });
      await db.collection('holds').updateOne({ _id: hold._id }, { $set: { status: 'paid', checkoutSessionId: checkout.id } }, { session });
    });
  }
  async function webhook(req, res) {
    if (!stripe || !db || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ message: 'Payments are not configured.' });
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
    catch { return res.status(400).json({ message: 'Invalid payment signature.' }); }
    const checkout = event.data.object;
    if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) await finalize(checkout);
    if (['checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type) && checkout.metadata?.holdId) {
      await db.collection('holds').updateOne({ _id: new ObjectId(checkout.metadata.holdId), status: { $in: ['creating', 'reserved'] } }, { $set: { status: 'expired' } });
    }
    res.json({ received: true });
  }
  function router(auth) {
    const router = Router();
    router.use(auth.verifyToken, auth.verifyRenter);
    router.get('/favorites', async (req, res) => {
      const rows = await db.collection('favorites').aggregate([
        { $match: { customerId: String(req.user._id) } },
        { $lookup: { from: 'equipment', localField: 'equipmentId', foreignField: '_id', as: 'equipment' } },
        { $unwind: { path: '$equipment', preserveNullAndEmptyArrays: true } },
      ]).toArray(); res.json(rows);
    });
    router.put('/favorites/:id', async (req, res) => {
      if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ message: 'Invalid equipment ID.' });
      const equipmentId = new ObjectId(req.params.id);
      const item = await db.collection('equipment').findOne({ _id: equipmentId, status: 'approved', archived: { $ne: true } });
      if (!item) return res.status(404).json({ message: 'Equipment is not available.' });
      try { await db.collection('favorites').updateOne({ customerId: String(req.user._id), equipmentId }, { $setOnInsert: { createdAt: new Date() } }, { upsert: true }); }
      catch (error) { if (error.code !== 11000) throw error; }
      res.json({ message: 'Saved to favorites.' });
    });
    router.delete('/favorites/:id', async (req, res) => {
      if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ message: 'Invalid equipment ID.' });
      await db.collection('favorites').deleteOne({ customerId: String(req.user._id), equipmentId: new ObjectId(req.params.id) }); res.json({ message: 'Favorite removed.' });
    });
    router.get('/rentals', async (req, res) => {
      // Recover verified payments when a webhook was delayed or the local listener was stopped.
      // The customer scope is derived from JWT identity, never from request body/email.
      if (stripe) {
        const pending = await db.collection('holds').find({ customerId: String(req.user._id), status: 'reserved', checkoutSessionId: { $type: 'string' } }).sort({ createdAt: -1 }).limit(5).toArray();
        await Promise.all(pending.map(async hold => {
          try { await finalize(await stripe.checkout.sessions.retrieve(hold.checkoutSessionId, {}, { timeout: 5000, maxNetworkRetries: 0 })); }
          catch { console.error('Payment reconciliation deferred; retry or webhook delivery is required.'); }
        }));
      }
      res.json(await db.collection('bookings').find({ customerId: String(req.user._id) }).sort({ bookingDate: -1 }).toArray());
    });
    router.post('/checkout', async (req, res) => {
      if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ message: 'Stripe Checkout and webhook settings must be configured.' });
      const body = req.body;
      if (!/^[a-f\d]{24}$/i.test(body.equipmentId)) return res.status(400).json({ message: 'Invalid equipment ID.' });
      if (typeof body.contact !== 'string' || !/^[+\d ()-]{7,25}$/.test(body.contact) || typeof body.address !== 'string' || body.address.trim().length < 5 || body.address.length > 1000 || (body.notes && (typeof body.notes !== 'string' || body.notes.length > 2000))) return res.status(400).json({ message: 'Provide a valid contact number, delivery address, and notes under 2000 characters.' });
      const holdId = new ObjectId(); let hold;
      try {
        hold = await transaction(async session => {
          const item = await db.collection('equipment').findOneAndUpdate({ _id: new ObjectId(body.equipmentId), status: 'approved', archived: { $ne: true } }, { $inc: { reservationRevision: 1 } }, { returnDocument: 'after', session });
          if (!item) throw new Error('Equipment is no longer available.');
          const price = rentalPrice(item, body);
          const rows = await db.collection('holds').find({ equipmentId: body.equipmentId, status: { $in: ['creating', 'reserved', 'paid'] }, startDate: { $lte: price.endDate }, endDate: { $gte: price.startDate } }, { session }).toArray();
          if (peakQuantity(rows, price.startDate, price.endDate) + price.quantity > item.quantity) throw new Error('Not enough equipment is available for these dates.');
          const reservation = { _id: holdId, ...price, equipmentId: body.equipmentId, equipmentName: item.name, rentalType: item.rentalType, ownerId: item.ownerId, customerId: String(req.user._id), customer: { name: req.user.name, email: req.user.email }, owner: item.owner, contact: body.contact, address: body.address.trim(), notes: body.notes || '', status: 'creating', createdAt: new Date() };
          await db.collection('holds').insertOne(reservation, { session }); return reservation;
        });
      } catch (error) {
        if (/replica set|Transaction numbers/.test(error.message)) throw error;
        if (/available|Choose|Rental|rental|quantity|dates|equipment/.test(error.message)) return res.status(409).json({ message: error.message });
        throw error;
      }
      // A failed network call retains its hold: the session may have been created by Stripe.
      let checkout;
      try { checkout = await stripe.checkout.sessions.create({ mode: 'payment', customer_email: req.user.email, expires_at: Math.floor(Date.now()/1000) + 1800, metadata: { holdId: String(holdId), customerId: hold.customerId }, line_items: [{ price_data: { currency: hold.currency, unit_amount: hold.total, product_data: { name: hold.equipmentName, description: `${hold.days} inclusive days · ${hold.quantity} item(s) · ${hold.units} billing unit(s)` } }, quantity: 1 }], success_url: `${process.env.CLIENT_ORIGIN || 'http://localhost:3000'}/payment/success?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${process.env.CLIENT_ORIGIN || 'http://localhost:3000'}/payment/cancel?equipment=${body.equipmentId}` }, { idempotencyKey: String(holdId) }); } catch (error) {
        if (['StripeInvalidRequestError', 'StripeAuthenticationError', 'StripePermissionError'].includes(error.type)) {
          await db.collection('holds').updateOne({ _id: holdId, status: 'creating' }, { $set: { status: 'failed' } });
        }
        throw error;
      }
      await db.collection('holds').updateOne({ _id: holdId, status: 'creating' }, { $set: { status: 'reserved', checkoutSessionId: checkout.id } });
      res.json({ url: checkout.url });
    });
    router.get('/payments/:sessionId', async (req, res) => {
      const booking = await db.collection('bookings').findOne({ checkoutSessionId: req.params.sessionId, customerId: String(req.user._id) });
      if (booking) return res.json({ status: 'paid', booking });
      const hold = await db.collection('holds').findOne({ checkoutSessionId: req.params.sessionId, customerId: String(req.user._id) });
      if (!hold) return res.status(404).json({ message: 'Checkout was not found for your account.' });
      if (stripe && hold.status === 'reserved') {
        await finalize(await stripe.checkout.sessions.retrieve(hold.checkoutSessionId));
        const confirmed = await db.collection('bookings').findOne({ checkoutSessionId: req.params.sessionId, customerId: String(req.user._id) });
        if (confirmed) return res.json({ status: 'paid', booking: confirmed });
      }
      res.json({ status: hold.status === 'expired' ? 'expired' : 'processing' });
    });
    return router;
  }
  return { router, webhook };
}

