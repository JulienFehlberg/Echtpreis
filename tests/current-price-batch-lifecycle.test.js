"use strict";
const assert = require("assert/strict");
const Benchmark = require("../current-price-benchmark-service");
const Query = require("../current-price-query-service");

const today = "2026-09-30", gtin = "3017620422003";
const ids = {
 product: "10000000-0000-4000-8000-000000000001",
 edeka: "20000000-0000-4000-8000-000000000001",
 other: "20000000-0000-4000-8000-000000000002",
 rewe: "20000000-0000-4000-8000-000000000003"
};
const canonicalProduct = { id: ids.product, canonicalKey: "gtin:" + gtin, gtin, name: "Nutella", brand: "Ferrero", packAmount: 450, packUnit: "g", packCount: 1, identityStatus: "verified" };
const canonicalStores = [
 { id: ids.edeka, merchant: "EDEKA", country: "DE", city: "Berlin", region: "Berlin, DE", active: true, merchantActive: true },
 { id: ids.other, merchant: "EDEKA", country: "DE", city: "Berlin", region: "Berlin, DE", active: true, merchantActive: true },
 { id: ids.rewe, merchant: "REWE", country: "DE", city: "Berlin", region: "Berlin, DE", active: true, merchantActive: true }
];
const request = { product: "Nutella", gtin, brand: "Ferrero", pack: "450 g", merchants: ["EDEKA"], storeIds: { EDEKA: ids.edeka }, region: "Berlin", today };
const batch = products => ({ products, merchants: request.merchants, storeIds: request.storeIds, region: request.region, today });
const descriptor = (index = 0) => ({ product: "Nutella " + index, gtin, pack: index ? (index + 1) + " x 450 g" : "450 g", quantity: index + 1 });

function database() {
 const pool = {
  calls: [], counts: { scope: 0, matrix: 0, product: 0, observation: 0 },
  stores: structuredClone(canonicalStores), price: 3.99, observationDate: today, observedAt: today + "T12:00:00Z", scopeFailures: 0, missingScopes: 0,
  query: async function (sql, args = []) {
   pool.calls.push({ sql, args });
   assert(/^SELECT\b/.test(sql), "The entire comparison remains read-only");
   if (sql.includes("FROM price_observations po")) {
    pool.counts.observation++;
    return { rows: [{ productId: ids.product, gtin, product: "Nutella", brand: "Ferrero", pack: "450 g", price: pool.price, per: "item", store: "EDEKA", storeId: ids.edeka, region: "Berlin, DE", date: pool.observationDate, observedAt: pool.observedAt, priceType: "regular", kind: "external", status: "observed", identityVerified: true, proofVerified: false, source: "Open Prices", sourceType: "open_data", sourceId: "Open Prices", truthEligible: true, proof: "proof:1", proofType: "PRICE_TAG", proofHash: "image:1", proofActor: "observer:1", currency: "EUR", eligibility: null }] };
   }
   if (sql.includes("FROM products")) {
    pool.counts.product++;
    assert(sql.includes("WHERE gtin=$1"), "Each descriptor independently resolves its exact identity");
    assert.equal(args[0], gtin);
    return { rows: [canonicalProduct] };
   }
   if (sql.includes("FROM stores s JOIN merchants")) {
    assert.deepEqual(args.length, 1);
    assert(Array.isArray(args[0]));
    if (sql.includes("SELECT s.id,s.country,s.city")) pool.counts.matrix++;
    else {
     pool.counts.scope++;
     if (pool.scopeFailures > 0) { pool.scopeFailures--; throw new Error("scope-read-failed"); }
     if (pool.missingScopes > 0) { pool.missingScopes--; return { rows: [] }; }
    }
    return { rows: pool.stores.filter(store => args[0].includes(store.id)) };
   }
   throw new Error("Unexpected SQL: " + sql);
  }
 };
 return pool;
}

function deferred() {
 let resolve, reject;
 const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
 return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function good(received, price = 3.99) {
 return { ok: true, query: { name: received.product, gtin, pack: received.pack, mode: "exact" }, results: [{ merchant: "EDEKA", gtin, pack: received.pack, state: "observed", price, per: "piece", match: "ground-truth", currency: "EUR", source: "Open Prices", sourceId: "Open Prices", sourceType: "open_data", proof: "proof:1", proofType: "PRICE_TAG", truthEligible: true, queryMode: "exact", comparisonOnly: false, storeId: ids.edeka, locationLevel: "store", region: "Berlin, DE", observedAt: today + "T12:00:00Z", priceType: "regular", eligibility: { ok: true, reason: "public" } }] };
}
function controlled(count) {
 const gates = Array.from({ length: count }, deferred), started = Array.from({ length: count }, deferred);
 const state = { calls: [], active: 0, maximum: 0, completionOrder: [], cache: null };
 const query = { compareCurrentPrices: async (pool, received, options) => {
  const index = state.calls.length;
  state.calls.push(received);
  assert.equal(options.includeRefreshTargets, false);
  assert(options.scopeCache instanceof WeakMap);
  if (state.cache) assert.equal(options.scopeCache, state.cache);
  else state.cache = options.scopeCache;
  state.active++; state.maximum = Math.max(state.maximum, state.active);
  started[index].resolve();
  try { return await gates[index].promise; }
  finally { state.active--; state.completionOrder.push(index); }
 } };
 return { gates, started, state, query };
}

async function repeatedScopesAndFreshRun() {
 const pool = database(), observedResults = [], caches = [];
 const query = { compareCurrentPrices: async (received, item, options) => {
  assert.equal(options.includeRefreshTargets, false);
  caches.push(options.scopeCache);
  const result = await Query.compareCurrentPrices(received, item, options);
  observedResults.push(result);
  return result;
 } };
 const input = batch(Array.from({ length: 30 }, () => ({ product: "Nutella", gtin, pack: "450 g" })));
 const first = await Benchmark.compare(pool, input, query);
 assert.equal(first.summary.knownCells, 30);
 assert.deepEqual(pool.counts, { scope: 1, matrix: 1, product: 30, observation: 30 });
 assert.equal(new Set(caches).size, 1, "All jobs share exactly one invocation-local scope cache");
 assert(observedResults.every(result => result.results[0].price === 3.99));
 assert(!pool.calls.some(call => call.sql.includes("external_store_mappings")), "A benchmark does not schedule retailer refresh targets");

 pool.price = 4.49;
 const second = await Benchmark.compare(pool, input, query);
 assert.equal(second.summary.knownCells, 30);
 assert.deepEqual(pool.counts, { scope: 2, matrix: 2, product: 60, observation: 60 });
 assert.notEqual(caches[0], caches[30], "A second benchmark cannot reuse a prior scope snapshot");
 assert(observedResults.slice(30).every(result => result.results[0].price === 4.49), "Actual observations are reread; the scope cache never caches prices");

 pool.observationDate = "2026-09-01"; pool.observedAt = "2026-09-01T12:00:00Z";
 const expired = await Benchmark.compare(pool, batch([{ product: "Nutella", gtin, pack: "450 g" }]), query);
 assert.equal(expired.summary.knownCells, 0, "A new benchmark must reevaluate stale observations rather than reuse a known price");
 assert.equal(observedResults[60].results[0].state, "unknown");
 assert.equal(pool.counts.observation, 61);
 pool.observationDate = today; pool.observedAt = today + "T12:00:00Z";

 const currentStore = pool.stores[0];
 for (const changed of [{ country: "US" }, { city: "Hamburg", region: "Berlin, DE" }]) {
  pool.stores[0] = { ...currentStore, ...changed };
  const result = await Benchmark.compare(pool, batch([{ product: "Nutella", gtin, pack: "450 g" }]), query);
  assert.equal(result.summary.knownCells, 0, "Fresh canonical branch country/city remains mandatory");
 }
 pool.stores[0] = { ...currentStore, active: false };
 const inactive = await Benchmark.compare(pool, batch([{ product: "Nutella", gtin, pack: "450 g" }]), query);
 assert.equal(inactive.ok, false);
 assert.equal(inactive.error, "invalid-store-scope");
 assert(inactive.errors.includes("canonical-store-not-found"));
}

async function workerBoundAndInputOrder() {
 const pool = database(), control = controlled(6), products = Array.from({ length: 6 }, (_, i) => descriptor(i));
 const comparison = Benchmark.compare(pool, batch(products), control.query);
 await Promise.all([control.started[0].promise, control.started[1].promise]);
 assert.equal(control.state.calls.length, 2, "Only two product jobs may start before either completes");
 for (const [finished, launched] of [[1, 2], [0, 3], [3, 4], [2, 5]]) {
  control.gates[finished].resolve(good(control.state.calls[finished], finished + 1));
  await control.started[launched].promise;
  assert.equal(control.state.active, 2);
 }
 control.gates[5].resolve(good(control.state.calls[5], 6));
 await flush();
 control.gates[4].resolve(good(control.state.calls[4], 5));
 const result = await comparison;
 assert.deepEqual(control.state.completionOrder, [1, 0, 3, 2, 5, 4]);
 assert.equal(control.state.maximum, 2);
 assert.equal(control.state.active, 0);
 assert.equal(result.summary.knownCells, 6);
 assert.deepEqual(result.items.map(item => item.product), products.map(item => item.product));
 assert.deepEqual(result.byProduct.map(item => item.product), products.map(item => item.product), "Completion order must not reassign results to another product");
 assert.deepEqual(result.byProduct.map(item => item.pack), products.map(item => item.pack), "Distinct per-job packs make any completion-order reassignment ineligible");
 assert.deepEqual(result.byProduct.map(item => item.key), ["0", "1", "2", "3", "4", "5"]);
 assert.deepEqual(result.byProduct.map(item => item.quantity), [1, 2, 3, 4, 5, 6]);
}

async function sameGtinDifferentPacks() {
 const pool = database();
 const result = await Benchmark.compare(pool, batch([
  { product: "Nutella", gtin, pack: "450 g", quantity: 2 },
  { product: "Nutella", gtin, pack: "2 x 225 g", quantity: 3 },
  { product: "Nutella", gtin, pack: "900 g", quantity: 1 }
 ]));
 assert.equal(result.summary.products, 3);
 assert.deepEqual(result.byProduct.map(row => row.pack), ["450 g", "2 x 225 g", "900 g"]);
 assert.deepEqual(result.byProduct.map(row => row.known), [1, 0, 0]);
 assert.deepEqual(result.missing.map(row => row.reason), ["product-pack-conflict", "product-pack-conflict"]);
 assert.equal(new Set(result.byProduct.map(row => row.key)).size, 3);
 assert.deepEqual(pool.counts, { scope: 1, matrix: 1, product: 3, observation: 1 }, "Shared store scope never merges different exact sales packs or product reads");
}

async function failedBatch({ low, high, expectedKind, expected }) {
 const pool = database(), control = controlled(5);
 let settled = false;
 const outcome = Benchmark.compare(pool, batch(Array.from({ length: 5 }, (_, i) => descriptor(i))), control.query).then(
  value => { settled = true; return { kind: "result", value }; },
  value => { settled = true; return { kind: "error", value }; }
 );
 await Promise.all([control.started[0].promise, control.started[1].promise]);
 if (high.kind === "error") control.gates[1].reject(high.value);
 else control.gates[1].resolve(high.value);
 await flush();
 assert.equal(control.state.calls.length, 2, "A failed job stops new work immediately");
 assert.equal(settled, false, "The comparison must drain its other running job before responding or throwing");
 assert.equal(control.state.active, 1);
 if (low.kind === "error") control.gates[0].reject(low.value);
 else control.gates[0].resolve(low.value || good(control.state.calls[0]));
 const result = await outcome;
 assert.equal(result.kind, expectedKind);
 assert.equal(result.value, expected, "The lowest failed input index wins, independent of completion order");
 assert.equal(control.state.calls.length, 2);
 assert.equal(control.state.active, 0);
 assert.equal(pool.calls.length, 0, "A failed batch cannot read/return a partial coverage matrix");
}

async function failureLifecycle() {
 const lowError = new Error("first-input-failed"), highError = new Error("second-input-failed-first");
 const lowResult = { ok: false, statusCode: 400, error: "first-input-invalid" };
 const highResult = { ok: false, statusCode: 400, error: "second-input-invalid-first" };
 await failedBatch({ low: { kind: "error", value: lowError }, high: { kind: "error", value: highError }, expectedKind: "error", expected: lowError });
 await failedBatch({ low: { kind: "error", value: lowError }, high: { kind: "result", value: highResult }, expectedKind: "error", expected: lowError });
 await failedBatch({ low: { kind: "result", value: lowResult }, high: { kind: "error", value: highError }, expectedKind: "result", expected: lowResult });
 await failedBatch({ low: { kind: "result" }, high: { kind: "result", value: highResult }, expectedKind: "result", expected: highResult });
 for (const value of [null, undefined, false]) {
  await failedBatch({ low: { kind: "error", value }, high: { kind: "error", value: highError }, expectedKind: "error", expected: value });
 }
}

function checked(changes = {}) {
 const result = Query.validateRequest({ ...request, ...changes });
 assert.equal(result.ok, true);
 return result.value;
}
async function scopeSignaturesAndPoolIsolation() {
 const pool = database(), cache = new WeakMap(), options = { scopeCache: cache };
 const initial = await Query.resolveScopes(pool, checked(), options);
 assert.equal(initial.ok, true);
 const same = await Query.resolveScopes(pool, checked({ product: "Other query", pack: "900 g", quantity: 9 }), options);
 assert.equal(same, initial, "Only store scope, not product identity or quantity, is memoized");
 assert.equal(pool.counts.scope, 1);
 for (const changes of [
  { regions: { EDEKA: "Hamburg" } },
  { region: "Hamburg" },
  { storeIds: { EDEKA: ids.other } },
  { storeId: ids.edeka },
  { merchants: ["EDEKA", "REWE"] },
  { merchants: ["REWE", "EDEKA"] }
 ]) {
  const before = pool.counts.scope;
  const changed = await Query.resolveScopes(pool, checked(changes), options);
  assert.equal(changed.ok, true);
  assert.equal(pool.counts.scope, before + 1, "Every changed scope signature gets its own store read: " + JSON.stringify(changes));
 }
 const mapped = checked({ merchants: ["EDEKA", "REWE"], storeIds: { EDEKA: ids.edeka, REWE: ids.rewe }, regions: { EDEKA: "Berlin", REWE: "Berlin" } });
 const mappedFirst = await Query.resolveScopes(pool, mapped, options), before = pool.counts.scope;
 const reordered = checked({ merchants: ["EDEKA", "REWE"], storeIds: { REWE: ids.rewe, EDEKA: ids.edeka }, regions: { REWE: "Berlin", EDEKA: "Berlin" } });
 assert.equal(await Query.resolveScopes(pool, reordered, options), mappedFirst, "Equivalent mapping insertion orders use the same exact signature");
 assert.equal(pool.counts.scope, before);

 const otherPool = database();
 otherPool.stores[0].region = "Another persisted branch region";
 const isolated = await Query.resolveScopes(otherPool, checked(), options);
 assert.equal(otherPool.counts.scope, 1);
 assert.notEqual(isolated, initial, "The WeakMap isolates database pools even with identical request scope");
 assert.equal(isolated.scopes[0].store.region, "Another persisted branch region");
 assert.equal(initial.scopes[0].store.region, "Berlin, DE");
 await Query.resolveScopes(pool, checked());
 await Query.resolveScopes(pool, checked());
 assert.equal(pool.counts.scope, before + 2, "Uncached legacy calls remain independent reads");
}

async function scopeFailureRetry() {
 const pool = database(), options = { scopeCache: new WeakMap() };
 pool.scopeFailures = 1;
 const attempts = await Promise.allSettled([Query.resolveScopes(pool, checked(), options), Query.resolveScopes(pool, checked(), options)]);
 assert(attempts.every(result => result.status === "rejected" && result.reason.message === "scope-read-failed"));
 assert.equal(pool.counts.scope, 1, "Concurrent jobs share the same pending store read, including a rejection");
 const recovered = await Query.resolveScopes(pool, checked(), options);
 assert.equal(recovered.ok, true);
 assert.equal(pool.counts.scope, 2, "Rejected promises must be evicted so a later call can retry");
 assert.equal(await Query.resolveScopes(pool, checked(), options), recovered);
 assert.equal(pool.counts.scope, 2);

 const missing = database(), missingOptions = { scopeCache: new WeakMap() };
 missing.missingScopes = 1;
 const invalid = await Query.resolveScopes(missing, checked(), missingOptions);
 assert.equal(invalid.ok, false);
 assert(invalid.errors.includes("canonical-store-not-found"));
 assert.equal((await Query.resolveScopes(missing, checked(), missingOptions)).ok, true);
 assert.equal(missing.counts.scope, 2, "An ok:false scope result is evicted rather than poisoning the next request");
}

async function main() {
 await repeatedScopesAndFreshRun();
 await workerBoundAndInputOrder();
 await sameGtinDifferentPacks();
 await failureLifecycle();
 await scopeSignaturesAndPoolIsolation();
 await scopeFailureRetry();
 console.log("current-price-batch-lifecycle: invocation-only scope deduplication, fresh evidence, two workers, ordered packs, drained deterministic failures and cache retry/isolation OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
