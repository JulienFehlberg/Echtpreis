"use strict";
const assert=require("assert"),fs=require("fs"),{JSDOM,VirtualConsole}=require("jsdom");
const ids={product:"11111111-1111-4111-8111-111111111111",rewe:"22222222-2222-4222-8222-222222222222",penny:"33333333-3333-4333-8333-333333333333"},gtin="4008400401627";
const product={id:ids.product,name:"Testbrand Butter",brand:"Testbrand",gtin,pack:"250 g",packAmount:250,packUnit:"g",packCount:1,canonicalKey:"butter",canonical:true,matchType:"exact"};
const stores=[{id:ids.rewe,merchant:"REWE",merchantKey:"rewe",address:"Teststraße 1",city:"Berlin",region:"Berlin",latitude:52.52,longitude:13.40,distanceKm:.1,canonical:true,matchType:"candidate"},{id:ids.penny,merchant:"PENNY",merchantKey:"penny",address:"Teststraße 2",city:"Berlin",region:"Berlin",latitude:52.521,longitude:13.40,distanceKm:.2,canonical:true,matchType:"candidate"}];
function discovery(mode){const found=mode==="eggs"?{...product,name:"Testbrand Eier",pack:"6 Stück",packAmount:6,packUnit:"piece"}:mode==="nutella"?{...product,name:"Nutella",brand:"Ferrero",pack:"450 g",packAmount:450}:product;return{ok:true,productResolution:{state:"exact",mode:"gtin",reason:"canonical-gtin"},products:[found],product:found,storeResolution:{state:"candidate",mode:"nearby",reason:"store-selection-required"},stores,refreshTargets:[],requiresProductSelection:false,requiresStoreSelection:true}}
function row(merchant,today,mode){
 const store=stores.find(x=>x.merchant===merchant),price=merchant==="REWE"?1.99:2.49;
 if(mode==="unknown")return{merchant,state:"unknown",price:null,reason:"conflicting-current-evidence",truth:{state:"conflict"}};
 const quote={merchant,state:mode==="observed"?"observed":"verified",kind:"receipt",status:mode==="observed"?"observed":"verified",identityVerified:mode!=="unreviewed",proofVerified:mode!=="unreviewed",price,payablePrice:price,currency:"EUR",priceType:mode==="app"?"app":mode==="multi"?"multi_buy":"regular",conditional:mode==="app"||mode==="multi",minQuantity:mode==="multi"?3:null,product:"Testbrand Butter 250 g",productId:mode==="wrong-product"?ids.penny:ids.product,brand:"Testbrand",pack:"250 g",gtin,storeId:mode==="wrong-store"?ids.product:store&&store.id,region:"Berlin",locationLevel:"store",observedAt:today,confidence:93,queryMode:"exact",match:"ground-truth",proof:"receipt:"+merchant,proofHash:"hash:"+merchant,proofActor:"actor",source:"SPARKORB receipt",sourceType:"receipt",truthTier:3,priceAuthority:"observed-evidence",per:"piece",unitPrice:price*4,unit:"kg",packParsed:{amount:250,unit:"g",base:"kg",factor:1000},publicReferencePrice:2.99,truth:{state:mode==="observed"?"observed":"supported",independentEvidence:mode==="observed"?1:2,sourceTypes:1,strength:1.8}};
 if(mode==="eggs")Object.assign(quote,{product:"Testbrand Eier 6 Stück",pack:"6 Stück",unit:"piece",unitPrice:price/6,packParsed:{amount:6,unit:"piece",base:"piece",factor:1}});
 if(mode==="nutella")Object.assign(quote,{product:"Nutella 450 g",brand:"Ferrero",pack:"450 g",unitPrice:price/.45,packParsed:{amount:450,unit:"g",base:"kg",factor:1000}});
 return quote;
}
async function fixture(mode){
 const requests=[],errors=[],vc=new VirtualConsole();let release;
 vc.on("jsdomError",error=>errors.push(String(error.message||error)));
 const dom=new JSDOM(fs.readFileSync("index.html","utf8"),{runScripts:"dangerously",url:"https://example.test/",pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.SPARKORB_CONFIG={apiBase:"https://prices.example.test"};
  w.fetch=async(url,options={})=>{
   const path=new URL(String(url),"https://example.test/").pathname;
   if(path==="/v1/price-query"){requests.push({path,body:options.body?JSON.parse(options.body):{}});const value=discovery(mode);if(mode==="invalid-geo")value.stores=value.stores.map(x=>({...x,distanceKm:null,latitude:null,longitude:null}));return{ok:true,json:async()=>value}}
   if(path==="/v1/current-prices"){
    const body=JSON.parse(options.body);requests.push({path,body});
    if(mode==="unreachable")throw new Error("connection unavailable");
    const result={ok:true,today:body.today,results:body.merchants.map(m=>row(m,body.today,mode))};
    if(mode==="hold")return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>result})});
    return{ok:true,json:async()=>result};
   }
   return{ok:false,status:503,json:async()=>({})};
  };
  w.eval(fs.readFileSync("app/price-engine.js","utf8"));w.eval(fs.readFileSync("app/current-price-client.js","utf8"));
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
 return{dom,w,requests,errors,release:()=>release&&release()};
}
async function waitFor(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5))}throw new Error("expected canonical request was not issued")}

(async()=>{
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
 console.log("browser-canonical-price: canonical identity, branch scope, units, no revival and revision gates ok");
})().catch(error=>{console.error(error);process.exitCode=1});
