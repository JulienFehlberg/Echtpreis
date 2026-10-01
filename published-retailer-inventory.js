"use strict";
const Dm=require("./published-price-service"),Wolt=require("./wolt-retailer-price-service"),Rewe=require("./rewe-retailer-price-service");
const deps={dm:Dm,wolt:Wolt,rewe:Rewe};
const ledgers=[{key:"dm",table:"retailer_published_prices",channel:"online"},{key:"wolt",table:"wolt_retailer_published_prices",channel:"online"},{key:"rewe",table:"rewe_retailer_published_prices",channel:"pickup"}];
function scope(channels){const scopeChannels=[...new Set(channels)].sort();return{scopeChannels,scopeChannel:scopeChannels.length===1?scopeChannels[0]:scopeChannels.length?"mixed":"unknown"};}
async function search(pool,options={},services=deps){
 const requested=Number(options.limit??50),limit=Number.isFinite(requested)?Math.max(1,Math.min(200,Math.floor(requested))):50;
 const results=await Promise.all(ledgers.filter(x=>services[x.key]).map(x=>services[x.key].search(pool,{...options,limit})));
 const items=results.flatMap(x=>x.items).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt)||String(a.sourceId).localeCompare(String(b.sourceId))||String(a.nativeMarketId||a.nativeVenueId||"").localeCompare(String(b.nativeMarketId||b.nativeVenueId||""))||String(a.retailerSku).localeCompare(String(b.retailerSku))).slice(0,limit);
 return{items,scopeCountry:"DE",...scope(items.map(x=>x.scopeChannel)),maxAgeHours:24,physicalStorePrices:false};
}
async function status(pool,options={},services=deps){
 const time=options.now===undefined?Date.now():new Date(options.now).getTime();
 if(!Number.isFinite(time))throw Object.assign(new Error("invalid-time"),{code:"invalid-time"});
 const selected=ledgers.filter(x=>services[x.key]),results=await Promise.all(selected.map(x=>services[x.key].status(pool,options))),byKey=Object.fromEntries(selected.map((x,i)=>[x.key,results[i]])),{dm,wolt,rewe}=byKey;
 // A GTIN can occur in several ledgers. Never sum per-source distinct products as a union.
 const unions=selected.map(x=>`SELECT gtin FROM ${x.table} WHERE captured_at<=$1::timestamptz AND captured_at>=$1::timestamptz-interval '24 hours' AND expires_at>$1::timestamptz`).join(" UNION ");
 const unique=await pool.query(`SELECT count(DISTINCT gtin)::int AS "productsWithCurrentPublishedPrices" FROM (${unions}) p`,[new Date(time).toISOString()]);
 const captures=results.map(x=>x.lastCapturedAt).filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a)),sum=field=>results.reduce((total,x)=>total+Number(x[field]||0),0);
 return{ok:true,storedPrices:sum("storedPrices"),currentPrices:sum("currentPrices"),productsWithCurrentPublishedPrices:Number(unique.rows[0].productsWithCurrentPublishedPrices),availableCurrentPrices:sum("availableCurrentPrices"),lastCapturedAt:captures[0]||null,merchants:results.flatMap(x=>x.markets||x.merchants||[]),retailers:{...(dm?{dm}:{}),...(wolt?{woltEdekaBerlin:wolt}:{}),...(rewe?{reweBerlinPickup:rewe}:{})},scopeCountry:"DE",...scope(selected.filter((x,i)=>Number(results[i].currentPrices)>0).map(x=>x.channel)),maxAgeHours:24,state:"published",note:"Veröffentlichte Liefer-, Online- und Abholpreise mit Quellen, Marktbezug und eigener Abrufzeit. Filialpreise und zusätzliche Gebühren bleiben getrennt."};
}
function matchesRequestedProductQuery(offer,query={},request={}){
 // Exact GTIN/pack prove identity. A catalog-filled brand is not an extra caller constraint.
 return Dm.matchesProductQuery(offer,{...query,brand:request.brand||null});
}
module.exports={search,status,matchesProductQuery:Dm.matchesProductQuery,matchesRequestedProductQuery};
