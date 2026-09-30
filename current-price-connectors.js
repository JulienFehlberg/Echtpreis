"use strict";
const C=require("./current-price-connector");
const contracts={
 posFeed:C.contract({id:"ECHTPREIS POS feed",merchant:"*",sourceType:"pos_feed",allowed:false,requiresStore:true,requiresRegion:false,registryTrust:99.5,termsStatus:"partner-contract"}),
 receipt:C.contract({id:"ECHTPREIS receipt",merchant:"*",sourceType:"first_party_receipt",allowed:true,requiresStore:false,requiresRegion:false,registryTrust:92,termsStatus:"first-party"}),
 shelf:C.contract({id:"ECHTPREIS shelf",merchant:"*",sourceType:"first_party_shelf",allowed:true,requiresStore:true,registryTrust:90,termsStatus:"first-party"}),
 openPrices:C.contract({id:"Open Prices",merchant:"*",sourceType:"open_data",allowed:true,requiresStore:false,requiresRegion:false,registryTrust:78,termsStatus:"approved-open-data",license:"ODbL-1.0"}),
 openFoodFacts:C.contract({id:"Open Food Facts",merchant:"*",sourceType:"product_catalog",allowed:false,requiresStore:false,requiresRegion:false,registryTrust:82,termsStatus:"identity-only",license:"ODbL-1.0"}),
 germanSupermarketDataset:C.contract({id:"German Supermarket Prices dataset",merchant:"*",sourceType:"aggregated_open_data",allowed:false,requiresStore:false,requiresRegion:false,registryTrust:65,termsStatus:"review",license:"ODbL-1.0"}),
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
