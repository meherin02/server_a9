import { Router } from 'express';
import Stripe from 'stripe';

const origin = () => process.env.CLIENT_ORIGIN || 'http://localhost:3000';
const stripe = () => process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
function connectError(error, res) {
  if (error.type === 'StripePermissionError') {
    console.error('Stripe Connect access denied:', error.code || 'permission_denied');
    return res.status(503).json({ code: 'connect_access_required', message: 'Payout setup is unavailable until GearHarbor activates Stripe Connect on its Stripe account.' });
  }
  if (error.type === 'StripeInvalidRequestError') {
    console.error('Stripe Connect setup rejected:', error.code || 'invalid_request', error.param || '');
    return res.status(503).json({ code: 'connect_setup_required', message: 'Payout setup needs an update to the GearHarbor Stripe account. Please try again later.' });
  }
  throw error;
}
export const vendorFeePercent = () => {
  const value = Number(process.env.VENDOR_PLATFORM_FEE_PERCENT || 10);
  if (!Number.isInteger(value) || value < 1 || value > 99) throw new Error('VENDOR_PLATFORM_FEE_PERCENT must be a whole number from 1 to 99.');
  return value;
};

export function vendorRouter(db, auth) {
  const router = Router();
  router.get('/payout-country', async (_req, res) => {
    const client = stripe();
    if (!client) return res.status(503).json({ message: 'Stripe Connect is not configured.' });
    const account = await client.accounts.retrieve();
    res.set('Cache-Control', 'public, max-age=3600').json({ country: process.env.STRIPE_CONNECT_COUNTRY || account.country });
  });
  router.use(auth.verifyToken);
  router.post('/join', async (req, res) => {
    if (req.user.role === 'admin') return res.status(403).json({ message: 'Admin accounts cannot become vendors.' });
    if (req.user.role === 'owner') return res.json({ role: 'owner', message: 'Your vendor workspace is ready.' });
    const result = await db.collection('user').updateOne({ _id: req.user._id, role: 'customer', suspended: { $ne: true } }, { $set: { role: 'owner', selfServeVendor: true, updatedAt: new Date() } });
    res.status(result.modifiedCount ? 200 : 409).json({ role: 'owner', message: result.modifiedCount ? 'Your vendor workspace is ready.' : 'Account changed. Refresh and try again.' });
  });
  router.get('/status', auth.verifyOwner, async (req, res) => {
    const accountId = req.user.stripeAccountId;
    if (!accountId) return res.json({ connected: false, chargesEnabled: false, payoutsEnabled: false, platformFeePercent: vendorFeePercent() });
    const client = stripe();
    if (!client) return res.status(503).json({ message: 'Stripe Connect is not configured.' });
    const account = await client.accounts.retrieve(accountId);
    res.set('Cache-Control', 'no-store').json({ connected: true, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled, detailsSubmitted: account.details_submitted, platformFeePercent: vendorFeePercent() });
  });
  router.post('/onboard', auth.verifyOwner, async (req, res) => {
    const client = stripe();
    if (!client) return res.status(503).json({ message: 'Stripe Connect is not configured.' });
    const country = process.env.STRIPE_CONNECT_COUNTRY;
    if (country && !/^[A-Z]{2}$/.test(country)) return res.status(503).json({ message: 'STRIPE_CONNECT_COUNTRY must be a two-letter country code.' });
    let accountId = req.user.stripeAccountId;
    try {
      if (!accountId) {
        const account = await client.accounts.create({ type: 'express', ...(country ? { country } : {}), email: req.user.email, capabilities: { transfers: { requested: true }, card_payments: { requested: true } }, metadata: { userId: String(req.user._id) } }, { idempotencyKey: `vendor-${req.user._id}` });
        accountId = account.id;
        const result = await db.collection('user').updateOne({ _id: req.user._id, stripeAccountId: { $exists: false } }, { $set: { stripeAccountId: accountId, updatedAt: new Date() } });
        if (!result.modifiedCount) accountId = (await db.collection('user').findOne({ _id: req.user._id })).stripeAccountId;
      }
      const url = await client.accountLinks.create({ account: accountId, refresh_url: `${origin()}/dashboard/owner?connect=refresh`, return_url: `${origin()}/dashboard/owner?connect=return`, type: 'account_onboarding' });
      res.json({ url: url.url });
    } catch (error) {
      return connectError(error, res);
    }
  });
  router.post('/payout-dashboard', auth.verifyOwner, async (req, res) => {
    if (!req.user.stripeAccountId) return res.status(409).json({ message: 'Set up vendor payouts first.' });
    const client = stripe();
    if (!client) return res.status(503).json({ message: 'Stripe Connect is not configured.' });
    const link = await client.accounts.createLoginLink(req.user.stripeAccountId);
    res.json({ url: link.url });
  });
  return router;
}
