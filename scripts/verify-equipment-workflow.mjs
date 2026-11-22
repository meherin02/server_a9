import assert from 'node:assert/strict';
import { loadEnvironment } from './environment.mjs';
loadEnvironment();
const base='https://gearharbor-client.vercel.app';
const sessions=[]; let equipmentId;
async function signIn(role){
 const key=`BOOTSTRAP_${role.toUpperCase()}`;
 const result=await fetch(`${base}/api/auth/sign-in/email`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:process.env[`${key}_EMAIL`],password:process.env[`${key}_PASSWORD`],rememberMe:false}),signal:AbortSignal.timeout(20000)});
 if(!result.ok)throw new Error(`${role} login failed`);
 const cookie=result.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');sessions.push(cookie);
 const response=await fetch(`${base}/api/auth/token`,{headers:{Origin:base,Cookie:cookie},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`${role} token retrieval failed`);
 return (await response.json()).token;
}
async function request(path,token,method='GET',body){
 const response=await fetch(`${base}/api${path}`,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error(`API request failed (${response.status}): ${path}`);
 return response.json();
}
let owner;
try{
 owner=await signIn('owner');const admin=await signIn('admin');
 const mine=await request('/owner/equipment',owner);if(!mine.length)throw new Error('An existing image is needed for the test listing');
 const name=`Acceptance check ${Date.now()}`;
 const fixture={name,description:'Temporary equipment workflow check. Automatically archived after verification.',category:'Electronics',location:'Dhaka',price:100,rentalType:'daily',quantity:0,condition:'Test fixture',brand:'Acceptance check',model:'Temporary',image:mine[0].image,terms:'Not available for rental. Verification only.'};
 equipmentId=(await request('/equipment',owner,'POST',fixture)).id;
 assert.equal((await request(`/equipment/${equipmentId}`,owner)).status,'pending');
 const catalog=()=>request(`/equipment?q=${encodeURIComponent(name)}`);
 assert.equal((await catalog()).total,0);
 await request(`/equipment/${equipmentId}`,owner,'PATCH',{...fixture,description:'Updated temporary test listing.'});
 await request(`/admin/equipment/${equipmentId}/status`,admin,'PATCH',{status:'approved'});
 assert.equal((await catalog()).total,1);
 await request(`/admin/equipment/${equipmentId}/status`,admin,'PATCH',{status:'rejected'});
 assert.equal((await catalog()).total,0);
 await request(`/equipment/${equipmentId}`,owner,'DELETE');equipmentId=null;
 for(const token of [owner,admin]){
  const profile=await request('/me',token);
  await request('/me',token,'PATCH',{name:profile.name,image:profile.image,phone:profile.phone||'',address:profile.address||''});
  assert.equal((await request('/me',token)).name,profile.name);
 }
 console.log('PASS: owner create/update; admin approve/reject; public visibility; owner archive; owner/admin profile save.');
}catch(error){console.error(error.name==='AssertionError'?'FAIL: workflow assertion failed':error.message);process.exitCode=1;}
finally{
 if(equipmentId&&owner)try{await request(`/equipment/${equipmentId}`,owner,'DELETE');console.log('Temporary equipment archived during cleanup.');}catch{console.error('Temporary equipment cleanup needs attention.');process.exitCode=1;}
 for(const cookie of sessions)await fetch(`${base}/api/auth/sign-out`,{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)}).catch(()=>{});
}
