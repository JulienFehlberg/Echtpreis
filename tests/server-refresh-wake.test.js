"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),{EventEmitter}=require("node:events"),{createRequire}=require("node:module");
const Runner=require("../price-refresh-runner"),Lifecycle=require("../server-lifecycle"),Sources=require("../price-sources").SOURCES;
const RealDate=Date,BASE=RealDate.parse("2026-10-02T04:00:00Z"),TARGET="REWE Berlin pickup",iso=value=>new RealDate(value).toISOString(),flush=()=>new Promise(resolve=>setImmediate(resolve));
class Clock{
 constructor(){this.now=BASE;this.id=0;this.timers=new Map();}
 set=(fn,ms,interval=false)=>{const timer={id:++this.id,fn,at:this.now+ms,ms,interval,unref(){}};this.timers.set(timer.id,timer);return timer;};
 clear=timer=>this.timers.delete(timer.id);
 async advance(to){await flush();let visits=0;for(;;){const timer=[...this.timers.values()].filter(t=>t.at<=BASE+to).sort((a,b)=>a.at-b.at||a.id-b.id)[0];if(!timer)break;assert(++visits<100,"No extra wake busy loop");this.now=timer.at;if(timer.interval)timer.at+=timer.ms;else this.timers.delete(timer.id);timer.fn();await flush();}this.now=BASE+to;await flush();}
}
function fixture({duration=8000,refuse=false,globalFailure=false,skip=false,leaseUntil=null}={}){
 const clock=new Clock(),root=path.resolve("server.js"),nativeRequire=createRequire(root),starts=[],events=[],logs=[],state=Object.fromEntries(Object.keys(Sources).map(name=>[name,{nextAttemptAt:iso(BASE+86400000)}]));let maxConcurrent=0,concurrent=0,loads=0,nativeDue=null;
 class FakeDate extends RealDate{constructor(...args){super(...(args.length?args:[clock.now]));}static now(){return clock.now;}}
 global.Date=FakeDate;
 state[TARGET]=leaseUntil?{leaseOwner:"foreign-instance",leaseUntil:iso(BASE+leaseUntil)}:{};
 const processDouble=new EventEmitter();processDouble.env={DATABASE_URL:"postgres://LOCAL_TEST",PRICE_INVENTORY_ENABLED:"false",PRODUCT_CATALOG_ENABLED:"false"};processDouble.pid=42;processDouble.exit=code=>events.push("exit:"+code);
 const pool={query:async()=>({rows:[],rowCount:0}),end:async()=>events.push("pool-end")},server={listening:false,listen(_port,cb){this.listening=true;cb?.();},close(cb){this.listening=false;events.push("http-close");cb?.();}};
 const mocks={http:{createServer:()=>server},pg:{Pool:function(){return pool;}},
  "./server-lifecycle":{...Lifecycle,create:options=>Lifecycle.create({...options,setTimer:clock.set,clearTimer:clock.clear}),installSignals:(lifecycle,options)=>Lifecycle.installSignals(lifecycle,{...options,target:processDouble})},
  "./legacy-rewe-provenance":{repair:async()=>({moved:0})},"./price-refresh-targets":{fromDatabase:async()=>[]},"./external-location-targets":{fromDatabase:async()=>[]},"./canonical-gap-refresh-targets":{build:async()=>[]},
  "./price-refresh-state-store":{loadAll:async()=>{loads++;if(globalFailure)throw Error("LOCAL_TEST global preparation failure");return structuredClone(state);},acquire:async(_pool,name)=>{events.push("acquire:"+name);return !state[name]?.leaseUntil||new RealDate(state[name].leaseUntil).getTime()<clock.now;},persist:async(name,value)=>{state[name]={...value,leaseOwner:null,leaseUntil:null};events.push("persist:"+name);},save:async(_pool,name,value)=>{state[name]={...value,leaseOwner:null,leaseUntil:null};events.push("persist:"+name);},release:async(_pool,name)=>events.push("release:"+name)},
  "./price-refresh-runner":Runner,
  "./rewe-retailer-price-refresh":{SOURCE:TARGET,resumeAt:async()=>nativeDue,refresh:async()=>{starts.push(clock.now-BASE);concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);await new Promise(resolve=>clock.set(resolve,duration));concurrent--;if(skip)return{skipped:"LOCAL_TEST-no-progress"};nativeDue=iso(clock.now+(refuse?7200000:60000));if(refuse)throw Object.assign(Error("rewe-source-http-429"),{nextAttemptAt:nativeDue});return{received:6,accepted:6,nextAttemptAt:nativeDue};}}
 };
 for(const[file,name]of[["./penny-berlin-publication-refresh","PENNY Berlin regional price publications"],["./aldi-assortment-refresh","ALDI Nord published assortment"],["./hit-price-refresh","HIT Berlin store assortment"]])mocks[file]={SOURCE:name,resumeAt:async()=>null,refresh:async()=>assert.fail("No unrelated retailer request")};
 mocks["./wolt-retailer-price-refresh"]={SOURCE:"Wolt EDEKA Berlin",resumeAt:async()=>null,createRefresh:()=>({SOURCE:"Wolt nahkauf Berlin Wrangelstraße",resumeAt:async()=>null,refresh:async()=>assert.fail("No unrelated retailer request")})};
 const module={exports:{}},require=file=>Object.hasOwn(mocks,file)?mocks[file]:nativeRequire(file);require.main=module;
 vm.runInNewContext(fs.readFileSync(root,"utf8"),{require,module,exports:module.exports,process:processDouble,console:{log(...args){logs.push(args);},error(...args){logs.push(args);}},Buffer,URL,Date:FakeDate,Promise,setTimeout:clock.set,clearTimeout:clock.clear,setInterval:(fn,ms)=>clock.set(fn,ms,true),clearInterval:clock.clear},{filename:root});
 return{clock,api:module.exports,starts,events,logs,state,process:processDouble,maxConcurrent:()=>maxConcurrent,loads:()=>loads};
}
async function main(){
 try{
  {
   const f=fixture();await f.clock.advance(150000);assert.deepEqual(f.starts,[0,68000,136000]);assert.equal(f.maxConcurrent(),1);const batches=f.logs.filter(args=>args[0]==="Price refresh batch").map(args=>JSON.parse(args[1]));assert.equal(batches[0].trigger,"initial");assert(batches.some(b=>b.trigger==="fallback"));assert.equal(batches.filter(b=>b.trigger==="source-deadline").length,2);assert(batches.every(b=>Number.isSafeInteger(b.durationMs)&&b.durationMs>=0));assert((await f.api.shutdown()).ok);assert.equal(f.clock.timers.size,0);
  }
  {
   const f=fixture({globalFailure:true});await f.clock.advance(180000);assert.equal(f.loads(),4,"Global prep failure retains only initial and60s fallback attempts");assert.deepEqual(f.starts,[]);assert(f.logs.some(args=>args[0]==="Price refresh batch"&&JSON.parse(args[1]).completed===false));assert((await f.api.shutdown()).ok);
  }
  {
   const f=fixture({skip:true});await f.clock.advance(180000);assert.deepEqual(f.starts,[0,60000,120000,180000],"No-progress skipped handler cannot create a one-second preparation/acquire loop");const ending=f.api.shutdown();await f.clock.advance(188000);assert((await ending).ok);
  }
  {
   const f=fixture({refuse:true});await f.clock.advance(180000);assert.deepEqual(f.starts,[0]);assert.equal(f.state[TARGET].nextAttemptAt,iso(BASE+8000+7200000));assert.equal(f.state[TARGET].consecutiveFailures,1);assert((await f.api.shutdown()).ok);
  }
  {
   const f=fixture({leaseUntil:30000});await f.clock.advance(31000);assert.deepEqual(f.starts,[],"At exact lease expiry SQL still rejects acquisition; the extra planner must not spin");await f.clock.advance(60000);assert.deepEqual(f.starts,[60000]);const ending=f.api.shutdown();await f.clock.advance(68000);assert((await ending).ok);
  }
  {
   const f=fixture();await f.clock.advance(61000);assert([...f.clock.timers.values()].some(t=>!t.interval&&t.at===BASE+68000));f.process.emit("SIGTERM");await flush();assert.equal(f.clock.timers.size,0);await f.clock.advance(200000);assert.deepEqual(f.starts,[0]);assert.equal(f.process.exitCode,0);assert.equal(f.events.at(-1),"pool-end");
  }
  {
   const f=fixture();await f.clock.advance(4000);f.process.emit("SIGTERM");await flush();assert(!f.events.includes("pool-end"));await f.clock.advance(8000);assert.equal(f.events.filter(e=>e.startsWith("acquire:")).length,1);assert(f.events.indexOf("pool-end")>f.events.indexOf("release:"+TARGET));assert.equal(f.clock.timers.size,0);assert.equal(f.process.exitCode,0);await f.clock.advance(200000);assert.deepEqual(f.starts,[0]);
  }
  console.log("server-refresh-wake: actual server wiring, precise native pause, no-progress/global-failure fallback, two-hour refusal, lease boundary, single batch and signal drain OK (7 cases; no network or DB)");
 }finally{global.Date=RealDate;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
