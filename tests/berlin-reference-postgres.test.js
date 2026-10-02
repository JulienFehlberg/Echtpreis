"use strict";
const assert = require("assert/strict");
const { Pool } = require("pg");
const Wolt = require("../wolt-retailer-price-service"), Rewe = require("../rewe-retailer-price-service");
const Reference = require("../berlin-reference-prices");
const MARKER = "POSTGRES BERLIN REFERENCE TEST ONLY";
const woltSku = index => "be121100000000000000" + String(index).padStart(4, "0");
const reweArticle = index => "BERLINREFTEST" + index;
const reweSku = index => "8-" + reweArticle(index) + "-" + Rewe.MARKET.nativeStoreId;
function gtin(index) {
  const body = String(985710000000 + index), sum = [...body].reduce((total, digit, position) => total + Number(digit) * (position % 2 ? 3 : 1), 0);
  return body + (10 - sum % 10) % 10;
}
async function main() {
  const connectionString = process.env.DATABASE_URL;
  assert(connectionString, "DATABASE_URL is required");
  const database = new URL(connectionString);
  assert.equal(database.hostname, "localhost", "Only the local isolated PostgreSQL test server is allowed");
  assert(/^\/[a-z0-9_]+_test$/i.test(database.pathname), "Only a dedicated *_test database is allowed");
  const pool = new Pool({ connectionString, ssl: false, connectionTimeoutMillis: 5000 });
  const now = Date.now(), iso = value => new Date(value).toISOString();
  const woltIds = Array.from({ length: 7 }, (_, i) => woltSku(i)), reweIds = Array.from({ length: 4 }, (_, i) => reweSku(i));
  let api, cleanOwn = false, groups = 0;
  function wolt(index, patch = {}) {
    const price = patch.price ?? 1.29, deposit = patch.deposit === undefined ? .25 : patch.deposit;
    return { sourceId: Wolt.SOURCE, merchant: "EDEKA", nativeVenueId: Wolt.VENUE.nativeVenueId, retailerSku: woltSku(index), gtin: gtin(index),
      name: MARKER + " article " + index, brand: MARKER, pack: "1 l", packAmount: 1, packUnit: "l", packCount: 1,
      price, deposit, displayedPrice: (Math.round(price * 100) + Math.round((deposit ?? 0) * 100)) / 100, nativePriceIncludesDeposit: true,
      currency: "EUR", priceType: "unknown", promotionStatus: "unknown", availability: "unknown", capturedAt: iso(now - 8000),
      proofHash: "b".repeat(64), sourceResponseHash: "b".repeat(64),
      sourceUrl: "https://wolt.com/de/deu/berlin/venue/edeka-hilbrecht",
      sourceResponseUrl: "https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/edeka-hilbrecht/assortment/categories/slug/test-berlin-reference",
      shop: { ...Wolt.VENUE }, scopeCountry: "DE", scopeChannel: "online", ...patch };
  }
  function rewe(index, patch = {}) {
    const price = patch.price ?? 1.39, deposit = patch.deposit === undefined ? .25 : patch.deposit;
    return { sourceId: Rewe.SOURCE, merchant: "REWE", nativeMarketId: Rewe.MARKET.nativeMarketId, nativeStoreId: Rewe.MARKET.nativeStoreId,
      retailerSku: reweSku(index), nativeArticleId: reweArticle(index), retailerProductId: String(9857100 + index), gtin: gtin(index),
      name: MARKER + " article " + index, brand: MARKER, pack: "1 l", packAmount: 1, packUnit: "l", packCount: 1,
      price, deposit, displayedPrice: price, nativePriceIncludesDeposit: false, currency: "EUR", priceType: "unknown", promotionStatus: "unknown", availability: "unknown",
      capturedAt: iso(now - 8000), proofHash: "c".repeat(64), sourceResponseHash: "c".repeat(64),
      sourceUrl: "https://www.rewe.de/shop/p/postgres-berlin-reference-test/" + (9857100 + index),
      sourceResponseUrl: "https://www.rewe.de/shop/api/products?marketId=8321066&serviceTypes=PICKUP&page=1&objectsPerPage=40",
      shop: { ...Rewe.MARKET }, scopeCountry: "DE", scopeChannel: "pickup", serviceType: "PICKUP", ...patch };
  }
  const exists = async table => !!(await pool.query("SELECT to_regclass($1) AS name", ["public." + table])).rows[0].name;
  async function snapshot(table, predicate = "true", params = []) {
    if (!await exists(table)) return null;
    return (await pool.query("SELECT count(*)::int AS count,md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM " + table + " t WHERE " + predicate, params)).rows[0];
  }
  try {
    await Wolt.ensure(pool); await Rewe.ensure(pool);
    for (const [table, source, ids] of [[Wolt.TABLE, Wolt.SOURCE, woltIds], [Rewe.TABLE, Rewe.SOURCE, reweIds]]) {
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM " + table + " WHERE source_id=$1 AND retailer_sku=ANY($2::text[])", [source, ids])).rows[0].count, 0, "Reserved test SKU fixtures must be absent before this run");
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM " + table + " WHERE gtin=ANY($1::text[])", [Array.from({ length: 7 }, (_, i) => gtin(i))])).rows[0].count, 0, "Reserved synthetic GTIN fixtures must not overlap another test");
    }
    cleanOwn = true;
    const otherTables = ["products", "stores", "price_observations", "receipts", "retailer_published_prices", "aldi_assortment_published_prices", "price_source_refresh_state", "hit_assortment_refresh_state", "hit_price_import_evidence"];
    const baseline = new Map();
    for (const table of otherTables) baseline.set(table, await snapshot(table));
    const quoteBaseline = [await snapshot(Wolt.TABLE), await snapshot(Rewe.TABLE)];

    const firstWolt = wolt(0), firstRewe = rewe(0);
    assert.equal((await Wolt.persist(pool, [firstWolt], { now })).upserted, 1);
    assert.equal((await Rewe.persist(pool, [firstRewe], { now })).upserted, 1);
    const shared = await Reference.search(pool, { gtin: gtin(0), pack: "1 l", now });
    assert.equal(shared.items.length, 2); assert.deepEqual(shared.items.map(row => row.offer.merchant).sort(), ["EDEKA", "REWE"]);
    assert.deepEqual(shared.scopeChannels, ["online", "pickup"]);
    for (const row of shared.items) { assert.equal(row.offer.truthEligible, false); assert.equal(row.reference.observedAt, row.offer.capturedAt); assert.equal(row.reference.sourceMarket.city, "Berlin"); assert.equal(row.reference.observedMarkets, 1); }
    assert.equal(shared.items.find(row => row.offer.merchant === "EDEKA").offer.displayedPrice, 1.54);
    assert.equal(shared.items.find(row => row.offer.merchant === "REWE").offer.displayedPrice, 1.39); groups++;

    const newer = wolt(0, { price: 1.99, capturedAt: iso(now - 1000), proofHash: "d".repeat(64), sourceResponseHash: "d".repeat(64) });
    assert.equal((await Wolt.persist(pool, [newer], { now })).upserted, 1);
    assert.equal((await Wolt.persist(pool, [firstWolt], { now })).unchanged, 1);
    const latest = (await Reference.search(pool, { gtin: gtin(0), pack: "1000 ml", merchant: "EDEKA", now })).items[0];
    assert.equal(latest.offer.price, 1.99, "The real ledger's newer higher price wins"); assert.equal(latest.reference.observedAt, newer.capturedAt);
    assert.deepEqual(latest.reference.knownPriceRange, { min: 1.99, max: 1.99 }); groups++;

    const nativeWolt = wolt(1, { gtin: null, deposit: null }), nativeRewe = rewe(1, { gtin: null, deposit: null });
    assert.equal((await Wolt.persist(pool, [nativeWolt], { now })).upserted, 1); assert.equal((await Rewe.persist(pool, [nativeRewe], { now })).upserted, 1);
    const native = await Reference.search(pool, { search: MARKER + " article 1", pack: "1 l", now });
    assert.equal(native.items.length, 2);
    for (const row of native.items) { assert.equal(row.offer.gtin, null); assert.equal(row.reference.identityKind, "native-retailer-sku"); assert.equal(row.offer.deposit, null); assert.equal(row.offer.payablePackPrice, null); } groups++;

    const multipack = wolt(2, { gtin: gtin(0), pack: "2 x 500 ml", packAmount: 500, packUnit: "ml", packCount: 2 });
    assert.equal((await Wolt.persist(pool, [multipack], { now })).upserted, 1);
    assert.equal((await Reference.search(pool, { gtin: gtin(0), pack: "2 x 500 ml", now })).items.length, 1);
    assert.equal((await Reference.search(pool, { gtin: gtin(0), pack: "500 ml", now })).items.length, 0);
    assert.equal((await Reference.search(pool, { gtin: gtin(0), pack: "1 l", now })).items.length, 2, "Same total volume does not blend a different native sales pack"); groups++;

    const deadline = iso(now + 60000), validity = rewe(2, { nativePromotionValidTo: deadline });
    assert.equal((await Rewe.persist(pool, [validity], { now })).upserted, 1);
    const validityRow = (await Reference.search(pool, { gtin: gtin(2), now })).items[0];
    assert.equal(validityRow.offer.expiresAt, deadline); assert.equal(validityRow.offer.priceType, "unknown");
    assert.equal((await Reference.search(pool, { gtin: gtin(2), now: now + 60000 })).items.length, 0); groups++;

    const expiredWolt = wolt(3, { capturedAt: iso(now - Wolt.DAY_MS - 1) }), expiredRewe = rewe(3, { capturedAt: iso(now - Rewe.DAY_MS - 1) });
    assert.equal((await Wolt.persist(pool, [expiredWolt], { now })).upserted, 1); assert.equal((await Rewe.persist(pool, [expiredRewe], { now })).upserted, 1);
    assert.equal((await Reference.search(pool, { gtin: gtin(3), now })).items.length, 0); groups++;

    const oldIdentity = wolt(4), newIdentity = wolt(4, { gtin: null, capturedAt: iso(now - 1000), proofHash: "e".repeat(64), sourceResponseHash: "e".repeat(64) });
    assert.equal((await Wolt.persist(pool, [oldIdentity], { now })).upserted, 1); assert.equal((await Wolt.persist(pool, [newIdentity], { now })).upserted, 1);
    assert.equal((await Reference.search(pool, { gtin: gtin(4), now })).items.length, 0);
    const currentNative = (await Reference.search(pool, { search: MARKER + " article 4", now })).items[0];
    assert.equal(currentNative.offer.gtin, null); assert.equal(currentNative.reference.observedAt, newIdentity.capturedAt); groups++;

    const tieA = wolt(5, { price: 1.19 }), tieB = wolt(6, { gtin: gtin(5), price: 1.99 });
    assert.equal((await Wolt.persist(pool, [tieA, tieB], { now })).accepted, 2);
    const tied = await Reference.search(pool, { gtin: gtin(5), pack: "1 l", now });
    assert.equal(tied.items.length, 0); assert.equal(tied.coverage.excludedReasons["ambiguous-market-latest-capture"], 1); groups++;

    const beforeReads = [await snapshot(Wolt.TABLE, "source_id=$1 AND retailer_sku=ANY($2::text[])", [Wolt.SOURCE, woltIds]), await snapshot(Rewe.TABLE, "source_id=$1 AND retailer_sku=ANY($2::text[])", [Rewe.SOURCE, reweIds])];
    assert.equal((await Reference.search(pool, { search: MARKER, merchant: "ALDI", now })).items.length, 0);
    assert.equal((await Reference.search(pool, { search: MARKER, scopeChannel: "physical-store", now })).items.length, 0);
    assert.equal((await Reference.search(pool, { search: MARKER, now: now + Wolt.DAY_MS + 1 })).items.length, 0); groups++;

    // Listen directly: never start server.start(), background schedulers, or collectors.
    process.env.PORT = "0"; api = require("../server");
    await new Promise((resolve, reject) => { api.server.once("error", reject); api.server.listen(0, "127.0.0.1", () => { api.server.off("error", reject); resolve(); }); });
    const base = "http://127.0.0.1:" + api.server.address().port;
    async function get(query = "") { const response = await fetch(base + "/v1/berlin-reference-prices" + query, { signal: AbortSignal.timeout(10000) }); return { status: response.status, body: await response.json() }; }
    const exact = await get("?" + new URLSearchParams({ gtin: gtin(0), pack: "1 l" }));
    assert.equal(exact.status, 200, JSON.stringify(exact)); assert.equal(exact.body.items.length, 2);
    assert.equal(exact.body.items.find(row => row.offer.merchant === "EDEKA").offer.price, 1.99);
    assert.equal(exact.body.coverage.complete, false); assert.equal(exact.body.coverage.allStoresRequired, false);
    assert.equal(exact.body.physicalStorePrices, false); assert.equal(exact.body.bounded, true); groups++;

    const noGtinHttp = await get("?" + new URLSearchParams({ search: MARKER + " article 1", pack: "1 l" }));
    assert.equal(noGtinHttp.status, 200); assert.equal(noGtinHttp.body.items.length, 2); assert(noGtinHttp.body.items.every(row => row.offer.gtin === null));
    const expiredHttp = await get("?gtin=" + gtin(3)); assert.equal(expiredHttp.status, 200); assert.equal(expiredHttp.body.items.length, 0); groups++;

    for (const query of ["", "?search=" + encodeURIComponent(MARKER) + "&unknown=1", "?search=" + encodeURIComponent(MARKER) + "&search=other", "?gtin=invalid", "?search=" + encodeURIComponent(MARKER) + "&limit=201"]) {
      const invalid = await get(query); assert.equal(invalid.status, 400, JSON.stringify(invalid)); assert(invalid.body.error);
    } groups++;

    assert.deepEqual(await snapshot(Wolt.TABLE, "source_id=$1 AND retailer_sku=ANY($2::text[])", [Wolt.SOURCE, woltIds]), beforeReads[0]);
    assert.deepEqual(await snapshot(Rewe.TABLE, "source_id=$1 AND retailer_sku=ANY($2::text[])", [Rewe.SOURCE, reweIds]), beforeReads[1], "Reads never renew captures, original expiries, hashes, or nullable GTINs");
    for (const [table, previous] of baseline) assert.deepEqual(await snapshot(table), previous, "Berlin references must not mutate preexisting " + table);
    assert.deepEqual(await snapshot(Wolt.TABLE, "NOT (source_id=$1 AND retailer_sku=ANY($2::text[]))", [Wolt.SOURCE, woltIds]), quoteBaseline[0]);
    assert.deepEqual(await snapshot(Rewe.TABLE, "NOT (source_id=$1 AND retailer_sku=ANY($2::text[]))", [Rewe.SOURCE, reweIds]), quoteBaseline[1]); groups++;
    console.log("berlin-reference-postgres: " + groups + " actual SQL/HTTP synthetic fixture groups OK; native Wolt/REWE persist+search, latest higher quote, exact multipacks, nullable native identity, expiry, tie withholding, 400 validation, zero read-induced or preexisting-data mutations");
  } finally {
    if (api) { if (api.server.listening) await new Promise((resolve, reject) => api.server.close(error => error ? reject(error) : resolve())); await api.closeDb(); }
    if (cleanOwn) { await pool.query("DELETE FROM " + Wolt.TABLE + " WHERE source_id=$1 AND retailer_sku=ANY($2::text[])", [Wolt.SOURCE, woltIds]); await pool.query("DELETE FROM " + Rewe.TABLE + " WHERE source_id=$1 AND retailer_sku=ANY($2::text[])", [Rewe.SOURCE, reweIds]); }
    await pool.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
