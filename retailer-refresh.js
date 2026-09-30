"use strict";
const Adapter=require("./retailer-feed-adapter"),Persist=require("./external-price-import");
async function refresh(key,{pool,fetcher,fetchArgs={},meta={}}={}){
 if(!pool)throw new Error("database-required");if(typeof fetcher!=="function")throw new Error("fetcher-required");
 const contract=Adapter.contract(key);const fetched=await fetcher(fetchArgs),items=Array.isArray(fetched)?fetched:(fetched?.items||[]);
 const normalized=Adapter.normalize(key,items,{...meta,fetchedAt:meta.fetchedAt||new Date().toISOString()});
 const saved=await Persist.persist(pool,normalized,{source:contract.id,sourceUrl:meta.sourceUrl||null});
 return{received:items.length,accepted:saved.accepted,rejected:saved.rejected,duplicates:saved.duplicates,batchId:saved.batchId,source:contract.id};
}
module.exports={refresh};
