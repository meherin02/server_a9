import { MongoClient } from 'mongodb';
import { loadEnvironment } from './environment.mjs';
loadEnvironment();
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect(); const db = client.db(process.env.MONGODB_DB || 'gearharbor');
  const fields = [['equipment', 'name'], ['holds', 'equipmentName'], ['bookings', 'equipmentName']];
  for (const [collection, field] of fields) {
    const rows = await db.collection(collection).find({ [field]: { $regex: '^\\[Demo\\]\\s*' } }, { projection: { [field]: 1 } }).toArray();
    if (rows.length) await db.collection(collection).bulkWrite(rows.map(row => ({ updateOne: { filter: { _id: row._id, [field]: row[field] }, update: { $set: { [field]: row[field].replace(/^\[Demo\]\s*/, '') } } } })));
    console.log(`${collection}: cleaned ${rows.length} product names.`);
  }
} catch { console.error('Name cleanup failed. Check database connectivity.'); process.exitCode = 1; }
finally { await client.close(); }
