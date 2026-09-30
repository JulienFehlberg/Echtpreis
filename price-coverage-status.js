"use strict";
const Day=require("./current-price-resolver").day,Clock=require("./current-price-query-service"),Checkpoints=require("./refresh-checkpoint-store"),Legacy=require("./legacy-rewe-provenance");
// Count evidence, never promote a source's attached proof into a reviewed proof.
const SQL=`WITH eligible AS MATERIALIZED (
 SELECT o.product_id,o.store_id,(o.identity_verified AND o.proof_verified) AS reviewed
 FROM price_observations o JOIN products p ON p.id=o.product_id AND p.gtin=o.gtin
 JOIN stores s ON s.id=o.store_id AND s.active=true AND s.country='DE'
 JOIN merchants m ON m.id=s.merchant_id AND m.active=true
 WHERE p.gtin ~ '^[0-9]{8,14}$' AND p.pack_amount>0 AND p.pack_count>0 AND p.pack_unit IN ('g','kg','ml','l','cl','item','piece')
 AND p.pack_amount NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) AND p.pack_count NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
 AND o.truth_eligible IS DISTINCT FROM false AND (o.evidence_purpose IS NULL OR o.evidence_purpose='current-price')
 AND COALESCE(o.source_type,'') NOT IN ('aggregated_open_data','price_archive','product_catalog','store_catalog','public_market_data','aggregator','third_party')
 AND o.currency='EUR' AND o.price>0 AND o.price NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
 AND o.proof IS NOT NULL AND btrim(o.proof)<>'' AND lower(o.proof_type) IN ('receipt','price_tag','shelf_photo','shelf','pos_feed','shelf-photo')
 AND o.date BETWEEN $1::date-7 AND $1::date
 AND COALESCE(o.observed_at::date,o.date) BETWEEN $1::date-7 AND $1::date
 AND (o.observed_at IS NULL OR o.observed_at<=now())
 AND (o.valid_from IS NULL OR o.valid_from<=$1::date) AND (o.valid_to IS NULL OR o.valid_to>=$1::date)
 ),byProduct AS (SELECT product_id,bool_or(reviewed) AS reviewed FROM eligible GROUP BY product_id)
 SELECT (SELECT count(*)::int FROM products) AS "totalProducts",
 (SELECT count(*)::int FROM products WHERE gtin ~ '^[0-9]{8,14}$') AS "researchableProducts",
 (SELECT count(*)::int FROM eligible) AS "currentEvidenceObservations",
 (SELECT count(*)::int FROM byProduct) AS "productsWithCurrentEvidence",
 (SELECT count(*)::int FROM eligible WHERE reviewed) AS "proofReviewedObservations",
 (SELECT count(*)::int FROM byProduct WHERE reviewed) AS "productsWithReviewedEvidence",
 (SELECT count(DISTINCT store_id)::int FROM eligible) AS "storesWithCurrentEvidence",
 (SELECT count(*)::int FROM product_catalog_metadata WHERE basket_family IS NOT NULL AND countries_tags ? 'en:germany') AS "stapleProducts",
 (SELECT count(*)::int FROM product_catalog_metadata cm JOIN byProduct bp ON bp.product_id=cm.product_id WHERE cm.basket_family IS NOT NULL AND cm.countries_tags ? 'en:germany') AS "staplesWithCurrentEvidence",
 COALESCE((SELECT jsonb_agg(f ORDER BY f.family) FROM (
 SELECT cm.basket_family AS family,count(*)::int AS products,count(bp.product_id)::int AS "currentEvidenceProducts",count(bp.product_id) FILTER(WHERE bp.reviewed)::int AS "reviewedEvidenceProducts"
 FROM product_catalog_metadata cm LEFT JOIN byProduct bp ON bp.product_id=cm.product_id
 WHERE cm.basket_family IS NOT NULL AND cm.countries_tags ? 'en:germany' GROUP BY cm.basket_family) f),'[]'::jsonb) AS families`;
async function status(pool,opts={}){
 if(!pool)throw new Error("database-required");const today=opts.today||Clock.today();if(!Day(today)||today.length!==10)throw new Error("invalid-date");
 const counts=(await pool.query(SQL,[today])).rows[0],checkpoint=await Checkpoints.load(pool,"Open Prices targets"),provenanceRepair=await Legacy.status(pool);
 return{ok:true,country:"DE",today,maxAgeDays:7,...counts,productsWithoutCurrentEvidence:counts.totalProducts-counts.productsWithCurrentEvidence,staplesWithoutCurrentEvidence:counts.stapleProducts-counts.staplesWithCurrentEvidence,
  research:{queueSize:Number(checkpoint.lastQueueSize),processedAttempts:Number(checkpoint.processedTotal),completedCycles:Number(checkpoint.cycle),cursorKey:checkpoint.cursorKey||null},provenanceRepair,
  note:"Coverage means recent evidence for an exact product in at least one German store. It does not establish national prices, availability, or eligibility for conditional offers. Attached source proofs are separate from reviewed proofs. Fetch time is not the price observation date."};
}
module.exports={SQL,status};
