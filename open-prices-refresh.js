"use strict";
const Client=require("./open-prices-client"),Persist=require("./external-price-import");
async function refresh({pool,targets=[],fetchImpl=fetch,maxPages=100,maxTargets=250,maxRequestsPerTarget=10,pauseMs=75}={}){
 if(!pool)throw new Error("database-required");if(!Array.isArray(targets)||!targets.length)return{received:0,accepted:0,rejected:0,duplicates:0,targets:0};
 let received=0,accepted=0,rejected=0,duplicates=0;
 const selected=[...targets].sort((a,b)=>Number(b.priority||0)-Number(a.priority||0)).slice(0,Math.max(1,Number(maxTargets)||250));for(let i=0;i<selected.length;i++){const target=selected[i];const data=await Client.fetchAll({...target,maxPages,maxRequests:maxRequestsPerTarget},fetchImpl);const saved=await Persist.persist(pool,data,{source:"Open Prices",sourceUrl:data.pages?.[0]?.url||Client.BASE});received+=saved.received;accepted+=saved.accepted;rejected+=saved.rejected;duplicates+=saved.duplicates;if(pauseMs>0&&i<selected.length-1)await new Promise(r=>setTimeout(r,pauseMs))}
 return{received,accepted,rejected,duplicates,targets:selected.length,queuedTargets:targets.length};
}
module.exports={refresh};
