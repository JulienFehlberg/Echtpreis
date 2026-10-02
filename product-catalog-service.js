"use strict";
const crypto=require("crypto");
const Import=require("./canonical-product-catalog-import");
const Client=require("./open-food-facts-catalog-client");
const Snapshot=require("./product-catalog-snapshot");
const Basket=require("./german-basket-priorities");
const Lease=require("./price-refresh-state-store");
const SOURCE="Open Food Facts",LEASE="German product catalog";
let running=false;
async function ensure(pool){if(!pool)return;await pool.query(`CREATE TABLE IF NOT EXISTS product_catalog_metadata(product_id uuid PRIMARY KEY REFERENCES products(id),source_id text NOT NULL,countries_tags jsonb NOT NULL,categories_tags jsonb NOT NULL DEFAULT '[]'::jsonb,basket_family text,priority int NOT NULL DEFAULT 0,popularity numeric NOT NULL DEFAULT 0,source_url text NOT NULL,fetched_at timestamptz NOT NULL DEFAULT now());CREATE INDEX IF NOT EXISTS product_catalog_priority_idx ON product_catalog_metadata(priority DESC,basket_family);CREATE TABLE IF NOT EXISTS product_catalog_runs(id uuid PRIMARY KEY,source text NOT NULL,status text NOT NULL DEFAULT 'running',target_products int NOT NULL,source_url text,result jsonb,error text,started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz);CREATE INDEX IF NOT EXISTS product_catalog_runs_latest_idx ON product_catalog_runs(started_at DESC);`)}
async function count(pool){return(await pool.query("SELECT count(*)::int AS total FROM products")).rows[0].total}
async function stapleCount(pool){return(await pool.query("SELECT count(*)::int AS total FROM product_catalog_metadata WHERE basket_family IS NOT NULL AND countries_tags ? 'en:germany'")).rows[0].total}
async function lastRun(pool){await ensure(pool);return(await pool.query('SELECT id,source,status,target_products AS "targetProducts",source_url AS "sourceUrl",result,error,started_at AS "startedAt",finished_at AS "finishedAt" FROM product_catalog_runs ORDER BY started_at DESC LIMIT 1')).rows[0]||null}
function target(value){const n=Number(value);return Number.isSafeInteger(n)?Math.min(10000,Math.max(5000,n)):6000}
async function refresh(pool,input={},deps={}){
 if(!pool)throw new Error("catalog-database-required");const allowed=()=>typeof deps.shouldContinue!=="function"||deps.shouldContinue();if(!allowed())return{ok:false,skipped:"server-stopping"};if(running)return{ok:false,skipped:"already-running"};running=true;
 const goal=target(input.targetProducts),owner="catalog-"+crypto.randomUUID(),started=Date.now();let leased=false,runId=null;
 try{
  const last=await lastRun(pool),before=await count(pool),staplesBefore=await stapleCount(pool),age=last?Date.now()-Date.parse(last.finishedAt||last.startedAt):Infinity;
  if(!input.force&&staplesBefore>=goal&&last?.status==="finished"&&age<7*86400000)return{ok:true,skipped:"catalog-current",totalProducts:before,stapleProducts:staplesBefore,minimumReached:staplesBefore>=5000,targetReached:staplesBefore>=goal};
  if(!input.force&&age<300000&&last?.status!=="finished")return{ok:false,skipped:"retry-backoff",totalProducts:before};
  if(!allowed())return{ok:false,skipped:"server-stopping"};
  leased=await Lease.acquire(pool,LEASE,owner,900000);if(!leased)return{ok:false,skipped:"lease-held"};
  if(!allowed())return{ok:false,skipped:"server-stopping"};
  runId=crypto.randomUUID();await pool.query("INSERT INTO product_catalog_runs(id,source,target_products) VALUES($1,$2,$3)",[runId,SOURCE,goal]);
  const scan=await(deps.collect||Snapshot.fetchCatalog)({limit:20000,maxBytes:300*1024*1024,maxDurationMs:180000});
  if(scan.ok===false&&!(scan.products?.length))throw new Error(scan.error||"catalog-export-unavailable");
  const raw=Array.isArray(scan.products)?scan.products:[],chosen=Basket.select(raw,{limit:goal,minPerFamily:60,includeOther:false});
  const selected=Array.isArray(chosen)?chosen:chosen.products||chosen.items||[];
  const saved=await Import.importBatch(pool,selected,{sourceId:SOURCE,sourceUrl:scan.sourceUrl||Client.SOURCE_URL,fetchedAt:scan.fetchedAt,limit:10000});
  const byGtin=new Map(selected.map(p=>[String(p.code),p])),metadata=saved.accepted.map(p=>{const raw=byGtin.get(p.gtin)||{},classified=Basket.family(raw);return{productId:p.productId,countries:raw.countries_tags||[],categories:raw.categories_tags||[],family:typeof classified==="string"?classified:classified?.id||classified?.key||null,priority:Math.round((Number(Basket.score(raw))||0)/100),popularity:Number.isFinite(Number(raw.unique_scans_n))?Math.max(0,Number(raw.unique_scans_n)):0,sourceUrl:p.sourceUrl}});
  if(metadata.length)await pool.query(`INSERT INTO product_catalog_metadata(product_id,source_id,countries_tags,categories_tags,basket_family,priority,popularity,source_url) SELECT x."productId",$2,x.countries,x.categories,x.family,x.priority,x.popularity,x."sourceUrl" FROM jsonb_to_recordset($1::jsonb) AS x("productId" uuid,countries jsonb,categories jsonb,family text,priority int,popularity numeric,"sourceUrl" text) ON CONFLICT(product_id) DO UPDATE SET countries_tags=EXCLUDED.countries_tags,categories_tags=EXCLUDED.categories_tags,basket_family=EXCLUDED.basket_family,priority=EXCLUDED.priority,popularity=EXCLUDED.popularity,source_url=EXCLUDED.source_url,fetched_at=now()`,[JSON.stringify(metadata),SOURCE]);
  const total=await count(pool),staples=await stapleCount(pool),result={ok:scan.ok!==false,runId,totalProducts:total,stapleProducts:staples,minimumReached:staples>=5000,targetReached:staples>=goal,targetProducts:goal,selected:selected.length,scan:{sourceUrl:scan.sourceUrl||Client.SOURCE_URL,rowsScanned:scan.rowsScanned??scan.rowsRead,bytesRead:scan.bytesRead,eligibleProducts:raw.length,complete:scan.complete,stopReason:scan.stopReason||scan.reason||null,snapshot:scan.snapshot||null},import:saved.counts,reasons:require("./price-inventory-service").reasonCounts(saved.rejected),families:Basket.coverage(selected),purpose:"identity",truthEligible:false,attribution:Import.ATTRIBUTION,durationMs:Date.now()-started};
  await pool.query("UPDATE product_catalog_runs SET status=$2,source_url=$3,result=$4::jsonb,error=$5,finished_at=now() WHERE id=$1",[runId,staples>=goal&&scan.ok!==false?"finished":"partial",scan.sourceUrl||Client.SOURCE_URL,JSON.stringify(result),scan.error||null]);return result;
 }catch(error){if(runId)await pool.query("UPDATE product_catalog_runs SET status='failed',error=$2,finished_at=now() WHERE id=$1",[runId,String(error.message||error).slice(0,200)]);throw error}
 finally{try{if(leased)await Lease.release(pool,LEASE,owner)}finally{running=false}}
}
async function status(pool){if(!pool)throw new Error("catalog-database-required");await ensure(pool);const last=await lastRun(pool),total=await count(pool),staples=await stapleCount(pool);const families=(await pool.query('SELECT basket_family AS family,count(*)::int AS products FROM product_catalog_metadata WHERE basket_family IS NOT NULL GROUP BY basket_family ORDER BY products DESC,basket_family')).rows;return{ok:true,country:"DE",running,totalProducts:total,minimumProducts:5000,stapleProducts:staples,minimumReached:staples>=5000,families,lastRun:last,attribution:Import.ATTRIBUTION,note:"Product identities are separate from current store-specific price evidence."}}
function searchSpec(input={}){
 const search=String(input.search||"").trim().slice(0,80),family=String(input.family||"").trim().slice(0,80),params=[],where=[];
 if(search){params.push("%"+search.replace(/[\\%_]/g,"\\$&")+"%");where.push('(p.name ILIKE $1 OR p.brand ILIKE $1 OR p.gtin ILIKE $1)')}
 if(family){params.push(family);where.push("cm.basket_family=$"+params.length)}
 const n=Number(input.limit),limit=Number.isSafeInteger(n)?Math.min(100,Math.max(1,n)):30;params.push(limit);
 const sql='SELECT p.id,p.gtin,p.name,p.brand,p.pack_amount::float AS "packAmount",p.pack_unit AS "packUnit",p.pack_count::float AS "packCount",cm.basket_family AS "basketFamily",cm.priority,cm.source_url AS "sourceUrl" FROM products p LEFT JOIN product_catalog_metadata cm ON cm.product_id=p.id '+(where.length?"WHERE "+where.join(" AND "):"")+' ORDER BY COALESCE(cm.priority,0) DESC,p.name,p.gtin LIMIT $'+params.length;
 return{sql,params};
}
async function search(pool,input={}){if(!pool)throw new Error("catalog-database-required");await ensure(pool);const spec=searchSpec(input);return{ok:true,items:(await pool.query(spec.sql,spec.params)).rows,attribution:Import.ATTRIBUTION}}
module.exports={SOURCE,LEASE,ensure,count,stapleCount,lastRun,target,refresh,status,searchSpec,search};
