"use strict";
const Dm=require("./published-price-service"),Wolt=require("./wolt-retailer-price-service");
const deps={dm:Dm,wolt:Wolt};
async function search(pool,options={},services=deps){
 const requested=Number(options.limit??50),limit=Number.isFinite(requested)?Math.max(1,Math.min(200,Math.floor(requested))):50;
 const results=await Promise.all([services.dm.search(pool,{...options,limit}),services.wolt.search(pool,{...options,limit})]);
 const items=results.flatMap(x=>x.items).sort((a,b)=>Date.parse(b.capturedAt)-Date.parse(a.capturedAt)||String(a.sourceId).localeCompare(String(b.sourceId))||String(a.nativeVenueId||"").localeCompare(String(b.nativeVenueId||""))||String(a.retailerSku).localeCompare(String(b.retailerSku))).slice(0,limit);
 return{items,scopeCountry:"DE",scopeChannel:"online",maxAgeHours:24,physicalStorePrices:false};
}
async function status(pool,options={},services=deps){
 const time=options.now===undefined?Date.now():new Date(options.now).getTime();
 if(!Number.isFinite(time))throw Object.assign(new Error("invalid-time"),{code:"invalid-time"});
 const [dm,wolt]=await Promise.all([services.dm.status(pool,options),services.wolt.status(pool,options)]);
 // A GTIN can occur in both ledgers. Never sum per-source distinct products as a union.
 const unique=await pool.query(`SELECT count(DISTINCT gtin)::int AS "productsWithCurrentPublishedPrices" FROM (SELECT gtin FROM retailer_published_prices WHERE captured_at<=$1::timestamptz AND captured_at>=$1::timestamptz-interval '24 hours' AND expires_at>$1::timestamptz UNION SELECT gtin FROM wolt_retailer_published_prices WHERE captured_at<=$1::timestamptz AND captured_at>=$1::timestamptz-interval '24 hours' AND expires_at>$1::timestamptz) p`,[new Date(time).toISOString()]);
 const captures=[dm.lastCapturedAt,wolt.lastCapturedAt].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a));
 return{ok:true,storedPrices:Number(dm.storedPrices)+Number(wolt.storedPrices),currentPrices:Number(dm.currentPrices)+Number(wolt.currentPrices),productsWithCurrentPublishedPrices:Number(unique.rows[0].productsWithCurrentPublishedPrices),availableCurrentPrices:Number(dm.availableCurrentPrices)+Number(wolt.availableCurrentPrices),lastCapturedAt:captures[0]||null,merchants:[...(dm.merchants||[]),...(wolt.markets||[])],retailers:{dm,woltEdekaBerlin:wolt},scopeCountry:"DE",scopeChannel:"online",maxAgeHours:24,state:"published",note:"Veröffentlichte Onlinepreise mit Quellen, Marktbezug und eigener Abrufzeit. Filialpreise und Lieferkosten bleiben getrennt."};
}
module.exports={search,status,matchesProductQuery:Dm.matchesProductQuery};
