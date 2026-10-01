"use strict";
const assert=require("node:assert/strict"),Client=require("../dm-price-client"),fixture=require("./fixtures/retailers/dm-current-products.json");
const clone=x=>structuredClone(x),now=()=>"2026-10-01T00:00:00.000Z",pause=async()=>{},targets=[{retailerSku:"1453253",gtin:"4070765022773"},{retailerSku:"1697279",gtin:"4070765022841"}];
const response=(data,headers={})=>({ok:true,status:200,headers:{get:key=>headers[key.toLowerCase()]??null},text:async()=>JSON.stringify(data)});
const metadata={retailerSku:"1453253",capturedAt:now(),sourceApiUrl:fixture.source,sourceResponseHash:"a".repeat(64),availability:fixture.availability["1453253"]};
const parsed=Client.parseProduct(fixture.products["1453253"],metadata);assert.equal(parsed.ok,true);assert.equal(parsed.onlineOffer.price,.9);assert.equal(parsed.onlineOffer.availability,"available");assert.equal(parsed.onlineOffer.state,"published");assert.equal(parsed.onlineOffer.scopeChannel,"online");assert.equal(parsed.onlineOffer.scopeCountry,"DE");assert.equal(parsed.onlineOffer.expiresAt,"2026-10-02T00:00:00.000Z");assert.equal(parsed.product.truthEligible,false);assert.equal(parsed.onlineOffer.storeId,undefined);assert.equal(parsed.onlineOffer.validFrom,undefined);assert.equal(parsed.onlineOffer.packAmount,1);assert.equal(parsed.onlineOffer.packUnit,"l");assert.match(parsed.onlineOffer.proofHash,/^[a-f0-9]{64}$/);
for(const [mutate,reason] of[
 [p=>{p.gtin=4070765022774},"dm-valid-gtin-required"],
 [p=>{p.dan=1697279},"dm-retailer-sku-conflict"],
 [p=>{p.self="https://evil.test/p/d/1453253/oat"},"dm-public-product-url-required"],
 [p=>{p.self="/p/d/1697279/oat"},"dm-public-product-url-required"],
 [p=>{p.trackingData.currency="USD"},"dm-eur-currency-required"],
 [p=>{p.trackingData.price=NaN},"dm-current-gross-pack-price-required"],
 [p=>{p.trackingData.price=-1},"dm-current-gross-pack-price-required"],
 [p=>{p.price.price.current.value="ab 0,90 €"},"dm-current-gross-pack-price-required"],
 [p=>{p.price.price.current.value="0,76 €"},"dm-current-gross-pack-price-required"],
 [p=>{p.price.tileInfos=["500 ml (0,90 € je 1 l)"]},"dm-conflicting-sales-pack"],
 [p=>{p.price.tileInfos=["Preis pro Liter"]},"dm-exact-sales-pack-required"],
 [p=>{p.isPharmacy=true},"dm-readable-nonpharmacy-product-required"],
]){const p=clone(fixture.products["1453253"]);mutate(p);assert.ok(Client.parseProduct(p,metadata).reasons.includes(reason),reason)}
assert.ok(Client.parseProduct(fixture.products["1453253"],{...metadata,capturedAt:null}).reasons.includes("dm-live-capture-time-required"));assert.ok(Client.parseProduct(fixture.products["1453253"],{...metadata,sourceResponseHash:null}).reasons.includes("dm-live-source-response-required"));
assert.ok(Client.parseProduct(fixture.products["1453253"],{...metadata,sourceApiUrl:Client.SEARCH_ORIGIN+"/de/search/static?query=haferdrink"}).reasons.includes("dm-live-price-api-required"));
assert.equal(Client.availability({isPurchasable:true,rows:[{icon:"GRAY",text:"Markt wählen"},{icon:"GREEN",text:"Lieferbar"}]}),"unknown");assert.equal(Client.availability({isPurchasable:false}),"unavailable");assert.equal(Client.availability(null),"unknown");
const multi=clone(fixture.products["1453253"]);multi.title.tileHeadline="Probepackung, 2 x 175 g";multi.price.tileInfos=["0,35 kg (2,57 € je 1 kg)"];const multipack=Client.parseProduct(multi,metadata);assert.equal(multipack.ok,true);assert.equal(multipack.onlineOffer.packAmount,175);assert.equal(multipack.onlineOffer.packCount,2);assert.equal(multipack.onlineOffer.price,.9);
for(const url of["http://products.dm.de/product/products/detail/de/dan/1453253","https://evil.test/product/products/detail/de/dan/1453253","https://products.dm.de/product/products/detail/at/dan/1453253","https://products.dm.de/product/products/detail/de/dan/1453253?storeId=123","https://product-search.services.dmtech.com/de/search/static?query=x&token=secret"]){assert.throws(()=>Client.allowedApiUrl(url),/dm-source-url-not-allowed/)}
(async()=>{
 const called=[];const fetchImpl=async(url,options)=>{called.push({url,options});return response(url.includes("/availability/")?fixture.availability:{products:fixture.products})};
 const result=await Client.fetchOffers(targets,{fetchImpl,sleep:pause,now});assert.equal(result.offers.length,2);assert.equal(result.requests,2);assert.equal(result.complete,true);assert.equal(result.offers[0].price,.9);assert.equal(result.offers[1].price,1.45);assert.equal(called[0].options.redirect,"error");assert.equal(called[0].options.headers["Cache-Control"],"no-cache");assert.equal(result.offers[0].availability,"available");
 const stale=async()=>response({products:fixture.products},{age:"301"});await assert.rejects(Client.fetchOffers(targets,{fetchImpl:stale,sleep:pause,now}),/dm-current-response-stale/);
 const partial=await Client.fetchOffers(targets,{fetchImpl,sleep:pause,now,maxRequests:1});assert.equal(partial.offers.length,0);assert.equal(partial.complete,false);assert.equal(partial.requests,1);
 const changed=clone(fixture.products);changed["1453253"].gtin=4070765022841;const conflict=await Client.fetchOffers(targets,{fetchImpl:async u=>response(u.includes("availability")?fixture.availability:{products:changed}),sleep:pause,now});assert.equal(conflict.offers.length,1);assert.ok(conflict.rejected[0].reasons.includes("dm-target-gtin-conflict"));
 const poisoned=await Client.fetchOffers([targets[0],{...targets[0],gtin:targets[1].gtin},targets[0]],{fetchImpl,sleep:pause,now});assert.equal(poisoned.offers.length,0);assert.equal(poisoned.requests,0);
 const pages=[];const listings=[{products:targets.map((t,i)=>({dan:Number(t.retailerSku),gtin:Number(t.gtin),title:fixture.products[t.retailerSku].title.tileHeadline,brandName:"dmBio",tileData:fixture.products[t.retailerSku]})),count:2,currentPage:0,pageSize:30,totalPages:1},{products:[],count:0,currentPage:0,pageSize:30,totalPages:0}];const discoverFetch=async u=>{pages.push(u);return response(listings[new URL(u).searchParams.get("query")==="haferdrink"?0:1])};
 const discovery=await Client.discoverTargets({queries:["haferdrink","rice"],fetchImpl:discoverFetch,sleep:pause,maxProducts:1});assert.equal(discovery.targets.length,1);assert.equal(discovery.complete,false);assert.equal(discovery.cursor.offset,1);assert.equal(discovery.targets[0].price,undefined);assert.equal(discovery.truthEligible,false);
 const resumed=await Client.discoverTargets({queries:["haferdrink","rice"],fetchImpl:discoverFetch,sleep:pause,cursor:discovery.cursor});assert.equal(resumed.targets[0].retailerSku,"1697279");assert.equal(resumed.complete,true);assert.equal(resumed.requests,2);assert.equal(resumed.cursor,null);assert.match(pages[0],/search\/crawl\?query=haferdrink/);
 await assert.rejects(Client.discoverTargets({queries:["rice"],fetchImpl:discoverFetch,sleep:pause,cursor:discovery.cursor}),/dm-discovery-cursor-invalid/);
 let discoveryCalls=0;const interrupted=await Client.discoverTargets({queries:["haferdrink","rice"],fetchImpl:async()=>{discoveryCalls++;return discoveryCalls===1?response(listings[0]):{ok:false,status:429,headers:{get:()=>null}}},sleep:pause,maxRequests:3});assert.equal(interrupted.targets.length,2);assert.equal(interrupted.complete,false);assert.equal(interrupted.partialError.status,429);assert.equal(interrupted.cursor.queryIndex,1);assert.equal(interrupted.requests,3);
 const missing=await Client.fetchOffers(targets,{fetchImpl:async u=>response(u.includes("availability")?fixture.availability:{products:{}}),sleep:pause,now});assert.equal(missing.offers.length,0);assert.equal(missing.rejected.length,2);
 let attempts=0;const retry=await Client.fetchOffers(targets,{fetchImpl:async u=>{attempts++;return attempts===1?{ok:false,status:429,headers:{get:()=>"0"}}:response(u.includes("availability")?fixture.availability:{products:fixture.products})},sleep:pause,now,maxRequests:3});assert.equal(retry.requests,3);assert.equal(retry.offers.length,2);
 await assert.rejects(Client.fetchOffers(targets,{fetchImpl:async()=>response({products:fixture.products},{"content-length":"99999999"}),sleep:pause,now}),/dm-source-body-too-large/);
 await assert.rejects(Client.fetchOffers(targets,{fetchImpl:async()=>({ok:true,status:200,url:"https://evil.test",text:async()=>"{}"}),sleep:pause,now}),/dm-source-url-not-allowed/);
 console.log("dm-price-client: live first-party gross pack prices, exact identities, online scope/availability, request/body/cursor budgets and discovery-only listings OK");
})().catch(error=>{console.error(error);process.exitCode=1});
