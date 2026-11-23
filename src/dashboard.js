import { Router } from 'express';
import { ObjectId } from 'mongodb';
export function validateProfile(body) {
  const result = {};
  for (const [key, max] of [['name',100], ['phone',25], ['address',1000]]) {
    if (typeof body[key] !== 'string' || body[key].length > max || (key === 'name' && !body[key].trim())) throw new Error(`Provide a valid ${key}.`);
    result[key] = body[key].trim();
  }
  try { const url = new URL(body.image); if (!['https:', 'http:'].includes(url.protocol)) throw new Error(); result.image = url.href; }
  catch { throw new Error('Provide a valid profile image URL.'); }
  return result;
}
export function validTransition(booking, target, now = new Date()) {
  const today = now.toISOString().slice(0,10);
  if (booking.paymentStatus !== 'paid') return false;
  if (target === 'active') return booking.bookingStatus === 'confirmed' && booking.startDate <= today;
  if (target === 'completed') return ['confirmed','active'].includes(booking.bookingStatus) && booking.endDate < today;
  return false;
}
export function dashboardRouter(db, auth) {
  const router = Router();
  router.use(auth.verifyToken);
  router.patch('/me', async (req, res) => {
    let update;
    try { update = validateProfile(req.body); } catch (error) { return res.status(400).json({ message: error.message }); }
    await db.collection('user').updateOne({ _id: req.user._id }, { $set: { ...update, updatedAt: new Date() } });
    res.json({ message: 'Profile updated.' });
  });
  for (const role of ['owner','admin']) {
    const guard = role === 'owner' ? auth.verifyOwner : auth.verifyAdmin;
    router.get(`/${role}/rentals`, guard, async (req,res) => {
      res.json(await db.collection('bookings').find(role === 'owner' ? { ownerId: String(req.user._id) } : {}).sort({ bookingDate: -1 }).toArray());
    });
    router.patch(`/${role}/rentals/:id/status`, guard, async (req,res) => {
      if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ message: 'Invalid rental ID.' });
      const filter = { _id: new ObjectId(req.params.id), ...(role === 'owner' ? { ownerId: String(req.user._id) } : {}) };
      const booking = await db.collection('bookings').findOne(filter);
      if (!booking) return res.status(404).json({ message: 'Rental not found.' });
      if (!validTransition(booking, req.body.status)) return res.status(409).json({ message: 'A paid rental can start on its start date and complete after its end date.' });
      const result = await db.collection('bookings').updateOne({ ...filter, bookingStatus: booking.bookingStatus }, { $set: { bookingStatus: req.body.status, updatedAt: new Date() } });
      res.status(result.modifiedCount ? 200 : 409).json({ message: result.modifiedCount ? 'Rental status updated.' : 'Rental changed. Refresh and try again.' });
    });
    router.get(`/${role}/analytics`, guard, async (req,res) => {
      const owner = role === 'owner'; const filter = owner ? { ownerId: String(req.user._id) } : {};
      const since = new Date(); since.setUTCDate(1); since.setUTCHours(0,0,0,0); since.setUTCMonth(since.getUTCMonth()-11);
      const [equipment, completed, bookings, pending, users, revenue, monthlyBookings, monthlyEarnings] = await Promise.all([
        db.collection('equipment').countDocuments({ ...filter, archived: { $ne: true } }),
        db.collection('bookings').countDocuments({ ...filter, bookingStatus: 'completed' }),
        db.collection('bookings').countDocuments(filter),
        db.collection('equipment').countDocuments({ ...filter, archived: { $ne: true }, status: 'pending' }),
        owner ? 0 : db.collection('user').countDocuments({}),
        db.collection('payments').aggregate([{ $match: { ...filter, status: 'paid' } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]).toArray(),
        db.collection('bookings').aggregate([{ $match: { ...filter, bookingDate: { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$bookingDate', timezone: 'UTC' } }, value: { $sum: 1 } } }]).toArray(),
        db.collection('payments').aggregate([{ $match: { ...filter, status: 'paid', paidAt: { $gte: since } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$paidAt', timezone: 'UTC' } }, value: { $sum: '$amount' } } }]).toArray(),
      ]);
      const monthly = Array.from({ length: 12 }, (_, i) => { const date = new Date(since); date.setUTCMonth(date.getUTCMonth()+i); const month = date.toISOString().slice(0,7); return { month, bookings: monthlyBookings.find(r => r._id === month)?.value || 0, earnings: monthlyEarnings.find(r => r._id === month)?.value || 0 }; });
      res.json({ equipment, completed, bookings, pending, users, revenue: revenue[0]?.amount || 0, monthly });
    });
  }
  router.get('/admin/users', auth.verifyAdmin, async (_req,res) => res.json(await db.collection('user').find({}, { projection: { name: 1, email: 1, role: 1, createdAt: 1, suspended: 1 } }).sort({ createdAt: -1 }).toArray()));
  router.patch('/admin/users/:id', auth.verifyAdmin, async (req,res) => {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ message: 'Invalid user ID.' });
    if (req.params.id === String(req.user._id)) return res.status(409).json({ message: 'You cannot change your own administrative access.' });
    const update = {};
    if (req.body.role !== undefined) { if (!['customer','owner','admin'].includes(req.body.role)) return res.status(400).json({ message: 'Choose a valid role.' }); update.role = req.body.role; }
    if (req.body.suspended !== undefined) { if (typeof req.body.suspended !== 'boolean') return res.status(400).json({ message: 'Invalid account status.' }); update.suspended = req.body.suspended; }
    if (!Object.keys(update).length) return res.status(400).json({ message: 'No account changes provided.' });
    const result = await db.collection('user').updateOne({ _id: new ObjectId(req.params.id) }, { $set: { ...update, updatedAt: new Date() } });
    res.status(result.matchedCount ? 200 : 404).json({ message: result.matchedCount ? 'Account updated.' : 'User not found.' });
  });
  return router;
}
