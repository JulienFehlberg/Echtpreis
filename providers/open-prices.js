"use strict";
const Connector=require("../current-price-connector"),Registry=require("../current-price-connectors");
function mapPrice(p={}){
 const product=p.product||{},location=p.location||{},proof=p.proof||{};
 return{merchant:location.name||location.osm_name||location.brand||"",storeId:null,address:location.address||location.street_address||null,postalCode:location.postcode||location.postal_code||null,city:location.city||null,externalLocationId:location.id?"openprices:"+location.id:null,region:[location.city,location.country].filter(Boolean).join(", ")||null,gtin:product.code||p.product_code||null,product:product.product_name||p.product_name||"",brand:product.brands||"",pack:product.quantity||"",price:p.price,currency:p.currency||"EUR",priceType:p.price_is_discounted?"promotion":"regular",regularPrice:p.price_without_discount||null,observedAt:p.date?p.date+"T12:00:00Z":null,proof:"openprices:proof:"+(p.proof_id||proof.id||"unknown"),proofType:proof.type||"open-data-proof",sourceUrl:p.id?"https://prices.openfoodfacts.org/prices/"+p.id:null};
}
function adapt(payload={},meta={}){
 const rows=Array.isArray(payload)?payload:Array.isArray(payload.results)?payload.results:[];
 return Connector.ingest(Registry.contracts.openPrices,rows.map(mapPrice),{fetchedAt:meta.fetchedAt||new Date().toISOString(),sourceUrl:meta.sourceUrl||"https://prices.openfoodfacts.org/api/v1/prices"});
}
module.exports={mapPrice,adapt};
