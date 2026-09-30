"use strict";
const SOURCE="REWE daily open dataset",REASON="rewe-source-date-unknown-import-fetch-date";
const URLS=["https://raw.githubusercontent.com/L480/rewe-price-data/main/data/bavaria.csv","https://raw.githubusercontent.com/L480/rewe-price-data/main/data/schleswig-holstein.csv"];
// These exports contain no observation date. Their old importer manufactured it
// from fetch time. Never assign a guessed historical date to those rows.
const MATCH=`o.source=$1 AND o.source_id=$1 AND o.kind='external'
 AND o.source_type='aggregated_open_data' AND o.evidence_purpose='corroboration' AND o.truth_eligible=false
 AND o.source_url=ANY($2::text[]) AND o.proof ~ '^rewe:[0-9]+$' AND o.proof_verified=false
 AND o.fetched_at<'2026-09-30T17:00:00Z'::timestamptz
 AND o.date=(o.fetched_at AT TIME ZONE 'UTC')::date AND o.date=(o.observed_at AT TIME ZONE 'UTC')::date
 AND EXISTS(SELECT 1 FROM price_import_batches b WHERE b.id=o.import_batch_id AND b.source=$1 AND b.source_url=o.source_url)`;
async function repair(pool){
 if(!pool)throw new Error("database-required");const client=await pool.connect();
 try{
  await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[REASON]);
  const candidates=Number((await client.query("SELECT count(*)::int AS count FROM price_observations o WHERE "+MATCH,[SOURCE,URLS])).rows[0].count);
  if(!candidates){await client.query("COMMIT");return{moved:0,reason:REASON}}
  const batch=(await client.query("INSERT INTO price_import_batches(source,status,received,notes) VALUES($1,'running',$2,$3) RETURNING id",[SOURCE,candidates,"Provenance repair: complete original observations preserved in quarantine; the actual source price date is unknown."])).rows[0];
  const moved=await client.query(`WITH moved AS (DELETE FROM price_observations o WHERE ${MATCH} RETURNING o.*)
   INSERT INTO price_import_quarantine(batch_id,source,raw_payload,reason) SELECT $3,$1,to_jsonb(moved),$4 FROM moved`,[SOURCE,URLS,batch.id,REASON]);
  if(moved.rowCount!==candidates)throw new Error("provenance-repair-count-mismatch");
  await client.query("UPDATE price_import_batches SET status='finished',rejected=$2,finished_at=now() WHERE id=$1",[batch.id,moved.rowCount]);
  await client.query("COMMIT");return{moved:moved.rowCount,batchId:batch.id,reason:REASON};
 }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
}
async function status(pool){const row=(await pool.query("SELECT count(*)::int AS preserved,MAX(created_at) AS repaired_at FROM price_import_quarantine WHERE source=$1 AND reason=$2",[SOURCE,REASON])).rows[0];return{source:SOURCE,reason:REASON,preservedObservations:Number(row.preserved),lastRepairedAt:row.repaired_at||null,actualPriceDateKnown:false}}
module.exports={SOURCE,REASON,URLS,MATCH,repair,status};
