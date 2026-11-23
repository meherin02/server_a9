import { MongoClient } from 'mongodb';
import Stripe from 'stripe';
import { loadEnvironment, inspectEnvironment } from './environment.mjs';
loadEnvironment();
const { problems, warnings } = inspectEnvironment(process.env);
for (const problem of problems) console.error(`NEEDS SETUP: ${problem}`);
for (const warning of warnings) console.log(`NOTE: ${warning}`);
if (!problems.length) console.log('Required environment configuration is present. Values have not been printed.');
if (process.argv.includes('--online')) {
  if (problems.length) console.error('Online checks skipped until configuration errors are resolved.');
  else {
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    try {
      await client.connect();
      const hello = await client.db().admin().command({ hello: 1 });
      if (!hello.setName && hello.msg !== 'isdbgrid') throw new Error('replica-set-required');
      console.log('MongoDB connected and supports transactions.');
    } catch (error) { problems.push('MongoDB connection check failed'); console.error(error.message === 'replica-set-required' ? 'MongoDB requires a replica set or sharded cluster for bookings.' : 'MongoDB check failed. Check credentials, network access, and database permissions locally.'); }
    finally { await client.close(); }
    try {
      await new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 10000, maxNetworkRetries: 0 }).checkout.sessions.list({ limit: 1 });
      console.log('Stripe test API authentication passed. No payment was created.');
    } catch { problems.push('Stripe API check failed'); console.error('Stripe test API check failed. Check the key and network connection locally.'); }
    console.log('Google consent, imgbb uploads, signed webhook delivery, vendor Connect permissions and browser sessions still require end-to-end tests.');
  }
}
process.exitCode = problems.length ? 1 : 0;
