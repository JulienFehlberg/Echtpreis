"use strict";
const Grid=require("./geo-discovery-grid"),State=require("./geo-discovery-state"),Refresh=require("./open-prices-location-refresh"),Adaptive=require("./geo-adaptive-discovery");
const ADAPTIVE_SCAN_LIMIT=1000;
async function refresh({pool,fetchImpl=fetch,preset="berlin",limit=8}={}){
 if(!pool)throw new Error("database-required");
 if(typeof preset!=="string"||!Object.prototype.hasOwnProperty.call(Grid.PRESETS,preset))throw new Error("unknown-grid-preset");
 if(!Number.isInteger(limit)||limit<1||limit>500)throw new Error("invalid-geo-discovery-limit");
 const base=Grid.preset(preset),scope={rootKeys:base.map(cell=>cell.key)};
 await State.seed(pool,"Open Prices",base);
 const priorCandidates=await State.scanned(pool,"Open Prices",ADAPTIVE_SCAN_LIMIT+1,scope),prior=priorCandidates.slice(0,ADAPTIVE_SCAN_LIMIT),adaptive=Adaptive.expand(prior,{minScans:1,minDensity:12,minRadiusKm:2});
 const seededAdaptive=await State.seed(pool,"Open Prices",adaptive),areas=await State.next(pool,"Open Prices",limit,scope);
 const result=await Refresh.refresh({pool,areas,fetchImpl});
 return{...result,preset,baseCells:base.length,adaptiveCandidates:adaptive.length,seededAdaptive,selectedCells:areas.length,adaptiveScanLimit:ADAPTIVE_SCAN_LIMIT,adaptiveScanTruncated:priorCandidates.length>ADAPTIVE_SCAN_LIMIT};
}
module.exports={refresh};
