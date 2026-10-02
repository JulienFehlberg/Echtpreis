"use strict";
// Guarded localhost *_test caller only. Every synthetic conflict/import is rolled back.
const assert = require("node:assert/strict"), crypto = require("node:crypto"), Q = require("../hit-partition-quarantine-store");
const Refresh = require("../hit-price-refresh"), Import = require("../hit-price-import"), Admission = require("../hit-partition-admission-store");
const Gate = require("../hit-partition-admission-gate"), Collector = require("../hit-assortment-collector"), F = require("./fixtures/hit-partition-admission-gate"), L = require("./fixtures/hit-list-gap");
const clone = structuredClone, iso = n => new Date(n).toISOString(), ID = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
module.exports = async function(pool) {
  await Refresh.ensure(pool); await Import.ensure(pool); await Q.ensure(pool);
  const time = Date.now() - 12000, first = await F.threeNodeBatch({ now: time - 5000 });
  const normal = await F.continuation(first.result.cursor, [F.price(F.row(1)), F.row(91)], { now: time });
  const pack = await F.continuation(first.result.cursor, [{ ...F.row(41), overview: "2 x 250g Packung" }, F.row(91)], { now: time });
  const oldCandidate = first.result.accepted.find(c => c.retailerSku === F.sku(1)); assert(oldCandidate);
  const duplicateNode = L.node(), duplicateRow = L.row(1), conflicting = { ...duplicateRow, price: "1.35", priceTag: { ...duplicateRow.priceTag, priceCent: "35" } };
  const duplicatePage = L.page({ now: time, rows: [duplicateRow, conflicting] }), h = L.harness({ [duplicateNode.url]: duplicatePage.body }, { now: time });
  const duplicatePrior = L.cursor(undefined, time), duplicateResult = await Collector.collect({ ...h.options, storeProfile: Import.STORE_PROFILE, cursor: duplicatePrior, brandProbeEnabled: false, brandPartitionProbeEnabled: false });
  assert.equal(duplicateResult.accepted.length, 0); assert.equal(duplicateResult.pages[0].nativeQuoteRows.length, 0);
  const secondPackRow = { ...L.row(2), ean: duplicateRow.ean, overview: "2 x 250g Packung" };
  const packPage = L.page({ now: time, rows: [duplicateRow, secondPackRow] }), packHarness = L.harness({ [duplicateNode.url]: packPage.body }, { now: time });
  const packResult = await Collector.collect({ ...packHarness.options, storeProfile: Import.STORE_PROFILE, cursor: duplicatePrior, brandProbeEnabled: false, brandPartitionProbeEnabled: false });
  assert.equal(packResult.accepted.length, 2); assert.deepEqual(packResult.pages[0].conflictGtins, []);
  let cases = 0;
  const count = async (tx, table = Q.TABLE) => Number((await tx.query("SELECT count(*)::int AS n FROM " + table)).rows[0].n);
  const baseline = await count(pool);
  const seed = async (tx, cursor, id = ID) => {
    await tx.query("DELETE FROM " + Refresh.TABLE + " WHERE source_id=$1", [Refresh.SOURCE]);
    await tx.query("INSERT INTO " + Refresh.TABLE + "(source_id,cursor,completed_cycles,native_total,pages_fetched,received_cumulative,updated_at,ordinary_cycle_id) VALUES($1,$2::jsonb,2,$3,$4,$5,$6,$7)", [Refresh.SOURCE, JSON.stringify(cursor), cursor.total, cursor.pagesFetched, cursor.received, iso(time - 60000), id]);
    return Refresh.readState(tx);
  };
  const record = (tx, result, state, options = {}) => Q.record(tx, result, options.checkpoint ?? Refresh.checkpointKey(state), { now: options.now ?? Date.now(), ...(options.ordinaryOriginals !== undefined ? { ordinaryOriginals: options.ordinaryOriginals } : {}) });
  const test = async (name, fn) => { const tx = await pool.connect(); try { await tx.query("BEGIN"); await fn(tx); cases++; } catch(e) { throw new Error(name, { cause: e }); } finally { await tx.query("ROLLBACK"); tx.release(); } };
  const importOld = async (tx, witness = ID) => {
    await seed(tx, first.previous, witness); const saved = await Import.persist(pool, [oldCandidate], { now: Date.now, transactionClient: tx });
    assert.equal(saved.accepted.length, 1, JSON.stringify(saved)); return saved.accepted[0];
  };
  await test("No metadata-only conflict or invented canonical product", async tx => {
    const state = await seed(tx, first.previous), before = await count(tx, "products"), result = clone(first.result);
    result.quarantineGtins = [F.row(41).ean]; result.conflicts = [{ reason: "caller-block" }];
    const r = await record(tx, result, state); assert.equal(r.inserted, 0); assert.equal(await count(tx, "products"), before); assert.equal(await count(tx), baseline);
  });
  await test("Authentic within-page contradiction survives accepted=[] and Gate.conflicts=[]", async tx => {
    const state = await seed(tx, duplicatePrior); assert.equal(Gate.evaluate(duplicateResult, state, { now: Date.now() }).conflicts.length, 0);
    const before = await count(tx, "products"), r = await record(tx, duplicateResult, state); assert.equal(r.inserted, 1); assert.deepEqual(r.quarantineGtins, [duplicateRow.ean]);
    assert.deepEqual(await Q.blocked(tx, [duplicateRow.ean, F.row(91).ean]), [duplicateRow.ean]); assert.equal(await count(tx, "products"), before);
    assert.equal(await count(tx, Q.REF_TABLE), 0, "Never manufacture product/observation references for new contradictory cards");
  });
  await test("Different native SKUs with equal total weight and unequal sale packs create a permanent original-bound block", async tx => {
    const state = await seed(tx, duplicatePrior), gate = Gate.evaluate(packResult, state, { now: Date.now() });
    assert.deepEqual(gate.conflicts.map(c => c.reason), ["gtin-sales-pack-disagreement"]);
    const before = await count(tx, "products"), r = await record(tx, packResult, state);
    assert.equal(r.inserted, 1); assert.deepEqual(r.quarantineGtins, [duplicateRow.ean]);
    assert.equal(await count(tx, "products"), before); assert.equal(await count(tx, Q.REF_TABLE), 0);
    const saved = await Import.persist(pool, packResult.accepted, { now: Date.now, transactionClient: tx });
    assert.equal(saved.accepted.length, 0); assert.deepEqual(await Q.blocked(tx, [duplicateRow.ean]), [duplicateRow.ean]);
  });
  await test("A forged sold-pack quote cannot authorize a block despite genuine source metadata", async tx => {
    const state = await seed(tx, duplicatePrior), result = clone(packResult);
    result.pages[0].nativeQuoteRows[0].key = result.pages[0].nativeQuoteRows[0].key.replace(/\|1$/, "|2");
    await assert.rejects(record(tx, result, state)); assert.equal(await count(tx), baseline);
  });
  await test("Cross-batch ordinary conflict uses actual generation-witnessed evidence", async tx => {
    const old = await importOld(tx), state = await seed(tx, normal.previous);
    const evidence = (await tx.query("SELECT native_proof,proof_hash,ordinary_cycle_id FROM " + Import.TABLE + " WHERE observation_id=$1", [old.observationId])).rows[0];
    assert.deepEqual(evidence.native_proof, oldCandidate.nativeProof);
    assert.notEqual(JSON.stringify(evidence.native_proof.priceTag), JSON.stringify(oldCandidate.nativeProof.priceTag), "Actual JSONB roundtrip changes nested key order without changing the native values");
    assert.equal(evidence.proof_hash, oldCandidate.proofHash);
    const r = await record(tx, normal.result, state);
    assert.equal(r.inserted, 1); assert.deepEqual(r.quarantineGtins, [oldCandidate.gtin]);
    const refs = (await tx.query("SELECT observation_id,product_id,store_id FROM " + Q.REF_TABLE)).rows;
    assert.deepEqual(refs, [{ observation_id: old.observationId, product_id: old.productId, store_id: old.storeId }]);
    assert.equal((await tx.query("SELECT ordinary_cycle_id FROM " + Import.TABLE + " WHERE observation_id=$1", [old.observationId])).rows[0].ordinary_cycle_id, ID);
  });
  for (const [name, mutate] of [
    ["observation hash", async (tx, old) => tx.query("UPDATE price_observations SET proof_hash=$2 WHERE id=$1", [old.observationId, "f".repeat(64)])],
    ["original evidence hash", async (tx, old) => tx.query("UPDATE " + Import.TABLE + " SET proof_hash=$2 WHERE observation_id=$1", [old.observationId, "f".repeat(64)])],
    ["saved signature", async (tx, old) => tx.query("UPDATE " + Import.TABLE + " SET signature=$2 WHERE observation_id=$1", [old.observationId, "f".repeat(64)])]
  ]) await test("Actual JSONB hash binding rejects a changed " + name, async tx => {
    const old = await importOld(tx); await mutate(tx, old); const state = await seed(tx, normal.previous);
    await assert.rejects(record(tx, normal.result, state), /persisted-native-reference-conflict/); assert.equal(await count(tx), baseline);
  });
  for (const witness of [null, OTHER]) await test("Old quote witness " + witness + " cannot acquire the current cycle", async tx => {
    const old = await importOld(tx); await tx.query("UPDATE " + Import.TABLE + " SET ordinary_cycle_id=$2 WHERE observation_id=$1", [old.observationId, witness]);
    const state = await seed(tx, normal.previous); await assert.rejects(record(tx, normal.result, state), /actual-conflict-evidence-required/); assert.equal(await count(tx), baseline);
  });
  await test("Actual prior partition FKs support a fresh reverse multipack conflict", async tx => {
    const state = await seed(tx, first.previous), candidates = Gate.evaluate(first.result, state, { now: Date.now() }).candidates;
    const saved = await Import.persist(pool, candidates, { now: Date.now, transactionClient: tx }); assert.equal(saved.accepted.length, 8, JSON.stringify(saved));
    assert.equal((await Admission.admit(tx, first.result, Refresh.checkpointKey(state), { now: Date.now() })).inserted, 1);
    const next = await seed(tx, pack.previous, OTHER), beforeProducts = await count(tx, "products"), r = await record(tx, pack.result, next);
    assert(r.inserted > 0); assert.deepEqual(r.quarantineGtins, [F.row(41).ean]); assert.equal(await count(tx, "products"), beforeProducts);
    assert.equal(await count(tx, Q.REF_TABLE), r.inserted, "Each distinct proven conflict event references the one genuine prior observation"); const row = (await tx.query("SELECT payload FROM " + Q.TABLE)).rows[0];
    const priorProof = row.payload.proofs.find(p => p.origin === "partition"); assert.equal(priorProof.cycleId, ID); assert.equal(priorProof.candidate.depositCents, null);
  });
  await test("Missing actual ordinary DB evidence cannot authorize caller seenQuotes", async tx => {
    const state = await seed(tx, normal.previous); await assert.rejects(record(tx, normal.result, state), /actual-conflict-evidence-required/); assert.equal(await count(tx), baseline);
  });
  await test("Fresh native source bodies cannot be replaced by quote metadata", async tx => {
    await importOld(tx); const state = await seed(tx, normal.previous); await assert.rejects(record(tx, normal.result, state, { ordinaryOriginals: [] }), /actual-conflict-evidence-required/); assert.equal(await count(tx), baseline);
  });
  await test("Tampered native original fails despite genuine previous observation", async tx => {
    await importOld(tx); const state = await seed(tx, normal.previous), result = clone(normal.result); result.ordinaryConflictOriginals[0].body += "CHANGED";
    await assert.rejects(record(tx, result, state), /ordinary-original-required/); assert.equal(await count(tx), baseline);
  });
  await test("A UUID-only CAS change rejects stale conflict authority", async tx => {
    await importOld(tx); const state = await seed(tx, normal.previous); await tx.query("UPDATE " + Refresh.TABLE + " SET ordinary_cycle_id=$2 WHERE source_id=$1", [Refresh.SOURCE, OTHER]);
    await assert.rejects(record(tx, normal.result, state), /checkpoint-changed/); assert.equal(await count(tx), baseline);
  });
  await test("A missing durable UUID rejects actual source originals", async tx => {
    const state = await seed(tx, duplicatePrior, null); await assert.rejects(record(tx, duplicateResult, state), /actual-durable-cycle-required/); assert.equal(await count(tx), baseline);
  });
  await test("Actual event/block writes roll back with the caller checkpoint", async tx => {
    const state = await seed(tx, duplicatePrior); await tx.query("SAVEPOINT quarantine_atomic"); await record(tx, duplicateResult, state);
    assert.equal(await count(tx), baseline + 1); await assert.rejects(tx.query("SELECT 1/0"), e => e.code === "22012"); await tx.query("ROLLBACK TO SAVEPOINT quarantine_atomic"); await tx.query("RELEASE SAVEPOINT quarantine_atomic");
    assert.equal(await count(tx), baseline); assert.deepEqual(await Q.blocked(tx, [duplicateRow.ean]), []); assert.deepEqual(await Refresh.readState(tx), state);
  });
  await test("Event and block INSERT cannot commit a half-written quarantine", async tx => {
    const state = await seed(tx, duplicatePrior); await tx.query("SAVEPOINT quarantine_insert"); const fault = { release() {}, query: (sql, args) => sql.startsWith("INSERT INTO " + Q.BLOCK_TABLE) ? tx.query("SELECT 1/0") : tx.query(sql, args) };
    await assert.rejects(record(fault, duplicateResult, state), e => e.code === "22012"); await tx.query("ROLLBACK TO SAVEPOINT quarantine_insert"); await tx.query("RELEASE SAVEPOINT quarantine_insert"); assert.equal(await count(tx), baseline);
  });
  await test("Permanent blocks survive another cycle and prevent normal import", async tx => {
    const state = await seed(tx, duplicatePrior); await record(tx, duplicateResult, state); await seed(tx, first.previous, crypto.randomUUID());
    const saved = await Import.persist(pool, [oldCandidate], { now: Date.now, transactionClient: tx }); assert.equal(saved.accepted.length, 0); assert.equal(saved.rejected[0].reasons[0], "hit-import-persistent-quarantine");
    assert.deepEqual(await Q.blocked(tx, [oldCandidate.gtin]), [oldCandidate.gtin]);
  });
  await test("Actual PostgreSQL triggers preserve events, GTIN blocks and FKs", async tx => {
    await importOld(tx); const state = await seed(tx, normal.previous); await record(tx, normal.result, state);
    for (const table of [Q.TABLE, Q.BLOCK_TABLE, Q.REF_TABLE]) for (const verb of ["UPDATE " + table + " SET event_id=event_id", "DELETE FROM " + table]) {
      await tx.query("SAVEPOINT immutable_guard"); await assert.rejects(tx.query(verb), e => e.code === "55000"); await tx.query("ROLLBACK TO SAVEPOINT immutable_guard"); await tx.query("RELEASE SAVEPOINT immutable_guard");
    }
    assert.deepEqual(await Q.blocked(tx, [oldCandidate.gtin]), [oldCandidate.gtin]);
  });
  await test("Idempotence survives JSONB ordering and never renews capture/recording time", async tx => {
    const state = await seed(tx, duplicatePrior); await record(tx, duplicateResult, state); const before = (await tx.query("SELECT * FROM " + Q.TABLE)).rows;
    const r = await record(tx, duplicateResult, state); assert.equal(r.inserted, 0); assert.equal(r.historicalReuse, true); assert.deepEqual((await tx.query("SELECT * FROM " + Q.TABLE)).rows, before);
  });
  await test("Historical retry reads its existing event beyond the first-admission window", async tx => {
    const state = await seed(tx, duplicatePrior); await record(tx, duplicateResult, state); const before = (await tx.query("SELECT * FROM " + Q.TABLE)).rows, later = Date.now() + 600000;
    const future = { release() {}, query: async (sql, args) => { const q = await tx.query(sql, args); if (sql.includes("floor(extract(epoch FROM clock_timestamp())")) q.rows[0].nowMs = String(later); return q; } };
    assert.equal((await record(future, duplicateResult, state, { now: later })).historicalReuse, true); assert.deepEqual((await tx.query("SELECT * FROM " + Q.TABLE)).rows, before);
  });
  await test("Actual public counts exclude source bodies, cycles and observation identifiers", async tx => {
    const state = await seed(tx, duplicatePrior); await record(tx, duplicateResult, state); const status = await Q.publicStatus(tx); assert.deepEqual(status, { eventCount: baseline + 1, blockedGtinCount: 1 });
    for (const hidden of [ID, "nativeProof", "capturedAt", "observationId", "body"]) assert(!JSON.stringify(status).includes(hidden));
  });
  for (const [name, sql] of [["scope", "UPDATE price_observations SET source_id='SYNTHETIC foreign' WHERE id=$1"], ["pack", "UPDATE products SET pack_count=2 WHERE id=$1"], ["purpose", "UPDATE price_observations SET evidence_purpose='identity-only' WHERE id=$1"]]) await test("Actual DB " + name + " mismatch rejects conflict evidence", async tx => {
    const old = await importOld(tx); await tx.query(sql, [name === "pack" ? old.productId : old.observationId]); const state = await seed(tx, normal.previous); await assert.rejects(record(tx, normal.result, state), /persisted-native-reference-conflict/); assert.equal(await count(tx), baseline);
  });
  await test("A capture aging while waiting for the real source lock cannot first-admit", async tx => {
    const state = await seed(tx, duplicatePrior); let afterLock = false; const future = { release() {}, query: async (sql, args) => { const q = await tx.query(sql, args); if (sql.includes("pg_advisory_xact_lock") && args?.[0] === Import.SOURCE + ":store:1775") afterLock = true; if (afterLock && sql.includes("floor(extract(epoch FROM clock_timestamp())")) q.rows[0].nowMs = String(Date.now() + 600000); return q; } };
    await assert.rejects(record(future, duplicateResult, state), /normal-page-invalid/); assert.equal(await count(tx), baseline);
  });
  await test("A capture aging just before INSERT cannot first-admit", async tx => {
    const state = await seed(tx, duplicatePrior); let clockReads = 0; const future = { release() {}, query: async (sql, args) => { const q = await tx.query(sql, args); if (sql.includes("floor(extract(epoch FROM clock_timestamp())")) { clockReads++; if (clockReads >= 3) q.rows[0].nowMs = String(Date.now() + 600000); } return q; } };
    await assert.rejects(record(future, duplicateResult, state), /capture-expired-before-write/); assert.equal(await count(tx), baseline);
  });
  const loose = await pool.connect(); try { await assert.rejects(Q.record(loose, duplicateResult, "forged", { now: Date.now() }), /open-writing-transaction-required/); await assert.rejects(Q.blocked(loose, [duplicateRow.ean]), /open-writing-transaction-required/); cases++; } finally { loose.release(); }
  assert.equal(await count(pool), baseline, "Synthetic quarantine events never escape their rolled-back transactions");
  console.log("hit-partition-quarantine-postgres: " + cases + " actual PostgreSQL cases passed (synthetic originals; permanent source/store blocks; no productive filtered import)");
};
