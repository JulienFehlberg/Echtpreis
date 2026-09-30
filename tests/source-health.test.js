const assert=require("assert"),S=require("../source-health");
let h=S.health({received:100,accepted:98,proofRate:.95,gtinRate:.8,freshnessHours:2,calibration:{grade:"excellent"}});assert.strictEqual(h.state,"healthy");
let bad=S.health({received:100,accepted:30,proofRate:.1,gtinRate:.1,freshnessHours:300,calibration:{grade:"poor"}});assert.strictEqual(bad.state,"quarantine");assert(S.trustAdjustment(bad)<-20);
const rows=[{price:2.99,proof:"a",source:"receipt",kind:"receipt"},{price:3.01,proof:"b",source:"receipt",kind:"receipt"},{price:2.98,proof:"c",source:"receipt",kind:"receipt"},{price:9.99,proof:"z",source:"receipt",kind:"receipt"}];assert.strictEqual(S.outliers(rows).length,1);
assert.strictEqual(S.independentGroups([{kind:"receipt",source:"x",receiptId:"r1"},{kind:"receipt",source:"x",receiptId:"r1"},{kind:"receipt",source:"x",receiptId:"r2"}]),2);
assert.strictEqual(S.refreshHealth("2026-09-30T08:30:00Z",3600000,Date.parse("2026-09-30T09:00:00Z")).state,"fresh");assert.strictEqual(S.refreshHealth("2026-09-30T05:00:00Z",3600000,Date.parse("2026-09-30T09:00:00Z")).state,"stale");
console.log("source-health: ok");