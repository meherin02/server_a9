import { MongoClient } from 'mongodb';
import { createAuth } from '../src/auth.js';
import { loadEnvironment } from './environment.mjs';
loadEnvironment();
const roles = ['admin', 'owner'];
for (const role of roles) {
  const prefix = `BOOTSTRAP_${role.toUpperCase()}`;
  if (!process.env[`${prefix}_EMAIL`] || !process.env[`${prefix}_PASSWORD`]) throw new Error(`Configure ${prefix}_EMAIL and ${prefix}_PASSWORD in the local server/.env file.`);
  const password = process.env[`${prefix}_PASSWORD`];
  if (password.length < 6 || !/[A-Z]/.test(password) || !/[a-z]/.test(password)) throw new Error(`${prefix}_PASSWORD must meet registration password rules.`);
}
if (!process.env.MONGODB_URI) throw new Error('Configure MONGODB_URI first.');
if (process.env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase() === process.env.BOOTSTRAP_OWNER_EMAIL.toLowerCase()) throw new Error('Admin and Owner must use different email addresses.');
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect(); const db = client.db(process.env.MONGODB_DB || 'gearharbor'); const auth = createAuth(db);
  for (const role of roles) {
    const prefix = `BOOTSTRAP_${role.toUpperCase()}`;
    const email = process.env[`${prefix}_EMAIL`].trim().toLowerCase();
    const password = process.env[`${prefix}_PASSWORD`];
    const existing = await db.collection('user').findOne({ email });
    if (existing) {
      // Verify credentials before promoting an existing account.
      await auth.api.signInEmail({ body: { email, password } });
    } else {
      await auth.api.signUpEmail({ body: { email, password, name: role === 'admin' ? 'GearHarbor Admin' : 'Demo Equipment Owner', image: `${process.env.CLIENT_ORIGIN || 'http://localhost:3000'}/avatar.svg` } });
    }
    await db.collection('user').updateOne({ email }, { $set: { role, updatedAt: new Date() } });
    console.log(`${role === 'admin' ? 'Admin' : 'Owner'} account prepared. Credentials were not printed.`);
  }
} catch {
  console.error('Account setup failed. Check local configuration, database access, and existing-account passwords. No credentials were printed.');
  process.exitCode = 1;
} finally { await client.close(); }
