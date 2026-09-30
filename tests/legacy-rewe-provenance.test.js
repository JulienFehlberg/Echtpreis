"use strict";
const assert=require("assert/strict"),Legacy=require("../legacy-rewe-provenance");
function database({candidates=1,moved=1,failInsert=false,failConnect=false}={}){
 const calls=[];let releases=0;
 const client={query:async(sql,params=[])=>{calls.push({sql,params});if(sql.startsWith("SELECT count(*)"))return{rows:[{count:candidates}]};if(sql.startsWith("INSERT INTO price_import_batches"))return{rows:[{id:"repair-batch"}]};if(sql.startsWith("WITH moved")){if(failInsert)throw new Error("quarantine-insert-failed");return{rowCount:moved,rows:[]}}return{rows:[],rowCount:0}},release(){releases++}};
 return{calls,get releases(){return releases},connect:async()=>{if(failConnect)throw new Error("connect-failed");return client}};
}
(async()=>{
 const pool=database(),result=await Legacy.repair(pool);assert.equal(result.moved,1);assert.equal(result.batchId,"repair-batch");assert.equal(pool.releases,1);assert.equal(pool.calls[0].sql,"BEGIN");assert.equal(pool.calls.at(-1).sql,"COMMIT");
 const count=pool.calls.find(call=>call.sql.startsWith("SELECT count(*)"));assert.deepEqual(count.params,[Legacy.SOURCE,Legacy.URLS]);assert.equal(Legacy.SOURCE,"REWE daily open dataset");
 const empty=database({candidates:0});assert.equal((await Legacy.repair(empty)).moved,0);assert.equal(empty.releases,1);assert.equal(empty.calls.at(-1).sql,"COMMIT");assert(!empty.calls.some(call=>call.sql.startsWith("WITH moved")));
 for(const [config,expected]of[[{failInsert:true},/quarantine-insert-failed/],[{moved:0},/provenance-repair-count-mismatch/]]){const failed=database(config);await assert.rejects(()=>Legacy.repair(failed),expected);assert.equal(failed.calls.at(-1).sql,"ROLLBACK");assert.equal(failed.releases,1);assert(!failed.calls.some(call=>call.sql==="COMMIT"))}
 const noConnection=database({failConnect:true});await assert.rejects(()=>Legacy.repair(noConnection),/connect-failed/);assert.equal(noConnection.releases,0);assert.equal(noConnection.calls.length,0);await assert.rejects(()=>Legacy.repair(null),/database-required/);
 const status=await Legacy.status({query:async()=>({rows:[{preserved:2,repaired_at:"2026-09-30T18:00:00Z"}]})});assert.equal(status.preservedObservations,2);assert.equal(status.actualPriceDateKnown,false);
 console.log("legacy-rewe-provenance: transaction/release discipline, empty idempotence, quarantine failure and count mismatch rollback, known daily source and honest date status OK");
})().catch(error=>{console.error(error);process.exitCode=1});
