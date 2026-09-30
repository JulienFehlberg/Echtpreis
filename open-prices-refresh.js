"use strict";
const Client=require("./open-prices-client"),Persist=require("./external-price-import");
async function refresh({pool,targets=[],fetchImpl=fetch,maxPages=100}={}){
 if(!pool)throw new Error("database-required");if(!Array.isArray(targets)||!targets.length)return{received:0,accepted:0,rejected:0,duplicates:0,targets:0};
 let received=0,accepted=0,rejected=0,duplicates=0;
 for(const target of [...targets].sort((a,b)=>Number(b.priority||0)-Number(a.priority||0))){const data=await Client.fetchAll({...target,maxPages},fetchImpl);const saved=await Persist.persist(pool,data,{source:"Open Prices",sourceUrl:data.pages?.[0]?.url||Client.BASE});received+=saved.received;accepted+=saved.accepted;rejected+=saved.rejected;duplicates+=saved.duplicates}
 return{received,accepted,rejected,duplicates,targets:targets.length};
}
module.exports={refresh};
