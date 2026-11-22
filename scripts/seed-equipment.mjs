import { MongoClient } from 'mongodb';
import { loadEnvironment } from './environment.mjs';
import { validateEquipment } from '../src/equipment.js';
loadEnvironment();
if (!process.env.MONGODB_URI || !process.env.IMGBB_API_KEY || !process.env.BOOTSTRAP_OWNER_EMAIL) throw new Error('Configure MongoDB, imgbb, and the bootstrap Owner email first.');
const extra = process.argv.includes('--extra');
const examples = extra ? [
  ['Construction', 'Workshop power tool bundle', 'photo-1504148455328-c376907d081c', 4200, 'weekly'],
  ['Photography', 'Weekend filmmaking camera', 'photo-1516035069371-29a1b244cc32', 2400, 'daily'],
  ['Vehicles', 'Commuter bicycle rental', 'photo-1485965120184-e220f721d03e', 5500, 'monthly'],
  ['Agriculture', 'Home gardening starter kit', 'photo-1416879595882-3373a0480b5b', 1600, 'weekly'],
  ['Electronics', 'Remote work laptop package', 'photo-1496181133206-80ce9b88a853', 18000, 'monthly'],
  ['Events', 'Live performance audio package', 'photo-1493225457124-a3eb161ffa5f', 3200, 'daily'],
] : [
  ['Construction', 'Concrete drill kit', 'photo-1504148455328-c376907d081c', 850],
  ['Photography', 'Professional camera kit', 'photo-1516035069371-29a1b244cc32', 1800],
  ['Vehicles', 'City bicycle', 'photo-1485965120184-e220f721d03e', 650],
  ['Agriculture', 'Garden tool set', 'photo-1416879595882-3373a0480b5b', 450],
  ['Electronics', 'Laptop workstation', 'photo-1496181133206-80ce9b88a853', 1500],
  ['Events', 'Portable sound setup', 'photo-1493225457124-a3eb161ffa5f', 2200],
];
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect(); const db = client.db(process.env.MONGODB_DB || 'gearharbor');
  const owner = await db.collection('user').findOne({ email: process.env.BOOTSTRAP_OWNER_EMAIL.trim().toLowerCase(), role: 'owner' });
  if (!owner) throw new Error('owner-missing');
  await db.collection('equipment').createIndex({ seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $type: 'string' } } });
  for (const [category, name, photo, price, rentalType = 'daily'] of examples) {
    const seedKey = `gearharbor-demo-${category.toLowerCase()}${extra ? '-extra' : ''}`;
    if (await db.collection('equipment').findOne({ seedKey })) { console.log(`Preserved existing ${category} example.`); continue; }
    const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(process.env.IMGBB_API_KEY)}`, { method: 'POST', body: new URLSearchParams({ image: `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=1000&q=80` }), signal: AbortSignal.timeout(30000) });
    const uploaded = await response.json();
    if (!response.ok || !uploaded.success) throw new Error('upload-failed');
    const item = validateEquipment({ name: `${name}`, description: `Sample ${category.toLowerCase()} listing for assignment demonstrations. The image is illustrative; this is not an offer of real equipment. Replace with a verified owner's real equipment before public commercial use.`, category, location: 'Dhaka, Bangladesh', price, rentalType, quantity: 3, condition: 'Demo listing — inspect actual equipment before rental', brand: 'Demonstration', model: 'Sample model', image: uploaded.data.url, terms: 'Demonstration rental only. Both rental dates are billable. Coordinate collection and return with the owner. Use Stripe test mode for assignment testing.' });
    const now = new Date();
    await db.collection('equipment').updateOne({ seedKey }, { $setOnInsert: { ...item, seedKey, ownerId: String(owner._id), owner: { name: owner.name, email: owner.email, image: owner.image }, status: 'approved', createdAt: now, updatedAt: now } }, { upsert: true });
    console.log(`Created ${category} demo listing.`);
  }
  console.log('Demo seeding finished. Existing listings, bookings and payments were not modified.');
} catch (error) {
  console.error(error.message === 'owner-missing' ? 'Run account bootstrap first; the configured Owner account was not found.' : 'Seeding failed. Check database access, imgbb configuration, and network access. Rerunning preserves records already created.');
  process.exitCode = 1;
} finally { await client.close(); }


