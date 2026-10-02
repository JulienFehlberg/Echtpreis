"use strict";
const assert=require("assert"),fs=require("fs"),{JSDOM,VirtualConsole}=require("jsdom");
const NeedMatcher=require("../shopping-need-matcher");
const ids={product:"11111111-1111-4111-8111-111111111111",rewe:"22222222-2222-4222-8222-222222222222",penny:"33333333-3333-4333-8333-333333333333",hit:"44444444-4444-4444-8444-444444444444"},gtin="4008400401621";
const product={id:ids.product,name:"Testbrand Butter",brand:"Testbrand",gtin,pack:"250 g",packAmount:250,packUnit:"g",packCount:1,canonicalKey:"butter",canonical:true,matchType:"exact"};
const stores=[{id:ids.rewe,merchant:"REWE",merchantKey:"rewe",address:"Teststraße 1",city:"Berlin",region:"Berlin",latitude:52.52,longitude:13.40,distanceKm:.1,canonical:true,matchType:"candidate"},{id:ids.penny,merchant:"PENNY",merchantKey:"penny",address:"Teststraße 2",city:"Berlin",region:"Berlin",latitude:52.521,longitude:13.40,distanceKm:.2,canonical:true,matchType:"candidate"}];
function discovery(mode){const found=mode==="eggs"?{...product,name:"Testbrand Eier",pack:"6 Stück",packAmount:6,packUnit:"piece"}:mode==="nutella"?{...product,name:"Nutella",brand:"Ferrero",pack:"450 g",packAmount:450}:mode==="typed-milk"?{...product,name:"Landliebe Milch",brand:"Landliebe",gtin:"4046700026519",pack:"1 l",packAmount:1,packUnit:"l",canonicalKey:"milch"}:product;return{ok:true,productResolution:{state:"exact",mode:"gtin",reason:"canonical-gtin"},products:[found],product:found,storeResolution:{state:"candidate",mode:"nearby",reason:"store-selection-required"},stores,refreshTargets:[],requiresProductSelection:false,requiresStoreSelection:true}}
function row(merchant,today,mode){
 if(mode.startsWith("hit-"))return merchant==="HIT"?hitQuote(mode):{merchant,state:"unknown",price:null,reason:"no-current-evidence"};
 const store=stores.find(x=>x.merchant===merchant),price=merchant==="REWE"?1.99:2.49;
 if(mode==="unknown"||mode==="published"||mode==="typed-milk"||mode.startsWith("product-"))return{merchant,state:"unknown",price:null,reason:"conflicting-current-evidence",truth:{state:"conflict"}};
 const quote={merchant,state:mode==="observed"?"observed":"verified",kind:"receipt",status:mode==="observed"?"observed":"verified",identityVerified:mode!=="unreviewed",proofVerified:mode!=="unreviewed",price,payablePrice:price,currency:"EUR",priceType:mode==="app"?"app":mode==="multi"?"multi_buy":"regular",conditional:mode==="app"||mode==="multi",minQuantity:mode==="multi"?3:null,product:"Testbrand Butter 250 g",productId:mode==="wrong-product"?ids.penny:ids.product,brand:"Testbrand",pack:"250 g",gtin,storeId:mode==="wrong-store"?ids.product:store&&store.id,region:"Berlin",locationLevel:"store",observedAt:today,confidence:93,queryMode:"exact",match:"ground-truth",proof:"receipt:"+merchant,proofHash:"hash:"+merchant,proofActor:"actor",source:"SPARKORB receipt",sourceType:"receipt",truthTier:3,priceAuthority:"observed-evidence",per:"piece",unitPrice:price*4,unit:"kg",packParsed:{amount:250,unit:"g",base:"kg",factor:1000},publicReferencePrice:2.99,truth:{state:mode==="observed"?"observed":"supported",independentEvidence:mode==="observed"?1:2,sourceTypes:1,strength:1.8}};
 if(mode==="eggs")Object.assign(quote,{product:"Testbrand Eier 6 Stück",pack:"6 Stück",unit:"piece",unitPrice:price/6,packParsed:{amount:6,unit:"piece",base:"piece",factor:1}});
 if(mode==="nutella")Object.assign(quote,{product:"Nutella 450 g",brand:"Ferrero",pack:"450 g",unitPrice:price/.45,packParsed:{amount:450,unit:"g",base:"kg",factor:1000}});
 return quote;
}
function publishedQuotes(){
 const capturedAt=new Date(Date.now()-1000).toISOString(),expiresAt=new Date(Date.now()+3600000).toISOString();
 const offer={sourceId:"Wolt nahkauf Berlin Wrangelstraße",merchant:"nahkauf",nativeVenueId:"657acc4eba505a018fb31b05",retailerSku:"657acc4eba505a018fb31b06",gtin,name:"Testbrand Butter",brand:"Testbrand",pack:"250 g",packAmount:250,packUnit:"g",packCount:1,price:2.56,deposit:.15,displayedPrice:2.71,nativePriceIncludesDeposit:true,payablePackPrice:2.71,currency:"EUR",priceBasis:"pack",capturedAt,expiresAt,proofHash:"c".repeat(64),sourceUrl:"https://wolt.com/de/deu/berlin/venue/nahcity-wrangelstrae",shop:{nativeVenueId:"657acc4eba505a018fb31b05",name:"Nahkauf Wrangelstraße",address:"Wrangelstraße 75",postalCode:"10997",city:"Berlin",country:"DE"},scopeCountry:"DE",scopeChannel:"online",state:"published",current:true,truthEligible:false,shippingIncluded:false,serviceFeesIncluded:false,availability:"unknown"};
 return[offer,{...offer,sourceId:"Wolt EDEKA Berlin",merchant:"EDEKA",nativeVenueId:"67ebb70ed3581534a525c522",sourceUrl:"https://wolt.com/de/deu/berlin/venue/edeka-hilbrecht",shop:{nativeVenueId:"67ebb70ed3581534a525c522",name:"EDEKA Hilbrecht",address:"Ritterstr. 38-40",postalCode:"10969",city:"Berlin",country:"DE"},price:2.04,deposit:0,displayedPrice:2.04,payablePackPrice:2.04},{...offer,sourceId:"REWE Berlin pickup",merchant:"REWE",nativeVenueId:undefined,nativeMarketId:"8321066",sourceUrl:"https://www.rewe.de/shop/p/testbrand-butter/1234567",shop:{nativeMarketId:"8321066",name:"REWE Steven Horn oHG",address:"Hallesches Ufer 40",postalCode:"10963",city:"Berlin",country:"DE"},scopeChannel:"pickup",price:2.29,deposit:null,displayedPrice:2.29,nativePriceIncludesDeposit:false,payablePackPrice:null}];
}
function productCandidatesFixture(mode,term="Milch"){
 if(mode.startsWith("hit-")){const quote=hitQuote(mode);return[{gtin:quote.gtin,name:quote.name,brand:null,pack:quote.pack,packAmount:quote.packAmount,packUnit:quote.packUnit,packCount:quote.packCount,offers:[],physicalOffers:[quote]}];}
 const pack=mode==="product-multipack"?"2 x 500 ml":"1 l",packAmount=mode==="product-multipack"?500:1,packUnit=mode==="product-multipack"?"ml":"l",packCount=mode==="product-multipack"?2:1;
 const offer={...publishedQuotes()[0],gtin:"4046700026519",name:term==="Butter"?"Butter Auswahl":"Landliebe Milch",brand:null,pack,packAmount,packUnit,packCount};
 return[{gtin:offer.gtin,name:offer.name,brand:"Landliebe",pack,packAmount,packUnit,packCount,offers:[offer]},{gtin:offer.gtin,name:"Andere Packungsgröße",brand:null,pack:"500 ml",packAmount:500,packUnit:"ml",packCount:1,offers:[{...offer,pack:"500 ml",packAmount:500,packUnit:"ml",packCount:1,retailerSku:"657acc4eba505a018fb31b07"}]}];
}
function berlinDay(time){return new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).format(time);}
function hitBranch(){return{id:ids.hit,storeId:ids.hit,merchant:"HIT",canonical:true,name:"Berlin-Mitte",address:"Anton-Wilhelm-Amo-Str. 69",postalCode:"10117",city:"Berlin",country:"DE",region:"Berlin",latitude:52.5118284,longitude:13.3841334,nativeStoreId:1775,nativeStoreNumber:"258"};}
function hitQuote(mode){
 const current=Date.now(),capture=mode==="hit-expire"?current-86400000+1000:mode==="hit-stale"?current-86400001:current-1000,capturedAt=new Date(capture).toISOString(),expiresAt=new Date(capture+86400000).toISOString(),sku="000000000000869561ST",multi=mode==="hit-multipack",paid=mode==="hit-paid",pack=multi?"2 x 500 ml":"1000 ml",branch=hitBranch();
 if(mode==="hit-picker-invalid")branch.city="Hamburg";
 return{merchant:"HIT",sourceId:"HIT Berlin store assortment",source:"HIT Berlin store assortment",sourceType:"official_retailer",kind:"external",status:"observed",state:"observed",identityVerified:true,proofVerified:false,truthEligible:true,name:"TEST ja! H-Milch 1,5% Marketingname",product:"TEST ja! H-Milch 1,5% Marketingname",productId:ids.product,gtin:"4388844177314",brand:null,pack,packAmount:multi?500:1000,packUnit:"ml",packCount:multi?2:1,externalProductId:"hit:store:1775:sku:"+sku,retailerSku:sku,nativeSku:sku,storeId:ids.hit,branch,region:"Berlin",locationLevel:"store",scopeCountry:"DE",scopeChannel:"physical-store",price:.85,goodsPrice:.85,payablePrice:.85,nativeDeposit:paid?.25:null,deposit:paid?.25:null,payablePackPrice:paid?1.10:null,checkoutPriceVerified:paid,currency:"EUR",priceBasis:"pack",per:"piece",priceType:"regular",conditional:false,comparisonOnly:false,observedAt:capturedAt,capturedAt,expiresAt,validFrom:berlinDay(capture),validTo:berlinDay(capture+86400000-1),sourceUrl:"https://www.hit.de/sortiment/kaese-eier-molkerei/milch-h-kuh-4261891/ja-h-milch-15-"+sku+"?markt=258",sourceResponseDate:capturedAt,sourceAgeSeconds:0,sourceResponseHash:"b".repeat(64),proofHash:"c".repeat(64),sourceEligibility:{scopeChannel:"physical-store",sourceScope:"physical-store",nativeStoreId:1775,nativeStoreNumber:"258",goodsPriceCents:85,depositCents:paid?25:null,priceIncludesDeposit:false,checkoutPriceVerified:paid,sourceExpiresAt:expiresAt},queryMode:"gtin",match:"ground-truth"};
}
async function fixture(mode){
 const requests=[],errors=[],vc=new VirtualConsole();let release,releaseSearch;
 vc.on("jsdomError",error=>errors.push(String(error.message||error)));
 const dom=new JSDOM(fs.readFileSync("index.html","utf8"),{runScripts:"dangerously",url:"https://example.test/",pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.SPARKORB_CONFIG={apiBase:"https://prices.example.test"};
  w.fetch=async(url,options={})=>{
   const path=new URL(String(url),"https://example.test/").pathname;
   if(path==="/v1/published-products"){
    const params=new URL(String(url)).searchParams,term=params.get("search");requests.push({path,search:term,pack:params.get("pack"),scopeChannel:params.get("scopeChannel"),options});const result={ok:true,items:productCandidatesFixture(mode,term),discoveryTruncated:true};
    if(mode==="product-search-hold"&&requests.filter(request=>request.path===path).length===1)return new Promise(resolve=>{releaseSearch=()=>resolve({ok:true,json:async()=>result});});
    return{ok:true,json:async()=>result};
   }
   if(path==="/v1/shopping-need"){
    const body=JSON.parse(options.body);requests.push({path,body,options});
    if(mode==="product-need-invalid")return{ok:false,status:400,json:async()=>({error:"invalid-shopping-need-constraints"})};
    const need=NeedMatcher.parse({search:body.search,constraints:body.constraints});
    let items=productCandidatesFixture(mode,body.search);
    for(const item of items){
     for(const offer of item.offers){offer.name="TEST H-Milch 1,5%";}
     for(const offer of item.physicalOffers||[])offer.nativeProof={headline:offer.name};
     const matches=[...item.offers,...(item.physicalOffers||[])].map(offer=>({sourceId:offer.sourceId,scopeChannel:offer.scopeChannel,retailerSku:offer.retailerSku,storeId:offer.storeId||null,nativeVenueId:offer.nativeVenueId||null,nativeMarketId:offer.nativeMarketId||null,gtin:offer.gtin,pack:offer.pack,...NeedMatcher.classify(need,{name:offer.name})}));
     item.needAssessment={selectionRequired:true,status:matches.some(match=>match.status==="confirmed")?"confirmed":"unconfirmed",offerMatches:matches};
    }
    items=items.filter(item=>item.needAssessment.offerMatches.every(match=>match.status!=="contradicted"));
    const result={ok:true,scopeCountry:"DE",selectionRequired:true,automaticSelection:false,needCoverage:{complete:false},need,items};
    if(mode==="product-need-hold"&&requests.filter(row=>row.path===path).length===1)return new Promise(resolve=>{releaseSearch=()=>resolve({ok:true,json:async()=>result});});
    return{ok:true,json:async()=>result};
   }
   if(path==="/v1/price-query"){const body=options.body?JSON.parse(options.body):{};requests.push({path,body});const value=discovery(mode);if(mode.startsWith("hit-")){const quote=hitQuote(mode);value.product={...product,name:quote.name,gtin:quote.gtin,pack:quote.pack,packAmount:quote.packAmount,packUnit:quote.packUnit,packCount:quote.packCount};value.products=[value.product];value.stores=body.storeId||body.merchants?.length===1?[hitBranch()]:Array.from({length:50},(_,i)=>({...stores[0],id:"20000000-0000-4000-8000-"+String(i+1).padStart(12,"0")}));if(mode==="hit-invalid-lookup")value.stores=value.stores.map(store=>({...store,country:"AT"}));}if(mode==="invalid-geo")value.stores=value.stores.map(x=>({...x,distanceKm:null,latitude:null,longitude:null}));return{ok:true,json:async()=>value}}
   if(path==="/v1/current-prices"){
    const body=JSON.parse(options.body);requests.push({path,body});
    if(mode==="unreachable")throw new Error("connection unavailable");
    const result={ok:true,today:body.today,results:body.merchants.map(m=>row(m,body.today,mode))};
    if(mode==="hit-wrong-store")result.results=result.results.map(quote=>quote.merchant==="HIT"?{...quote,storeId:ids.rewe}:quote);
    if(mode==="published")result.publishedAlternatives=publishedQuotes();
    if(mode==="typed-milk")result.publishedAlternatives=[{...publishedQuotes()[0],name:"Landliebe Milch",brand:"Landliebe",gtin:"4046700026519",pack:"1 l",packAmount:1,packUnit:"l"}];
    if(mode.startsWith("product-"))result.publishedAlternatives=productCandidatesFixture(mode)[0].offers;
    if(mode==="hold"||mode==="hit-hold")return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>result})});
    return{ok:true,json:async()=>result};
   }
   return{ok:false,status:503,json:async()=>({})};
  };
  w.eval(fs.readFileSync("app/price-engine.js","utf8"));w.eval(fs.readFileSync("app/current-price-client.js","utf8"));w.eval(fs.readFileSync("app/published-product-client.js","utf8"));w.eval(fs.readFileSync("shopping-need-matcher.js","utf8"));w.eval(fs.readFileSync("app/shopping-need-client.js","utf8"));
  w.alert=()=>{};w.confirm=()=>true;w.prompt=()=>null;w.scrollTo=()=>{};
  Object.defineProperty(w.navigator,"geolocation",{configurable:true,value:{getCurrentPosition:(_,fail)=>fail&&fail({code:1})}});
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.localStorage.setItem("sparkorb_receipt_consent","0");
 }});
 await new Promise(resolve=>setTimeout(resolve,80));
 const w=dom.window,today=w.eval("localDateKey()");
 w.localStorage.setItem("sparkorb_shared_observations_v1",JSON.stringify([{key:"butter",store:"REWE",price:3,per:"kg",date:today,product:"Testbrand Butter 250 g",kind:"official",source:"local legacy quote",proof:"local-proof",gtin,productId:ids.product,trust:96}]));
 w.eval("selected=new Set(['REWE','PENNY']);verifiedPriceLocation={lat:52.52,lon:13.40};nearbyStores=[];basket=[{...parseWish('250 g Butter'),ean:'"+gtin+"',gtin:'"+gtin+"',exactBrand:'Testbrand',matchMode:'exact',choice:{},packCount:1,packAmount:.25,packUnit:'kg',packLabel:'250 g',quantityMode:'packages',amount:.25,calcAmount:.25,unit:'kg',needsClarification:false,needsQuantity:false}];hasCompared=false;comparisonRevision++;invalidateDataEngine();resetPriceLookupMemo();");
 if(mode==="no-location")w.eval("verifiedPriceLocation=null;");
 if(mode==="eggs")w.eval("Object.assign(basket[0],{key:'eier',label:'6 Eier',unit:'piece',packUnit:'piece',packLabel:'6 Stück',packAmount:6,amount:6,calcAmount:6});");
 if(mode==="nutella")w.eval("Object.assign(basket[0],{key:'nutella',label:'Nutella 450 g',unit:'kg',packUnit:'kg',packLabel:'450 g',packAmount:.45,amount:.45,calcAmount:.45,exactBrand:'Ferrero'});");
 if(mode==="typed-milk")w.eval("basket=[parseWish('Landliebe Milch 1 l 4046700026519')];comparisonRevision++;");
 if(mode.startsWith("product-"))w.eval("basket=[parseWish('2 Milch')];comparisonRevision++;drawList();");
 if(mode.startsWith("hit-"))w.eval("selected=new Set(['HIT']);basket=[parseWish('2 Milch')];hasCompared=false;comparisonRevision++;drawList();drawStores();");
 if(mode==="hit-no-location")w.eval("verifiedPriceLocation=null;");
 if(mode==="hit-many")w.eval("selected=new Set(storeNames);drawStores();");
 return{dom,w,requests,errors,release:()=>release&&release(),releaseSearch:()=>releaseSearch&&releaseSearch()};
}
async function waitFor(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5))}throw new Error("expected canonical request was not issued")}

(async()=>{
 {
  const f=await fixture("product-pick");try{
   const original=f.w.eval("basket[0]"),quantity=original.packCount;await f.w.openPublishedProductPicker(0);const picker=f.w.document.getElementById("publishedProductPicker"),pack=picker.querySelector("[data-product-pack-filter]"),channel=picker.querySelector("[data-product-channel-filter]");
   assert.strictEqual(pack.value,"");assert.strictEqual(pack.maxLength,80);assert.strictEqual(channel.value,"");assert.strictEqual(f.requests.find(row=>row.path==="/v1/published-products").pack,null,"opening the picker does not derive a pack filter or change the need");assert.strictEqual(picker.querySelectorAll("[data-product-select]").length,2);
   const staleButton=picker.querySelector("[data-product-select]");pack.value="500 ml";staleButton.click();assert.strictEqual(original.selectedProduct,undefined,"programmatic filter changes without input events cannot select an old unfiltered button");assert.strictEqual(picker.querySelectorAll("[data-product-select]").length,0);
   picker.querySelector("form").dispatchEvent(new f.w.Event("submit",{bubbles:true,cancelable:true}));await waitFor(()=>picker.querySelector("[data-product-select]"));assert.strictEqual(picker.querySelectorAll("[data-product-select]").length,1);assert(picker.querySelector("[data-product-select]").textContent.includes("500 ml"));assert.strictEqual(original.packCount,quantity,"search filters cannot change desired package quantity");assert.strictEqual(f.requests.filter(row=>row.path==="/v1/published-products").at(-1).pack,"500 ml");
   pack.value="ca. 1 l";pack.dispatchEvent(new f.w.Event("input",{bubbles:true}));assert.strictEqual(picker.querySelectorAll("[data-product-select]").length,0,"typing invalidates result buttons immediately");const before=f.requests.length;picker.querySelector("form").dispatchEvent(new f.w.Event("submit",{bubbles:true,cancelable:true}));await waitFor(()=>picker.textContent.includes("genaue Packung"));assert.strictEqual(f.requests.length,before,"an invalid free-form pack makes no API request");assert.strictEqual(original.selectedProduct,undefined);assert.deepStrictEqual(f.errors,[]);
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("product-multipack");try{
   await f.w.openPublishedProductPicker(0);const picker=f.w.document.getElementById("publishedProductPicker"),pack=picker.querySelector("[data-product-pack-filter]");pack.value="1 l";pack.dispatchEvent(new f.w.Event("input",{bubbles:true}));picker.querySelector("form").dispatchEvent(new f.w.Event("submit",{bubbles:true,cancelable:true}));await waitFor(()=>picker.textContent.includes("noch keine aktuellen"));assert.strictEqual(picker.querySelectorAll("[data-product-select]").length,0,"equal aggregate volume does not admit a 2x500ml multipack to a 1l filter");
   pack.value="2 x 500 ml";pack.dispatchEvent(new f.w.Event("input",{bubbles:true}));picker.querySelector("form").dispatchEvent(new f.w.Event("submit",{bubbles:true,cancelable:true}));await waitFor(()=>picker.querySelector("[data-product-select]"));assert.strictEqual(picker.querySelectorAll("[data-product-select]").length,1);picker.querySelector("[data-product-select]").click();assert.strictEqual(f.w.eval("basket[0].selectedProduct.packCount"),2);assert.strictEqual(f.w.eval("basket[0].packCount"),2,"sales multipack count stays separate from the user's two requested packages");assert.deepStrictEqual(f.errors,[]);
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("product-search-hold");try{
   const open=f.w.openPublishedProductPicker(0);await waitFor(()=>f.requests.some(row=>row.path==="/v1/published-products"));const picker=f.w.document.getElementById("publishedProductPicker"),pack=picker.querySelector("[data-product-pack-filter]");pack.value="500 ml";pack.dispatchEvent(new f.w.Event("input",{bubbles:true}));assert.strictEqual(f.requests.find(row=>row.path==="/v1/published-products").options.signal.aborted,true,"a pack filter change aborts the old in-flight request");picker.querySelector("form").dispatchEvent(new f.w.Event("submit",{bubbles:true,cancelable:true}));await waitFor(()=>picker.querySelector("[data-product-select]"));f.releaseSearch();await open;assert.strictEqual(picker.querySelectorAll("[data-product-select]").length,1);assert(picker.querySelector("[data-product-select]").textContent.includes("500 ml"));assert.strictEqual(f.w.eval("basket[0].selectedProduct"),undefined,"late unfiltered responses do not auto-select any identity");
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("product-search-hold");try{
   const open=f.w.openPublishedProductPicker(0);await waitFor(()=>f.requests.some(row=>row.path==="/v1/published-products"));const picker=f.w.document.getElementById("publishedProductPicker"),channel=picker.querySelector("[data-product-channel-filter]");channel.value="physical-store";channel.dispatchEvent(new f.w.Event("change",{bubbles:true}));assert.strictEqual(f.requests.find(row=>row.path==="/v1/published-products").options.signal.aborted,true);await waitFor(()=>f.requests.filter(row=>row.path==="/v1/published-products").length===2&&picker.textContent.includes("noch keine aktuellen"));f.releaseSearch();await open;assert.strictEqual(picker.querySelectorAll("[data-product-select]").length,0,"an old online reply cannot revive results after switching to physical prices");assert.strictEqual(f.requests.filter(row=>row.path==="/v1/published-products").at(-1).scopeChannel,"physical-store");assert.strictEqual(f.w.eval("basket[0].selectedProduct"),undefined);assert.deepStrictEqual(f.errors,[]);
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("hit-no-location");try{
   await f.w.openPublishedProductPicker(0);const picker=f.w.document.getElementById("publishedProductPicker"),channel=picker.querySelector("[data-product-channel-filter]");channel.value="online";channel.dispatchEvent(new f.w.Event("change",{bubbles:true}));await waitFor(()=>picker.textContent.includes("noch keine aktuellen"));assert.strictEqual(picker.querySelectorAll("[data-product-select]").length,0,"HIT physical quotes cannot satisfy an online filter even if the server ignores it");channel.value="physical-store";channel.dispatchEvent(new f.w.Event("change",{bubbles:true}));await waitFor(()=>picker.querySelector("[data-product-select]"));assert.strictEqual(picker.querySelectorAll("[data-product-select]").length,1);assert(picker.textContent.includes("HIT · Filialpreis"));assert.deepStrictEqual(f.errors,[]);
  }finally{f.dom.window.close()}
 }
 for(const mode of["hit-no-location","hit-many","hit-multipack","hit-paid"]){
  const f=await fixture(mode);try{
   assert(f.w.document.querySelector('[data-store="HIT"]'),"HIT is available in the physical market filter");assert.strictEqual(f.w.storeBrand({brand:"HIT",name:"HIT Berlin-Mitte"}),"HIT");
   await f.w.openPublishedProductPicker(0);const picker=f.w.document.getElementById("publishedProductPicker");assert.strictEqual(picker.querySelectorAll("[data-product-select]").length,1,"A HIT-only exact pack can be consciously selected");assert(picker.textContent.includes("Filialpreis")&&picker.textContent.includes("Anton-Wilhelm-Amo-Str. 69"));assert(!picker.textContent.includes("HIT · Online"));
   picker.querySelector("[data-product-select]").click();const chosen=f.w.eval("basket[0]");assert.strictEqual(chosen.ean,"4388844177314");assert.strictEqual(chosen.packCount,2);assert.strictEqual(chosen.selectedProduct.packCount,mode==="hit-multipack"?2:1);assert.strictEqual(chosen.calcAmount,2);assert.strictEqual(chosen.preferredStore.storeId,ids.hit);
   const saved=JSON.parse(f.w.localStorage.getItem("sparkorb_basket_state_v1"))[0];assert.deepStrictEqual(saved.preferredStore,{merchant:"HIT",storeId:ids.hit});for(const field of["price","physicalOffers","sourceEligibility","branch","proofHash"])assert.strictEqual(saved.selectedProduct[field],undefined,"old price/store evidence must not be saved as identity: "+field);const restored=f.w.restoreBasketItem(saved);assert.strictEqual(restored.preferredStore.storeId,ids.hit);assert.strictEqual(restored.packCount,2);assert.strictEqual(restored.selectedProduct.packCount,chosen.selectedProduct.packCount);
   const invalid=f.w.restoreBasketItem({...saved,preferredStore:{merchant:"HIT",storeId:"invented"}});assert.strictEqual(invalid.preferredStore,undefined,"a corrupt saved canonical id cannot be bound to a shop");
   await f.w.compare({skipLocation:true,scroll:false});const lookups=f.requests.filter(request=>request.path==="/v1/price-query"),storeLookup=lookups.find(request=>request.body.storeId===ids.hit),query=f.requests.filter(request=>request.path==="/v1/current-prices").at(-1).body;
   assert(storeLookup,"the selected physical store is independently rediscovered even without GPS or outside a global 50-store result");assert.deepStrictEqual(storeLookup.body.merchants,["HIT"]);assert.strictEqual(storeLookup.body.product,"");assert.strictEqual(query.product,"");assert.strictEqual(query.gtin,"4388844177314");assert.strictEqual(query.pack,chosen.selectedProduct.pack);assert.strictEqual(query.storeIds.HIT,ids.hit);assert.strictEqual(query.regions.HIT,"Berlin");assert.strictEqual(query.quantity,2);
   const section=f.w.document.getElementById("physicalComparison"),shown=section.textContent;assert.strictEqual(section.style.display,"block");for(const detail of["HIT · Filialpreis","Marketingname","Anton-Wilhelm-Amo-Str. 69","10117","Berlin","Warenpreis je Packung","0,85","Abruf","Gültig bis"])assert(shown.includes(detail),"physical detail missing: "+detail);assert.strictEqual(f.w.document.getElementById("publishedComparison").style.display,"none","physical quotes cannot become online delivery alternatives");assert.strictEqual(f.w.document.getElementById("winnerPrice").textContent,"—","an unreviewed observed quote cannot claim the cheapest fully verified basket");
   const price=f.w.activePrice(chosen.key,"HIT",chosen);if(mode==="hit-paid"){assert(price&&price.reference);assert(Math.abs(price.price*chosen.calcAmount-2.20)<1e-9);assert(shown.includes("1,10"));}else{assert.strictEqual(price,null,"unproven deposit cannot enter payable basket totals");assert(shown.includes("Pfand unbekannt")&&shown.includes("Packungspreis offen"));}
   if(mode==="hit-no-location"){assert.strictEqual(f.w.nearestStore("HIT").distance,null,"an explicit shop remains usable without invented GPS distance");assert(!f.w.document.getElementById("merchantResults").textContent.includes("0,0 km"));}
   f.w.eval("hasCompared=false;");await f.w.openPublishedProductPicker(0);f.w.document.querySelector("[data-product-clear]").click();assert.strictEqual(chosen.preferredStore,undefined);assert.strictEqual(chosen.selectedProduct,undefined);assert.deepStrictEqual(f.errors,[]);
  }finally{f.dom.window.close()}
 }
 for(const mode of["hit-stale","hit-picker-invalid"]){const f=await fixture(mode);try{await f.w.openPublishedProductPicker(0);assert.strictEqual(f.w.document.querySelectorAll("[data-product-select]").length,0);assert.strictEqual(f.w.eval("basket[0].selectedProduct"),undefined);}finally{f.dom.window.close()}}
 {
  const f=await fixture("hit-expire");try{await f.w.openPublishedProductPicker(0);const picker=f.w.document.getElementById("publishedProductPicker"),originalNow=f.w.Date.now;f.w.Date.now=()=>Date.now()+2000;picker.querySelector("[data-product-select]").click();assert.strictEqual(f.w.eval("basket[0].selectedProduct"),undefined);assert.strictEqual(f.w.eval("basket[0].preferredStore"),undefined);assert(picker.textContent.includes("abgelaufen"));f.w.Date.now=originalNow;}finally{f.dom.window.close()}
 }
 for(const mode of["hit-wrong-store","hit-invalid-lookup"]){const f=await fixture(mode);try{await f.w.openPublishedProductPicker(0);f.w.document.querySelector("[data-product-select]").click();await f.w.compare({skipLocation:true,scroll:false});assert.strictEqual(f.w.document.getElementById("physicalComparison").style.display,"none","wrong physical identity or geography cannot expose a goods price");assert.strictEqual(f.w.document.getElementById("winnerPrice").textContent,"—");assert.deepStrictEqual(f.errors,[]);}finally{f.dom.window.close()}}
 {
  const f=await fixture("hit-hold");try{await f.w.openPublishedProductPicker(0);f.w.document.querySelector("[data-product-select]").click();const first=f.w.compare({skipLocation:true,scroll:false});await waitFor(()=>f.requests.some(request=>request.path==="/v1/current-prices"));f.w.eval("basket=[];comparisonRevision++;");assert.strictEqual(await f.w.compare({skipLocation:true,scroll:false}),false);f.release();assert.strictEqual(await first,false);assert.strictEqual(f.w.document.getElementById("physicalComparison").style.display,"none","a late HIT reply cannot revive an old list");}finally{f.dom.window.close()}
 }
 for(const mode of["product-pick","product-multipack"]){
  const f=await fixture(mode);try{
   const original=f.w.eval("basket[0]");assert.strictEqual(original.ean,undefined);assert.strictEqual(f.requests.filter(row=>row.path==="/v1/published-products").length,0,"normal list creation does not search remote products on every input");
   assert(f.w.document.querySelector("[data-product-pick]"),"ordinary groceries have a concrete product choice action");await f.w.openPublishedProductPicker(0);
   const picker=f.w.document.getElementById("publishedProductPicker");assert.strictEqual(picker.getAttribute("role"),"dialog");assert.strictEqual(picker.getAttribute("aria-modal"),"true");assert.strictEqual(picker.querySelectorAll("[data-product-select]").length,2,"ambiguous pack sizes require a conscious choice");assert.strictEqual(original.ean,undefined,"even a successful search cannot silently choose an identity");assert(picker.textContent.includes("weitere Treffer"));
   const input=picker.querySelector("input");input.value="Butter";input.dispatchEvent(new f.w.Event("input",{bubbles:true}));assert.strictEqual(f.requests.filter(row=>row.path==="/v1/published-products").length,1,"typing alone cannot generate searches");assert.strictEqual(picker.querySelectorAll("[data-product-select]").length,0,"editing a search removes old selection buttons");input.value="Milch";picker.querySelector("form").dispatchEvent(new f.w.Event("submit",{bubbles:true,cancelable:true}));await waitFor(()=>picker.querySelector("[data-product-select]"));
   picker.querySelector("[data-product-select='0']").click();assert.strictEqual(f.w.document.getElementById("publishedProductPicker"),null);const chosen=f.w.eval("basket[0]");
   assert.strictEqual(chosen.ean,"4046700026519");assert.strictEqual(chosen.packCount,2,"the shopper's two outer packs are retained independently of the native sales multipack count");assert.strictEqual(chosen.calcAmount,2);assert.strictEqual(chosen.selectedProduct.packCount,mode==="product-multipack"?2:1);assert.strictEqual(chosen.needsClarification,false);assert.strictEqual(chosen.explicit,true);assert(!f.w.listPackHint(chosen).includes("ca."));assert(f.w.listPackHint(chosen).includes(chosen.selectedProduct.pack));
   const saved=JSON.parse(f.w.localStorage.getItem("sparkorb_basket_state_v1"))[0];assert.strictEqual(saved.selectedProduct.price,undefined);assert.strictEqual(saved.selectedProduct.offers,undefined);assert.strictEqual(saved.selectedProduct.productId,undefined);const restored=f.w.restoreBasketItem(saved);assert.strictEqual(restored.ean,chosen.ean);assert.strictEqual(restored.packCount,2);assert.strictEqual(restored.calcAmount,2);assert.strictEqual(restored.packLabel,chosen.packLabel);assert.strictEqual(restored.unit,"l");
   const corrupt=f.w.restoreBasketItem({...saved,selectedProduct:{...saved.selectedProduct,packAmount:999}});assert.strictEqual(corrupt.selectedProduct,undefined);assert.strictEqual(corrupt.ean,undefined,"corrupt stored selections cannot fall back to an unverified saved EAN");
   f.w.document.querySelector('[data-qty="1"]').click();assert.strictEqual(chosen.packCount,3);assert.strictEqual(chosen.calcAmount,3);assert.strictEqual(chosen.packLabel,chosen.selectedProduct.pack,"quantity updates do not replace a selected multipack with category defaults");
   await f.w.compare({skipLocation:true,scroll:false});const query=f.requests.filter(row=>row.path==="/v1/current-prices").at(-1).body;assert.strictEqual(query.gtin,chosen.ean);assert.strictEqual(query.pack,chosen.selectedProduct.pack);assert.strictEqual(query.brand,null,"optional source brand metadata is not an extra caller restriction");assert.strictEqual(query.productId,null,"selection never invents a canonical product id");assert.strictEqual(query.quantity,3);assert.strictEqual(f.w.document.getElementById("winnerPrice").textContent,"—");assert(f.w.document.getElementById("publishedComparisonItems").textContent.includes("Landliebe Milch"));
   await f.w.openPublishedProductPicker(0);f.w.eval("hasCompared=false;");f.w.document.querySelector("[data-product-clear]").click();assert.strictEqual(chosen.selectedProduct,undefined);assert.strictEqual(chosen.ean,undefined);assert.strictEqual(chosen.packCount,3,"clearing an identity preserves the shopper's quantity");assert.deepStrictEqual(f.errors,[]);
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("product-pick");try{
   await f.w.openPublishedProductPicker(0);const picker=f.w.document.getElementById("publishedProductPicker"),originalNow=f.w.Date.now;f.w.Date.now=()=>Date.now()+3600001;
   picker.querySelector("[data-product-select]").click();assert.strictEqual(f.w.eval("basket[0].ean"),undefined);assert(picker.textContent.includes("abgelaufen"),"an expired candidate cannot be selected even when its old button remains visible");f.w.Date.now=originalNow;
   f.w.document.dispatchEvent(new f.w.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));assert.strictEqual(f.w.document.getElementById("publishedProductPicker"),null,"Escape closes the accessible picker");
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("product-search-hold");try{
   const open=f.w.openPublishedProductPicker(0);await waitFor(()=>f.requests.some(row=>row.path==="/v1/published-products"));const picker=f.w.document.getElementById("publishedProductPicker");picker.querySelector("input").value="Butter";picker.querySelector("form").dispatchEvent(new f.w.Event("submit",{bubbles:true,cancelable:true}));
   await waitFor(()=>picker.querySelector("[data-product-select]"));assert(picker.textContent.includes("Butter Auswahl"));f.releaseSearch();await open;assert(picker.textContent.includes("Butter Auswahl"),"a late first search cannot replace the newer requested product results");assert.strictEqual(f.w.eval("basket[0].ean"),undefined);
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("product-search-hold");try{
   const original=f.w.eval("basket[0]"),open=f.w.openPublishedProductPicker(0);await waitFor(()=>f.requests.some(row=>row.path==="/v1/published-products"));f.w.eval("basket=[parseWish('Butter')];comparisonRevision++;");f.releaseSearch();await open;
   assert.strictEqual(original.ean,undefined);assert.strictEqual(f.w.eval("basket[0].ean"),undefined);assert.strictEqual(f.w.document.querySelectorAll("[data-product-select]").length,0,"a removed target cannot transfer search results onto another list row");assert(f.w.document.getElementById("publishedProductPicker").textContent.includes("Liste hat sich geändert"));
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("typed-milk");try{
   const wish=f.w.eval("basket[0]");assert.strictEqual(wish.ean,"4046700026519","only the explicitly typed, checksum-valid EAN becomes the exact identity");assert.strictEqual(wish.key,"milch");assert.strictEqual(wish.packLabel,"1 l");assert.strictEqual(wish.calcAmount,1);assert.strictEqual(wish.matchMode,"exact");
   assert.strictEqual(f.w.parseWish("Landliebe Milch 1 l 4046700026518").ean,undefined,"an invalid checksum cannot create a SKU query");assert.strictEqual(f.w.parseWish("Milch 4046700026519 3017620422003").ean,undefined,"ambiguous explicit codes cannot choose an arbitrary product");assert.strictEqual(f.w.parseWish("Landliebe Milch 1 l").ean,undefined,"brand and title alone never invent a GTIN");
   await f.w.compare({skipLocation:true,scroll:false});const lookup=f.requests.find(request=>request.path==="/v1/current-prices"),discovered=f.requests.find(request=>request.path==="/v1/price-query");assert.strictEqual(discovered.body.gtin,"4046700026519");assert.strictEqual(lookup.body.gtin,"4046700026519");assert.strictEqual(lookup.body.pack,"1 l");assert(f.w.document.getElementById("publishedComparisonItems").textContent.includes("Landliebe Milch"));assert.strictEqual(f.w.document.getElementById("winnerPrice").textContent,"—");
   f.w.saveBasketState();const restored=f.w.restoreBasketItem(JSON.parse(f.w.localStorage.getItem("sparkorb_basket_state_v1"))[0]);assert.strictEqual(restored.ean,wish.ean);assert.strictEqual(restored.key,"milch","reloading typed EAN products preserves their existing quantity/category context");assert.strictEqual(restored.unit,"l");assert.strictEqual(restored.packLabel,"1 l");assert.strictEqual(restored.calcAmount,1);
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("published");try{
   await f.w.compare({skipLocation:true,scroll:false});const d=f.w.document,section=d.getElementById("publishedComparison"),shown=section.textContent;
   assert.strictEqual(section.style.display,"block","published exact alternatives must reach the shopping-list view");assert.strictEqual(section.querySelectorAll("article").length,3,"independent EDEKA, nahkauf and pickup evidence stays separate");
   for(const detail of ["nahkauf","Wrangelstraße 75","EDEKA Hilbrecht","Ritterstr. 38-40","REWE Steven Horn oHG","Hallesches Ufer 40","Abholung","Warenpreis je Packung","2,56","0,15","2,71","Pfand unbekannt","gebühren unbekannt","Abruf","Gültig bis"])assert(shown.includes(detail),"published view missing decision detail: "+detail);
   assert.strictEqual(section.querySelectorAll('a[href^="https://wolt.com/"]').length,2,"both online sources have real source links");assert.strictEqual(d.getElementById("winnerPrice").textContent,"—","online prices cannot produce a cheapest physical basket");assert.strictEqual(d.getElementById("verifiedSavings").style.display,"none");
   const physical=f.w.activePrice("butter","REWE",f.w.eval("basket[0]"));assert(!physical||physical.reference,"the unknown physical decision remains unknown despite published prices");
   f.w.eval("selected=new Set(['dm']);comparisonRevision++;");await f.w.compare({skipLocation:true,scroll:false});assert(d.getElementById("publishedComparisonItems").textContent.includes("nahkauf"),"a legacy physical merchant filter cannot hide another online provider");
   f.w.eval("selected=new Set();comparisonRevision++;");assert.strictEqual(await f.w.compare({skipLocation:true,scroll:false}),true);assert(d.getElementById("publishedComparisonItems").textContent.includes("nahkauf"),"online alternatives remain usable without any selected physical market");assert.strictEqual(d.getElementById("winnerPrice").textContent,"—");
   f.w.eval("for(const offers of canonicalPublishedAlternatives.values())for(const offer of offers)offer.expiresAt=new Date(Date.now()-1).toISOString();renderPublishedComparison(basket);");assert.strictEqual(section.style.display,"none","rendering cannot keep showing source-expired offers");assert.strictEqual(section.querySelectorAll("article").length,0);
   assert.deepStrictEqual(f.errors,[],"the published shopping-list integration has no DOM/script errors");
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("success");try{
   assert.strictEqual(await f.w.compare({skipLocation:true,scroll:false}),true);
   assert.deepStrictEqual(f.errors,[],"browser integration must start without script errors");
   const queries=f.requests.filter(x=>x.path==="/v1/price-query"),prices=f.requests.filter(x=>x.path==="/v1/current-prices");assert(queries.length>=1,"the app discovers canonical products and stores through the backend");assert.strictEqual(prices.length,1,"one product request must compare all requested merchants together");
   assert.strictEqual(prices[0].body.productId,ids.product,"the price lookup must reuse the canonical product id");assert.strictEqual(prices[0].body.gtin,gtin);assert.deepStrictEqual(prices[0].body.merchants,["REWE","PENNY"]);assert.strictEqual(prices[0].body.storeIds.REWE,ids.rewe);assert.strictEqual(prices[0].body.storeIds.PENNY,ids.penny);
   const wish=f.w.eval("basket[0]"),price=f.w.activePrice("butter","REWE",wish);assert(price&&!price.reference,"a canonical evidenced price is current");assert.strictEqual(price.productId,ids.product);assert.strictEqual(price.storeId,ids.rewe);assert.strictEqual(price.proofHash,"hash:REWE");assert.strictEqual(price.per,"kg");assert(Math.abs(price.price-7.96)<1e-9,"250 g checkout cost converts coherently to a kg basis");assert(Math.abs(price.price*wish.calcAmount-1.99)<1e-9,"one selected 250 g package costs exactly its reported checkout price");
   assert.strictEqual(f.w.document.getElementById("winnerName").textContent,"REWE");assert(f.w.document.getElementById("winnerPrice").textContent.includes("1,99"),"the rendered basket total uses checkout value, not its kg quote");
   await f.w.compare({skipLocation:true,scroll:false});assert.strictEqual(f.requests.filter(x=>x.path==="/v1/current-prices").length,1,"an unchanged comparison reuses the fresh canonical decision");
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("success");try{
   await f.w.compare({skipLocation:true,scroll:false});
   assert.strictEqual(f.w.document.getElementById("verifiedSavings").style.display,"block","the fully evidenced butter comparison starts with a supported price difference");
   f.w.eval("basket.push({...parseWish('Batterien'),customItem:true,key:null,needsClarification:false,needsQuantity:false});comparisonRevision++;");
   assert.strictEqual(await f.w.compare({skipLocation:true,scroll:false}),true);
   const d=f.w.document,price=f.w.activePrice("butter","REWE",f.w.eval("basket[0]"));
   assert(price&&!price.reference,"an unpriced custom item must preserve the supported butter comparison");
   assert(!d.getElementById("winnerLabel").textContent.includes("vollständig belegter Warenkorb"),"excluding batteries must not label the two-item list as a fully evidenced basket");
   assert.strictEqual(d.getElementById("verifiedSavings").style.display,"none","a supported difference for butter must not become a whole-list saving when batteries have no price");
   assert((d.getElementById("winnerName").textContent+" "+d.getElementById("winnerCoverage").textContent).includes("Batterien"),"the partial comparison must visibly name the excluded list item");
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("success");try{
   f.w.eval("basket.push({label:'Batterien',raw:'Batterien',customItem:true});comparisonRevision++;");
   await f.w.compare({skipLocation:true,scroll:false});const d=f.w.document;
   assert(d.getElementById("winnerLabel").textContent.includes("Teilvergleich"),"a priced subset cannot claim the cheapest complete shopping list");
   assert(d.getElementById("winnerCoverage").textContent.includes("Batterien")&&d.getElementById("winnerCoverage").textContent.includes("1 von 2"),"excluded items and whole-list coverage must be visible");
   assert.strictEqual(d.getElementById("verifiedSavings").style.display,"none","an unpriced item blocks whole-basket savings claims");
   assert(d.getElementById("merchantResults").textContent.includes("Teilsumme"));
  }finally{f.dom.window.close()}
 }
 for(const mode of ["eggs","nutella"]){
  const f=await fixture(mode);try{await f.w.compare({skipLocation:true,scroll:false});const wish=f.w.eval("basket[0]"),price=f.w.activePrice(wish.key,"REWE",wish);assert(price&&!price.reference);assert(Math.abs(price.price*wish.calcAmount-1.99)<1e-9,"a "+mode+" package costs its checkout amount despite differing catalog or pack units");assert(f.w.document.getElementById("winnerPrice").textContent.includes("1,99"))}finally{f.dom.window.close()}
 }
 for(const mode of ["unknown","unreachable","wrong-store","wrong-product","observed","unreviewed","app","invalid-geo","no-location"]){
  const f=await fixture(mode);try{
   await f.w.compare({skipLocation:true,scroll:false});const price=f.w.activePrice("butter","REWE",f.w.eval("basket[0]"));
   assert(!price||price.reference,"server "+mode+" cannot revive the cheaper local observation as a current price");assert.strictEqual(f.w.document.getElementById("winnerPrice").textContent,"—","unusable canonical decisions cannot create a winner");assert.notStrictEqual(f.w.document.getElementById("winnerName").textContent,"REWE");
   if(mode==="observed"||mode==="unreviewed"){const quality=f.w.comparisonQuality({sources:[price],referenceCount:1,confirmedCount:0},1);assert.notStrictEqual(quality.label,"Modellschätzung","a real observed quote is not a modelled estimate");assert(quality.detail.includes("beobachtet"),"observed comparisons need an accurate evidence label")}
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("multi");try{
   await f.w.compare({skipLocation:true,scroll:false});const single=f.w.activePrice("butter","REWE",f.w.eval("basket[0]"));assert(!single||single.reference,"one pack cannot use an offer requiring three packs");
   f.w.eval("basket[0].packCount=3;basket[0].amount=.75;basket[0].calcAmount=.75;comparisonRevision++;");await f.w.compare({skipLocation:true,scroll:false});const multiple=f.w.activePrice("butter","REWE",f.w.eval("basket[0]"));assert(multiple&&!multiple.reference,"a sufficient updated quantity can use a canonical multi-buy quote");assert.strictEqual(f.requests.filter(x=>x.path==="/v1/current-prices").at(-1).body.quantity,3);assert(f.w.document.getElementById("winnerPrice").textContent.includes("5,97"),"quantity updates must replace the old eligibility decision and compute all three packs");
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("hold");try{
   const first=f.w.compare({skipLocation:true,scroll:false});await waitFor(()=>f.requests.some(x=>x.path==="/v1/current-prices"));
   f.w.eval("basket=[];comparisonRevision++;");assert.strictEqual(await f.w.compare({skipLocation:true,scroll:false}),false);f.release();assert.strictEqual(await first,false,"an older comparison cannot publish after the basket revision changes");assert.strictEqual(f.w.document.getElementById("results").style.display,"none","a stale response cannot resurrect the cleared comparison");
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("product-pick");try{
   const wish=f.w.eval("basket[0]");wish.packCount=3;await f.w.openPublishedProductPicker(0);
   const picker=f.w.document.getElementById("publishedProductPicker"),family=picker.querySelector('[data-product-family]'),form=picker.querySelector('form'),change=control=>control.dispatchEvent(new f.w.Event('change',{bubbles:true}));
   assert.equal(family.value,'',"Opening the picker retains general keyword search");assert.equal(f.requests.filter(row=>row.path==='/v1/shopping-need').length,0);
   family.value='milk';change(family);assert.equal(picker.querySelectorAll('[data-product-select]').length,0);assert.equal(picker.querySelector('[data-need-fields="milk"]').hidden,false);assert.equal(picker.querySelector('[data-need-fields="eggs"]').hidden,true);
   form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>picker.querySelector('[data-product-select]'));
   let need=f.requests.filter(row=>row.path==='/v1/shopping-need').at(-1);assert.deepEqual(need.body.constraints,{family:'milk'},"Blank controls impose no fat, process or lactose defaults");assert.equal(need.body.limit,20);assert.equal(need.options.method,'POST');assert.equal(need.options.credentials,'omit');assert(picker.textContent.includes('Gewünschte Eigenschaften belegt'));assert(picker.textContent.includes('Online'));
   const processing=picker.querySelector('[data-need-fields="milk"] [data-need-field="processing"]'),fat=picker.querySelector('[data-need-field="fatPercent"]'),lactose=picker.querySelector('[data-need-field="lactose"]');processing.value='uht';change(processing);fat.value='1,5';fat.dispatchEvent(new f.w.Event('input',{bubbles:true}));lactose.value='contains';change(lactose);
   form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>picker.querySelector('[data-product-select]'));
   need=f.requests.filter(row=>row.path==='/v1/shopping-need').at(-1);assert.deepEqual(need.body.constraints,{family:'milk',processing:'uht',fatPercent:1.5,lactose:'contains'});assert(picker.textContent.includes('Noch offen: Laktose'),"Missing native evidence remains visible even when other traits match");assert.equal(wish.ean,undefined,"No confirmed or unconfirmed variant is selected automatically");
   const button=picker.querySelector('[data-product-select]');fat.value='3,5';button.click();assert.equal(wish.ean,undefined,"Programmatic property changes invalidate a visible older choice without requiring an input event");assert.equal(picker.querySelectorAll('[data-product-select]').length,0);
   fat.value='1,5';form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>picker.querySelector('[data-product-select]'));picker.querySelector('[data-product-select]').click();assert.equal(wish.ean,'4046700026519');assert.equal(wish.packCount,3);assert.equal(f.w.document.getElementById('publishedProductPicker'),null);
   const saved=JSON.parse(f.w.localStorage.getItem('sparkorb_basket_state_v1'))[0];assert(saved.selectedProduct);for(const field of['needAssessment','nativeProof','offers','physicalOffers','price'])assert.equal(saved.selectedProduct[field],undefined,"Persist only the consciously selected identity: "+field);assert.deepEqual(f.errors,[]);
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("product-need-invalid");try{
   await f.w.openPublishedProductPicker(0);const picker=f.w.document.getElementById('publishedProductPicker'),family=picker.querySelector('[data-product-family]'),fat=picker.querySelector('[data-need-field="fatPercent"]');family.value='milk';family.dispatchEvent(new f.w.Event('change',{bubbles:true}));
   const getBefore=f.requests.filter(row=>row.path==='/v1/published-products').length;picker.querySelector('form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>picker.textContent.includes('Bitte prüfe deinen Bedarf'));
   assert.equal(f.requests.filter(row=>row.path==='/v1/published-products').length,getBefore,"HTTP400 never silently falls back to an unrestricted search");assert.equal(picker.querySelectorAll('[data-product-select]').length,0);
   const posts=f.requests.filter(row=>row.path==='/v1/shopping-need').length;fat.value='1-3';picker.querySelector('form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>picker.textContent.includes('Bitte prüfe deinen Bedarf'));assert.equal(f.requests.filter(row=>row.path==='/v1/shopping-need').length,posts,"Invalid numeric controls are rejected before API work");
   assert.deepEqual(f.errors,[]);
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("product-need-hold");try{
   await f.w.openPublishedProductPicker(0);const picker=f.w.document.getElementById('publishedProductPicker'),family=picker.querySelector('[data-product-family]');family.value='milk';family.dispatchEvent(new f.w.Event('change',{bubbles:true}));picker.querySelector('form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>f.requests.some(row=>row.path==='/v1/shopping-need'));
   const held=f.requests.find(row=>row.path==='/v1/shopping-need');family.value='';family.dispatchEvent(new f.w.Event('change',{bubbles:true}));picker.querySelector('input').value='Butter';picker.querySelector('form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>picker.textContent.includes('Butter Auswahl'));
   assert.equal(held.options.signal.aborted,true,"Changing the family aborts the older bounded POST");f.releaseSearch();await new Promise(resolve=>setTimeout(resolve,30));assert(picker.textContent.includes('Butter Auswahl'));assert(!picker.textContent.includes('Gewünschte Eigenschaften belegt'));assert.equal(f.w.eval('basket[0].ean'),undefined);assert.deepEqual(f.errors,[]);
  }finally{f.dom.window.close()}
 }
 {
  const f=await fixture("product-pick");try{
   await f.w.openPublishedProductPicker(0);const picker=f.w.document.getElementById('publishedProductPicker'),family=picker.querySelector('[data-product-family]'),form=picker.querySelector('form'),change=control=>control.dispatchEvent(new f.w.Event('change',{bubbles:true}));
   family.value='milk';change(family);picker.querySelector('[data-need-field="fatPercent"]').value='1,5';
   family.value='bread';change(family);picker.querySelector('input').value='Brot';const sliced=picker.querySelector('[data-need-field="sliced"]');assert.equal(sliced.value,'');sliced.value='false';change(sliced);form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>f.requests.some(row=>row.path==='/v1/shopping-need'&&row.body.constraints.family==='bread'));
   assert.deepEqual(f.requests.filter(row=>row.path==='/v1/shopping-need').at(-1).body.constraints,{family:'bread',sliced:false},"False remains an explicit requirement and hidden milk properties are excluded");
   family.value='eggs';change(family);picker.querySelector('input').value='Eier';const raw=picker.querySelector('[data-need-field="raw"]');assert.equal(raw.value,'');raw.value='true';change(raw);form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await waitFor(()=>f.requests.some(row=>row.path==='/v1/shopping-need'&&row.body.constraints.family==='eggs'));
   assert.deepEqual(f.requests.filter(row=>row.path==='/v1/shopping-need').at(-1).body.constraints,{family:'eggs',raw:true});assert.deepEqual(f.errors,[]);
  }finally{f.dom.window.close()}
 }
 console.log("browser-canonical-price: canonical identity, branch scope, units, optional typed needs, native traits, manual selection and revision gates ok");
})().catch(error=>{console.error(error);process.exitCode=1});
