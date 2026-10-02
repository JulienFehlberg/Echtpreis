"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const Gate = require("../hit-partition-admission-gate"), F = require("./fixtures/hit-partition-admission-gate");
const Native = require("../hit-assortment-client"), Import = require("../hit-price-import"), Collector = require("../hit-assortment-collector");
const clone = structuredClone;
async function main() {
  let count = 0;
  const originalDateNow = Date.now; let testNow = F.NOW;
  Date.now = () => testNow;
  try {
  const test = async (name, fn) => { try { await fn(); count++; } catch (error) { throw new Error(name, { cause: error }); } };
  const batch = await F.batch(), state = F.state(batch), evaluate = (r = batch.result, s = state, options = {}) => Gate.evaluate(r, s, { now: batch.time, ...options });
  const baseline = evaluate(), previous = F.snapshot(batch);
  await test("bound actual collector record returns eight literal new candidates", () => {
    assert.equal(baseline.candidates.length, 8); assert.equal(baseline.duplicateSkus.length, 4);
    assert.deepEqual(baseline.candidates.map(c => c.retailerSku), [41, 42, 43, 44, 45, 46, 47, 48].map(F.sku));
  });
  await test("disabled output cannot authorize import, collection, DB or completeness", () => {
    for (const key of ["priceImportEnabled", "collectionEnabled", "complete", "databaseAuthorityVerified", "importAuthorized"]) assert.equal(baseline[key], false);
    assert.equal(batch.result.brandPartitionProbe.priceImportEnabled, false);
  });
  await test("exact production validator, raw brand and unknown deposit stay unchanged", () => {
    for (const c of baseline.candidates) { assert(Import.validateCandidate(c, { now: batch.time }).ok); assert.equal(c.brand, null); assert.equal(c.depositCents, null); }
  });
  await test("all input and ordinary cursor/counter/queue remain unmodified", () => {
    const before = clone({ result: batch.result, state, previous }); evaluate(batch.result, state, { previousPartitions: [previous] });
    assert.deepEqual({ result: batch.result, state, previous }, before);
  });
  await test("caller supplied context never creates authority", () => {
    assert.deepEqual(evaluate(batch.result, state, { ordinaryContext: { seenSkus: [] }, partitionContext: {} }).candidates, baseline.candidates);
  });
  await test("explicit original capture/expiry/ref hashes are preserved", () => {
    assert.equal(baseline.original.capturedAt, batch.result.brandPartitionProbe.filtered.meta.capturedAt);
    assert.equal(Date.parse(baseline.original.expiresAt), Date.parse(baseline.original.capturedAt) + 86400000);
    assert.deepEqual(baseline.candidateRefs, baseline.candidates.map(Gate.referenceFor));
  });
  await test("no actual diagnostic gives no new filtered candidate", () => {
    const r = clone(batch.result); r.brandPartitionProbe = null; assert.equal(evaluate(r).candidates.length, 0);
  });
  await test("first admission after five minutes is refused despite24h expiry", () => {
    assert.throws(() => evaluate(batch.result, state, { now: batch.time + 300001 }));
  });
  await test("future capture by1ms is refused", () => { assert.throws(() => evaluate(batch.result, state, { now: F.NOW - 1 })); });
  for (const [name, edit, diagnosticOnly] of [
    ["original body rewrite", x => { x.brandPartitionProbe.filtered.body += "rewritten"; }, true],
    ["hash rewrite", x => { x.brandPartitionProbe.filtered.meta.sourceResponseHash = "a".repeat(64); }, true],
    ["wrong filter echo", x => { x.brandPartitionProbe.requestedUrl += "&for_brands=OTHER"; }],
    ["reported outcome cannot manufacture literal filtered row", x => { x.brandPartitionProbe.filtered.body = x.brandPartitionProbe.control.body; x.brandPartitionProbe.outcome = "confirmed"; }, true],
    ["control-time quote context rewrite", x => { x.brandPartitionProbe.nativeState.seenQuotes = {}; }],
    ["full store profile country conflict", x => { x.pages[0].storeProfile.country = "AT"; }],
    ["unknown ordinary page URL", x => { x.pages[0].sourceResponseUrl = x.brandPartitionProbe.requestedUrl; }],
    ["prior queue erased", x => { x.cursor.pending = []; x.cursor.categoryCoverage.pending = x.categoryCoverage.pending = 0; }],
    ["old visited history rewritten", x => { x.cursor.visited[0].url = "https://www.hit.de/sortiment"; }],
    ["new native quote sidecar removed", x => { x.pages[0].nativeQuoteRows = []; }],
    ["normal SKU fabricated", x => { x.pages[0].nativeAllSkuIds[0] = F.sku(900); }],
    ["normal future response Date", x => { x.pages[0].responseDate = new Date(batch.time + 1000).toUTCString(); }]
  ]) await test(name, () => { const x = clone(batch.result); edit(x); if (diagnosticOnly) assert.equal(evaluate(x).candidates.length, 0); else assert.throws(() => evaluate(x)); });
  await test("accepted filtered candidate cannot be rebound to ordinary capture", () => {
    const x = clone(batch.result), c = Native.parseRow(F.row(41), x.pages[0]).candidate;
    x.accepted[0] = c; assert.throws(() => evaluate(x));
  });
  for (const status of [403, 429]) await test("native refusal remains no-import and unchanged" + status, async () => {
    const b = await F.batch({ response: { status, headers: { "retry-after": "7200" } } }), copy = clone(b.result);
    const g = Gate.evaluate(b.result, F.state(b), { now: b.time }); assert.equal(g.candidates.length, 0);
    assert.equal(g.recordOutcome, "source-refused"); assert.equal(b.result.error.retryAfterMs, 7200000); assert.deepEqual(b.result, copy);
  });
  await test("promotion can confirm HTML while normal candidate remains excluded", async () => {
    const b = await F.batch({ filtered: { edit: data => { data.data[4].priceTag.type = "discount"; data.data[4].priceTag.badgeText = "AKTION"; } } });
    const g = Gate.evaluate(b.result, F.state(b), { now: b.time }); assert.equal(g.candidates.length, 7);
    assert(g.rejected.some(r => r.reasons.includes("hit-unconditional-normal-price-tag-required")));
  });
  await test("package variant and invalid GTIN stay excluded", async () => {
    for (const edit of [r => { r.packageVariants = [{ pack: "250g" }]; }, r => { r.ean = "000"; }]) {
      const b = await F.batch({ filtered: { edit: data => edit(data.data[4]) } });
      assert.equal(Gate.evaluate(b.result, F.state(b), { now: b.time }).candidates.length, 7);
    }
  });
  await test("native leaf level cannot be supplied only by queued level", async () => {
    const b = await F.batch({ filtered: { edit: data => { delete data.meta.category.level; } } });
    assert.equal(Gate.evaluate(b.result, F.state(b), { now: b.time }).candidates.length, 0);
  });
  await test("later same-batch normal quote contradiction is not hidden by control snapshot", async () => {
    const b = await F.batch({ maxRequests: 5, followingRows: [F.price(F.row(41)), F.row(91)] });
    const g = Gate.evaluate(b.result, F.state(b), { now: b.time }); assert(g.quarantineGtins.includes(F.row(41).ean));
    assert(!g.candidates.some(c => c.gtin === F.row(41).ean)); assert(g.conflicts.some(c => c.reason === "exact-native-quote-disagreement"));
  });
  await test("known GTIN with nonnormal price after control remains unresolved", async () => {
    const b = await F.batch({ maxRequests: 5, followingRows: [F.row(41), F.row(91)], filtered: { edit: data => { data.data[4].priceTag.type = "discount"; data.data[4].priceTag.badgeText = "AKTION"; } } });
    const g = Gate.evaluate(b.result, F.state(b), { now: b.time }); assert(g.unresolved.some(x => x.gtin === F.row(41).ean));
    assert(!g.quarantineGtins.includes(F.row(41).ean));
  });
  await test("exact previous accepted refs reconstruct and deduplicate without DB claim", () => {
    const g = evaluate(batch.result, state, { previousPartitions: [previous] }); assert.equal(g.candidates.length, 0);
    assert.equal(g.activePreviousPartitionCount, 1); assert.equal(g.databaseAuthorityVerified, false);
  });
  for (const [name, edit] of [
    ["previous accepted proof rewritten", x => { x.acceptedRefs[0].proofHash = "a".repeat(64); }],
    ["previous original changed", x => { x.record.filtered.body += "REWRITTEN"; }],
    ["previous duplicate refs", x => { x.acceptedRefs.push(x.acceptedRefs[0]); }],
    ["previous future capture", x => { x.record.filtered.meta.capturedAt = new Date(batch.time + 1).toISOString(); }],
    ["previous wrong original cycle day", x => { x.ordinaryCycle.cursorDay = "2026-10-01"; }]
  ]) await test(name, () => { const x = clone(previous); edit(x); assert.throws(() => evaluate(batch.result, state, { previousPartitions: [x] })); });
  await test("at most one previous partition context", () => { assert.throws(() => evaluate(batch.result, state, { previousPartitions: [previous, previous] })); });
  await test("old comparison evidence remains available six minutes later without freshness renewal", async () => {
    const b = await F.threeNodeBatch(), previous = F.snapshot(b), next = await F.continuation(b.result.cursor, [F.row(41), F.row(91)], { now: F.NOW + 360000 });
    const g = Gate.evaluate(next.result, { cursor: next.previous }, { now: next.time, previousPartitions: [previous] });
    assert.equal(g.activePreviousPartitionCount, 1); assert.equal(g.candidates.length, 0); assert.equal(g.recordOutcome, null);
  });
  await test("same-cycle normal repeated seenSKU sidecar exposes reverse partition conflict", async () => {
    const b = await F.threeNodeBatch(), previous = F.snapshot(b);
    const first = await F.continuation(b.result.cursor, [F.row(41), F.row(91)]);
    const second = await F.continuation(first.result.cursor, [F.price(F.row(41)), F.row(92)], { now: F.NOW + 120000 });
    assert(!second.result.pages[0].nativeSkuIds.includes(F.sku(41)));
    assert(!second.result.accepted.some(c => c.retailerSku === F.sku(41)));
    const g = Gate.evaluate(second.result, { cursor: second.previous }, { now: second.time, previousPartitions: [previous] });
    assert(g.quarantineGtins.includes(F.row(41).ean)); assert(g.conflicts.some(c => c.reason === "exact-native-quote-disagreement"));
  });
  await test("stale repeated seenSKU page with accepted=[] cannot become current comparison proof", async () => {
    const b = await F.threeNodeBatch(), p = F.snapshot(b), first = await F.continuation(b.result.cursor, [F.row(41), F.row(91)]);
    const repeated = await F.continuation(first.result.cursor, [F.row(41), F.row(91)], { now: F.NOW + 120000 });
    assert.equal(repeated.result.accepted.length, 0);
    assert.equal(repeated.result.pages[0].nativeSkuIds.length, 0);
    const stale = clone(repeated.result); stale.pages[0].capturedAt = new Date(repeated.time - 300001).toISOString();
    stale.pages[0].responseDate = new Date(repeated.time - 300001).toUTCString();
    assert.throws(() => Gate.evaluate(stale, { cursor: repeated.previous }, { now: repeated.time, previousPartitions: [p] }), /normal-page-invalid/);
  });
  await test("repeated seenSKU with accepted=[] retains Date and Age guards", async () => {
    const b = await F.threeNodeBatch(), first = await F.continuation(b.result.cursor, [F.row(41), F.row(91)]);
    const repeated = await F.continuation(first.result.cursor, [F.row(41), F.row(91)], { now: F.NOW + 120000 });
    assert.equal(repeated.result.accepted.length, 0);
    for (const patch of [{ responseAgeSeconds: 301 }, { responseAgeSeconds: -1 }, { responseAgeSeconds: "0" },
      { responseDate: new Date(repeated.time - 301000).toUTCString() }]) {
      const changed = clone(repeated.result); Object.assign(changed.pages[0], patch);
      assert.throws(() => Gate.evaluate(changed, { cursor: repeated.previous }, { now: repeated.time }), /normal-page-invalid/);
    }
  });
  await test("earlier cycle quote cannot hide two conflicting quotes in a later same cycle", () => {
    // Exercise the exact private comparator unchanged, including the ordering
    // that exposed the defect; no replacement planner or production API export.
    const file = path.join(__dirname, "..", "hit-partition-admission-gate.js"), sandbox = {
      require: require("node:module").createRequire(file), module: { exports: {} }, Buffer };
    vm.runInNewContext(fs.readFileSync(file, "utf8") + "\nglobalThis.comparisonForTest = compare;", sandbox);
    const value = (cents, cycle) => ({ gtin: F.row(41).ean, sku: F.sku(41), pack: { unit: "g", amount: 500, count: 1 },
      signature: crypto.createHash("sha256").update(String(cents)).digest("hex"), origin: "synthetic-comparison",
      cycle: { cursorDay: "2026-10-02", completedCycles: cycle } });
    const result = sandbox.comparisonForTest([value(100, 0), value(110, 1), value(120, 1)], []);
    assert(result.conflicts.some(x => x.reason === "exact-native-quote-disagreement")); assert(result.blocked.has(F.row(41).ean));
    const legitimate = sandbox.comparisonForTest([value(100, 0), value(110, 1), value(110, 1)], []);
    assert.equal(legitimate.conflicts.length, 0); assert.equal(legitimate.blocked.size, 0);
  });
  await test("later normal exact sales multipack conflict is detected in reverse", async () => {
    const b = await F.threeNodeBatch(), p = F.snapshot(b), raw = { ...F.row(41), overview: "2 x 250g Packung" };
    const next = await F.continuation(b.result.cursor, [raw, F.row(91)]);
    const g = Gate.evaluate(next.result, { cursor: next.previous }, { now: next.time, previousPartitions: [p] });
    assert(g.conflicts.some(x => x.reason === "gtin-sales-pack-disagreement")); assert(g.quarantineGtins.includes(raw.ean));
  });
  await test("same native partition SKU with another valid GTIN quarantines both known identities", async () => {
    const b = await F.threeNodeBatch(), p = F.snapshot(b), raw = { ...F.row(90), external_id: F.sku(41) };
    const next = await F.continuation(b.result.cursor, [raw, F.row(91)]);
    const g = Gate.evaluate(next.result, { cursor: next.previous }, { now: next.time, previousPartitions: [p] });
    assert(g.quarantineGtins.includes(F.row(41).ean)); assert(g.quarantineGtins.includes(raw.ean));
  });
  await test("day reset retains<24h original partition namespace without renewing it", async () => {
    const b = await F.resetBatch(); testNow = b.time; const g = Gate.evaluate(b.result, { cursor: batch.result.cursor }, { now: b.time, previousPartitions: [previous] });
    assert.equal(g.dailyCycleReset, true); assert.equal(g.activePreviousPartitionCount, 1); assert.equal(g.candidates.length, 0);
    assert.equal(previous.record.filtered.meta.capturedAt, batch.result.brandPartitionProbe.filtered.meta.capturedAt);
  });
  await test("different day legitimate normal price refresh is not quarantined", async () => {
    const b = await F.resetBatch({ first: F.price(F.row(41)) }); testNow = b.time; const g = Gate.evaluate(b.result, { cursor: batch.result.cursor }, { now: b.time, previousPartitions: [previous] });
    assert(!g.quarantineGtins.includes(F.row(41).ean)); assert(g.unresolved.some(x => x.reason === "cross-cycle-normal-quote-change"));
  });
  await test("expired previous originals cease current comparison without deletion or renewal", async () => {
    const b = await F.resetBatch({ now: F.NOW + 86400000 + 1000 }); testNow = b.time; const g = Gate.evaluate(b.result, { cursor: batch.result.cursor }, { now: b.time, previousPartitions: [previous] });
    assert.equal(g.activePreviousPartitionCount, 0); assert.equal(g.expiredPreviousPartitionIds.length, 1);
  });
  await test("future or malformed source state/result cannot authorize comparison", () => {
    assert.throws(() => evaluate(batch.result, { cursor: state.cursor, completedCycles: -1 }));
    assert.throws(() => evaluate(batch.result, state, { now: undefined }));
    const bad = clone(batch.result); bad.cursorDay = "2026-10-03"; assert.throws(() => evaluate(bad));
  });
  await test("same-day reset UUID separates a changed quote from its prior actual cycle", async () => {
    const b=await F.threeNodeBatch(),p=F.snapshot(b);p.ordinaryCycle.ordinaryCycleId="11111111-1111-4111-8111-111111111111";
    const next=await F.continuation(b.result.cursor,[F.price(F.row(41)),F.row(91)]);
    const g=Gate.evaluate(next.result,{cursor:next.previous,ordinaryCycleId:"22222222-2222-4222-8222-222222222222"},{now:next.time,previousPartitions:[p]});
    assert(!g.quarantineGtins.includes(F.row(41).ean));assert(g.unresolved.some(x=>x.reason==="cross-cycle-normal-quote-change"));
  });
  await test("one durable UUID retains same-cycle quote conflict even on identical day counters", async () => {
    const b=await F.threeNodeBatch(),p=F.snapshot(b),id="11111111-1111-4111-8111-111111111111";p.ordinaryCycle.ordinaryCycleId=id;
    const next=await F.continuation(b.result.cursor,[F.price(F.row(41)),F.row(91)]);
    const g=Gate.evaluate(next.result,{cursor:next.previous,ordinaryCycleId:id},{now:next.time,previousPartitions:[p]});
    assert(g.quarantineGtins.includes(F.row(41).ean));
  });
  await test("invalid caller cycle UUID cannot become durable comparison metadata",()=>{
    assert.throws(()=>evaluate(batch.result,{...state,ordinaryCycleId:"caller-cycle"}),/cycle-invalid/);
  });
  await test("module exposes no fetch, persist, execute or import capability", () => {
    assert.deepEqual(Object.keys(Gate).sort(), ["evaluate", "quoteFor", "referenceFor"]);
  });
  await test("request, page and candidate arrays have explicit ordinary batch bounds", () => {
    for (const edit of [x => { x.requests = 17; }, x => { x.pages = Array(17).fill(x.pages[0]); },
      x => { x.accepted = Array(641).fill(x.accepted[0]); }, x => { x.rejected = Array(641).fill({ reasons: [] }); }]) {
      const changed = clone(batch.result); edit(changed); assert.throws(() => evaluate(changed), /actual-result-required/);
    }
  });
  console.log("hit-partition-admission-gate: " + count + " meaningful disabled original-bound cases passed");
  } finally { Date.now = originalDateNow; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
