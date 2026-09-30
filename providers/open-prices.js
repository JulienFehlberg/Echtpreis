"use strict";
const Connector=require("../current-price-connector"),Registry=require("../current-price-connectors");
function mapPrice(p={}){
 const product=p.product||{},location=p.location||{},proof=p.proof||{},code=product.code||p.product_code||null;
 const city=location.osm_address_city||location.city||null,country=location.osm_address_country||location.country||null;
 return{merchant:location.osm_brand||location.osm_name||location.name||location.brand||"",storeId:null,
 address:location.osm_display_name||location.address||location.street_address||null,
 postalCode:location.osm_address_postcode||location.postcode||location.postal_code||null,city,
 latitude:Number.isFinite(Number(location.osm_lat))?Number(location.osm_lat):null,longitude:Number.isFinite(Number(location.osm_lon))?Number(location.osm_lon):null,
 externalLocationId:location.id?"openprices:"+location.id:null,region:[city,country].filter(Boolean).join(", ")||null,
 gtin:code,externalProductId:code?("openprices:"+code):null,product:product.product_name||p.product_name||"",brand:product.brands||"",pack:product.quantity||"",
 price:p.price,currency:p.currency||"EUR",priceType:p.price_is_discounted?"promotion":"regular",regularPrice:p.price_without_discount||null,
 observedAt:p.date?p.date+"T12:00:00Z":null,proof:"openprices:proof:"+(p.proof_id||proof.id||"unknown"),proofType:proof.type||"open-data-proof",
 proofHash:proof.image_md5_hash||null,proofActor:p.owner||proof.owner||null,providerSource:p.source||proof.source||null,
 sourceUrl:p.id?"https://prices.openfoodfacts.org/prices/"+p.id:null};
}
function adapt(payload={},meta={}){
 const rows=Array.isArray(payload)?payload:Array.isArray(payload.items)?payload.items:Array.isArray(payload.results)?payload.results:[];
 return Connector.ingest(Registry.contracts.openPrices,rows.map(mapPrice),{fetchedAt:meta.fetchedAt||new Date().toISOString(),sourceUrl:meta.sourceUrl||"https://prices.openfoodfacts.org/api/v1/prices"});
}
module.exports={mapPrice,adapt};
