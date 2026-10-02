"use strict";
const assert=require('node:assert/strict'),Pub=require('../lidl-price-publications'),Refresh=require('../lidl-publication-refresh');
const {fixture}=require('./helpers/lidl-capture-fixture');
const now=Date.parse('2026-10-02T18:00:00Z');let groups=0;
function pool(initial={}){let state={...initial},captures=0;return{get state(){return state;},get captures(){return captures;},query:async(sql,args=[])=>{
 if(sql.startsWith('CREATE'))return{rows:[],rowCount:0};
 if(sql.startsWith('SELECT'))return{rows:Object.keys(state).length?[state]:[],rowCount:0};
 if(sql.includes('INSERT INTO '+Pub.TABLE)){captures++;return{rows:[],rowCount:1};}
 if(sql.includes('INSERT INTO '+Refresh.TABLE)){
  state=sql.includes('last_completed_at,last_error')?{lastCompletedAt:args[1],nextAttemptAt:args[2],proofHash:args[3],completedCaptures:(state.completedCaptures||0)+1,lastError:null}:{...state,lastError:args[1],nextAttemptAt:args[2]};return{rows:[],rowCount:1};
 }throw Error('Unexpected SQL');
}};}
const response=(status,body,headers={})=>new Response(body,{status,headers:{date:new Date(now).toUTCString(),'content-type':'text/html',...headers}});
(async()=>{
 let calls=0;const raw=fixture(now);
 const captured=await Refresh.capture({now:()=>now,fetchImpl:async(url,options)=>{calls++;assert.equal(url,Pub.PAGE_URL);assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.equal(options.method,'GET');return response(200,raw.body);}});
 assert.equal(calls,1);assert.equal(Pub.parseCapture(captured,{now}).accepted,20);groups++;
 await assert.rejects(Refresh.get('https://unternehmen.lidl.de/unreviewed',{fetchImpl:async()=>assert.fail('No fetch')}),/unreviewed-source-url/);groups++;
 const p=pool();const saved=await Refresh.refresh({pool:p,now:()=>now},{capture:async()=>raw});assert.equal(saved.accepted,20);assert.equal(saved.requests,1);assert.equal(p.captures,1);assert.equal(p.state.nextAttemptAt,new Date(now+86400000).toISOString());assert.equal(saved.currentPhysicalPriceImports,0);groups++;
 await Refresh.refresh({pool:p,now:()=>now+1},{capture:async()=>assert.fail('Persisted cooldown must prevent request')});assert.equal(p.captures,1);assert.equal(await Refresh.resumeAt(p),new Date(now+86400000).toISOString());groups++;
 for(const status of [403,429]){const blocked=pool();let attempts=0;await assert.rejects(Refresh.refresh({pool:blocked,now:()=>now},{fetchImpl:async()=>{attempts++;return response(status,'',{ 'retry-after':'7200'});}}),new RegExp('lidl-source-http-'+status));assert.equal(attempts,1);assert.equal(blocked.state.nextAttemptAt,new Date(now+7200000).toISOString());assert.equal(blocked.captures,0);await Refresh.refresh({pool:blocked,now:()=>now+1},{fetchImpl:async()=>assert.fail('No blocked retry')});groups++;}
 for(const retryAfter of ['99999999999999999999','-1','invalid']){const blocked=pool();await assert.rejects(Refresh.refresh({pool:blocked,now:()=>now},{fetchImpl:async()=>response(429,'',{'retry-after':retryAfter})}),/lidl-source-http-429/);assert.equal(blocked.state.nextAttemptAt,new Date(now+3600000).toISOString());}groups++;
 for(const res of [response(302,''),response(200,'x',{'content-length':'1500001'}),response(200,new Uint8Array([0xc3,0x28]))])await assert.rejects(Refresh.get(Pub.PAGE_URL,{now:()=>now,fetchImpl:async()=>res}));groups++;
 const failed=pool();await assert.rejects(Refresh.refresh({pool:failed,now:()=>now},{capture:async()=>{throw Object.assign(Error('transport-failed'),{code:'transport-failed'});}}),/transport-failed/);assert.equal(failed.state.nextAttemptAt,new Date(now+3600000).toISOString());assert.equal(failed.state.lastError,'transport-failed');groups++;
 let release;const gate=new Promise(resolve=>release=resolve),parallel=pool();const first=Refresh.refresh({pool:parallel,now:()=>now},{capture:async()=>{await gate;return raw;}});await Promise.resolve();assert.equal((await Refresh.refresh({pool:parallel,now:()=>now})).skipped,'already-running');release();await first;groups++;
 console.log('lidl-publication-refresh: '+groups+' one-GET bounds, persistence, daily cadence, 403/429, cooldown and concurrency groups OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
