"use strict";

const Identity=require("./product-identity");
const StoreUniverse=require("./store-universe");
const SOURCE="Open Prices";
const ATTRIBUTION="Open Prices / Open Food Facts; store locations from OpenStreetMap contributors";
const SHOP_TYPES=new Set(["supermarket","convenience","discount","chemist","health_food","department_store","greengrocer","beverages","organic","general","wholesale","frozen_food","butcher","bakery","deli","food","farm","tea","coffee","seafood","wine","alcohol","drugstore"]);
const aliases={"aldi sud":"aldi sued","aldi süd":"aldi sued","denn s biomarkt":"denns biomarkt","dm drogerie markt":"dm","netto marken discount":"netto marken discount","netto mit dem scottie":"netto mit dem scottie"};

function text(value,max=300){return typeof value==="string"?value.trim().slice(0,max):""}
function label(value){const normalized=Identity.norm(value).replace(/\./g," ").replace(/\s+/g," ").trim();return aliases[normalized]||normalized}
function positiveId(value){const id=String(value??"").trim();return /^\d+$/.test(id)&&Number.isSafeInteger(Number(id))&&Number(id)>0?String(Number(id)):null}
function coordinate(value,min,max){if(value===null||value===undefined||value===""||typeof value==="boolean")return null;const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:null}
function pack(value){
 let normalized=String(value||"").replace(/(\d),(\d)/g,"$1.$2").replace(/×/g," x ").replace(/\b(\d+(?:\.\d+)?)\s*(?:pcs|pieces)\b/gi,"$1 piece");
 if(/\bx\b|\d\s*x\s*[\d.]/i.test(normalized)){
  const multi=normalized.match(/(?:^|[^\d.,])(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|l|ml|cl)\b/i);
  if(!multi||!Number.isSafeInteger(Number(multi[1]))||Number(multi[1])<1)return null;
  normalized=Number(multi[1])+" x "+multi[2]+" "+multi[3];
 }
 const pieces=normalized.match(/(?:^|[^\d.,])(\d+(?:\.\d+)?)\s*(piece|stk|stuck|stück|eier|rollen|kapseln)\b/i);
 if(pieces){const count=Number(pieces[1]);return Number.isSafeInteger(count)&&count>0?{amount:count,unit:"piece",count:1,total:{amount:count,unit:"piece"}}:null}
 const parsed=Identity.parsePack(normalized);if(!parsed||!Number.isFinite(parsed.amount)||parsed.amount<=0||!Number.isSafeInteger(parsed.count)||parsed.count<1||!Number.isFinite(parsed.total.amount)||parsed.total.amount<=0)return null;return{amount:parsed.amount,unit:parsed.unit,count:parsed.unit==="piece"?1:parsed.count,total:parsed.total};
}
function productPack(product={}){
 const quantity=text(product.quantity,80),parsed=pack(quantity);if(parsed)return{quantity,parsed};
 const amount=product.product_quantity===null||product.product_quantity===undefined||product.product_quantity===""?null:Number(product.product_quantity),unit=text(product.product_quantity_unit,12).toLowerCase();
 const fallback=Number.isFinite(amount)&&amount>0&&["kg","g","l","ml","cl","piece"].includes(unit)?String(amount)+" "+unit:"";
 return{quantity:fallback||quantity,parsed:fallback?pack(fallback):null};
}
function productCandidate(raw={}){
 const p=raw.product&&typeof raw.product==="object"&&!Array.isArray(raw.product)?raw.product:{};
 const gtin=String(p.code??raw.product_code??"").trim();
 const name=text(p.product_name||p.product_name_de||p.product_name_en||raw.product_name,200);
 const brand=text(p.brands,120)||null,{quantity,parsed}=productPack(p),reasons=[];
 if(!/^\d+$/.test(gtin)||!Identity.gtinValid(gtin))reasons.push("product-valid-gtin-required");
 if(!name)reasons.push("product-name-required");
 if(!parsed)reasons.push("product-known-pack-required");
 return{ok:reasons.length===0,reasons,gtin,name,brand,pack:quantity,packParsed:parsed,externalProductId:"openprices:"+gtin,canonicalKey:"gtin:"+gtin,sourceUrl:gtin?"https://world.openfoodfacts.org/product/"+gtin:null};
}
function storeCandidate(raw={},merchants=[]){
 const l=raw.location&&typeof raw.location==="object"&&!Array.isArray(raw.location)?raw.location:{};
 const externalId=positiveId(l.id),osmId=positiveId(l.osm_id),osmType=text(l.osm_type,20).toLowerCase(),reasons=[];
 const countryCode=text(l.osm_address_country_code||l.country_code,8).toLowerCase();
 const country=text(l.osm_address_country||l.country,80).toLowerCase();
 const german=countryCode?countryCode==="de":["de","deu","germany","deutschland","allemagne"].includes(country);
 const latitude=coordinate(l.osm_lat??l.latitude??l.lat,47,55.2),longitude=coordinate(l.osm_lon??l.longitude??l.lon,5.5,15.6);
 const brand=text(l.osm_brand||l.brand,120),name=text(l.osm_name||l.name,160);
 const merchantNames=[brand,name].filter(Boolean),matches=merchants.filter(m=>m.active!==false&&merchantNames.some(value=>label(value)===label(m.name)||label(value)===label(m.normalizedName||m.normalized_name)));
 const matchingBrand=matches.filter(m=>brand&&(label(brand)===label(m.name)||label(brand)===label(m.normalizedName||m.normalized_name)));
 const unique=new Map((matchingBrand.length?matchingBrand:matches).map(m=>[m.id,m]));const merchant=unique.size===1?[...unique.values()][0]:null;
 if(!externalId)reasons.push("store-open-prices-location-id-required");
 if(text(l.type,20).toUpperCase()!=="OSM"||text(l.osm_tag_key,30)!=="shop"||!SHOP_TYPES.has(text(l.osm_tag_value,40)))reasons.push("store-retail-osm-entity-required");
 if(!osmId||!["node","way","relation"].includes(osmType))reasons.push("store-exact-osm-identity-required");
 if(!german)reasons.push("store-germany-required");
 if(latitude===null||longitude===null)reasons.push("store-valid-germany-coordinates-required");
 if(!merchant)reasons.push(unique.size>1?"store-merchant-ambiguous":"store-known-merchant-required");
 const road=text(l.osm_address_road||l.osm_address_street,180),number=text(l.osm_address_house_number||l.osm_address_housenumber,30);
 const address=road?[road,number].filter(Boolean).join(" "):text(l.street_address||l.address||l.osm_display_name,240)||null;
 const postalCode=text(l.osm_address_postcode||l.postcode||l.postal_code,20)||null,city=text(l.osm_address_city||l.city,120)||null;
 return{ok:reasons.length===0,reasons,externalLocationId:externalId?"openprices:"+externalId:null,canonicalExternalId:osmId?"osm:"+osmType+":"+osmId:null,osmId,osmType,merchant,latitude,longitude,address,postalCode,city,region:city?city+", DE":"DE",country:"DE",sourceUrl:osmId?"https://www.openstreetmap.org/"+osmType+"/"+osmId:null};
}
function matchingPack(existing,candidate){
 if(existing.packAmount==null||existing.packUnit==null)return false;
 const amount=Number(existing.packAmount),count=Number(existing.packCount??1);
 if(!Number.isFinite(amount)||amount<=0||!Number.isSafeInteger(count)||count<1)return false;
 const a=Identity.base(amount*count,existing.packUnit),b=candidate.packParsed.total;
 return a.unit===b.unit&&Math.abs(a.amount-b.amount)/Math.max(a.amount,b.amount)<=.001;
}
class ReviewError extends Error{constructor(reason){super(reason);this.reason=reason}}
function verifiedMapping(mapping){const confidence=Number(mapping.confidence);return mapping.status==="verified"&&Number.isFinite(confidence)&&confidence>=.9&&confidence<=1}

async function canonicalProduct(client,p,meta,stats){
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["canonical-product:"+p.gtin]);
 const mapping=(await client.query('SELECT ep.product_id AS "productId",ep.status,ep.confidence::float,p.gtin FROM external_product_mappings ep JOIN products p ON p.id=ep.product_id WHERE ep.source_id=$1 AND ep.external_product_id=$2',[SOURCE,p.externalProductId])).rows[0];
 if(mapping&&(!verifiedMapping(mapping)||mapping.gtin!==p.gtin))throw new ReviewError("product-existing-mapping-needs-review");
 let product=(await client.query('SELECT id,gtin,name,brand,pack_amount::float AS "packAmount",pack_unit AS "packUnit",pack_count::float AS "packCount" FROM products WHERE gtin=$1',[p.gtin])).rows[0];
 if(product&&!matchingPack(product,p))throw new ReviewError("product-existing-pack-conflict");
 if(!product){
  const inserted=await client.query("INSERT INTO products(canonical_key,gtin,name,brand,pack_amount,pack_unit,pack_count,identity_status) VALUES($1,$2,$3,$4,$5,$6,$7,'verified') ON CONFLICT DO NOTHING RETURNING id",[p.canonicalKey,p.gtin,p.name,p.brand,p.packParsed.amount,p.packParsed.unit,p.packParsed.count]);
  if(!inserted.rows[0])throw new ReviewError("product-canonical-key-conflict");product={id:inserted.rows[0].id};stats.productsCreated++;
 }else stats.productsReused++;
 if(mapping&&mapping.productId!==product.id)throw new ReviewError("product-existing-mapping-conflict");
 const added=await client.query("INSERT INTO external_product_mappings(source_id,external_product_id,product_id,status,confidence,match_reason,verified_at) VALUES($1,$2,$3,'verified',1,'gtin',now()) ON CONFLICT DO NOTHING RETURNING product_id",[SOURCE,p.externalProductId,product.id]);stats.productMappingsCreated+=added.rowCount||0;
 const proof=meta.sourceUrl||p.sourceUrl;
 await client.query("INSERT INTO product_identity_evidence(product_id,raw_name,source,gtin,pack_amount,pack_unit,match_score,match_level,proof) SELECT $1,$2,$3,$4,$5,$6,1,'exact',$7 WHERE NOT EXISTS(SELECT 1 FROM product_identity_evidence WHERE product_id=$1 AND raw_name=$2 AND source=$3 AND gtin=$4 AND proof=$7)",[product.id,p.name,SOURCE,p.gtin,p.packParsed.amount,p.packParsed.unit,proof]);
 return product.id;
}
async function canonicalStore(client,s,stats){
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",["canonical-store:"+s.canonicalExternalId]);
 const mapping=(await client.query('SELECT em.store_id AS "storeId",em.status,em.confidence::float,s.external_id AS "externalId" FROM external_store_mappings em JOIN stores s ON s.id=em.store_id WHERE em.source_id=$1 AND em.external_location_id=$2',[SOURCE,s.externalLocationId])).rows[0];
 if(mapping&&(!verifiedMapping(mapping)||mapping.externalId!==s.canonicalExternalId))throw new ReviewError("store-existing-mapping-needs-review");
 const stores=(await client.query('SELECT id,merchant_id AS "merchantId",country,active,latitude::float AS latitude,longitude::float AS longitude FROM stores WHERE external_id=$1 LIMIT 2',[s.canonicalExternalId])).rows;
 if(stores.length>1)throw new ReviewError("store-duplicate-osm-identity");
 let store=stores[0];
 if(store){
  if(store.active===false||store.country!=="DE"||store.merchantId!==s.merchant.id)throw new ReviewError("store-existing-identity-conflict");
  const lat=coordinate(store.latitude,-90,90),lon=coordinate(store.longitude,-180,180);
  if(lat!==null&&lon!==null&&Math.hypot((lat-s.latitude)*111,(lon-s.longitude)*Math.cos(s.latitude*Math.PI/180)*111)>.5)throw new ReviewError("store-existing-coordinate-conflict");stats.storesReused++;
 }else{
  store=(await client.query("INSERT INTO stores(merchant_id,external_id,address,postal_code,city,region,country,latitude,longitude,active) VALUES($1,$2,$3,$4,$5,$6,'DE',$7,$8,true) RETURNING id",[s.merchant.id,s.canonicalExternalId,s.address,s.postalCode,s.city,s.region,s.latitude,s.longitude])).rows[0];stats.storesCreated++;
 }
 if(mapping&&mapping.storeId!==store.id)throw new ReviewError("store-existing-mapping-conflict");
 const added=await client.query("INSERT INTO external_store_mappings(source_id,external_location_id,store_id,status,confidence,match_reason,verified_at) VALUES($1,$2,$3,'verified',1,'osm-exact',now()) ON CONFLICT DO NOTHING RETURNING store_id",[SOURCE,s.externalLocationId,store.id]);stats.storeMappingsCreated+=added.rowCount||0;
 const linked=(await client.query('SELECT store_id AS "storeId",status FROM canonical_store_sources WHERE source_id=$1 AND external_location_id=$2',[SOURCE,s.externalLocationId])).rows[0];
 if(linked&&(linked.storeId!==store.id||linked.status!=="verified"))throw new ReviewError("store-existing-source-link-needs-review");
 await client.query("INSERT INTO canonical_store_sources(store_id,source_id,external_location_id,confidence,status) VALUES($1,$2,$3,1,'verified') ON CONFLICT DO NOTHING",[store.id,SOURCE,s.externalLocationId]);
 return store.id;
}
function newStats(){return{productsCreated:0,productsReused:0,storesCreated:0,storesReused:0,productMappingsCreated:0,storeMappingsCreated:0}}
async function prepare(pool,payload,options={}){
 if(!pool||typeof pool.connect!=="function")throw new Error("inventory-transaction-pool-required");
 if(options.sourceId&&options.sourceId!==SOURCE)throw new Error("inventory-source-not-supported");
 const rows=Array.isArray(payload)?payload:Array.isArray(payload?.items)?payload.items:Array.isArray(payload?.results)?payload.results:[];
 const limit=Number.isSafeInteger(options.limit)?Math.min(10000,Math.max(1,options.limit)):1000;
 const merchants=(await pool.query('SELECT id,name,normalized_name AS "normalizedName",active FROM merchants WHERE active=true')).rows;
 await StoreUniverse.ensure(pool);
 const accepted=[],partial=[],rejected=[],counts={received:rows.length,processed:Math.min(rows.length,limit),complete:0,partial:0,rejected:0,...newStats()},products=new Set(),stores=new Set();
 for(const raw of rows.slice(0,limit)){
  const item=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw:{};
  const p=productCandidate(item),s=storeCandidate(item,merchants),reasons=[...p.reasons,...s.reasons],client=await pool.connect(),stats=newStats();let productId=null,storeId=null;
  try{
   await client.query("BEGIN");
   for(const [kind,candidate,canonicalize] of [["product",p,canonicalProduct],["store",s,canonicalStore]]){
    if(!candidate.ok)continue;
    await client.query("SAVEPOINT inventory_identity");const before={...stats};
    try{const id=kind==="product"?await canonicalize(client,candidate,options,stats):await canonicalize(client,candidate,stats);if(kind==="product")productId=id;else storeId=id;await client.query("RELEASE SAVEPOINT inventory_identity")}
    catch(error){await client.query("ROLLBACK TO SAVEPOINT inventory_identity");await client.query("RELEASE SAVEPOINT inventory_identity");Object.assign(stats,before);if(!(error instanceof ReviewError))throw error;reasons.push(error.reason)}
   }
   await client.query("COMMIT");for(const key of Object.keys(stats))counts[key]+=stats[key];
   if(productId)products.add(productId);if(storeId)stores.add(storeId);
   const canonicalPack=p.ok?(p.packParsed.count>1?p.packParsed.count+" x ":"")+p.packParsed.amount+" "+p.packParsed.unit:null;
   const prepared={raw:item,productId,storeId,gtin:p.ok?p.gtin:null,product:p.ok?p.name:null,brand:p.ok?p.brand:null,pack:canonicalPack,packAmount:p.ok?p.packParsed.amount:null,packUnit:p.ok?p.packParsed.unit:null,packCount:p.ok?p.packParsed.count:null,merchant:s.merchant?.name||null,region:s.region,latitude:s.latitude,longitude:s.longitude,externalProductId:p.ok?p.externalProductId:null,externalLocationId:s.externalLocationId,canonicalExternalId:s.ok?s.canonicalExternalId:null,identityVerified:!!(productId&&storeId),proofVerified:false,provenance:{sourceId:SOURCE,sourceUrl:options.sourceUrl||null,productUrl:p.sourceUrl,locationUrl:s.sourceUrl,attribution:ATTRIBUTION,fetchedAt:options.fetchedAt||null}};
   if(productId&&storeId){accepted.push(prepared);counts.complete++}
   else{rejected.push({raw:item,reasons});counts.rejected++;if(productId||storeId){partial.push({...prepared,reasons});counts.partial++}}
  }catch(error){try{await client.query("ROLLBACK")}catch{}rejected.push({raw:item,reasons:["inventory-persist-failed"],error:String(error.message||error).slice(0,200)});counts.rejected++}
  finally{client.release()}
 }
 return{accepted,partial,rejected,counts:{...counts,products:products.size,stores:stores.size,truncated:rows.length>limit},sourceId:SOURCE,attribution:ATTRIBUTION};
}

module.exports={SOURCE,ATTRIBUTION,label,productPack,productCandidate,storeCandidate,matchingPack,prepare};
