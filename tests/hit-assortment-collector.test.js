"use strict";
const assert=require("node:assert/strict"),crypto=require("node:crypto"),Collector=require("../hit-assortment-collector");
const store={storeId:1775,storeNumber:"258",name:"Berlin-Mitte",city:"Berlin",country:"DE",officialUrl:"https://www.hit.de/maerkte/berlin-mitte"};
const clock=Date.parse(Collector.COOLDOWN_UNTIL)+60000,clone=structuredClone;
const attr=x=>JSON.stringify(x).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const cat=(id,name,path,level,count,order)=>({id,name,url:"https://www.hit.de"+path,level,count,order});
const dairy=cat(4261253,"Kaese, Eier & Molkerei","/sortiment/kaese-eier-molkerei-4261253",1,3,1);
const milkParent=cat(4261298,"Milch","/sortiment/kaese-eier-molkerei/milch-4261298",2,2,2);
const milkLeaf=cat(4261891,"H- Kuh","/sortiment/kaese-eier-molkerei/milch-h-kuh-4261891",3,2,3);
const butterParent=cat(4261321,"Butter & Fette","/sortiment/kaese-eier-molkerei/butter-fette-4261321",2,1,4);
const butterLeaf=cat(4261911,"Butter abgepackt","/sortiment/kaese-eier-molkerei/butter-fette-butter-abgepackt-4261911",3,1,5);
// Real native identities, quantity literals and unconditional tags from the saved public HIT Berlin payloads.
const product=(sku,ean,name,pack,price,type="discount")=>({
 external_id:sku,ean,storeId:1775,storeNumber:"258",headline:name,overview:pack,price,deposit:null,
 url:"https://www.hit.de/sortiment/kaese-eier-molkerei/milch-h-kuh-4261891/produkt-"+sku,
 inventoryAvailable:true,inventoryUpdatedAt:"2026-10-01T19:24:29+02:00",
 priceTag:{type,badgeText:type==="discount"?"DAUER\nDISCOUNT\nPREIS":null,priceEuro:price.split(".")[0],priceCent:price.split(".")[1],priceStrikeThroughText:null,beforeText:null,belowText:null,couponCode:null,couponName:null,highlightUntil:type==="discount"?"2026-10-01T23:59:59+00:00":null}
});
const milk=product("000000000000548963ST","4388860095920","REWE BIO H-Vollmilch 3,8%","1l Packung","1.25");
const ordinary=product("000000000000866799ST","4388844268159","ja! H-Milch 3,5%","1l Packung","0.95");
const butter=product("000000000000156719ST","4008452010222","Weihenstephan Butter","250g Packung","2.79","standard");
const listing=(rows,node=null,categories=[],total=rows.length,limit=2,overrides={})=>{
 const data={data:rows,pagination:{page:0,limit,total},meta:node?{category:{id:String(node.id)},is_exact_match:true}:{is_exact_match:true},filters:{categories},status:200,...overrides.data};
 const params={for_store:1775,limit,return_exact_match:"1",...(node?{for_category:String(node.id)}:{}),...overrides.params};
 return '<div data-component="assortment/list" data-data="'+attr(data)+'" data-params="'+attr(params)+'"></div>';
};
const navigation=nodes=>nodes.map(n=>'<a href="'+n.url+'" class="ga_filter_assortment_category"><span class="hit-font-h5">'+n.name.replace(/&/g,"&amp;")+'</span></a>').join("");
const choice=(quoted=false)=>'<a href='+(quoted?'"'+store.officialUrl+'?mein-markt=1"':store.officialUrl+'?mein-markt=1')+'>Mein Markt</a>';
function fixture(){
 return{
  "/sortiment":navigation([dairy]),
  "/sortiment/uebersicht":listing([milk,ordinary],null,[dairy],3),
  [new URL(dairy.url).pathname]:listing([milk,ordinary],dairy,[dairy,milkParent,butterParent],3),
  [new URL(milkParent.url).pathname]:listing([milk,ordinary],milkParent,[dairy,milkParent,milkLeaf],2),
  [new URL(butterParent.url).pathname]:listing([butter],butterParent,[dairy,butterParent,butterLeaf],1),
  [new URL(milkLeaf.url).pathname]:listing([milk,ordinary],milkLeaf,[dairy,milkParent,milkLeaf],2),
  [new URL(butterLeaf.url).pathname]:listing([butter],butterLeaf,[dairy,butterParent,butterLeaf],1)
 };
}
function queuedBasicsFixture(){
 const cosmetics=cat(4261244,"Drogerie & Kosmetik","/sortiment/drogerie-kosmetik-4261244",1,0,999),routes=fixture();
 routes["/sortiment"]=navigation([dairy,cosmetics]);routes["/sortiment/uebersicht"]=listing([milk,ordinary],null,[dairy,cosmetics],3);
 routes[new URL(cosmetics.url).pathname]=listing([],cosmetics,[cosmetics],0);return{routes,cosmetics};
}
function harness(routes=fixture(),options={}){
 let time=options.clock??clock;const calls=[],delays=[];
 const response=(body,opts={})=>{
  const headers=new Headers({"content-type":"text/html; charset=UTF-8",date:new Date(time).toUTCString(),age:"0"});
  for(const [name,value]of Object.entries(opts.headers||{}))if(value===null)headers.delete(name);else headers.set(name,value);
  for(const cookie of opts.cookies||[])headers.append("set-cookie",cookie);
  return new Response(body,{status:opts.status||200,headers});
 };
 const fetchImpl=async(url,init)=>{
  const parsed=new URL(url),call={url,at:time,init:{...init,headers:{...init.headers}}};calls.push(call);
  assert.equal(init.method,"GET");assert.equal(init.redirect,"manual");assert(init.signal instanceof AbortSignal);
  if(options.route)return options.route(parsed,call,calls.length,response);
  if(parsed.pathname===new URL(store.officialUrl).pathname)return response(parsed.searchParams.has("mein-markt")?"Guest market selected":choice(),parsed.searchParams.has("mein-markt")?options.selection||{}:options.market||{});
  const spec=routes[parsed.pathname];assert.notEqual(spec,undefined,"Unobserved category request "+url);
  return typeof spec==="string"?response(spec):response(spec.body,spec);
 };
 return{calls,delays,now:()=>time,options:{storeProfile:store,fetchImpl,now:()=>time,maxRequests:16,pauseMs:1000,delay:async ms=>{assert(Number.isFinite(ms)&&ms>=1000);delays.push(ms);time+=ms}}};
}
async function collect(h,opts={}){const saved=Date.now;Date.now=h.now;try{return await Collector.collect({...h.options,...opts})}finally{Date.now=saved}}
const cases=[];const test=(name,run)=>cases.push({name,run});
const errorIncludes=(e,s)=>(e.code||e.message||"").includes(s);
test("native category URLs cover small leaves; duplicate parent rows never inflate distinct SKU progress",async()=>{
 const h=harness(),result=await collect(h);
 assert.equal(result.complete,true);assert.equal(result.categoryTraversalCycleComplete,true);assert.equal(result.nativePaginationComplete,true);assert.equal(result.publishedTraversalComplete,true);assert.equal(result.physicalStoreAssortmentComplete,false);
 assert.equal(result.total,3);assert.equal(result.received,3);assert.equal(result.pagesFetched,6);assert.equal(result.pages.length,6);assert.equal(result.requests,9);assert.equal(result.cursor,null);assert.equal(result.error,null);
 assert.deepEqual(result.accepted.map(c=>c.gtin),[milk.ean,ordinary.ean,butter.ean]);assert.equal(result.accepted[2].pack,"250g Packung");assert.equal(result.accepted[0].price,1.25);assert.equal(result.accepted[0].deposit,null);
 assert.equal(result.pages.reduce((n,p)=>n+p.uniqueRowCount,0),3);assert(result.pages.every(p=>p.uniqueRowCount<=p.rowCount&&p.pagination.page===0));assert(result.pages.every(p=>p.capturedAt&&p.sourceResponseHash.length===64));
 assert.deepEqual(result.categoryCoverage,{visited:6,pending:0,truncatedLeaves:[],unresolvedNodes:[],conflictingIdentities:[]});assert.deepEqual(result.conflictGtins,[]);assert(result.pages.every(p=>Array.isArray(p.conflictGtins)&&!p.conflictGtins.length));
 assert(h.calls.every(c=>!new URL(c.url).searchParams.has("page")));assert(h.calls.every(c=>!new URL(c.url).pathname.startsWith("/api/")));
 for(let n=1;n<h.calls.length;n++)assert(h.calls[n].at-h.calls[n-1].at>=1000);
 const firstBody=fixture()["/sortiment/uebersicht"];assert.equal(result.accepted[0].sourceResponseHash,crypto.createHash("sha256").update(firstBody).digest("hex"));
});
test("larger leaves preserve their first-page prices while reporting an explicit pagination gap",async()=>{
 const routes=fixture(),large={...milkLeaf,count:3};routes[new URL(milkParent.url).pathname]=listing([milk,ordinary],milkParent,[dairy,milkParent,large],3);routes[new URL(milkLeaf.url).pathname]=listing([milk,ordinary],large,[dairy,milkParent,large],3);
 const h=harness(routes),r=await collect(h);assert.equal(r.complete,true);assert.equal(r.nativePaginationComplete,false);assert.equal(r.publishedTraversalComplete,false);assert.equal(r.physicalStoreAssortmentComplete,false);
 assert.deepEqual(r.categoryCoverage.truncatedLeaves,[{id:String(milkLeaf.id),url:milkLeaf.url,total:3,received:2}]);assert.equal(r.accepted.length,3);assert(!h.calls.some(c=>c.url.includes("page=")));
});
test("missing or insufficient native child coverage stays unresolved even after a traversal cycle",async()=>{
 for(const children of [[],[{...milkParent,count:1}],[{...milkParent,count:null}]]){
  const routes=fixture();routes[new URL(dairy.url).pathname]=listing([milk,ordinary],dairy,[dairy,...children],3);
  const r=await collect(harness(routes));assert.equal(r.complete,true);assert.equal(r.nativePaginationComplete,false);assert(r.categoryCoverage.unresolvedNodes.some(n=>n.id===String(dairy.id)));
 }
});
test("a request-limited traversal resumes its exact offered queue and preserves the caller cursor",async()=>{
 const h=harness(),first=await collect(h,{maxRequests:5});assert.equal(first.complete,false);assert.equal(first.requests,5);assert.equal(first.pagesFetched,2);assert.equal(first.received,2);assert.equal(first.cursor.version,2);assert.equal(first.cursor.pending.length,2);
 const saved=clone(first.cursor),second=await collect(h,{maxRequests:6,cursor:first.cursor});assert.deepEqual(first.cursor,saved);assert.equal(second.complete,true);assert.equal(second.received,3);assert.equal(second.pagesFetched,6);assert.deepEqual(second.accepted.map(c=>c.gtin),[butter.ean]);
 assert.equal(h.calls[5].init.headers.Cookie,undefined);assert(second.pages.every(p=>p.categoryId!==null));
});
test("an existing native queue selects basics before cosmetics without losing newly enqueued children",async()=>{
 const {routes,cosmetics}=queuedBasicsFixture(),first=await collect(harness(routes),{maxRequests:5}),saved=clone(first.cursor);
 assert.deepEqual(first.cursor.pending.map(n=>n.id),[String(cosmetics.id),String(milkParent.id),String(butterParent.id)]);
 const h=harness(routes),selected=await collect(h,{cursor:first.cursor,maxRequests:3});assert.deepEqual(first.cursor,saved);assert.equal(selected.error,null);assert.equal(selected.requests,3);assert.equal(h.calls[2].url,milkParent.url);
 assert.deepEqual(selected.pages.map(p=>p.categoryId),[String(milkParent.id)]);assert.deepEqual(selected.cursor.pending.map(n=>n.id),[String(cosmetics.id),String(butterParent.id),String(milkLeaf.id)]);
 assert.equal(selected.pagesFetched,3);assert.equal(selected.received,2);assert.equal(selected.total,3);assert.deepEqual(selected.conflictGtins,[]);assert.equal(selected.nativePaginationComplete,false);assert.equal(selected.accepted.length,0);Collector.cursorFor(selected.cursor,store,selected.cursorDay);
 const beforeFinish=clone(selected.cursor),finished=await collect(harness(routes),{cursor:selected.cursor});assert.deepEqual(selected.cursor,beforeFinish);assert.equal(finished.error,null);assert.equal(finished.complete,true);assert.equal(finished.nativePaginationComplete,true);assert.equal(finished.publishedTraversalComplete,true);assert.equal(finished.physicalStoreAssortmentComplete,false);assert.equal(finished.cursor,null);
 assert.deepEqual(finished.pages.map(p=>p.categoryId),[String(butterParent.id),String(milkLeaf.id),String(butterLeaf.id),String(cosmetics.id)]);
 const pages=[...first.pages,...selected.pages,...finished.pages],quotes=[...first.accepted,...selected.accepted,...finished.accepted];assert.equal(new Set(pages.map(p=>p.categoryId)).size,7);assert.equal(pages.length,7);assert.equal(finished.pagesFetched,7);assert.equal(finished.received,3);assert.equal(pages.reduce((n,p)=>n+p.uniqueRowCount,0),3);assert.equal(pages.reduce((n,p)=>n+p.rowCount,0),10);
 assert.deepEqual(quotes.map(q=>[q.gtin,q.pack,q.price]),[[milk.ean,"1l Packung",1.25],[ordinary.ean,"1l Packung",0.95],[butter.ean,"250g Packung",2.79]]);assert.deepEqual(finished.conflictGtins,[]);assert.deepEqual(finished.categoryCoverage,{visited:7,pending:0,truncatedLeaves:[],unresolvedNodes:[],conflictingIdentities:[]});
 for(const p of pages){assert.equal(p.pagination.page,0);assert.equal(p.sourceResponseHash,crypto.createHash("sha256").update(routes[new URL(p.sourceResponseUrl).pathname]).digest("hex"));assert.equal(p.rowCount,Math.min(p.pagination.limit,p.pagination.total));}
 for(const q of quotes){const p=pages.find(p=>p.sourceResponseUrl===q.sourceResponseUrl&&p.sourceResponseHash===q.sourceResponseHash);assert(p);assert.equal(q.capturedAt,p.capturedAt);assert.equal(Date.parse(q.expiresAt)-Date.parse(q.capturedAt),86400000);assert.equal(q.nativeStoreId,1775);assert.equal(q.nativeStoreNumber,"258");}
});
test("equal native priorities preserve the existing cursor queue order",async()=>{
 const {routes,cosmetics}=queuedBasicsFixture(),first=await collect(harness(routes),{maxRequests:5}),cursor=clone(first.cursor);cursor.pending=[cursor.pending[0],cursor.pending[2],cursor.pending[1]];const saved=clone(cursor),h=harness(routes),r=await collect(h,{cursor,maxRequests:3});
 assert.deepEqual(cursor,saved);assert.equal(r.error,null);assert.equal(h.calls[2].url,butterParent.url);assert.deepEqual(r.cursor.pending.map(n=>n.id),[String(cosmetics.id),String(milkParent.id),String(butterLeaf.id)]);assert.equal(r.received,3);assert.equal(r.pagesFetched,3);assert.deepEqual(r.accepted.map(c=>c.gtin),[butter.ean]);
});
test("a failed non-head priority request retains every pending node and the source cooldown",async()=>{
 const {routes}=queuedBasicsFixture(),first=await collect(harness(routes),{maxRequests:5}),saved=clone(first.cursor);
 for(const failure of [{body:"Denied",status:403,headers:{"retry-after":"7200"}},{body:"Rate limited",status:429,headers:{"retry-after":"7200"}},{body:"<header>Berlin-Mitte</header>"}]){
  const broken={...routes,[new URL(milkParent.url).pathname]:failure},h=harness(broken),r=await collect(h,{cursor:first.cursor,maxRequests:16});assert.deepEqual(first.cursor,saved);assert.equal(h.calls.length,3);assert.equal(h.calls[2].url,milkParent.url);assert.equal(r.requests,3);assert.equal(r.complete,false);assert.equal(r.nativePaginationComplete,false);assert.equal(r.pages.length,0);assert.equal(r.accepted.length,0);assert.equal(r.received,first.received);assert.equal(r.pagesFetched,first.pagesFetched);assert.deepEqual(r.cursor,saved);assert.equal(r.error.code,failure.status?"hit-source-http-"+failure.status:"hit-native-pagination-unconfirmed");assert.equal(r.error.retryAfterMs,failure.status?7200000:3600000);
 }
});
test("non-head priority traversal preserves cycle quarantine and incomplete publication flags",async()=>{
 const {routes,cosmetics}=queuedBasicsFixture(),conflict=clone(milk);conflict.price="1.45";conflict.priceTag.priceCent="45";routes[new URL(dairy.url).pathname]=listing([conflict,ordinary],dairy,[dairy,milkParent,butterParent],3);
 const first=await collect(harness(routes),{maxRequests:5}),saved=clone(first.cursor);assert.deepEqual(first.conflictGtins,[milk.ean]);const r=await collect(harness(routes),{cursor:first.cursor});assert.deepEqual(first.cursor,saved);assert.equal(r.error,null);assert.equal(r.complete,true);assert.equal(r.nativePaginationComplete,false);assert.equal(r.publishedTraversalComplete,false);assert.equal(r.physicalStoreAssortmentComplete,false);assert.equal(r.received,3);assert.equal(r.pagesFetched,7);assert.deepEqual(r.conflictGtins,[milk.ean]);assert.deepEqual(r.categoryCoverage.conflictingIdentities,[milk.ean]);assert.deepEqual(r.pages.map(p=>p.categoryId),[String(milkParent.id),String(butterParent.id),String(milkLeaf.id),String(butterLeaf.id),String(cosmetics.id)]);assert.deepEqual(r.accepted.map(c=>c.gtin),[butter.ean]);assert(![...first.accepted,...r.accepted].some(c=>c.gtin===milk.ean));
});
test("a new Berlin day requires a fresh cycle and accepts a real later price capture",async()=>{
 const before=Date.parse("2026-10-01T21:59:30.000Z"),after=Date.parse("2026-10-01T22:00:01.000Z"),first=await collect(harness(fixture(),{clock:before}),{maxRequests:5}),original=clone(first.cursor);
 assert.equal(first.cursorDay,"2026-10-01");assert.equal(first.accepted[0].price,1.25);
 const expired=harness(fixture(),{clock:after});await assert.rejects(()=>collect(expired,{cursor:first.cursor}),e=>e.code==="hit-continuation-day-conflict");assert.equal(expired.calls.length,0,"Stale cycle metadata cannot spend source requests");assert.deepEqual(first.cursor,original);
 const changed=clone(milk);changed.price="1.45";changed.priceTag.priceCent="45";const routes=fixture();routes["/sortiment/uebersicht"]=listing([changed,ordinary],null,[dairy],3);routes[new URL(dairy.url).pathname]=listing([changed,ordinary],dairy,[dairy,milkParent,butterParent],3);
 const fresh=harness(routes,{clock:after}),second=await collect(fresh,{cursor:null,maxRequests:5});assert.equal(second.error,null);assert.equal(second.cursorDay,"2026-10-02");assert.equal(second.pagesFetched,2);assert.equal(second.received,2);assert.equal(second.accepted.length,2);assert.equal(second.accepted[0].price,1.45);assert(Date.parse(second.accepted[0].capturedAt)>=after);assert.equal(Date.parse(second.accepted[0].expiresAt)-Date.parse(second.accepted[0].capturedAt),86400000);assert.notEqual(second.accepted[0].sourceResponseHash,first.accepted[0].sourceResponseHash);assert.equal(fresh.calls.length,5);
 const next=harness(routes,{clock:after+86400000});await assert.rejects(()=>collect(next,{cursor:second.cursor}),e=>e.code==="hit-continuation-day-conflict");assert.equal(next.calls.length,0,"A 24-hour old cycle cannot keep deduping fresh cards");
});
test("a batch day snapshot crossing midnight never changes native capture timestamps",async()=>{
 const after=Date.parse("2026-10-01T22:00:01.000Z"),h=harness(fixture(),{clock:after}),r=await collect(h,{cursorDay:"2026-10-01",maxRequests:4});assert.equal(r.cursorDay,"2026-10-01");assert.equal(r.accepted.length,2);assert(r.accepted.every(c=>Date.parse(c.capturedAt)>=after));assert(r.accepted.every(c=>Date.parse(c.expiresAt)-Date.parse(c.capturedAt)===86400000));
 const resumed=harness(fixture(),{clock:after+60000});await assert.rejects(()=>collect(resumed,{cursor:r.cursor}),e=>e.code==="hit-continuation-day-conflict");assert.equal(resumed.calls.length,0,"The next ordinary batch recognizes the earlier scheduling day");
});
test("one-page conflicting GTIN-pack identities quarantine those goods and continue unrelated categories",async()=>{
 const alt=clone(milk);alt.external_id="000000000000999999ST";alt.url=alt.url.replace(milk.external_id,alt.external_id);alt.price="1.45";alt.priceTag.priceCent="45";
 const routes=fixture();routes["/sortiment/uebersicht"]=listing([milk,alt,ordinary],null,[dairy],3,3);
 const r=await collect(harness(routes));assert.equal(r.complete,true);assert.equal(r.error,null);assert.deepEqual(r.conflictGtins,[milk.ean]);assert.deepEqual(r.categoryCoverage.conflictingIdentities,[milk.ean]);assert.equal(r.pages.length,6);assert.equal(r.received,4);assert.equal(r.cursor,null);assert.equal(r.nativePaginationComplete,false);
 assert.deepEqual(r.accepted.map(c=>c.gtin),[ordinary.ean,butter.ean]);assert.deepEqual(r.pages[0].conflictGtins,[milk.ean]);assert.equal(r.pages[0].rowCount,3);assert.equal(r.pages[0].uniqueRowCount,3);assert(r.rejected.some(row=>row.reasons.includes("hit-conflicting-native-gtin-pack-quotes")));assert(r.rejected.some(row=>row.reasons.includes("hit-conflicting-native-gtin-cycle-quarantine")));
});
test("fresh contradiction on a resumed category advances its queue and persists quarantine across restarts",async()=>{
 const h=harness(),first=await collect(h,{maxRequests:4});assert.equal(first.received,2);
 const conflict=clone(milk);conflict.price="1.45";conflict.priceTag.priceCent="45";const routes=fixture();routes[new URL(dairy.url).pathname]=listing([conflict,ordinary],dairy,[dairy,milkParent,butterParent],3);
 const prior=clone(first.cursor),r=await collect(harness(routes),{cursor:first.cursor,maxRequests:3});assert.deepEqual(first.cursor,prior);assert.equal(r.error,null);assert.deepEqual(r.conflictGtins,[milk.ean]);assert.equal(r.accepted.length,0);assert.equal(r.pages.length,1);assert.equal(r.received,2);assert.equal(r.cursor.pending[0].id,String(milkParent.id));assert.equal(r.cursor.pagesFetched,2);assert.deepEqual(r.cursor.conflictGtins,[milk.ean]);assert.deepEqual(r.cursor.visited[1].conflictGtins,[milk.ean]);assert.equal(r.cursor.seenQuotes[milk.ean+"|ml|1000|1"].signature,first.cursor.seenQuotes[milk.ean+"|ml|1000|1"].signature,"A contradiction never replaces the originally observed quote signature");
 const saved=JSON.parse(JSON.stringify(r.cursor)),snapshot=clone(saved),again=await collect(harness(routes),{cursor:saved,maxRequests:3});assert.deepEqual(saved,snapshot);assert.equal(again.error,null);assert.equal(again.pages.length,1);assert.equal(again.pages[0].categoryId,String(milkParent.id));assert.deepEqual(again.pages[0].conflictGtins,[milk.ean]);assert.equal(again.accepted.length,0);assert.deepEqual(again.cursor.conflictGtins,[milk.ean]);assert.notEqual(again.cursor.conflictGtins,saved.conflictGtins);
 const finished=await collect(harness(routes),{cursor:JSON.parse(JSON.stringify(again.cursor))});assert.equal(finished.complete,true);assert.equal(finished.error,null);assert.equal(finished.received,3);assert.deepEqual(finished.accepted.map(c=>c.gtin),[butter.ean]);assert.deepEqual(finished.conflictGtins,[milk.ean]);assert.equal(finished.nativePaginationComplete,false);
});
test("conflicting duplicate native SKUs count once and quarantine every affected native GTIN",async()=>{
 const conflict=clone(milk);conflict.ean=butter.ean;conflict.price="1.45";conflict.priceTag.priceCent="45";
 const routes=fixture();routes["/sortiment/uebersicht"]=listing([milk,conflict,ordinary],null,[dairy],3,3);
 const r=await collect(harness(routes));assert.equal(r.complete,true);assert.equal(r.error,null);assert.deepEqual(r.conflictGtins,[milk.ean,butter.ean]);assert.equal(r.received,3);assert.equal(r.total,3);assert.equal(r.pages[0].uniqueRowCount,2);assert.equal(r.pages[0].rowCount,3);assert.deepEqual(r.accepted.map(c=>c.gtin),[ordinary.ean]);assert.equal(r.nativePaginationComplete,false);assert(r.rejected.some(row=>row.reasons.includes("hit-conflicting-native-sku-quotes")));
});

test("a later conflicting page removes all earlier batch quotes while preserving unrelated native proof",async()=>{
 const conflict=clone(milk);conflict.price="1.45";conflict.priceTag.priceCent="45";
 const routes=fixture();routes[new URL(dairy.url).pathname]=listing([conflict,ordinary],dairy,[dairy,milkParent,butterParent],3);
 const r=await collect(harness(routes));assert.equal(r.error,null);assert.equal(r.complete,true);assert.equal(r.categoryTraversalCycleComplete,true);assert.equal(r.received,r.total);assert.equal(r.received,3);assert.equal(r.pagesFetched,6);assert.equal(r.nativePaginationComplete,false);assert.equal(r.publishedTraversalComplete,false);assert.equal(r.cursor,null);assert.deepEqual(r.conflictGtins,[milk.ean]);assert.deepEqual(r.accepted.map(c=>c.gtin),[ordinary.ean,butter.ean]);
 assert.equal(r.pages[0].accepted,1);assert.equal(r.pages[0].rejected,1);assert.deepEqual(r.pages[1].conflictGtins,[milk.ean]);assert.equal(r.categoryCoverage.pending,0);assert.equal(r.categoryCoverage.visited,6);assert.deepEqual(r.categoryCoverage.conflictingIdentities,[milk.ean]);assert.notEqual(r.conflictGtins,r.categoryCoverage.conflictingIdentities);
 const original=routes["/sortiment/uebersicht"],quote=r.accepted.find(c=>c.gtin===ordinary.ean);assert.equal(quote.sourceResponseHash,crypto.createHash("sha256").update(original).digest("hex"));assert.equal(quote.sourceResponseUrl,"https://www.hit.de/sortiment/uebersicht");assert.equal(quote.capturedAt,r.pages[0].capturedAt);assert.equal(Date.parse(quote.expiresAt)-Date.parse(quote.capturedAt),86400000);
});

test("page-rejected GTIN quarantine persists without inventing a seen quote",async()=>{
 const alt=clone(milk);alt.external_id="000000000000999999ST";alt.url=alt.url.replace(milk.external_id,alt.external_id);alt.price="1.45";alt.priceTag.priceCent="45";
 const routes=fixture();routes["/sortiment/uebersicht"]=listing([milk,alt],null,[dairy],3);
 const first=await collect(harness(routes),{maxRequests:4});assert.equal(first.error,null);assert.equal(first.accepted.length,0);assert.equal(first.received,2);assert.deepEqual(first.cursor.conflictGtins,[milk.ean]);assert.deepEqual(first.cursor.seenQuotes,{});assert.deepEqual(Collector.cursorFor(JSON.parse(JSON.stringify(first.cursor)),store,first.cursorDay).conflictGtins,[milk.ean]);
 const second=await collect(harness(routes),{cursor:JSON.parse(JSON.stringify(first.cursor))});assert.equal(second.error,null);assert.equal(second.complete,true);assert.deepEqual(second.conflictGtins,[milk.ean]);assert.deepEqual(second.accepted.map(c=>c.gtin),[ordinary.ean,butter.ean]);assert.equal(second.nativePaginationComplete,false);
});

test("quarantine excludes later appearances on a new SKU and a different pack",async()=>{
 const conflict=clone(milk);conflict.price="1.45";conflict.priceTag.priceCent="45";
 const routes=fixture();routes[new URL(dairy.url).pathname]=listing([conflict,ordinary],dairy,[dairy,milkParent,butterParent],3);
 const first=await collect(harness(routes),{maxRequests:5}),variant=clone(milk);variant.external_id="000000000000999999ST";variant.url=variant.url.replace(milk.external_id,variant.external_id);variant.overview="2l Packung";variant.price="2.50";variant.priceTag.priceEuro="2";variant.priceTag.priceCent="50";
 routes[new URL(milkParent.url).pathname]=listing([variant,ordinary],milkParent,[dairy,milkParent,milkLeaf],2);
 const r=await collect(harness(routes),{cursor:JSON.parse(JSON.stringify(first.cursor)),maxRequests:3});assert.equal(r.error,null);assert.equal(r.accepted.length,0);assert.equal(r.received,3);assert.deepEqual(r.conflictGtins,[milk.ean]);assert.deepEqual(r.pages[0].conflictGtins,[milk.ean]);assert(r.rejected.some(row=>row.retailerSku===variant.external_id&&row.gtin===milk.ean));
});

test("the next real Berlin-day cycle freshly reconsiders a quarantined product",async()=>{
 const before=Date.parse("2026-10-01T21:59:30.000Z"),after=Date.parse("2026-10-01T22:00:01.000Z"),conflict=clone(milk);conflict.price="1.45";conflict.priceTag.priceCent="45";
 const routes=fixture();routes[new URL(dairy.url).pathname]=listing([conflict,ordinary],dairy,[dairy,milkParent,butterParent],3);
 const first=await collect(harness(routes,{clock:before}),{maxRequests:5});assert.deepEqual(first.cursor.conflictGtins,[milk.ean]);assert(!first.accepted.some(c=>c.gtin===milk.ean));
 const stale=harness(fixture(),{clock:after});await assert.rejects(()=>collect(stale,{cursor:first.cursor}),e=>e.code==="hit-continuation-day-conflict");assert.equal(stale.calls.length,0);
 const changed=fixture();changed["/sortiment/uebersicht"]=listing([conflict,ordinary],null,[dairy],3);changed[new URL(dairy.url).pathname]=listing([conflict,ordinary],dairy,[dairy,milkParent,butterParent],3);
 const fresh=await collect(harness(changed,{clock:after}),{cursor:null,maxRequests:5});assert.deepEqual(fresh.conflictGtins,[]);assert.deepEqual(fresh.cursor.conflictGtins,[]);assert.equal(fresh.error,null);assert.equal(fresh.accepted.find(c=>c.gtin===milk.ean).price,1.45);assert(Date.parse(fresh.accepted.find(c=>c.gtin===milk.ean).capturedAt)>=after);
});

test("equal same-GTIN pack quotes on another SKU dedupe while native SKU counts remain accurate",async()=>{
 const alternate=clone(milk);alternate.external_id="000000000000999999ST";alternate.url=alternate.url.replace(milk.external_id,alternate.external_id);
 const routes=fixture();routes[new URL(milkLeaf.url).pathname]=listing([alternate,ordinary],milkLeaf,[dairy,milkParent,milkLeaf],2);
 const r=await collect(harness(routes));assert.equal(r.complete,true);assert.equal(r.received,4);assert.equal(r.accepted.filter(c=>c.gtin===milk.ean).length,1);assert.equal(r.nativePaginationComplete,false);
});
test("source HTTP denial stops immediately and honors a longer native Retry-After",async()=>{
 for(const status of [403,429]){
  const routes=fixture();routes[new URL(dairy.url).pathname]={body:"Denied",status,headers:{"retry-after":"7200"}};
  const h=harness(routes),r=await collect(h);assert.equal(r.error.code,"hit-source-http-"+status);assert(r.error.retryAfterMs>=7200000);assert.equal(r.received,2);assert.equal(r.pages.length,1);assert.equal(r.cursor.pending[0].id,String(dairy.id));assert.equal(h.calls.length,5);
 }
});
test("HTTP denial after an isolated product conflict remains a global source error",async()=>{
 const conflict=clone(milk);conflict.price="1.45";conflict.priceTag.priceCent="45";
 for(const status of [403,429]){
  const routes=fixture();routes[new URL(dairy.url).pathname]=listing([conflict,ordinary],dairy,[dairy,milkParent,butterParent],3);routes[new URL(milkParent.url).pathname]={body:"Denied",status};
  const h=harness(routes),r=await collect(h);assert.equal(r.error.code,"hit-source-http-"+status);assert.equal(r.error.retryAfterMs,3600000);assert.equal(r.complete,false);assert.equal(r.received,2);assert.equal(r.pagesFetched,2);assert.equal(r.cursor.pending[0].id,String(milkParent.id));assert.deepEqual(r.conflictGtins,[milk.ean]);assert.deepEqual(r.cursor.conflictGtins,[milk.ean]);assert.deepEqual(r.accepted.map(c=>c.gtin),[ordinary.ean]);assert.equal(h.calls.length,6);
 }
});

test("a duplicate identity cannot hide a hard wrong-store proof",async()=>{
 const wrong=clone(milk);wrong.storeId=1729;wrong.storeNumber="054";
 const routes=fixture();routes[new URL(dairy.url).pathname]=listing([milk,wrong,ordinary],dairy,[dairy,milkParent,butterParent],3,3);
 const r=await collect(harness(routes));assert.equal(r.error.code,"hit-native-store-conflict");assert.equal(r.error.retryAfterMs,3600000);assert.equal(r.pagesFetched,1);assert.equal(r.received,2);assert.deepEqual(r.conflictGtins,[]);assert.equal(r.cursor.pending[0].id,String(dairy.id));
});

test("wrong native store or category proof cannot advance a partial scan",async()=>{
 for(const body of [listing([{...milk,storeId:1729,storeNumber:"054"},ordinary],dairy,[dairy,milkParent],3),listing([milk,ordinary],dairy,[dairy,milkParent],3,2,{params:{for_store:1729}}),listing([milk,ordinary],milkParent,[dairy,milkParent],3)]){
  const routes=fixture();routes[new URL(dairy.url).pathname]=body;const r=await collect(harness(routes));assert.equal(r.complete,false);assert(r.error);assert.equal(r.received,2);assert.equal(r.pages.length,1);assert.equal(r.cursor.pending[0].id,String(dairy.id));
 }
});
test("short, empty or nonnative listing responses keep the previous checkpoint",async()=>{
 for(const body of [listing([],dairy,[dairy],3),listing([milk],dairy,[dairy],3),"<header>Berlin-Mitte</header>"]){
  const routes=fixture();routes[new URL(dairy.url).pathname]=body;const r=await collect(harness(routes));assert.equal(r.complete,false);assert(r.error);assert.equal(r.received,2);assert.equal(r.pages.length,1);assert.equal(r.cursor.pagesFetched,1);
 }
});
test("duplicate rows within one native page cannot inflate publication completeness",async()=>{
 const routes=fixture();routes["/sortiment/uebersicht"]=listing([milk,clone(milk)],null,[dairy],2);
 const r=await collect(harness(routes));assert.equal(r.complete,false);assert(r.error);assert.equal(r.received,0);assert.equal(r.pages.length,0);
});
test("old capture dates and cache ages cannot renew current native goods prices",async()=>{
 for(const headers of [{age:"301"},{date:new Date(clock-600000).toUTCString()},{date:null},{age:"broken"}]){
  const routes=fixture();routes["/sortiment/uebersicht"]={body:routes["/sortiment/uebersicht"],headers};const r=await collect(harness(routes));assert.equal(r.complete,false);assert(r.error);assert.equal(r.accepted.length,0);assert.equal(r.received,0);
 }
});
test("guest cookies retain host, path, expiry, deletion and path-order isolation",async()=>{
 const h=harness(fixture(),{market:{cookies:["root=public; Path=/","market=only; Path=/maerkte","catalog=only; Path=/sortiment","boundary=wrong; Path=/sort","wrong=private; Domain=evil.example; Path=/","expired=old; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/","deleted=initial; Path=/","same=root; Path=/","same=catalog; Path=/sortiment"]},selection:{cookies:["deleted=gone; Max-Age=0; Path=/"]}});
 assert.equal((await collect(h)).complete,true);
 const selection=h.calls[1].init.headers.Cookie,index=h.calls[2].init.headers.Cookie;assert(selection.includes("market=only"));assert(!selection.includes("catalog=only"));assert(index.includes("catalog=only"));
 for(const name of ["market=only","boundary=wrong","wrong=private","expired=old","deleted="])assert(!index.includes(name),name);
 assert(index.indexOf("same=catalog")<index.indexOf("same=root"));assert.equal(h.calls[0].init.headers.Cookie,undefined);
});
test("short-lived cookies expire as paced requests advance and sessions never cross invocations",async()=>{
 const h=harness(fixture(),{market:{cookies:["short=public; Max-Age=2; Path=/"]},selection:{cookies:["PHPSESSID=fake-guest; Path=/"]}});
 assert.equal((await collect(h)).complete,true);assert(h.calls[1].init.headers.Cookie.includes("short=public"));assert(!h.calls[2].init.headers.Cookie.includes("short="));
 const firstCount=h.calls.length;assert.equal((await collect(h)).complete,true);assert.equal(h.calls[firstCount].init.headers.Cookie,undefined);
});
test("cross-origin, private-path and unsupported pagination redirects fail before another request",async()=>{
 for(const location of ["https://evil.example/sortiment","https://www.hit.de/konto","https://www.hit.de/sortiment/uebersicht?page=1","http://www.hit.de/sortiment","https://u:secret@www.hit.de/sortiment","https://www.hit.de/sortiment#fragment"]){
  const h=harness({}, {route:(url,call,n,response)=>response("",{status:302,headers:{location}})});await assert.rejects(()=>collect(h),e=>errorIncludes(e,"url-not-allowed"));assert.equal(h.calls.length,1);
 }
});
test("redirect loops cannot spend more than their bounded attempts",async()=>{
 const h=harness({}, {route:(url,call,n,response)=>response("",{status:302,headers:{location:store.officialUrl}})});
 await assert.rejects(()=>collect(h),e=>errorIncludes(e,"redirect-limit"));assert.equal(h.calls.length,4);
});
test("initial source cooldown has no network side effects",async()=>{
 const h=harness({}, {clock:Date.parse(Collector.COOLDOWN_UNTIL)-1,route:()=>assert.fail("No fetch allowed")});await assert.rejects(()=>collect(h),e=>errorIncludes(e,"cooldown")&&e.nextAttemptAt===Collector.COOLDOWN_UNTIL);assert.equal(h.calls.length,0);assert.equal(h.delays.length,0);
});
test("invalid explicit budgets do not silently become eight requests",async()=>{
 for(const maxRequests of [0,-1,NaN,Infinity]){const h=harness();await assert.rejects(()=>collect(h,{maxRequests}));assert.equal(h.calls.length,0)}
 for(const maxRequests of [1,2,3]){const h=harness();let r;try{r=await collect(h,{maxRequests})}catch(e){assert(errorIncludes(e,"budget"))}assert(h.calls.length<=maxRequests);if(r){assert.equal(r.complete,false);assert.equal(r.received,0)}}
});
test("invalid and wrong-market version-two checkpoints reject before any source request",async()=>{
 const h=harness(),first=await collect(h,{maxRequests:4}),count=h.calls.length;
 for(const change of [{version:1},{cursorDay:undefined},{cursorDay:"2026-02-30"},{cursorDay:"2026-10-01T00:00:00Z"},{nativeStoreId:1729},{nativeStoreNumber:"054"},{received:0},{pagesFetched:9},{total:100001},{seenQuotes:undefined},{pending:[{...first.cursor.pending[0],url:"https://evil.example/sortiment/kaese-eier-molkerei-4261253"}]}]){
  await assert.rejects(()=>collect(h,{cursor:{...clone(first.cursor),...change}}),e=>errorIncludes(e,"cursor"));assert.equal(h.calls.length,count);
 }
});
test("legacy version-two cursors default to empty quarantine and clone all conflict arrays",async()=>{
 const first=await collect(harness(),{maxRequests:4}),legacy=clone(first.cursor);delete legacy.conflictGtins;delete legacy.categoryCoverage.conflictingIdentities;for(const visit of legacy.visited)delete visit.conflictGtins;
 const before=clone(legacy),state=Collector.cursorFor(legacy,store,legacy.cursorDay);assert.deepEqual(legacy,before);assert.deepEqual(state.conflictGtins,[]);assert.deepEqual(state.categoryCoverage.conflictingIdentities,[]);assert.equal((await collect(harness(),{cursor:legacy})).error,null);
 const observed=clone(first.cursor);observed.conflictGtins=[milk.ean];observed.visited[0].conflictGtins=[milk.ean];const quarantined=Collector.cursorFor(observed,store,observed.cursorDay);quarantined.conflictGtins.push(butter.ean);quarantined.visited[0].conflictGtins.push(butter.ean);quarantined.categoryCoverage.conflictingIdentities.push(butter.ean);assert.deepEqual(observed.conflictGtins,[milk.ean]);assert.deepEqual(observed.visited[0].conflictGtins,[milk.ean]);assert.deepEqual(observed.categoryCoverage.conflictingIdentities,[]);
});

test("invalid quarantine GTINs or unobserved cursor conflicts reject before any source request",async()=>{
 const first=await collect(harness(),{maxRequests:4});
 const changes=[
  cursor=>{cursor.conflictGtins=null},cursor=>{cursor.conflictGtins="4388860095920"},cursor=>{cursor.conflictGtins=[milk.ean,milk.ean]},cursor=>{cursor.conflictGtins=["4388860095921"]},cursor=>{cursor.conflictGtins=[" "+milk.ean]},cursor=>{cursor.conflictGtins=[Number(milk.ean)]},cursor=>{cursor.conflictGtins=["000000000"]},cursor=>{cursor.conflictGtins=Array(100001).fill(milk.ean)},
  cursor=>{cursor.conflictGtins=[milk.ean]},cursor=>{cursor.visited[0].conflictGtins=[milk.ean]},cursor=>{cursor.conflictGtins=[milk.ean];cursor.visited[0].conflictGtins=[butter.ean]},cursor=>{cursor.conflictGtins=[milk.ean];cursor.visited[0].conflictGtins=[milk.ean,milk.ean]},cursor=>{cursor.visited[0].conflictGtins=null},cursor=>{cursor.visited[0].conflictGtins=[" "+milk.ean]},cursor=>{cursor.visited[0].conflictGtins=Array(100001).fill(milk.ean)}
 ];
 for(const change of changes){const cursor=clone(first.cursor),h=harness();change(cursor);await assert.rejects(()=>collect(h,{cursor}),e=>e.code==="hit-continuation-cursor-conflict");assert.equal(h.calls.length,0);assert.equal(h.delays.length,0);}
});

test("offered category identifiers cannot be replaced with credentials, guessed paths or page queries",async()=>{
 for(const url of ["https://www.hit.de/sortiment/uebersicht?page=1","https://www.hit.de/sortiment/uebersicht?for_q=milk","https://www.hit.de/sortiment/%6bilch-4261891","https://www.hit.de/maerkte/berlin-zoo?mein-markt=1","https://www.hit.de/maerkte/berlin-mitte?mein-markt=1&mein-markt=1","https://www.hit.de/sortiment/kaese-eier-molkerei-4261253?markt=054","https://www.hit.de:444/sortiment","https://www.hit.de/sortiment/../konto"])
  assert.throws(()=>Collector.allowedUrl(url,store),e=>errorIncludes(e,"url-not-allowed"),url);
});
function nativeProbePage(rows,filtered=false,edit=()=>{},transform=body=>body){
 const node=milkParent,category={...node,id:String(node.id),count:rows.length},data={status:200,data:rows,pagination:{page:0,limit:40,total:rows.length},meta:{category:{id:String(node.id),name:node.name,url:node.url,count:rows.length}},filters:{categories:[dairy,category,milkLeaf],brands:[{id:"Synthetic A",key:"Synthetic A",label:"Synthetic A",count:1}]}},params={for_store:1775,for_category:String(node.id),limit:40,return_exact_match:"1",...(filtered?{for_brands:"Synthetic A"}:{})};edit(data,params);
 return transform('<html><head data-store="258" data-store-id="1775" data-hit-konto="" data-hit-admin=""></head><body><div data-component="assortment/list" data-data="'+attr(data)+'" data-params="'+attr(params)+'"></div></body></html>');
}
function probeHarness(filtered={},options={}){
 const routes=fixture();routes[new URL(milkParent.url).pathname]=options.controlBody||nativeProbePage([milk,ordinary]);
 return harness(routes,{...options,route:(url,call,n,response)=>{
  if(url.searchParams.has("for_brands")){if(options.probeError)throw options.probeError;return response(filtered.body??nativeProbePage([milk],true),filtered);}
  if(url.pathname===new URL(store.officialUrl).pathname)return response(url.searchParams.has("mein-markt")?"Guest selected":choice(),url.searchParams.has("mein-markt")?options.selection||{}:options.market||{});
  const spec=routes[url.pathname];assert.notEqual(spec,undefined,url.href);return typeof spec==="string"?response(spec):response(spec.body,spec);
 }});
}
test("native brand probe defaults off and only one extra paced guest GET changes no price or traversal evidence",async()=>{
 const baseline=await collect(probeHarness()),h=probeHarness({}, {selection:{cookies:["guest=synthetic; Path=/"]}}),result=await collect(h,{brandProbeEnabled:true});
 assert.equal(baseline.brandFilterProbe,null);assert.equal(result.brandFilterProbe.outcome,"confirmed");assert.equal(result.brandFilterProbe.actualHTMLFilterVerified,true);assert.equal(result.requests,baseline.requests+1);
 for(const key of ["accepted","rejected","total","pagesFetched","received","categoryCoverage","conflictGtins","complete","nativePaginationComplete","publishedTraversalComplete","physicalStoreAssortmentComplete"])if(["accepted","rejected"].includes(key))assert.deepEqual(result[key].map(row=>[row.gtin,row.priceCents,row.pack]),baseline[key].map(row=>[row.gtin,row.priceCents,row.pack]));else assert.deepEqual(result[key],baseline[key]);
 assert.equal(result.pages.length,baseline.pages.length);assert(!result.pages.some(page=>new URL(page.sourceResponseUrl).searchParams.has("for_brands")));
 const calls=h.calls.filter(call=>new URL(call.url).searchParams.has("for_brands"));assert.equal(calls.length,1);assert(calls[0].init.headers.Cookie.includes("guest=synthetic"));
 for(let index=1;index<h.calls.length;index++)assert(h.calls[index].at-h.calls[index-1].at>=1000);
 assert.throws(()=>Collector.allowedUrl(calls[0].url,store));for(const key of ["collectionEnabled","priceImportEnabled","complete"])assert.equal(result.brandFilterProbe[key],false);
});
test("probe budget exhaustion has no attempted record and leaves a valid normally advanced cursor",async()=>{
 const h=probeHarness(),result=await collect(h,{brandProbeEnabled:true,maxRequests:6});assert.equal(result.requests,6);assert.equal(result.brandFilterProbe,null);assert(!h.calls.some(call=>new URL(call.url).searchParams.has("for_brands")));assert.equal(result.pagesFetched,3);
 assert(!result.cursor.pending.some(node=>node.id===String(milkParent.id)));Collector.cursorFor(result.cursor,store,result.cursorDay);
});
test("refused filter has a durable diagnostic while the successfully processed pending node remains removed",async()=>{
 for(const status of [403,429]){
  const h=probeHarness({body:"Source refused",status,headers:{"retry-after":"7200"}}),result=await collect(h,{brandProbeEnabled:true});
  assert.equal(h.calls.length,7);assert.equal(result.brandFilterProbe.outcome,"source-refused");assert.equal(result.brandFilterProbe.filtered,null);assert.equal(result.error.code,"hit-source-http-"+status);assert.equal(result.error.retryAfterMs,7200000);assert.equal(result.brandFilterProbe.error.retryAfterMs,7200000);
  assert.equal(result.pagesFetched,3);assert.equal(result.received,2);assert.equal(result.pages.length,3);assert.equal(result.complete,false);assert(!result.cursor.pending.some(node=>node.id===String(milkParent.id)));assert(result.cursor.visited.some(node=>node.id===String(milkParent.id)));Collector.cursorFor(result.cursor,store,result.cursorDay);
  const saved=clone(result.cursor),resumed=await collect(probeHarness(),{cursor:result.cursor});assert.deepEqual(result.cursor,saved);assert.equal(resumed.brandFilterProbe,null);assert.equal(resumed.complete,true);assert.equal(resumed.pagesFetched,6);
 }
});
test("ignored HTML filters and bad native identities consume a single diagnostic attempt without importing response",async()=>{
 for(const body of [nativeProbePage([milk,ordinary]),nativeProbePage([{...milk,storeId:1729}],true),nativeProbePage([milk],true,(_data,params)=>{delete params.for_brands}),nativeProbePage([milk],true,(_data,params)=>{params.for_brands="Other"}),nativeProbePage([{...milk,external_id:"999999ST"}],true)]){
  const h=probeHarness({body}),result=await collect(h,{brandProbeEnabled:true});assert.equal(result.brandFilterProbe.outcome,"inconclusive");assert.equal(result.brandFilterProbe.filtered.body,body);assert.equal(result.error,null);assert.equal(result.complete,true);assert.equal(result.requests,10);assert.equal(result.received,3);assert.equal(result.pagesFetched,6);assert.equal(h.calls.filter(call=>new URL(call.url).searchParams.has("for_brands")).length,1);assert.equal(result.accepted.length,3);
 }
});
test("redirect and non-HTML filter responses never trigger a second filter request",async()=>{
 for(const spec of [{status:302,headers:{location:milkParent.url}},{headers:{"content-type":"application/json"}},{status:500}]){
  const h=probeHarness({body:"Synthetic refusal",...spec}),result=await collect(h,{brandProbeEnabled:true});assert.equal(result.brandFilterProbe.outcome,"failed");assert.equal(result.brandFilterProbe.filtered,null);assert.equal(result.error,null);assert.equal(result.complete,true);assert.equal(result.requests,10);assert.equal(h.calls.filter(call=>new URL(call.url).searchParams.has("for_brands")).length,1);
 }
});
test("DOM timeout/abort numeric codes and network errors still retain a single attempted diagnostic",async()=>{
 for(const probeError of [new DOMException("Synthetic timeout","TimeoutError"),new DOMException("Synthetic abort","AbortError"),Object.assign(new TypeError("Sensitive transport detail"),{code:"ENOTFOUND"}),Object.assign(new Error("Sensitive transport detail"),{code:"ERR_INVALID_URL"})]){
  const h=probeHarness({}, {probeError}),result=await collect(h,{brandProbeEnabled:true});assert.equal(result.brandFilterProbe.outcome,"failed");assert.equal(result.error,null);assert.equal(result.complete,true);assert.equal(result.requests,10);assert.equal(h.calls.filter(call=>new URL(call.url).searchParams.has("for_brands")).length,1);assert(!JSON.stringify(result.brandFilterProbe).includes("Sensitive transport detail"));
 }
});
test("native filter cache/date defects preserve raw evidence and cannot renew source goods",async()=>{
 for(const headers of [{age:"301"},{age:"broken"},{date:new Date(clock-600000).toUTCString()},{date:null}]){
  const h=probeHarness({headers}),result=await collect(h,{brandProbeEnabled:true});assert.equal(result.brandFilterProbe.outcome,"inconclusive");assert.equal(result.error,null);assert.equal(result.complete,true);assert.equal(result.received,3);assert.equal(result.pagesFetched,6);assert.equal(result.accepted.length,3);assert(result.brandFilterProbe.filtered.body);
 }
});
test("missing guest proof or malformed facets on a normal control cannot authorize extra requests",async()=>{
 for(const controlBody of [nativeProbePage([milk,ordinary],false,()=>{},body=>body.replace('data-hit-konto=""','data-hit-konto="SYNTHETIC"')),nativeProbePage([milk,ordinary],false,data=>{data.filters.brands=[{id:"A",key:"A",label:"A",count:"1"}]}),nativeProbePage([milk,ordinary],false,data=>{data.filters.brands=[{id:"A,B",key:"A,B",label:"A,B",count:1}]})]){
  const h=probeHarness({}, {controlBody}),result=await collect(h,{brandProbeEnabled:true});assert.equal(result.brandFilterProbe,null);assert.equal(result.error,null);assert.equal(result.complete,true);assert.equal(result.requests,9);
 }
});
const Gap=require("../hit-native-list-gap"),GapFixture=require("./fixtures/hit-list-gap");
test("normal internal page IDs and first-quote evidence bind the exact cursor additions without sharing mutable objects",async()=>{
 const first=await collect(harness(),{maxRequests:4}),page=first.pages[0];assert.deepEqual(page.nativeSkuIds,[milk.external_id,ordinary.external_id]);assert.equal(page.nativeSkuIds.length,page.uniqueRowCount);assert.deepEqual(first.cursor.seenSkus,page.nativeSkuIds);
 const quotes=[milk,ordinary].map(row=>({key:row.ean+"|ml|1000|1",quote:{gtin:row.ean,signature:crypto.createHash("sha256").update(JSON.stringify([row.headline,Math.round(Number(row.price)*100),null,"discount"])).digest("hex")}}));assert.deepEqual(page.nativeQuotes,quotes);
 for(const q of page.nativeQuotes){assert.deepEqual(first.cursor.seenQuotes[q.key],q.quote);assert.notEqual(first.cursor.seenQuotes[q.key],q.quote);}
 const snapshot=clone(first.cursor),resumed=await collect(harness(),{cursor:first.cursor,maxRequests:3});assert.deepEqual(first.cursor,snapshot);assert.deepEqual(resumed.pages[0].nativeSkuIds,[]);assert.deepEqual(resumed.pages[0].nativeQuotes,quotes);assert.deepEqual(resumed.cursor.seenQuotes,snapshot.seenQuotes);
 page.nativeQuotes[0].quote.signature="0".repeat(64);page.nativeSkuIds.push("999999ST");assert.deepEqual(first.cursor,snapshot);
});
test("an original-bound identical SKU failure excludes its entire category and stops with the unchanged hour",async()=>{
 const node=GapFixture.node(),page=GapFixture.page(),prior=GapFixture.cursor(),snapshot=clone(prior),h=GapFixture.harness({[node.url]:page.body},{maxRequests:8});
 const result=await Collector.collect({...h.options,cursor:prior,brandProbeEnabled:true});
 assert.equal(result.error.code,Gap.CODE);assert.equal(result.error.retryAfterMs,3600000);assert.equal(result.requests,3);assert.equal(h.calls.length,3);assert.equal(result.complete,false);assert.equal(result.brandFilterProbe,null);
 assert.equal(result.originalListingGaps.length,1);const original=result.originalListingGaps[0];assert.equal(result.error.isolatedListingGapId,original.id);assert.equal(original.original.body,page.body);Gap.validateRecord(original,{now:GapFixture.NOW+2000});
 assert.equal(result.accepted.length,0);assert.equal(result.pages.length,1);assert.equal(result.pages[0].uniqueRowCount,0);assert.equal(result.pages[0].diagnosticOnly,true);assert(!Object.hasOwn(result.pages[0],"nativeSkuIds"));assert(!Object.hasOwn(result.pages[0],"nativeQuotes"));assert.equal(result.rejected.length,2);assert(result.rejected.every(row=>row.retailerSku===null));
 assert.equal(result.pagesFetched,2);assert.equal(result.received,1);assert.equal(result.cursor.visited.at(-1).gapId,original.id);assert.equal(result.cursor.visited.at(-1).quarantinedListing,true);assert.deepEqual(result.cursor.pending,[snapshot.pending[1]]);assert.deepEqual(prior,snapshot);Collector.cursorFor(result.cursor,Gap.STORE,result.cursorDay);
});
test("a malformed native SKU cannot import even independently valid goods rows from its category",async()=>{
 const node=GapFixture.node(),page=GapFixture.page({rows:[GapFixture.row(1),{...GapFixture.row(2),external_id:"invalid"}]}),h=GapFixture.harness({[node.url]:page.body});
 const result=await Collector.collect({...h.options,cursor:GapFixture.cursor()});assert.equal(result.error.code,Gap.CODE);assert.equal(result.originalListingGaps.length,1);assert.deepEqual(result.originalListingGaps[0].invalidSkuIndexes,[1]);assert.equal(result.accepted.length,0);assert.equal(result.received,1);assert.deepEqual(result.cursor.seenQuotes,{});assert.deepEqual(result.cursor.seenSkus,[GapFixture.sku(9)]);
});
test("isolating a prioritized middle node preserves FIFO of every remaining pending node",async()=>{
 const first=GapFixture.node("4261244",1),bad={...GapFixture.node("4261253",1),url:"https://www.hit.de/sortiment/kaese-eier-molkerei-4261253"},last=GapFixture.node("4261911",1),page=GapFixture.page({category:bad});
 const prior=GapFixture.cursor([first,bad,last]),h=GapFixture.harness({[bad.url]:page.body}),result=await Collector.collect({...h.options,cursor:prior});
 assert.equal(h.calls[2],bad.url);assert.equal(result.originalListingGaps.length,1);assert.deepEqual(result.cursor.pending,[prior.pending[0],prior.pending[2]]);assert.deepEqual(result.cursor.visited.at(-1).children,[]);assert.equal(result.categoryCoverage.unresolvedNodes[0].unresolvedSubtree,true);
});
test("failed parents and leaves admit no offered children and retain explicit unresolved coverage",async()=>{
 for(const level of[1,2,3]){
  const node=GapFixture.node("4261891",level),child=GapFixture.node("4261912",level===3?3:level+1),page=GapFixture.page({category:node,edit:data=>{data.filters.categories.push(child)}}),prior=GapFixture.cursor([node,GapFixture.node("4261911")]),h=GapFixture.harness({[node.url]:page.body});
  const result=await Collector.collect({...h.options,cursor:prior});assert.equal(result.originalListingGaps.length,1);assert.deepEqual(result.cursor.pending,[prior.pending[1]]);assert.deepEqual(result.cursor.visited.at(-1).children,[]);assert.equal(result.categoryCoverage.unresolvedNodes[0].uniqueReceived,0);assert.equal(result.categoryCoverage.unresolvedNodes[0].unresolvedSubtree,level<3);assert.equal(result.nativePaginationComplete,false);
 }
});
test("missing original guest proof retains the existing unproved SKU failure and entire cursor",async()=>{
 for(const transform of[body=>body.replace('data-hit-konto=""','data-hit-konto="account"'),body=>body.replace(/<head[^>]*><\/head>/,"")]){
  const node=GapFixture.node(),page=GapFixture.page({transform}),prior=GapFixture.cursor(),h=GapFixture.harness({[node.url]:page.body}),result=await Collector.collect({...h.options,cursor:prior});
  assert.equal(result.error.code,Gap.CODE);assert.equal(result.error.retryAfterMs,3600000);assert(!Object.hasOwn(result.error,"isolatedListingGapId"));assert.deepEqual(result.originalListingGaps,[]);assert.deepEqual(result.cursor.pending,prior.pending);assert.equal(result.pages.length,0);assert.equal(result.pagesFetched,1);
 }
});
test("source Date/Age/store/category defects never become a successful SKU gap",async()=>{
 const node=GapFixture.node();for(const spec of[{body:GapFixture.page().body,headers:{age:"301"}},{body:GapFixture.page().body,headers:{date:null}},
  {body:GapFixture.page({rows:[GapFixture.row(1),{...GapFixture.row(1),storeId:1729,storeNumber:"054"}]}).body},
  {body:GapFixture.page({edit:(_data,params)=>{params.for_category="4261911"}}).body},
  {body:GapFixture.page({edit:data=>{data.meta.category.count=99}}).body}]){
  const prior=GapFixture.cursor(),h=GapFixture.harness({[node.url]:spec}),result=await Collector.collect({...h.options,cursor:prior});assert(result.error);assert.deepEqual(result.originalListingGaps,[]);assert.deepEqual(result.cursor.pending,prior.pending);assert.equal(result.pages.length,0);assert.equal(result.accepted.length,0);
 }
});
test("a bad-SKU category cannot hide a known cross-page quote contradiction",async()=>{
 const node=GapFixture.node(),prior=GapFixture.cursor(),row=GapFixture.row(1);prior.seenQuotes[row.ean+"|g|500|1"]={gtin:row.ean,signature:"a".repeat(64)};
 const h=GapFixture.harness({[node.url]:GapFixture.page().body}),result=await Collector.collect({...h.options,cursor:prior});assert.equal(result.error.code,Gap.CODE);assert.deepEqual(result.originalListingGaps,[]);assert.equal(result.pages.length,0);assert.deepEqual(result.cursor.pending,prior.pending);assert.deepEqual(result.cursor.seenQuotes,prior.seenQuotes);
});
test("existing contradictory native quote quarantine is unchanged and produces no listing gap",async()=>{
 const node=GapFixture.node(),row=GapFixture.row(1),conflict={...row,price:"1.35",priceTag:{...row.priceTag,priceCent:"35"}},page=GapFixture.page({rows:[row,conflict]}),h=GapFixture.harness({[node.url]:page.body});
 const result=await Collector.collect({...h.options,cursor:GapFixture.cursor()});assert.equal(result.error,null);assert.deepEqual(result.originalListingGaps,[]);assert.equal(result.pages.length,1);assert.equal(result.received,2);assert.deepEqual(result.conflictGtins,[row.ean]);assert.equal(result.accepted.length,0);assert(!result.pages[0].diagnosticOnly);
});
test("an isolated category preserves established native GTIN quarantine across the remaining cursor",async()=>{
 const prior=GapFixture.cursor(),gtin=GapFixture.row(9).ean;prior.conflictGtins=[gtin];prior.visited[0].conflictGtins=[gtin];const snapshot=clone(prior),node=GapFixture.node(),h=GapFixture.harness({[node.url]:GapFixture.page().body});
 const result=await Collector.collect({...h.options,cursor:prior});assert.equal(result.originalListingGaps.length,1);assert.deepEqual(result.conflictGtins,[gtin]);assert.deepEqual(result.cursor.conflictGtins,[gtin]);assert.deepEqual(result.pages[0].conflictGtins,[]);assert.deepEqual(prior,snapshot);assert.equal(result.nativePaginationComplete,false);
});
test("native403/429 remain source refusals with no original gap and the longer native pause",async()=>{
 for(const status of[403,429]){
  const node=GapFixture.node(),prior=GapFixture.cursor(),h=GapFixture.harness({[node.url]:{status,body:"Synthetic refusal",headers:{"retry-after":"7200"}}}),result=await Collector.collect({...h.options,cursor:prior});
  assert.equal(result.error.code,"hit-source-http-"+status);assert.equal(result.error.retryAfterMs,7200000);assert.deepEqual(result.originalListingGaps,[]);assert.deepEqual(result.cursor.pending,prior.pending);assert.equal(result.pages.length,0);assert.equal(result.requests,3);
 }
});
test("the diagnostic path consumes no request beyond the existing budget",async()=>{
 const node=GapFixture.node(),prior=GapFixture.cursor(),h=GapFixture.harness({[node.url]:GapFixture.page().body},{maxRequests:2}),result=await Collector.collect({...h.options,cursor:prior});
 assert.equal(result.requests,2);assert.equal(result.error,null);assert.deepEqual(result.originalListingGaps,[]);assert.deepEqual(result.cursor.pending,prior.pending);assert.equal(result.pages.length,0);
});
test("a later real failure isolates one different category while retaining the first original gap marker",async()=>{
 const firstNode=GapFixture.node(),secondNode=GapFixture.node("4261911"),firstHarness=GapFixture.harness({[firstNode.url]:GapFixture.page().body}),first=await Collector.collect({...firstHarness.options,cursor:GapFixture.cursor()});
 const later=GapFixture.NOW+3602000,h=GapFixture.harness({[secondNode.url]:GapFixture.page({category:secondNode,now:later}).body},{now:later,maxRequests:8}),snapshot=clone(first.cursor),result=await Collector.collect({...h.options,cursor:first.cursor});
 assert.equal(result.requests,3);assert.equal(result.originalListingGaps.length,1);assert.notEqual(result.originalListingGaps[0].id,first.originalListingGaps[0].id);assert.equal(result.cursor.visited.filter(v=>v.quarantinedListing).length,2);assert.equal(result.cursor.pending.length,0);assert.equal(result.complete,false);assert.equal(result.received,1);assert.deepEqual(first.cursor,snapshot);Collector.cursorFor(result.cursor,Gap.STORE,result.cursorDay);
});
test("after the full pause the actual next category progresses without revisiting or importing the excluded original",async()=>{
 const node=GapFixture.node(),next=GapFixture.node("4261911"),firstHarness=GapFixture.harness({[node.url]:GapFixture.page().body}),first=await Collector.collect({...firstHarness.options,cursor:GapFixture.cursor()}),later=GapFixture.NOW+3602000;
 const h=GapFixture.harness({[next.url]:GapFixture.page({category:next,rows:[GapFixture.row(2)],now:later}).body},{now:later,maxRequests:4}),snapshot=clone(first.cursor),result=await Collector.collect({...h.options,cursor:first.cursor});
 assert.equal(result.error,null);assert.equal(result.complete,true);assert.equal(result.pagesFetched,3);assert.equal(result.received,2);assert.equal(result.accepted.length,1);assert.equal(result.accepted[0].gtin,GapFixture.row(2).ean);assert.equal(result.nativePaginationComplete,false);assert.equal(result.publishedTraversalComplete,false);assert.equal(result.categoryCoverage.unresolvedNodes.length,1);assert(!h.calls.includes(node.url));assert.deepEqual(first.cursor,snapshot);assert.deepEqual(result.originalListingGaps,[]);
});
test("ordinary originals retain exact response provenance without additional requests or cursor bodies",async()=>{
 const h=harness(),r=await collect(h);assert.equal(h.calls.length,9);assert.equal(r.ordinaryConflictOriginals.length,r.pages.length);
 for(const [i,o]of r.ordinaryConflictOriginals.entries()){const p=r.pages[i];assert.equal(crypto.createHash("sha256").update(o.body).digest("hex"),p.sourceResponseHash);assert.equal(o.meta.capturedAt,p.capturedAt);assert.equal(o.meta.sourceResponseUrl,p.sourceResponseUrl);assert.equal(o.meta.responseBytes,Buffer.byteLength(o.body));assert.equal(o.meta.responseStatus,200);assert.equal(o.meta.anonymous,true);assert.equal(o.node?.id??null,p.categoryId);}
 const partial=await collect(harness(),{maxRequests:5});assert(!JSON.stringify(partial.cursor).includes('"body":'));assert(!JSON.stringify(partial.cursor).includes("ordinaryConflictOriginals"));
});
test("both real original pages remain available when a later quote contradicts an earlier page",async()=>{
 const routes=fixture(),changed=clone(milk);changed.price="1.45";changed.priceTag.priceCent="45";routes[new URL(dairy.url).pathname]=listing([changed,ordinary],dairy,[dairy,milkParent,butterParent],3);
 const h=harness(routes),r=await collect(h,{maxRequests:5});assert.deepEqual(r.conflictGtins,[milk.ean]);assert.equal(r.ordinaryConflictOriginals.length,2);assert.equal(require("../hit-assortment-client").extractRows(r.ordinaryConflictOriginals[0].body).rows.find(x=>x.ean===milk.ean).price,"1.25");assert.equal(require("../hit-assortment-client").extractRows(r.ordinaryConflictOriginals[1].body).rows.find(x=>x.ean===milk.ean).price,"1.45");assert.equal(r.ordinaryConflictOriginals[1].body,routes[new URL(dairy.url).pathname]);assert(!r.accepted.some(c=>c.gtin===milk.ean));assert.equal(h.calls.length,5);
});
test("denied responses never enter normal originals and keep the source pause",async()=>{
 for(const status of[403,429]){const routes=fixture();routes[new URL(dairy.url).pathname]={body:"Denied",status,headers:{"retry-after":"7200"}};const h=harness(routes),r=await collect(h);assert.equal(r.ordinaryConflictOriginals.length,1);assert(r.ordinaryConflictOriginals.every(o=>o.meta.responseStatus===200&&!o.body.includes("Denied")));assert.equal(r.error.code,"hit-source-http-"+status);assert(r.error.retryAfterMs>=7200000);assert.equal(h.calls.length,5);}
});
test("an isolated malformed category keeps its separate gap original and no normal original",async()=>{
 const prior=GapFixture.cursor(),node=GapFixture.node(),h=GapFixture.harness({[node.url]:GapFixture.page().body}),r=await Collector.collect({...h.options,cursor:prior});assert.equal(r.originalListingGaps.length,1);assert.deepEqual(r.ordinaryConflictOriginals,[]);assert.equal(r.pages[0].diagnosticOnly,true);assert.equal(r.accepted.length,0);
});
(async()=>{const failures=[];for(const {name,run}of cases)try{await run()}catch(e){failures.push(name+": "+e.stack)}if(failures.length){console.error(failures.join("\n\n"));process.exitCode=1}else console.log("hit-assortment-collector: OK ("+cases.length+" offline category and safety cases)")})().catch(e=>{console.error(e);process.exitCode=1});
