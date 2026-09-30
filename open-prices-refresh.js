"use strict";
const Client=require("./open-prices-client"),Canonical=require("./canonical-open-prices-refresh-import"),Persist=require("./external-price-import"),Checkpoints=require("./refresh-checkpoint-store"),Queue=require("./stable-coverage-queue"),Failures=require("./refresh-target-failures");
async function refresh({pool,targets=[],fetchImpl=fetch,today=Client.todayBerlin(),maxPages=100,maxTargets=250,maxRequestsPerTarget=10,pauseMs=75}={}){
 if(!pool)throw new Error("database-required");if(!Array.isArray(targets)||!targets.length)return{received:0,accepted:0,rejected:0,duplicates:0,targets:0};
 let received=0,accepted=0,rejected=0,duplicates=0;const errors=[],catalog={productsCreated:0,storesCreated:0,productMappingsCreated:0,storeMappingsCreated:0};
 const checkpoint=await Checkpoints.load(pool,"Open Prices targets"),pick=Queue.select(targets,checkpoint,Math.max(1,Number(maxTargets)||250),.25),selected=pick.selected;
 let failedTargets=0,cooldownSkipped=0,succeededTargets=0,incompleteTargets=0;
 for(let i=0;i<selected.length;i++){
  const target=selected[i];
  try{
   if(!(await Failures.eligible(pool,"Open Prices targets",target))){cooldownSkipped++;continue}
   const input={...target,today,maxPages,maxRequests:maxRequestsPerTarget},data=await Client.fetchAll(input,fetchImpl),prepared=await Canonical.prepare(pool,data,input);
   const saved=await Persist.persist(pool,prepared,{source:"Open Prices",sourceUrl:data.sourceUrl||data.pages?.[0]?.url||Client.BASE});
   received+=saved.received;accepted+=saved.accepted;rejected+=saved.rejected;duplicates+=saved.duplicates;
   for(const key of Object.keys(catalog))catalog[key]+=Number(prepared.catalogCounts?.[key]||0);
   if(data.complete===false)incompleteTargets++;
   await Failures.success(pool,"Open Prices targets",target);succeededTargets++;
  }catch(error){failedTargets++;errors.push(error);await Failures.fail(pool,"Open Prices targets",target,error)}
  finally{if(pauseMs>0&&i<selected.length-1)await new Promise(resolve=>setTimeout(resolve,pauseMs))}
 }
 await Checkpoints.save(pool,"Open Prices targets",pick.next);const result={received,accepted,rejected,duplicates,targets:selected.length,succeededTargets,failedTargets,cooldownSkipped,incompleteTargets,catalog,queuedTargets:targets.length,checkpoint:pick.next};
 if(failedTargets>0&&succeededTargets===0&&selected.length>cooldownSkipped){const error=new AggregateError(errors,"open-prices-target-refresh-all-failed: "+failedTargets+" targets");error.code="open-prices-target-refresh-all-failed";error.result=result;throw error}return result;
}
module.exports={refresh};
