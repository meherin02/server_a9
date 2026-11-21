import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import { toNodeHandler } from 'better-auth/node';
import { createAuth } from './auth.js';
import { createAuthorization } from './middleware.js';
import { equipmentRouter } from './equipment.js';
import { rentalService, rentalIndexes } from './rentals.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000', credentials: true }));
let database;
let mongoClient;
if (process.env.MONGODB_URI) {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  database = client.db(process.env.MONGODB_DB || 'gearharbor');
  mongoClient = client;
  await rentalIndexes(database);
  const auth = createAuth(database);
  app.all('/api/auth/*splat', toNodeHandler(auth));
} else {
  app.all('/api/auth/*splat', (_req, res) => res.status(503).json({ message: 'Configure MongoDB and Better Auth before signing in.' }));
}
const rentals = rentalService(database, mongoClient);
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), rentals.webhook);
app.use(express.json());
const { verifyToken, verifyRenter, verifyOwner, verifyAdmin } = createAuthorization(database);
app.get('/api/me', verifyToken, (req, res) => {
  const { _id, name, email, image, role, phone, address } = req.user;
  res.json({ id: String(_id), name, email, image, role, phone, address });
});
app.get('/api/customer/access', verifyToken, verifyRenter, (_req, res) => res.json({ role: 'customer' }));
app.get('/api/owner/access', verifyToken, verifyOwner, (_req, res) => res.json({ role: 'owner' }));
app.get('/api/admin/access', verifyToken, verifyAdmin, (_req, res) => res.json({ role: 'admin' }));
app.get('/api/health', (_req, res) => res.json({ service: 'GearHarbor API', database: database ? 'connected' : 'not configured' }));
app.get('/api/equipment', async (req, res, next) => {
  try {
    if (!database) return res.status(503).json({ message: 'Database is not configured.' });
    const query = { status: 'approved', archived: { $ne: true } };
    const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (req.query.q) query.$or = ['name', 'location', 'category'].map(field => ({ [field]: { $regex: escape(req.query.q), $options: 'i' } }));
    if (req.query.category) query.category = String(req.query.category);
    if (req.query.rentalType) query.rentalType = String(req.query.rentalType);
    if (req.query.availability === 'available') query.quantity = { $gt: 0 };
    if (req.query.minPrice || req.query.maxPrice) {
      query.price = {};
      for (const [param, operator] of [['minPrice', '$gte'], ['maxPrice', '$lte']]) {
        if (req.query[param]) {
          const value = Number(req.query[param]);
          if (!Number.isFinite(value) || value < 0) return res.status(400).json({ message: 'Invalid price range.' });
          query.price[operator] = value;
        }
      }
    }
    const limit = Math.min(48, Math.max(1, Math.floor(Number(req.query.limit) || 12)));
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    if (!Number.isFinite(page) || !Number.isFinite(limit)) return res.status(400).json({ message: 'Invalid pagination.' });
    const sort = req.query.sort === 'priceAsc' ? { price: 1, _id: 1 } : req.query.sort === 'priceDesc' ? { price: -1, _id: 1 } : { createdAt: -1, _id: 1 };
    const collection = database.collection('equipment');
    const [items, total] = await Promise.all([collection.find(query).sort(sort).skip((page - 1) * limit).limit(limit).toArray(), collection.countDocuments(query)]);
    res.json({ items, total, page, limit });
  } catch (error) { next(error); }
});
app.use('/api', equipmentRouter(database, { verifyToken, verifyOwner, verifyAdmin }));
app.use('/api/customer', rentals.router({ verifyToken, verifyRenter }));
app.use((_req, res) => res.status(404).json({ message: 'Endpoint not found.' }));
app.use((error, _req, res, _next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ message: 'Image must be smaller than 5 MB.' });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid request body.' });
  console.error(error.message); res.status(500).json({ message: 'Something went wrong. Please try again.' });
});
app.listen(process.env.PORT || 5000, () => console.log('GearHarbor API started'));
