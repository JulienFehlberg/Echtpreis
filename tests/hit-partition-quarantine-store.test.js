"use strict";
const assert = require("node:assert/strict"), Q = require("../hit-partition-quarantine-store"), Native = require("../hit-assortment-client");
const Refresh = require("../hit-price-refresh"), F = require("./fixtures/hit-partition-admission-gate"), clone = structuredClone;
const ID = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
async function main() {
  let cases = 0;
  const test = async (name, fn) => { try { await fn(); cases++; } catch (e) { throw new Error(name, { cause: e }); } };
  const batch = await F.threeNodeBatch({ now: Date.now() - 10000 }), input = batch.result.ordinaryConflictOriginals[0];
  await test("An exact original reparses native packs and retains unknown deposit", () => {
    const parsed = Q.ordinaryOriginal(input, batch.result, batch.time);
    assert.equal(parsed.candidates.length, 40); assert.equal(parsed.candidates[0].depositCents, null);
    assert.equal(parsed.original.body, input.body); assert.equal(parsed.candidates[0].expiresAt, new Date(Date.parse(input.meta.capturedAt) + 86400000).toISOString());
  });
  const edits = [
    ["rewritten body", x => { x.body += "<!-- altered -->"; }],
    ["foreign country", x => { x.meta.storeProfile.country = "AT"; }],
    ["other store", x => { x.meta.storeProfile.storeId = 1776; }],
    ["account capture", x => { x.meta.anonymous = false; }],
    ["retried capture", x => { x.meta.retried = true; }],
    ["redirected capture", x => { x.meta.redirects = [x.meta.sourceResponseUrl]; }],
    ["native refusal", x => { x.meta.responseStatus = 403; }],
    ["non HTML", x => { x.meta.responseContentType = "application/json"; }],
    ["wrong original byte count", x => { x.meta.responseBytes++; }],
    ["old first capture", x => { x.meta.capturedAt = new Date(batch.time - 300001).toISOString(); }],
    ["future capture", x => { x.meta.capturedAt = new Date(batch.time + 1).toISOString(); }],
    ["old cache age", x => { x.meta.responseAgeSeconds = 301; x.meta.responseAgeRaw = "301"; }],
    ["inconsistent age", x => { x.meta.responseAgeRaw = "1"; }],
    ["different request URL", x => { x.meta.requestUrl += "?page=1"; }],
    ["changed control category", x => { x.node.id = "4261911"; }]
  ];
  for (const [name, edit] of edits) await test(name + " cannot authorize quarantine", () => { const x = clone(input); edit(x); assert.throws(() => Q.ordinaryOriginal(x, batch.result, batch.time)); });
  await test("Quote sidecars cannot replace source originals", () => { assert.throws(() => Q.ordinaryOriginal({ meta: input.meta, node: input.node }, batch.result, batch.time)); });
  await test("A sidecar signature inconsistent with the actual body fails", () => { const r = clone(batch.result); r.pages[0].nativeQuoteRows[0].quote.signature = "f".repeat(64); assert.throws(() => Q.ordinaryOriginal(input, r, batch.time)); });
  await test("Capture sanitization excludes arbitrary header/cookie metadata", () => { const x = clone(input); x.meta.headers = { authorization: "SYNTHETIC secret" }; x.meta.storeProfile.cookies = "SYNTHETIC secret"; const p = Q.ordinaryOriginal(x, batch.result, batch.time); assert(!JSON.stringify(p.original).includes("SYNTHETIC secret")); });
  const candidate = raw => { const p = Native.parseRow(raw, input.meta); assert(p.ok); return p.candidate; };
  const a = { candidate: candidate(F.row(41)), cycleId: ID }, price = { candidate: candidate(F.price(F.row(41))), cycleId: ID };
  await test("Actual same-generation contradictory normal quote is a block", () => assert.equal(Q.pairReason(a, price, "exact-native-quote-disagreement"), true));
  await test("Cross-generation normal price change is not permanent conflict", () => assert.equal(Q.pairReason(a, { ...price, cycleId: OTHER }, "exact-native-quote-disagreement"), false));
  await test("Legacy NULL witness cannot be adopted for quote-only quarantine", () => assert.equal(Q.pairReason({ ...a, cycleId: null }, price, "exact-native-quote-disagreement"), false));
  await test("Caller labels are not durable UUID authority", () => assert.equal(Q.pairReason({ ...a, cycleId: "same" }, { ...price, cycleId: "same" }, "exact-native-quote-disagreement"), false));
  await test("Exact multipack difference remains conflict across generations", () => { const b = { candidate: candidate({ ...F.row(41), overview: "2 x 250g Packung" }), cycleId: OTHER }; assert.equal(Q.pairReason(a, b, "gtin-sales-pack-disagreement"), true); });
  await test("Same SKU with another genuine native GTIN blocks both identities", () => { const b = { candidate: candidate({ ...F.row(90), external_id: F.sku(41), url: F.row(41).url }), cycleId: null }; assert.equal(Q.pairReason(a, b, "native-sku-identity-disagreement"), true); });
  await test("Unknown conflict reason cannot gain authority", () => assert.equal(Q.pairReason(a, price, "caller-quarantine"), false));
  await test("Autocommit connection cannot create events or inspect protected blocks", async () => { const tx = { release() {}, query: async () => ({ rows: [{ transactionOpen: false, nowMs: Date.now() }] }) }; await assert.rejects(Q.blocked(tx, [F.row(41).ean]), /open-writing-transaction-required/); await assert.rejects(Q.record(tx, batch.result, "forged", { now: Date.now() }), /open-writing-transaction-required/); });
  await test("Checkpoint metadata from a stale caller is rejected", async () => { const tx = { release() {}, query: async sql => ({ rows: sql.startsWith("SELECT cursor,") ? [{ ordinaryCycleId: ID }] : [{ transactionOpen: true, nowMs: Date.now() }] }) }; await assert.rejects(Q.record(tx, batch.result, "forged", { now: Date.now() }), /checkpoint-changed/); });
  await test("Actual legacy state without UUID cannot record conflicts", async () => { const tx = { release() {}, query: async sql => ({ rows: sql.startsWith("SELECT cursor,") ? [{}] : [{ transactionOpen: true, nowMs: Date.now() }] }) }; await assert.rejects(Q.record(tx, batch.result, Refresh.checkpointKey({}), { now: Date.now() }), /actual-durable-cycle-required/); });
  await test("Blocked identity input retains real GTIN validation", async () => { await assert.rejects(Q.blocked({}, ["4000000000000"]), /native-gtins-required/); });
  await test("Public count helper cannot expose private evidence fields", async () => { const p = await Q.publicStatus({ query: async () => ({ rows: [{ eventCount: 2, blockedGtinCount: 3, ordinaryCycleId: ID, payload: "PRIVATE" }] }) }); assert.deepEqual(p, { eventCount: 2, blockedGtinCount: 3 }); });
  await test("Schema cache never survives an outer client's rolled-back DDL", async () => { let calls = 0; const tx = { release() {}, query: async () => { calls++; return {}; } }; await Q.ensure(tx); await Q.ensure(tx); assert.equal(calls, 2); });
  await test("Concurrent real pool initialization shares one committed schema job", async () => { let calls = 0; const pool = { connect() {}, query: async () => { calls++; return {}; } }; await Promise.all([Q.ensure(pool), Q.ensure(pool)]); assert.equal(calls, 1); });
  console.log("hit-partition-quarantine-store: " + cases + " original-bound persistent quarantine cases passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
