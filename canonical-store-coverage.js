"use strict";
const Universe=require("./store-universe"),Discovery=require("./price-query-discovery");
function querySpec({productId,gtin,freshHours=24,merchant=null}={}){
 const requested=Number(freshHours),hours=Number.isFinite(requested)&&requested>0?Math.min(requested,168):24;
 const params=[hours],param=value=>{params.push(value);return"$"+params.length};
 const today="(now() AT TIME ZONE 'Europe/Berlin')::date",observed="COALESCE(po.observed_at,po.date::timestamptz)";
 const where=["css.status='verified'","s.active=true","m.active=true","upper(s.country)='DE'"],obs=[
  "po.store_id=css.store_id","po.price>0","po.price NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)","po.currency='EUR'","po.truth_eligible IS DISTINCT FROM false",
  observed+">=now()-($1::double precision*interval '1 hour')","po.date<="+today,"("+observed+" AT TIME ZONE 'Europe/Berlin')::date<="+today,
  "(po.valid_from IS NULL OR po.valid_from<="+today+")","(po.valid_to IS NULL OR po.valid_to>="+today+")"
 ];
 if(productId)obs.push("po.product_id="+param(productId));else if(gtin)obs.push("po.gtin="+param(String(gtin).replace(/\D/g,"")));else throw new Error("product-identity-required");
 if(merchant){const p=param(Discovery.merchantAliases(merchant));where.push("(lower(m.name)=ANY("+p+"::text[]) OR m.normalized_name=ANY("+p+"::text[]))")}
 const sql='SELECT css.store_id AS "storeId",MAX(m.name) AS merchant,MAX(s.address) AS address,MAX(s.postal_code) AS "postalCode",MAX(s.city) AS city,BOOL_OR(po.id IS NOT NULL) AS covered,MAX('+observed+') AS "lastObservedAt" FROM canonical_store_sources css JOIN stores s ON s.id=css.store_id JOIN merchants m ON m.id=s.merchant_id LEFT JOIN price_observations po ON '+obs.join(" AND ")+" WHERE "+where.join(" AND ")+' GROUP BY css.store_id ORDER BY covered ASC,"lastObservedAt" ASC NULLS FIRST';
 return{sql,params,freshHours:hours};
}
async function product(pool,options={}){
 if(!pool)throw new Error("database-required");const spec=querySpec(options);await Universe.ensure(pool);
 const q=await pool.query(spec.sql,spec.params),rows=q.rows,total=rows.length,covered=rows.filter(row=>row.covered===true).length;
 return{productId:options.productId||null,gtin:options.gtin||null,freshHours:spec.freshHours,totalStores:total,coveredStores:covered,missingStores:total-covered,coverage:total?covered/total:0,stores:rows};
}
module.exports={product,querySpec};
