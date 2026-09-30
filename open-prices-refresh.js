"use strict";
const Client=require("./open-prices-client"),Persist=require("./external-price-import"),Checkpoints=require("./refresh-checkpoint-store"),Fair=require("./fair-refresh-queue");
async function refresh({pool,targets=[],fetchImpl=fetch,maxPages=100,maxTargets=250,maxRequestsPerTarget=10,pauseMs=75}={}){
 if(!pool)throw new Error("database-required");if(!Array.isArray(targets)||!targets.length)return{received:0,accepted:0,rejected:0,duplicates:0,targets:0};
 let received=0,accepted=0,rejected=0,duplicates=0;
 const checkpoint=await Checkpoints.load(pool,"Open Prices targets"),pick=Fair.select(targets,checkpoint,Math.max(1,Number(maxTargets)||250),.25),selected=pick.selected;for(let i=0;i<selected.length;i++){const target=selected[i];const data=await Client.fetchAll({...target,maxPages,maxRequests:maxRequestsPerTarget},fetchImpl);const saved=await Persist.persist(pool,data,{source:"Open Prices",sourceUrl:data.pages?.[0]?.url||Client.BASE});received+=saved.received;accepted+=saved.accepted;rejected+=saved.rejected;duplicates+=saved.duplicates;if(pauseMs>0&&i<selected.length-1)await new Promise(r=>setTimeout(r,pauseMs))}
 await Checkpoints.save(pool,"Open Prices targets",pick.next);return{received,accepted,rejected,duplicates,targets:selected.length,queuedTargets:targets.length,checkpoint:pick.next};
}
module.exports={refresh};
