"use strict";

// Drain admitted work without releasing a lease that its handler still owns.
// Source checkpoints and cooldowns remain the handlers' responsibility.
function create(options={}){
 const timeoutMs=options.timeoutMs===undefined?25000:options.timeoutMs;
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new Error("invalid-shutdown-budget");
 const setTimer=options.setTimer||setTimeout,clearTimer=options.clearTimer||clearTimeout,jobs=new Set();
 let stopping=false,shutdownPromise=null,stopError=null;
 function stop(){if(stopping)return;stopping=true;try{options.stopScheduling?.()}catch(error){stopError=error;}}
 function run(task,admitted){
  if(typeof task!=="function")return Promise.reject(new TypeError("lifecycle-task-required"));
  if(stopping)return Promise.resolve({skipped:"server-stopping"});
  const promise=Promise.resolve().then(()=>!admitted&&stopping?{skipped:"server-stopping"}:task());
  jobs.add(promise);promise.then(()=>jobs.delete(promise),()=>jobs.delete(promise));return promise;
 }
 async function drain(){while(jobs.size)await Promise.allSettled([...jobs]);}
 function shutdown(){
  if(shutdownPromise)return shutdownPromise;
  let finish;shutdownPromise=new Promise(resolve=>{finish=resolve;});stop();
  const timer=setTimer(()=>finish({ok:false,timedOut:true,activeJobs:jobs.size}),timeoutMs);
  // Stop accepting HTTP immediately, then retain the pool until both HTTP and
  // tracked work have finished. A deadline never clears source-owned leases.
  const closing=Promise.resolve().then(()=>options.closeServer?.());
  Promise.allSettled([closing,drain()]).then(async results=>{
   const errors=results.filter(result=>result.status==="rejected").map(result=>result.reason);
   if(stopError)errors.push(stopError);
   try{await options.closePool?.()}catch(error){errors.push(error);}
   clearTimer(timer);
   finish(errors.length?{ok:false,timedOut:false,error:String(errors[0]?.message||errors[0])}:{ok:true,timedOut:false});
  }).catch(error=>{clearTimer(timer);finish({ok:false,timedOut:false,error:String(error?.message||error)});});
  return shutdownPromise;
 }
 return Object.freeze({runJob:task=>run(task,false),runRequest:task=>run(task,true),stop,shutdown,isStopping:()=>stopping,activeJobs:()=>jobs.size});
}
function installSignals(lifecycle,{target=process,onComplete=()=>{}}={}){
 let signalled=false;const listener=()=>{if(signalled)return;signalled=true;lifecycle.shutdown().then(onComplete);};
 target.on("SIGTERM",listener);target.on("SIGINT",listener);
 return()=>{target.removeListener("SIGTERM",listener);target.removeListener("SIGINT",listener);};
}
module.exports={create,installSignals};
