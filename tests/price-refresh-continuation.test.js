"use strict";
const assert=require("assert/strict"),Runner=require("../price-refresh-runner"),Refresh=require("../price-source-refresh"),State=require("../source-refresh-state"),Store=require("../price-refresh-state-store"),Status=require("../price-source-status"),Sources=require("../price-sources").SOURCES;
const SOURCE="Wolt EDEKA Berlin",NOW=Date.parse("2026-10-01T12:00:00Z"),iso=time=>new Date(time).toISOString();

async function main(){
 const source=Sources[SOURCE];assert(source.active);assert.equal(Refresh.interval(source),900000);
 let calls=0;
 const handler=async()=>({received:400,accepted:368,nextAttemptAt:iso(NOW+60000),catalog:{publishedAssortmentComplete:false}});
 const first=await Runner.runOne(SOURCE,{}, {[SOURCE]:async(...args)=>{calls++;return handler(...args)}},{nowMs:NOW});
 assert.equal(first.ok,true);assert.equal(first.state.lastSuccessAt,iso(NOW));assert.equal(first.state.nextAttemptAt,iso(NOW+60000));
 assert.equal(Refresh.due(source,first.state,NOW+59999),false);
 assert.equal(Refresh.due(source,first.state,NOW+60000),true,"Confirmed unfinished scans continue without the normal 15 minute pause");
 const early=await Runner.runOne(SOURCE,first.state,{[SOURCE]:handler},{nowMs:NOW+59999});assert.equal(early.skipped,"not-due");
 const completed=await Runner.runOne(SOURCE,first.state,{[SOURCE]:async()=>{calls++;return{received:25,accepted:24,nextAttemptAt:null,catalog:{publishedAssortmentComplete:true}}}},{nowMs:NOW+60000});
 assert.equal(calls,2);assert.equal(completed.state.nextAttemptAt,null);assert.equal(Refresh.due(source,completed.state,NOW+60000+899999),false);assert.equal(Refresh.due(source,completed.state,NOW+60000+900000),true,"Completed scans return to the normal source cadence");

 const before={...first.state,lastError:"wolt-source-http-429",consecutiveFailures:2},retryAfter=iso(NOW+7200000);
 const skipped=await Runner.runOne(SOURCE,before,{[SOURCE]:async()=>({skipped:"source-cooldown",received:0,accepted:0,retryAfter})},{nowMs:NOW+60000});
 assert.equal(skipped.ok,false);assert.equal(skipped.skipped,"source-cooldown");
 for(const field of["lastSuccessAt","lastAttemptAt","lastReceived","lastAccepted","lastDurationMs","lastError","consecutiveFailures"])assert.equal(skipped.state[field],before[field],"Skipping cannot fabricate freshness or replace a real source result: "+field);
 assert.equal(skipped.state.nextAttemptAt,retryAfter);assert.equal(Refresh.due(source,skipped.state,NOW+7199999),false);assert.equal(Refresh.due(source,skipped.state,NOW+7200000),true);
 const error=Object.assign(Error("wolt-source-http-429"),{nextAttemptAt:retryAfter});
 const failed=await Runner.runOne(SOURCE,first.state,{[SOURCE]:async()=>{throw error}},{nowMs:NOW+60000});
 assert.equal(failed.ok,false);assert.equal(failed.state.lastSuccessAt,first.state.lastSuccessAt);assert.equal(failed.state.nextAttemptAt,retryAfter);assert.equal(failed.state.consecutiveFailures,1);
 let attempts=0;const notReady=await Runner.runDue({[SOURCE]:failed.state},{[SOURCE]:async()=>{attempts++;return{}}},{nowMs:NOW+3600000});assert(!notReady.results.some(x=>x.name===SOURCE));assert.equal(attempts,0,"The generic scheduler respects a persisted source cooldown");
 const stillRunning=await Runner.runOne(SOURCE,first.state,{[SOURCE]:async()=>({skipped:"already-running"})},{nowMs:NOW+60000});assert.deepEqual(stillRunning.state,first.state);

 for(const value of[null,0,1,"invalid",iso(NOW),iso(NOW-1)]){assert.equal(State.success(first.state,{nextAttemptAt:value},iso(NOW)).nextAttemptAt,null);}
 assert.equal(Refresh.due(source,{lastSuccessAt:iso(NOW),nextAttemptAt:"invalid"},NOW+60000),false);
 assert.equal(Refresh.due({...source,active:false},{nextAttemptAt:iso(NOW)},NOW+900000),false);
 const status=Status.view({[SOURCE]:skipped.state},NOW+3600000).find(x=>x.name===SOURCE);assert.equal(status.nextAttemptAt,retryAfter);assert.equal(status.lastSuccessAt,iso(NOW));assert.equal(status.lastAccepted,368);assert.equal(status.freshness,"stale","A cooldown cannot claim that old quotes were fetched just now");

 let record=null,lease=false,saveSql,saveValues;
 const pool={query:async(sql,values=[])=>{
  if(sql.startsWith("CREATE TABLE")){assert(sql.includes("ADD COLUMN IF NOT EXISTS next_attempt_at"),"Existing state tables must migrate idempotently");return{rows:[],rowCount:0};}
  if(sql.startsWith("INSERT INTO price_source_refresh_state")){if(lease)return{rows:[],rowCount:0};lease=true;return{rows:[{source_name:values[0]}],rowCount:1};}
  if(sql.startsWith("UPDATE price_source_refresh_state SET last_attempt")){saveSql=sql;saveValues=values;record={sourceName:values[0],lastAttemptAt:values[1],lastSuccessAt:values[2],lastError:values[3],consecutiveFailures:values[4],lastReceived:values[5],lastAccepted:values[6],lastDurationMs:values[7],nextAttemptAt:values[9]};lease=false;return{rows:[],rowCount:1};}
  if(sql.startsWith("SELECT source_name")){assert(sql.includes('next_attempt_at AS "nextAttemptAt"'));return{rows:record?[record]:[],rowCount:record?1:0};}
  throw Error("Unexpected state-store query "+sql);
 }};
 assert(await Store.acquire(pool,SOURCE,"TEST-worker"));assert(await Store.save(pool,SOURCE,skipped.state,"TEST-worker"));assert(saveSql.includes("next_attempt_at=$10"));assert.equal(saveValues[8],"TEST-worker");
 const restarted=(await Store.loadAll(pool))[SOURCE];assert.equal(restarted.nextAttemptAt,retryAfter);assert.equal(restarted.lastSuccessAt,iso(NOW));assert.equal(Refresh.due(source,restarted,NOW+3600000),false);assert.equal(Refresh.due(source,restarted,NOW+7200000),true);
 console.log("price-refresh-continuation: bounded scan continuation, restored regular cadence, durable restart/cooldown scheduling and no fabricated freshness on skipped calls OK");
}
main().catch(error=>{console.error(error);process.exitCode=1});
