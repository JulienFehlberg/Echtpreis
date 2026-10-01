"use strict";

const CurrentPrice=require("./current-price-resolver");
const Coverage=require("./current-price-coverage");
const Discovery=require("./price-query-discovery");
const Identity=require("./product-identity");
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text=(value,size=200)=>String(value??"").trim().slice(0,size);
const plain=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const key=value=>Identity.norm(value);
const literalLike=value=>String(value).replace(/[\\%_]/g,"\\$&");
function today(date=new Date()){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date),values=Object.fromEntries(parts.map(part=>[part.type,part.value]));return values.year+"-"+values.month+"-"+values.day}
function validateRequest(input={}){
 const errors=[];
 if(!plain(input))return{ok:false,errors:["invalid-body"]};
 const product=text(input.product||input.name),productId=text(input.productId,80).toLowerCase(),gtin=text(input.gtin,32),brand=text(input.brand,120),pack=text(input.pack||input.packageSize,100);
 if(!product&&!productId&&!gtin)errors.push("product-query-required");
 if(productId&&!UUID.test(productId))errors.push("invalid-product-id");
 if(gtin&&!Discovery.validGtin(gtin))errors.push("invalid-gtin");
 if(pack&&!Discovery.pack(pack))errors.push("invalid-pack");
 if(!Array.isArray(input.merchants)||!input.merchants.length||input.merchants.length>20||input.merchants.some(value=>typeof value!=="string"||!value.trim()||value.length>120))errors.push("invalid-merchants");
 const merchants=[...new Map((Array.isArray(input.merchants)?input.merchants:[]).filter(value=>typeof value==="string"&&value.trim()).map(value=>[key(value),value.trim()])).values()];
 const today=input.today==null?module.exports.today():text(input.today,30);
 if(!CurrentPrice.day(today)||today.length!==10)errors.push("invalid-date");
 const age=input.maxAgeDays==null?7:Number(input.maxAgeDays),quantity=input.quantity==null?1:Number(input.quantity);
 if(!Number.isInteger(age)||age<1)errors.push("invalid-max-age");
 if(!Number.isFinite(quantity)||quantity<=0||quantity>1000)errors.push("invalid-quantity");
 const storeId=text(input.storeId,80).toLowerCase(),region=text(input.region,120);
 if(storeId&&!UUID.test(storeId))errors.push("invalid-store-id");
 const storeIds=new Map(),regions=new Map();
 for(const [name,destination] of [["storeIds",storeIds],["regions",regions]]){
  if(input[name]==null)continue;
  if(!plain(input[name])){errors.push("invalid-"+name);continue}
  for(const [merchant,value] of Object.entries(input[name])){
   if(value==null||value==="")continue;
   if(typeof value!=="string"||(name==="storeIds"&&!UUID.test(value.trim()))){errors.push("invalid-"+name);continue}
   destination.set(key(merchant),name==="storeIds"?text(value,80).toLowerCase():text(value,120));
  }
 }
 if(input.eligibility!=null&&!plain(input.eligibility))errors.push("invalid-eligibility");
 const eligibility=Object.fromEntries(["loyalty","app","coupon","personalized"].map(name=>[name,input.eligibility?.[name]===true]));
 return{ok:!errors.length,errors:[...new Set(errors)],value:{product,productId,gtin,brand,pack,merchants,today,maxAgeDays:Math.min(7,age),quantity,storeId,region,storeIds,regions,eligibility}};
}
function merchantMatches(a,b){const aliases=Discovery.merchantAliases(a),other=Discovery.merchantAliases(b);return aliases.some(alias=>other.includes(alias))}
async function readScopes(pool,request){
 const requestedIds=[...new Set([request.storeId,...request.storeIds.values()].filter(Boolean))];
 let known=[];
 if(requestedIds.length){
  const found=await pool.query('SELECT s.id,m.name AS merchant,s.region,s.active,m.active AS "merchantActive" FROM stores s JOIN merchants m ON m.id=s.merchant_id WHERE s.id=ANY($1::uuid[]) AND s.active=true AND m.active=true',[requestedIds]);
  known=found.rows.filter(row=>UUID.test(String(row.id))&&row.active!==false&&row.merchantActive!==false);
 }
 const byId=new Map(known.map(row=>[row.id,row])),errors=[];
 for(const id of requestedIds)if(!byId.has(id))errors.push("canonical-store-not-found");
 const requireStore=requestedIds.length>0,scopes=[];
 for(const merchant of request.merchants){
  const merchantKey=key(merchant),mappedId=request.storeIds.get(merchantKey)||null,global=request.storeId?byId.get(request.storeId):null;
  let selected=mappedId?byId.get(mappedId):global&&merchantMatches(merchant,global.merchant)?global:null;
  if(selected&&!merchantMatches(merchant,selected.merchant)){errors.push("store-merchant-conflict:"+merchant);selected=null}
  scopes.push({merchant,storeId:selected?.id||null,region:request.regions.get(merchantKey)||request.region||null,blocked:requireStore&&!selected,store:selected?{...selected,canonical:true}:null});
 }
 if(request.storeId&&byId.has(request.storeId)&&!scopes.some(scope=>scope.storeId===request.storeId))errors.push("store-merchant-conflict");
 return{ok:!errors.length,errors:[...new Set(errors)],scopes};
}
async function resolveScopes(pool,request,options={}){
 const cache=options.scopeCache;if(!(cache instanceof WeakMap))return readScopes(pool,request);
 let scopes=cache.get(pool);if(!scopes){scopes=new Map();cache.set(pool,scopes);}
 const entries=map=>[...map].sort(([a],[b])=>a.localeCompare(b));
 const signature=JSON.stringify([request.merchants,request.storeId,entries(request.storeIds),request.region,entries(request.regions)]);
 let pending=scopes.get(signature);
 if(!pending){pending=Promise.resolve().then(()=>readScopes(pool,request));scopes.set(signature,pending);}
 try{const result=await pending;if(!result.ok&&scopes.get(signature)===pending)scopes.delete(signature);return result;}
 catch(error){if(scopes.get(signature)===pending)scopes.delete(signature);throw error;}
}
const FIELDS=[
 'po.id,po.product_id AS "productId",COALESCE(po.gtin,p.gtin) AS gtin,po.product,COALESCE(po.brand,p.brand) AS brand',
 'COALESCE(po.pack,CASE WHEN po.pack_amount>0 AND po.pack_unit IS NOT NULL THEN concat_ws(chr(32),po.pack_amount::text,po.pack_unit) WHEN p.pack_amount>0 AND p.pack_unit IS NOT NULL THEN CASE WHEN p.pack_count>1 THEN concat(p.pack_count::text,chr(120),p.pack_amount::text,chr(32),p.pack_unit) ELSE concat_ws(chr(32),p.pack_amount::text,p.pack_unit) END ELSE NULL END) AS pack',
 'po.pack_amount::float AS "packAmount",po.pack_unit AS "packUnit",po.proof_hash AS "proofHash",po.store,po.store_id AS "storeId",po.external_location_id AS "externalLocationId",po.external_product_id AS "externalProductId",COALESCE(po.region,s.region,s.city) AS region',
 'po.price::float,po.per,po.date::text,po.observed_at AS "observedAt",po.valid_from AS "validFrom",po.valid_to AS "validTo",po.price_type AS "priceType",po.regular_price::float AS "regularPrice",po.min_quantity::float AS "minQuantity"',
 'po.kind,po.status,po.identity_verified AS "identityVerified",po.proof_verified AS "proofVerified",po.eligibility,po.source,po.source_type AS "sourceType",po.source_id AS "sourceId",po.evidence_purpose AS "evidencePurpose",po.truth_eligible AS "truthEligible"',
 'po.source_url AS "sourceUrl",po.proof,po.proof_type AS "proofType",po.proof_actor AS "proofActor",po.fetched_at AS "fetchedAt",po.currency,psh.health_score AS "sourceHealthScore",psh.state AS "sourceHealthState"'
].join(",");
function observationQuery(query,request,scopes=[]){
 const values=[request.today,request.maxAgeDays],param=value=>{values.push(value);return"$"+values.length};
 const where=['po.date>=($1::date-($2::int*interval \'1 day\'))','po.date<=$1::date','(po.store_id IS NULL OR (s.active=true AND m.active=true))',"(po.source_id IS DISTINCT FROM 'HIT Berlin store assortment' OR (COALESCE(po.external_product_id,'') !~ 'KG$' AND po.observed_at>statement_timestamp()-interval '24 hours' AND po.observed_at<=statement_timestamp()))"];
 if(query.gtin)where.push("COALESCE(po.gtin,p.gtin)="+param(query.gtin));
 else if(query.productId)where.push("po.product_id="+param(query.productId));
 else{
  const tokens=Identity.tokens(query.name).slice(0,3),terms=(tokens.length?tokens:[query.name]).map(value=>"%"+literalLike(value)+"%");
  const p=param(terms);where.push("(po.product ILIKE ANY("+p+"::text[]) OR p.name ILIKE ANY("+p+"::text[]))");
 }
 const scoped=[];
 for(const scope of scopes){
  if(scope.blocked)continue;
  const aliases=Discovery.merchantAliases(scope.merchant),names=param(aliases),prefixes=param(aliases.map(alias=>literalLike(alias)+"%"));
  const conditions=["(lower(m.name)=ANY("+names+"::text[]) OR m.normalized_name=ANY("+names+"::text[]) OR lower(po.store)=ANY("+names+"::text[]) OR lower(po.store) LIKE ANY("+prefixes+"::text[]))"];
  if(scope.storeId)conditions.push("po.store_id="+param(scope.storeId));
  else if(scope.region){const region=param(scope.region.toLowerCase());conditions.push("(lower(COALESCE(po.region,s.region,s.city))="+region+" OR lower(s.city)="+region+")")}
  scoped.push("("+conditions.join(" AND ")+")");
 }
 where.push(scoped.length?"("+scoped.join(" OR ")+")":"false");
 const sql="SELECT "+FIELDS+" FROM price_observations po LEFT JOIN products p ON p.id=po.product_id LEFT JOIN stores s ON s.id=po.store_id LEFT JOIN merchants m ON m.id=s.merchant_id LEFT JOIN LATERAL (SELECT health_score,state FROM price_source_health h WHERE h.source=po.source ORDER BY calculated_at DESC LIMIT 1) psh ON true WHERE "+where.join(" AND ")+" ORDER BY po.observed_at DESC NULLS LAST,po.id LIMIT 5000";
 return{sql,values};
}
function normalizeObservation(row={}){
 const price=Number(row.price),per=text(row.per,30).toLowerCase();
 if(!Number.isFinite(price)||price<=0)return null;
 if(per==="item"||per==="piece")return{...row,price,per:"piece",originalPrice:price,originalPer:row.per,priceBasis:"pack"};
 if(per!=="kg"&&per!=="l")return null;
 const parsed=Discovery.pack(row.pack||row.packageSize),expected=per==="kg"?"g":"ml";
 if(!parsed||parsed.unit!==expected)return null;
 const checkout=Math.round(price*parsed.count*parsed.amount/1000*100)/100;
 if(!Number.isFinite(checkout)||checkout<=0)return null;
 const regularPrice=Number(row.regularPrice),convertedRegular=Number.isFinite(regularPrice)&&regularPrice>0?Math.round(regularPrice*parsed.count*parsed.amount/1000*100)/100:null;
 return{...row,price:checkout,regularPrice:convertedRegular,per:"piece",originalPrice:price,originalPer:row.per,priceBasis:"derived-pack"};
}
function response(query,request,results,productResolution,refreshTargets=[]){
 const coverage=Coverage.summarize(results,{today:request.today});
 return{ok:true,product:query.name,today:request.today,maxAgeDays:request.maxAgeDays,query:{...query,mode:CurrentPrice.queryMode(query)},productResolution:{state:productResolution.state,mode:productResolution.mode,reason:productResolution.reason},results,leaders:CurrentPrice.leaders(results),coverage,qualityGate:Coverage.ready(coverage),refreshTargets};
}
async function compareCurrentPrices(pool,input={},opts={}){
 if(!pool||typeof pool.query!=="function")throw new Error("database-required");
 const checked=validateRequest(input);
 if(!checked.ok)return{ok:false,statusCode:400,error:"invalid-price-query",errors:checked.errors};
 const request=checked.value;
 const [productResolution,scopeResolution]=await Promise.all([Discovery.resolveProducts(pool,{product:request.product,productId:request.productId,gtin:request.gtin,brand:request.brand,pack:request.pack},opts),resolveScopes(pool,request,opts)]);
 if(!scopeResolution.ok)return{ok:false,statusCode:400,error:"invalid-store-scope",errors:scopeResolution.errors};
 if(productResolution.state==="invalid")return{ok:false,statusCode:400,error:"invalid-product-identity",errors:[productResolution.reason]};
 const canonical=productResolution.selected;
 const query={name:canonical?.name||request.product||request.gtin||request.productId,productId:canonical?.id||request.productId||null,gtin:canonical&&Discovery.validGtin(canonical.gtin)?canonical.gtin:request.gtin||null,brand:request.brand||canonical?.brand||null,pack:request.pack||canonical?.pack||null};
 const conflict=productResolution.state==="unknown"&&(/conflict|missing/.test(productResolution.reason)||request.productId);
 if(conflict)return response(query,request,request.merchants.map(merchant=>({merchant,state:"unknown",price:null,reason:productResolution.reason})),productResolution);
 const spec=observationQuery(query,request,scopeResolution.scopes),observations=await pool.query(spec.sql,spec.values);
 if(observations.rows.length>=5000||Number(observations.rowCount)>=5000)return response(query,request,request.merchants.map(merchant=>({merchant,state:"unknown",price:null,reason:"query-evidence-limit"})),productResolution);
 const normalized=observations.rows.map(normalizeObservation).filter(Boolean);
 const results=scopeResolution.scopes.map(scope=>{
  if(scope.blocked)return{merchant:scope.merchant,state:"unknown",price:null,reason:"store-selection-required"};
  const rows=normalized.filter(row=>!scope.storeId||String(row.storeId)===String(scope.storeId));
  return CurrentPrice.resolveMerchant(query,scope.merchant,rows,{today:request.today,maxAgeDays:request.maxAgeDays,storeId:scope.storeId,region:scope.region,eligibility:request.eligibility,quantity:request.quantity,currency:"EUR"});
 });
 const stores=scopeResolution.scopes.map(scope=>scope.store).filter(Boolean);
 const refreshTargets=opts.includeRefreshTargets===false?[]:await Discovery.buildRefreshTargets(pool,canonical,stores,{targetLimit:2});
 return response(query,request,results,productResolution,refreshTargets);
}

module.exports={today,validateRequest,resolveScopes,observationQuery,normalizeObservation,compareCurrentPrices};
