import { MongoClient } from 'mongodb';
import { loadEnvironment } from './environment.mjs';
loadEnvironment();
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect(); const db = client.db(process.env.MONGODB_DB || 'gearharbor');
  const bookings = await db.collection('bookings').find({ paymentStatus: 'paid' }).toArray();
  for (const booking of bookings) {
    const payments = await db.collection('payments').countDocuments({ checkoutSessionId: booking.checkoutSessionId, status: 'paid' });
    const duplicates = await db.collection('bookings').countDocuments({ checkoutSessionId: booking.checkoutSessionId });
    console.log(JSON.stringify({ bookingStatus: booking.bookingStatus, amountMinor: booking.total, currency: booking.currency, paymentRecords: payments, bookingRecords: duplicates }));
    if (payments !== 1 || duplicates !== 1) process.exitCode = 1;
  }
  const totals = await db.collection('payments').aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]).toArray();
  console.log(JSON.stringify({ paidBookings: bookings.length, totalRevenueMinor: totals[0]?.amount || 0 }));
} catch { console.error('Payment verification failed. Check service configuration.'); process.exitCode = 1; }
finally { await client.close(); }
