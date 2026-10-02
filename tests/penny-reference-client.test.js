"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),Client=require("../app/penny-reference-client"),Current=require("../app/current-price-client"),Products=require("../app/published-product-client");
const SOURCE="PENNY Berlin regional price publications",MARKET="8534449",REGION="15A-01-56",CHANNEL="retailer-price-publication",CATEGORY="dauerhaft-im-preis-gesenkt",DAY=86400000;
const now=Date.parse("2026-10-02T18:00:00Z"),capture=now-60000,shop={name:"Penny Emser Straße",address:"Emser Str. 1-2",postalCode:"12051",city:"Berlin",country:"DE",nativeMarketId:MARKET,nativeSellingRegion:REGION};
function reference(p){return{kind:"regional-publication",identityKind:"cms-document-not-sku",city:"Berlin",country:"DE",merchant:"PENNY",key:JSON.stringify(["cms-document-not-sku",SOURCE,MARKET,REGION,p.cmsPublicationId,p.packCount,p.packAmount,p.packUnit]),observedAt:p.capturedAt,sourceMarket:{...p.shop},observedMarkets:1};}
// Synthetic bound DTOs: these hashes and prices do not claim retailer captures.
function row(patch={}){
 const publication={sourceId:SOURCE,merchant:"PENNY",kind:"regional-price-publication",identityKind:"cms-document-not-sku",nativeMarketId:MARKET,nativeSellingRegion:REGION,cmsPublicationId:"439122da-839c-4abc-9524-651c462785e9",gtin:null,retailerSku:null,name:"UNIT TEST COVO Schoko Waffelröllchen*",nativeQuantity:"je 125 g",pack:"125 g",packAmount:125,packUnit:"g",packCount:1,price:1.49,displayedPrice:1.49,deposit:null,payablePackPrice:null,currency:"EUR",priceType:"unknown",promotionStatus:"permanent-reduction-publication",previousPublishedPrice:1.79,nativeCategory:CATEGORY,nativeBasePrice:"(1 kg = 11.92)",publicationWeek:"2026-40",nativeValidity:null,state:"published",current:true,truthEligible:false,physicalStorePriceVerified:false,normalPriceClassificationVerified:false,publicationOriginalValidityVerified:false,scopeCountry:"DE",scopeChannel:CHANNEL,shop:{...shop},capturedAt:new Date(capture).toISOString(),expiresAt:new Date(capture+DAY).toISOString(),sourceUrl:"https://www.penny.de/angebote/"+CATEGORY+"/covo-schoko-waffelroellchen",sourceResponseUrl:"https://www.penny.de/.rest/offers/by-category/2026-40/"+CATEGORY+"/?region="+REGION,marketResponseUrl:"https://www.penny.de/.rest/market/markets/market_"+MARKET,sourceResponseHash:"a".repeat(64),marketResponseHash:"b".repeat(64),categoryPageHash:"c".repeat(64),proofHash:"d".repeat(64),marketCapturedAt:new Date(capture-30000).toISOString(),categoryCapturedAt:new Date(capture-240000).toISOString(),bindingModuleHash:"cc080a5e3e91c72a97dbadaa6915bd34a190c99e36a9c83d60b484bd358636b9",...patch};
 return{publication,reference:reference(publication)};
}
const envelope=rows=>({ok:true,city:"Berlin",country:"DE",items:[],publications:rows,bounded:true,truncated:false});
let checks=0;function test(name,fn){fn();checks++;console.log("ok "+checks+" - "+name);}
test("Separate native publication DTO survives unchanged without canonical identity",()=>{
 const input=row(),before=JSON.stringify(input),accepted=Client.candidate(input,{now});assert(accepted);assert.equal(JSON.stringify(input),before);assert.equal(accepted.publication.price,1.49);assert.equal(accepted.publication.previousPublishedPrice,1.79);assert.equal(accepted.publication.gtin,null);assert.equal(accepted.publication.retailerSku,null);assert.equal(accepted.publication.deposit,null);assert.equal(accepted.publication.payablePackPrice,null);assert.equal(accepted.publication.shippingIncluded,null);assert.equal(accepted.publication.truthEligible,false);assert.equal(accepted.reference.identityKind,"cms-document-not-sku");
 assert.equal(Current.normalizePublishedReference(accepted.publication,{now}),null);assert.equal(Products.selection(accepted.publication),null);assert.equal(Current.normalizePublishedAlternative(accepted.publication,{gtin:"4008400401621",pack:"125 g"},{now}),null);
});
test("Query search is bound to native title, exact channel, market and pack",()=>{
 assert(Client.candidate(row(),{now,request:{search:"Schoko",merchant:"PENNY",scopeChannel:CHANNEL,pack:"0,125 kg",limit:20}}));
 for(const request of[{gtin:"4008400401621"},{gtin:null},{search:"Milch"},{merchant:"REWE"},{scopeChannel:"physical-store"},{scopeChannel:"pickup"},{pack:"250 g"},{pack:"ca.125 g"},{search:5},{search:"x"},{search:"a".repeat(121)},{limit:201},{search:"Schoko",region:"Berlin"}])assert.equal(Client.candidate(row(),{now,request}),null,JSON.stringify(request));
});
test("Real native quantity spellings retain independent multipack count",()=>{
 for(const input of[row({nativeQuantity:"je 6 x 40-g-Packung",pack:"6 x 40 g",packAmount:40,packCount:6,nativeBasePrice:"(1 kg = 6.21)"}),row({nativeQuantity:"je 2 x 200 g",pack:"2 x 200 g",packAmount:200,packCount:2,price:1.69,displayedPrice:1.69,nativeBasePrice:"(1 kg = 4.23)"}),row({nativeQuantity:"je 6 x 50 g",pack:"6 x 50 g",packAmount:50,packCount:6,price:1.99,displayedPrice:1.99,nativeBasePrice:"(1 kg = 6.63)"})]){
  assert(Client.candidate(input,{now}));assert.equal(Client.candidate(input,{now,request:{pack:input.publication.packAmount*input.publication.packCount+" g"}}),null,"Total weight alone cannot identify a multipack");
 }
});
test("Rounded native unit price can be consistent without exact decimal division",()=>{assert(Client.candidate(row({nativeQuantity:"je 400 g",pack:"400 g",packAmount:400,price:2.79,displayedPrice:2.79,nativeBasePrice:"(1 kg = 6.98)"}),{now}));});
test("Known 200g peanuts arithmetic conflict is withheld, never corrected",()=>{const input=row({name:"UNIT TEST BRAVO Erdnüsse*",nativeQuantity:"je 200 g",pack:"200 g",packAmount:200,price:.69,displayedPrice:.69,nativeBasePrice:"(1 kg = 4.60)"}),before=JSON.stringify(input);assert.equal(Client.candidate(input,{now}),null);assert.equal(JSON.stringify(input),before);});
test("Publication with unknown drink deposit stays unknown",()=>{const input=row({name:"UNIT TEST COMET Cola*",nativeQuantity:"je 1,5 l",pack:"1,5 l",packAmount:1500,packUnit:"ml",price:.49,displayedPrice:.49,nativeBasePrice:"(1 l = 0.33)"});assert(Client.candidate(input,{now}));assert.equal(Client.candidate(input,{now,request:{pack:"1500 ml"}}).publication.deposit,null);});
test("Native title is retained; image metadata cannot grant a search match",()=>{const input=row({imageAlt:"Butter 250 g",imageTitle:"Butter 250 g",imageRendition:{imageTitle:"Butter"}});assert(Client.candidate(input,{now}));assert.equal(Client.candidate(input,{now,request:{search:"Butter"}}),null);assert.equal(Client.candidate(input,{now}).publication.imageAlt,undefined);});
test("Same names with distinct CMS documents and distinct packs remain separate",()=>{
 const a=row({name:"UNIT TEST COVO Gebäckmischung*",nativeQuantity:"je 500 g",pack:"500 g",packAmount:500,price:2.79,displayedPrice:2.79,nativeBasePrice:"(1 kg = 5.58)"}),b=row({cmsPublicationId:"2d3dfb0a-edc4-4686-a525-1eef268c8e6b",name:"UNIT TEST COVO Gebäckmischung*",nativeQuantity:"je 400 g",pack:"400 g",packAmount:400,price:2.79,displayedPrice:2.79,nativeBasePrice:"(1 kg = 6.98)"});
 assert.equal(Client.normalizeResponse(envelope([a,b]),{now}).publications.length,2);assert.equal(Client.normalizeResponse(envelope([a,b]),{now,request:{pack:"400 g"}}).publications.length,1);
});
test("CMS source identity is never asserted by a GTIN or fake retailer SKU",()=>{
 for(const patch of[{gtin:"4008400401621"},{gtin:undefined},{retailerSku:"439122da-839c-4abc-9524-651c462785e9"},{identityKind:"native-retailer-sku"},{cmsPublicationId:"439122da-839c-1abc-9524-651c462785e9"},{cmsPublicationId:"439122DA-839C-4ABC-9524-651C462785E9"},{cmsPublicationId:"not-a-sku"},{kind:"retailer-offer"}])assert.equal(Client.candidate(row(patch),{now}),null,JSON.stringify(patch));
});
test("All original hashes and fixed module binding are mandatory lower-case hashes",()=>{
 for(const field of["sourceResponseHash","marketResponseHash","categoryPageHash","proofHash","bindingModuleHash"])for(const value of[null,"a".repeat(63),"A".repeat(64),"not-a-hash"])assert.equal(Client.candidate(row({[field]:value}),{now}),null,field+":"+value);
 assert.equal(Client.candidate(row({bindingModuleHash:"a".repeat(64)}),{now}),null);
});
test("Market and selling region reject country, branch and address substitutions",()=>{
 for(const patch of[{nativeMarketId:"8534450"},{nativeMarketId:8534449},{nativeSellingRegion:"15A-01-57"},{scopeCountry:"AT"},{scopeChannel:"physical-store"},{merchant:"ALDI"},{sourceId:"PENNY national prices"},{shop:{...shop,city:"Potsdam"}},{shop:{...shop,address:"Another address"}},{shop:{...shop,postalCode:"12050"}},{shop:{...shop,nativeSellingRegion:"15A-01-57"}},{shop:{...shop,country:"AT"}}])assert.equal(Client.candidate(row(patch),{now}),null,JSON.stringify(patch));
});
test("Only public publisher URLs exactly bound to category, route week and region pass",()=>{
 for(const patch of[{sourceUrl:"http://www.penny.de/angebote/"+CATEGORY+"/test"},{sourceUrl:"https://evil.test/angebote/"+CATEGORY+"/test"},{sourceUrl:"https://www.penny.de/angebote/"+CATEGORY+"/test?region=other"},{sourceUrl:"https://www.penny.de/angebote/"+CATEGORY+"/test#fragment"},{sourceUrl:"https://user@www.penny.de/angebote/"+CATEGORY+"/test"},{sourceUrl:"https://www.penny.de/angebote/15A-01-57/"+CATEGORY+"/test"},{sourceResponseUrl:row().publication.sourceResponseUrl.replace("2026-40","2026-41")},{sourceResponseUrl:row().publication.sourceResponseUrl+"&extra=1"},{marketResponseUrl:"https://www.penny.de/.rest/market/markets/market_8534450"}])assert.equal(Client.candidate(row(patch),{now}),null,JSON.stringify(patch));
 assert(Client.candidate(row({sourceUrl:"https://www.penny.de/angebote/"+REGION+"/"+CATEGORY+"/test-product-"}),{now}));
});
test("Unknown validity and classification cannot be upgraded to current normal shelf truth",()=>{
 for(const patch of[{nativeValidity:{validTo:"2026-10-04"}},{nativeValidity:undefined},{priceType:"regular"},{promotionStatus:"regular"},{nativeCategory:"normalpreise"},{truthEligible:true},{truthEligible:undefined},{physicalStorePriceVerified:true},{normalPriceClassificationVerified:true},{publicationOriginalValidityVerified:true},{validFrom:"2026-10-02"},{validTo:"2026-10-04"},{state:"withheld"},{current:false}])assert.equal(Client.candidate(row(patch),{now}),null,JSON.stringify(patch));
});
test("Conditional price or invented checkout/selection authority is refused",()=>{
 for(const patch of[{requiresApp:true},{requiresMembership:true},{requiresCoupon:true},{multiBuy:true},{priceFrom:true},{actionPrice:true},{minimumQuantity:2},{minimumSpend:10},{priceAudience:"members"},{identityVerified:true},{canonicalSelectionEligible:true},{checkoutPriceVerified:true},{storeId:"internal-store-id"},{productId:"internal-product-id"},{shippingIncluded:false},{serviceFeesIncluded:true}])assert.equal(Client.candidate(row(patch),{now}),null,JSON.stringify(patch));
});
test("Price, displayed price, previous crossed-out price and unknown deposit stay independent",()=>{
 assert(Client.candidate(row({previousPublishedPrice:null}),{now}));
 for(const patch of[{price:1.495},{price:"1.49"},{price:0},{displayedPrice:1.79},{displayedPrice:null},{previousPublishedPrice:"1.79"},{previousPublishedPrice:0},{deposit:0},{deposit:.25},{payablePackPrice:1.49}])assert.equal(Client.candidate(row(patch),{now}),null,JSON.stringify(patch));
});
test("Native quantity and normalized count/amount/unit cannot disagree",()=>{
 for(const patch of[{nativeQuantity:"ca.125 g"},{nativeQuantity:"je 200 g"},{pack:"125 g oder 250 g"},{packAmount:125000},{packUnit:"kg"},{packCount:2},{packCount:1.5},{nativeBasePrice:"(1 l = 11.92)"},{nativeBasePrice:"ab11.92"},{name:"<img onerror=x>"}])assert.equal(Client.candidate(row(patch),{now}),null,JSON.stringify(patch));
});
test("Original captures cannot be future, invalid, expired or artificially renewed",()=>{
 for(const patch of[{capturedAt:new Date(now+1).toISOString()},{capturedAt:"2026-10-02"},{capturedAt:"2026-02-30T12:00:00.000Z"},{capturedAt:new Date(now-DAY-1).toISOString()},{expiresAt:new Date(now).toISOString()},{expiresAt:new Date(capture+DAY+1).toISOString()},{expiresAt:new Date(capture).toISOString()},{marketCapturedAt:new Date(capture+1).toISOString()},{categoryCapturedAt:new Date(capture-300001).toISOString()},{marketCapturedAt:new Date(capture-300001).toISOString()}])assert.equal(Client.candidate(row(patch),{now}),null,JSON.stringify(patch));
 assert(Client.candidate(row({expiresAt:new Date(now+1000).toISOString()}),{now}),"A shorter original lifetime stays shorter");
 assert.equal(Client.candidate(row({expiresAt:new Date(now+1000).toISOString()}),{now:now+1000}),null);
});
test("Berlin Sunday week rollover limits expiry without inventing native validity",()=>{
 const observed=Date.parse("2026-10-04T20:59:00Z"),expiry="2026-10-04T22:00:00.000Z",input=row({capturedAt:new Date(observed).toISOString(),expiresAt:expiry,marketCapturedAt:new Date(observed-30000).toISOString(),categoryCapturedAt:new Date(observed-240000).toISOString()});
 const valid=Client.candidate(input,{now:observed+1000});assert(valid);assert.equal(valid.publication.nativeValidity,null);assert.equal(valid.publication.publicationOriginalValidityVerified,false);assert.equal(Client.candidate({...input,publication:{...input.publication,expiresAt:new Date(Date.parse(expiry)+1).toISOString()}},{now:observed+1000}),null);assert.equal(Client.candidate(input,{now:Date.parse(expiry)}),null);
});
test("Berlin daylight-saving change uses actual Monday midnight, not fixed UTC offset",()=>{
 const observed=Date.parse("2026-10-25T21:30:00Z"),input=row({publicationWeek:"2026-43",sourceResponseUrl:row().publication.sourceResponseUrl.replace("2026-40","2026-43"),capturedAt:new Date(observed).toISOString(),expiresAt:"2026-10-25T23:00:00.000Z",marketCapturedAt:new Date(observed-30000).toISOString(),categoryCapturedAt:new Date(observed-240000).toISOString()});
 assert(Client.candidate(input,{now:observed+1000}));assert.equal(Client.candidate({...input,publication:{...input.publication,expiresAt:"2026-10-25T23:00:00.001Z"}},{now:observed+1000}),null);
});
test("Previous route week cannot acquire a new capture in a later week",()=>{
 const observed=Date.parse("2026-10-05T08:00:00Z");assert.equal(Client.candidate(row({capturedAt:new Date(observed).toISOString(),expiresAt:new Date(observed+DAY).toISOString(),marketCapturedAt:new Date(observed-30000).toISOString(),categoryCapturedAt:new Date(observed-240000).toISOString()}),{now:observed+1000}),null);
});
test("ISO week boundary follows Berlin date and ISO week year",()=>{
 const observed=Date.parse("2027-01-01T08:00:00Z"),input=row({publicationWeek:"2026-53",sourceResponseUrl:row().publication.sourceResponseUrl.replace("2026-40","2026-53"),capturedAt:new Date(observed).toISOString(),expiresAt:new Date(observed+DAY).toISOString(),marketCapturedAt:new Date(observed-30000).toISOString(),categoryCapturedAt:new Date(observed-240000).toISOString()});assert(Client.candidate(input,{now:observed+1000}));
});
test("Reference key, source-market label and observed timestamp are exactly bound",()=>{
 const input=row();for(const patch of[{kind:"last-observed"},{identityKind:"native-retailer-sku"},{city:"Hamburg"},{country:"AT"},{merchant:"Lidl"},{key:"cms-document"},{observedAt:new Date(now).toISOString()},{observedMarkets:2},{sourceMarket:{...shop,nativeMarketId:"8534450"}},{sourceMarket:{...shop,address:"Other source branch"}}])assert.equal(Client.candidate({...input,reference:{...input.reference,...patch}},{now}),null,JSON.stringify(patch));
});
test("Duplicate CMS records with changed price are withheld as a whole",()=>{
 const a=row(),b=row({price:1.79,displayedPrice:1.79,nativeBasePrice:"(1 kg = 14.32)"});assert.equal(Client.normalizeResponse(envelope([a,b]),{now}).publications.length,0);assert.equal(Client.normalizeResponse(envelope([a,a]),{now}).publications.length,0);
});
test("New conflicting pack is counted before filtering; old pack cannot reappear",()=>{
 const a=row(),b=row({pack:"250 g",nativeQuantity:"je 250 g",packAmount:250,nativeBasePrice:"(1 kg = 5.96)"});assert.equal(Client.normalizeResponse(envelope([a,b]),{now,request:{pack:"125 g"}}).publications.length,0);
});
test("Withheld/invalid latest version suppresses old same-CMS row before admission",()=>{
 const a=row(),b=row({state:"withheld",capturedAt:new Date(now).toISOString(),expiresAt:new Date(now+DAY).toISOString(),nativeQuantity:"ambiguous"});assert.equal(Client.normalizeResponse(envelope([a,b]),{now}).publications.length,0);
});
test("PENNY response is bounded, separate, backwards-compatible and never complete",()=>{
 const input=envelope([row()]),before=JSON.stringify(input),result=Client.normalizeResponse(input,{now});assert.equal(result.publications.length,1);assert.equal(result.coverageComplete,false);assert.equal(result.items,undefined);assert.equal(JSON.stringify(input),before);assert.equal(Client.normalizeResponse({...input,publications:undefined},{now}).publications.length,0);assert.equal(Client.normalizeResponse({...input,truncated:true},{now}).truncated,true);
 for(const raw of[null,{...input,ok:false},{...input,city:"Potsdam"},{...input,country:"AT"},{...input,publications:{}},{...input,publications:Array(201).fill(row())}])assert.equal(Client.normalizeResponse(raw,{now}).ok,false);
});
test("UMD browser export validates without fetch or product identity helpers",()=>{
 const context={window:{},URL,Intl,Date};vm.runInNewContext(fs.readFileSync(require.resolve("../app/penny-reference-client"),"utf8"),context);assert(context.window.CaddyPennyReferenceClient);assert(context.window.CaddyPennyReferenceClient.candidate(row(),{now}));assert.equal(typeof context.window.CaddyPennyReferenceClient.create,"undefined");assert.equal(typeof context.window.fetch,"undefined");
});
console.log("penny-reference-client: "+checks+" focused groups passed; synthetic DTOs only, no retailer requests");
