import { MongoClient, ObjectId } from 'mongodb';
import Stripe from 'stripe';
import { loadEnvironment } from './environment.mjs';
import { releaseExpiredReservations } from '../src/rentals.js';
loadEnvironment();
const client=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000});
try {
 await client.connect();const db=client.db(process.env.MONGODB_DB||'gearharbor');const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
 const rows=await db.collection('holds').find({status:{$in:['creating','reserved','paid']}}).sort({createdAt:-1}).toArray();
 if(process.argv.includes('--release-expired')) {
  for(const id of new Set(rows.map(row=>row.equipmentId))) await releaseExpiredReservations(db,stripe,id);
  console.log('Released only Stripe-verified expired unpaid reservations. Paid and unverifiable holds preserved.');
 }
 for(const row of rows){const item=await db.collection('equipment').findOne({_id:new ObjectId(row.equipmentId)});let remote=null;
 if(row.checkoutSessionId){const session=await stripe.checkout.sessions.retrieve(row.checkoutSessionId);remote={status:session.status,payment:session.payment_status};}
 console.log(JSON.stringify({name:item?.name,stock:item?.quantity,quantity:row.quantity,start:row.startDate,end:row.endDate,holdStatus:row.status,created:row.createdAt,remote}));}
}catch{console.error('Reservation inspection failed; no secrets printed.');process.exitCode=1;}finally{await client.close();}
