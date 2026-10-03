"use strict";

const assert=require("node:assert/strict"),crypto=require("node:crypto"),fs=require("node:fs"),path=require("node:path"),{JSDOM}=require("jsdom");
const Client=require("../rewe-retailer-price-client"),Articles=require("../rewe-retailer-article-service"),Directory=require("../assortment-article-directory"),Types=require("../grocery-article-type-service"),View=require("../app/assortment-overview"),master=require("../data/grocery-assortment.json"),fixture=require("./fixtures/retailers/rewe-berlin-pickup.json");
const copy=structuredClone,sha=value=>crypto.createHash("sha256").update(value).digest("hex"),canonical=value=>Array.isArray(value)?value.map(canonical):value!==null&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value,hash=value=>sha(JSON.stringify(canonical(value)));
const TYPE="milch-sahne.frische-kuhmilch",category=Client.parseCategories(fixture.filters).categories[0],html=fs.readFileSync(path.join(__dirname,"../sortiment.html"),"utf8");
const pause=()=>new Promise(resolve=>setTimeout(resolve,230)),ok=body=>({ok:true,json:async()=>body});
let groups=0;async function check(label,fn){await fn();groups++;}

// Every changed name, identifier and clock below belongs to an authored
// synthetic original. Archived retailer responses are never retimed or imported.
function native(index,name="REWE Beste Wahl Frische Kuhmilch Vollmilch 1 l"){
 const item=copy(fixture.items[0]),id="UITEST"+String(index).padStart(4,"0"),product=String(9000000+index);
 Object.assign(item,{articleId:id,listingId:"8-"+id+"-"+Client.NATIVE_STORE_ID,productId:product,detailsUrl:"/p/unit-test-milk-"+index+"/"+product,title:name,gtin:null,baseQuantity:1,quantityType:"L",volumeCode:"STK",viewInfo:{detailsViewRequired:false},brand:"REWE Beste Wahl",pricing:{grammage:"1l"}});
 delete item.multi1;delete item.hasVariants;delete item.hasDiverseVariantPrices;
 return item;
}
function original(items,pageNumber,total,clock){
 const raw={hits:items,pagination:{objectsPerPage:40,currentPage:pageNumber,pageCount:Math.ceil(total/40),objectCount:total},search:{marketCode:Client.MARKET_ID,serviceTypes:["PICKUP"],activeCategorySlug:category.slug}},body=JSON.stringify(raw),capturedAt=new Date(clock).toISOString();
 return{body,category:copy(category),pageNumber,meta:{status:200,sourceResponseUrl:Client.PRODUCTS_URL+"?categorySlug="+category.slug+"&marketId="+Client.MARKET_ID+"&serviceTypes=PICKUP&page="+pageNumber+"&objectsPerPage=40",sourceResponseHash:sha(body),capturedAt,sourceResponseDate:new Date(Math.floor(clock/1000)*1000).toISOString(),sourceAgeSeconds:null,responseDate:new Date(clock).toUTCString(),responseAge:null,contentType:Client.PRODUCTS_ACCEPT,bytes:Buffer.byteLength(body)}};
}
function ledger(items,clock=Date.now()-1000){
 const originals=[],rows=[],bodies=new Map(),proofs=new Map(),queries=[];
 for(let offset=0;offset<items.length;offset+=40){
  const source=original(items.slice(offset,offset+40),offset/40+1,items.length,clock),parsed=Client.reparseOriginalPage(source,{now:clock});
  assert.equal(parsed.products.length,Math.min(40,items.length-offset),"Every fixture article passes actual original-page identity extraction");assert.equal(parsed.offers.length,0,"No-price originals yield no current price offer");
  originals.push(source);bodies.set(source.meta.sourceResponseHash,{source_response_hash:source.meta.sourceResponseHash,body:source.body,body_bytes:source.meta.bytes});
  for(const article of parsed.products){const row={...Articles.rowForArticle(article,source),held:false,conflict_capture:null};rows.push(row);const proofHash=hash(row.original_metadata);proofs.set(proofHash,{capture_proof_hash:proofHash,source_response_hash:row.source_response_hash,original_metadata:row.original_metadata,admissible:true});}
 }
 const pool={query:async(sql,params=[])=>{
  queries.push({sql,params:copy(params)});
  if(sql.includes("CREATE TABLE"))return{rows:[]};
  if(sql.includes("FROM "+Articles.CAPTURE_TABLE+" WHERE"))return{rows:params[0].map(key=>bodies.get(key)).filter(Boolean)};
  if(sql.includes("FROM "+Articles.PROOF_TABLE+" WHERE"))return{rows:params[0].map(key=>proofs.get(key)).filter(Boolean)};
  if(sql.startsWith("SELECT * FROM "+Articles.TABLE+" WHERE")){
   assert.equal(params[0],Articles.SOURCE);const time=Date.parse(params[1]);let candidates=rows.filter(row=>Date.parse(row.observed_at)<=time);
   if(sql.includes("ILIKE")){const term=params[2].slice(1,-1).replace(/\\([\\%_])/g,"$1").toLocaleLowerCase();candidates=candidates.filter(row=>[row.article.name,row.article.brand].some(value=>typeof value==="string"&&value.toLocaleLowerCase().includes(term)));}
   candidates.sort((a,b)=>b.observed_at.localeCompare(a.observed_at)||a.retailer_sku.localeCompare(b.retailer_sku));return{rows:candidates.slice(params.at(-1),params.at(-1)+params.at(-2))};
  }
  throw Error("Unexpected offline reader SQL: "+sql);
 }};
 const empty=async(_pool,q)=>({ok:true,sourceId:q.merchant==="ALDI Nord"?"ALDI Nord native article directory":"Wolt EDEKA Berlin",scopeCountry:"DE",scopeChannel:q.scopeChannel,truthEligible:false,items:[],scannedRows:0,nextOffset:q.offset||0,hasMore:false});
 const directory={status:async()=>{throw Error("Unexpected status read");},search:(_pool,q)=>Directory.search(pool,q,{rewe:Articles,aldi:{search:empty},wolt:{search:empty}})};
 return{pool,rows,originals,queries,bodies,proofs,directory,search:q=>directory.search(pool,q),typed:q=>Types.search(pool,q,{directory})};
}
async function ui(store,transform=value=>value){
 const dom=new JSDOM(html,{url:"https://unit-test.invalid/sortiment.html"}),document=dom.window.document,calls=[];
 const mounted=View.mount(document,async url=>{
  if(url==="data/grocery-assortment.json")return ok(master);
  const parsed=new URL(url);calls.push(parsed);if(parsed.pathname==="/v1/assortment/type-mapping")return ok(Types.mappingStatus());
  assert(["/v1/assortment/articles","/v1/assortment/typed-articles"].includes(parsed.pathname),"Only owned read-only assortment route is requested");
  const query=Object.fromEntries(parsed.searchParams);for(const field of ["limit","offset"])if(query[field]!==undefined)query[field]=Number(query[field]);
  const data=parsed.pathname.endsWith("/typed-articles")?await store.typed(query):await store.search(query);return ok(transform(data));
 });
 await mounted.ready;
 const merchant=name=>{const button=[...document.querySelectorAll("#merchantFilter button")].find(item=>item.textContent===name);assert(button);button.click();};
 const selectType=()=>{if(document.getElementById("masterPanel").hidden)document.getElementById("masterTab").click();document.getElementById("clearSearch").click();const button=document.querySelector('[data-product-type-id="'+TYPE+'"]');assert(button);button.click();};
 return{dom,document,calls,merchant,selectType};
}
function noAuthority(value){for(const field of ["price","current","expiresAt","nativeWitness","body","original_metadata","article","sourceResponseRaw"])assert(!Object.hasOwn(value,field),"Public Directory item has no "+field);assert.equal(value.gtin,null);assert.equal(value.availability,"unknown");for(const field of ["truthEligible","currentPriceVerified","physicalStorePriceVerified","normalPriceClassificationVerified","assortmentComplete","pricedOnly"])assert.equal(value[field],false);assert.equal(value.independentOfPrice,true);}
async function main(){
 const store=ledger([native(1)]),before=JSON.stringify(store.originals),raw=await store.search({merchant:"REWE",limit:50});
 await check("actual original/body/proof reader produces dated price-less Directory identity",()=>{assert.equal(raw.items.length,1);const item=raw.items[0];noAuthority(item);assert.equal(item.sourceId,Articles.SOURCE);assert.equal(item.pack,"1l");assert.equal(item.packAmount,1000);assert.equal(item.packUnit,"ml");assert.equal(item.packCount,1);assert.equal(item.shop.address,Client.MARKET.address);assert.equal(item.shop.city,"Berlin");assert.equal(item.scopeChannel,"pickup");assert.equal(item.observedAt,store.originals[0].meta.capturedAt);assert.equal(item.sourceResponseHash,store.originals[0].meta.sourceResponseHash);assert(store.queries.some(q=>q.sql.includes(Articles.CAPTURE_TABLE+" WHERE")));assert(store.queries.some(q=>q.sql.includes(Articles.PROOF_TABLE+" WHERE")));});
 await check("real Types.search binds milk assignment to original native source and capture",async()=>{const typed=await store.typed({merchant:"REWE",limit:50,productTypeId:TYPE,search:"Milch"});assert.equal(typed.items.length,1);assert.equal(typed.typeAnnotations[0].annotation.state,"assigned");assert.equal(typed.typeAnnotations[0].binding.sourceId,Articles.SOURCE);assert.equal(typed.typeAnnotations[0].binding.observedAt,store.originals[0].meta.capturedAt);assert.equal(View.typedItems(typed,"REWE",TYPE,0).length,1);noAuthority(typed.items[0]);});
 await check("UI renders native pack, pickup market, original date and safe product evidence link",async()=>{const view=await ui(store);try{view.document.getElementById("articlesTab").click();await pause();view.merchant("REWE");await pause();const card=view.document.querySelector(".article-card");assert(card);assert.equal(card.querySelector("h3").textContent,raw.items[0].name);assert(card.textContent.includes("Verkaufspackung: 1l"));assert(card.textContent.includes("Hallesches Ufer 40"));assert(card.textContent.includes("Berlin"));assert(card.textContent.includes("Abholangebot"));assert(card.textContent.includes("Zuletzt erfasst:"));assert(card.textContent.includes("unbestätigt"));const link=card.querySelector("a");assert.equal(link.href,raw.items[0].sourceUrl);assert.equal(link.rel,"noopener noreferrer");assert(!card.textContent.includes("€"));assert(!card.textContent.includes("Normalpreis"));assert(!card.textContent.includes("private"));assert(view.document.getElementById("articleScope").textContent.includes("kein aktueller Preis"));assert.equal(view.document.getElementById("typeCount").textContent,"705");assert.equal(view.document.getElementById("loadMore").hidden,true);}finally{view.dom.window.close();}});
 await check("actual typed UI milk pipeline has source-bound badge and no price authority",async()=>{const view=await ui(store);try{view.selectType();await pause();view.merchant("REWE");await pause();assert.equal(view.document.querySelectorAll(".article-card").length,1);assert(view.document.querySelector(".type-badge").textContent.includes("Frische Kuhmilch"));assert(!view.document.getElementById("articleList").textContent.includes("€"));assert(view.calls.some(q=>q.pathname.endsWith("/typed-articles")&&q.searchParams.get("merchant")==="REWE"&&q.searchParams.get("search")==="Milch"));}finally{view.dom.window.close();}});
 await check("legacy priced-only REWE source cannot reenter native article display",()=>{const legacy={...raw.items[0],sourceId:"REWE Berlin pickup",pricedOnly:true,independentOfPrice:false};assert.equal(View.safeArticle(legacy),null);assert.equal(Articles.validateView({...legacy,price:1.19}).ok,false);});
 await check("corrupt original bytes are held by actual reader before Directory or UI",async()=>{const source=ledger([native(2)]);source.bodies.get(source.rows[0].source_response_hash).body+=" ";assert.equal((await source.search({merchant:"REWE",limit:50})).items.length,0);});
 await check("unadmitted/forged original metadata proof is not a display identity",async()=>{for(const change of [proof=>{proof.admissible=false;},proof=>{proof.original_metadata.meta.capturedAt=new Date(Date.now()-100).toISOString();}]){const source=ledger([native(3)]),key=hash(source.rows[0].original_metadata);source.proofs.set(key,copy(source.proofs.get(key)));change(source.proofs.get(key));assert.equal((await source.search({merchant:"REWE",limit:50})).items.length,0);}});
 await check("original private witnesses never enter either raw or typed public DTO",async()=>{const typed=await store.typed({merchant:"REWE",limit:50,productTypeId:TYPE});for(const item of [...raw.items,...typed.items])noAuthority(item);for(const data of [raw,typed]){const serialized=JSON.stringify(data);for(const secret of ["nativeWitness","original_metadata","responseDate","currentRetailPrice","body_bytes"])assert(!serialized.includes('"'+secret+'"'));}assert.equal(JSON.stringify(store.originals),before);});
 await check("genuine REWE raw reader pagination scans 50 then next native articles",async()=>{const source=ledger(Array.from({length:53},(_,i)=>native(100+i))),view=await ui(source);try{view.document.getElementById("articlesTab").click();await pause();view.merchant("REWE");await pause();assert.equal(view.document.querySelectorAll(".article-card").length,50);assert.equal(view.document.getElementById("loadMore").hidden,false);view.document.getElementById("loadMore").click();await pause();assert.equal(view.document.querySelectorAll(".article-card").length,53);assert.equal(view.document.getElementById("loadMore").hidden,true);assert.deepEqual(view.calls.filter(q=>q.searchParams.get("merchant")==="REWE").map(q=>Number(q.searchParams.get("offset")||0)),[0,50]);assert(!view.document.getElementById("articleList").textContent.includes("€"));}finally{view.dom.window.close();}});
 await check("an empty first typed page keeps real REWE scanned-row offset and load more",async()=>{const source=ledger([...Array.from({length:50},(_,i)=>native(200+i,"REWE Beste Wahl Hafermilch 1 l")),native(250)]),page=await source.typed({merchant:"REWE",limit:50,productTypeId:TYPE,search:"Milch"});assert.equal(page.items.length,0);assert.equal(page.scannedRows,50);assert.equal(page.nextOffset,50);assert.equal(page.hasMore,true);const view=await ui(source);try{view.selectType();await pause();view.merchant("REWE");await pause();assert.equal(view.document.querySelectorAll(".article-card").length,0);assert.equal(view.document.getElementById("loadMore").hidden,false);assert(view.document.getElementById("articleResult").textContent.includes("Ergebnisseite"));view.document.getElementById("loadMore").click();await pause();assert.equal(view.document.querySelectorAll(".article-card").length,1);assert(view.document.querySelector(".article-card h3").textContent.includes("Vollmilch"));assert.equal(view.document.getElementById("loadMore").hidden,true);assert.deepEqual(view.calls.filter(q=>q.searchParams.get("merchant")==="REWE").map(q=>[q.searchParams.get("productTypeId"),Number(q.searchParams.get("offset")||0)]),[[TYPE,0],[TYPE,50]]);}finally{view.dom.window.close();}});
 await check("Directory and typed queries retain closed native pagination bounds",async()=>{for(const q of [{offset:10001},{limit:201},{offset:-1},{offset:"050"},{offset:NaN}]){await assert.rejects(()=>store.search({merchant:"REWE",...q}),/invalid-article-directory/);await assert.rejects(()=>store.typed({merchant:"REWE",productTypeId:TYPE,...q}),/invalid/);}assert.equal((await store.search({merchant:"REWE",offset:10000,limit:50})).hasMore,false);});
 console.log("rewe-native-article-ui: "+groups+" groups verified; actual original→reader→Directory→Types→JSDOM chain, synthetic responses only, no merchant/DB/HTTP calls");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
