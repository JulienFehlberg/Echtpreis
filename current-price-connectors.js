"use strict";
const C=require("./current-price-connector");
const contracts={
 receipt:C.contract({id:"ECHTPREIS receipt",merchant:"*",sourceType:"first_party_receipt",allowed:true,requiresStore:false,requiresRegion:false,registryTrust:92,termsStatus:"first-party"}),
 shelf:C.contract({id:"ECHTPREIS shelf",merchant:"*",sourceType:"first_party_shelf",allowed:true,requiresStore:true,registryTrust:90,termsStatus:"first-party"}),
 openPrices:C.contract({id:"Open Prices",merchant:"*",sourceType:"open_data",allowed:true,requiresStore:false,requiresRegion:false,registryTrust:78,termsStatus:"approved-open-data",license:"ODbL-1.0"}),
 aldiSued:C.contract({id:"ALDI SÜD",merchant:"ALDI SÜD",sourceType:"retailer",allowed:false,requiresRegion:true,registryTrust:96,termsStatus:"review"}),
 aldiNord:C.contract({id:"ALDI Nord",merchant:"ALDI Nord",sourceType:"retailer",allowed:false,requiresRegion:true,registryTrust:96,termsStatus:"review"}),
 rewe:C.contract({id:"REWE",merchant:"REWE",sourceType:"retailer",allowed:false,requiresStore:true,registryTrust:97,termsStatus:"review"}),
 edeka:C.contract({id:"EDEKA",merchant:"EDEKA",sourceType:"retailer",allowed:false,requiresStore:true,registryTrust:97,termsStatus:"review"}),
 lidl:C.contract({id:"Lidl",merchant:"Lidl",sourceType:"retailer",allowed:false,requiresRegion:true,registryTrust:95,termsStatus:"review"}),
 kaufland:C.contract({id:"Kaufland",merchant:"Kaufland",sourceType:"retailer",allowed:false,requiresStore:true,registryTrust:96,termsStatus:"review"}),
 penny:C.contract({id:"PENNY",merchant:"PENNY",sourceType:"retailer",allowed:false,requiresRegion:true,registryTrust:96,termsStatus:"review"}),
 netto:C.contract({id:"Netto",merchant:"Netto",sourceType:"retailer",allowed:false,requiresRegion:true,registryTrust:95,termsStatus:"review"})
};
function status(){return Object.entries(contracts).map(([key,x])=>({key,id:x.id,merchant:x.merchant,allowed:x.allowed,termsStatus:x.termsStatus,requiresStore:x.requiresStore,requiresRegion:x.requiresRegion,registryTrust:x.registryTrust}))}
module.exports={contracts,status};
