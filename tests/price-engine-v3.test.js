const assert=require("assert");
global.window={};
require("../app/price-engine.js");
const E=global.window.SparkorbPriceEngine;
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
assert.strictEqual(E.temporalState({validFrom:"bad"},"2026-09-30"),"invalid");assert.strictEqual(E.temporalState({validFrom:"2026-10-05",validTo:"2026-10-01"},"2026-09-30"),"invalid");assert(E.freshnessScore({date:"2026-10-01"},"2026-09-30")<.2);
{
 const xs=[{price:10,kind:"official",confidenceScore:94},{price:5,kind:"receipt",confidenceScore:88,independentProofs:2},{price:3,kind:"reference",confidenceScore:50},null];
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

{const rows=[{price:1,date:"2026-09-30",kind:"official",locationId:"other",region:"Berlin"},{price:2,date:"2026-09-30",kind:"official",locationId:"wanted",region:"Berlin"}];assert.strictEqual(E.rankObservations(rows,{today:"2026-09-30",locationId:"wanted",region:"Berlin"}).price,2);assert.strictEqual(E.locationScore({locationId:"other",region:"Berlin"},{locationId:"wanted",region:"Berlin"}),0);assert.strictEqual(E.locationScore({region:"Hamburg"},{region:"Berlin"}),0);}

{const one=E.rankObservations([{kind:"receipt",trust:100,registryTrust:100,date:"2026-09-30",price:2.99,per:"piece",proof:"solo",lat:52.54,lon:13.20}],ctx);assert.strictEqual(one.status,"observed");assert.strictEqual(E.classifyPrice(one),"observed");const two=E.rankObservations([{kind:"receipt",trust:92,date:"2026-09-30",price:2.99,per:"piece",proof:"r1",lat:52.54,lon:13.20},{kind:"receipt",trust:92,date:"2026-09-30",price:2.99,per:"piece",proof:"r2",lat:52.54,lon:13.20}],ctx);assert.strictEqual(two.status,"verified");assert.strictEqual(E.classifyPrice(two),"verified");}

{const a={kind:"receipt",proof:"42",proofActor:"u1",locationId:"s1",productId:"p1",date:"2026-09-30",price:1};assert.strictEqual(E.independentProofs([a,{...a}]),1);assert.strictEqual(E.independentProofs([a,{...a,proofActor:"u2"}]),1,"re-uploading the same proof with another actor is not independent evidence");}

{
 const base={productId:"butter-250g",store:"REWE",locationId:"store-1",per:"piece",kind:"official",price:1.49};
 assert.strictEqual(E.rankObservations([{...base,date:"2026-09-22"}],{today}),null,"older than seven days is not a current price");
 assert.strictEqual(E.rankObservations([{...base,date:"2026-09-22",priceType:"promotion",validTo:"2026-10-05"}],{today}),null,"an offer window does not renew old evidence");
 assert.strictEqual(E.rankObservations([{...base,date:"2026-09-23"}],{today}).price,1.49,"the age boundary is inclusive");
 assert.strictEqual(E.rankObservations([{...base,date:"2026-09-29"}],{today,maxAgeDays:0}),null,"a caller can demand evidence from today");
 assert.strictEqual(E.rankObservations([{...base,date:"2026-09-22"}],{today,maxAgeDays:8}).price,1.49);
 for(const maxAgeDays of [NaN,Infinity,-1])assert.strictEqual(E.rankObservations([{...base,date:"2026-09-22"}],{today,maxAgeDays}),null,"an invalid age policy cannot disable the default gate");
 for(const date of ["2026-10-01","2026-02-30","not-a-date",null])assert.strictEqual(E.rankObservations([{...base,date}],{today,maxAgeDays:10000}),null,"invalid and future dates remain ineligible even with a wide age window");
 assert.strictEqual(E.rankObservations([{...base,date:today,observedAt:"2026-09-01"}],{today}),null,"observedAt is the evidence timestamp when both dates exist");
}

{
 const base={productId:"butter-250g",store:"REWE",locationId:"store-1",date:today,per:"piece",kind:"official"};
 for(const price of [Infinity,"Infinity",NaN,-1,0])assert.strictEqual(E.rankObservations([{...base,price}],{today}),null);
 for(const priceType of ["unknown","member_only",""])assert.strictEqual(E.priceEligibility({...base,priceType},{today}).eligible,false);
 assert.strictEqual(E.rankObservations([{...base,price:1,priceType:"unknown"}],{today}),null);
 assert.strictEqual(E.classifyPrice({price:Infinity,confidenceScore:99,kind:"official"}),"unknown");
 assert.deepStrictEqual(E.basketRange([{price:Infinity},{price:2,confidenceScore:90,kind:"official"}]),{center:2,min:2,max:2});
 assert.strictEqual(E.rankObservations([{...base,price:1,truthEligible:false}],{today}),null,"sources barred from price truth cannot become current evidence");
 assert.strictEqual(E.rankObservations([{...base,price:1,currency:"USD"}],{today}),null,"a different currency is not numerically comparable to euros");
 assert.strictEqual(E.rankObservations([{...base,price:1,currency:"USD"}],{today,currency:"USD"}).price,1);
}

{
 const base={priceType:"multi_buy"};
 for(const minQuantity of [undefined,null,0,-1,1,1.5,NaN,Infinity,"not-a-number"])assert.strictEqual(E.priceEligibility({...base,minQuantity},{today,quantity:10}).eligible,false,"a minimum quantity must be known, finite and integral");
 for(const quantity of [0,-1,1.5,NaN,Infinity,"not-a-number"])assert.strictEqual(E.priceEligibility({...base,minQuantity:2},{today,quantity}).eligible,false,"the requested quantity must be a positive finite integer");
 assert.strictEqual(E.priceEligibility({...base,minQuantity:3},{today,quantity:3}).eligible,true);
 assert.strictEqual(E.priceEligibility({...base,quantityRequired:3},{today,quantity:3}).eligible,true);
 assert.strictEqual(E.priceEligibility({priceType:"loyalty"},{today,eligibility:{loyalty:"false"}}).eligible,false,"truthy text is not explicit entitlement");
}

{
 const base={productId:"butter-250g",store:"REWE",locationId:"store-1",per:"piece",currency:"EUR"};
 const newer=E.rankObservations([
  {...base,kind:"official",date:"2026-09-29",price:1.49,proof:"old-offer"},
  {...base,kind:"receipt",date:today,price:2.49,proof:"new-receipt"}
 ],{today});
 assert.strictEqual(newer.price,2.49,"a fresh evidenced price change supersedes the cheaper previous observation in the same scope");
 const evidenced=E.rankObservations([
  {...base,kind:"official",date:"2026-09-29",price:2.49,proof:"official"},
  {...base,kind:"community",date:today,price:.99}
 ],{today});
 assert.strictEqual(evidenced.price,2.49,"a newer unproven cheap claim cannot replace reliable evidence");
 const otherScope=E.rankObservations([
  {...base,kind:"official",date:today,price:2.49,proof:"official"},
  {...base,productId:"other-butter",locationId:"store-2",kind:"community",date:today,price:.99}
 ],{today});
 assert.strictEqual(otherScope.price,2.49,"unproven cheap reports in another scope cannot hide credible current evidence");
 const conflict=E.rankObservations([
  {...base,kind:"receipt",date:today,price:1.49,proof:"receipt-a"},
  {...base,kind:"receipt",date:today,price:2.49,proof:"receipt-b"}
 ],{today});
 assert.strictEqual(conflict.price,2.49,"equally strong contradictory reports do not automatically award the cheaper price");
 assert.strictEqual(conflict.conflictCount,1);
 assert.strictEqual(conflict.status,"observed");
 assert(conflict.confidenceScore<78,"unresolved current conflicts cannot be labelled verified");
 assert.strictEqual(E.classifyPrice(conflict),"observed");
 const slightConflict=E.rankObservations([
  {...base,kind:"official",date:today,price:2.49,proof:"official-a"},
  {...base,kind:"official",date:today,price:2.69,proof:"official-b"}
 ],{today});
 assert.strictEqual(slightConflict.conflictCount,1,"equally strong reports outside the agreement tolerance remain disputed");
 assert.strictEqual(slightConflict.status,"observed");
}

{
 const base={kind:"receipt",productId:"butter-250g",store:"REWE",locationId:"store-1",date:today,price:2.49,per:"piece",proof:"receipt-a"};
 for(const other of [{...base,locationId:"store-2",proof:"receipt-b"},{...base,productId:"other-product",proof:"receipt-b"},{...base,per:"kg",proof:"receipt-b"},{...base,currency:"USD",proof:"receipt-b"}]){
  const best=E.rankObservations([base,other],{today});
  assert.strictEqual(best.independentProofs,1,"a different product, store, currency or unit cannot corroborate this price");
  assert.strictEqual(best.status,"observed");
 }
 const sameStore=E.rankObservations([{...base,lat:52,lon:13},{...base,lat:52.0001,lon:13.0001,proof:"receipt-b"}],{today});
 assert.strictEqual(sameStore.independentProofs,2,"a known store id determines scope despite varying capture coordinates");
 const repeats=E.rankObservations([base,{...base,proofActor:"u1"},{...base,proofActor:"u2"}],{today});
 assert.strictEqual(repeats.independentProofs,1);
 assert.strictEqual(repeats.status,"observed");
 const hashes=E.rankObservations([{...base,proofHash:"same-file"},{...base,proof:"new-upload-id",proofActor:"u2",mediaHash:"same-file"}],{today});
 assert.strictEqual(hashes.independentProofs,1,"renaming a proof and changing its uploader cannot bypass file identity");
 assert.strictEqual(hashes.status,"observed");
 assert.strictEqual(E.independentProofs([{...base,proofHash:"one",mediaHash:"shared"},{...base,proof:"other",proofHash:"two",mediaHash:"shared"}]),1,"any shared content identity collapses reuploads even when another hash differs");
 const unproven=E.rankObservations([{...base,proof:null,source:"one"},{...base,proof:null,source:"two"},{...base,proof:null,source:"three"}],{today});
 assert.strictEqual(unproven.independentProofs,0,"reports without proof cannot earn independent-proof verification");
 assert.strictEqual(unproven.status,"observed");
}

{
 const raw={product:"Butter 250 g",store:"REWE",date:today,price:1.99,kind:"receipt",proof:"upload",proofActor:"u1",proofHash:"hash",mediaHash:"media",contentHash:"content",sourceType:"receipt",truthEligible:false,priceType:"multi_buy",minQuantity:3,quantityRequired:3,sourceHealthState:"quarantine",sourceHealthScore:90,registryTrust:95};
 const normalized=E.normalizeObservation(raw);
 for(const key of ["proofActor","proofHash","mediaHash","contentHash","sourceType","truthEligible","minQuantity","quantityRequired","sourceHealthState","sourceHealthScore","registryTrust"])assert.strictEqual(normalized[key],raw[key],key+" must survive normalization");
 assert.strictEqual(E.rankObservations([normalized],{today,quantity:3}),null);
 assert.strictEqual(E.normalizeObservation({...raw,date:null}).date,null,"normalization must not invent an observation date");
 assert(E.validateObservation({...raw,date:null}).errors.includes("date"));
 assert(E.validateObservation({...raw,date:"2026-02-30"}).errors.includes("date"));
 assert(E.validateObservation({...raw,priceType:"unknown"}).errors.includes("price_type"));
 assert(E.validateObservation({...raw,minQuantity:NaN}).errors.includes("min_quantity"));
 const known=E.normalizeObservation({product:"X",store:"REWE",date:today,price:2,kind:"official"});
 assert.strictEqual(E.sourceScore(known),E.sourceScore({kind:"official"}),"missing health metadata is not a failed source");
 assert.strictEqual(known.lat,null);assert.strictEqual(known.lon,null);
}

{
 const base={kind:"openprices",date:today,price:1.99,proof:"proof",productId:"butter",store:"REWE"},near={...base,lat:52.54,lon:13.20},far={...base,lat:53.54,lon:13.20};
 assert.strictEqual(E.rankObservations([far],ctx),null,"observed evidence beyond 50 km cannot become a local current price");
 assert.strictEqual(E.rankObservations([base],ctx),null,"Open Prices evidence needs coordinates when a user location is known");
 assert.strictEqual(E.rankObservations([near],ctx).price,1.99);
 assert.strictEqual(E.rankObservations([far],{...ctx,maxDistanceKm:80}).price,1.99,"a caller can explicitly choose a wider radius");
 assert.strictEqual(E.rankObservations([{...far,kind:"receipt"}],ctx),null);
 assert.strictEqual(E.rankObservations([{...base,kind:"official",region:"Berlin"}],ctx).price,1.99,"regional official offers remain usable without coordinate evidence");
}

console.log("price-engine-v3: ok");
