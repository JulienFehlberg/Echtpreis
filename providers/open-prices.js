"use strict";
const Connector=require("../current-price-connector"),Registry=require("../current-price-connectors"),Units=require("../unit-price");
const DISCOUNTS={SALE:"promotion",SEASONAL:"promotion",LOYALTY_PROGRAM:"loyalty",QUANTITY:"multi_buy"};
function positiveId(value){return Number.isSafeInteger(Number(value))&&Number(value)>0?String(value):null}
function day(value){const s=String(value??"");if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const t=Date.parse(s+"T00:00:00Z");return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?s:null}
function coordinate(value,max){if(value==null||value==="")return null;const n=Number(value);return Number.isFinite(n)&&Math.abs(n)<=max?n:null}
function brand(product){if(typeof product.brands==="string"&&product.brands.trim())return product.brands.trim();return Array.isArray(product.brands_tags)?[...new Set(product.brands_tags.filter(x=>typeof x==="string").slice(0,5).map(x=>x.replace(/^[a-z]{2}:/i,"").replace(/[-_]+/g," ").trim()).filter(Boolean))].join(", "):""}
function normalizePack(value){const raw=String(value).trim(),match=raw.toLowerCase().replace(/×/g,"x").replace(/,/g,".").match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l|piece|pieces|stk|stuck|stück)$/);if(!match)return raw;const count=Number(match[1]),amount=Number(match[2]);return Number.isSafeInteger(count)&&count>=1&&Number.isFinite(amount)&&amount>0?count+" x "+amount+" "+match[3]:raw}
function pack(product){if(typeof product.quantity==="string"&&product.quantity.trim())return normalizePack(product.quantity);const amount=Number(product.product_quantity),unit=String(product.product_quantity_unit||"").toLowerCase(),mapped={kg:"kg",g:"g",l:"l",ml:"ml",cl:"cl",piece:"piece",pieces:"piece",unit:"piece",units:"piece",stk:"piece",stuck:"piece","stück":"piece"}[unit];return Number.isFinite(amount)&&amount>0&&mapped?amount+" "+mapped:""}
function parsedPack(value){const s=String(value).trim().toLowerCase().replace(/×/g,"x").replace(/,/g,"."),match=s.match(/^(?:(\d+(?:\.\d+)?)\s*x\s*)?(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l|piece|pieces|stk|stuck|stück)$/);if(!match)return null;const count=Number(match[1]||1),amount=Number(match[2]),unit=/^(pieces?|stk|stuck|stück)$/.test(match[3])?"stk":match[3];if(!Number.isSafeInteger(count)||count<1||!Number.isFinite(amount)||amount<=0)return null;const parsed=Units.normalize(count*amount,unit);return Number.isFinite(parsed.amount)&&parsed.amount>0?parsed:null}
function country(location){const code=String(location.osm_address_country_code||"").trim().toUpperCase();if(code)return code;const name=String(location.osm_address_country||location.country||"").trim().toLowerCase();return["de","deutschland","germany","allemagne"].includes(name)?"DE":name?"OTHER":null}
function mapPrice(p={}){
 const product=p.product||{},location=p.location||{},proof=p.proof||{},code=product.code||p.product_code||null,quantity=pack(product),parsed=parsedPack(quantity);
 const city=location.osm_address_city||location.city||null,countryName=location.osm_address_country||location.country||null;
 const discount=String(p.discount_type||"").toUpperCase(),legacy=p.type==null,priceType=p.price_is_discounted===true?(DISCOUNTS[discount]||(legacy&&!discount?"promotion":"unsupported")):"regular";
 return{merchant:location.osm_brand||location.osm_name||location.name||location.brand||"",storeId:null,
 address:location.osm_display_name||location.address||location.street_address||null,
 postalCode:location.osm_address_postcode||location.postcode||location.postal_code||null,city,
 latitude:coordinate(location.osm_lat??location.lat,90),longitude:coordinate(location.osm_lon??location.lon,180),
 externalLocationId:positiveId(location.id||p.location_id)?"openprices:"+positiveId(location.id||p.location_id):null,region:[city,countryName].filter(Boolean).join(", ")||null,
 gtin:code,externalProductId:code?("openprices:"+code):null,product:product.product_name||p.product_name||"",brand:brand(product),pack:quantity,
 price:p.price,per:p.price_per==="KILOGRAM"?"kg":"item",packAmount:parsed?.amount||null,packUnit:parsed?.unit||null,currency:p.currency||proof.currency||null,priceType,regularPrice:p.price_without_discount||null,minQuantity:p.minQuantity??p.min_quantity??null,
 observedAt:day(p.date)?p.date+"T12:00:00Z":null,proof:positiveId(p.proof_id||proof.id)?"openprices:proof:"+positiveId(p.proof_id||proof.id):null,proofType:proof.type||"open-data-proof",
 proofHash:proof.image_md5_hash||null,proofActor:p.owner||proof.owner||null,providerSource:p.source||proof.source||null,
 sourceUrl:positiveId(p.id)?"https://prices.openfoodfacts.org/prices/"+positiveId(p.id):null};
}
function validateRaw(p,mapped){
 const errors=[],product=p.product||{},location=p.location||{},proof=p.proof||{},real=p.type!=null;
 if(real&&p.type!=="PRODUCT")errors.push("unsupported-product-type");
 if(p.duplicate_of!=null)errors.push("duplicate-price");
 if(proof.draft===true)errors.push("draft-proof");
 if(proof.draft!=null&&typeof proof.draft!=="boolean")errors.push("invalid-proof-state");
 if(proof.type!=null&&!["PRICE_TAG","RECEIPT","SHOP_IMPORT","GDPR_REQUEST"].includes(proof.type))errors.push("unsupported-proof-type");
 if(!mapped.proof)errors.push("missing-proof");
 if(p.proof_id!=null&&proof.id!=null&&String(p.proof_id)!==String(proof.id))errors.push("proof-id-mismatch");
 if(!mapped.externalLocationId)errors.push("missing-location");
 if(!mapped.merchant)errors.push("missing-merchant");
 if(p.location_id!=null&&location.id!=null&&String(p.location_id)!==String(location.id))errors.push("location-id-mismatch");
 const locationId=positiveId(location.id||p.location_id);
 if(proof.location_id!=null&&String(proof.location_id)!==locationId)errors.push("proof-location-mismatch");
 for(const key of ["osm_id","osm_type"]){const locationValue=location[key]??p["location_"+key],proofValue=proof["location_"+key];if(proofValue!=null&&locationValue!=null&&String(proofValue)!==String(locationValue))errors.push("proof-location-mismatch")}
 if(location.type!=null&&location.type!=="OSM")errors.push("unsupported-location-type");
 if(real&&!country(location))errors.push("missing-country");
 if(!mapped.observedAt)errors.push("invalid-observation-date");
 if(proof.date!=null&&(!day(proof.date)||proof.date!==p.date))errors.push("proof-date-mismatch");
 if(!mapped.currency||!/^[A-Z]{3}$/.test(String(mapped.currency)))errors.push("invalid-currency");
 if(proof.currency!=null&&proof.currency!==mapped.currency)errors.push("proof-currency-mismatch");
 if(product.code!=null&&p.product_code!=null&&String(product.code)!==String(p.product_code))errors.push("product-code-mismatch");
 if(mapped.gtin!=null&&!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(String(mapped.gtin)))errors.push("invalid-product-code");
 if(real&&!mapped.gtin)errors.push("missing-product-code");
 if(p.price_per!=null&&p.price_per!=="UNIT"&&p.price_per!=="KILOGRAM")errors.push("unsupported-price-per");
 const packCount=String(mapped.pack||"").replace(/,/g,".").match(/^(\d+(?:\.\d+)?)\s*[x×]/i);if(packCount&&(!Number.isSafeInteger(Number(packCount[1]))||Number(packCount[1])<1))errors.push("invalid-pack-count");
 if(p.price_per==="KILOGRAM"&&(!mapped.packAmount||mapped.packUnit!=="g"))errors.push("kilogram-pack-required");
 if(p.price_is_discounted!=null&&typeof p.price_is_discounted!=="boolean")errors.push("invalid-discount-state");
 const discount=String(p.discount_type||"").toUpperCase();
 if(discount&&p.price_is_discounted!==true)errors.push("discount-state-mismatch");
 if(p.price_is_discounted===true&&!DISCOUNTS[discount]&&!(p.type==null&&!discount))errors.push(discount?"unsupported-discount-type":"unknown-discount-type");
 if(mapped.priceType==="multi_buy"&&!(Number.isSafeInteger(Number(mapped.minQuantity))&&Number(mapped.minQuantity)>=2))errors.push("min-quantity-required");
 return[...new Set(errors)];
}
function adapt(payload={},meta={}){
 const rows=Array.isArray(payload)?payload:Array.isArray(payload.items)?payload.items:Array.isArray(payload.results)?payload.results:[],accepted=[],rejected=[];
 const fetchMeta={fetchedAt:meta.fetchedAt||new Date().toISOString(),sourceUrl:meta.sourceUrl||"https://prices.openfoodfacts.org/api/v1/prices"};
 for(const raw of rows){
  if(!raw||typeof raw!=="object"||Array.isArray(raw)){rejected.push({raw,reasons:["invalid-price-row"]});continue}
  const mapped=mapPrice(raw),reasons=validateRaw(raw,mapped);
  if(reasons.length){rejected.push({raw,reasons});continue}
  const result=Connector.ingest(Registry.contracts.openPrices,[mapped],fetchMeta);
  if(result.rejected.length){rejected.push({raw,reasons:result.rejected[0].reasons});continue}
  // These fields describe the upstream price basis; Connector's common contract omits them.
  accepted.push({...result.accepted[0],per:mapped.per,packAmount:mapped.packAmount,packUnit:mapped.packUnit,latitude:mapped.latitude,longitude:mapped.longitude,truthEligible:country(raw.location||{})==="DE"&&result.accepted[0].truthEligible});
 }
 return{accepted,rejected};
}
module.exports={mapPrice,adapt,validateRaw,DISCOUNTS};
