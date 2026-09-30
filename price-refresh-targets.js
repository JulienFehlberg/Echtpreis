"use strict";
const Info=require("./information-gain");
const MAX=500;
const popularity=x=>Number.isFinite(Number(x.catalogPopularity))?Math.max(0,Number(x.catalogPopularity)):0;
function score(x={},now=Date.now()){const last=x.lastObservedAt?new Date(x.lastObservedAt).getTime():0,age=last?Math.max(0,(now-last)/864e5):999,demand=Math.max(0,Math.min(1,Number(x.demandScore||0))),observations=Math.max(0,Number(x.observationCount||0));const legacy=Math.min(100,(last?Math.min(45,age*4):55)+demand*30+(observations?0:15)),gain=Info.score(x,now);const catalogPriority=Math.max(0,Math.min(100,Number(x.catalogPriority)||0));return Math.round(Object.hasOwn(x,"catalogPriority")?catalogPriority*.75+(legacy*.35+gain*.65)*.25:legacy*.35+gain*.65)}
function rank(rows=[],opts={}){const now=opts.now??Date.now(),limit=opts.fullCoverage===true?rows.length:Math.max(1,Math.min(5000,Number(opts.limit)||MAX)),seen=new Set();return rows.filter(x=>/^\d{8,14}$/.test(String(x.gtin||""))).map(x=>({...x,refreshPriority:score(x,now)})).sort((a,b)=>b.refreshPriority-a.refreshPriority||popularity(b)-popularity(a)||String(a.gtin).localeCompare(String(b.gtin))).filter(x=>{if(seen.has(String(x.gtin)))return false;seen.add(String(x.gtin));return true}).slice(0,limit).map(x=>({productCode:String(x.gtin),productId:x.productId||null,priority:x.refreshPriority,informationGain:Info.explain(x,now)}))}
function querySpec(opts={}){
 const fullCoverage=opts.fullCoverage===true,limit=Math.max(1,Math.min(5000,Number(opts.candidateLimit)||2000));
 const sql=`WITH eligibleObservations AS MATERIALIZED (
 SELECT product_id,gtin,COALESCE(observed_at,date::timestamptz) AS observed_at
 FROM price_observations
 WHERE truth_eligible IS DISTINCT FROM false AND (evidence_purpose IS NULL OR evidence_purpose='current-price')
 AND COALESCE(source_type,'') NOT IN ('aggregated_open_data','price_archive','product_catalog','store_catalog','public_market_data','aggregator','third_party')
 AND currency='EUR' AND price>0 AND price NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
 AND date<=(now() AT TIME ZONE 'Europe/Berlin')::date AND COALESCE(observed_at,date::timestamptz)<=now()
 ),obsByProduct AS (
 SELECT product_id,MAX(observed_at) AS last_observed_at,COUNT(*) AS observation_count FROM eligibleObservations WHERE product_id IS NOT NULL GROUP BY product_id
 ),obsByGtin AS (
 SELECT gtin,MAX(observed_at) AS last_observed_at,COUNT(*) AS observation_count FROM eligibleObservations WHERE product_id IS NULL AND gtin IS NOT NULL GROUP BY gtin
 ),assortmentByProduct AS (
 SELECT product_key,MAX(confidence)::float AS demand_score FROM store_assortment GROUP BY product_key
 )
 SELECT p.id AS "productId",p.gtin,COALESCE(cm.priority,0)::float AS "catalogPriority",COALESCE(cm.popularity,0)::float AS "catalogPopularity",
 GREATEST(op.last_observed_at,og.last_observed_at) AS "lastObservedAt",(COALESCE(op.observation_count,0)+COALESCE(og.observation_count,0))::int AS "observationCount",COALESCE(sa.demand_score,0)::float AS "demandScore"
 FROM products p LEFT JOIN product_catalog_metadata cm ON cm.product_id=p.id
 LEFT JOIN obsByProduct op ON op.product_id=p.id LEFT JOIN obsByGtin og ON og.gtin=p.gtin
 LEFT JOIN assortmentByProduct sa ON sa.product_key=p.id::text
 WHERE p.gtin IS NOT NULL
 ORDER BY COALESCE(cm.priority,0) DESC,COALESCE(cm.popularity,0) DESC,GREATEST(op.last_observed_at,og.last_observed_at) ASC NULLS FIRST${fullCoverage?"":" LIMIT $1"}`;
 return{sql,params:fullCoverage?[]:[limit]};
}
// The complete queue is bounded by the real product inventory; request budgets belong to the refresh runner.
async function fromDatabase(pool,opts={}){if(!pool)return[];const query=querySpec(opts),q=await pool.query(query.sql,query.params);return rank(q.rows,{...opts,limit:opts.limit||MAX})}
function batches(targets=[],size=50){const n=Math.max(1,Math.min(500,Number(size)||50)),out=[];for(let i=0;i<targets.length;i+=n)out.push(targets.slice(i,i+n));return out}
module.exports={score,rank,batches,fromDatabase,querySpec};
