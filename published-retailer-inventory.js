"use strict";
const Dm=require("./published-price-service"),Wolt=require("./wolt-retailer-price-service"),Rewe=require("./rewe-retailer-price-service"),Aldi=require("./aldi-assortment-price-service");
const Nahkauf=Wolt.createService("nahkaufWrangelBerlin"),deps={dm:Dm,wolt:Wolt,woltNahkauf:Nahkauf,rewe:Rewe,aldi:Aldi};
const Filters=require("./retailer-product-search-filters");
const SalesPack=require("./wolt-sales-pack-validation");
const ledgers=[{key:"dm",table:"retailer_published_prices",channel:"online",sourceId:"dm online"},{key:"wolt",table:"wolt_retailer_published_prices",channel:"online",sourceId:Wolt.SOURCE},{key:"woltNahkauf",table:"wolt_retailer_published_prices",channel:"online",sourceId:Nahkauf.SOURCE},{key:"rewe",table:"rewe_retailer_published_prices",channel:"pickup",sourceId:Rewe.SOURCE},{key:"aldi",table:"aldi_assortment_published_prices",channel:"assortment-publication",sourceId:Aldi.SOURCE}];
function scope(channels){const scopeChannels=[...new Set(channels)].sort();return{scopeChannels,scopeChannel:scopeChannels.length===1?scopeChannels[0]:scopeChannels.length?"mixed":"unknown"};}
async function search(pool,options={},services=deps){
 if(options.priorityRetailersOnly!==undefined&&typeof options.priorityRetailersOnly!=="boolean")throw Object.assign(new Error("invalid-retailer-priority-filter"),{code:"invalid-retailer-priority-filter"});
 const requested=Number(options.limit??50),limit=Number.isFinite(requested)?Math.max(1,Math.min(200,Math.floor(requested))):50;
 const channel=Filters.channel(options.scopeChannel);Filters.salesPack(options.pack);
 const results=await Promise.all(ledgers.filter(x=>services[x.key]&&(!options.priorityRetailersOnly||["wolt","rewe"].includes(x.key))&&(!channel||x.channel===channel)).map(x=>services[x.key].search(pool,{...options,limit})));
 const items=results.flatMap(x=>x.items).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt)||String(a.sourceId).localeCompare(String(b.sourceId))||String(a.nativeMarketId||a.nativeVenueId||"").localeCompare(String(b.nativeMarketId||b.nativeVenueId||""))||String(a.retailerSku).localeCompare(String(b.retailerSku))).slice(0,limit);
 return{items,scopeCountry:"DE",...scope(items.map(x=>x.scopeChannel)),maxAgeHours:24,physicalStorePrices:false};
}
async function status(pool,options={},services=deps){
 const time=options.now===undefined?Date.now():new Date(options.now).getTime();
 if(!Number.isFinite(time))throw Object.assign(new Error("invalid-time"),{code:"invalid-time"});
 const selected=ledgers.filter(x=>services[x.key]),results=await Promise.all(selected.map(x=>services[x.key].status(pool,options))),byKey=Object.fromEntries(selected.map((x,i)=>[x.key,results[i]])),{dm,wolt,rewe}=byKey;
 // A GTIN can occur in several ledgers. Never sum per-source distinct products as a union.
 const unions=selected.map(x=>`SELECT gtin FROM ${x.table} WHERE source_id='${x.sourceId.replace(/'/g,"''")}'${x.table===Wolt.TABLE?" AND validation_issue IS NULL AND NOT ("+SalesPack.SQL_CONFLICT+") AND NOT ("+SalesPack.SQL_STRUCTURE_UNRESOLVED+")":""} AND captured_at<=$1::timestamptz AND captured_at>=$1::timestamptz-interval '24 hours' AND expires_at>$1::timestamptz`).join(" UNION ");
 const unique=await pool.query(`SELECT count(DISTINCT gtin)::int AS "productsWithCurrentPublishedPrices" FROM (${unions}) p`,[new Date(time).toISOString()]);
 const captures=results.map(x=>x.lastCapturedAt).filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a)),sum=field=>results.reduce((total,x)=>total+Number(x[field]||0),0);
 return{ok:true,storedPrices:sum("storedPrices"),currentPrices:sum("currentPrices"),productsWithCurrentPublishedPrices:Number(unique.rows[0].productsWithCurrentPublishedPrices),availableCurrentPrices:sum("availableCurrentPrices"),lastCapturedAt:captures[0]||null,merchants:results.flatMap(x=>x.markets||x.merchants||[]),retailers:{...(dm?{dm}:{}),...(wolt?{woltEdekaBerlin:wolt}:{}),...(byKey.woltNahkauf?{woltNahkaufWrangelBerlin:byKey.woltNahkauf}:{}),...(rewe?{reweBerlinPickup:rewe}:{}),...(byKey.aldi?{aldiNordAssortment:byKey.aldi}:{})},scopeCountry:"DE",...scope(selected.filter((x,i)=>Number(results[i].currentPrices)>0).map(x=>x.channel)),maxAgeHours:24,state:"published",note:"Veröffentlichte Liefer-, Online-, Abhol- und Sortimentspreise mit Quellen, belegtem Standortumfang und eigener Abrufzeit. Filialpreise und zusätzliche Gebühren bleiben getrennt."};
}
function matchesRequestedProductQuery(offer,query={},request={}){
 // Exact GTIN/pack prove identity. A catalog-filled brand is not an extra caller constraint.
 return Dm.matchesProductQuery(offer,{...query,brand:request.brand||null});
}
module.exports={search,status,matchesProductQuery:Dm.matchesProductQuery,matchesRequestedProductQuery};
