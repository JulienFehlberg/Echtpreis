"use strict";
function summarize(targets=[]){const out={total:targets.length,canonicalStoreGaps:0,productStorePairs:0,broadProducts:0,byLocation:{}};for(const x of targets){if(x.targetReason==="canonical-store-gap")out.canonicalStoreGaps++;else if(x.locationId)out.productStorePairs++;else out.broadProducts++;if(x.locationId)out.byLocation[x.locationId]=(out.byLocation[x.locationId]||0)+1}return out}
module.exports={summarize};
