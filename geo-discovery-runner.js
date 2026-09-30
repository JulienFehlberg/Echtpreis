"use strict";
const Grid=require("./geo-discovery-grid"),State=require("./geo-discovery-state"),Refresh=require("./open-prices-location-refresh");
async function refresh({pool,fetchImpl=fetch,preset="berlin",limit=8}={}){if(!pool)throw new Error("database-required");const cells=Grid.preset(preset);await State.seed(pool,"Open Prices",cells);const areas=await State.next(pool,"Open Prices",limit);const result=await Refresh.refresh({pool,areas,fetchImpl});return{...result,preset,totalCells:cells.length,selectedCells:areas.length}}
module.exports={refresh};
