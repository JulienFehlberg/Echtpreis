"use strict";
const assert=require("assert/strict"),P=require("../providers/open-prices"),Query=require("../current-price-query-service"),Resolver=require("../current-price-resolver");
const raw={id:77,price:3.99,currency:"EUR",date:"2026-09-30",price_is_discounted:true,price_without_discount:4.99,proof_id:8,product:{code:"3017620422003",product_name:"Nutella",brands:"Ferrero",quantity:"450 g"},location:{id:12,name:"EDEKA",city:"Berlin",country:"Deutschland"}};
const m=P.mapPrice(raw);assert.equal(m.merchant,"EDEKA");assert.equal(m.gtin,"3017620422003");assert.equal(m.priceType,"promotion");assert.equal(m.regularPrice,4.99);assert.equal(m.storeId,null);assert.equal(m.externalLocationId,"openprices:12");
function accepted(row){const result=P.adapt({items:[row]},{fetchedAt:"2026-09-30T08:00:00Z"});assert.equal(result.rejected.length,0,JSON.stringify(result.rejected));assert.equal(result.accepted.length,1);return result.accepted[0]}
function rejected(row,reason){const result=P.adapt({items:[row]},{fetchedAt:"2026-09-30T08:00:00Z"});assert.equal(result.accepted.length,0,JSON.stringify(result));assert(result.rejected[0].reasons.includes(reason),JSON.stringify(result));assert.equal(result.rejected[0].raw,row)}
const x=accepted(raw);assert.equal(x.sourceType,"open_data");assert.equal(x.sourceId,"Open Prices");assert.equal(x.per,"item");assert.equal(x.truthEligible,true);
const actual={...raw,type:"PRODUCT",product_code:raw.product.code,location_id:12,price_per:null,price_is_discounted:false,price_without_discount:null,discount_type:null,duplicate_of:null,location:{id:12,type:"OSM",osm_id:99,osm_type:"NODE",osm_brand:"EDEKA",osm_address_city:"Berlin",osm_address_country:"Deutschland",osm_address_country_code:"DE",osm_lat:null,osm_lon:null},proof:{id:8,type:"PRICE_TAG",location_id:12,location_osm_id:99,location_osm_type:"NODE",date:raw.date,currency:"EUR",draft:false,image_md5_hash:"real-proof",owner:"observer"}};
let result=accepted(actual);assert.equal(result.per,"item");assert.equal(result.latitude,null);assert.equal(result.longitude,null);assert.equal(result.proofHash,"real-proof");assert.equal(result.priceType,"regular");
assert.equal(accepted({...actual,price_per:"UNIT"}).per,"item");
const kg=accepted({...actual,price:8,price_per:"KILOGRAM",product:{...actual.product,quantity:null,product_quantity:450,product_quantity_unit:"g"}});assert.equal(kg.per,"kg");assert.equal(kg.price,8);assert.equal(kg.pack,"450 g");assert.equal(kg.packAmount,450);assert.equal(kg.packUnit,"g");
const checkout=Query.normalizeObservation({...kg,storeId:"store-12",merchant:"EDEKA"});assert.equal(checkout.price,3.6);assert.equal(checkout.priceBasis,"derived-pack");
const decision=Resolver.resolveMerchant({name:"Nutella",gtin:raw.product.code},"EDEKA",[checkout],{storeId:"store-12",today:raw.date});assert.equal(decision.state,"observed");assert.equal(decision.price,3.6);assert.equal(decision.unitPrice,8);
for(const [amount,unit,packAmount,packUnit]of[[.5,"kg",500,"g"],[1,"l",1000,"ml"],[330,"ml",330,"ml"],[6,"piece",6,"piece"]]){const row=accepted({...actual,product:{...actual.product,quantity:null,product_quantity:amount,product_quantity_unit:unit,brands:null,brands_tags:["en:ferrero"]}});assert.equal(row.packAmount,packAmount);assert.equal(row.packUnit,packUnit);assert.equal(row.brand,"ferrero")}
assert.equal(accepted({...actual,product:{...actual.product,quantity:"6 × 1 l"}}).packAmount,6000);
const multipack=accepted({...actual,price:8,price_per:"KILOGRAM",product:{...actual.product,quantity:"2.0 x 175 g"}});assert.equal(multipack.pack,"2 x 175 g");assert.equal(multipack.packAmount,350);assert.equal(Query.normalizeObservation(multipack).price,2.8);
assert.equal(accepted({...actual,product:{...actual.product,quantity:"2,0 × 175 g"}}).pack,"2 x 175 g");
for(const per of["UNIT","KILOGRAM"])rejected({...actual,price_per:per,product:{...actual.product,quantity:"2.5 x 175 g"}},"invalid-pack-count");
for(const discount of["SALE","SEASONAL"]){const row=accepted({...actual,price_is_discounted:true,discount_type:discount,price_without_discount:4.99});assert.equal(row.priceType,"promotion")}
const loyalty=accepted({...actual,price_is_discounted:true,discount_type:"LOYALTY_PROGRAM"});assert.equal(loyalty.priceType,"loyalty");assert.equal(Resolver.eligible(loyalty,{}).ok,false);assert.equal(Resolver.eligible(loyalty,{eligibility:{loyalty:true}}).ok,true);
const multi=accepted({...actual,price_is_discounted:true,discount_type:"QUANTITY",min_quantity:3});assert.equal(multi.priceType,"multi_buy");assert.equal(multi.minQuantity,3);
rejected({...actual,price_is_discounted:true,discount_type:"QUANTITY",receipt_quantity:3},"min-quantity-required");
rejected({...actual,price_is_discounted:true,discount_type:null},"unknown-discount-type");
for(const discount of["EXPIRES_SOON","PICK_IT_YOURSELF","SECOND_HAND","OTHER","NEW_KIND"])rejected({...actual,price_is_discounted:true,discount_type:discount},"unsupported-discount-type");
rejected({...actual,price_is_discounted:"true",discount_type:"SALE"},"invalid-discount-state");
rejected({...actual,discount_type:"SALE"},"discount-state-mismatch");
rejected({...actual,duplicate_of:76},"duplicate-price");
rejected({...actual,proof:{...actual.proof,draft:true}},"draft-proof");
rejected({...actual,proof:{...actual.proof,location_id:13}},"proof-location-mismatch");
rejected({...actual,proof:{...actual.proof,location_osm_id:100}},"proof-location-mismatch");
rejected({...actual,proof:{...actual.proof,date:"2026-09-29"}},"proof-date-mismatch");
rejected({...actual,proof:{...actual.proof,currency:"CHF"}},"proof-currency-mismatch");
rejected({...actual,proof:{...actual.proof,id:9}},"proof-id-mismatch");
rejected({...actual,proof:null,proof_id:null},"missing-proof");
rejected({...actual,location_id:13},"location-id-mismatch");
rejected({...actual,product_code:"4008400401621"},"product-code-mismatch");
rejected({...actual,product_code:"abc3017620422003",product:{...actual.product,code:"abc3017620422003"}},"invalid-product-code");
rejected({...actual,product_code:null,product:{...actual.product,code:null}},"missing-product-code");
rejected({...actual,date:null,proof:{...actual.proof,date:null}},"invalid-observation-date");
rejected({...actual,date:"2026-02-30",proof:{...actual.proof,date:"2026-02-30"}},"invalid-observation-date");
rejected({...actual,type:"CATEGORY"},"unsupported-product-type");
rejected({...actual,price_per:"LITER"},"unsupported-price-per");
rejected({...actual,price_per:"KILOGRAM",product:{...actual.product,quantity:null}},"kilogram-pack-required");
rejected({...actual,price_per:"KILOGRAM",product:{...actual.product,quantity:"450 g or 1 kg"}},"kilogram-pack-required");
rejected({...actual,location:{...actual.location,type:"ONLINE"}},"unsupported-location-type");
rejected({...actual,location:{...actual.location,osm_brand:null,osm_name:null}},"missing-merchant");
const foreign=accepted({...actual,location:{...actual.location,osm_address_country:"Austria",osm_address_country_code:"AT"}});assert.equal(foreign.truthEligible,false);
assert.equal(Resolver.resolveMerchant({gtin:actual.product.code},"EDEKA",[foreign],{today:raw.date}).state,"unknown");
console.log("open-prices-provider: legacy proof IDs, real price basis, conditional discounts, proof identity and country boundaries OK");
