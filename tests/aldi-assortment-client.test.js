"use strict";
const assert=require("node:assert/strict"),Client=require("../aldi-assortment-client"),fixture=require("./fixtures/retailers/aldi-public-assortment.json");
const clone=value=>structuredClone(value),now=()=>"2026-10-01T00:00:00.000Z",pause=async()=>{},target=Client.targetForUrl(fixture.sourceUrl),metadata={...target,capturedAt:now(),sourceResponseDate:now(),sourceAgeSeconds:null,sourceResponseHash:"a".repeat(64)};
const sitemap=urls=>'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(url=>"<url><loc>"+url+"</loc></url>").join("")+"</urlset>";
const page=(products,ids)=>'<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{pageProps:{apiData:JSON.stringify([["PRODUCT_DETAIL_GET",{req:{productIds:ids||products.map(p=>String(p.objectID))},res:{products}}]])}}})+"</script>";
const response=(raw,headers={})=>({ok:true,status:200,headers:{get:key=>({...{date:new Date(now()).toUTCString()},...headers})[key.toLowerCase()]??null},text:async()=>raw});
const parsed=Client.parseProduct(fixture.product,metadata);assert.equal(parsed.ok,true);assert.equal(parsed.offer.price,.95);assert.equal(parsed.offer.packAmount,1);assert.equal(parsed.offer.packUnit,"l");assert.equal(parsed.offer.gtin,null);assert.equal(parsed.offer.storeId,null);assert.equal(parsed.offer.locationScope,"unknown");assert.equal(parsed.offer.availability,"unknown");assert.equal(parsed.offer.scopeChannel,"assortment-publication");assert.equal(parsed.offer.priceKind,"published-current");assert.equal(parsed.offer.regularPrice,null);assert.equal(parsed.offer.promotionStatus,"unknown");assert.equal(parsed.offer.truthEligible,false);assert.equal(parsed.offer.expiresAt,"2026-10-02T00:00:00.000Z");assert.match(parsed.offer.proofHash,/^[a-f0-9]{64}$/);
assert.equal(Client.exactPack(null),null);assert.equal(Client.parseProduct(null,metadata).ok,false);assert.equal(Client.parseProduct([],metadata).ok,false);
for(const[quantity,amount,unit,count,total]of[["1-Liter-Packung",1,"l",1,1000],["250-Milliliter-Flasche",250,"ml",1,250],["1,5-Kilogramm-Packung",1.5,"kg",1,1500],["500-Gramm-Becher",500,"g",1,500],["20x10-g-Packung",10,"g",20,200],["20 x 10-Gramm-Packung",10,"g",20,200],["2x0,5-Liter-Packung",.5,"l",2,1000]]){
 const native=Client.parseProduct({...clone(fixture.product),salesUnit:quantity},metadata);assert.equal(native.ok,true,quantity);assert(native.offer,quantity);assert.equal(native.offer.pack,quantity,"The original native salesUnit remains the price proof");assert.equal(native.offer.packAmount,amount);assert.equal(native.offer.packUnit,unit);assert.equal(native.offer.packCount,count);assert.equal(Client.exactPack(quantity).total.amount,total);
 const Service=require("../aldi-assortment-price-service"),checked=Service.validateOffer(native.offer,{now:Date.parse(now())});assert.equal(checked.ok,true,quantity+JSON.stringify(checked));assert.equal(checked.offer.packCount,count);assert.equal(checked.offer.packAmount,unit==="kg"||unit==="l"?amount*1000:amount);assert.equal(checked.offer.gtin,null);
 assert(Service.validateOffer({...native.offer,packCount:count+1},{now:Date.parse(now())}).reasons.includes("pack-metadata-conflict"));
}
for(const quantity of["ca. 1 Liter", "1 bis 2 Liter", "1/2 Liter", "1 Liter + 250 Milliliter gratis", "1 Liter, je nach Sorte", ".5 Liter", "-1-Liter-Packung", "1-Literatur-Packung", "20.5x10-g-Packung", "-20x10-g-Packung", "0x10-g-Packung", "20-x-10-g-Packung", "20x-10-g-Packung", "Produkt20x10-g-Packung", "20x10-g-Packung oder eine andere Menge", "20x10-g-Packung oder 10x20-g-Packung", "20x10-g-Packung mit 5-g-Probe", "je 100 Gramm"]){assert.equal(Client.exactPack(quantity),null,quantity);assert(Client.parseProduct({...clone(fixture.product),salesUnit:quantity},metadata).reasons.includes("aldi-exact-sales-pack-required"),quantity);}
assert(Client.parseProduct({...clone(fixture.product),name:"Milch 1 Liter",salesUnit:"Packung"},metadata).reasons.includes("aldi-exact-sales-pack-required"),"A title must never fill missing native salesUnit quantity");
for(const [mutate,reason] of[
 [p=>p.objectID="1939","aldi-native-product-identity-conflict"],
 [p=>p.productSlug="wrong-slug-1018999","aldi-native-product-identity-conflict"],
 [p=>p.name="","aldi-native-product-name-required"],
 [p=>p.salesUnit="Preis je Packung","aldi-exact-sales-pack-required"],
 [p=>p.salesUnit="ca. 250-g-Packung","aldi-exact-sales-pack-required"],
 [p=>p.salesUnit="200–250-g-Packung","aldi-exact-sales-pack-required"],
 [p=>p.salesUnit="250 g + 50 g gratis","aldi-exact-sales-pack-required"],
 [p=>p.salesUnit="je 100 g","aldi-exact-sales-pack-required"],
 [p=>p.shortDescription="Verschiedene Sorten","aldi-product-variant-unresolved"],
 [p=>{p.isDrainedWeight=true;p.drainedWeightValue=0},"aldi-drained-weight-unresolved"]
]){const raw=clone(fixture.product);mutate(raw);const result=Client.parseProduct(raw,metadata);assert.equal(result.ok,false);assert.ok(result.reasons.includes(reason),reason)}
for(const [mutate,reason] of[
 [p=>p.currentPrice.priceValue=true,"aldi-current-pack-price-required"],
 [p=>p.currentPrice.priceValue=0,"aldi-current-pack-price-required"],
 [p=>p.currentPrice.priceValue=Infinity,"aldi-current-pack-price-required"],
 [p=>p.currentPrice.validFrom=null,"aldi-native-price-validity-required"],
 [p=>p.currentPrice.validUntil=Number.MAX_SAFE_INTEGER,"aldi-native-price-validity-required"],
 [p=>p.currentPrice.validUntil=p.currentPrice.validFrom,"aldi-native-price-validity-required"],
 [p=>p.currentPrice.validUntil=1780000000,"aldi-current-price-outside-native-validity"],
 [p=>{p.currentPrice.validFrom=1800000000;p.currentPrice.validUntil=1893366000},"aldi-current-price-outside-native-validity"],
 [p=>p.isAvailable=false,"aldi-product-not-currently-published"],
 [p=>p.isComingSoon=true,"aldi-product-not-currently-published"],
 [p=>p.isRecall=true,"aldi-product-not-currently-published"]
 , [p=>{p.isDepositProduct=true;p.depositValue=null},"aldi-deposit-unresolved"]
]){const raw=clone(fixture.product);mutate(raw);const result=Client.parseProduct(raw,metadata);assert.equal(result.ok,true);assert.equal(result.offer,null);assert.ok(result.reasons.includes(reason),reason)}
assert.ok(Client.parseProduct(fixture.product,{...metadata,sourceResponseHash:null}).reasons.includes("aldi-live-source-response-required"));assert.ok(Client.parseProduct(fixture.product,{...metadata,capturedAt:null}).reasons.includes("aldi-live-capture-time-required"));
const expiresSoon=clone(fixture.product);expiresSoon.currentPrice.validUntil=Date.parse(now())/1000+3600;assert.equal(Client.parseProduct(expiresSoon,metadata).offer.expiresAt,"2026-10-01T01:00:00.000Z");
const deposit=clone(fixture.product);deposit.isDepositProduct=true;deposit.depositValue=.25;assert.equal(Client.parseProduct(deposit,metadata).offer,null);assert.ok(Client.parseProduct(deposit,metadata).reasons.includes("aldi-deposit-price-basis-unresolved"));
const unknownDeposit=clone(fixture.product);delete unknownDeposit.isDepositProduct;delete unknownDeposit.depositValue;assert.equal(Client.parseProduct(unknownDeposit,metadata).offer.deposit,null);assert.equal(Client.parseProduct(unknownDeposit,metadata).offer.depositIncluded,null);assert.equal(parsed.offer.deposit,0);assert.equal(parsed.offer.depositIncluded,false);
for(const value of[.951,.0001,10000.001,"0.95"]){const raw=clone(fixture.product);raw.currentPrice.priceValue=value;assert.equal(Client.parseProduct(raw,metadata).offer,null)}
const exactCent=clone(fixture.product);exactCent.currentPrice.priceValue=1.15;assert.equal(Client.parseProduct(exactCent,metadata).offer.price,1.15);
const depositConflict=clone(fixture.product);depositConflict.depositValue=.25;assert.ok(Client.parseProduct(depositConflict,metadata).reasons.includes("aldi-native-deposit-conflict"));
const depositFlag=clone(fixture.product);depositFlag.isDepositProduct="false";assert.ok(Client.parseProduct(depositFlag,metadata).reasons.includes("aldi-native-deposit-flag-invalid"));
assert.equal(parsed.offer.sourceResponseDate,now());assert.equal(parsed.offer.sourceAgeSeconds,null);
for(const [proof,reason] of[
 [{sourceResponseDate:null},"aldi-source-response-date-required"],
 [{sourceResponseDate:"not a date"},"aldi-source-response-date-stale-or-invalid"],
 [{sourceResponseDate:"0"},"aldi-source-response-date-stale-or-invalid"],
 [{sourceResponseDate:"2026-09-30T23:54:59.000Z"},"aldi-source-response-date-stale-or-invalid"],
 [{sourceResponseDate:"2026-10-01T00:05:01.000Z"},"aldi-source-response-date-stale-or-invalid"],
 [{sourceAgeSeconds:301},"aldi-source-cache-age-stale-or-invalid"],
 [{sourceAgeSeconds:-1},"aldi-source-cache-age-stale-or-invalid"],
 [{sourceAgeSeconds:"0"},"aldi-source-cache-age-stale-or-invalid"]
]){const result=Client.parseProduct(fixture.product,{...metadata,...proof});assert.equal(result.ok,false);assert.ok(result.reasons.includes(reason),reason)}
assert.equal(Client.parseProduct(fixture.product,{...metadata,sourceResponseDate:"2026-09-30T23:55:00.000Z",sourceAgeSeconds:300}).offer.sourceAgeSeconds,300);
for(const url of["http://www.aldi-nord.de/produkt/x-1.html","https://evil.test/produkt/x-1.html","https://www.aldi-nord.de/produkt/x-1.html?store=Berlin","https://www.aldi-nord.de/produkt/x-1.html#price","https://www.aldi-nord.de/produkt/x-01.html","https://www.aldi-nord.de/sitemaps/other.xml"]){assert.throws(()=>Client.allowedUrl(url),/aldi-product-url-not-allowed/)}
const catalog=Client.parseSitemap(sitemap(fixture.sitemapUrls));assert.equal(catalog.targets.length,3);assert.deepEqual(catalog.targets.map(t=>t.retailerSku),["1018999","6525","1939"]);assert.equal(catalog.targets[0].price,undefined);assert.equal(Client.stableTargets([...fixture.sitemapUrls].reverse()).snapshotHash,catalog.snapshotHash);
const prioritized=Client.stableTargets([Client.ORIGIN+"/produkt/nonfood-1.html",...fixture.sitemapUrls]);assert.equal(prioritized.targets[0].retailerSku,"1018999");assert.equal(prioritized.targets.at(-1).retailerSku,"1");
for(const xml of["<html>error</html>",sitemap([]),sitemap(fixture.sitemapUrls).replace("</loc>",""),'<!DOCTYPE urlset [<!ENTITY x SYSTEM "file:///secret">]>'+sitemap(fixture.sitemapUrls)])assert.throws(()=>Client.parseSitemap(xml),/aldi-sitemap-schema-invalid/);
const poisoned=Client.stableTargets([target,{...target,sourceUrl:target.sourceUrl.replace("haltbare-vollmilch","wrong")},target]);assert.equal(poisoned.targets.length,0);assert.equal(poisoned.rejected.length,2);
assert.throws(()=>Client.extractProducts('<script id="__NEXT_DATA__">'+JSON.stringify(fixture.sourceUnavailablePage)+"</script>"),/aldi-native-source-unavailable/);
(async()=>{
 const many=Array.from({length:6001},(_,i)=>Client.ORIGIN+"/produkt/test-product-"+(i+1)+".html");
 const discovery=await Client.discoverTargets({fetchImpl:async()=>response(sitemap(many)),sleep:pause,now});assert.equal(discovery.targets.length,6001);assert.equal(discovery.publishedUrlCount,6001);assert.equal(discovery.completeCatalog,true);assert.equal(discovery.catalogScope,"published-public-product-pages");assert.equal(discovery.requests,1);assert.equal(discovery.truthEligible,false);
 const calls=[];const fetchImpl=async(url,opts)=>{calls.push({url,opts});const t=Client.targetForUrl(url),raw={...clone(fixture.product),objectID:t.retailerSku,productSlug:url.split("/").at(-1).replace(/\.html$/,"")};return response(page([raw]))};
 const first=await Client.fetchProducts(catalog.targets,{fetchImpl,sleep:pause,now,maxRequests:1});assert.equal(first.targetCount,3);assert.equal(first.processed,1);assert.equal(first.offers.length,1);assert.equal(first.complete,false);assert.equal(first.cursor.nextIndex,1);assert.equal(first.cursorReset,false);assert.equal(calls[0].opts.redirect,"error");assert.equal(calls[0].opts.credentials,"omit");assert.equal(calls[0].opts.method,"GET");assert.equal(calls[0].opts.headers.Cookie,undefined);assert.match(calls[0].opts.headers["User-Agent"],/^Sparkorb-/);assert.equal(first.offers[0].sourceResponseDate,now());assert.equal(first.offers[0].sourceAgeSeconds,null);
 const second=await Client.fetchProducts(catalog.targets,{fetchImpl,sleep:pause,now,maxRequests:2,cursor:first.cursor});assert.equal(second.processed,2);assert.equal(second.offers.length,2);assert.equal(second.complete,true);assert.equal(second.cursor,null);assert.equal(calls[2].url,catalog.targets[2].sourceUrl);
 const deleted=await Client.fetchProducts(catalog.targets.slice(1),{fetchImpl,sleep:pause,now,maxRequests:1,cursor:first.cursor});assert.equal(deleted.offers[0].retailerSku,"6525");assert.equal(deleted.cursor.lastSku,"6525");assert.equal(deleted.cursorReset,true);
 const addedTarget=Client.targetForUrl(Client.ORIGIN+"/produkt/haltbare-milch-1000.html");const added=await Client.fetchProducts([addedTarget,...catalog.targets],{fetchImpl,sleep:pause,now,maxRequests:1,cursor:first.cursor});assert.equal(added.offers[0].retailerSku,"1000");assert.equal(added.cursor.lastSku,"1000");assert.equal(added.cursorReset,true);assert.equal(added.cursor.nextIndex,1);assert.equal(added.complete,false);
 const addedFollowup=await Client.fetchProducts([addedTarget,...catalog.targets],{fetchImpl,sleep:pause,now,maxRequests:3,cursor:added.cursor});assert.deepEqual(addedFollowup.offers.map(o=>o.retailerSku),["1018999","6525","1939"]);assert.equal(addedFollowup.cursorReset,false);assert.equal(addedFollowup.complete,true);
 await assert.rejects(Client.fetchProducts(catalog.targets,{fetchImpl,sleep:pause,now,cursor:{...first.cursor,lastSku:"6525"}}),/aldi-price-cursor-invalid/);
 const removed=await Client.fetchProducts(catalog.targets,{fetchImpl:async()=>({ok:false,status:404,headers:{get:()=>null}}),sleep:pause,now,maxRequests:2});assert.equal(removed.processed,2);assert.equal(removed.rejected.length,2);assert.equal(removed.cursor.nextIndex,2);
 const resumed=await Client.fetchProducts(catalog.targets,{fetchImpl,sleep:pause,now,maxRequests:1,cursor:removed.cursor});assert.equal(resumed.offers[0].retailerSku,"1939");assert.equal(resumed.complete,true);
 let forbiddenRequests=0;await assert.rejects(Client.fetchProducts(catalog.targets,{fetchImpl:async()=>{forbiddenRequests++;return{ok:false,status:403,headers:{get:()=>null}}},sleep:pause,now}),/aldi-source-http-403/);assert.equal(forbiddenRequests,1);
 await assert.rejects(Client.fetchProducts([target],{fetchImpl:async()=>({...response(page([fixture.product])),status:206}),sleep:pause,now}),/aldi-source-http-206/);
 let interruptedRequests=0;const interrupted=await Client.fetchProducts(catalog.targets,{fetchImpl:async(u,o)=>{interruptedRequests++;return interruptedRequests===1?fetchImpl(u,o):{ok:false,status:429,headers:{get:()=>"60"}}},sleep:pause,now});assert.equal(interrupted.processed,1);assert.equal(interrupted.offers.length,1);assert.equal(interrupted.partialError.status,429);assert.equal(interrupted.partialError.retryAfterMs,60000);assert.equal(interrupted.cursor.nextIndex,1);
 let unavailableRequests=0;const sourceUnavailable='<script id="__NEXT_DATA__">'+JSON.stringify(fixture.sourceUnavailablePage)+"</script>";const unavailable=await Client.fetchProducts(catalog.targets,{fetchImpl:async(u,o)=>{unavailableRequests++;return unavailableRequests===1?fetchImpl(u,o):response(sourceUnavailable)},sleep:pause,now});assert.equal(unavailable.processed,1);assert.equal(unavailable.partialError.code,"aldi-native-source-unavailable");assert.equal(unavailable.cursor.nextIndex,1);await assert.rejects(Client.fetchProducts([target],{fetchImpl:async()=>response(sourceUnavailable),sleep:pause,now}),/aldi-native-source-unavailable/);
 const expired=clone(fixture.product);expired.currentPrice.validUntil=1780000000;const old=await Client.fetchProducts([target],{fetchImpl:async()=>response(page([expired])),sleep:pause,now});assert.equal(old.products.length,1);assert.equal(old.offers.length,0);assert.equal(old.complete,true);
 const mismatch=await Client.fetchProducts([target],{fetchImpl:async()=>response(page([fixture.product],["1939"])),sleep:pause,now});assert.equal(mismatch.offers.length,0);assert.ok(mismatch.rejected[0].reasons.includes("aldi-native-request-identity-conflict"));
 const duplicates=await Client.fetchProducts([target],{fetchImpl:async()=>response(page([fixture.product,fixture.product],[target.retailerSku])),sleep:pause,now});assert.equal(duplicates.offers.length,0);
 const malformed=await Client.fetchProducts(catalog.targets,{fetchImpl:async()=>response("<html>Error</html>"),sleep:pause,now,maxRequests:1});assert.equal(malformed.processed,1);assert.equal(malformed.cursor.nextIndex,1);assert.equal(malformed.offers.length,0);
 for(const age of["301","-1","invalid","","1.5","9007199254740992"]){await assert.rejects(Client.fetchProducts([target],{fetchImpl:async()=>response(page([fixture.product]),{age}),sleep:pause,now}),/aldi-source-cache-age-stale-or-invalid/)}
 for(const date of[null,"invalid","0","Thu, 01 Oct 2026 00:05:01 GMT","Wed, 30 Sep 2026 23:54:59 GMT","Tue, 31 Feb 2026 00:00:00 GMT"]){await assert.rejects(Client.fetchProducts([target],{fetchImpl:async()=>response(page([fixture.product]),{date}),sleep:pause,now}),/aldi-source-response-date-(?:required|stale-or-invalid)/)}
 const withAge=await Client.fetchProducts([target],{fetchImpl:async()=>response(page([fixture.product]),{date:"Wed, 30 Sep 2026 23:55:00 GMT",age:"300"}),sleep:pause,now});assert.equal(withAge.offers[0].sourceResponseDate,"2026-09-30T23:55:00.000Z");assert.equal(withAge.offers[0].sourceAgeSeconds,300);
 const sitemapFresh=await Client.discoverTargets({fetchImpl:async()=>response(sitemap(fixture.sitemapUrls),{date:"Wed, 30 Sep 2026 23:45:00 GMT",age:"900"}),sleep:pause,now});assert.equal(sitemapFresh.sourceAgeSeconds,900);assert.equal(sitemapFresh.sourceResponseDate,"2026-09-30T23:45:00.000Z");
 await assert.rejects(Client.discoverTargets({fetchImpl:async()=>response(sitemap(fixture.sitemapUrls),{date:"Wed, 30 Sep 2026 23:44:59 GMT"}),sleep:pause,now}),/aldi-source-response-date-stale-or-invalid/);
 await assert.rejects(Client.discoverTargets({fetchImpl:async()=>response(sitemap(fixture.sitemapUrls),{age:"901"}),sleep:pause,now}),/aldi-source-cache-age-stale-or-invalid/);
 await assert.rejects(Client.discoverTargets({fetchImpl:async()=>response(sitemap(fixture.sitemapUrls),{date:null}),sleep:pause,now}),/aldi-source-response-date-required/);
 await assert.rejects(Client.fetchProducts([target],{fetchImpl:async()=>response(page([fixture.product]),{"content-length":"99999999"}),sleep:pause,now}),/aldi-source-body-too-large/);
 const bodyBudget=await Client.fetchProducts(catalog.targets,{fetchImpl,sleep:pause,now,maxTotalBytes:1});assert.equal(bodyBudget.processed,0);assert.equal(bodyBudget.cursor.nextIndex,0);assert.equal(bodyBudget.offers.length,0);
 await assert.rejects(Client.fetchProducts([target],{fetchImpl:async()=>({ok:true,status:200,url:"https://evil.test",text:async()=>""}),sleep:pause,now}),/aldi-product-url-not-allowed/);
 console.log("aldi-assortment-client: prioritized declared catalog, snapshot restart, native SKU/pack/cent-validity, strict Date/Age proof, bounded anonymous reads and unknown branch/GTIN/deposit classification OK");
})().catch(error=>{console.error(error);process.exitCode=1});
