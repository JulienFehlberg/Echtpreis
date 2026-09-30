const assert=require("assert"),R=require("../price-source-refresh"),S=require("../price-sources").SOURCES;
assert.strictEqual(R.interval(S["ECHTPREIS POS feed"]),60000);
assert.strictEqual(R.interval(S["Open Prices"]),3600000);
assert.strictEqual(R.interval(S["Open Food Facts"]),86400000);
assert.strictEqual(R.due({...S["Open Prices"],active:true},{lastSuccessAt:"2026-09-30T08:00:00Z"},Date.parse("2026-09-30T09:01:00Z")),true);
assert.strictEqual(R.due({...S["Open Prices"],active:true},{lastSuccessAt:"2026-09-30T08:30:00Z"},Date.parse("2026-09-30T09:00:00Z")),false);
assert.strictEqual(R.freshness({...S["Open Prices"],active:true},"2026-09-30T05:00:00Z",Date.parse("2026-09-30T09:00:00Z")).state,"stale");
const plan=R.plan({"Open Prices":{lastSuccessAt:"2026-09-30T07:00:00Z"}},Date.parse("2026-09-30T09:00:00Z"));assert(plan.some(x=>x.name==="Open Prices"&&x.due));
console.log("price-source-refresh: ok");
