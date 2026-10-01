"use strict";
const crypto=require("crypto");
const Client=require("./open-prices-inventory-client");
const Canonical=require("./canonical-inventory-import");
const Provider=require("./providers/open-prices");
const Import=require("./external-price-import");
const State=require("./price-refresh-state-store");
const Clock=require("./current-price-query-service");
const SOURCE="Open Prices",LEASE="Open Prices inventory";
const DEFAULT_REGION="Berlin";
const ATTRIBUTION={source:"Open Prices / Open Food Facts",url:"https://prices.openfoodfacts.org",license:"ODbL-1.0",licenseUrl:"https://opendatacommons.org/licenses/odbl/1-0/",locations:"OpenStreetMap contributors",locationsUrl:"https://www.openstreetmap.org/copyright"};
let running=false;
async function ensure(pool){await pool.query(`CREATE TABLE IF NOT EXISTS price_inventory_runs(id uuid PRIMARY KEY,source text NOT NULL,country text NOT NULL DEFAULT 'DE',window_since date NOT NULL,window_until date NOT NULL,status text NOT NULL DEFAULT 'running',cursor jsonb,result jsonb,error text,started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz);CREATE INDEX IF NOT EXISTS price_inventory_runs_latest_idx ON price_inventory_runs(started_at DESC);`)}
async function lastRun(pool){await ensure(pool);return(await pool.query('SELECT id,source,country,window_since::text AS "since",window_until::text AS "until",status,cursor,result,error,started_at AS "startedAt",finished_at AS "finishedAt" FROM price_inventory_runs ORDER BY started_at DESC LIMIT 1')).rows[0]||null}
function reasonCounts(rejected=[]){const counts={};for(const row of rejected)for(const reason of row.reasons||[])counts[reason]=(counts[reason]||0)+1;return counts}
function due(last,nowMs=Date.now(),intervalMs=3600000){if(!last)return true;const value=last.finishedAt||last.startedAt,stamp=value==null?NaN:new Date(value).getTime();const interval=Number.isFinite(Number(intervalMs))?Math.max(60000,Number(intervalMs)):3600000;const delay=last.status==="finished"?interval:last.status==="partial"?60000:300000;return !Number.isFinite(stamp)||nowMs-stamp>=delay}
function sameRunScope(last,normalized){
 if(!last)return false;
 const saved=last.result?.scope,cursor=last.cursor,selected=Client.scopeMetadata(normalized.region,normalized.locationIds);
 if(saved){if(saved.country!=="DE"||saved.region!==selected.region||!Array.isArray(saved.locationIds)||saved.locationIds.join(",")!==normalized.scope)return false;return selected.geo?Client.sameGeo(saved.geo):saved.geo==null}
 return(cursor?.region??"DE")===selected.region&&String(cursor?.locationIds||"")===normalized.scope&&(selected.region!=="Berlin"||Client.sameGeo(cursor?.geo));
}
async function refresh(pool,input={},deps={}){
 if(!pool)throw new Error("inventory-database-required");
 const today=input.today||Clock.today(),normalized=Client.normalizeInput({today,maxPages:input.maxPages??20,size:100,region:input.region??DEFAULT_REGION,locationIds:input.locationIds}),scope=Client.scopeMetadata(normalized.region,normalized.locationIds);
 if(running)return{ok:false,skipped:"already-running"};
 running=true;const owner="inventory-"+crypto.randomUUID();let leased=false,runId=null,last=null,started=Date.now();
 try{
  last=await lastRun(pool);
  const compatible=sameRunScope(last,normalized);
  // A finished nationwide scan must not delay Berlin's first scan. An upstream
  // failure still retains its existing cooldown when changing the region.
  const sourceFailed=last?.status==="failed"||!!last?.error||last?.result?.ok===false;
  if(!input.force&&(compatible||sourceFailed)&&!due(last,started,input.intervalMs))return{ok:true,skipped:"not-due",scope,lastRun:last};
  leased=await State.acquire(pool,LEASE,owner,900000);
  if(!leased)return{ok:false,skipped:"lease-held"};
  const cursor=compatible&&last.status!=="finished"&&Client.cursorMatches(last.cursor,normalized)?last.cursor:null;
  runId=crypto.randomUUID();
  await pool.query("INSERT INTO price_inventory_runs(id,source,window_since,window_until,cursor,result) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)",[runId,SOURCE,normalized.since,today,JSON.stringify(cursor),JSON.stringify({scope})]);
  const collected=await Client.fetchInventory({...normalized,cursor},deps.fetchImpl||fetch);
  if(!collected.fetchedPages&&collected.error)throw new Error(collected.error);
  const providerRejected=[],candidates=[],adapted=new Map();
  for(const raw of collected.items){const p=Provider.adapt([raw],{sourceUrl:collected.sourceUrl,fetchedAt:collected.fetchedAt});if(p.accepted.length){candidates.push(raw);adapted.set(raw.id,p.accepted[0])}else providerRejected.push(...p.rejected.map(r=>({raw,reasons:r.reasons})))}
  const catalog=await Canonical.prepare(pool,candidates,{sourceId:SOURCE,sourceUrl:collected.sourceUrl,fetchedAt:collected.fetchedAt,limit:2000});
  const accepted=catalog.accepted.map(p=>({...adapted.get(p.raw.id),merchant:p.merchant,product:p.product,brand:p.brand,pack:p.pack,packAmount:p.packAmount*(p.packCount||1),packUnit:p.packUnit,region:p.region,productId:p.productId,storeId:p.storeId,gtin:p.gtin,externalProductId:p.externalProductId,externalLocationId:p.externalLocationId}));
  const rejected=[...providerRejected,...catalog.rejected];
  const saved=await Import.persist(pool,{accepted,rejected},{source:SOURCE,sourceUrl:collected.sourceUrl});
  const result={ok:collected.ok,runId,country:"DE",scope,independentOfUserReceipts:true,assortmentComplete:false,physicalStoreAssortmentVerified:false,window:collected.window,scan:{complete:collected.complete,completenessBasis:"source-query-pagination",sourceTotal:collected.total,worldwideTotal:normalized.region==="DE"?collected.total:null,received:collected.received,germanPrices:collected.items.length,berlinPrices:collected.items.filter(row=>Client.berlinLocation(row.location||{})).length,fetchedPages:collected.fetchedPages,sourceRejected:reasonCounts(collected.rejected)},catalog:catalog.counts,import:saved,reasons:reasonCounts(rejected),cursor:collected.cursor,attribution:ATTRIBUTION,durationMs:Date.now()-started};
  const status=collected.complete?"finished":"partial";
  if(collected.ok)await pool.query("INSERT INTO price_source_registry(source,source_type,base_trust,license,terms_url,attribution,commercial_use_status,last_success_at,notes) VALUES($1,'open_data',78,'ODbL-1.0',$2,$3,'allowed',now(),'Regional price inventory; exact GTIN and OSM identities; price evidence remains observed') ON CONFLICT(source) DO UPDATE SET last_success_at=now(),license=EXCLUDED.license,terms_url=EXCLUDED.terms_url,attribution=EXCLUDED.attribution,notes=EXCLUDED.notes",[SOURCE,ATTRIBUTION.licenseUrl,Canonical.ATTRIBUTION]);
  await pool.query("UPDATE price_inventory_runs SET status=$2,cursor=$3::jsonb,result=$4::jsonb,error=$5,finished_at=now() WHERE id=$1",[runId,status,JSON.stringify(collected.cursor),JSON.stringify(result),collected.error||null]);
  return result;
 }catch(error){if(runId)await pool.query("UPDATE price_inventory_runs SET status='failed',error=$2,finished_at=now() WHERE id=$1",[runId,String(error.message||error).slice(0,200)]);throw error}
 finally{try{if(leased)await State.release(pool,LEASE,owner)}finally{running=false}}
}
async function status(pool,options={}){
 if(!pool)throw new Error("inventory-database-required");
 const today=options.today||Clock.today(),scope=Client.scopeMetadata(options.region??DEFAULT_REGION),last=await lastRun(pool);
 const counts=(await pool.query(`SELECT (SELECT count(*)::int FROM products) AS products,(SELECT count(*)::int FROM stores WHERE active=true) AS stores,count(*)::int AS current_observations,count(DISTINCT o.product_id)::int AS current_products,count(DISTINCT o.store_id)::int AS current_stores,count(*) FILTER(WHERE o.status='verified' AND o.proof_verified=true AND o.identity_verified=true)::int AS reviewed_observations FROM price_observations o JOIN products p ON p.id=o.product_id JOIN stores s ON s.id=o.store_id WHERE o.source_id=$1 AND o.date BETWEEN ($2::date-7) AND $2::date AND o.currency='EUR' AND o.truth_eligible=true AND s.active=true AND s.country='DE'`,[SOURCE,today])).rows[0];
 const samples=(await pool.query(`SELECT p.id AS "productId",p.gtin,p.name,p.brand,p.pack_amount::float AS "packAmount",p.pack_unit AS "packUnit",p.pack_count::float AS "packCount",s.id AS "storeId",m.name AS merchant,s.address,s.postal_code AS "postalCode",s.city,o.price::float AS price,o.per,o.price_type AS "priceType",o.date::text AS date,o.source_url AS "sourceUrl",o.status AS "evidenceStatus" FROM price_observations o JOIN products p ON p.id=o.product_id JOIN stores s ON s.id=o.store_id JOIN merchants m ON m.id=s.merchant_id WHERE o.source_id=$1 AND o.date BETWEEN ($2::date-7) AND $2::date AND o.currency='EUR' AND o.truth_eligible=true AND s.active=true AND s.country='DE' ORDER BY o.date DESC,o.created_at DESC LIMIT 10`,[SOURCE,today])).rows;
 const bounds=[Client.BERLIN.minLat,Client.BERLIN.maxLat,Client.BERLIN.minLon,Client.BERLIN.maxLon],berlinWhere="s.active=true AND s.country='DE' AND lower(btrim(s.city))='berlin' AND s.latitude BETWEEN $3 AND $4 AND s.longitude BETWEEN $5 AND $6";
 const berlinCoverage=(await pool.query(`SELECT (SELECT count(*)::int FROM stores s WHERE ${berlinWhere}) AS stores,count(*)::int AS current_observations,count(DISTINCT o.product_id)::int AS current_products,count(DISTINCT o.store_id)::int AS current_stores,count(*) FILTER(WHERE o.status='verified' AND o.proof_verified=true AND o.identity_verified=true)::int AS reviewed_observations FROM price_observations o JOIN products p ON p.id=o.product_id JOIN stores s ON s.id=o.store_id WHERE o.source_id=$1 AND o.date BETWEEN ($2::date-7) AND $2::date AND o.currency='EUR' AND o.truth_eligible=true AND ${berlinWhere}`,[SOURCE,today,...bounds])).rows[0];
 const berlinSamples=(await pool.query(`SELECT p.id AS "productId",p.gtin,p.name,p.brand,p.pack_amount::float AS "packAmount",p.pack_unit AS "packUnit",p.pack_count::float AS "packCount",s.id AS "storeId",m.name AS merchant,s.address,s.postal_code AS "postalCode",s.city,o.price::float AS price,o.per,o.price_type AS "priceType",o.date::text AS date,o.source_url AS "sourceUrl",o.status AS "evidenceStatus" FROM price_observations o JOIN products p ON p.id=o.product_id JOIN stores s ON s.id=o.store_id JOIN merchants m ON m.id=s.merchant_id WHERE o.source_id=$1 AND o.date BETWEEN ($2::date-7) AND $2::date AND o.currency='EUR' AND o.truth_eligible=true AND ${berlinWhere} ORDER BY o.date DESC,o.created_at DESC LIMIT 10`,[SOURCE,today,...bounds])).rows;
 return{ok:true,country:"DE",scope,today,running,lastRun:last,coverage:counts,berlinCoverage,samples,berlinSamples,independentOfUserReceipts:true,assortmentComplete:false,physicalStoreAssortmentVerified:false,attribution:ATTRIBUTION};
}
module.exports={SOURCE,LEASE,DEFAULT_REGION,ATTRIBUTION,ensure,lastRun,reasonCounts,due,sameRunScope,refresh,status};
