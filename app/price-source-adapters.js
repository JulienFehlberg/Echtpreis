(function(){
"use strict";
const E=()=>window.EchtpreisPriceEngine;
function openPrices(item){
 const proof=item.proof||item.proof_id||null,loc=item.location||{};
 return E().normalizeObservation({kind:"openprices",source:"Open Prices",sourceUrl:"https://prices.openfoodfacts.org/",proof:proof?.id||proof,proofType:proof?.type||null,gtin:item.product_code||item.product?.code,product:item.product_name||item.product?.name,key:item.key,store:item.store||loc.osm_name||loc.name,locationId:loc.id||item.location_id,lat:loc.lat??item.lat,lon:loc.lon??item.lon,price:item.price,currency:item.currency||"EUR",per:item.price_per||item.per||"piece",date:item.date,priceType:item.price_type||"regular",trust:78,rawRef:item.id||null});
}
function retailerOffer(item,meta={}){
 return E().normalizeObservation({kind:"official",source:meta.source||item.retailer||item.store,sourceUrl:item.sourceUrl||meta.sourceUrl,proof:item.offerId||item.id||item.sourceUrl,proofType:"shop_import",gtin:item.gtin||item.ean,product:item.product||item.name,key:item.key,store:item.store||item.retailer||meta.store,locationId:item.marketId||meta.marketId,region:item.region||meta.region,price:item.price,regularPrice:item.regularPrice,currency:item.currency||"EUR",per:item.per||"piece",quantity:item.quantity,unit:item.unit,date:item.date||meta.date,validFrom:item.validFrom,validTo:item.validTo,priceType:item.priceType||"promotion",trust:96,rawRef:item.id||null});
}
function receipt(item,receiptMeta={}){
 return E().normalizeObservation({kind:"receipt",source:"ECHTPREIS receipt",proof:receiptMeta.receiptId||receiptMeta.proof,proofType:"receipt",gtin:item.gtin||item.ean,product:item.product||item.name,key:item.key,store:receiptMeta.store,locationId:receiptMeta.locationId,region:receiptMeta.region,lat:receiptMeta.lat,lon:receiptMeta.lon,price:item.price,currency:receiptMeta.currency||"EUR",per:item.per||"piece",quantity:item.quantity,unit:item.unit,date:receiptMeta.date,observedAt:receiptMeta.observedAt,priceType:item.priceType||"regular",trust:item.matchConfidence?Math.round(70+Math.min(1,item.matchConfidence)*22):86,rawRef:item.lineId||null});
}
window.EchtpreisSourceAdapters={openPrices,retailerOffer,receipt};
})();