"use strict";
const assert=require("node:assert/strict"),Source=require("../aldi-source-refresh"),Category=require("../aldi-category-refresh"),PDPClient=require("../aldi-assortment-client");
// These clocks and persistence states are explicitly SYNTHETIC routing fixtures.
// Actual Source.refresh/Category.state are used; no original bodies, products,
// prices, network transports, SQL calls or capture admission are fabricated.
const T=Date.parse("2026-10-03T07:53:00.700Z"),OWNER="UNIT TEST failed-category fairness",iso=at=>new Date(at).toISOString();
const pool={query:async()=>assert.fail("Routing fixtures must not perform SQL")};
function harness(patch={}){
 let time=T,pdpCalls=0,categoryCalls=0,nativeCalls=0;
 const pdp={updatedAt:"2026-10-03T05:46:00.700Z",...patch.pdp};
 const category={cursor:Category.state(),lastError:"aldi-category-native-result-array-required",updatedAt:"2026-10-03T06:53:00.700Z",retryAfter:iso(T),...patch.category};
 const source={leaseOwner:OWNER,leaseUntil:iso(T+12*3600000),consecutiveFailures:0,...patch.source};
 const deps={
  pdp:{load:async()=>pdp,resumeAt:async()=>patch.pdpDue??iso(time-60000),refresh:async(options,child)=>{pdpCalls++;assert.equal(typeof child.discoverTargets,"function");assert.equal(typeof child.fetchProducts,"function");if(patch.pdpHook)await patch.pdpHook({options,child,pdp,category,source,now:()=>time,forbiddenFetch:async()=>{nativeCalls++;assert.fail("No native GET is allowed by this offline routing fixture");}});pdp.updatedAt=iso(time);return{received:0,accepted:0,requests:0};}},
  category:{load:async()=>category,state:Category.state,dueAt:Category.dueAt,refresh:async(options,child)=>{categoryCalls++;assert.equal(await child.canFetch(),true);assert.equal(options.pool,pool);assert.equal(options.maxRequests,Category.MAX_REQUESTS);if(patch.categoryHook)await patch.categoryHook({options,child,pdp,category,source});return{received:0,accepted:0,requests:0};}},
  store:{loadAll:async()=>({[Source.SOURCE]:source})},
  ...(patch.shouldContinue?{shouldContinue:patch.shouldContinue}:{})
 };
 return{pdp,category,source,deps,get now(){return time;},set now(value){time=value;},get pdpCalls(){return pdpCalls;},get categoryCalls(){return categoryCalls;},get nativeCalls(){return nativeCalls;},run:()=>Source.refresh({pool,leaseOwner:OWNER,maxRequests:16,now:()=>time},deps),schedule:()=>Source.schedule(pool,time,deps)};
}
let groups=0;
async function test(name,fn){try{await fn();groups++;}catch(error){console.error("Failed: "+name);throw error;}}
async function main(){
 await test("past failed parent turn selects due PDP without changing unsuccessful category cursor",async()=>{const h=harness(),before=structuredClone(h.category),result=await h.run();assert.equal(result.captureMode,"product-detail-original");assert.equal(h.pdpCalls,1);assert.equal(h.categoryCalls,0);assert.deepEqual(h.category,before);assert.equal(Category.state(h.category).lastRunAt,null);assert.equal(Category.state(h.category).nextIndex,0);assert.equal(result.received,0);assert.equal(result.accepted,0);assert.equal(result.requests,0);assert.equal(result.sharedSourceLease,true);assert.equal(result.nextAttemptAt,iso(T+Category.CONTINUATION_MS));assert.equal(h.nativeCalls,0);});
 await test("successful PDP then next continuation restores category turn without erasing failed original state",async()=>{const h=harness(),before=structuredClone(h.category);assert.equal((await h.run()).captureMode,"product-detail-original");h.now=T+Category.CONTINUATION_MS;assert.equal((await h.run()).captureMode,"category-original");assert.equal(h.pdpCalls,1);assert.equal(h.categoryCalls,1);assert.deepEqual(h.category,before);assert.equal(h.nativeCalls,0);});
 await test("actual pg Date value is accepted as the genuine failed-attempt field",async()=>{const h=harness({category:{updatedAt:new Date("2026-10-03T06:53:00.700Z")}});assert.equal((await h.run()).captureMode,"product-detail-original");assert(h.category.updatedAt instanceof Date);assert.equal(h.categoryCalls,0);});
 await test("failed attempt also sets minimum continuation before another due route",async()=>{const h=harness({category:{updatedAt:iso(T-30000),retryAfter:null}}),s=await h.schedule();assert.equal(s.due,T+30000);const before=structuredClone(h.category),r=await h.run();assert.equal(r.skipped,"source-not-due");assert.equal(r.nextAttemptAt,iso(T+30000));assert.equal(h.pdpCalls+h.categoryCalls,0);assert.deepEqual(h.category,before);});
 await test("older failed update cannot replace later successful category turn",async()=>{const cursor={...Category.state(),lastRunAt:iso(T-30000)},h=harness({pdp:{updatedAt:iso(T-60000)},category:{cursor,updatedAt:iso(T-90000),retryAfter:null}});assert.equal((await h.schedule()).due,T+30000);assert.equal((await h.run()).skipped,"source-not-due");h.now=T+30000;assert.equal((await h.run()).captureMode,"product-detail-original");assert.equal(h.categoryCalls,0);assert.deepEqual(h.category.cursor,cursor);});
 await test("category remains selected if PDP is not yet due, despite a more recent failed parent attempt",async()=>{const h=harness({pdpDue:iso(T+3600000)});assert.equal((await h.run()).captureMode,"category-original");assert.equal(h.categoryCalls,1);assert.equal(h.pdpCalls,0);});
 await test("unknown/null error uses only the successful cursor, never raw updatedAt as a new turn",async()=>{for(const lastError of[null,undefined]){const h=harness({category:{lastError,updatedAt:iso(T+3600000)}});assert.equal((await h.run()).captureMode,"category-original");assert.equal(h.pdpCalls,0);assert.equal(h.categoryCalls,1);}});
 for(const [name,patch,until]of[
  ["category row retry",{category:{retryAfter:iso(T+3600000)}},T+3600000],
  ["category cursor retry",{category:{cursor:{...Category.state(),retryAfter:iso(T+2*3600000)}}},T+2*3600000],
  ["PDP row retry",{pdp:{retryAfter:iso(T+3*3600000)}},T+3*3600000],
  ["global native backoff",{source:{consecutiveFailures:14,lastAttemptAt:iso(T-3600000),nextAttemptAt:iso(T+60000)}},T+5*3600000],
  ["global later next-attempt",{source:{consecutiveFailures:1,lastAttemptAt:iso(T-3600000),nextAttemptAt:iso(T+8*86400000)}},T+8*86400000]
 ])await test(name+" blocks the newly fair PDP turn without state reset",async()=>{const h=harness(patch),before=structuredClone({pdp:h.pdp,category:h.category,source:h.source}),r=await h.run();assert.equal(r.skipped,"shared-source-not-eligible");assert.equal(r.nextAttemptAt,iso(until));assert.equal(h.pdpCalls+h.categoryCalls,0);assert.deepEqual({pdp:h.pdp,category:h.category,source:h.source},before);});
 for(const source of[{leaseOwner:"other instance"},{leaseUntil:iso(T-1)},{leaseUntil:null}])await test("actual shared source lease rejects "+JSON.stringify(source),async()=>{const h=harness({source}),r=await h.run();assert.equal(r.skipped,"shared-source-not-eligible");assert.equal(h.pdpCalls+h.categoryCalls,0);assert.equal(h.nativeCalls,0);});
 await test("shutdown rejects fair route before calling either collector",async()=>{const h=harness({shouldContinue:()=>false});assert.equal((await h.run()).skipped,"shared-source-not-eligible");assert.equal(h.pdpCalls+h.categoryCalls,0);});
 for(const [name,patch]of[
  ["missing failed update",{updatedAt:undefined}], ["null failed update",{updatedAt:null}], ["malformed failed update",{updatedAt:"not-a-date"}], ["invalid pg Date",{updatedAt:new Date(NaN)}],
  ["future failed update",{updatedAt:iso(T+1)}], ["pre-epoch failed update",{updatedAt:iso(-1)}], ["noncanonical date-only update",{updatedAt:"2026-10-03"}],
  ["boolean update",{updatedAt:true}], ["numeric update",{updatedAt:1}], ["array update",{updatedAt:[]}], ["coercible object update",{updatedAt:{valueOf:()=>T-1}}],
  ["blank error",{lastError:""}], ["whitespace error",{lastError:" \n "}], ["overlong error",{lastError:"e".repeat(301)}], ["non-string error",{lastError:17}], ["object error",{lastError:{code:"synthetic"}}]
 ])await test("closed failed-attempt field rejects "+name,async()=>{const h=harness({category:patch});await assert.rejects(h.run(),/aldi-shared-source-state-invalid/);assert.equal(h.pdpCalls+h.categoryCalls,0);assert.equal(h.nativeCalls,0);});
 for(const [name,change]of[
  ["lease loss",h=>{h.source.leaseOwner="lost instance";}],
  ["new category retry",h=>{h.category.retryAfter=iso(T+8*86400000);}],
  ["new PDP retry",h=>{h.pdp.retryAfter=iso(T+8*86400000);}],
  ["new global refusal",h=>{Object.assign(h.source,{consecutiveFailures:1,lastAttemptAt:iso(T),nextAttemptAt:iso(T+8*86400000)});}]
 ])await test("actual per-GET PDP gate still refuses "+name+" after routing",async()=>{const h=harness({pdpHook:async h=>{change(h);await assert.rejects(h.child.discoverTargets({fetchImpl:h.forbiddenFetch,now:()=>iso(h.now())}),/aldi-shared-source-not-eligible/);}}),r=await h.run();assert.equal(r.captureMode,"product-detail-original");assert.equal(h.pdpCalls,1);assert.equal(h.categoryCalls,0);assert.equal(h.nativeCalls,0);});
 await test("after a rejected state the singleton guard clears and a genuine due state still runs",async()=>{const bad=harness({category:{updatedAt:"bad"}});await assert.rejects(bad.run(),/aldi-shared-source-state-invalid/);const good=harness();assert.equal((await good.run()).captureMode,"product-detail-original");assert.equal(good.pdpCalls,1);});
 assert.equal(typeof PDPClient.discoverTargets,"function");
 console.log("aldi-source-failure-fairness: "+groups+" actual source routing/closed failed-clock/continuation/hold/lease/lifecycle/per-GET groups passed; synthetic states only, no HTTP or SQL");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
