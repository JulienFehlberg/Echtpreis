"use strict";
const C=require("./current-price-connector");
const contracts={
 posFeed:C.contract({id:"ECHTPREIS POS feed",merchant:"*",sourceType:"pos_feed",allowed:false,requiresStore:true,requiresRegion:false,registryTrust:99.5,termsStatus:"partner-contract"}),
 aggregatorAktionspreis:C.contract({id:"Aktionspreis",merchant:"*",sourceType:"third_party",allowed:false,requiresRegion:true,registryTrust:72,termsStatus:"review"}),
 aggregatorMarktguru:C.contract({id:"Marktguru",merchant:"*",sourceType:"third_party",allowed:false,requiresRegion:true,registryTrust:72,termsStatus:"review"}),
 aggregatorKaufda:C.contract({id:"kaufDA",merchant:"*",sourceType:"third_party",allowed:false,requiresRegion:true,registryTrust:70,termsStatus:"review"}),
 preiszeiger:C.contract({id:"Preiszeiger",merchant:"*",sourceType:"retailer_feed",allowed:false,requiresRegion:true,registryTrust:94,termsStatus:"license-required"}),
 gkl:C.contract({id:"GKL",merchant:"*",sourceType:"retailer_feed",allowed:false,requiresRegion:true,registryTrust:93,termsStatus:"license-required"}),
 redprice:C.contract({id:"redprice",merchant:"*",sourceType:"third_party",allowed:false,requiresRegion:true,registryTrust:86,termsStatus:"license-required"}),
 receipt:C.contract({id:"ECHTPREIS receipt",merchant:"*",sourceType:"first_party_receipt",allowed:true,requiresStore:false,requiresRegion:false,registryTrust:92,termsStatus:"first-party"}),
 shelf:C.contract({id:"ECHTPREIS shelf",merchant:"*",sourceType:"first_party_shelf",allowed:true,requiresStore:true,registryTrust:90,termsStatus:"first-party"}),
 openPrices:C.contract({id:"Open Prices",merchant:"*",sourceType:"open_data",allowed:true,requiresStore:false,requiresRegion:false,registryTrust:78,termsStatus:"approved-open-data",license:"ODbL-1.0"}),
 openFoodFacts:C.contract({id:"Open Food Facts",merchant:"*",sourceType:"product_catalog",allowed:false,requiresStore:false,requiresRegion:false,registryTrust:82,termsStatus:"identity-only",license:"ODbL-1.0"}),
 germanSupermarketDataset:C.contract({id:"German Supermarket Prices dataset",merchant:"*",sourceType:"aggregated_open_data",allowed:false,requiresStore:false,requiresRegion:false,registryTrust:65,termsStatus:"review",license:"ODbL-1.0"}),
 budni:C.contract({id:"BUDNI",merchant:"BUDNI",sourceType:"retailer",allowed:false,requiresStore:true,registryTrust:96,termsStatus:"review"}),
 denns:C.contract({id:"Denns BioMarkt",merchant:"Denns",sourceType:"retailer",allowed:false,requiresStore:true,registryTrust:95,termsStatus:"review"}),
 getraenkeHoffmann:C.contract({id:"Getraenke Hoffmann",merchant:"Getraenke Hoffmann",sourceType:"retailer",allowed:false,requiresRegion:true,registryTrust:95,termsStatus:"review"}),
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
