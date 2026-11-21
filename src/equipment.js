import { Router, raw } from 'express';
import { ObjectId } from 'mongodb';
export const categories = ['Construction', 'Photography', 'Vehicles', 'Agriculture', 'Electronics', 'Events'];
export function validateEquipment(body) {
  const item = {};
  for (const field of ['name', 'description', 'location', 'condition', 'brand', 'model', 'terms']) {
    if (typeof body[field] !== 'string' || !body[field].trim() || body[field].length > 5000) throw new Error(`Please provide a valid ${field}.`);
    item[field] = body[field].trim();
  }
  if (!categories.includes(body.category)) throw new Error('Choose a valid category.');
  if (!['daily', 'weekly', 'monthly'].includes(body.rentalType)) throw new Error('Choose a valid rental type.');
  if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price <= 0) throw new Error('Price must be greater than zero.');
  if (!Number.isSafeInteger(body.quantity) || body.quantity < 0) throw new Error('Quantity must be a nonnegative integer.');
  const image = new URL(body.image);
  if (image.protocol !== 'https:' || !['i.ibb.co', 'i.ibb.co.com'].includes(image.hostname)) throw new Error('Upload an equipment image using imgbb.');
  return { ...item, category: body.category, rentalType: body.rentalType, price: body.price, quantity: body.quantity, image: image.href };
}
export function equipmentRouter(database, auth) {
  const router = Router();
  router.use((_req, res, next) => database ? next() : res.status(503).json({ message: 'Configure MongoDB to access equipment.' }));
  const collection = () => database.collection('equipment');
  router.get('/owner/equipment', auth.verifyToken, auth.verifyOwner, async (req, res) => res.json(await collection().find({ ownerId: String(req.user._id), archived: { $ne: true } }).sort({ createdAt: -1 }).toArray()));
  router.get('/admin/equipment', auth.verifyToken, auth.verifyAdmin, async (_req, res) => res.json(await collection().find({ archived: { $ne: true } }).sort({ createdAt: -1 }).toArray()));
  router.post('/uploads', auth.verifyToken, (req, res, next) => ['owner', 'admin'].includes(req.user.role) ? next() : res.status(403).json({ message: 'Permission denied.' }), raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), async (req, res) => {
    if (!process.env.IMGBB_API_KEY) return res.status(503).json({ message: 'Configure the server imgbb key to upload images.' });
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || !bytes.length) return res.status(400).json({ message: 'Choose an image.' });
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const webp = bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
    if (!jpeg && !png && !webp) return res.status(400).json({ message: 'Choose a JPEG, PNG, or WebP image.' });
    const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(process.env.IMGBB_API_KEY)}`, { method: 'POST', body: new URLSearchParams({ image: bytes.toString('base64') }), signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok || !result.success) return res.status(502).json({ message: 'Image upload failed.' });
    res.status(201).json({ url: result.data.url });
  });
  router.post('/equipment', auth.verifyToken, auth.verifyOwner, async (req, res) => {
    let item;
    try { item = validateEquipment(req.body); } catch (error) { return res.status(400).json({ message: error.message }); }
    const now = new Date();
    const result = await collection().insertOne({ ...item, ownerId: String(req.user._id), owner: { name: req.user.name, email: req.user.email, image: req.user.image }, status: 'pending', createdAt: now, updatedAt: now });
    res.status(201).json({ id: String(result.insertedId) });
  });
  router.param('id', (req, res, next, id) => {
    if (!/^[a-f\d]{24}$/i.test(id)) return res.status(400).json({ message: 'Invalid equipment ID.' });
    req.equipmentId = new ObjectId(id); next();
  });
  router.get('/equipment/:id', auth.verifyToken, async (req, res) => {
    const item = await collection().findOne({ _id: req.equipmentId, archived: { $ne: true } });
    if (!item || (item.status !== 'approved' && item.ownerId !== String(req.user._id) && req.user.role !== 'admin')) return res.status(404).json({ message: 'Equipment not found.' });
    res.json(item);
  });
  router.patch('/equipment/:id', auth.verifyToken, async (req, res) => {
    if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ message: 'Permission denied.' });
    let item;
    try { item = validateEquipment(req.body); } catch (error) { return res.status(400).json({ message: error.message }); }
    const result = await collection().updateOne({ _id: req.equipmentId, archived: { $ne: true }, ...(req.user.role === 'owner' ? { ownerId: String(req.user._id) } : {}) }, { $set: { ...item, ...(req.user.role === 'owner' ? { status: 'pending' } : {}), updatedAt: new Date() } });
    res.status(result.matchedCount ? 200 : 404).json({ message: result.matchedCount ? 'Equipment updated.' : 'Equipment not found.' });
  });
  router.patch('/admin/equipment/:id/status', auth.verifyToken, auth.verifyAdmin, async (req, res) => {
    if (!['approved', 'rejected'].includes(req.body.status)) return res.status(400).json({ message: 'Choose approved or rejected.' });
    const result = await collection().updateOne({ _id: req.equipmentId, archived: { $ne: true } }, { $set: { status: req.body.status, updatedAt: new Date() } });
    res.status(result.matchedCount ? 200 : 404).json({ message: result.matchedCount ? 'Moderation saved.' : 'Equipment not found.' });
  });
  router.delete('/equipment/:id', auth.verifyToken, async (req, res) => {
    if (!['owner', 'admin'].includes(req.user.role)) return res.status(403).json({ message: 'Permission denied.' });
    const result = await collection().updateOne({ _id: req.equipmentId, archived: { $ne: true }, ...(req.user.role === 'owner' ? { ownerId: String(req.user._id) } : {}) }, { $set: { archived: true, updatedAt: new Date() } });
    res.status(result.matchedCount ? 200 : 404).json({ message: result.matchedCount ? 'Equipment removed.' : 'Equipment not found.' });
  });
  return router;
}
