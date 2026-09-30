"use strict";

const Identity=require("./product-identity");
const Compatibility=require("./product-compatibility");
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCT_FIELDS='id,canonical_key AS "canonicalKey",gtin,name,brand,variant,pack_amount::float AS "packAmount",pack_unit AS "packUnit",pack_count::float AS "packCount",identity_status AS "identityStatus"';
const STORE_FIELDS='s.id,m.name AS merchant,m.normalized_name AS "merchantKey",s.address,s.postal_code AS "postalCode",s.city,s.region,s.latitude::float AS latitude,s.longitude::float AS longitude,s.active,m.active AS "merchantActive"';
const text=(value,limit=200)=>String(value??"").trim().slice(0,limit);
const limit=(value,fallback=20,max=50)=>Math.max(1,Math.min(max,Math.floor(Number(value)||fallback)));
function validGtin(value){const code=text(value,32);return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)&&Identity.gtinValid(code)}
function pack(value){
 const normalized=text(value,100).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/×/g,"x").replace(/(\d),(\d)/g,"$1.$2");
 const match=normalized.match(/^(?:(\d+)\s*x\s*)?(\d+(?:\.\d+)?)\s*(kg|g|l|ml|cl|stk|stuck|piece|pieces|st)$/);
 if(!match)return null;
 const count=Number(match[1]||1),amount=Number(match[2]),unit=/^(stk|stuck|piece|pieces|st)$/.test(match[3])?"piece":match[3];
 if(!Number.isSafeInteger(count)||count<1||!Number.isFinite(amount)||amount<=0)return null;
 const base=Identity.base(amount,unit);return{count,amount:base.amount,unit:base.unit};
}
function productPack(row){
 const count=row.packCount==null?1:Number(row.packCount),amount=Number(row.packAmount),unit=text(row.packUnit,20);
 if(!Number.isSafeInteger(count)||count<1||!Number.isFinite(amount)||amount<=0||!unit)return null;
 return pack((count>1?count+" x ":"")+amount+" "+unit);
}
function samePack(a,b){return!!(a&&b&&a.count===b.count&&a.unit===b.unit&&Math.abs(a.amount-b.amount)<=Math.max(a.amount,b.amount)*1e-9)}
function productItem(row,matchType){
 const count=row.packCount==null?1:Number(row.packCount),parsed=productPack(row);
 return{...row,pack:parsed?(count>1?count+" x ":"")+Number(row.packAmount)+" "+row.packUnit:null,canonical:true,matchType};
}
function literalLike(value){return String(value).replace(/[\\%_]/g,"\\$&")}
function resolution(state,mode,reason,items=[],selected=null){return{state,mode,reason,items,selected}}
async function resolveProducts(pool,request={},opts={}){
 const productId=text(request.productId,80),gtin=text(request.gtin,32),name=text(request.product||request.name),brand=text(request.brand,120),requestedPack=text(request.pack||request.packageSize,100);
 const mode=productId?"id":gtin?"gtin":brand&&requestedPack?"sku":"category";
 if(productId&&!UUID.test(productId))return resolution("invalid",mode,"invalid-product-id");
 if(gtin&&!validGtin(gtin))return resolution("invalid",mode,"invalid-gtin");
 if(requestedPack&&!pack(requestedPack))return resolution("invalid",mode,"invalid-pack");
 if(!productId&&!gtin&&Identity.norm(name).length<2)return resolution("invalid",mode,"product-query-required");
 let rows;
 if(productId||gtin){
  const found=await pool.query("SELECT "+PRODUCT_FIELDS+" FROM products WHERE "+(productId?"id":"gtin")+"=$1 LIMIT 2",[productId||gtin]);
  rows=found.rows.filter(row=>UUID.test(String(row.id)));
  if(productId&&gtin&&rows.some(row=>String(row.gtin||"")!==gtin))return resolution("invalid",mode,"product-identity-conflict");
  if(rows.length===1){
   const row=rows[0];
   if(brand&&row.brand&&Identity.norm(brand)!==Identity.norm(row.brand))return resolution("unknown",mode,"product-brand-conflict");
   if(requestedPack&&!samePack(pack(requestedPack),productPack(row)))return resolution("unknown",mode,productPack(row)?"product-pack-conflict":"canonical-pack-missing");
   if(name&&!Compatibility.compatible(name,row.name).ok)return resolution("unknown",mode,"product-name-conflict");
   if(name&&Identity.similarity(name,row.name)===0&&Identity.norm(name)!==Identity.norm(row.name)){
    const named=await pool.query("SELECT id,name FROM products WHERE lower(name)=lower($1) LIMIT 2",[name]);
    if(named.rows.some(other=>String(other.id)!==String(row.id)))return resolution("unknown",mode,"product-name-conflict");
   }
   const selected=productItem(row,"exact");return resolution("exact",mode,mode==="id"?"canonical-product-id":"canonical-gtin",[selected],selected);
  }
  return resolution(rows.length?"ambiguous":"unknown",mode,rows.length?"multiple-canonical-products":"canonical-product-not-found",rows.map(row=>productItem(row,"candidate")));
 }
 const firstWord=name.split(/\s+/)[0];
 const found=await pool.query("SELECT "+PRODUCT_FIELDS+" FROM products WHERE name ILIKE $1 ORDER BY name,id LIMIT $2",["%"+literalLike(firstWord)+"%",limit(opts.lookupLimit,200,500)]);
 const nameKey=Identity.norm(name),brandKey=Identity.norm(brand),requested=pack(requestedPack);
 rows=found.rows.filter(row=>UUID.test(String(row.id))&&((Identity.norm(row.name).includes(nameKey))||Identity.similarity(name,row.name)>=.35));
 const exact=mode==="sku"?rows.filter(row=>Identity.norm(row.name)===nameKey&&Identity.norm(row.brand)===brandKey&&samePack(requested,productPack(row))):[];
 if(exact.length===1){const selected=productItem(exact[0],"exact");return resolution("exact",mode,"canonical-name-brand-pack",[selected],selected)}
 if(exact.length>1)return resolution("ambiguous",mode,"multiple-canonical-skus",exact.slice(0,limit(opts.limit||request.limit)).map(row=>productItem(row,"candidate")));
 const candidates=rows.sort((a,b)=>Identity.similarity(name,b.name)-Identity.similarity(name,a.name)||String(a.id).localeCompare(String(b.id))).slice(0,limit(opts.limit||request.limit)).map(row=>productItem(row,"candidate"));
 return resolution(candidates.length?"candidate":"unknown",mode,candidates.length?"product-selection-required":"canonical-product-not-found",candidates);
}
function coordinate(value){if(value==null||text(value)==="")return null;const number=Number(value);return Number.isFinite(number)?number:NaN}
function position(request={}){
 const latitude=coordinate(request.latitude??request.lat),longitude=coordinate(request.longitude??request.lon);
 if(latitude===null&&longitude===null)return{point:null};
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude===null||longitude===null||Math.abs(latitude)>90||Math.abs(longitude)>180)return{error:"invalid-coordinates"};
 const radius=request.radiusKm==null?10:Number(request.radiusKm);
 if(!Number.isFinite(radius)||radius<=0||radius>100)return{error:"invalid-radius"};
 return{point:{latitude,longitude},radiusKm:radius};
}
function merchantAliases(value){
 const raw=text(value,100).toLowerCase(),ascii=Identity.norm(raw),german=raw.replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss");
 return[raw,ascii,ascii.replace(/\s+/g,"-"),german.replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")].filter(Boolean);
}
function distanceKm(a,b){
 if(!a||!b||![a.latitude,a.longitude,b.latitude,b.longitude].every(Number.isFinite))return null;
 const rad=value=>value*Math.PI/180,dlat=rad(b.latitude-a.latitude),dlon=rad(b.longitude-a.longitude);
 const h=Math.sin(dlat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dlon/2)**2;
 return 12742*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
}
async function resolveStores(pool,request={},opts={}){
 const storeId=text(request.storeId,80),geo=position(request),region=text(request.region,120);
 const mode=storeId?"id":geo.point?"nearby":region?"region":"merchant";
 if(storeId&&!UUID.test(storeId))return resolution("invalid",mode,"invalid-store-id");
 if(geo.error)return resolution("invalid",mode,geo.error);
 if(request.merchants!=null&&!Array.isArray(request.merchants))return resolution("invalid",mode,"invalid-merchants");
 const requestedMerchants=request.merchants||[request.merchant].filter(Boolean);
 const aliases=[...new Set(requestedMerchants.slice(0,20).flatMap(merchantAliases))];
 const args=[],where=["s.active=true","m.active=true"],param=value=>{args.push(value);return"$"+args.length};
 if(storeId)where.push("s.id="+param(storeId));
 if(aliases.length){const p=param(aliases);where.push("(lower(m.name)=ANY("+p+"::text[]) OR m.normalized_name=ANY("+p+"::text[]))")}
 if(region&&!storeId){const p=param(region.toLowerCase());where.push("(lower(s.region)="+p+" OR lower(s.city)="+p+")")}
 let distance="NULL::float";
 if(geo.point&&!storeId){
  const latitude=param(geo.point.latitude),longitude=param(geo.point.longitude);
  where.push("s.latitude BETWEEN -90 AND 90","s.longitude BETWEEN -180 AND 180");
  distance="12742*asin(sqrt(LEAST(1,GREATEST(0,power(sin(radians(s.latitude::float-"+latitude+")/2),2)+cos(radians("+latitude+"::float))*cos(radians(s.latitude::float))*power(sin(radians(s.longitude::float-"+longitude+")/2),2)))))";
 }
 const query="SELECT "+STORE_FIELDS+","+distance+' AS "distanceKm" FROM stores s JOIN merchants m ON m.id=s.merchant_id WHERE '+where.join(" AND ");
 const sql=geo.point&&!storeId?'SELECT * FROM ('+query+') nearby WHERE "distanceKm"<='+param(geo.radiusKm)+' ORDER BY "distanceKm",id LIMIT '+param(limit(opts.limit||request.limit)):query+" ORDER BY m.name,s.city,s.address,s.id LIMIT "+param(storeId?2:limit(opts.limit||request.limit));
 const found=await pool.query(sql,args);
 let rows=found.rows.filter(row=>UUID.test(String(row.id))&&row.active!==false&&row.merchantActive!==false);
 if(geo.point&&!storeId)rows=rows.map(row=>({...row,distanceKm:distanceKm(geo.point,{latitude:coordinate(row.latitude),longitude:coordinate(row.longitude)})})).filter(row=>row.distanceKm!==null&&row.distanceKm<=geo.radiusKm).sort((a,b)=>a.distanceKm-b.distanceKm);
 const items=rows.map(row=>({...row,lat:row.latitude??null,canonical:true,matchType:storeId?"exact":"candidate"}));
 return resolution(items.length?(storeId?"exact":"candidate"):"unknown",mode,items.length?(storeId?"canonical-store-id":"store-selection-required"):"canonical-store-not-found",items,storeId&&items.length===1?items[0]:null);
}
function openPricesLocationId(value){const match=text(value,80).match(/^(?:openprices:)?([1-9]\d{0,14})$/i);return match?match[1]:null}
async function buildRefreshTargets(pool,product,stores=[],opts={}){
 if(!product||product.matchType!=="exact"||!UUID.test(String(product.id))||!validGtin(product.gtin))return[];
 const canonical=stores.filter(store=>store.canonical===true&&UUID.test(String(store.id))),storeIds=[...new Set(canonical.map(store=>store.id))];
 if(!storeIds.length)return[];
 const mappings=await pool.query('SELECT esm.store_id AS "storeId",esm.source_id AS "sourceId",esm.external_location_id AS "externalLocationId",esm.status,esm.confidence::float FROM external_store_mappings esm JOIN stores s ON s.id=esm.store_id JOIN merchants m ON m.id=s.merchant_id WHERE esm.source_id=\'Open Prices\' AND esm.status=\'verified\' AND esm.confidence>=0.9 AND esm.store_id=ANY($1::uuid[]) AND s.active=true AND m.active=true ORDER BY esm.confidence DESC,esm.verified_at DESC NULLS LAST,esm.external_location_id LIMIT $2',[storeIds,Math.min(500,storeIds.length*10)]);
 const byStore=new Map();
 for(const row of mappings.rows){const locationId=openPricesLocationId(row.externalLocationId),confidence=Number(row.confidence);if(!storeIds.includes(row.storeId)||row.sourceId!=="Open Prices"||row.status!=="verified"||!Number.isFinite(confidence)||confidence<.9||confidence>1||!locationId||byStore.has(row.storeId))continue;byStore.set(row.storeId,locationId)}
 const targets=[],seen=new Set();
 for(const store of canonical){const locationId=byStore.get(store.id),key=product.gtin+"@"+locationId;if(!locationId||seen.has(key))continue;seen.add(key);targets.push({sourceId:"Open Prices",productCode:String(product.gtin),productId:product.id,storeId:store.id,locationId,priority:100,targetReason:"user-query-canonical-store"});if(targets.length>=limit(opts.targetLimit,20,50))break}
 return targets;
}
async function resolveQuery(pool,request={},opts={}){
 if(!pool||typeof pool.query!=="function")throw new Error("database-required");
 if(!request||typeof request!=="object"||Array.isArray(request))return{ok:false,productResolution:{state:"invalid",mode:null,reason:"invalid-body"},products:[],product:null,storeResolution:{state:"invalid",mode:null,reason:"invalid-body"},stores:[],refreshTargets:[],errors:["invalid-body"],requiresProductSelection:false,requiresStoreSelection:false};
 const [products,stores]=await Promise.all([resolveProducts(pool,request,opts),resolveStores(pool,request,opts)]);
 const errors=[products,stores].filter(result=>result.state==="invalid").map(result=>result.reason);
 const refreshTargets=errors.length?[]:await buildRefreshTargets(pool,products.selected,stores.items,opts);
 const summarize=({state,mode,reason})=>({state,mode,reason});
 return{ok:!errors.length,productResolution:summarize(products),products:products.items,product:products.selected,storeResolution:summarize(stores),stores:stores.items,refreshTargets,errors,requiresProductSelection:["candidate","ambiguous"].includes(products.state),requiresStoreSelection:stores.state==="candidate"};
}

module.exports={pack,samePack,productPack,validGtin,position,distanceKm,merchantAliases,openPricesLocationId,resolveProducts,resolveStores,buildRefreshTargets,resolveQuery};
