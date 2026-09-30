"use strict";
const SOURCES={
 "Open Prices":{type:"open_data",baseTrust:78,license:"ODbL",termsUrl:"https://prices.openfoodfacts.org/",attribution:"Open Prices / Open Food Facts",commercialUseStatus:"license-review",active:true},
 "ALDI SÜD":{type:"retailer",baseTrust:96,termsUrl:"https://www.aldi-sued.de/",commercialUseStatus:"review",active:false,notes:"Public product/offer pages verified; production ingestion remains disabled until usage terms are reviewed."},
 "REWE":{type:"retailer",baseTrust:97,termsUrl:"https://www.rewe.de/",commercialUseStatus:"review",active:false,notes:"Public national and market-specific offer pages verified; production ingestion remains disabled until usage terms are reviewed."},
 "EDEKA":{type:"retailer",baseTrust:97,termsUrl:"https://www.edeka.de/",commercialUseStatus:"review",active:false},
 "PENNY":{type:"retailer",baseTrust:96,termsUrl:"https://www.penny.de/",commercialUseStatus:"review",active:false},
 "ALDI Nord":{type:"retailer",baseTrust:96,termsUrl:"https://www.aldi-nord.de/",commercialUseStatus:"review",active:false},
 "Kaufland":{type:"retailer",baseTrust:96,termsUrl:"https://www.kaufland.de/",commercialUseStatus:"review",active:false},
 "Lidl":{type:"retailer",baseTrust:95,termsUrl:"https://www.lidl.de/",commercialUseStatus:"review",active:false},
 "Netto":{type:"retailer",baseTrust:95,termsUrl:"https://www.netto-online.de/",commercialUseStatus:"review",active:false},
 "ECHTPREIS receipt":{type:"first_party_receipt",baseTrust:92,commercialUseStatus:"first-party",active:true},
 "ECHTPREIS shelf":{type:"first_party_shelf",baseTrust:90,commercialUseStatus:"first-party",active:true}
};
function canImport(name){const s=SOURCES[name];return !!(s&&s.active&&["first-party","approved","license-review"].includes(s.commercialUseStatus))}
function publicStatus(){return Object.entries(SOURCES).map(([name,s])=>({name,type:s.type,baseTrust:s.baseTrust,active:s.active,commercialUseStatus:s.commercialUseStatus,license:s.license||null,notes:s.notes||null}))}
module.exports={SOURCES,canImport,publicStatus};
