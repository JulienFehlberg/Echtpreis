"use strict";
const Client=require("./open-prices-client"),Provider=require("./providers/open-prices"),Canonical=require("./canonical-inventory-import");
const SOURCE="Open Prices";
function canonicalRow(adapted,identity){
 return{...adapted,merchant:identity.merchant,product:identity.product,brand:identity.brand,pack:identity.pack,packAmount:identity.packAmount*(identity.packCount||1),packUnit:identity.packUnit,region:identity.region,productId:identity.productId,storeId:identity.storeId,gtin:identity.gtin,externalProductId:identity.externalProductId,externalLocationId:identity.externalLocationId};
}
async function prepare(pool,data={},input={}){
 const n=Client.normalizeInput(input),rows=data.rawItems,sourceUrl=data.sourceUrl||data.pages?.[0]?.url||Client.BASE,fetchedAt=data.fetchedAt||new Date().toISOString();
 if(!Array.isArray(rows)){
  if((data.accepted?.length||0)+(data.rejected?.length||0))throw new Error("open-prices-raw-source-payload-required");
  return{accepted:[],rejected:[],catalogCounts:null,partial:[],sourceId:SOURCE,attribution:Canonical.ATTRIBUTION};
 }
 if(rows.length>10000)throw new Error("open-prices-refresh-source-limit");
 const candidates=[],adapted=new Map(),rejected=[],seen=new Set();
 for(const raw of rows){
  const reasons=Client.rejectionReasons(raw,n);if(seen.has(raw?.id))reasons.push("duplicate-id");if(Number.isSafeInteger(raw?.id))seen.add(raw.id);
  if(reasons.length){rejected.push({raw,reasons:[...new Set(reasons)]});continue}
  // Validate original price/proof semantics before any identity writes. A valid GTIN alone is not price evidence.
  const result=Provider.adapt([raw],{sourceUrl,fetchedAt});
  if(!result.accepted.length){rejected.push(...result.rejected);continue}
  candidates.push(raw);adapted.set(raw,result.accepted[0]);
 }
 if(!candidates.length)return{accepted:[],rejected,catalogCounts:null,partial:[],sourceId:SOURCE,attribution:Canonical.ATTRIBUTION};
 const catalog=await Canonical.prepare(pool,candidates,{sourceId:SOURCE,sourceUrl,fetchedAt,limit:candidates.length});
 const accepted=catalog.accepted.map(identity=>canonicalRow(adapted.get(identity.raw),identity));
 return{accepted,rejected:[...rejected,...catalog.rejected],catalogCounts:catalog.counts,partial:catalog.partial,sourceId:SOURCE,attribution:catalog.attribution};
}
module.exports={SOURCE,canonicalRow,prepare};
