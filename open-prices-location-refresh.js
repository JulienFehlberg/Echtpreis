"use strict";
const Locations=require("./open-prices-locations"),Catalog=require("./external-location-catalog"),Geo=require("./geo-discovery-state");
async function refresh({pool,areas=[],fetchImpl=fetch,source="Open Prices"}={}){
 if(!pool)throw new Error("database-required");let received=0,accepted=0;
 for(const a of areas){const x=await Locations.nearby(a,fetchImpl);received+=x.items.length;const saved=await Catalog.upsert(pool,source,x.items);accepted+=saved.upserted;if(a.key)await Geo.mark(pool,source,a.key,{received:x.items.length,accepted:saved.upserted})}
 return{received,accepted,rejected:0,areas:areas.length}
}
module.exports={refresh};
