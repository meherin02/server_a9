import { MongoClient } from 'mongodb';
import { loadEnvironment } from './environment.mjs';
loadEnvironment();
const source = 'https://cdn.shopify.com/s/files/1/0400/6998/8502/products/AB02-094_540x.jpg?v=1655253604';
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect(); const db = client.db(process.env.MONGODB_DB || 'gearharbor');
  const filter = { seedKey: 'gearharbor-demo-construction-extra' };
  const item = await db.collection('equipment').findOne(filter);
  if (!item) throw new Error('listing-missing');
  const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(process.env.IMGBB_API_KEY)}`, { method: 'POST', body: new URLSearchParams({ image: source }), signal: AbortSignal.timeout(30000) });
  const uploaded = await response.json();
  if (!response.ok || !uploaded.success) throw new Error('upload-failed');
  await db.collection('equipment_image_backups').insertOne({ equipmentId: item._id, image: item.image, name: item.name, savedAt: new Date() });
  await db.collection('equipment').updateOne(filter, { $set: {
    image: uploaded.data.url,
    name: 'Luxury modest evening gown',
    description: 'A full-length, long-sleeved white occasion outfit with decorative embellishment and a matching head covering. Confirm size, fit and cleaning requirements with the owner. Illustrative product photograph; this demonstration listing is not a real commercial offer.',
    imageSource: 'https://abayabuth.com/collections/luxury-abayas',
    updatedAt: new Date(),
  } });
  console.log('Updated the gown to a modest full-length outfit image. Rental price and booking records preserved.');
} catch { console.error('Gown image update failed. Check service configuration and source image availability.'); process.exitCode = 1; }
finally { await client.close(); }

