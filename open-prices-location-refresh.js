"use strict";
const Locations=require("./open-prices-locations"),Catalog=require("./external-location-catalog");
async function refresh({pool,areas=[],fetchImpl=fetch}={}){if(!pool)throw new Error("database-required");let received=0,accepted=0;for(const a of areas){const x=await Locations.nearby(a,fetchImpl);received+=x.items.length;const saved=await Catalog.upsert(pool,"Open Prices",x.items);accepted+=saved.upserted}return{received,accepted,rejected:0,areas:areas.length}}
module.exports={refresh};
