"use strict";
const Query=require("./current-price-query-service"),Benchmark=require("./current-price-benchmark");
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plain=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
function invalid(errors){return{ok:false,statusCode:400,error:"invalid-benchmark",errors:[...new Set(errors)]};}
function prepare(input={}){
 if(!plain(input))return invalid(["invalid-body"]);
 const products=input.products===undefined?Benchmark.DEFAULT_PRODUCTS:input.products,merchants=input.merchants===undefined?Benchmark.DEFAULT_MERCHANTS:input.merchants;
 if(!Array.isArray(products)||!products.length||products.length>40)return invalid(["invalid-products"]);
 if(!Array.isArray(merchants)||!merchants.length||merchants.length>20)return invalid(["invalid-merchants"]);
 const region=input.region===undefined?"Berlin":input.region;
 if(typeof region!=="string"||!region.trim()||region.length>120)return invalid(["invalid-region"]);
 for(const [field,max] of [["today",10],["storeId",80]])if(input[field]!==undefined&&input[field]!==null&&(typeof input[field]!=="string"||input[field].length>max))return invalid(["invalid-"+field]);
 if(input.maxAgeDays!==undefined&&input.maxAgeDays!==null&&!["number","string"].includes(typeof input.maxAgeDays))return invalid(["invalid-max-age"]);
 const common={merchants,today:input.today,region:region.trim(),maxAgeDays:input.maxAgeDays,storeId:input.storeId,storeIds:input.storeIds,eligibility:input.eligibility},items=[],requests=[],errors=[];
 for(let index=0;index<products.length;index++){
  const raw=products[index],descriptor=typeof raw==="string"?{product:raw}:raw;
  if(!plain(descriptor)){errors.push("invalid-product:"+index);continue;}
  for(const [field,max] of [["product",200],["name",200],["productId",80],["gtin",32],["brand",120],["pack",100]])if(descriptor[field]!==undefined&&(typeof descriptor[field]!=="string"||descriptor[field].length>max))errors.push("invalid-"+field+":"+index);
  if(descriptor.quantity!==undefined&&(!["number","string"].includes(typeof descriptor.quantity)||descriptor.quantity===""))errors.push("invalid-quantity:"+index);
  const checked=Query.validateRequest({...common,product:descriptor.product||descriptor.name,productId:descriptor.productId,gtin:descriptor.gtin,brand:descriptor.brand,pack:descriptor.pack,quantity:descriptor.quantity});
  if(!checked.ok){errors.push(...checked.errors.map(error=>error+":"+index));continue;}
  const v=checked.value,request={product:v.product,productId:v.productId||null,gtin:v.gtin||null,brand:v.brand||null,pack:v.pack||null,quantity:v.quantity,merchants:v.merchants,today:v.today,region:v.region,maxAgeDays:v.maxAgeDays,storeId:v.storeId||null,storeIds:Object.fromEntries(v.storeIds),eligibility:v.eligibility};
  items.push({key:String(index),product:v.product||v.gtin||v.productId,gtin:request.gtin,productId:request.productId,brand:request.brand,pack:request.pack,quantity:v.quantity});requests.push(request);
 }
 if(errors.length)return invalid(errors);
 const first=requests[0];
 return{ok:true,items,requests,today:first.today,region:first.region,merchants:first.merchants,maxAgeDays:first.maxAgeDays,eligibility:first.eligibility};
}
async function compare(pool,input={},query=Query){
 const prepared=prepare(input);if(!prepared.ok)return prepared;
 if(!pool||typeof pool.query!=="function")throw Object.assign(new Error("database-required"),{code:"database-required"});
 const entries=[];
 for(let index=0;index<prepared.requests.length;index++){
  const result=await query.compareCurrentPrices(pool,prepared.requests[index],{includeRefreshTargets:false});
  if(!result.ok)return result;
  entries.push(...result.results.map(row=>({...row,product:prepared.items[index].product,benchmarkKey:prepared.items[index].key,query:result.query})));
 }
 const storeIds=[...new Set(entries.map(row=>row.storeId).filter(id=>typeof id==="string"&&UUID.test(id)))],stores=new Map();
 if(storeIds.length){
  const found=await pool.query('SELECT s.id,s.country,s.city,s.region,s.active,m.name AS merchant,m.active AS "merchantActive" FROM stores s JOIN merchants m ON m.id=s.merchant_id WHERE s.id=ANY($1::uuid[]) AND s.active=true AND m.active=true',[storeIds]);
  for(const store of found.rows)stores.set(store.id.toLowerCase(),store);
 }
 for(const entry of entries)entry.canonicalStore=stores.get(String(entry.storeId||"").toLowerCase())||null;
 const matrix=Benchmark.matrix(entries,prepared.items,prepared.merchants,{today:prepared.today,region:prepared.region,maxAgeDays:prepared.maxAgeDays,eligibility:prepared.eligibility});
 return{ok:true,today:prepared.today,region:prepared.region,maxAgeDays:prepared.maxAgeDays,scopeCountry:"DE",scopeChannel:"physical-store",coverageBasis:"exact-product-pack-store-evidence",payableBasketVerified:false,items:prepared.items,
  summary:{products:matrix.products,merchants:matrix.merchants,totalCells:matrix.totalCells,knownCells:matrix.knownCells,supportedCells:matrix.supportedCells,verifiedCells:matrix.verifiedCells,currentCoverage:matrix.currentCoverage,verifiedCoverage:matrix.verifiedCoverage},byProduct:Benchmark.productSummary(matrix),byMerchant:Benchmark.merchantSummary(matrix),missing:matrix.missing,
  note:"Coverage counts recent eligible exact product and pack evidence for a canonical physical store. Category references and published delivery, online or pickup quotes do not cover a cell. Complete payable baskets also require consistent selected stores, deposits and all positions."};
}
module.exports={prepare,compare};
