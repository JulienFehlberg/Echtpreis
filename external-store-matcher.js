"use strict";
const Store=require("./store-resolver");
function resolve(external={},stores=[]){
 const q={merchant:external.merchant,externalId:external.canonicalExternalId||null,address:external.address||null,postalCode:external.postalCode||null,city:external.city||null};
 const r=Store.resolve(q,stores);
 if(r.state==="verified"&&r.confidence>=.9)return{state:"verified",storeId:r.storeId,confidence:r.confidence,reason:"external-"+r.reason};
 if(r.state==="resolved"&&r.confidence>=.82)return{state:"review",storeId:null,confidence:r.confidence,reason:"external-store-needs-review",candidateStoreId:r.storeId};
 return{state:r.state==="review"?"review":"unresolved",storeId:null,confidence:r.confidence||0,reason:r.reason||"external-store-unresolved",candidates:r.candidates||[]};
}
function apply(row,resolution){
 if(!resolution||resolution.state!=="verified"||!resolution.storeId)return{...row,storeId:null,locationResolution:resolution||{state:"unresolved"}};
 return{...row,storeId:resolution.storeId,locationResolution:resolution};
}
module.exports={resolve,apply};
