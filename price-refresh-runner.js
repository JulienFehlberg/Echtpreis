"use strict";
const Refresh=require("./price-source-refresh"),State=require("./source-refresh-state"),Sources=require("./price-sources"),Backoff=require("./price-refresh-backoff");
const locks=new Set();
async function runOne(name,state={},handlers={},ctx={}){
 if(typeof ctx.shouldContinue==="function"&&!ctx.shouldContinue())return{ok:false,name,skipped:"server-stopping",state};
 const source=Sources.SOURCES[name];if(!source)return{ok:false,name,skipped:"unknown-source",state};
 if(!source.active)return{ok:false,name,skipped:"inactive",state};
 if(locks.has(name))return{ok:false,name,skipped:"already-running",state};
 const nowMs=ctx.nowMs??Date.now();if(!Refresh.due(source,state,nowMs)&&!ctx.force)return{ok:false,name,skipped:"not-due",state};
 const handler=handlers[name]||handlers[source.type];if(typeof handler!=="function")return{ok:false,name,skipped:"no-handler",state};
 locks.add(name);const started=Date.now(),stamp=new Date(nowMs).toISOString();
 try{const result=await handler({name,source,state,ctx});if(result?.skipped){const nextAttemptAt=State.nextAttempt(result.retryAfter||result.nextAttemptAt,stamp);return{ok:false,name,skipped:result.skipped,result,state:nextAttemptAt?{...state,nextAttemptAt}:state}}const meta={received:Number(result?.received||0),accepted:Number(result?.accepted||0),durationMs:Date.now()-started,nextAttemptAt:result?.nextAttemptAt};return{ok:true,name,result,state:State.success(state,meta,stamp)}}
 catch(error){return{ok:false,name,error:String(error?.message||error),alert:State.shouldAlert(State.failure(state,error,stamp)),state:State.failure(state,error,stamp)}}
 finally{locks.delete(name)}
}
async function runDue(states={},handlers={},ctx={}){
 const out=[],allowed=()=>typeof ctx.shouldContinue!=="function"||ctx.shouldContinue();
 for(const x of Refresh.plan(states,ctx.nowMs??Date.now()).filter(x=>x.due)){
  if(!allowed())break;
  if(!ctx.force&&!Backoff.eligible(states[x.name]||{},ctx.nowMs??Date.now())){out.push({ok:false,name:x.name,skipped:"failure-backoff",state:states[x.name]||{}});continue;}
  let leased=true;if(ctx.acquire)leased=await ctx.acquire(x.name);
  if(!leased){out.push({ok:false,name:x.name,skipped:"lease-held",state:states[x.name]||{}});continue;}
  let r;try{
   // A stop may arrive while the database acquire is pending. Release only
   // this successful acquire, without starting a handler or saving freshness.
   r=await runOne(x.name,states[x.name]||{},handlers,ctx);
   if(r.skipped!=="server-stopping"){states[x.name]=r.state||states[x.name]||{};if(ctx.persist&&r.state)await ctx.persist(x.name,r.state);}
  }finally{if(ctx.release)await ctx.release(x.name);}
  out.push(r);
 }
 return{states,results:out};
}
module.exports={runOne,runDue,locks};
