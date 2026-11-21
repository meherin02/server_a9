import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ObjectId } from 'mongodb';

export function createAuthorization(database) {
  const issuer = process.env.BETTER_AUTH_URL || 'http://localhost:5000';
  const jwks = createRemoteJWKSet(new URL('/api/auth/jwks', issuer));
  async function verifyToken(req, res, next) {
    if (!database) return res.status(503).json({ message: 'Authentication is not configured.' });
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return res.status(401).json({ message: 'Please sign in to continue.' });
    let payload;
    try { ({ payload } = await jwtVerify(token, jwks, { issuer, audience: issuer })); }
    catch { return res.status(401).json({ message: 'Your access token is invalid or expired.' }); }
    try {
      if (!payload.sub) return res.status(401).json({ message: 'Invalid account.' });
      const ids = [{ _id: payload.sub }];
      if (ObjectId.isValid(payload.sub)) ids.push({ _id: new ObjectId(payload.sub) });
      const user = await database.collection('user').findOne({ $or: ids });
      if (!user) return res.status(401).json({ message: 'Account no longer exists.' });
      req.user = user;
      next();
    } catch (error) { next(error); }
  }
  const allow = role => (req, res, next) => req.user?.role === role ? next() : res.status(403).json({ message: 'You do not have permission to access this resource.' });
  return { verifyToken, verifyRenter: allow('customer'), verifyOwner: allow('owner'), verifyAdmin: allow('admin') };
}
