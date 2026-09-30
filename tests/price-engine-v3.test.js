const assert=require("assert");
global.window={};
require("../app/price-engine.js");
const E=global.window.EchtpreisPriceEngine;
assert(E&&E.VERSION==="3.0.0");

const today="2026-09-30";
const ctx={today,lat:52.54,lon:13.20,distanceKm:(a,b,c,d)=>Math.hypot((a-c)*70,(b-d)*45)};

{
 const rows=[
  {kind:"official",trust:100,date:"2026-09-20",price:3.29,per:"piece",source:"retailer",region:"Berlin"},
  {kind:"receipt",trust:92,date:"2026-09-30",price:2.99,per:"piece",proof:"r1",lat:52.54,lon:13.20},
  {kind:"receipt",trust:92,date:"2026-09-30",price:2.99,per:"piece",proof:"r2",lat:52.54,lon:13.20}
 ];
 const best=E.rankObservations(rows,ctx);
 assert.strictEqual(best.price,2.99,"two fresh independent receipts should beat a stale conflicting observation");
 assert(best.independentProofs>=2);
 assert(best.confidenceScore>=78);
}
{
 const rows=[
  {kind:"openprices",trust:75,date:"2026-09-30",price:1.19,per:"piece",proof:"op1",lat:52.54,lon:13.20},
  {kind:"community",trust:60,date:"2026-09-30",price:1.19,per:"piece",proof:"c1",lat:52.54,lon:13.20}
 ];
 const best=E.rankObservations(rows,ctx);
 assert.strictEqual(best.price,1.19);
 assert.strictEqual(best.independentProofs,2);
}
{
 const consistent=E.rankObservations([
  {kind:"receipt",trust:92,date:"2026-09-30",price:2.99,per:"piece",proof:"a",lat:52.54,lon:13.20},
  {kind:"receipt",trust:92,date:"2026-09-30",price:2.99,per:"piece",proof:"b",lat:52.54,lon:13.20}
 ],ctx);
 const conflict=E.rankObservations([
  {kind:"receipt",trust:92,date:"2026-09-30",price:2.99,per:"piece",proof:"a",lat:52.54,lon:13.20},
  {kind:"receipt",trust:92,date:"2026-09-30",price:4.49,per:"piece",proof:"b",lat:52.54,lon:13.20}
 ],ctx);
 assert(consistent.confidenceScore>conflict.confidenceScore,"conflicting evidence must reduce confidence");
}
{
 const q=E.basketQuality([{price:1,confidenceScore:90},{price:2,confidenceScore:70},null]);
 assert.strictEqual(q.total,2);
 assert.strictEqual(q.known,2);
 assert.strictEqual(q.verifiedCoverage,.5);
}
console.log("price-engine-v3: ok");