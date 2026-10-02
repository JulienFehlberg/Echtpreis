"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),{EventEmitter}=require("node:events"),{createRequire}=require("node:module");
const Lifecycle=require("../server-lifecycle"),Runner=require("../price-refresh-runner"),Sources=require("../price-sources").SOURCES;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const HIT="HIT Berlin store assortment",OTHER="Wolt EDEKA Berlin",NOW=Date.parse("2026-10-02T02:30:00Z"),iso=value=>new Date(value).toISOString();
function states(){const value=Object.fromEntries(Object.keys(Sources).map(name=>[name,{nextAttemptAt:iso(NOW+86400000)}]));value[HIT]={};value[OTHER]={};return value;}
function timers(){let callback,cleared=0;return{setTimer(fn){callback=fn;return 1;},clearTimer(){cleared++;},expire(){callback();},get cleared(){return cleared;}};}

// Execute the actual server wiring with local dependency doubles. No socket,
// database or retailer connection is opened by this fixture.
function serverFixture({asMain=false,catalog=false,inventory=false,initGate=null,requestGate=null,catalogGate=null,httpDbGate=null,inventoryGate=null}={}){
 const root=path.resolve("server.js"),nativeRequire=createRequire(root),queries=[],events=[],exitCodes=[],logs=[],signalProcess=new EventEmitter();
 let listener,interval=null,catalogCalls=0,needCalls=0,inventoryCalls=0,inventoryFetches=0,ended=0,initialQuery=true;
 const db={query:async(sql,values)=>{queries.push({sql,values});if(initialQuery&&initGate){initialQuery=false;await initGate.promise;}if(httpDbGate&&sql.startsWith("UPDATE receipt_submissions SET is_private")){await httpDbGate.promise;throw Error("LOCAL TEST failed asynchronous write");}return{rows:[],rowCount:0};},end:async()=>{ended++;events.push("pool-end");}};
 const fakeServer={listening:false,listen(_port,cb){this.listening=true;events.push("listen");cb?.();},close(cb){this.listening=false;events.push("http-close");cb?.();}};
 signalProcess.env={DATABASE_URL:"postgres://local.test/LOCAL_TEST",PRICE_INVENTORY_ENABLED:inventory?"true":"false",PRODUCT_CATALOG_ENABLED:catalog?"true":"false",SPARKORB_ADMIN_TOKEN:"LOCAL_TEST"};signalProcess.pid=123;signalProcess.exit=code=>exitCodes.push(code);
 const mocks={
  http:{createServer(fn){listener=fn;return fakeServer;}},pg:{Pool:function(){return db;}},
  "./server-lifecycle":{...Lifecycle,installSignals:(lifecycle,options)=>Lifecycle.installSignals(lifecycle,{...options,target:signalProcess})},
  "./price-admin-auth":{...nativeRequire("./price-admin-auth"),authorized:req=>nativeRequire("./price-admin-auth").authorized(req,signalProcess.env)},
  "./published-product-discovery":{searchNeed:async()=>{needCalls++;if(requestGate)await requestGate.promise;events.push("request-finished");return{ok:true,items:[]};}},
  "./product-catalog-service":{ensure:async()=>{},refresh:async(_pool,_input,deps)=>{assert.equal(deps.shouldContinue(),true);catalogCalls++;if(catalogGate)await catalogGate.promise;events.push("catalog-finished");return{skipped:"LOCAL_TEST-catalog"};}},
  "./price-inventory-service":{ensure:async()=>{},refresh:async(_pool,input,deps)=>{inventoryCalls++;assert.equal(typeof deps.shouldContinue,"function");if(!deps.shouldContinue())return{skipped:"server-stopping"};if(inventoryGate)await inventoryGate.promise;if(!deps.shouldContinue())return{skipped:"server-stopping"};inventoryFetches++;return{skipped:"LOCAL_TEST-inventory"};}},
  "./legacy-rewe-provenance":{repair:async()=>({moved:0})},
  "./price-refresh-targets":{fromDatabase:async()=>[]},"./external-location-targets":{fromDatabase:async()=>[]},"./canonical-gap-refresh-targets":{build:async()=>[]},
  "./price-refresh-state-store":{loadAll:async()=>({})},"./price-refresh-runner":{runDue:async()=>({results:[]})}
 };
 for(const[file,source]of[["./lidl-publication-refresh","Lidl DE dated price announcements"],["./penny-berlin-publication-refresh","PENNY Berlin regional price publications"],["./hit-price-refresh",HIT],["./aldi-assortment-refresh","ALDI Nord published assortment"],["./rewe-retailer-price-refresh","REWE Berlin pickup"]])mocks[file]={SOURCE:source,resumeAt:async()=>null,refresh:async()=>{throw Error("No source request allowed");}};
 mocks["./wolt-retailer-price-refresh"]={SOURCE:OTHER,resumeAt:async()=>null,createRefresh:()=>({SOURCE:"Wolt nahkauf Berlin Wrangelstraße",resumeAt:async()=>null})};
 const module={exports:{}},require=file=>Object.hasOwn(mocks,file)?mocks[file]:nativeRequire(file);require.main=asMain?module:undefined;
 const sandbox={require,module,exports:module.exports,process:signalProcess,console:{log(...args){logs.push(args);},error(...args){logs.push(args);}},Buffer,URL,Date,Promise,setTimeout,clearTimeout,setInterval(fn,ms){assert.equal(ms,60000);interval={fn,cleared:false,unref(){}};events.push("timer-start");return interval;},clearInterval(timer){assert.equal(timer,interval);timer.cleared=true;events.push("timer-stop");}};
 vm.runInNewContext(fs.readFileSync(root,"utf8"),sandbox,{filename:root});
 function request(raw='{"search":"Milch","constraints":{"family":"milk"}}',url="/v1/shopping-need"){
  const req=new EventEmitter();req.method="POST";req.url=url;req.headers={authorization:"Bearer LOCAL_TEST"};
  const res=new EventEmitter();res.headersSent=false;res.writableEnded=false;res.setHeader=()=>{};res.writeHead=(status)=>{res.status=status;res.headersSent=true;};res.end=text=>{res.text=text;res.writableEnded=true;res.emit("finish");};
  listener(req,res);return{req,res,send(){req.emit("data",Buffer.from(raw));req.emit("end");}};
 }
 return{api:module.exports,events,queries,process:signalProcess,exitCodes,logs,request,get interval(){return interval;},get catalogCalls(){return catalogCalls;},get needCalls(){return needCalls;},get inventoryCalls(){return inventoryCalls;},get inventoryFetches(){return inventoryFetches;},get ended(){return ended;}};
}

async function main(){
 // A signal before a queued background callback runs prevents new work, while
 // an HTTP request already admitted may finish its callback and database work.
 {
  const clock=timers(),events=[],request=deferred(),http=deferred();let queued=0;
  const lifecycle=Lifecycle.create({...clock,stopScheduling:()=>events.push("stop"),closeServer:()=>{events.push("http-close");return http.promise;},closePool:()=>events.push("pool-end")});
  const job=lifecycle.runJob(()=>queued++),admitted=lifecycle.runRequest(async()=>{await request.promise;events.push("request-end");});
  const ending=lifecycle.shutdown();assert.equal(lifecycle.shutdown(),ending);await tick();assert.equal(queued,0);assert.equal((await job).skipped,"server-stopping");
  assert.equal((await lifecycle.runJob(()=>assert.fail("new job"))).skipped,"server-stopping");assert.equal((await lifecycle.runRequest(()=>assert.fail("new HTTP"))).skipped,"server-stopping");
  request.resolve();await admitted;await tick();assert(!events.includes("pool-end"),"HTTP close must also finish before the pool is closed");http.resolve();assert.deepEqual(await ending,{ok:true,timedOut:false});
  assert.deepEqual(events,["stop","http-close","request-end","pool-end"]);assert.equal(clock.cleared,1);
 }
 // Drain the acquired native handler through checkpoint, scheduler persist and
 // its own release. Do not acquire the next due source during shutdown.
 {
  const clock=timers(),events=[],handler=deferred(),persist=deferred(),release=deferred(),initial=states();
  const lifecycle=Lifecycle.create({...clock,closePool:()=>events.push("pool-end")});
  const run=lifecycle.runJob(()=>Runner.runDue(initial,{[HIT]:async()=>{events.push("handler");await handler.promise;events.push("checkpoint");return{received:31,accepted:30,nextAttemptAt:iso(NOW+60000)};},[OTHER]:async()=>assert.fail("No next handler")},{nowMs:NOW,shouldContinue:()=>!lifecycle.isStopping(),acquire:async name=>{events.push("acquire:"+name);return true;},persist:async(name,value)=>{assert.equal(name,HIT);assert.equal(value.lastAccepted,30);assert.equal(value.nextAttemptAt,iso(NOW+60000));events.push("persist");await persist.promise;},release:async name=>{events.push("release:"+name);await release.promise;}}));
  await tick();assert(events.includes("handler"));const ending=lifecycle.shutdown();handler.resolve();await tick();assert(events.includes("persist"));assert(!events.some(value=>value.startsWith("release:")));assert(!events.includes("pool-end"));
  persist.resolve();await tick();assert(events.includes("release:"+HIT));assert(!events.includes("pool-end"));release.resolve();const result=await run;assert.equal(result.results.length,1);assert.equal(result.results[0].ok,true);assert((await ending).ok);assert.equal(events.filter(value=>value.startsWith("acquire:")).length,1);assert.equal(events.at(-1),"pool-end");
 }
 // A signal arriving during a successful acquire releases only that acquire;
 // a rejected acquire or pre-existing foreign lease is never released.
 for(const acquired of[true,false]){
  const clock=timers(),gate=deferred(),events=[],initial=states(),before=structuredClone(initial),lifecycle=Lifecycle.create({...clock});
  const run=lifecycle.runJob(()=>Runner.runDue(initial,{[HIT]:async()=>assert.fail("stopping handler")},{nowMs:NOW,shouldContinue:()=>!lifecycle.isStopping(),acquire:async name=>{events.push("acquire:"+name);return gate.promise;},persist:async()=>assert.fail("stopping save"),release:async name=>events.push("release:"+name)}));
  await tick();const ending=lifecycle.shutdown();gate.resolve(acquired);const result=await run;assert((await ending).ok);assert.deepEqual(initial,before);assert.equal(result.results[0].skipped,acquired?"server-stopping":"lease-held");assert.deepEqual(events,acquired?["acquire:"+HIT,"release:"+HIT]:["acquire:"+HIT]);
 }
 // A source's real 429 result still persists its full cooldown during shutdown.
 {
  const clock=timers(),handler=deferred(),pause=iso(NOW+7200000),initial=states();let saved,released=0;
  const lifecycle=Lifecycle.create({...clock});const run=lifecycle.runJob(()=>Runner.runDue(initial,{[HIT]:async()=>{await handler.promise;throw Object.assign(Error("hit-source-http-429"),{nextAttemptAt:pause});}},{nowMs:NOW,shouldContinue:()=>!lifecycle.isStopping(),acquire:async()=>true,persist:async(_name,value)=>{saved=value;},release:async()=>{released++;}}));
  await tick();const ending=lifecycle.shutdown();handler.resolve();await run;assert((await ending).ok);assert.equal(saved.nextAttemptAt,pause);assert.equal(saved.lastError,"hit-source-http-429");assert.equal(saved.consecutiveFailures,1);assert.equal(released,1);
 }
 // On the bounded deadline an unfinished owner retains its lease. No pool end
 // or synthetic release happens until the actual work is finished.
 {
  const clock=timers(),gate=deferred(),events=[],lifecycle=Lifecycle.create({...clock,closePool:()=>events.push("pool-end")});
  const job=lifecycle.runJob(async()=>{await gate.promise;events.push("owner-release");});await tick();const ending=lifecycle.shutdown();clock.expire();const result=await ending;
  assert.equal(result.ok,false);assert.equal(result.timedOut,true);assert.equal(result.activeJobs,1);assert.deepEqual(events,[]);assert.equal(lifecycle.isStopping(),true);
  gate.resolve();await job;await tick();assert.deepEqual(events,["owner-release","pool-end"]);
 }
 // Repeated termination signals never bypass the drain or exit twice.
 {
  const clock=timers(),gate=deferred(),target=new EventEmitter(),outcomes=[],lifecycle=Lifecycle.create({...clock});const detach=Lifecycle.installSignals(lifecycle,{target,onComplete:value=>outcomes.push(value)});
  const job=lifecycle.runJob(()=>gate.promise);await tick();target.emit("SIGTERM");target.emit("SIGINT");target.emit("SIGTERM");await tick();assert.equal(outcomes.length,0);gate.resolve();await job;await tick();assert.equal(outcomes.length,1);assert.equal(outcomes[0].ok,true);detach();assert.equal(target.listenerCount("SIGTERM"),0);assert.equal(target.listenerCount("SIGINT"),0);
 }
 for(const timeoutMs of[0,-1,30001,NaN,Infinity,"25000"])assert.throws(()=>Lifecycle.create({timeoutMs}),/invalid-shutdown-budget/);
 // Actual HTTP wiring retains asynchronous POST work even after client abort.
 {
  const gate=deferred(),fixture=serverFixture({requestGate:gate}),pending=fixture.request();await tick();pending.send();await tick();assert.equal(fixture.needCalls,1);
  pending.req.emit("aborted");let complete=false;const ending=fixture.api.shutdown().then(value=>{complete=true;return value;});await tick();assert.equal(complete,false);assert.equal(fixture.ended,0);
  const denied=fixture.request();assert.equal(denied.res.status,503);assert.equal(fixture.needCalls,1);gate.resolve();assert((await ending).ok);assert.equal(pending.res.status,200);assert.equal(fixture.ended,1);assert.equal(fixture.events.at(-1),"pool-end");
 }
 for(const raw of['{invalid',"x".repeat(1000001)]){
  const fixture=serverFixture(),request=fixture.request(raw);await tick();request.send();await tick();assert.equal(request.res.status,400);assert.equal(fixture.needCalls,0);assert((await fixture.api.closeDb()).ok);
 }
 {
  const gate=deferred(),fixture=serverFixture({httpDbGate:gate}),request=fixture.request('{"receiptId":"LOCAL_TEST","contributorId":"LOCAL_TEST","private":true}',"/v1/receipt-privacy");await tick();request.send();await tick();assert.equal(fixture.queries.length,1);
  const ending=fixture.api.shutdown();await tick();assert.equal(fixture.ended,0);gate.resolve();assert((await ending).ok);assert.equal(request.res.status,500);assert.equal(fixture.queries.length,1,"An asynchronous body callback failure must reach the HTTP guard once, never rerun its write");assert.equal(fixture.ended,1);
 }
 {
  const fixture=serverFixture(),request=fixture.request();await tick();request.req.emit("aborted");request.send();assert((await fixture.api.closeDb()).ok);assert.equal(fixture.needCalls,0,"An aborted incomplete body never begins new API work");
 }
 // An admitted admin POST may finish validation, but cannot start new source
 // work after the signal, including when its inventory warmup was in flight.
 for(const duringWarmup of[false,true]){
  const gate=deferred(),fixture=serverFixture({inventoryGate:gate}),request=fixture.request('{"maxPages":1}',"/v1/admin/price-inventory/refresh");await tick();
  if(duringWarmup){request.send();await tick();assert.equal(fixture.inventoryCalls,1);}
  const ending=fixture.api.shutdown();await tick();assert.equal(fixture.ended,0);
  if(!duringWarmup)request.send();gate.resolve();assert((await ending).ok);assert.equal(request.res.status,409);assert.equal(JSON.parse(request.res.text).skipped,"server-stopping");assert.equal(fixture.inventoryFetches,0);
 }
 // The periodic inventory warmup is part of the tracked batch too. Clearing
 // the timer prevents another batch while its stop gate safely finishes.
 {
  const gate=deferred(),fixture=serverFixture({asMain:true,inventory:true,inventoryGate:gate});await tick();await tick();assert.equal(fixture.inventoryCalls,1);fixture.process.emit("SIGTERM");await tick();assert.equal(fixture.interval.cleared,true);assert.equal(fixture.ended,0);fixture.interval.fn();await tick();assert.equal(fixture.inventoryCalls,1);gate.resolve();await tick();await tick();assert.equal(fixture.inventoryFetches,0);assert.equal(fixture.ended,1);assert.equal(fixture.process.exitCode,0);
 }
 // Shutdown during DB warmup does not seed merchants, start a timer or listen.
 {
  const gate=deferred(),fixture=serverFixture({initGate:gate}),starting=fixture.api.start();await tick();let complete=false;const ending=fixture.api.shutdown().then(value=>{complete=true;return value;});await tick();assert.equal(complete,false);assert.equal(fixture.ended,0);gate.resolve();await starting;assert((await ending).ok);assert.equal(fixture.queries.some(query=>query.sql.startsWith("INSERT INTO merchants")),false);assert(!fixture.events.includes("listen"));assert.equal(fixture.interval,null);
 }
 // Real server main wiring installs signals and tracks its catalogue job. The
 // 60-second timer is stopped before awaiting that job or ending its pool.
 {
  const gate=deferred(),fixture=serverFixture({asMain:true,catalog:true,catalogGate:gate});await tick();await tick();assert.equal(fixture.catalogCalls,1);assert(fixture.interval);assert.equal(fixture.process.listenerCount("SIGTERM"),1);
  fixture.process.emit("SIGTERM");fixture.process.emit("SIGINT");await tick();assert.equal(fixture.interval.cleared,true);assert.equal(fixture.ended,0);assert.equal(fixture.exitCodes.length,0);fixture.interval.fn();await tick();assert.equal(fixture.catalogCalls,1);gate.resolve();await tick();await tick();assert.equal(fixture.ended,1);assert.deepEqual(fixture.exitCodes,[]);assert.equal(fixture.process.exitCode,0);assert.deepEqual(JSON.parse(fixture.logs.find(args=>args[0]==="Server shutdown complete")[1]),{ok:true,timedOut:false});assert(fixture.events.indexOf("timer-stop")<fixture.events.indexOf("catalog-finished"));assert(fixture.events.indexOf("catalog-finished")<fixture.events.indexOf("pool-end"));
 }
 console.log("server-lifecycle: bounded signal drain, stop/acquire races, native checkpoint/persist/release, intact refusal cooldown, HTTP body/client-abort safety and startup/catalogue tracking OK");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
