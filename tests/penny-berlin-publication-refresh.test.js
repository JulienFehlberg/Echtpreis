"use strict";
const assert=require("node:assert/strict"),crypto=require("node:crypto"),Refresh=require("../penny-berlin-publication-refresh"),Publications=require("../penny-berlin-publications");
const fixture=require("./fixtures/retailers/penny-berlin-publication-capture.json").capture;
const NOW=Date.parse("2026-10-02T15:31:00Z"),DAY=86400000,MAX_BYTES=1500000;
const clone=value=>JSON.parse(JSON.stringify(value));
function response(record,options={}){
 const bytes=options.bytes??Buffer.from(record.body),headers=new Headers(Object.entries(record.headers).filter(([,value])=>value!=null));
 if(options.headers)for(const[key,value]of Object.entries(options.headers))headers.set(key,value);
 return{status:options.status??200,url:options.url??record.sourceResponseUrl,headers,arrayBuffer:options.arrayBuffer??(async()=>bytes),...(options.body?{body:options.body}:{})};
}
function sourceFetch(patches={}){
 const calls=[],records=new Map([fixture.market,fixture.categoryPage,fixture.offers].map(record=>[record.sourceResponseUrl,record]));
 return{calls,fetchImpl:async(url,options)=>{calls.push({url,options});const record=patches[url]?.record??records.get(url);assert(record,"Only the three documented public URLs can be requested: "+url);const patch=patches[url]??{};return response(record,patch);}};
}
function poolMock(options={}){
 const calls=[];let state=clone(options.state??{}),captureRows=0,checkpointFailures=options.checkpointFailures??0,ddlFailures=options.ddlFailures??0;
 return{calls,snapshot:()=>({state:clone(state),captureRows}),query:async(sql,params=[])=>{
  calls.push({sql,params:clone(params)});
  if(sql.startsWith("CREATE TABLE")){if(ddlFailures-->0)throw Error("synthetic-ddl-failure");return{rows:[],rowCount:0};}
  if(sql.startsWith("SELECT last_completed_at"))return{rows:Object.keys(state).length?[clone(state)]:[],rowCount:0};
  if(sql.startsWith("INSERT INTO "+Publications.TABLE)){if(options.captureWriteFailure)throw Object.assign(Error("synthetic-capture-write-failure"),{code:"synthetic-capture-write-failure"});captureRows++;return{rows:[],rowCount:1};}
  if(sql.startsWith("INSERT INTO "+Refresh.TABLE)){
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
 await test("Exactly three guest GETs produce a bound original capture",async()=>{
  const source=sourceFetch(),raw=await Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW});
  assert.equal(source.calls.length,3);assert.deepEqual(source.calls.map(call=>call.url),[Publications.MARKET_URL,Publications.PAGE_URL,fixture.offers.sourceResponseUrl]);
  for(const call of source.calls){assert.equal(call.options.method,"GET");assert.equal(call.options.credentials,"omit");assert.equal(call.options.redirect,"manual");assert(call.options.signal);assert.equal(call.options.body,undefined);}
  for(const part of["market","categoryPage","offers"]){assert.equal(raw[part].sourceResponseHash,Publications.hash(raw[part].body));assert.equal(raw[part].capturedAt,new Date(NOW).toISOString());}
  const parsed=Publications.parseCapture(raw,{now:NOW});assert.equal(parsed.received,36);assert.equal(parsed.nativeProductIdentities,0);assert.equal(parsed.fullAssortment,false);
 });
 await test("403 stops before category/offer requests or error body reads",async()=>{
  let bodyReads=0;const source=sourceFetch({[Publications.MARKET_URL]:{status:403,headers:{"retry-after":"7200"},arrayBuffer:async()=>{bodyReads++;throw Error("forbidden-body-read");}}});
  await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.code==="penny-source-http-403"&&error.retryAfterMs===7200000);
  assert.equal(source.calls.length,1);assert.equal(bodyReads,0);
 });
 await test("429 on the category stops before the third offer request",async()=>{
  const source=sourceFetch({[Publications.PAGE_URL]:{status:429,headers:{"retry-after":"7200"}}});
  await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.code==="penny-source-http-429"&&error.retryAfterMs===7200000);assert.equal(source.calls.length,2);
 });
 await test("Retry-After HTTP date retains a longer native pause",async()=>{
  const expected=NOW+3*3600000,source=sourceFetch({[Publications.MARKET_URL]:{status:429,headers:{"retry-after":new Date(expected).toUTCString()}}});
  await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.retryAfterMs===expected-NOW);assert.equal(source.calls.length,1);
 });
 await test("Missing/invalid/short Retry-After keeps at least one hour",async()=>{
  for(const value of[undefined,"garbage","0","2",new Date(NOW-1000).toUTCString()]){
   const patch={status:403};if(value!==undefined)patch.headers={"retry-after":value};const source=sourceFetch({[Publications.MARKET_URL]:patch});
   await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.retryAfterMs===3600000);assert.equal(source.calls.length,1);
  }
 });
 await test("Redirect statuses never follow or read their body",async()=>{
  for(const status of[301,302,307,308]){let reads=0;const source=sourceFetch({[Publications.MARKET_URL]:{status,headers:{location:"https://elsewhere.test"},arrayBuffer:async()=>{reads++;return Buffer.from("unapproved");}}});
   await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.code==="penny-source-http-"+status);assert.equal(source.calls.length,1);assert.equal(reads,0);assert.equal(source.calls[0].options.redirect,"manual");
  }
 });
 await test("A changed 200 response URL is refused before body parsing",async()=>{
  let reads=0;const source=sourceFetch({[Publications.MARKET_URL]:{url:"https://www.penny.de/unapproved",arrayBuffer:async()=>{reads++;return Buffer.from(fixture.market.body);}}});
  await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.code==="penny-source-redirect-unapproved");assert.equal(reads,0);assert.equal(source.calls.length,1);
 });
 await test("Declared oversized body is rejected without reading",async()=>{
  let reads=0;const source=sourceFetch({[Publications.MARKET_URL]:{headers:{"content-length":String(MAX_BYTES+1)},arrayBuffer:async()=>{reads++;return Buffer.alloc(0);}}});
  await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.code==="penny-source-body-too-large");assert.equal(reads,0);
 });
 await test("Actual stream budget cancels on the first oversized chunk",async()=>{
  let reads=0,cancelled=0,released=0;const chunks=[Buffer.alloc(1000000,97),Buffer.alloc(500001,97),Buffer.alloc(50,97)];
  const reader={read:async()=>{const value=chunks[reads++];return value?{done:false,value}:{done:true};},cancel:async()=>{cancelled++;},releaseLock:()=>{released++;}};
  const result=response(fixture.market,{body:{getReader:()=>reader}});
  await assert.rejects(()=>Refresh.get(Publications.MARKET_URL,{now:()=>NOW,fetchImpl:async()=>result}),error=>error.code==="penny-source-body-too-large");assert.equal(reads,2);assert.equal(cancelled,1);assert.equal(released,1);
 });
 await test("Fallback response size is checked before capture construction",async()=>{
  const source=sourceFetch({[Publications.MARKET_URL]:{bytes:Buffer.alloc(MAX_BYTES+1,97)}});
  await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.code==="penny-source-body-too-large");assert.equal(source.calls.length,1);
 });
 await test("Valid stream preserves exact UTF8 bytes and releases its reader",async()=>{
  const bytes=Buffer.from("UNIT TEST ÄÖÜ € "+fixture.market.body),chunks=[bytes.subarray(0,16),bytes.subarray(16)];let reads=0,released=0;
  const reader={read:async()=>reads<chunks.length?{done:false,value:chunks[reads++]}:{done:true},releaseLock:()=>{released++;}};
  const raw=await Refresh.get(Publications.MARKET_URL,{now:()=>NOW,fetchImpl:async()=>response(fixture.market,{body:{getReader:()=>reader}})});
  assert.equal(raw.body,bytes.toString("utf8"));assert.equal(raw.sourceResponseHash,crypto.createHash("sha256").update(bytes).digest("hex"));assert.equal(raw.bytes,bytes.length);assert.equal(released,1);
 });
 await test("Invalid UTF8 never yields an original-capture hash",async()=>{
  await assert.rejects(()=>Refresh.get(Publications.MARKET_URL,{now:()=>NOW,fetchImpl:async()=>response(fixture.market,{bytes:Buffer.from([0xc3,0x28])})}),error=>error.code==="ERR_ENCODING_INVALID_ENCODED_DATA");
 });
 await test("UTF8 BOM is retained in the original byte/hash binding",async()=>{
  const bytes=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('{"unit":"synthetic"}')]),raw=await Refresh.get(Publications.MARKET_URL,{now:()=>NOW,fetchImpl:async()=>response(fixture.market,{bytes})});
  assert(raw.body.startsWith("\uFEFF"));assert.equal(raw.sourceResponseHash,crypto.createHash("sha256").update(bytes).digest("hex"));assert.equal(Buffer.byteLength(raw.body),bytes.length);
 });
 await test("Foreign market/city/region cannot authorize an offer request",async()=>{
  for(const patch of[{wwIdent:"8534450"},{sellingRegion:"15A-01-57"},{city:"Potsdam"}]){
   const market={...fixture.market,body:JSON.stringify({...JSON.parse(fixture.market.body),...patch})},source=sourceFetch({[Publications.MARKET_URL]:{record:market}});
   await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.code==="penny-native-Berlin-market-required");assert.equal(source.calls.length,2);
  }
 });
 await test("Absent/future native week stops before price API access",async()=>{
  for(const body of[fixture.categoryPage.body.replace('data-week="2026-40"','data-week="2026-41"'),fixture.categoryPage.body.replace('data-week="2026-40"',""),"<main>unbound</main>"]){
   const page={...fixture.categoryPage,body},source=sourceFetch({[Publications.PAGE_URL]:{record:page}});
   await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.code==="penny-native-current-week-required");assert.equal(source.calls.length,2);
  }
 });
 await test("Original parser rejects stale HTTP metadata before persistence",async()=>{
  const source=sourceFetch({[fixture.offers.sourceResponseUrl]:{headers:{age:"301"}}});
  await assert.rejects(()=>Refresh.capture({fetchImpl:source.fetchImpl,now:()=>NOW}),error=>error.code==="penny-original-http-freshness-required");assert.equal(source.calls.length,3);
 });
 await test("Successful persistence precedes refresh checkpoint and keeps original expiry",async()=>{
  const pool=poolMock(),saved=await Refresh.refresh({pool,now:()=>NOW},{capture:async()=>clone(fixture)}),writes=pool.calls.filter(call=>call.sql.startsWith("INSERT INTO"));
  assert.equal(writes.length,2);assert(writes[0].sql.startsWith("INSERT INTO "+Publications.TABLE));assert(writes[1].sql.startsWith("INSERT INTO "+Refresh.TABLE));
  assert.equal(writes[0].params[2],fixture.offers.capturedAt);assert.equal(Date.parse(writes[0].params[3]),Date.parse(fixture.offers.capturedAt)+DAY);assert.equal(saved.nativeProductIdentities,0);assert.equal(saved.fullAssortment,false);assert.equal(pool.snapshot().state.lastError,null);assert.equal(Date.parse(pool.snapshot().state.nextAttemptAt),NOW+Refresh.REFRESH_MS);
 });
 await test("Durable cooldown prevents capture calls after restart",async()=>{
  let calls=0;const state={nextAttemptAt:new Date(NOW+7200000).toISOString(),lastError:"penny-source-http-429",completedCaptures:4},pool=poolMock({state});
  const result=await Refresh.refresh({pool,now:()=>NOW},{capture:async()=>{calls++;throw Error("must-not-fetch");}});
  assert.equal(result.skipped,"source-cooldown");assert.equal(result.nextAttemptAt,state.nextAttemptAt);assert.equal(calls,0);assert.equal(pool.calls.filter(call=>call.sql.startsWith("INSERT INTO")).length,0);assert.equal(pool.snapshot().state.completedCaptures,4);
 });
 await test("Native failure deadline is durable and preserves completed observations",async()=>{
  const prior={lastCompletedAt:"2026-10-02T12:00:00Z",proofHash:"a".repeat(64),completedCaptures:7,received:36,accepted:33},pool=poolMock({state:prior});
  await assert.rejects(()=>Refresh.refresh({pool,now:()=>NOW},{capture:async()=>{throw Object.assign(Error("blocked"),{code:"penny-source-http-429",retryAfterMs:7200000});}}),error=>error.nextAttemptAt===new Date(NOW+7200000).toISOString());
  const state=pool.snapshot().state;assert.equal(state.lastError,"penny-source-http-429");assert.equal(state.nextAttemptAt,new Date(NOW+7200000).toISOString());for(const key of Object.keys(prior))assert.equal(state[key],prior[key]);assert.equal(pool.snapshot().captureRows,0);
 });
 await test("Capture write failure never creates a successful checkpoint",async()=>{
  const pool=poolMock({captureWriteFailure:true});await assert.rejects(()=>Refresh.refresh({pool,now:()=>NOW},{capture:async()=>clone(fixture)}),error=>error.code==="synthetic-capture-write-failure");
  assert.equal(pool.snapshot().captureRows,0);assert.equal(pool.snapshot().state.lastCompletedAt,undefined);assert.equal(pool.snapshot().state.lastError,"synthetic-capture-write-failure");assert.equal(Date.parse(pool.snapshot().state.nextAttemptAt),NOW+3600000);
 });
 await test("Checkpoint failure retains committed original and stores failure cooldown",async()=>{
  const pool=poolMock({checkpointFailures:1});await assert.rejects(()=>Refresh.refresh({pool,now:()=>NOW},{capture:async()=>clone(fixture)}),error=>error.code==="synthetic-checkpoint-failure");
  assert.equal(pool.snapshot().captureRows,1);assert.equal(pool.snapshot().state.lastCompletedAt,undefined);assert.equal(pool.snapshot().state.lastError,"synthetic-checkpoint-failure");assert.equal(Date.parse(pool.snapshot().state.nextAttemptAt),NOW+3600000);
 });
 await test("Expired archived originals cannot commit or renew a fresh capture",async()=>{
  const pool=poolMock();await assert.rejects(()=>Refresh.refresh({pool,now:()=>NOW+2*DAY},{capture:async()=>clone(fixture)}),error=>error.code==="penny-capture-already-expired");
  assert.equal(pool.snapshot().captureRows,0);assert.equal(pool.snapshot().state.lastCompletedAt,undefined);assert.equal(pool.snapshot().state.lastError,"penny-capture-already-expired");
 });
 await test("Process guard stops overlapping calls and releases after success",async()=>{
  const pool=poolMock();let release,started;const ready=new Promise(resolve=>{started=resolve;}),pending=new Promise(resolve=>{release=resolve;});
  const first=Refresh.refresh({pool,now:()=>NOW},{capture:async()=>{started();await pending;return clone(fixture);}});await ready;
  const second=await Refresh.refresh({pool,now:()=>NOW},{capture:async()=>{throw Error("overlap");}});assert.equal(second.skipped,"already-running");release();await first;
  const next=await Refresh.refresh({pool,now:()=>NOW},{capture:async()=>{throw Error("cooldown");}});assert.equal(next.skipped,"source-cooldown");
 });
 await test("Refresh schema is shared once per pool and retryable after DDL failure",async()=>{
  const pool=poolMock({ddlFailures:1});await assert.rejects(()=>Refresh.resumeAt(pool),/synthetic-ddl-failure/);assert.equal(await Refresh.resumeAt(pool),null);assert.equal(await Refresh.resumeAt(pool),null);
  assert.equal(pool.calls.filter(call=>call.sql.startsWith("CREATE TABLE")).length,2);
 });
 await test("Status and resumeAt expose durable pause without price or coverage upgrades",async()=>{
  const next=new Date(NOW+3600000).toISOString(),pool=poolMock({state:{nextAttemptAt:next,completedCaptures:3,accepted:33}}),status=await Refresh.status(pool);
  assert.equal(status.sourceId,Publications.SOURCE);assert.equal(status.scopeChannel,"retailer-price-publication");assert.equal(status.fullAssortment,false);assert.equal(status.refreshIntervalMinutes,360);assert.equal(await Refresh.resumeAt(pool),next);assert.equal(pool.calls.filter(call=>call.sql.startsWith("CREATE TABLE")).length,1);
 });
 console.log("penny-berlin-publication-refresh: "+groups+" focused groups passed; synthetic HTTP and SQL mocks only, no retailer/database calls");
})().catch(error=>{console.error(error);process.exitCode=1;});
