"use strict";
const Sources=require("./price-sources");
const PURPOSE={DISCOVERY:"discovery",IDENTITY:"identity",CORROBORATION:"corroboration",CURRENT_PRICE:"current-price",BENCHMARK:"benchmark"};
const TYPE_PURPOSES={
 pos_feed:[PURPOSE.IDENTITY,PURPOSE.CORROBORATION,PURPOSE.CURRENT_PRICE],
 retailer:[PURPOSE.DISCOVERY,PURPOSE.IDENTITY,PURPOSE.CORROBORATION,PURPOSE.CURRENT_PRICE],
 official_retailer:[PURPOSE.DISCOVERY,PURPOSE.IDENTITY,PURPOSE.CORROBORATION,PURPOSE.CURRENT_PRICE],
 retailer_feed:[PURPOSE.DISCOVERY,PURPOSE.IDENTITY,PURPOSE.CORROBORATION,PURPOSE.CURRENT_PRICE],
 open_data:[PURPOSE.DISCOVERY,PURPOSE.IDENTITY,PURPOSE.CORROBORATION,PURPOSE.CURRENT_PRICE],
 first_party_receipt:[PURPOSE.IDENTITY,PURPOSE.CORROBORATION,PURPOSE.CURRENT_PRICE],
 first_party_shelf:[PURPOSE.IDENTITY,PURPOSE.CORROBORATION,PURPOSE.CURRENT_PRICE],
 receipt:[PURPOSE.IDENTITY,PURPOSE.CORROBORATION,PURPOSE.CURRENT_PRICE],
 shelf:[PURPOSE.IDENTITY,PURPOSE.CORROBORATION,PURPOSE.CURRENT_PRICE],
 aggregated_open_data:[PURPOSE.DISCOVERY,PURPOSE.IDENTITY,PURPOSE.CORROBORATION],
 product_catalog:[PURPOSE.DISCOVERY,PURPOSE.IDENTITY],
 store_catalog:[PURPOSE.DISCOVERY,PURPOSE.IDENTITY],
 public_market_data:[PURPOSE.DISCOVERY,PURPOSE.CORROBORATION,PURPOSE.BENCHMARK],
 aggregator:[PURPOSE.DISCOVERY,PURPOSE.CORROBORATION],
 price_archive:[PURPOSE.DISCOVERY,PURPOSE.CORROBORATION],
 third_party:[PURPOSE.DISCOVERY,PURPOSE.CORROBORATION],
 b2b_price_data:[PURPOSE.DISCOVERY,PURPOSE.IDENTITY,PURPOSE.CORROBORATION,PURPOSE.CURRENT_PRICE],
 unknown:[PURPOSE.DISCOVERY]
};
const SOURCE_OVERRIDES={
 "REWE daily open dataset":[PURPOSE.DISCOVERY,PURPOSE.IDENTITY,PURPOSE.CORROBORATION],
 "Open Food Facts":[PURPOSE.DISCOVERY,PURPOSE.IDENTITY],
 "Open Prices locations":[PURPOSE.DISCOVERY,PURPOSE.IDENTITY],
 "POIData supermarket locations":[PURPOSE.DISCOVERY,PURPOSE.IDENTITY],
 "GovData BLE produce prices":[PURPOSE.DISCOVERY,PURPOSE.CORROBORATION,PURPOSE.BENCHMARK],
 "German Supermarket Prices":[PURPOSE.DISCOVERY,PURPOSE.IDENTITY,PURPOSE.CORROBORATION],
 "German Supermarket Prices dataset":[PURPOSE.DISCOVERY,PURPOSE.IDENTITY,PURPOSE.CORROBORATION]
};
function registeredName(x={}){for(const v of [x.source,x.sourceId,x.id]){const k=String(v||"").trim();if(k&&Sources.SOURCES[k])return k}return null}
function sourceName(x={}){return registeredName(x)||String(x.source||x.sourceId||x.id||"").trim()}
function sourceType(x={}){const name=sourceName(x),registered=Sources.SOURCES[name];return String(x.sourceType||x.type||registered?.type||"unknown").toLowerCase()}
function policy(x={}){
 const name=sourceName(x),registered=Sources.SOURCES[name]||null,type=sourceType(x),purposes=[...(SOURCE_OVERRIDES[name]||TYPE_PURPOSES[type]||TYPE_PURPOSES.unknown)];
 const approved=registered?Sources.canImport(name):true;
 const currentPrice=purposes.includes(PURPOSE.CURRENT_PRICE)&&approved&&x.truthEligible!==false;
 return{name:name||null,type,registered:!!registered,approved,purposes,currentPrice,discovery:purposes.includes(PURPOSE.DISCOVERY),identity:purposes.includes(PURPOSE.IDENTITY),corroboration:purposes.includes(PURPOSE.CORROBORATION),benchmark:purposes.includes(PURPOSE.BENCHMARK)};
}
function truthEligible(x={}){return policy(x).currentPrice}
function allowedFor(x={},purpose){const p=policy(x);return purpose===PURPOSE.CURRENT_PRICE?p.currentPrice:p.purposes.includes(purpose)}
function primaryPurpose(x={}){const p=policy(x);if(p.currentPrice)return PURPOSE.CURRENT_PRICE;if(p.corroboration)return PURPOSE.CORROBORATION;if(p.identity)return PURPOSE.IDENTITY;if(p.discovery)return PURPOSE.DISCOVERY;if(p.benchmark)return PURPOSE.BENCHMARK;return"none"}
function status(){return Object.entries(Sources.SOURCES).map(([name,s])=>({name,...policy({source:name,sourceType:s.type}),active:!!s.active,commercialUseStatus:s.commercialUseStatus||null}))}
module.exports={PURPOSE,TYPE_PURPOSES,SOURCE_OVERRIDES,registeredName,sourceName,sourceType,policy,truthEligible,allowedFor,primaryPurpose,status};
