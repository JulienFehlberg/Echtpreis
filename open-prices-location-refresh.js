"use strict";
const Locations=require("./open-prices-locations"),Catalog=require("./external-location-catalog"),Geo=require("./geo-discovery-state"),Failures=require("./geo-cell-failures");
async function refresh({pool,areas=[],fetchImpl=fetch,source="Open Prices"}={}){
 if(!pool)throw new Error("database-required");let received=0,accepted=0,failedAreas=0,succeededAreas=0;
 for(const a of areas){try{const x=await Locations.nearby(a,fetchImpl);received+=x.items.length;const saved=await Catalog.upsert(pool,source,x.items);accepted+=saved.upserted;succeededAreas++;if(a.key){await Geo.mark(pool,source,a.key,{received:x.items.length,accepted:saved.upserted});await Failures.success(pool,source,a.key)}}catch(e){failedAreas++;if(a.key)await Failures.fail(pool,source,a.key,e)}}
 return{received,accepted,rejected:0,areas:areas.length,succeededAreas,failedAreas}
}
module.exports={refresh};
