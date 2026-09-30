"use strict";
const Refresh=require("./price-source-refresh"),State=require("./source-refresh-state"),Sources=require("./price-sources");
const locks=new Set();
async function runOne(name,state={},handlers={},ctx={}){
 const source=Sources.SOURCES[name];if(!source)return{ok:false,name,skipped:"unknown-source",state};
 if(!source.active)return{ok:false,name,skipped:"inactive",state};
 if(locks.has(name))return{ok:false,name,skipped:"already-running",state};
 const nowMs=ctx.nowMs??Date.now();if(!Refresh.due(source,state,nowMs)&&!ctx.force)return{ok:false,name,skipped:"not-due",state};
 const handler=handlers[name]||handlers[source.type];if(typeof handler!=="function")return{ok:false,name,skipped:"no-handler",state};
 locks.add(name);const started=Date.now(),stamp=new Date(nowMs).toISOString();
 try{const result=await handler({name,source,state,ctx});const meta={received:Number(result?.received||0),accepted:Number(result?.accepted||0),durationMs:Date.now()-started};return{ok:true,name,result,state:State.success(state,meta,stamp)}}
 catch(error){return{ok:false,name,error:String(error?.message||error),alert:State.shouldAlert(State.failure(state,error,stamp)),state:State.failure(state,error,stamp)}}
 finally{locks.delete(name)}
}
async function runDue(states={},handlers={},ctx={}){const out=[];for(const x of Refresh.plan(states,ctx.nowMs??Date.now()).filter(x=>x.due)){const r=await runOne(x.name,states[x.name]||{},handlers,ctx);out.push(r);states[x.name]=r.state||states[x.name]||{}}return{states,results:out}}
module.exports={runOne,runDue,locks};
