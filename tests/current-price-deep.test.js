"use strict";
const assert=require("assert"),R=require("../current-price-resolver"),T=require("../current-price-truth");
const today="2026-09-30",ctx={today,storeId:"s"},query={name:"Butter 250 g",brand:"Marke",pack:"250 g"};
const base={merchant:"REWE",storeId:"s",productId:"p",product:query.name,brand:query.brand,pack:query.pack,price:2.49,priceType:"regular",sourceType:"official_retailer",observedAt:today,proof:"original"};
const resolve=(rows,options={})=>R.resolveMerchant(query,"REWE",rows,{...ctx,...options});

// Identical bytes cannot claim two checkout prices, including tiny OCR differences.
{
 const a={...base,proofHash:"same-image"},b={...a,price:2.50,proof:"second-import"};
 for(const rows of [[a,b],[b,a]]){const truth=T.fuse(rows);assert.strictEqual(truth.state,"conflict");assert.strictEqual(truth.reason,"contradictory-proof");assert.strictEqual(truth.price,null);assert.strictEqual(resolve(rows).state,"unknown");}
 const lowerAuthority={...b,sourceType:"receipt"};assert.strictEqual(resolve([a,lowerAuthority]).state,"unknown","authority cannot erase a contradictory reading of identical bytes");
 const promotion={...a,price:1.99,priceType:"promotion"};assert.strictEqual(resolve([a,promotion]).payablePrice,1.99,"one photo may legitimately show separate regular and promotion prices");
 const duplicate=T.fuse([a,{...a,proof:"other-upload"}]);assert.strictEqual(duplicate.independentEvidence,1);
}

// Source labels and unbounded trust values cannot elevate a known secondary source.
{
 const spoofed={...base,source:"Open Prices",sourceType:"pos_feed",registryTrust:10000};
 assert.strictEqual(T.sourceType(spoofed),"open_data");assert.strictEqual(T.truthTier(spoofed),3);assert.strictEqual(T.base(spoofed),.78);
 const result=resolve([spoofed]);assert.strictEqual(result.state,"observed");assert.strictEqual(result.priceAuthority,"observed-evidence");
 const pos={...base,sourceType:"pos_feed",price:3.99,proof:"pos"},crowd=Array.from({length:20},(_,i)=>({...base,sourceType:"receipt",price:2.49,proof:"crowd-"+i}));
 assert.strictEqual(T.fuse([pos,...crowd]).price,3.99,"many lower-authority observations cannot outvote a current POS fact");
 const nearPos={...pos,price:2.50},nearCrowd=crowd.slice(0,3);assert.strictEqual(T.fuse([nearPos,...nearCrowd]).price,2.50,"the representative must retain POS authority even inside a tolerance cluster");assert.strictEqual(T.fuse([...nearCrowd,nearPos]).price,2.50);
 assert.strictEqual(T.base({...base,registryTrust:0}),0);
}

// Invalid age policies never turn historical or invalid data into current evidence.
{
 const stale={...base,observedAt:"2026-08-01"};
 for(const maxAgeDays of [NaN,Infinity,-1])assert.strictEqual(resolve([stale],{maxAgeDays}).state,"unknown");
 assert.strictEqual(resolve([{...base,observedAt:"2026-09-29"}],{maxAgeDays:0}).state,"unknown");
 assert.strictEqual(resolve([{...base,source:"Open Prices",sourceType:"pos_feed",observedAt:"2026-09-22"}],{maxAgeDays:30}).state,"unknown","a misleading type cannot bypass the seven-day open-data gate");
 assert(Number.isFinite(resolve([{...base,sourceHealthScore:NaN}]).confidence));
 for(const observedAt of ["2026-10-01","not-a-date",new Date("invalid")])assert.strictEqual(resolve([{...base,observedAt}],{maxAgeDays:10000}).state,"unknown");
}

// EUR is the default comparison currency; no implicit conversion is performed.
{
 const dollar={...base,price:.99,currency:"USD"};assert.strictEqual(resolve([dollar]).state,"unknown");assert.strictEqual(resolve([dollar,base]).payablePrice,2.49);
 assert.strictEqual(T.fuse([dollar]).state,"unknown");assert.strictEqual(T.fuse([dollar,base]).price,2.49);
}

// Canonical, external and regional scopes retain separate identities.
{
 assert.notStrictEqual(T.scope({storeId:"Berlin"}),T.scope({region:"Berlin"}));
 assert.notStrictEqual(T.scope({externalLocationId:"12",sourceId:"a"}),T.scope({externalLocationId:"12",sourceId:"b"}));
 assert.strictEqual(T.fuse([base,{...base,storeId:"other",proof:"other"}]).state,"unknown","different stores cannot form a consensus");
 assert.strictEqual(T.fuse([base,{...base,productId:"other",proof:"other"}]).state,"unknown","different products cannot form a consensus");
 assert.strictEqual(T.fuse([base,{...base,priceType:"promotion",proof:"promotion"}]).state,"unknown","different price terms cannot form a consensus");
 const region=R.resolveMerchant(query,"REWE",[{...base,sourceType:"open_data"},{...base,storeId:"other",sourceType:"open_data",proof:"other"}],{today});
 assert.strictEqual(region.truth.independentEvidence,1);assert.strictEqual(region.state,"observed");
}

// A supplied product ID cannot merge explicit barcode or package contradictions.
{
 const a={...base,sourceType:"open_data",gtin:"4000000000013"},b={...a,gtin:"4000000000020",proof:"other-barcode"};
 assert.notStrictEqual(R.identityKey(a),R.identityKey(b));assert.notStrictEqual(T.productScope(a),T.productScope(b));
 const result=resolve([a,b]);assert.strictEqual(result.truth.independentEvidence,1);assert.strictEqual(result.state,"observed");
 assert.notStrictEqual(R.identityKey(base),R.identityKey({...base,pack:"500 g"}));
 const multipack={name:"Cola",brand:"Marke",pack:"6x330 ml"},single={product:"Cola",brand:"Marke",pack:"1980 ml"};assert.strictEqual(R.identity(multipack,single).usable,false,"equal total volume does not make a single bottle the requested six-pack");assert.strictEqual(R.identity(multipack,{...single,pack:"6x0.33 l"}).usable,true,"equivalent units preserve an identical pack composition");
 assert.notStrictEqual(R.identityKey({...base,pack:multipack.pack}),R.identityKey({...base,pack:single.pack}),"a reused product ID cannot fuse different package compositions");
}

// First-party uploads remain observed until identity and proof are server-verified.
{
 const a={...base,gtin:"4000000000013",source:"ECHTPREIS receipt",sourceType:"receipt",proof:"receipt-a"},b={...a,proof:"receipt-b"};
 for(const flags of [{},{identityVerified:true},{status:"verified",identityVerified:true},{status:"observed",identityVerified:true,proofVerified:true}]){
  const result=resolve([{...a,...flags},{...b,...flags}]);assert.strictEqual(result.state,"observed");assert.strictEqual(result.truth.state,"observed");
 }
 const flags={status:"verified",identityVerified:true,proofVerified:true},trusted=resolve([{...a,...flags},{...b,...flags}]);assert.strictEqual(trusted.state,"verified");assert.strictEqual(trusted.truth.verifiedEvidence,2);
 const mislabeled=resolve([{...a,sourceType:"official_retailer"},{...b,sourceType:"official_retailer"}]);assert.strictEqual(mislabeled.state,"observed","the registry identifies first-party data despite a misleading label");
 const shelf={...a,source:"ECHTPREIS shelf",sourceType:"shelf"};assert.strictEqual(resolve([shelf,{...shelf,proof:"shelf-b"}]).state,"observed");
 const open={...a,source:"Open Prices",sourceType:"open_data"};assert.strictEqual(resolve([open,{...open,proof:"open-b"}]).state,"verified","established open-data consensus remains available");
}

// Product, quantity and evidence context survive the canonical decision.
{
 const multi={...base,priceType:"multi_buy",minQuantity:3,proofHash:"photo-bytes",proofActor:"contributor",kind:"official",status:"verified",identityVerified:true,proofVerified:true,per:"piece",eligibility:{couponId:"offer-context"}},result=resolve([multi],{quantity:3});
 assert.strictEqual(result.minQuantity,3);assert.strictEqual(result.productId,"p");assert.strictEqual(result.proofHash,"photo-bytes");assert.strictEqual(result.proofActor,"contributor");assert.strictEqual(result.truthEligible,true);
 for(const field of ["kind","status","identityVerified","proofVerified","per","pack","brand"])assert.strictEqual(result[field],multi[field],"canonical evidence must retain "+field);assert.deepStrictEqual(result.sourceEligibility,multi.eligibility);assert.strictEqual(result.eligibility.ok,true);
 const derived=resolve([{...base,per:"piece",originalPer:"kg",originalPrice:9.96,priceBasis:"derived-pack"}]);assert.strictEqual(derived.originalPrice,9.96);assert.strictEqual(derived.originalPer,"kg");assert.strictEqual(derived.priceBasis,"derived-pack");assert.strictEqual(derived.payablePrice,2.49);
}

console.log("current-price-deep: ok");
