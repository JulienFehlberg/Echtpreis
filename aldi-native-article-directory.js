"use strict";
const PDP=require("./aldi-assortment-article-service"),Category=require("./aldi-category-article-service");
const SOURCE="ALDI Nord native article directory",MERCHANT="ALDI Nord",CHANNEL="assortment-publication",SOURCE_IDS=Object.freeze([PDP.SOURCE,Category.SOURCE]);
const fail=code=>Object.assign(new Error(code),{code});
// Collapse the same native ALDI SKU before search and pagination. A later held,
// malformed or price-less observation must not reveal an older alternative.
const FRONTIER=`WITH native AS (
 SELECT source_id,retailer_sku,observed_at,name,brand,variant,pack_amount,pack_unit,pack_count,held,
 jsonb_build_array(name,brand,variant,pack,pack_amount,pack_unit,pack_count,source_url) AS native_identity,to_jsonb(a) AS stored_row
 FROM ${PDP.TABLE} a WHERE source_id='${PDP.SOURCE}'
 UNION ALL
 SELECT source_id,retailer_sku,observed_at,name,brand,variant,pack_amount,pack_unit,pack_count,held,
 jsonb_build_array(name,brand,variant,pack,pack_amount,pack_unit,pack_count,product_identity_url) AS native_identity,to_jsonb(a) AS stored_row
 FROM ${Category.TABLE} a WHERE source_id='${Category.SOURCE}'
), latest_times AS (SELECT retailer_sku,MAX(observed_at) AS observed_at FROM native GROUP BY retailer_sku),
 latest AS (SELECT n.* FROM native n JOIN latest_times t USING(retailer_sku,observed_at)),
 decisions AS (SELECT retailer_sku,MIN(source_id) AS chosen_source,BOOL_OR(held) AS latest_held,
 COUNT(DISTINCT native_identity)>1 AS identity_conflict FROM latest GROUP BY retailer_sku)
 SELECT n.source_id,n.retailer_sku,n.observed_at,n.stored_row,d.latest_held,d.identity_conflict
 FROM latest n JOIN decisions d ON d.retailer_sku=n.retailer_sku AND d.chosen_source=n.source_id`;
function querySpec(options={}){
 let nativeOptions=options;if(options&&Object.hasOwn(options,"gtin")){const Discovery=require("./price-query-discovery");if(typeof options.gtin!=="string"||options.gtin!==options.gtin.trim()||!Discovery.validGtin(options.gtin))throw fail("invalid-article-gtin");nativeOptions={...options};delete nativeOptions.gtin;}
 const checked=PDP.querySpec(nativeOptions),params=[],where=[],param=value=>{params.push(value);return"$"+params.length;};
 if(options.gtin!==undefined)where.push("false");
 if(options.merchant!==undefined&&String(options.merchant).toLowerCase()!==MERCHANT.toLowerCase()||options.scopeChannel!==undefined&&options.scopeChannel!==CHANNEL)where.push("false");
 if(options.retailerSku!==undefined)where.push("n.retailer_sku="+param(options.retailerSku));
 if(options.search!==undefined){const needle="%"+options.search.trim().replace(/[\\%_]/g,"\\$&")+"%",p=param(needle);where.push("(n.name ILIKE "+p+" ESCAPE '\\' OR n.brand ILIKE "+p+" ESCAPE '\\' OR n.variant ILIKE "+p+" ESCAPE '\\')");}
 if(options.pack!==undefined){const Filters=require("./retailer-product-search-filters"),condition=Filters.sqlPack(options.pack,param);if(condition)where.push(condition.replace(/\b(pack_amount|pack_unit|pack_count)\b/g,"n.$1"));}
 return{...checked,sql:FRONTIER+(where.length?" WHERE "+where.join(" AND "):"")+" ORDER BY n.observed_at DESC,n.retailer_sku LIMIT "+param(checked.limit)+" OFFSET "+param(checked.offset),params};
}
async function ensure(pool,services){await services.pdp.ensure(pool);await services.category.ensure(pool);}
async function read(pool,rows,now,services){
 if(rows.length>50000)throw fail("aldi-native-directory-row-bound");
 const categoryRows=rows.filter(r=>!r.latest_held&&!r.identity_conflict&&r.source_id===Category.SOURCE).map(r=>r.stored_row),native=await services.category.readRows(pool,categoryRows,{now});
 if(!Array.isArray(native)||native.length!==categoryRows.length)throw fail("aldi-native-directory-reader-conflict");const categoryViews=new Map(categoryRows.map((r,i)=>[r,native[i]]));
 return rows.map(r=>r.latest_held||r.identity_conflict?null:r.source_id===PDP.SOURCE?services.pdp.articleFromRow(r.stored_row,now):r.source_id===Category.SOURCE?categoryViews.get(r.stored_row)||null:null);
}
async function search(pool,options={},services={pdp:PDP,category:Category}){
 if(!pool||typeof pool.query!=="function")throw fail("database-required");const q=querySpec(options);await ensure(pool,services);const rows=(await pool.query(q.sql,q.params)).rows,views=await read(pool,rows,q.now,services);
 return{ok:true,items:views.filter(Boolean),sourceId:SOURCE,sourceIds:SOURCE_IDS,scopeCountry:"DE",scopeChannel:CHANNEL,locationScope:"unknown",truthEligible:false,assortmentComplete:false,currentAvailabilityVerified:false,currentPriceVerified:false,state:"last-observed",limit:q.limit,scannedRows:rows.length,nextOffset:q.offset+rows.length,hasMore:rows.length===q.limit&&q.offset+rows.length<=10000,identityBasis:"latest-native-retailer-sku-across-original-sources"};
}
async function status(pool,options={},services={pdp:PDP,category:Category}){
 const q=querySpec({now:options.now});await ensure(pool,services);const rows=(await pool.query(FRONTIER)).rows,views=await read(pool,rows,q.now,services),valid=views.filter(Boolean),held=rows.filter(r=>r.latest_held||r.identity_conflict).length,captured=valid.map(a=>a.observedAt).sort();
 return{ok:true,sourceId:SOURCE,sourceIds:SOURCE_IDS,merchant:MERCHANT,scopeCountry:"DE",scopeChannel:CHANNEL,locationScope:"unknown",storedArticles:rows.length,heldArticles:held,excludedInvalidArticles:rows.length-held-valid.length,lastObservedArticles:valid.length,lastObservedAt:captured.at(-1)||null,truthEligible:false,assortmentComplete:false,currentPriceVerified:false,physicalStorePriceVerified:false,normalPriceClassificationVerified:false,identityBasis:"latest-native-retailer-sku-across-original-sources",note:"Datiertes ALDI-Nord-Sortiment aus Produkt- und Kategorieoriginalen. Jede native SKU zählt einmal; Berlinfiliale, heutiger Bestand und Kassenpreis sind nicht belegt."};
}
module.exports={SOURCE,MERCHANT,CHANNEL,SOURCE_IDS,FRONTIER,querySpec,search,status};
