"use strict";
const assert=require("assert"),Client=require("../app/current-price-client");
const today="2026-09-30",ctx={today,storeId:"store-1",region:"Berlin"},query={product:"Butter",brand:"Testbrand",pack:"250 g",gtin:"4008400401627",merchants:["REWE"]};
const base={merchant:"REWE",state:"verified",kind:"receipt",status:"verified",identityVerified:true,proofVerified:true,sourceEligibility:{receiptReview:true},price:1.99,payablePrice:1.99,currency:"EUR",priceType:"regular",product:"Testbrand Butter 250 g",productId:"butter-1",brand:"Testbrand",pack:"250 g",gtin:query.gtin,storeId:"store-1",region:"Berlin",locationLevel:"store",observedAt:today,confidence:92,queryMode:"exact",match:"ground-truth",proof:"receipt-1",proofHash:"file-hash",proofActor:"actor-1",source:"SPARKORB receipt",sourceType:"receipt",per:"piece",unit:"kg",unitPrice:7.96,packParsed:{amount:250,unit:"g",base:"kg",factor:1000},publicReferencePrice:2.49,truth:{state:"supported",independentEvidence:2,verifiedEvidence:2,sourceTypes:["receipt"],strength:.92}};
const answer=(rows=[base])=>({ok:true,today,results:rows});
const response=(value=answer())=>({ok:true,json:async()=>value});
const normalize=raw=>Client.normalizeDecision(raw,{...ctx,query});
function checkUnknown(value,message){assert.strictEqual(value.state,"unknown",message);assert.strictEqual(value.price,null,message)}

{
 const value=normalize(base);assert.strictEqual(value.state,"verified");assert.strictEqual(value.price,1.99);assert.strictEqual(value.proofHash,"file-hash");assert.strictEqual(value.proofActor,"actor-1");assert.strictEqual(value.productId,"butter-1");assert.strictEqual(value.locationLevel,"store");assert.strictEqual(value.unitPrice,7.96);assert.strictEqual(value.publicReferencePrice,2.49);
 assert.strictEqual(value.kind,"receipt");assert.strictEqual(value.identityVerified,true);assert.strictEqual(value.proofVerified,true);assert.deepStrictEqual(value.sourceEligibility,{receiptReview:true});assert.strictEqual(value.truth.verifiedEvidence,2);
 for(const absent of [{status:"observed"},{identityVerified:false},{proofVerified:false},{status:undefined,identityVerified:undefined,proofVerified:undefined}])assert.strictEqual(normalize({...base,...absent}).state,"observed","unreviewed first-party evidence cannot retain a verified claim");
 for(const price of [Infinity,NaN,-1,0,"",true])checkUnknown(normalize({...base,price,payablePrice:price}),"non-prices must fail closed");
 checkUnknown(normalize({...base,currency:"USD"}),"foreign currency cannot be treated as euros");checkUnknown(normalize({...base,currency:undefined}),"currency must be explicit");
 checkUnknown(normalize({...base,payablePrice:2.99}),"conflicting payable amounts must fail closed");
 for(const observedAt of [null,"not-a-date","2026-02-30","2026-10-01","2026-09-22"])checkUnknown(normalize({...base,observedAt}),"future, missing, impossible and old observation dates are not current");
 assert.strictEqual(normalize({...base,observedAt:"2026-09-23"}).price,1.99,"seven-day boundary is inclusive");
 checkUnknown(normalize({...base,observedAt:"2026-09-22",validTo:"2026-10-05"}),"an offer end date cannot renew old evidence");
 for(const invalid of [{validTo:"2026-09-29"},{validFrom:"2026-10-01"},{validTo:"bad"},{validFrom:"2026-10-05",validTo:"2026-10-01"}])checkUnknown(normalize({...base,...invalid}),"inactive validity windows are excluded");
 for(const invalid of [{state:"unknown"},{state:"conflict"},{conflict:{}},{conflictCount:1},{truth:{state:"conflict"}},{truth:{state:"unknown"}},{truthEligible:false},{sourceHealthState:"quarantine"}])checkUnknown(normalize({...base,...invalid}),"unknown or conflicting decisions never become live prices");
 checkUnknown(normalize({...base,storeId:"other-store"}),"a different store cannot be assigned to this one");checkUnknown(normalize({...base,region:"Hamburg"}),"a different region must be excluded");checkUnknown(normalize({...base,gtin:"0000000000000"}),"an exact query cannot use a different GTIN");
 checkUnknown(Client.normalizeDecision({...base,productId:"different-product"},{...ctx,query:{...query,productId:"butter-1"}}),"the canonical product id must match the requested identity");
 checkUnknown(normalize({...base,storeId:null,locationLevel:"unspecified"}),"unknown store scope must fail closed for an exact store query");
 const fallback=normalize({...base,storeId:null,locationLevel:"regional-fallback",scopeWarning:"not-store-specific",state:"observed"});assert.strictEqual(fallback.state,"observed");assert.strictEqual(fallback.scopeWarning,"not-store-specific");
}

{
 for(const priceType of ["loyalty","app","coupon","personalized"]){checkUnknown(normalize({...base,priceType,conditional:true}),"conditional prices require entitlement");assert.strictEqual(Client.normalizeDecision({...base,priceType,conditional:true},{...ctx,query,eligibility:{[priceType]:true}}).price,1.99);checkUnknown(Client.normalizeDecision({...base,priceType,conditional:true},{...ctx,query,eligibility:{[priceType]:"false"}}),"truthy text is not entitlement")}
 for(const priceType of ["unknown","club",""])checkUnknown(normalize({...base,priceType}),"unknown price types fail closed");
 const multi={...base,priceType:"multi_buy",conditional:true,minQuantity:3};
 checkUnknown(Client.normalizeDecision(multi,{...ctx,quantity:2}),"multi-buy needs the purchased amount");
 const eligible=Client.normalizeDecision(multi,{...ctx,quantity:3});assert.strictEqual(eligible.price,1.99);assert.strictEqual(eligible.minQuantity,3);
 for(const minQuantity of [undefined,null,"",0,1,-1,1.5,Infinity,NaN,"bad"])checkUnknown(Client.normalizeDecision({...multi,minQuantity},{...ctx,quantity:10}),"minimum quantity must be known and valid");
}

{
 const value=normalize(base),kg=Client.toComparablePrice(value,"kg"),piece=Client.toComparablePrice(value,"piece");
 assert.strictEqual(kg.price,7.96);assert.strictEqual(kg.per,"kg");assert.strictEqual(kg.payablePrice,1.99);assert.strictEqual(kg.publicReferencePrice,9.96);assert.strictEqual(kg.proofHash,"file-hash");assert.strictEqual(piece.price,1.99,"piece means the observed pack checkout price");
 assert.strictEqual(Client.toComparablePrice(value,"l"),null,"mass and volume cannot be interconverted");
 const weighedPack=Client.toComparablePrice({...value,price:2,payablePrice:2,per:"kg",pack:"0.5 kg",packParsed:{amount:500,unit:"g",base:"kg",factor:1000},unitPrice:4},"kg");assert.strictEqual(weighedPack.price,4,"a legacy pack unit cannot override the canonical unit price");assert.strictEqual(weighedPack.price*.5,2);
 const fromPack=Client.toComparablePrice({...value,unitPrice:null,unit:null},"kg");assert.strictEqual(fromPack.price,7.96);
 assert.strictEqual(Client.toComparablePrice({...value,pack:null,product:"Butter",packParsed:null,unit:null,unitPrice:null},"kg"),null,"missing pack sizes cannot be guessed");
 const litre=Client.toComparablePrice({...value,price:2,payablePrice:2,unit:null,unitPrice:null,packParsed:null,pack:"4 × 250 ml",product:"Milk"},"l");assert.strictEqual(litre.price,2);
 const normalizedPack=Client.parsePack({amount:250,unit:"g",factor:1});assert.strictEqual(normalizedPack.factor,1000,"the factor is derived from its physical unit");
 assert.strictEqual(Client.parsePack("2 x 250 g").amount,500);assert.strictEqual(Client.parsePack("0,5 l").amount,500);assert.strictEqual(Client.parsePack("1.5 x 250 g"),null);
 assert.strictEqual(Client.toComparablePrice({state:"unknown",price:1.99,currency:"EUR"},"kg"),null);
 const eggs={...value,price:1.99,payablePrice:1.99,unit:"piece",unitPrice:1.99/6,pack:"6 Stück",packParsed:{amount:6,unit:"piece",base:"piece",factor:1},product:"6 Eier"};
 const eggPrice=Client.toComparablePrice(eggs,"piece");assert(Math.abs(eggPrice.price*6-1.99)<1e-12,"a known six-piece pack converts to the payable amount for six items");assert.strictEqual(eggPrice.payablePrice,1.99);
 assert(Math.abs(Client.toComparablePrice({...eggs,unit:null,unitPrice:null},"piece").price*6-1.99)<1e-12,"documented pack counts can derive a per-item price");
}

{
 const result=Client.normalizeResponse(answer([{...base,merchant:"ALDI"}]),query,ctx);assert.strictEqual(result.ok,true);checkUnknown(result.results[0],"another merchant cannot fill a requested merchant's row");
 const duplicate=Client.normalizeResponse(answer([base,{...base,price:2.49,payablePrice:2.49}]),query,ctx);checkUnknown(duplicate.results[0],"duplicate merchant decisions are ambiguous");
 assert.strictEqual(Client.normalizeResponse({...answer(),today:"2026-09-29"},query,ctx).ok,false);
 assert.strictEqual(Client.normalizeResponse({ok:true},query,ctx).ok,false);
 const multiQuery={...query,merchants:["REWE","PENNY"]},multiContext={today,storeIds:{REWE:"store-1",PENNY:"store-2"},regions:{REWE:"Berlin",PENNY:"Potsdam"}},multiRows=[base,{...base,merchant:"PENNY",storeId:"store-2",region:"Potsdam"}];
 const decisions=Client.normalizeResponse(answer(multiRows),multiQuery,multiContext);assert(decisions.results.every(x=>x.price===1.99),"each merchant is validated against its requested branch and region");
 checkUnknown(Client.normalizeResponse(answer(multiRows),multiQuery,{...multiContext,storeIds:{REWE:"store-1",PENNY:"different"}}).results[1],"one merchant's wrong store mapping cannot pass another merchant's scope");
}

(async()=>{
 let calls=0,time=Date.parse(today+"T12:00:00Z"),captured;
 const client=Client.create({apiBase:"https://sparkorb.example/",now:()=>time,fetchImpl:async(url,options)=>{calls++;captured={url,options};return response()}});
 const first=await client.compare(query,ctx);assert.strictEqual(first.results[0].price,1.99);assert.strictEqual(captured.url,"https://sparkorb.example/v1/current-prices");assert.strictEqual(captured.options.method,"POST");
 const sent=JSON.parse(captured.options.body);for(const key of ["product","brand","pack","gtin"])assert.strictEqual(sent[key],query[key]);assert.strictEqual(sent.storeId,"store-1");assert.strictEqual(sent.region,"Berlin");assert.strictEqual(sent.quantity,1);assert.strictEqual(sent.maxAgeDays,7);
 await client.compare({...query,merchants:["REWE","PENNY"]},{today,storeIds:{REWE:"store-1",PENNY:"store-2"},regions:{REWE:"Berlin",PENNY:"Potsdam"}});const mapped=JSON.parse(captured.options.body);assert.deepStrictEqual(mapped.storeIds,{REWE:"store-1",PENNY:"store-2"});assert.deepStrictEqual(mapped.regions,{REWE:"Berlin",PENNY:"Potsdam"});calls=1;
 first.results[0].price=99;const second=await client.compare({...query},ctx);assert.strictEqual(second.results[0].price,1.99,"cached decisions are isolated from caller mutation");assert.strictEqual(calls,1,"a recent identical query reuses its canonical response");
 time+=60000;await client.compare(query,ctx);assert.strictEqual(calls,2,"the default TTL is exactly 60 seconds");
 await client.compare(query,{...ctx,quantity:2});assert.strictEqual(calls,3,"quantity changes cannot reuse another eligibility decision");await client.compare(query,{...ctx,eligibility:{loyalty:true}});assert.strictEqual(calls,4,"entitlement changes require a new decision");
 client.clearCache();assert.strictEqual(client.cacheInfo().entries,0);await client.compare(query,ctx);assert.strictEqual(calls,5);

 let release,inflightCalls=0;const inflight=Client.create({fetchImpl:()=>{inflightCalls++;return new Promise(resolve=>{release=()=>resolve(response())})}});
 const a=inflight.compare(query,ctx),b=inflight.compare({...query},{...ctx});await Promise.resolve();assert.strictEqual(inflightCalls,1,"concurrent equivalent queries share one request");release();const [av,bv]=await Promise.all([a,b]);assert.strictEqual(av.results[0].price,1.99);assert.strictEqual(bv.results[0].price,1.99);assert.strictEqual(inflight.cacheInfo().inflight,0);

 let failures=0,failTime=0;const failureClient=Client.create({now:()=>failTime,fetchImpl:async()=>{failures++;if(failures>1)throw new Error("network");return response()}});
 assert.strictEqual((await failureClient.compare(query,ctx)).results[0].price,1.99);failTime=60000;const unavailable=await failureClient.compare(query,ctx);assert.strictEqual(unavailable.ok,false);checkUnknown(unavailable.results[0],"an expired cached price cannot be returned live after a failed refresh");assert.strictEqual(failureClient.cacheInfo().entries,0);await failureClient.compare(query,ctx);assert.strictEqual(failures,3,"failures are retried and do not populate a live-price cache");

 let timedSignal;const timeout=Client.create({timeoutMs:5,fetchImpl:(_,options)=>{timedSignal=options.signal;return new Promise(()=>{})}});const timed=await timeout.compare(query,ctx);assert.strictEqual(timed.ok,false);checkUnknown(timed.results[0],"a hung request resolves to unknown within its deadline");if(timedSignal)assert.strictEqual(timedSignal.aborted,true);
 const invalidJson=Client.create({fetchImpl:async()=>({ok:true,json:async()=>{throw new Error("bad json")}})});assert.strictEqual((await invalidJson.compare(query,ctx)).ok,false);
 const badSchema=Client.create({fetchImpl:async()=>response({ok:true,results:"bad"})});assert.strictEqual((await badSchema.compare(query,ctx)).ok,false);
 const stale=Client.create({fetchImpl:async()=>response(answer([{...base,observedAt:"2026-09-01"}]))});checkUnknown((await stale.compare(query,ctx)).results[0],"stale canonical responses do not become live prices");
 const conflict=Client.create({fetchImpl:async()=>response(answer([{...base,state:"unknown",truth:{state:"conflict"}}]))});checkUnknown((await conflict.compare(query,ctx)).results[0],"a conflict remains unknown through the request path");

 let boundedCalls=0;const bounded=Client.create({maxEntries:2,fetchImpl:async()=>{boundedCalls++;return response()}});for(const product of ["Butter","Cheese","Milk"])await bounded.compare({...query,product},ctx);assert.strictEqual(bounded.cacheInfo().entries,2);await bounded.compare(query,ctx);assert.strictEqual(boundedCalls,4,"oldest cache entries are evicted when bounded capacity is reached");
 const originalFetch=global.fetch;let defaults=0;global.fetch=async()=>{defaults++;return response()};try{const defaultClient=Client.create();await defaultClient.compare(query,ctx);await defaultClient.compare(query,ctx);assert.strictEqual(defaults,1,"the default fetch binding must keep a stable cache identity")}finally{global.fetch=originalFetch}

 let clearRelease;const clearing=Client.create({fetchImpl:()=>new Promise(resolve=>{clearRelease=()=>resolve(response())})});const old=clearing.compare(query,ctx);await Promise.resolve();clearing.clearCache();clearRelease();await old;assert.strictEqual(clearing.cacheInfo().entries,0,"clearing during a request prevents its old result repopulating the cache");
 const noRequest=Client.create({fetchImpl:()=>{throw new Error("should not fetch")}});for(const invalid of [{...ctx,quantity:0},{...ctx,quantity:Infinity},{...ctx,today:"2026-02-30"}])assert.strictEqual((await noRequest.compare(query,invalid)).reason,"invalid-query");
 let refreshBody;const refreshing=Client.create({fetchImpl:async(_,options)=>{refreshBody=JSON.parse(options.body);return response()}});await refreshing.compare(query,{...ctx,refresh:true});assert.strictEqual(refreshBody.refresh,true);
 console.log("current-price-client: ok");
})().catch(error=>{console.error(error);process.exitCode=1});
