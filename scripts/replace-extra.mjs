import { MongoClient } from 'mongodb';
import { loadEnvironment } from './environment.mjs';
import { validateEquipment } from '../src/equipment.js';
loadEnvironment();
const products = [
  ['construction','Luxury sequined evening gown','Fashion','photo-1642447411662-59ab77473a8d',4500,'daily','Elegant floor-length occasion dress for receptions, formal evenings and photoshoots. Confirm size and fitting with the owner before booking.'],
  ['photography','Premium formal suit','Fashion','photo-1519085360753-af0119f7cbe7',3000,'daily','A tailored formal outfit for weddings, interviews and special occasions. Confirm chest, waist and trouser measurements before rental.'],
  ['vehicles','Designer-style leather handbag','Fashion','photo-1548036328-c9fa89d128fa',1800,'daily','An occasion handbag for evening events and fashion shoots. Illustrative style only; no designer-brand authenticity is claimed.'],
  ['agriculture','Aerial photography drone','Electronics','photo-1507582020474-9a35b7d455d9',5500,'daily','A camera drone rental package for outdoor creative projects. Discuss batteries, flight experience and permitted operating locations with the owner.'],
  ['electronics','Weekend camping tent','Outdoor','photo-1751570067752-1a1909609842',2800,'weekly','A camping shelter package for short outdoor trips. Confirm capacity, packed size and included accessories with the owner.'],
  ['events','Acoustic guitar','Music','photo-1510915361894-db8b60106cb1',2200,'weekly','A guitar rental for practice, acoustic sessions and small performances. Confirm tuning, case and accessories with the owner.'],
];
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS:10000 });
try {
  await client.connect(); const db=client.db(process.env.MONGODB_DB || 'gearharbor');
  const updates=[];
  for (const [oldCategory,name,category,photo,price,rentalType,description] of products) {
    const seedKey=`gearharbor-demo-${oldCategory}-extra`;
    const existing=await db.collection('equipment').findOne({seedKey});
    if (!existing) throw new Error('Expected extra listing not found.');
    if (existing.name === `${name}`) { console.log(`Already updated: ${name}`); continue; }
    if (await db.collection('holds').countDocuments({equipmentId:String(existing._id)}) || await db.collection('bookings').countDocuments({equipmentId:String(existing._id)})) throw new Error('An extra listing has rental history; replacement stopped to protect it.');
    const response=await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(process.env.IMGBB_API_KEY)}`,{method:'POST',body:new URLSearchParams({image:`https://images.unsplash.com/${photo}?auto=format&fit=crop&w=1000&q=80`}),signal:AbortSignal.timeout(30000)});
    const upload=await response.json(); if(!response.ok || !upload.success) throw new Error('Image upload failed.');
    const item=validateEquipment({name:`${name}`,category,price,rentalType,description:`${description} Demonstration listing with an illustrative photo; not a real commercial offer.`,quantity:2,location:'Dhaka, Bangladesh',condition:'Demo listing — confirm condition and fit with owner',brand:'Unbranded demonstration',model:name,image:upload.data.url,terms:'Test-mode rental only. Both rental dates are billable. Confirm sizing, accessories and collection with the owner. Return clean and undamaged; agree cleaning and care requirements before booking.'});
    updates.push({existing,item}); console.log(`Prepared: ${name}`);
  }
  const session=client.startSession();
  try { await session.withTransaction(async()=>{
    for(const {existing,item} of updates){
      await db.collection('equipment_seed_backups').updateOne({_id:existing._id},{$setOnInsert:{...existing,backedUpAt:new Date()}},{upsert:true,session});
      await db.collection('equipment').updateOne({_id:existing._id},{$set:{...item,status:'approved',updatedAt:new Date()}},{session});
    }
  }); } finally { await session.endSession(); }
  console.log(`Replaced ${updates.length} extra listings. Original six listings and rental records preserved.`);
} catch(error){console.error(error.message.includes('listing')?error.message:'Replacement failed. Check image availability and service configuration; no credentials were printed.');process.exitCode=1;}
finally{await client.close();}


