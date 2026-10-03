"use strict";
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const Directory = require("../aldi-native-article-directory"), PDP = require("../aldi-assortment-article-service");
const Category = require("../aldi-category-article-service"), Parser = require("../aldi-assortment-category-client");
const PdpClient = require("../aldi-assortment-client"), fixture = require("./fixtures/retailers/aldi-public-assortment.json");
const now = Date.parse("2026-10-03T04:30:00.500Z"), at = now - 1000;
const url = "https://www.aldi-nord.de/sortiment/milchprodukte/milch-milchgetraenke.html";
const clone = structuredClone, sha = value => crypto.createHash("sha256").update(value).digest("hex");
let groups = 0;
async function test(name, fn) { try { await fn(); groups++; } catch (error) { console.error("Failed:", name); throw error; } }

// Every category body and HTTP proof here is explicitly synthetic. No archive
// clock is moved and no retailer request or actual SQL connection is used.
function original(sku = "1018999", patch = {}, capture = at) {
  const product = { objectID: sku, productSlug: "unit-native-milch-" + sku, name: "UNIT native Vollmilch",
    brandName: "MILSANI", shortDescription: "3,5 % Fett", salesUnit: "1-L-Packung",
    country: "DE", categoryIDs: ["milch-milchgetraenke"], currentPrice: null,
    isAvailable: false, isRecall: false, isComingSoon: false, ...patch };
  const entry = { state: { index: Parser.INDEX, filters: "categoryIDs:milch-milchgetraenke", hitsPerPage: 1000 },
    requestParams: [{ filters: "categoryIDs:milch-milchgetraenke", hitsPerPage: 1000 }],
    results: [{ hits: [product], nbHits: 1, nbPages: 1, page: 0, hitsPerPage: 1000, index: Parser.INDEX,
      query: "", params: "filters=categoryIDs%3Amilch-milchgetraenke&hitsPerPage=1000",
      exhaustiveNbHits: true, exhaustive: { nbHits: true } }] };
  const data = { page: "/product-overview/[...categories]", query: { categories: ["milchprodukte", "milch-milchgetraenke"] },
    props: { pageProps: { locale: "de", country: "DE", page: {
      "@path": "/germany/sortiment/milchprodukte/milch-milchgetraenke", categoryKey: "milch-milchgetraenke" },
      algoliaState: { initialResults: { [Parser.INDEX]: entry } } } } };
  const body = '<html><head><link rel="canonical" href="' + url
    + '"></head><body><script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(data) + "</script></body></html>";
  const stamp = new Date(capture).toISOString(), meta = { sourceResponseUrl: url, sourceResponseHash: sha(body),
    capturedAt: stamp, sourceResponseDate: stamp, sourceAgeSeconds: 0, scopeCountry: "DE" };
  const page = Parser.parsePage(body, meta, { now: capture + 1000 });
  assert.equal(page.candidates.length, 1, JSON.stringify(page.rejections));
  const row = Category.rowForArticle(Category.articleFor(page.candidates[0], page.categoryId));
  return { body, meta, page, row: { ...row, held: false } };
}
async function pdpRow(sku = "1018999", patch = {}, capture = at - 1000) {
  const native = { ...clone(fixture.product), objectID: sku, productSlug: "unit-native-milch-" + sku,
    name: "UNIT native Vollmilch", currentPrice: null, ...patch };
  const sourceUrl = "https://www.aldi-nord.de/produkt/" + native.productSlug + ".html", stamp = new Date(capture).toISOString();
  const parsed = PdpClient.parseProduct(native, { ...PdpClient.targetForUrl(sourceUrl), capturedAt: stamp,
    sourceResponseDate: stamp, sourceAgeSeconds: 0, sourceResponseHash: "a".repeat(64) });
  assert.equal(parsed.ok, true, JSON.stringify(parsed)); assert.equal(parsed.offer, null);
  let stored;
  const tx = { release() {}, async query(sql, params = []) {
    if (sql.includes("txid_current_if_assigned")) return { rows: [{ transactionOpen: true }] };
    if (sql.startsWith("INSERT INTO " + PDP.TABLE)) { stored = JSON.parse(params[0])[0]; return { rows: [], rowCount: 1 }; }
    if (sql.startsWith("SELECT count(*)")) return { rows: [{ count: 0 }] };
    return { rows: [] };
  } };
  const result = await PDP.persist(tx, [parsed.product], { now: Math.max(now, capture) });
  assert.equal(result.accepted, 1); assert(stored);
  return { ...stored, held: false };
}
function frontier(row, patch = {}) { return { source_id: row.source_id, retailer_sku: row.retailer_sku,
  observed_at: row.observed_at, stored_row: row, latest_held: false, identity_conflict: false, ...patch }; }
function services(overrides = {}) { return { pdp: { ...PDP, ensure: async () => {}, ...overrides.pdp },
  category: { ...Category, ensure: async () => {}, ...overrides.category } }; }
function poolFor(rows, originals = []) {
  const calls = [], captures = new Map(originals.map(o => [o.meta.sourceResponseHash,
    { source_response_hash: o.meta.sourceResponseHash, body: o.body, body_bytes: Buffer.byteLength(o.body) }]));
  const pool = { calls, captures, async query(sql, params = []) {
    calls.push({ sql, params: clone(params) });
    if (sql.startsWith("SELECT source_response_hash,body")) {
      const stored = captures.get(params[0]); return { rows: stored ? [clone(stored)] : [] };
    }
    assert(sql.startsWith("WITH native AS"), "Only the composite frontier and original-body reads are allowed");
    if (!sql.includes(" LIMIT ")) return { rows: rows.slice() };
    if (/\bWHERE false\b/.test(sql)) return { rows: [] };
    return { rows: rows.slice(Number(params.at(-1)), Number(params.at(-1)) + Number(params.at(-2))) };
  } };
  return pool;
}
function noAuthority(result) {
  assert.equal(result.scopeCountry, "DE"); assert.equal(result.scopeChannel, "assortment-publication");
  assert.equal(result.locationScope, "unknown"); assert.equal(result.truthEligible, false);
  assert.equal(result.assortmentComplete, false); assert.equal(result.currentPriceVerified, false);
  for (const item of result.items || []) { assert.equal(item.gtin, null); assert.equal(item.availability, "unknown");
    assert.equal(item.currentPriceVerified, false); assert.equal(item.physicalStorePriceVerified, false);
    assert.equal(item.normalPriceClassificationVerified, false); assert.equal(item.price, undefined);
    assert.equal(item.deposit, undefined); assert.equal(item.expiresAt, null); }
}

(async () => {
  await test("closed sources, default bounds and source-neutral SKU identity", async () => {
    assert.deepEqual(Directory.SOURCE_IDS, [PDP.SOURCE, Category.SOURCE]); assert(Object.isFrozen(Directory.SOURCE_IDS));
    const q = Directory.querySpec({ now }); assert.equal(q.limit, 50); assert.equal(q.offset, 0); assert.equal(q.now, now);
    assert.equal(Directory.CHANNEL, "assortment-publication"); assert.equal(Directory.MERCHANT, "ALDI Nord");
  });
  await test("SQL chooses latest SKU before search, pack filter or pagination", async () => {
    const q = Directory.querySpec({ now, search: "Milk%_\\", pack: "2x500ml", retailerSku: "1018999", limit: 2, offset: 3 });
    const latest = q.sql.indexOf("latest_times AS"), decision = q.sql.indexOf("decisions AS"), filter = q.sql.lastIndexOf(" WHERE ");
    assert(latest > q.sql.indexOf("UNION ALL")); assert(decision > latest); assert(filter > decision);
    assert(q.sql.includes("MAX(observed_at)")); assert(q.sql.includes("GROUP BY retailer_sku"));
    assert(q.sql.includes("JOIN latest_times t USING(retailer_sku,observed_at)"));
    assert(q.sql.includes("BOOL_OR(held)")); assert(q.sql.includes("COUNT(DISTINCT native_identity)>1"));
    assert(q.sql.includes("d.chosen_source=n.source_id")); assert(!q.sql.includes("held=false"));
    assert(!q.sql.slice(0, decision).includes("observed_at<="), "A future latest row must block an older source, then be rejected by the reader");
    assert(q.sql.indexOf("n.name ILIKE") > decision); assert(q.sql.indexOf("n.pack_count=") > decision);
    assert(q.sql.indexOf(" LIMIT ") > filter); assert(q.sql.indexOf(" OFFSET ") > filter);
    assert(!q.sql.includes("Milk%")); assert(!q.sql.includes("=1018999"));
    assert(q.params.includes("%Milk\\%\\_\\\\%")); assert(q.params.includes("1018999"));
    assert(q.params.includes(500)); assert(q.params.includes("ml")); assert.equal(q.params.filter(x => x === 2).length, 2);
    assert.deepEqual(q.params.slice(-2), [2, 3]);
  });
  for (const gtin of ["4046700026519", "40349558", "3017620422003"]) await test("valid closed GTIN yields no invented identity " + gtin, async () => {
    const q = Directory.querySpec({ now, gtin }); assert(q.sql.includes(" WHERE false")); assert(!q.params.includes(gtin));
    const row = await pdpRow(), pool = poolFor([frontier(row)]), result = await Directory.search(pool, { now, gtin }, services());
    assert.deepEqual(result.items, []); assert.equal(result.scannedRows, 0); noAuthority(result);
  });
  for (const gtin of [null, 4046700026519, "4046700026510", " 4046700026519", "4046700026519 ", "40349559", "milk", "", ["4046700026519"]])
    await test("malformed or checksum-invalid GTIN is rejected " + JSON.stringify(gtin), async () => {
      assert.throws(() => Directory.querySpec({ now, gtin }), e => e.code === "invalid-article-gtin");
    });
  for (const patch of [null, [], { unknown: true }, { limit: 0 }, { limit: 201 }, { limit: true }, { limit: 1.5 },
    { offset: -1 }, { offset: 10001 }, { offset: true }, { search: "" }, { search: "x".repeat(121) },
    { search: ["Milch"] }, { search: "Milk\u0000" }, { retailerSku: "001" }, { retailerSku: "1018999 OR true" },
    { pack: "ca. 500 g" }, { scopeChannel: "Berlin" }, { now: Infinity }, { now: "2026-10-03" }])
    await test("query bounds reject before any SQL " + JSON.stringify(patch), async () => {
      assert.throws(() => Directory.querySpec(patch === null || Array.isArray(patch) ? patch : { now, ...patch }), /invalid-/);
    });
  await test("foreign merchant and physical channel are closed no-match predicates", async () => {
    assert(Directory.querySpec({ now, merchant: "REWE" }).sql.includes(" WHERE false"));
    assert(Directory.querySpec({ now, scopeChannel: "physical-store" }).sql.includes(" WHERE false"));
    assert(!Directory.querySpec({ now, merchant: "ALDI Nord", scopeChannel: Directory.CHANNEL }).sql.includes(" WHERE false"));
  });
  await test("real category original reader exposes dated identity without price or PDP proof fiction", async () => {
    const o = original(), before = clone(o), pool = poolFor([frontier(o.row)], [o]);
    const result = await Directory.search(pool, { now }, services());
    assert.equal(result.items.length, 1); const item = result.items[0];
    assert.equal(item.sourceId, Category.SOURCE); assert.equal(item.originalCategoryResponseUrl, url);
    assert.equal(item.sourceResponseHash, o.meta.sourceResponseHash); assert.equal(item.observedAt, o.meta.capturedAt);
    assert.notEqual(item.productIdentityUrl, item.sourceResponseUrl); assert.equal(item.packAmount, 1000);
    assert.equal(item.packUnit, "ml"); assert.equal(item.packCount, 1); noAuthority(result);
    assert.deepEqual(o, before); assert.equal(pool.calls.filter(x => x.sql.startsWith("SELECT source_response_hash,body")).length, 1);
  });
  await test("real PDP reader remains source-specific and dated identities do not expire as prices", async () => {
    const row = await pdpRow("1018999", {}, now - 30 * 86400000), pool = poolFor([frontier(row)]);
    const result = await Directory.search(pool, { now }, services()); assert.equal(result.items.length, 1);
    assert.equal(result.items[0].sourceId, PDP.SOURCE); assert.equal(result.items[0].recentlyObserved, false);
    assert.equal(result.items[0].observedAt, row.observed_at); noAuthority(result);
    assert.equal(pool.calls.length, 1);
  });
  for (const gate of ["latest_held", "identity_conflict"]) await test("latest " + gate + " hides all source alternatives without reading older evidence", async () => {
    const o = original(), old = await pdpRow(); let pdpReads = 0, categoryRows;
    const providers = services({ pdp: { articleFromRow: row => { pdpReads++; return PDP.articleFromRow(row, now); } },
      category: { readRows: async (pool, rows, options) => { categoryRows = rows; return Category.readRows(pool, rows, options); } } });
    const pool = poolFor([frontier(o.row, { [gate]: true })], [o]), result = await Directory.search(pool, { now }, providers);
    assert.equal(PDP.articleFromRow(old, now).retailerSku, o.row.retailer_sku, "An older valid native alternative exists in the fixture");
    assert.deepEqual(result.items, []); assert.equal(result.scannedRows, 1); assert.equal(pdpReads, 0);
    assert.deepEqual(categoryRows, []); assert.equal(pool.calls.length, 1); noAuthority(result);
  });
  for (const kind of ["missing-body", "corrupt-body", "metadata-pack", "self-consistent-variable-pack", "future-capture"])
    await test("latest invalid category " + kind + " never falls back to older valid PDP", async () => {
      const o = original(), r = clone(o.row), old = await pdpRow();
      if (kind === "metadata-pack") r.pack_amount = 1;
      if (kind === "self-consistent-variable-pack") { r.pack = "z. B. 770 g"; r.native_product.salesUnit = r.pack;
        r.witness_hash = Category.serializationHash(r.native_product); }
      if (kind === "future-capture") r.observed_at = new Date(now + 1).toISOString();
      const pool = poolFor([frontier(r)], kind === "missing-body" ? [] : [o]);
      if (kind === "corrupt-body") pool.captures.get(o.meta.sourceResponseHash).body = o.body.replace("UNIT native Vollmilch", "UNIT native Othermilch");
      const result = await Directory.search(pool, { now }, services());
      assert(PDP.articleFromRow(old, now)); assert.deepEqual(result.items, []); assert.equal(result.scannedRows, 1);
      assert(!pool.calls.some(c => c.sql.startsWith("SELECT ") && c.sql.includes(" FROM " + PDP.TABLE)), "No fallback query");
      const status = await Directory.status(pool, { now }, services());
      assert.equal(status.storedArticles, 1); assert.equal(status.lastObservedArticles, 0);
      assert.equal(status.excludedInvalidArticles, 1); assert.equal(status.lastObservedAt, null);
    });
  await test("latest invalid PDP cannot expose an older category original either", async () => {
    const old = original(), row = await pdpRow("1018999", {}, at + 100), pool = poolFor([frontier({ ...row, pack_amount: 1 })], [old]);
    assert.equal((await Category.readRows(pool, [old.row], { now }))[0].retailerSku, row.retailer_sku);
    pool.calls.length = 0; const result = await Directory.search(pool, { now }, services());
    assert.deepEqual(result.items, []); assert.equal(pool.calls.length, 1); assert.equal(result.scannedRows, 1);
  });
  await test("raw pagination advances through held, conflicting and invalid rows", async () => {
    const good = original("1019003"), invalid = original("1019002"), rows = [
      frontier(original("1019000").row, { latest_held: true }), frontier(original("1019001").row, { identity_conflict: true }),
      frontier({ ...invalid.row, capture_hash: "0".repeat(64) }), frontier(good.row) ];
    const pool = poolFor(rows, [invalid, good]), first = await Directory.search(pool, { now, limit: 3 }, services());
    assert.deepEqual(first.items, []); assert.equal(first.scannedRows, 3); assert.equal(first.nextOffset, 3); assert.equal(first.hasMore, true);
    const next = await Directory.search(pool, { now, limit: 3, offset: first.nextOffset }, services());
    assert.equal(next.items.length, 1); assert.equal(next.items[0].retailerSku, "1019003");
    assert.equal(next.scannedRows, 1); assert.equal(next.nextOffset, 4); assert.equal(next.hasMore, false);
    assert(!pool.calls.some(c => /\b(UPDATE|INSERT|DELETE|BEGIN|COMMIT|ROLLBACK)\b/.test(c.sql)));
  });
  await test("equal native SKU source tie is represented once in the composite SQL", async () => {
    const o = original(), older = await pdpRow("1018999", {}, at), pool = poolFor([frontier(o.row)], [o]);
    assert.equal(older.retailer_sku, o.row.retailer_sku); assert.equal(older.observed_at, o.row.observed_at);
    const result = await Directory.search(pool, { now }, services()); assert.equal(result.items.length, 1);
    assert.equal(result.scannedRows, 1); assert.equal(result.items[0].sourceId, Category.SOURCE);
    const sql = pool.calls[0].sql; assert(sql.includes("MIN(source_id) AS chosen_source"));
    assert(sql.includes("GROUP BY retailer_sku")); assert(!sql.includes("GROUP BY retailer_sku,source_id"));
  });
  await test("status uses the same complete frontier and real readers without price or coverage inflation", async () => {
    const cat = original("1018999"), p = await pdpRow("1019000"), bad = { ...clone(cat.row), retailer_sku: "1019004", capture_hash: "0".repeat(64) };
    const rows = [frontier(cat.row), frontier(p), frontier(original("1019001").row, { latest_held: true }),
      frontier(original("1019002").row, { identity_conflict: true }), frontier(bad)];
    const pool = poolFor(rows, [cat]), result = await Directory.status(pool, { now }, services());
    assert.equal(result.storedArticles, 5); assert.equal(result.lastObservedArticles, 2);
    assert.equal(result.heldArticles, 2); assert.equal(result.excludedInvalidArticles, 1);
    assert.equal(result.storedArticles, result.lastObservedArticles + result.heldArticles + result.excludedInvalidArticles);
    assert.equal(result.lastObservedAt, cat.meta.capturedAt); assert.equal(result.physicalStorePriceVerified, false);
    assert.equal(result.normalPriceClassificationVerified, false); noAuthority(result);
    assert.equal(pool.calls[0].sql, Directory.FRONTIER); assert(!pool.calls[0].sql.includes(" LIMIT "));
    assert.equal(result.productsWithCurrentPublishedPrices, undefined); assert.equal(result.currentPrices, undefined);
  });
  await test("source reader alignment errors and DB errors propagate without fallback or partial result", async () => {
    const o = original(), pool = poolFor([frontier(o.row)], [o]);
    await assert.rejects(() => Directory.search(pool, { now }, services({ category: { readRows: async () => [] } })),
      e => e.code === "aldi-native-directory-reader-conflict");
    const failure = Error("original-body-read-failed"), failed = poolFor([frontier(o.row)], [o]), query = failed.query.bind(failed);
    failed.query = (sql, params) => sql.startsWith("SELECT source_response_hash,body") ? Promise.reject(failure) : query(sql, params);
    await assert.rejects(() => Directory.search(failed, { now }, services()), e => e === failure);
  });
  await test("large frontier is rejected explicitly instead of silently capped as complete", async () => {
    const o = original(), pool = poolFor(Array(50001).fill(frontier(o.row)), [o]);
    await assert.rejects(() => Directory.status(pool, { now }, services()), e => e.code === "aldi-native-directory-row-bound");
    assert.equal(pool.calls.length, 1);
  });
  await test("missing database rejected before native service work", async () => {
    await assert.rejects(() => Directory.search(null, { now }, services()), e => e.code === "database-required");
  });
  console.log(`aldi-native-article-directory: ${groups} offline groups passed; latest native SKU frontier, held/invalid no fallback, genuine category originals, raw pagination and unknown physical/price scope`);
})().catch(error => { console.error(error); process.exitCode = 1; });
