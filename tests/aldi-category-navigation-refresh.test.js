"use strict";
const assert=require("node:assert/strict"),Refresh=require("../aldi-category-refresh"),Fetch=require("../aldi-category-fetch-client"),Navigation=require("../aldi-category-navigation-parser"),ProductParser=require("../aldi-assortment-category-client"),Rejected=require("../aldi-category-rejected-capture-store"),Fixture=require("./fixtures/aldi-navigation-capture");
// Explicitly NEW synthetic original bodies and clocks. The real navigation and
// rejected-original validators and real Refresh.checkpoint execute. Fake SQL
// implements transaction staging only; it creates no native products or prices.
const T=Fixture.time+1000,iso=time=>new Date(time).toISOString();
function observation(original=Fixture.parent(),now=T){
 const bytes=Buffer.byteLength(original.body),navigation=Navigation.parseNavigationParent(original.body,original.meta,{now});let code;
 try{ProductParser.parsePage(original.body,original.meta,{now});}catch(error){code=error.code;}
 assert.equal(code,"aldi-category-native-index-conflict");
 const rejectedCapture={status:200,failureCode:code,original,bytes};Rejected.validateCapture(rejectedCapture,{now});
 return{sourceId:Refresh.SOURCE,navigation,original,rejectedCapture,discoveredTargets:Fetch.discoveryTargets(original,{now,navigation:true}),requests:1,bytes,truthEligible:false,assortmentComplete:false};
}
function initial(){const source=Fixture.leaf(()=>{},T-180000),cursor=Refresh.state();return{cursor:{...cursor,targets:[Fetch.SEED,Fixture.parentUrl],nextIndex:1,revision:7,lastRunAt:iso(T-120000),targetProofs:[{target:Fixture.parentUrl,from:Fetch.SEED,sourceResponseHash:source.meta.sourceResponseHash,capturedAt:source.meta.capturedAt}]},lastError:null,retryAfter:null,updatedAt:iso(T-120000)};}
function nestedOriginal(url,at=T+1000){const path=new URL(url).pathname.slice(0,-5),id=path.split("/").at(-1),native=Fixture.parentNative();native.query.categories=path.slice("/sortiment/".length).split("/");Object.assign(native.props.pageProps.page,{"@name":id,"@path":"/germany"+path,categoryKey:id});const child={...Fixture.childRow("synthetic-subcategory"),reference:{type:"pages",path:path+"/synthetic-subcategory"}};native.props.pageProps.apiData=JSON.stringify([[Fixture.CHILDREN,{req:{categoryPath:path,locale:"de"},res:[child]}]]);return Fixture.original(Fixture.html(native,url),url,at);}
function harness(options={}){
 let now=T,saved=options.saved??initial(),retained=[],fetches=0,gateCalls=0,persistCalls=0,checkpointCalls=0;
 const events=[],clients=[];
 class Client{
  constructor(){this.pending=null;this.xid=false;this.releasedWith=undefined;}
  // Genuine pg PoolClient inherits connect; presence is not a Pool rejection.
  connect(){assert.fail("A connected client is never reconnected");}
  async query(sql,params){events.push(sql);
   if(sql==="BEGIN"){assert.equal(this.pending,null);this.pending={saved:structuredClone(saved),retained:structuredClone(retained)};return{rows:[],rowCount:1};}
   if(sql==="SELECT txid_current()"){assert(this.pending);this.xid=true;return{rows:[{txid_current:"90001"}],rowCount:1};}
   if(/pg_current_xact_id_if_assigned/.test(sql))return{rows:[{id:this.pending&&this.xid?"90001":null}],rowCount:1};
   if(sql==="ROLLBACK"){this.pending=null;this.xid=false;if(options.failRollbackOnce&&!options.rollbackFailed){options.rollbackFailed=true;throw options.failRollbackOnce;}return{rows:[],rowCount:1};}
   if(sql==="COMMIT"){assert(this.pending);if(options.failCommitOnce&&!options.commitFailed){options.commitFailed=true;throw options.failCommitOnce;}saved=this.pending.saved;retained=this.pending.retained;this.pending=null;this.xid=false;return{rows:[],rowCount:1};}
   assert(this.pending,"Every transactional read/write has an open transaction");
   if(/SELECT cursor FROM/.test(sql)){const cursor=structuredClone(this.pending.saved.cursor);if(options.casMoved)cursor.revision++;return{rows:[{cursor}],rowCount:1};}
   if(/INSERT INTO aldi_category_catalog_state/.test(sql)){if(params.length===3)this.pending.saved={cursor:JSON.parse(params[1]),lastError:null,retryAfter:null,updatedAt:params[2]};else this.pending.saved={...this.pending.saved,lastError:params[2],retryAfter:params[3],updatedAt:params[4]};return{rows:[],rowCount:1};}
   if(/pg_advisory_xact_lock/.test(sql))return{rows:[],rowCount:1};
   assert.fail("Unexpected fake transactional SQL: "+sql);
  }
  release(error){events.push("release");this.releasedWith=error;assert.equal(this.pending,null,"Release follows COMMIT/ROLLBACK");}
 }
 const pool={connect:async()=>{events.push("connect");const tx=new Client();clients.push(tx);return tx;},query:async(sql,params)=>{events.push("pool:"+sql);assert(/INSERT INTO aldi_category_catalog_state/.test(sql),"No unexpected SQL/network admission");saved={...saved,lastError:params[2],retryAfter:params[3],updatedAt:params[4]};return{rows:[],rowCount:1};}};
 const rejectedService={ensure:async()=>events.push("rejected.ensure"),persist:async(tx,capture,{now:at})=>{
  events.push("retained.persist");persistCalls++;assert(tx instanceof Client);assert.equal(typeof tx.connect,"function");assert((await tx.query("SELECT pg_current_xact_id_if_assigned()::text AS id")).rows[0].id);
  const c=Rejected.validateCapture(capture,{now:at});tx.pending.retained.push({captureHash:c.captureHash,hash:c.sourceResponseHash,capturedAt:c.capturedAt});
  if(options.failPersistOnce&&!options.persistFailed){options.persistFailed=true;throw options.failPersistOnce;}
  const result={sourceId:Refresh.SOURCE,storedCaptures:1,unchangedCaptures:0,latestUpdated:1,held:false,captureHash:c.captureHash,capturedAt:c.capturedAt,failureCode:c.failureCode,retainedOnly:true,admissionPerformed:false,articleRowsCreated:0,priceRowsCreated:0,canonicalProductsCreated:0,cursorAdvanced:false,cooldownChanged:false,truthEligible:false};
  return options.retainedPatch?Object.assign(result,options.retainedPatch):result;
 }};
 const deps={load:async()=>saved,ensure:async()=>events.push("refresh.ensure"),sleep:async()=>{now+=1000;events.push("sleep");if(options.onSleep)await options.onSleep(h);},
  canFetch:async()=>{gateCalls++;events.push("gate:"+gateCalls);return options.gate?options.gate(gateCalls,h):true;},
  fetchPage:async(target)=>{events.push("fetch:"+target);fetches++;if(options.fetch) return options.fetch(target,fetches,h);return options.observed??observation();},
  articles:{ensure:async()=>events.push("article.ensure"),persist:async()=>assert.fail("A navigation-only page must not admit native articles")},
  prices:{ensure:async()=>events.push("price.ensure"),persist:async()=>assert.fail("A navigation-only page must not admit prices")},rejected:rejectedService,
  checkpoint:async(tx,next,expected)=>{checkpointCalls++;events.push("checkpoint");if(options.failCheckpointOnce&&!options.checkpointFailed){options.checkpointFailed=true;throw options.failCheckpointOnce;}await Refresh.checkpoint(tx,next,expected);if(options.afterCheckpoint)await options.afterCheckpoint(h,next);}
 };
 const h={pool,deps,events,clients,get saved(){return saved;},get retained(){return retained;},get fetches(){return fetches;},get gateCalls(){return gateCalls;},get checkpointCalls(){return checkpointCalls;},get persistCalls(){return persistCalls;},get now(){return now;},set now(time){now=time;},run:(extra={})=>Refresh.refresh({pool,maxRequests:1,now:()=>now,...extra},deps)};
 return h;
}
function assertNoAuthority(result){for(const key of["received","accepted","identityReceived","identityAccepted","categoryRejected"])assert.equal(result[key],0);assert.equal(result.catalog.fullAssortment,false);assert.equal(result.catalog.childDiscoveryComplete,false);assert.equal(result.scope.country,"DE");assert.equal(result.scope.location,"unknown");for(const key of["body","original","navigation","rejectedCapture","sourceResponseHash","captureHash","gtin","price"])assert(!Object.hasOwn(result,key));assert(!JSON.stringify(result).includes("NEW authored"));}
async function caught(h){try{await h.run();assert.fail("Unsafe or failed navigation must not commit cursor");}catch(error){assert.equal(h.saved.cursor.nextIndex,1);assert.equal(h.saved.cursor.revision,7);assert.deepEqual(h.saved.cursor.targetProofs,initial().cursor.targetProofs);assert.equal(error.pages,0);assert.equal(error.navigationPages,0);assert.equal(h.saved.retryAfter,iso(h.now+3600000));assert(!Object.keys(error).includes("rejectedCapture"));assert(!JSON.stringify(error).includes("NEW authored"));return error;}}
let groups=0;async function test(name,fn){try{await fn();groups++;}catch(error){console.error("Failed: "+name);throw error;}}
async function main(){
 await test("actual navigation validator and retained original commit only discovery cursor after three gates",async()=>{const h=harness(),before=structuredClone(h.saved),observed=observation(),result=await h.run();assertNoAuthority(result);assert.equal(result.pages,1);assert.equal(result.navigationPages,1);assert.equal(result.requests,1);assert.equal(result.bytes,observed.bytes);assert.equal(h.gateCalls,3);assert.equal(h.checkpointCalls,1);assert.equal(h.retained.length,1);assert.equal(h.retained[0].captureHash,Rejected.validateCapture(observed.rejectedCapture,{now:T}).captureHash);assert.equal(h.saved.cursor.revision,8);assert.equal(h.saved.cursor.nextIndex,2);assert.deepEqual(h.saved.cursor.targetProofs.slice(0,1),before.cursor.targetProofs);for(const proof of h.saved.cursor.targetProofs.slice(1)){assert.equal(proof.from,Fixture.parentUrl);assert.equal(proof.sourceResponseHash,observed.original.meta.sourceResponseHash);assert.equal(proof.capturedAt,observed.original.meta.capturedAt);}assert(!h.saved.cursor.targets.includes("https://www.aldi-nord.de/sortiment/vorraete.html"));assert(h.events.indexOf("gate:3")>h.events.indexOf("checkpoint"));assert(h.events.indexOf("COMMIT")>h.events.indexOf("gate:3"));assert.equal(h.clients[0].releasedWith,undefined);});
 await test("persisted category retry prevents even fetching a parent or opening a transaction",async()=>{const saved=initial();saved.retryAfter=iso(T+8*86400000);const h=harness({saved}),before=structuredClone(saved),r=await h.run();assert.equal(r.skipped,"category-not-due");assert.equal(r.nextAttemptAt,saved.retryAfter);assert.equal(h.fetches,0);assert.equal(h.clients.length,0);assert.deepEqual(h.saved,before);});
 await test("initial lifecycle or lease gate prevents every parent transport",async()=>{const h=harness({gate:()=>false}),r=await h.run();assert.equal(r.skipped,"shared-source-not-eligible");assert.equal(h.fetches,0);assert.equal(h.clients.length,0);assert.equal(h.retained.length,0);});
 for(const [name,edit]of[
  ["tampered navigation DTO",o=>o.navigation.categoryProof.sourceResponseHash="f".repeat(64)],
  ["unbound header discovery",o=>o.discoveredTargets.push("https://www.aldi-nord.de/sortiment/vorraete.html")],
  ["wrong category original",o=>o.original.meta.sourceResponseUrl=Fixture.leafUrl],
  ["changed original hash",o=>o.original.meta.sourceResponseHash="f".repeat(64)],
  ["body byte mismatch",o=>{o.bytes++;o.rejectedCapture.bytes++;}],
  ["out of budget bytes",o=>o.bytes=4*1024*1024+1],
  ["unexpected product page",o=>o.page={freshCaptureVerified:true}],
  ["malformed request count",o=>o.requests=2],
  ["missing retained original",o=>delete o.rejectedCapture]
 ])await test("before-TX proof rejects "+name,async()=>{const o=observation();edit(o);const h=harness({observed:o});await caught(h);assert.equal(h.clients.length,0);assert.equal(h.retained.length,0);});
 for(const [name,change]of[
  ["empty positive children",n=>{const entries=JSON.parse(n.props.pageProps.apiData);entries[0][1].res=[];n.props.pageProps.apiData=JSON.stringify(entries);}],
  ["header-only context",n=>n.props.pageProps.apiData="[]"],
  ["unknown parent template",n=>n.props.pageProps.page["mgnl:template"]="unbound"]
 ])await test("genuine original reparse rejects "+name+" without granting blank product success",async()=>{const o=observation(),original=Fixture.parent(change);o.original=original;o.bytes=Buffer.byteLength(original.body);o.rejectedCapture={status:200,failureCode:"aldi-category-native-index-conflict",original,bytes:o.bytes};const h=harness({observed:o});await caught(h);assert.equal(h.clients.length,0);});
 for(const [name,patch]of[
  ["held original",{held:true}], ["wrong stored capture",{captureHash:"f".repeat(64)}], ["wrong source",{sourceId:"other"}], ["non-retained record",{retainedOnly:false}], ["admitted record",{admissionPerformed:true}], ["article creation",{articleRowsCreated:1}], ["price creation",{priceRowsCreated:1}], ["canonical creation",{canonicalProductsCreated:1}], ["cursor authority",{cursorAdvanced:true}], ["cooldown authority",{cooldownChanged:true}], ["truth authority",{truthEligible:true}]
 ])await test("retained result rejects "+name+" and rolls discovery cursor back",async()=>{const h=harness({retainedPatch:patch}),error=await caught(h);assert.equal(error.code,"aldi-category-navigation-original-unconfirmed");assert(h.events.includes("ROLLBACK"));assert.equal(h.checkpointCalls,0);});
 for(const [name,options]of[
  ["private retention bound",{failPersistOnce:Object.assign(Error("synthetic private retention bound"),{code:"aldi-rejected-retention-bound-exceeded"})}],
  ["checkpoint SQL",{failCheckpointOnce:Error("synthetic checkpoint failure")}],
  ["COMMIT deferred failure",{failCommitOnce:Error("synthetic deferred commit failure")}]
 ])await test(name+" cannot credit a navigation page or advance cursor",async()=>{const h=harness(options),expected=options.failPersistOnce??options.failCheckpointOnce??options.failCommitOnce,error=await caught(h);assert.equal(error,expected);assert(h.events.includes("ROLLBACK"));assert.equal(h.clients[0].releasedWith,undefined);});
 await test("actual checkpoint CAS failure preserves original revision and prior proof",async()=>{const h=harness({casMoved:true}),error=await caught(h);assert.equal(error.code,"aldi-category-checkpoint-moved");assert(h.events.some(s=>s.includes("FOR UPDATE")));assert(h.events.includes("ROLLBACK"));});
 await test("broken rollback evicts original connected client without masking primary error",async()=>{const original=Error("synthetic primary persist failure"),broken=Error("synthetic broken rollback"),h=harness({failPersistOnce:original,failRollbackOnce:broken});assert.equal(await caught(h),original);assert.equal(h.clients[0].releasedWith,broken);assert.equal(h.saved.cursor.nextIndex,1);});
 for(const [name,gate]of[
  ["pre-persist lease loss",calls=>calls===2?false:true],
  ["after-checkpoint lease loss",calls=>calls===3?false:true],
  ["after-checkpoint durable host pause",calls=>calls===3?iso(T+8*86400000):true]
 ])await test(name+" rolls original and checkpoint back",async()=>{const h=harness({gate});try{await h.run();assert.fail("Expected late source denial");}catch(error){assert.equal(error.code,"aldi-category-navigation-shared-source-not-eligible");assert.equal(h.saved.cursor.nextIndex,1);assert.equal(h.saved.cursor.revision,7);assert.equal(error.pages,0);assert.equal(error.navigationPages,0);assert.equal(h.saved.retryAfter,name.includes("host pause")?iso(T+8*86400000):iso(T+3600000));assert(h.events.includes("ROLLBACK"));assert.equal(h.checkpointCalls,name.includes("pre-persist")?0:1);}});
 await test("original freshness expires after checkpoint and final reparse rolls back",async()=>{const h=harness({afterCheckpoint:h=>{h.now=Fixture.time+300001;}}),error=await caught(h);assert.match(error.code,/aldi-(?:navigation|rejected)-original-proof-required/);assert.equal(h.checkpointCalls,1);assert.equal(h.retained.length,0);assert(h.events.includes("ROLLBACK"));});
 await test("later blocked turn returns actual committed navigation counter, not zero or missing",async()=>{const h=harness({gate:calls=>calls===4?iso(T+8*86400000):true}),r=await h.run({maxRequests:2});assert.equal(r.pages,1);assert.equal(r.navigationPages,1);assert.equal(r.requests,1);assert.equal(h.fetches,1);assert.equal(h.saved.cursor.nextIndex,2);assert.equal(h.saved.cursor.revision,8);assert.equal(h.retained.length,1);assert.equal(r.nextAttemptAt,iso(T+8*86400000));assert.equal(h.events.filter(s=>s==="COMMIT").length,1);});
 await test("two genuine synthetic navigation originals commit separately with exact cumulative counters",async()=>{const h=harness({fetch:(target,n,h)=>observation(n===1?Fixture.parent():nestedOriginal(target,h.now),h.now)}),r=await h.run({maxRequests:2});assertNoAuthority(r);assert.equal(r.pages,2);assert.equal(r.navigationPages,2);assert.equal(r.requests,2);assert.equal(h.retained.length,2);assert.equal(h.saved.cursor.revision,9);assert.equal(h.saved.cursor.nextIndex,3);assert.equal(h.events.filter(s=>s==="COMMIT").length,2);assert.equal(h.gateCalls,6);assert.equal(new Set(h.retained.map(v=>v.captureHash)).size,2);});
 await test("second invalid original preserves only first committed navigation and prior proof",async()=>{const h=harness({fetch:(target,n,h)=>{const o=observation(n===1?Fixture.parent():nestedOriginal(target,h.now),h.now);if(n===2)o.bytes++;return o;}});try{await h.run({maxRequests:2});assert.fail("Bad second response must fail");}catch(error){assert.equal(error.code,"aldi-category-navigation-result-unconfirmed");assert.equal(error.pages,1);assert.equal(error.navigationPages,1);assert.equal(error.requests,2);assert.equal(h.saved.cursor.nextIndex,2);assert.equal(h.saved.cursor.revision,8);assert.equal(h.retained.length,1);assert.equal(h.clients.length,1);assert.equal(h.events.filter(s=>s==="COMMIT").length,1);}});
 console.log("aldi-category-navigation-refresh: "+groups+" actual refresh/navigation/rejected-original/CAS/atomicity/final-gate/rollback/partial-counter groups passed; synthetic originals and staged SQL fakes only, no HTTP or SQL");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
