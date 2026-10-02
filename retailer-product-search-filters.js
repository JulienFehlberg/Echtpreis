"use strict";
const Discovery=require("./price-query-discovery");
const fail=code=>Object.assign(new Error(code),{code});
function salesPack(value){
 if(value===undefined)return null;
 if(typeof value!=="string"||!value.trim()||value.trim().length>80)throw fail("invalid-product-pack");
 const parsed=Discovery.pack(value);if(!parsed||parsed.count>1000)throw fail("invalid-product-pack");return parsed;
}
function channel(value){
 if(value===undefined)return null;
 if(!["physical-store","online","pickup","assortment-publication","retailer-price-publication"].includes(value))throw fail("invalid-scope-channel");return value;
}
function sqlPack(value,param,prefix=""){
 const parsed=salesPack(value);if(!parsed)return null;
 if(prefix&&!/^[a-z][a-z0-9_]*$/.test(prefix))throw fail("invalid-pack-column-prefix");
 const column=prefix?prefix+".":"",amount=param(parsed.amount);
 // Match the same narrow arithmetic tolerance as Discovery.samePack after unit conversion.
 return "abs("+column+"pack_amount-"+amount+")<=GREATEST("+column+"pack_amount,"+amount+"::numeric)*0.000000001 AND "+column+"pack_unit="+param(parsed.unit)+" AND "+column+"pack_count="+param(parsed.count);
}
function matchesPack(offer,requested){return !requested||Discovery.samePack(requested,Discovery.productPack(offer));}
module.exports={salesPack,channel,sqlPack,matchesPack};
