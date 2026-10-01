"use strict";

const assert=require("node:assert/strict"),crypto=require("node:crypto"),Collector=require("../hit-assortment-collector");
const store={storeId:1775,storeNumber:"258",name:"Berlin-Mitte",city:"Berlin",country:"DE",officialUrl:"https://www.hit.de/maerkte/berlin-mitte"};
const afterCooldown=Date.parse(Collector.COOLDOWN_UNTIL)+60000;
const attr=value=>JSON.stringify(value).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const clone=structuredClone;
// Real native identities, packs, price tags and anonymous assortment/list layout from the saved Berlin responses.
const native=(sku,ean,name,pack,price,type="discount")=>({
 external_id:sku,ean,storeId:1775,storeNumber:"258",headline:name,overview:pack,price,deposit:null,
 url:"https://www.hit.de/sortiment/kaese-eier-molkerei/milch-h-kuh-4261891/produkt-"+sku,
 inventoryAvailable:true,inventoryUpdatedAt:"2026-10-01T19:24:29+02:00",
 priceTag:{type,badgeText:type==="discount"?"DAUER\nDISCOUNT\nPREIS":null,priceEuro:price.split(".")[0],priceCent:price.split(".")[1],priceStrikeThroughText:null,beforeText:null,belowText:null,couponCode:null,couponName:null,highlightUntil:type==="discount"?"2026-10-01T23:59:59+00:00":null}
});
const milk=native("000000000000548963ST","4388860095920","REWE BIO H-Vollmilch 3,8%","1l Packung","1.25");
const ordinary=native("000000000000866799ST","4388844268159","ja! H-Milch 3,5%","1l Packung","0.95");
const butter=native("000000000000156719ST","4008452010222","Weihenstephan Butter","250g Packung","2.79","standard");
const list=(rows,page=0,total=rows.length,limit=2,params={for_store:1775,limit,return_exact_match:"1"})=>'<div data-component="assortment/list" data-data="'+attr({data:rows,pagination:{page,limit,total},meta:{is_exact_match:true},filters:{categories:[]},status:200})+'" data-params="'+attr(params)+'"></div>';
const choice=(quoted=false)=>quoted?'<a href="'+store.officialUrl+'?mein-markt=1">Mein Markt</a>':'<a role="button" href='+store.officialUrl+'?mein-markt=1 target="_top">Mein Markt</a>';
const cases=[];
function test(name,run){cases.push({name,run})}
function harness(route,clock=afterCooldown){
 let time=clock;const calls=[],delays=[];
 const response=(body,options={})=>{
  const headers=new Headers({"content-type":"text/html; charset=UTF-8","date":new Date(time).toUTCString(),"age":"0"});
  for(const [key,value]of Object.entries(options.headers||{})){if(value===null)headers.delete(key);else headers.set(key,value)}
  for(const cookie of options.cookies||[])headers.append("set-cookie",cookie);
  return new Response(body,{status:options.status||200,headers});
 };
 const fetchImpl=async(url,init)=>{
  const call={url,init:{...init,headers:{...init.headers}},at:time};calls.push(call);
  assert.equal(init.method,"GET");assert.equal(init.redirect,"manual");assert(init.signal instanceof AbortSignal);
  return route(new URL(url),call,calls.length,response);
 };
 return{calls,delays,response,options:{storeProfile:store,fetchImpl,now:()=>time,delay:async ms=>{assert(Number.isFinite(ms)&&ms>=1000);delays.push(ms);time+=ms},pauseMs:1000},now:()=>time,setTime:value=>{time=value}};
}
function normalRoute(pages,{marketBody=choice(),marketOptions={},selectionOptions={}}={}){
 return(url,call,n,response)=>{
  if(url.pathname===new URL(store.officialUrl).pathname)return response(url.searchParams.has("mein-markt")?"Guest market selected":marketBody,url.searchParams.has("mein-markt")?selectionOptions:marketOptions);
  const page=Number(url.searchParams.get("page")||0);assert.equal(url.pathname,"/sortiment/uebersicht");
  const body=typeof pages==="function"?pages(page):pages[page];assert.notEqual(body,undefined,"Unexpected page request "+page);
  return body instanceof Response?body:response(body);
 };
}
async function withClock(h,fn){const saved=Date.now;Date.now=h.now;try{return await fn()}finally{Date.now=saved}}
const collect=(h,overrides={})=>withClock(h,()=>Collector.collect({...h.options,...overrides}));
const errHas=(error,part)=>typeof(error?.code||error?.message)==="string"&&(error.code||error.message).includes(part);

test("actual unquoted guest link opens a source-issued guest context and retrieves every native page",async()=>{
 const h=harness(normalRoute([list([milk,ordinary],0,3),list([butter],1,3)],{selectionOptions:{cookies:["mein-markt=source-issued-market; Path=/; Secure; HttpOnly"]}}));
 const result=await collect(h,{maxRequests:4});
 assert.equal(result.complete,true);assert.equal(result.physicalStoreAssortmentComplete,false);
 assert.equal(result.cursor,null);assert.equal(result.requests,4);assert.equal(result.total,3);assert.equal(result.received,3);assert.equal(result.pagesFetched,2);assert.equal(result.pages.length,2);
 assert.deepEqual(result.accepted.map(row=>row.gtin),[milk.ean,ordinary.ean,butter.ean]);assert.equal(result.error,null);
 assert.equal(h.calls[0].init.headers.Cookie,undefined);assert.equal(h.calls[1].init.headers.Cookie,undefined);
 assert.equal(h.calls[2].init.headers.Cookie,"mein-markt=source-issued-market");assert.equal(h.calls[3].init.headers.Cookie,"mein-markt=source-issued-market");
 assert.equal(h.calls[3].url,"https://www.hit.de/sortiment/uebersicht?page=1");
 for(let i=1;i<h.calls.length;i++)assert(h.calls[i].at-h.calls[i-1].at>=1000);
 assert.equal(result.accepted[0].price,1.25);assert.equal(result.accepted[2].pack,"250g Packung");assert.equal(result.accepted[0].deposit,null);
 assert.equal(result.accepted[0].sourceResponseHash,crypto.createHash("sha256").update(list([milk,ordinary],0,3)).digest("hex"));
 assert(result.accepted.every(row=>row.nativeStoreId===1775&&row.nativeStoreNumber==="258"&&!row.truthEligible));
});

test("cookies honor host, path, expiry and server deletion without leaking private-path cookies",async()=>{
 const h=harness(normalRoute([list([milk])],{marketBody:choice(true),marketOptions:{cookies:[
  "root_cookie=public; Path=/; Secure",
  "market_only=market; Path=/maerkte; Secure",
  "catalog_only=catalog; Path=/sortiment; Secure",
  "boundary_path=wrong; Path=/sort; Secure",
  "wrong_host=private; Domain=evil.example; Path=/",
  "expired_cookie=old; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/",
  "deleted_cookie=initial; Path=/"
 ]},selectionOptions:{cookies:["deleted_cookie=deleted; Max-Age=0; Path=/"]}}));
 const result=await collect(h);assert.equal(result.complete,true);
 const selection=h.calls[1].init.headers.Cookie||"",catalog=h.calls[2].init.headers.Cookie||"";
 assert(selection.includes("root_cookie=public"));assert(selection.includes("market_only=market"));
 assert(!selection.includes("catalog_only="));assert(!selection.includes("wrong_host="));assert(!selection.includes("expired_cookie="));
 assert(catalog.includes("root_cookie=public"));assert(catalog.includes("catalog_only=catalog"));
 for(const key of ["market_only=","boundary_path=","wrong_host=","expired_cookie=","deleted_cookie="])assert(!catalog.includes(key),"Unexpected catalog cookie "+key);
});

test("same-name cookies on distinct paths coexist and the longer applicable path is sent first",async()=>{
 const h=harness(normalRoute([list([milk])],{marketBody:choice(true),marketOptions:{cookies:["same=root; Path=/","same=assortment; Path=/sortiment"]}}));
 assert.equal((await collect(h)).complete,true);
 assert.equal(h.calls[1].init.headers.Cookie,"same=root");
 assert.equal(h.calls[2].init.headers.Cookie,"same=assortment; same=root");
});

test("guest state is isolated across collection invocations",async()=>{
 const h=harness(normalRoute([list([milk])],{marketBody:choice(true),selectionOptions:{cookies:["PHPSESSID=synthetic-guest-only; Path=/"]}}));
 assert.equal((await collect(h)).complete,true);assert.equal((await collect(h)).complete,true);
 assert.equal(h.calls[0].init.headers.Cookie,undefined);assert.equal(h.calls[3].init.headers.Cookie,undefined);
 assert.equal(h.calls[2].init.headers.Cookie,"PHPSESSID=synthetic-guest-only");
});

test("short-lived guest cookies expire as the request pacing clock advances",async()=>{
 const h=harness(normalRoute([list([milk])],{marketBody:choice(true),marketOptions:{cookies:["short_lived=public; Max-Age=2; Path=/"]}}));
 assert.equal((await collect(h)).complete,true);
 assert.equal(h.calls[1].init.headers.Cookie,"short_lived=public");
 assert.equal(h.calls[2].init.headers.Cookie,undefined,"Expired guest cookie must be dropped before the later catalog request");
});

test("cross-origin and private-path redirects stop before a second network request",async()=>{
 for(const target of ["https://evil.example/sortiment/uebersicht","https://www.hit.de/konto","https://www.hit.de/sortiment/uebersicht?foo=1","https://www.hit.de/sortiment/uebersicht#fragment","http://www.hit.de/sortiment/uebersicht","https://name:secret@www.hit.de/sortiment/uebersicht"]){
  const h=harness((url,call,n,response)=>response("",{status:302,headers:{location:target},cookies:["fresh=guest; Path=/"]}));
  await assert.rejects(()=>collect(h),error=>errHas(error,"url-not-allowed"));assert.equal(h.calls.length,1,target);
 }
});

test("allowed redirects consume the same bounded request budget and preserve source cookies",async()=>{
 const h=harness((url,call,n,response)=>{
  if(n===1)return response("",{status:302,headers:{location:store.officialUrl+"?mein-markt=1"},cookies:["redirect_guest=source; Path=/"]});
  if(n===2)return response(choice(true));
  if(n===3)return response("Market selected");
  if(n===4)return response(list([milk]));
  assert.fail("request budget overrun");
 });
 const result=await collect(h,{maxRequests:4});assert.equal(result.complete,true);assert.equal(result.requests,4);assert.equal(h.calls[1].init.headers.Cookie,"redirect_guest=source");
});

test("a redirect cycle stops instead of retrying an unlimited sequence",async()=>{
 const h=harness((url,call,n,response)=>response("",{status:302,headers:{location:store.officialUrl}}));
 await assert.rejects(()=>collect(h,{maxRequests:16}),error=>errHas(error,"redirect-limit"));assert(h.calls.length<=4);
});

test("initial global source cooldown rejects before fetch or delay",async()=>{
 const h=harness(()=>assert.fail("cooldown must not fetch"),Date.parse(Collector.COOLDOWN_UNTIL)-1);
 await assert.rejects(()=>collect(h),error=>errHas(error,"cooldown")&&error.nextAttemptAt===Collector.COOLDOWN_UNTIL);
 assert.equal(h.calls.length,0);assert.equal(h.delays.length,0);
});

test("explicit request budgets below the bootstrap cost never grow into four requests",async()=>{
 for(const limit of [1,2]){
  const h=harness(normalRoute([list([milk])],{marketBody:choice(true)}));
  let result;try{result=await collect(h,{maxRequests:limit})}catch(error){assert(errHas(error,"budget"))}
  if(result){assert.equal(result.complete,false);assert.equal(result.received,0);assert.equal(result.accepted.length,0);assert.equal(result.cursor.nextPage,0)}
  assert(h.calls.length<=limit,"Exceeded explicit budget "+limit);
 }
});

test("invalid explicit request budgets never become the default eight source requests",async()=>{
 for(const limit of [0,-1,NaN,Infinity]){
  const h=harness(normalRoute([list([milk])],{marketBody:choice(true)}));
  await assert.rejects(()=>collect(h,{maxRequests:limit}));assert.equal(h.calls.length,0,"Invalid explicit budget must be rejected before source access: "+limit);
 }
});

test("budget continuation preserves page progress and reestablishes an isolated guest session",async()=>{
 const pages=[list([milk,ordinary],0,3),list([butter],1,3)];
 const h=harness(normalRoute(pages,{marketBody:choice(true),selectionOptions:{cookies:["guest=first; Path=/"]}}));
 const first=await collect(h,{maxRequests:3});assert.equal(first.complete,false);assert.equal(first.error,null);assert.equal(first.requests,3);assert.equal(first.received,2);assert.equal(first.cursor.nextPage,1);
 const saved=clone(first.cursor),second=await collect(h,{maxRequests:3,cursor:first.cursor});
 assert.deepEqual(first.cursor,saved,"Resume must not mutate the caller's saved cursor");
 assert.equal(second.complete,true);assert.equal(second.received,3);assert.equal(second.pagesFetched,2);assert.deepEqual(second.accepted.map(row=>row.gtin),[butter.ean]);
 assert.equal(h.calls[3].init.headers.Cookie,undefined);assert.equal(h.calls[5].url,"https://www.hit.de/sortiment/uebersicht?page=1");
});

test("wrong-store responses never advance the cursor or count toward completeness",async()=>{
 for(const body of [list([{...milk,storeId:1729,storeNumber:"054"}]),list([milk],0,1,2,{for_store:1729})]){
  const h=harness(normalRoute([body],{marketBody:choice(true)}));const result=await collect(h);
  assert.equal(result.complete,false);assert(result.error);assert.equal(result.received,0);assert.equal(result.accepted.length,0);assert.equal(result.cursor.nextPage,0);assert.equal(h.calls.length,3);
 }
});

test("short or empty nonterminal native pages preserve the last successful checkpoint",async()=>{
 for(const second of [list([],1,3),list([butter],1,4),"<header>Berlin-Mitte</header>"]){
  const h=harness(normalRoute([list([milk,ordinary],0,3),second],{marketBody:choice(true)}));const result=await collect(h);
  assert.equal(result.complete,false);assert(result.error);assert.equal(result.received,2);assert.equal(result.accepted.length,2);assert.equal(result.cursor.nextPage,1);assert.equal(result.pages.length,1);assert.equal(h.calls.length,4);
 }
});

test("native total or page-size drift never turns overlapping data into a completed catalog",async()=>{
 for(const second of [list([butter,clone(ordinary)],1,4,2),list([butter],1,4,3)]){
  const h=harness(normalRoute([list([milk,ordinary],0,3),second],{marketBody:choice(true)}));const result=await collect(h);
  assert.equal(result.complete,false);assert(result.error);assert.equal(result.total,3);assert.equal(result.received,2);assert.equal(result.cursor.nextPage,1);
 }
});

test("a native page that repeats a prior SKU cannot manufacture catalog completeness",async()=>{
 const h=harness(normalRoute([list([milk,ordinary],0,3),list([clone(milk)],1,3)],{marketBody:choice(true)}));
 const result=await collect(h);assert.equal(result.complete,false);assert(result.error);assert.equal(result.received,2);assert.equal(result.accepted.length,2);assert.equal(result.cursor.nextPage,1);
});

test("a conflicting same-GTIN fixed-pack price on another SKU is rejected across pages",async()=>{
 const alternate=clone(milk);alternate.external_id="000000000000999999ST";alternate.url=alternate.url.replace(milk.external_id,alternate.external_id);alternate.price="1.45";alternate.priceTag.priceCent="45";
 const h=harness(normalRoute([list([milk,ordinary],0,3),list([alternate],1,3)],{marketBody:choice(true)}));
 const result=await collect(h);assert.equal(result.complete,false);assert(result.error);assert.equal(result.received,2);assert.equal(result.cursor.nextPage,1);
});

test("same-GTIN conflicts are still detected after a checkpoint resume",async()=>{
 const alternate=clone(milk);alternate.external_id="000000000000999999ST";alternate.url=alternate.url.replace(milk.external_id,alternate.external_id);alternate.price="1.45";alternate.priceTag.priceCent="45";
 const h=harness(normalRoute([list([milk,ordinary],0,3),list([alternate],1,3)],{marketBody:choice(true)}));
 const first=await collect(h,{maxRequests:3}),second=await collect(h,{maxRequests:3,cursor:first.cursor});
 assert.equal(second.complete,false);assert(second.error);assert.equal(second.received,2);assert.equal(second.accepted.length,0);assert.equal(second.cursor.nextPage,1);
});

test("equal same-pack GTIN quotes on distinct native SKUs and different pack counts remain separate",async()=>{
 const same=clone(milk);same.external_id="000000000000999997ST";same.url=same.url.replace(milk.external_id,same.external_id);
 const multipack=clone(milk);multipack.external_id="000000000000999998ST";multipack.url=multipack.url.replace(milk.external_id,multipack.external_id);multipack.overview="2x500ml Packung";
 const h=harness(normalRoute([list([milk,ordinary],0,4),list([same,multipack],1,4)],{marketBody:choice(true)}));
 const result=await collect(h);assert.equal(result.complete,true);assert.equal(result.received,4);assert.equal(result.accepted.length,4);
 assert.deepEqual(result.accepted.filter(row=>row.gtin===milk.ean).map(row=>[row.retailerSku,row.packCount]),[[milk.external_id,1],[same.external_id,1],[multipack.external_id,2]]);
});

test("duplicate native SKUs within one page fail the uniqueness contract even when prices agree",async()=>{
 const h=harness(normalRoute([list([milk,clone(milk)],0,2)],{marketBody:choice(true)}));
 const result=await collect(h);assert.equal(result.complete,false);assert(result.error);assert.equal(result.received,0);assert.equal(result.accepted.length,0);
});

test("seen native SKUs survive continuation and reject a repeated later page",async()=>{
 const h=harness(normalRoute([list([milk,ordinary],0,3),list([clone(ordinary)],1,3)],{marketBody:choice(true)}));
 const first=await collect(h,{maxRequests:3});assert(first.cursor);
 const second=await collect(h,{maxRequests:3,cursor:first.cursor});assert.equal(second.complete,false);assert(second.error);assert.equal(second.received,2);assert.equal(second.cursor.nextPage,1);assert.equal(second.accepted.length,0);
});

test("403 and 429 on a later page stop immediately and expose at least one hour cooldown",async()=>{
 for(const status of [403,429]){
  const h=harness((url,call,n,response)=>{
   if(n===1)return response(choice(true));if(n===2)return response("Market selected");if(n===3)return response(list([milk,ordinary],0,3));
   if(n===4)return response("Denied",{status,headers:{"retry-after":"7200"}});assert.fail("Denied source must not be retried");
  });
  const result=await collect(h,{maxRequests:16});assert.equal(result.complete,false);assert.equal(result.error.code,"hit-source-http-"+status);assert(result.error.retryAfterMs>=7200000,"A native two-hour Retry-After must not be shortened to one hour");assert.equal(result.received,2);assert.equal(result.cursor.nextPage,1);assert.equal(h.calls.length,4);
 }
});

test("bootstrap 403/429 propagates a cooldown and makes no selection or catalog request",async()=>{
 for(const status of [403,429]){
  const h=harness((url,call,n,response)=>response("Denied",{status}));
  await assert.rejects(()=>collect(h),error=>errHas(error,"http-"+status)&&error.retryAfterMs>=3600000);assert.equal(h.calls.length,1);
 }
});

test("stale cache or response dates cannot renew native price freshness",async()=>{
 for(const headers of [{age:"301"},{date:new Date(afterCooldown-600000).toUTCString()},{date:null},{age:"broken"}]){
  const h=harness((url,call,n,response)=>n===1?response(choice(true)):n===2?response("Market selected"):response(list([milk]),{headers}));
  const result=await collect(h);assert.equal(result.complete,false);assert(result.error);assert.equal(result.accepted.length,0);assert.equal(result.received,0);assert.equal(result.cursor.nextPage,0);
 }
});

test("a genuinely empty scoped native catalog completes without inventing offers",async()=>{
 const h=harness(normalRoute([list([],0,0)],{marketBody:choice(true)}));const result=await collect(h);
 assert.equal(result.complete,true);assert.equal(result.physicalStoreAssortmentComplete,false);assert.equal(result.total,0);assert.equal(result.received,0);assert.equal(result.accepted.length,0);assert.equal(result.rejected.length,0);assert.equal(result.requests,3);
});

test("wrong-market and inconsistent continuation cursors reject before source I/O",async()=>{
 const h=harness(normalRoute([list([milk,ordinary],0,3),list([butter],1,3)],{marketBody:choice(true)}));const first=await collect(h,{maxRequests:3});
 const originalCalls=h.calls.length;
 for(const change of [{nativeStoreNumber:"054"},{nativeStoreId:1729},{nextPage:2},{received:0},{total:100001},{limit:0},{seenQuotes:undefined}]){
  await assert.rejects(()=>collect(h,{cursor:{...clone(first.cursor),...change}}),error=>errHas(error,"cursor"));assert.equal(h.calls.length,originalCalls);
 }
});

test("request URL allowlist cannot be widened with duplicate parameters, path encoding, credentials or foreign markets",async()=>{
 for(const url of ["https://www.hit.de/sortiment/uebersicht?page=1&page=2","https://www.hit.de/sortiment/uebersicht?page=-1","https://www.hit.de/sortiment/uebersicht?markt=054","https://www.hit.de/sortiment/%75ebersicht","https://www.hit.de/maerkte/berlin-zoo?mein-markt=1","https://www.hit.de/maerkte/berlin-mitte?mein-markt=1&mein-markt=1","https://www.hit.de:444/sortiment/uebersicht","https://www.hit.de/sortiment/uebersicht?redirect=https://evil.example"])
  assert.throws(()=>Collector.allowedUrl(url,store),error=>errHas(error,"url-not-allowed"),url);
});

(async()=>{
 const failures=[];
 for(const {name,run}of cases)try{await run()}catch(error){failures.push(name+": "+error.stack)}
 if(failures.length){console.error(failures.join("\n\n"));process.exitCode=1}
 else console.log("hit-assortment-collector: OK ("+cases.length+" offline cases)");
})().catch(error=>{console.error(error);process.exitCode=1});
