"use strict";
const assert=require("node:assert/strict"),crypto=require("node:crypto"),Refresh=require("../edeka-counter-refresh"),Quotes=require("../edeka-counter-quotes"),Fixture=require("./helpers/edeka-counter-capture-fixture");
const NOW=Date.parse("2026-10-02T15:35:00.000Z"),DAY=86400000,clone=value=>structuredClone(value);
const urls=[Quotes.PAGE_URL,...Quotes.MODULES.map(module=>module.url),Quotes.STORES_URL,Quotes.PRODUCTS_URL];
function response(record,options={}){
 const bytes=options.bytes??Buffer.from(record.body),headers=new Headers(Object.entries(record.headers).filter(([,value])=>value!=null));
 for(const[key,value]of Object.entries(options.headers??{}))headers.set(key,value);
 return{status:options.status??200,url:options.url??record.sourceResponseUrl,headers,arrayBuffer:options.arrayBuffer??(async()=>bytes),...(options.body?{body:options.body}:{})};
}
function sourceFetch(patches={}){
 // Only mocked response metadata is retimed; the committed original fixture is unchanged.
 const records=new Map(Object.values(Fixture.synthetic(NOW)).map(record=>[record.sourceResponseUrl,record])),calls=[];
 return{calls,fetchImpl:async(url,options)=>{calls.push({url,options});assert(records.has(url),"Only the five observed URLs may be requested: "+url);const patch=patches[url]??{};if(patch.throw)throw patch.throw;return response(patch.record??records.get(url),patch);}};
}
function changedStore(mutate){
 const raw=Fixture.synthetic(NOW),rows=JSON.parse(raw.stores.body);mutate(rows.find(row=>row.id===Quotes.SHOP.nativeStoreId),rows);raw.stores.body=JSON.stringify(rows);raw.stores.sourceResponseHash=Quotes.hash(raw.stores.body);raw.stores.bytes=Buffer.byteLength(raw.stores.body);return raw.stores;
}
function poolMock(options={}){
 const calls=[];let state=clone(options.state??{}),captureRows=0,checkpointFailures=options.checkpointFailures??0,ddlFailures=options.ddlFailures??0;
 return{calls,snapshot:()=>({state:clone(state),captureRows}),query:async(sql,params=[])=>{
  calls.push({sql,params:clone(params)});
  if(sql.startsWith("CREATE TABLE")){if(ddlFailures-->0)throw Error("synthetic-ddl-failure");return{rows:[],rowCount:0};}
  if(sql.startsWith("SELECT last_completed_at")){assert.deepEqual(params,[Quotes.SOURCE]);return{rows:Object.keys(state).length?[clone(state)]:[],rowCount:0};}
  if(sql.startsWith("INSERT INTO "+Quotes.TABLE)){assert.equal(params[0],Quotes.SOURCE);if(options.captureWriteFailure)throw Object.assign(Error("synthetic-capture-write-failure"),{code:"synthetic-capture-write-failure"});captureRows++;return{rows:[],rowCount:1};}
  if(sql.startsWith("INSERT INTO "+Refresh.TABLE)){
   assert.equal(params[0],Quotes.SOURCE);
   if(sql.includes("last_completed_at")){
    if(checkpointFailures-->0)throw Object.assign(Error("synthetic-checkpoint-failure"),{code:"synthetic-checkpoint-failure"});
    state={...state,lastCompletedAt:params[1],lastError:null,nextAttemptAt:params[2],proofHash:params[3],completedCaptures:(state.completedCaptures??0)+1,received:params[4],accepted:params[5]};
   }else state={...state,lastError:params[1],nextAttemptAt:params[2]};
   return{rows:[],rowCount:1};
  }
  throw Error("Unexpected SQL in isolated mock: "+sql);
 }};
}
let groups=0;
async function test(name,fn){await fn();groups++;console.log("ok "+groups+" - "+name);}
(async()=>{
 await test("Five sequential guest GETs retain exact native originals",async()=>{
  const source=sourceFetch(),raw=await Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW});
  assert.deepEqual(source.calls.map(call=>call.url),urls);assert.equal(source.calls.length,5);
  for(const call of source.calls){assert.equal(call.options.method,"GET");assert.equal(call.options.credentials,"omit");assert.equal(call.options.redirect,"manual");assert(call.options.signal);assert.equal(call.options.body,undefined);assert.equal(call.options.headers.Cookie,undefined);}
  for(const record of Object.values(raw)){assert.equal(record.sourceResponseHash,Quotes.hash(record.body));assert.equal(record.bytes,Buffer.byteLength(record.body));assert.equal(record.capturedAt,new Date(NOW).toISOString());}
  const parsed=Quotes.parseCapture(raw,{now:NOW});assert.equal(parsed.received,155);assert.equal(parsed.accepted,124);assert.equal(parsed.rejected,31);
  assert(parsed.quotes.every(quote=>quote.pack===null&&quote.gtin===null&&quote.scopeChannel==="pickup"&&quote.truthEligible===false&&quote.minimumOrderOffsetDays>=3));
 });
 await test("Every 403/429 position stops immediately without reading an error body",async()=>{
  for(const status of[403,429])for(let index=0;index<urls.length;index++){
   let reads=0;const source=sourceFetch({[urls[index]]:{status,headers:{"retry-after":"7200"},arrayBuffer:async()=>{reads++;throw Error("forbidden-body-read");}}});
   await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.code==="edeka-counter-source-http-"+status&&error.retryAfterMs===7200000);
   assert.equal(source.calls.length,index+1);assert.equal(reads,0);
  }
 });
 await test("Longer HTTP-date Retry-After remains authoritative",async()=>{
  const next=NOW+3*3600000,source=sourceFetch({[Quotes.PAGE_URL]:{status:429,headers:{"retry-after":new Date(next).toUTCString()}}});
  await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.retryAfterMs===next-NOW);assert.equal(source.calls.length,1);
 });
 await test("Missing invalid and short Retry-After retain at least one hour",async()=>{
  for(const value of[undefined,"garbage","0","2",new Date(NOW-1000).toUTCString()]){
   const patch={status:403};if(value!==undefined)patch.headers={"retry-after":value};const source=sourceFetch({[Quotes.PAGE_URL]:patch});
   await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.retryAfterMs===3600000);
  }
 });
 await test("Overflowing Retry-After cannot destroy durable failure recording",async()=>{
  for(const value of["9".repeat(400),"8640000000000000"]){
   const source=sourceFetch({[Quotes.PAGE_URL]:{status:429,headers:{"retry-after":value}}}),pool=poolMock();
   await assert.rejects(()=>Refresh.refresh({pool,now:()=>NOW},{fetchImpl:source.fetchImpl}),error=>error.retryAfterMs===3600000&&error.nextAttemptAt===new Date(NOW+3600000).toISOString());
   assert.equal(pool.snapshot().state.lastError,"edeka-counter-source-http-429");assert.equal(pool.snapshot().captureRows,0);
  }
 });
 await test("Redirect and 404 statuses are single attempts without body/fallback",async()=>{
  for(const status of[301,302,307,308,404]){let reads=0;const source=sourceFetch({[Quotes.PAGE_URL]:{status,headers:{location:"https://elsewhere.test"},arrayBuffer:async()=>{reads++;return Buffer.from("unapproved");}}});
   await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.code==="edeka-counter-source-http-"+status);assert.equal(source.calls.length,1);assert.equal(reads,0);
  }
 });
 await test("Unapproved URL is rejected before any HTTP call",async()=>{
  let calls=0;for(const url of[Quotes.PRODUCTS_URL+"&other=1",Quotes.PRODUCTS_URL.replace("800411","801004"),"https://elsewhere.test"]){
   await assert.rejects(()=>Refresh.get(url,{now:()=>NOW,fetchImpl:async()=>{calls++;throw Error("unexpected-network");}}),/unreviewed-source-url/);
  }assert.equal(calls,0);
 });
 await test("Changed 200 response URL is rejected before reading",async()=>{
  let reads=0;const source=sourceFetch({[Quotes.PAGE_URL]:{url:Quotes.PAGE_URL+"&other=1",arrayBuffer:async()=>{reads++;return Buffer.alloc(0);}}});
  await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),/source-redirect-unapproved/);assert.equal(reads,0);assert.equal(source.calls.length,1);
 });
 await test("Declared oversized body is refused before reading",async()=>{
  let reads=0;const source=sourceFetch({[Quotes.PAGE_URL]:{headers:{"content-length":String(Refresh.MAX_BYTES+1)},arrayBuffer:async()=>{reads++;return Buffer.alloc(0);}}});
  await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),/body-too-large/);assert.equal(reads,0);
 });
 await test("Streaming budget cancels on the first oversized chunk",async()=>{
  let reads=0,cancelled=0,released=0;const chunks=[Buffer.alloc(1000000,97),Buffer.alloc(500001,97),Buffer.alloc(50,97)],reader={read:async()=>{const value=chunks[reads++];return value?{done:false,value}:{done:true};},cancel:async()=>{cancelled++;},releaseLock:()=>{released++;}};
  await assert.rejects(()=>Refresh.get(Quotes.PAGE_URL,{now:()=>NOW,fetchImpl:async()=>response(Fixture.synthetic(NOW).guest,{body:{getReader:()=>reader}})}),/body-too-large/);
  assert.equal(reads,2);assert.equal(cancelled,1);assert.equal(released,1);
 });
 await test("Fallback byte budget is checked before constructing a capture",async()=>{
  const source=sourceFetch({[Quotes.PAGE_URL]:{bytes:Buffer.alloc(Refresh.MAX_BYTES+1,97)}});
  await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),/body-too-large/);assert.equal(source.calls.length,1);
 });
 await test("Stream preserves split UTF8 characters exact bytes hash and reader release",async()=>{
  const bytes=Buffer.from("ÄÖÜ € synthetic original"),chunks=[bytes.subarray(0,1),bytes.subarray(1,5),bytes.subarray(5)];let reads=0,released=0;
  const reader={read:async()=>reads<chunks.length?{done:false,value:chunks[reads++]}:{done:true},releaseLock:()=>{released++;}},raw=await Refresh.get(Quotes.PAGE_URL,{now:()=>NOW,fetchImpl:async()=>response(Fixture.synthetic(NOW).guest,{body:{getReader:()=>reader}})});
  assert.equal(raw.body,bytes.toString("utf8"));assert.equal(raw.sourceResponseHash,crypto.createHash("sha256").update(bytes).digest("hex"));assert.equal(raw.bytes,bytes.length);assert.equal(released,1);
 });
 await test("Malformed UTF8 is never persisted as an original",async()=>{
  await assert.rejects(()=>Refresh.get(Quotes.PAGE_URL,{now:()=>NOW,fetchImpl:async()=>response(Fixture.synthetic(NOW).guest,{bytes:Buffer.from([0xc3,0x28])})}),error=>error.code==="ERR_ENCODING_INVALID_ENCODED_DATA");
 });
 await test("UTF8 BOM stays bound to original bytes and hash",async()=>{
  const bytes=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from("synthetic")]),raw=await Refresh.get(Quotes.PAGE_URL,{now:()=>NOW,fetchImpl:async()=>response(Fixture.synthetic(NOW).guest,{bytes})});
  assert(raw.body.startsWith("\uFEFF"));assert.equal(raw.sourceResponseHash,crypto.createHash("sha256").update(bytes).digest("hex"));assert.equal(raw.bytes,Buffer.byteLength(raw.body));
 });
 await test("Unbound guest scripts stop before requesting any module",async()=>{
  for(const key of["shared","page"]){const record=Fixture.synthetic(NOW).guest,module=Quotes.MODULES.find(module=>module.key===key);record.body=record.body.replace(new URL(module.url).pathname,"/unreviewed.js");const source=sourceFetch({[Quotes.PAGE_URL]:{record}});
   await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),/native-guest-modules-required/);assert.equal(source.calls.length,1);
  }
 });
 await test("Each module hash must match before any subsequent request",async()=>{
  for(let index=0;index<Quotes.MODULES.length;index++){const module=Quotes.MODULES[index],record=Fixture.synthetic(NOW)[module.key];record.body+=" /* synthetic mutation */";const source=sourceFetch({[module.url]:{record}});
   await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),/native-module-hash-required/);assert.equal(source.calls.length,index+2);
  }
 });
 await test("Full guest binding freshness is checked before requesting stores",async()=>{
  const source=sourceFetch({[Quotes.PAGE_URL]:{headers:{age:"301"}}});
  await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),/http-freshness-required/);assert.equal(source.calls.length,3);
 });
 await test("Native market identity tenant location and order limits precede products",async()=>{
  const mutations=[row=>row.id="801004",row=>row.tenantId="10006944",row=>row.address="Berliner Str. 1, 16515 Oranienburg",row=>row.settings.currency="USD",row=>row.latitude=52,row=>row.orderSettings.minOffsetDays=2,row=>row.orderSettings.maxOffsetDays=367,(row,rows)=>rows.push({...row})];
  for(const mutate of mutations){const source=sourceFetch({[Quotes.STORES_URL]:{record:changedStore(mutate)}});
   await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),/native-Berlin-store-required/);assert.equal(source.calls.length,4);
  }
 });
 await test("Malformed stores cannot authorize the product URL",async()=>{
  for(const body of["not-json","{}"]){const record=Fixture.synthetic(NOW).stores;record.body=body;const source=sourceFetch({[Quotes.STORES_URL]:{record}});
   await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),/native-stores-invalid/);assert.equal(source.calls.length,4);
  }
 });
 await test("Native longer minimum preorder remains a future pickup quote",async()=>{
  const source=sourceFetch({[Quotes.STORES_URL]:{record:changedStore(row=>row.orderSettings.minOffsetDays=4)}}),raw=await Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW});
  assert(Quotes.parseCapture(raw,{now:NOW}).quotes.every(quote=>quote.minimumOrderOffsetDays===4&&quote.physicalStorePriceVerified===false));
 });
 await test("Full parser rejects product provenance after the bounded five calls",async()=>{
  const source=sourceFetch({[Quotes.PRODUCTS_URL]:{headers:{age:"301"}}});
  await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),/http-freshness-required/);assert.equal(source.calls.length,5);
 });
 await test("Transport rejection has no retry or alternative URL",async()=>{
  const source=sourceFetch({[Quotes.PAGE_URL]:{throw:Error("synthetic-transport-failure")}});
  await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),/synthetic-transport-failure/);assert.equal(source.calls.length,1);
 });
 await test("Persistence precedes success checkpoint and cannot renew original expiry",async()=>{
  const raw=Fixture.original(),pool=poolMock(),saved=await Refresh.refresh({pool,now:()=>NOW},{capture:async()=>clone(raw)}),writes=pool.calls.filter(call=>call.sql.startsWith("INSERT INTO"));
  assert.equal(writes.length,2);assert(writes[0].sql.startsWith("INSERT INTO "+Quotes.TABLE));assert(writes[1].sql.startsWith("INSERT INTO "+Refresh.TABLE));
  assert.equal(writes[0].params[2],raw.products.capturedAt);assert.equal(Date.parse(writes[0].params[3]),Math.min(Date.parse(raw.stores.capturedAt),Date.parse(raw.products.capturedAt))+DAY);
  assert.equal(saved.accepted,124);assert.equal(saved.fullAssortment,false);assert.equal(saved.physicalStorePriceVerified,false);assert.equal(saved.normalPriceClassificationVerified,false);
  assert.equal(pool.snapshot().state.lastError,null);assert.equal(Date.parse(pool.snapshot().state.nextAttemptAt),NOW+Refresh.REFRESH_MS);
 });
 await test("Durable cooldown is read before capture with no state reset",async()=>{
  let calls=0;const state={nextAttemptAt:new Date(NOW+7200000).toISOString(),lastError:"edeka-counter-source-http-429",completedCaptures:4},pool=poolMock({state});
  const result=await Refresh.refresh({pool,now:()=>NOW},{capture:async()=>{calls++;throw Error("must-not-fetch");}});
  assert.equal(result.skipped,"source-cooldown");assert.equal(result.retryAfter,state.nextAttemptAt);assert.equal(calls,0);assert.deepEqual(pool.snapshot().state,state);assert.equal(pool.calls.filter(call=>call.sql.startsWith("INSERT INTO")).length,0);
 });
 await test("Failure deadline is durable and retains successful source evidence",async()=>{
  const prior={lastCompletedAt:"2026-10-02T12:00:00.000Z",proofHash:"a".repeat(64),completedCaptures:7,received:155,accepted:124},pool=poolMock({state:prior});
  await assert.rejects(()=>Refresh.refresh({pool,now:()=>NOW},{capture:async()=>{throw Object.assign(Error("blocked"),{code:"edeka-counter-source-http-429",retryAfterMs:7200000});}}),error=>error.nextAttemptAt===new Date(NOW+7200000).toISOString());
  const state=pool.snapshot().state;assert.equal(state.lastError,"edeka-counter-source-http-429");assert.equal(state.nextAttemptAt,new Date(NOW+7200000).toISOString());for(const key of Object.keys(prior))assert.deepEqual(state[key],prior[key]);assert.equal(pool.snapshot().captureRows,0);
  assert(pool.calls.every(call=>call.sql.includes(Refresh.TABLE)));assert(pool.calls.filter(call=>call.params.length).every(call=>call.params[0]===Quotes.SOURCE));
 });
 await test("Capture write failure cannot save successful checkpoint",async()=>{
  const pool=poolMock({captureWriteFailure:true});await assert.rejects(()=>Refresh.refresh({pool,now:()=>NOW},{capture:async()=>Fixture.original()}),/synthetic-capture-write-failure/);
  assert.equal(pool.snapshot().captureRows,0);assert.equal(pool.snapshot().state.lastCompletedAt,undefined);assert.equal(pool.snapshot().state.lastError,"synthetic-capture-write-failure");assert.equal(Date.parse(pool.snapshot().state.nextAttemptAt),NOW+3600000);
 });
 await test("Checkpoint failure retains committed original and durable failure",async()=>{
  const pool=poolMock({checkpointFailures:1});await assert.rejects(()=>Refresh.refresh({pool,now:()=>NOW},{capture:async()=>Fixture.original()}),/synthetic-checkpoint-failure/);
  assert.equal(pool.snapshot().captureRows,1);assert.equal(pool.snapshot().state.lastCompletedAt,undefined);assert.equal(pool.snapshot().state.lastError,"synthetic-checkpoint-failure");assert.equal(Date.parse(pool.snapshot().state.nextAttemptAt),NOW+3600000);
 });
 await test("Old original capture is not retimed or renewed by refresh",async()=>{
  const pool=poolMock();await assert.rejects(()=>Refresh.refresh({pool,now:()=>NOW+2*DAY},{capture:async()=>Fixture.original()}),/capture-expired/);
  assert.equal(pool.snapshot().captureRows,0);assert.equal(pool.snapshot().state.lastCompletedAt,undefined);assert.equal(pool.snapshot().state.lastError,"edeka-counter-capture-expired");
 });
 await test("Shutdown before capture performs no GET or checkpoint mutation",async()=>{
  const pool=poolMock();let calls=0;const result=await Refresh.refresh({pool,now:()=>NOW},{shouldContinue:()=>false,capture:async()=>{calls++;throw Error("must-not-fetch");}});
  assert.equal(result.skipped,"server-stopping");assert.equal(calls,0);assert.equal(pool.calls.filter(call=>call.sql.startsWith("INSERT INTO")).length,0);
 });
 await test("Shutdown between requests stops the sequence without failure reset",async()=>{
  const pool=poolMock(),source=sourceFetch();let keepGoing=true;const result=await Refresh.refresh({pool,now:()=>NOW},{shouldContinue:()=>keepGoing,fetchImpl:async(...args)=>{const value=await source.fetchImpl(...args);keepGoing=false;return value;}});
  assert.equal(result.skipped,"server-stopping");assert.equal(source.calls.length,1);assert.equal(pool.snapshot().captureRows,0);assert.equal(pool.calls.filter(call=>call.sql.startsWith("INSERT INTO")).length,0);
 });
 await test("Shutdown after capture prevents original persistence",async()=>{
  const pool=poolMock();let keepGoing=true,persists=0;const result=await Refresh.refresh({pool,now:()=>NOW},{shouldContinue:()=>keepGoing,capture:async()=>{keepGoing=false;return Fixture.original();},persist:async()=>{persists++;throw Error("must-not-persist");}});
  assert.equal(result.skipped,"server-stopping");assert.equal(persists,0);assert.equal(pool.calls.filter(call=>call.sql.startsWith("INSERT INTO")).length,0);
 });
 await test("Process guard prevents overlapping capture and releases afterward",async()=>{
  const pool=poolMock();let release,started;const ready=new Promise(resolve=>{started=resolve;}),pending=new Promise(resolve=>{release=resolve;});
  const first=Refresh.refresh({pool,now:()=>NOW},{capture:async()=>{started();await pending;return Fixture.original();}});await ready;
  const second=await Refresh.refresh({pool,now:()=>NOW},{capture:async()=>{throw Error("overlap");}});assert.equal(second.skipped,"already-running");release();await first;
  assert.equal((await Refresh.refresh({pool,now:()=>NOW},{capture:async()=>{throw Error("cooldown");}})).skipped,"source-cooldown");
 });
 await test("Schema cache retries failed initialization and shares successful DDL",async()=>{
  const pool=poolMock({ddlFailures:1});await assert.rejects(()=>Refresh.resumeAt(pool),/synthetic-ddl-failure/);assert.equal(await Refresh.resumeAt(pool),null);assert.equal(await Refresh.resumeAt(pool),null);
  assert.equal(pool.calls.filter(call=>call.sql.startsWith("CREATE TABLE")).length,2);
 });
 await test("Status exposes durable pickup cadence without sales pack or shelf claims",async()=>{
  const next=new Date(NOW+3600000).toISOString(),pool=poolMock({state:{nextAttemptAt:next,completedCaptures:3,accepted:124}}),status=await Refresh.status(pool);
  assert.equal(status.sourceId,Quotes.SOURCE);assert.equal(status.scopeChannel,"pickup");assert.equal(status.serviceType,"counter-preorder");assert.equal(status.fullAssortment,false);assert.equal(status.physicalStorePriceVerified,false);assert.equal(status.normalPriceClassificationVerified,false);assert.equal(status.refreshIntervalMinutes,360);assert.equal(await Refresh.resumeAt(pool),next);
 });
 assert.equal(groups,34);
 console.log("edeka-counter-refresh: "+groups+" focused groups passed; synthetic HTTP/SQL mocks only, no retailer/database calls");
})().catch(error=>{console.error(error);process.exitCode=1;});
