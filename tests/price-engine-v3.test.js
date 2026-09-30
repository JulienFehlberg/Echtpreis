const assert=require("assert");
global.window={};
require("../app/price-engine.js");
const E=global.window.EchtpreisPriceEngine;
assert(E&&E.VERSION==="3.5.0");

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
 assert.strictEqual(q.total,3);
 assert.strictEqual(q.known,2);
 assert.strictEqual(q.unknown,1);
 assert(Math.abs(q.coverage-2/3)<.001);
 assert.strictEqual(q.verifiedCoverage,0);
}
console.log("price-engine-v3: ok");
{
 const xs=[{price:10,kind:"official",confidenceScore:94},{price:5,kind:"receipt",confidenceScore:88},{price:3,kind:"reference",confidenceScore:50},null];
 const q=E.basketQuality(xs);assert.strictEqual(q.verified,2);assert.strictEqual(q.estimated,1);assert.strictEqual(q.unknown,1);assert.strictEqual(q.verifiedCoverage,.5);assert.strictEqual(q.coverage,.75);
 const r=E.basketRange(xs);assert(r.min<r.center&&r.max>r.center);
}

{const base={product:"X",store:"REWE",per:"piece",date:"2026-09-30",kind:"official",trust:96,proof:"p"};
 const rows=[{...base,price:3.49,priceType:"regular",proof:"r"},{...base,price:2.99,priceType:"promotion",validFrom:"2026-09-29",validTo:"2026-10-03",proof:"promo"},{...base,price:2.49,priceType:"loyalty",proof:"loyal"}];
 assert.strictEqual(E.rankObservations(rows,{today:"2026-09-30"}).price,2.99);assert.strictEqual(E.rankObservations(rows,{today:"2026-09-30",eligibility:{loyalty:true}}).price,2.49);
 assert.strictEqual(E.rankObservations([{...base,price:1.99,priceType:"promotion",validTo:"2026-09-29"},{...base,price:3.49,priceType:"regular"}],{today:"2026-09-30"}).price,3.49);
 assert.strictEqual(E.priceEligibility({...base,priceType:"app"},{today:"2026-09-30"}).eligible,false);
 assert.strictEqual(E.priceEligibility({...base,priceType:"app"},{today:"2026-09-30",eligibility:{app:true}}).eligible,true);
 assert.strictEqual(E.priceEligibility({...base,priceType:"multi_buy",minQuantity:3},{today:"2026-09-30",quantity:2}).eligible,false);
}

{const q=E.basketQuality([{price:2,confidenceScore:90,kind:"official"},null,{price:null}]);assert.strictEqual(q.total,3);assert.strictEqual(q.unknown,2);assert(Math.abs(q.coverage-1/3)<.001);assert(E.sourceScore({kind:"community",trust:100})<80);assert(E.sourceScore({kind:"community",registryTrust:90})>E.sourceScore({kind:"community"}));}

{const rows=[{price:1,date:"2026-09-30",kind:"official",sourceHealthState:"quarantine",trust:99},{price:2,date:"2026-09-30",kind:"official",sourceHealthScore:95,registryTrust:96}];assert.strictEqual(E.rankObservations(rows,{today:"2026-09-30"}).price,2);assert(E.sourceScore({kind:"official",registryTrust:96,sourceHealthScore:30})<E.sourceScore({kind:"official",registryTrust:96,sourceHealthScore:95}));}
