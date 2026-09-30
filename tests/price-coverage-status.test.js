"use strict";
const assert=require("assert/strict"),Coverage=require("../price-coverage-status");
async function main(){
 let reads=0;const pool={query:async sql=>{
  reads++;if(sql===Coverage.SQL)return{rows:[{totalProducts:6100,researchableProducts:6098,currentEvidenceObservations:90,productsWithCurrentEvidence:88,proofReviewedObservations:0,productsWithReviewedEvidence:0,storesWithCurrentEvidence:16,stapleProducts:6000,staplesWithCurrentEvidence:2,families:[{family:"milk",products:250,currentEvidenceProducts:0,reviewedEvidenceProducts:0}]}]};
  if(sql.startsWith("SELECT stream_name"))return{rows:[{lastQueueSize:6598,processedTotal:"20",cycle:0,cursorKey:"20757601@*"}]};
  if(sql.startsWith("SELECT count"))return{rows:[{preserved:36120,repaired_at:"2026-09-30T18:00:00Z"}]};return{rows:[]};
 }};
 await assert.rejects(()=>Coverage.status(pool,{today:"2026-02-30"}),/invalid-date/);assert.equal(reads,0,"Invalid dates must not reach SQL");
 const result=await Coverage.status(pool,{today:"2026-09-30"});assert.equal(result.productsWithoutCurrentEvidence,6012);assert.equal(result.staplesWithoutCurrentEvidence,5998);assert.equal(result.proofReviewedObservations,0);assert.equal(result.research.queueSize,6598);assert.equal(result.research.processedAttempts,20);assert.equal(result.provenanceRepair.preservedObservations,36120);assert.equal(result.provenanceRepair.actualPriceDateKnown,false);assert(result.note.includes("Fetch time is not"));assert(result.note.includes("at least one German store"));
 await assert.rejects(()=>Coverage.status(null),/database-required/);console.log("price-coverage-status: ok");
}
main().catch(error=>{console.error(error);process.exitCode=1});
