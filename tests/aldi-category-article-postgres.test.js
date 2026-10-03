"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Client = require("../aldi-assortment-category-client");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const clone = value => structuredClone(value);
const CATEGORY = "https://www.aldi-nord.de/sortiment/milchprodukte/milch-milchgetraenke.html";
const CATEGORY_ID = "milch-milchgetraenke";
const sku = index => String(950340000000 + index);

// The native shape and fixed-pack example below were observed in the archived
// category HTML (SHA256 9d2cc334cda0b1653052d243635cac30fd25c54650015a6633c5edbc51bc9526).
// That archive has no original Date/Age and is NOT imported or moved to today.
// Every body made here is a NEW, explicitly synthetic SQL fixture, with its own
// body hash, headers, capture time, test SKU and test name. No retailer HTTP runs.
function rawProduct(index, patch = {}) {
  return { syntheticSQLOriginal: true, objectID: sku(index),
    productSlug: "postgres-test-category-article-" + sku(index),
    name: "POSTGRES TEST category article " + index, brandName: "POSTGRES TEST",
    shortDescription: "fixed native variety", salesUnit: "1-Liter-Packung",
    categoryIDs: [CATEGORY_ID, "postgres-test"], country: "DE",
    isAvailable: true, isComingSoon: false, isRecall: false,
    isDepositProduct: false, depositValue: 0, isDrainedWeight: false,
    drainedWeightValue: 0, currentPrice: null, ...patch };
}
function capture(index, at, patch = {}, options = {}) {
  const url = options.url || CATEGORY, path = new URL(url).pathname.replace(/\.html$/, "");
  const categories = path.slice("/sortiment/".length).split("/"), categoryId = categories.at(-1);
  const hits = options.hits || [rawProduct(index, patch)];
  const hitsPerPage = options.hitsPerPage || 1000, nbHits = options.nbHits ?? hits.length;
  const filter = "categoryIDs:" + categoryId;
  const native = { syntheticSQLOriginal: true, page: "/product-overview/[...categories]",
    query: { categories }, props: { pageProps: { locale: "de", country: "DE",
      page: { "@path": "/germany" + path, categoryKey: categoryId },
      mgnlContext: { isMagnoliaEdit: false, isMagnoliaPreview: false },
      algoliaState: { initialResults: { [Client.INDEX]: {
        state: { index: Client.INDEX, filters: filter, hitsPerPage,
          numericRefinements: {}, tagRefinements: [] },
        requestParams: [{ filters: filter, hitsPerPage }],
        results: [{ hits, nbHits, nbPages: Math.ceil(nbHits / hitsPerPage),
          page: 0, hitsPerPage, index: Client.INDEX, query: "",
          params: new URLSearchParams({ filters: filter, hitsPerPage: String(hitsPerPage) }).toString(),
          exhaustiveNbHits: true, exhaustive: { nbHits: true } }]
      } } } } } };
  if (options.navigation) native.props.pageProps.page.header = [
    { sideDrawerNavigation: [{ Produkte: options.navigation.map(path => ({ path })) }] }
  ];
  const body = '<!doctype html><html><head><link rel="canonical" href="' + url
    + '"/></head><body><script id="__NEXT_DATA__" type="application/json">'
    + JSON.stringify(native) + "</script></body></html>";
  const iso = new Date(at).toISOString();
  const meta = { sourceResponseUrl: url, sourceResponseHash: sha(body),
    sourceResponseDate: iso, sourceAgeSeconds: 0, capturedAt: iso, scopeCountry: "DE" };
  const page = Client.parsePage(body, meta, { now: at });
  return { body, meta, page, native };
}

function pdpCapture(index, at, patch = {}) {
  const PDPClient = require("../aldi-assortment-client");
  const raw = rawProduct(index, patch);
  // A separate NEW synthetic PDP original; the category HTML/hash is never
  // relabelled as a product-detail response or an old source capture.
  const body = '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify({
    props: { pageProps: { syntheticSQLOriginal: true, apiData: JSON.stringify([
      ["PRODUCT_DETAIL_GET", { req: { productIds: [sku(index)] }, res: { products: [raw] } }]
    ]) } }
  }) + "</script>";
  const iso = new Date(at).toISOString(), meta = {
    sourceUrl: PDPClient.ORIGIN + "/produkt/" + raw.productSlug + ".html",
    capturedAt: iso, sourceResponseDate: iso, sourceAgeSeconds: 0,
    sourceResponseHash: sha(body), raw: body
  };
  const parsed = PDPClient.parseProduct(PDPClient.extractProducts(body).products[0], meta);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.equal(parsed.offer, null, "The PDP fixture remains explicitly price-less");
  return { body, meta, product: parsed.product };
}

function offlineFixtureCheck() {
  const now = Date.parse("2026-10-03T03:00:00.123Z"), value = capture(0, now);
  const before = clone(value), candidate = value.page.candidates[0];
  assert.equal(value.page.freshCaptureVerified, true);
  assert.equal(value.page.candidateCount, 1);
  assert.equal(value.page.categoryProof.sourceResponseHash, sha(value.body));
  assert.equal(value.page.categoryProof.bodyBytes, Buffer.byteLength(value.body));
  assert.equal(candidate.identity.retailerSku, sku(0));
  assert.equal(candidate.identity.gtin, null);
  assert.equal(candidate.identity.normalizedSalesPack.total.amount, 1000);
  assert.equal(candidate.identity.normalizedSalesPack.total.unit, "ml");
  assert.equal(candidate.identity.normalizedSalesPack.count, 1);
  assert.notEqual(candidate.identity.productIdentityUrl, candidate.categoryProof.sourceResponseUrl);
  for (const key of ["truthEligible", "currentPriceVerified", "physicalStorePriceVerified", "assortmentComplete", "admitted"])
    assert.equal(candidate[key], false);
  assert.equal(candidate.price, undefined);
  assert.equal(candidate.scopeCountry, "DE");
  assert.equal(candidate.scopeChannel, "category-publication");
  assert.equal(candidate.locationScope, "unknown");
  assert.equal(candidate.availability, "unknown");
  const priced = capture(1, now, { currentPrice: { priceValue: .59, validFrom: 1, validUntil: 1893366000 } });
  assert.equal(priced.page.candidates[0].price, undefined, "Raw source price is witness data, not an admitted quote");
  for (const patch of [{ salesUnit: "z. B. 770 g" }, { salesUnit: "ca. 770 g" },
    { shortDescription: "verschiedene Gewichte" }, { salesUnit: "700-900 g" }]) {
    const rejected = capture(2, now, patch);
    assert.equal(rejected.page.candidateCount, 0); assert.equal(rejected.page.rejectedCount, 1);
  }
  const multi = capture(3, now, { salesUnit: "9x500ml" });
  assert.equal(multi.page.candidates[0].identity.normalizedSalesPack.count, 9);
  assert.equal(multi.page.candidates[0].identity.normalizedSalesPack.total.amount, 4500);
  const truncated = capture(4, now, {}, { hits: [rawProduct(4)], hitsPerPage: 1, nbHits: 2 });
  assert.equal(truncated.page.extractionComplete, false);
  assert.equal(truncated.page.pagination.truncated, true);
  assert.equal(truncated.page.assortmentComplete, false);
  const offline = Client.parsePage(value.body, {}, { now });
  assert.equal(offline.offlineOnly, true); assert.equal(offline.freshCaptureVerified, false);
  const Service = require("../aldi-category-article-service");
  const admitted = Service.validateArticle(candidate, { now, original: { body: value.body, meta: value.meta } });
  assert.equal(admitted.ok, true, JSON.stringify(admitted.reasons));
  assert.equal(admitted.article.sourceId, Service.SOURCE);
  assert.equal(admitted.article.scopeChannel, Service.CHANNEL);
  assert.equal(admitted.article.gtin, null); assert.equal(admitted.article.storeId, null);
  assert.equal(admitted.article.identityScope, "retailer-sku");
  assert.equal(admitted.article.observedAt, value.meta.capturedAt);
  assert.equal(admitted.article.originalCategoryResponseUrl, CATEGORY);
  assert.equal(admitted.article.packAmount, 1000); assert.equal(admitted.article.packUnit, "ml");
  assert.equal(admitted.article.price, undefined); assert.equal(admitted.article.truthEligible, false);
  for (const mutation of [c => c.identity.gtin = "4046700026519", c => c.truthEligible = true,
    c => c.identity.normalizedSalesPack.count = 2, c => c.rawNativeProduct.name = "Changed witness"]) {
    const changed = clone(candidate); mutation(changed);
    assert.equal(Service.validateArticle(changed, { now, original: { body: value.body, meta: value.meta } }).ok, false);
  }
  assert.equal(Service.validateArticle(candidate, { now }).ok, false);
  assert.equal(Service.validateArticle(offline.candidates[0], { now, original: { body: value.body, meta: {} } }).ok, false);
  assert.equal(Service.validateArticle(admitted.article, { now, original: { body: value.body, meta: value.meta } }).ok, false,
    "A public or flat admitted Article DTO cannot be resubmitted as a native category candidate");
  const stored = Service.rowForArticle(admitted.article);
  assert.equal(stored.source_response_hash, sha(value.body));
  assert.equal(stored.witness_hash, Service.serializationHash(candidate.rawNativeProduct));
  assert.equal(stored.pack_count, 1);
  const Prices = require("../aldi-category-price-service"), Refresh = require("../aldi-category-refresh");
  const Fetch = require("../aldi-category-fetch-client");
  const quote = Prices.quoteFor(priced.page.candidates[0], priced.page.categoryId, now);
  assert.equal(quote.ok, true, JSON.stringify(quote.reasons));
  assert.equal(Prices.validateOffer(quote.offer, { now }).ok, true);
  assert.equal(quote.offer.price, .59); assert.equal(quote.offer.gtin, null);
  assert.equal(quote.offer.sourceResponseHash, priced.meta.sourceResponseHash);
  assert.equal(quote.offer.truthEligible, false); assert.equal(quote.offer.normalPriceClassificationVerified, false);
  assert.equal(Prices.quoteFor(candidate, value.page.categoryId, now).ok, false, "A price-less identity does not create a quote");
  const positiveDeposit = capture(10, now, { salesUnit: "2x500ml", isDepositProduct: true, depositValue: .25,
    currentPrice: { priceValue: 2.29, validFrom: Math.floor(now / 1000) - 60,
      validUntil: Math.floor(now / 1000) + 2 * 86400 } });
  const positiveQuote = Prices.quoteFor(positiveDeposit.page.candidates[0], positiveDeposit.page.categoryId, now);
  assert.equal(positiveQuote.ok, true); assert.equal(positiveQuote.offer.deposit, null);
  assert.equal(positiveQuote.offer.payablePackPrice, null); assert.equal(positiveQuote.offer.packCount, 2);
  const links = ["https://www.aldi-nord.de/sortiment/postgres-checkpoint-a.html",
    "https://www.aldi-nord.de/sortiment/postgres-checkpoint-b.html"];
  const offered = capture(11, now, {}, { navigation: links });
  assert.deepEqual(Fetch.navigationTargets(offered.body), links);
  const observed = { page: offered.page, original: { body: offered.body, meta: offered.meta }, discoveredTargets: links };
  const next = Refresh.nextState(Refresh.state({}), observed, now);
  assert.equal(next.nextIndex, 1); assert.equal(next.revision, 1); assert.equal(next.targets.length, 3);
  assert.equal(next.targetProofs.length, 2); assert.equal(next.targetProofs[0].sourceResponseHash, sha(offered.body));
  assert.equal(Refresh.dueAt({ cursor: next }, now), now + Refresh.CONTINUATION_MS);
  const PDP = require("../aldi-assortment-article-service"), Directory = require("../aldi-native-article-directory");
  const pdp = pdpCapture(12, now);
  const validPDP = PDP.validateArticle(pdp.product, { now });
  assert.equal(validPDP.ok, true, JSON.stringify(validPDP.reasons));
  assert.equal(validPDP.article.packAmount, 1000); assert.equal(validPDP.article.packUnit, "ml");
  assert.equal(validPDP.article.sourceUrl, pdp.meta.sourceUrl);
  assert.equal(validPDP.article.sourceResponseHash, sha(pdp.body));
  assert.notEqual(validPDP.article.sourceId, Service.SOURCE);
  assert.equal(Directory.querySpec({ gtin: "3017620422003", now }).sql.includes(" WHERE false"), true);
  assert.throws(() => Directory.querySpec({ gtin: "GTIN:3017620422003", now }), /invalid-article-gtin/);
  assert.deepEqual(value, before, "Offline validation does not modify captures or native input");
  console.log("aldi-category-article-postgres: offline synthetic original/category/pack/priceless, independent service admission, price/deposit and actual-handler fixture checks passed; no DB or HTTP");
}

async function main() {
  if (process.argv.includes("--offline-fixture-check")) { offlineFixtureCheck(); return; }
  const { Pool } = require("pg"), Service = require("../aldi-category-article-service");
  const connectionString = process.env.DATABASE_URL;
  assert(connectionString, "DATABASE_URL is required");
  const database = new URL(connectionString);
  assert(["localhost", "127.0.0.1"].includes(database.hostname) && !database.search && !database.hash
    && /^\/[a-z][a-z0-9_]*_test$/.test(database.pathname),
  "Only a dedicated named loopback *_test database is allowed");
  const pool = new Pool({ connectionString, ssl: false, connectionTimeoutMillis: 5000 });
  let articlesPool, tx, schemaCreated = false, groups = 0;
  const schemaName = "aldi_category_sql_test_" + crypto.randomBytes(8).toString("hex");
  assert(/^aldi_category_sql_test_[a-f0-9]{16}$/.test(schemaName));
  const now = Date.now(), base = now - 10000;
  const test = async (name, operation) => { await operation(); groups++; };
  async function snapshot(table, client = pool) {
    const exists = (await client.query("SELECT to_regclass($1) AS name", ["public." + table])).rows[0].name;
    if (!exists) return null;
    return (await client.query(`SELECT count(*)::int AS total,
      md5(COALESCE(string_agg(row_to_json(t)::text, chr(10) ORDER BY row_to_json(t)::text), '')) AS hash
      FROM public.${table} t`)).rows[0];
  }
  try {
    const version = (await pool.query("SHOW server_version_num")).rows[0].server_version_num;
    assert.equal(Math.floor(Number(version) / 10000), 18, "This program verifies PostgreSQL 18, not an older server");
    const immutableTables = ["products", "stores", "merchants", "external_product_mappings",
      "external_store_mappings", "price_observations", "receipt_submissions", "receipts",
      "retailer_published_prices", "wolt_retailer_published_prices", "rewe_retailer_published_prices",
      "aldi_assortment_published_prices", "aldi_assortment_articles", "wolt_retailer_articles",
      "hit_price_import_evidence", "hit_assortment_refresh_state", "aldi_assortment_catalog_state",
      "rewe_retailer_catalog_state", "wolt_retailer_catalog_state", "aldi_category_published_prices",
      "aldi_category_catalog_state", Service.TABLE, Service.CAPTURE_TABLE];
    const before = {};
    for (const table of immutableTables) before[table] = await snapshot(table);
    await pool.query("CREATE SCHEMA " + schemaName); schemaCreated = true;
    articlesPool = new Pool({ connectionString, ssl: false, connectionTimeoutMillis: 5000,
      options: "-c search_path=" + schemaName + ",public" });
    await Service.ensure(articlesPool);
    assert.equal((await articlesPool.query("SELECT count(*)::int AS total FROM " + Service.TABLE)).rows[0].total, 0);
    assert.equal((await articlesPool.query("SELECT count(*)::int AS total FROM " + Service.CAPTURE_TABLE)).rows[0].total, 0);

    // More actual SQL cases below exercise a genuine PoolClient. This isolated
    // test adapter is deliberately not a production collector or a fake tx.
    const original = value => ({ body: value.body, meta: value.meta });
    const save = (client, value, extra = {}) => Service.persist(client, value.page,
      { now, original: original(value), ...extra });
    const search = (client, index, extra = {}) => Service.search(client,
      { retailerSku: sku(index), now, ...extra });
    const row = async (client, index) => (await client.query("SELECT * FROM " + Service.TABLE
      + " WHERE retailer_sku=$1", [sku(index)])).rows[0];
    const total = async (client, table) => (await client.query("SELECT count(*)::int AS total FROM " + table)).rows[0].total;
    const first = capture(0, base), beforeFirst = clone(first);

    await test("separate private schemas and no price/canonical/store columns", async () => {
      const names = (await articlesPool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",
        [schemaName, Service.TABLE])).rows.map(value => value.column_name);
      for (const forbidden of ["price", "deposit", "currency", "expires_at", "gtin", "store_id", "product_id"])
        assert(!names.includes(forbidden), "An identity ledger cannot store admitted " + forbidden);
      assert(names.includes("category_response_url") && names.includes("product_identity_url"));
      const captureNames = (await articlesPool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",
        [schemaName, Service.CAPTURE_TABLE])).rows.map(value => value.column_name);
      assert(captureNames.includes("body") && captureNames.includes("source_response_hash") && captureNames.includes("body_bytes"));
      assert.notEqual(Service.SOURCE, "ALDI Nord published assortment");
    });

    tx = await articlesPool.connect();
    await test("genuine assigned writing PoolClient gate", async () => {
      assert.equal(typeof tx.connect, "function");
      assert.equal(Object.hasOwn(tx, "connect"), false, "Do not hide PoolClient's inherited connect");
      await assert.rejects(() => save(tx, first), /open-writing-transaction-required/);
      await assert.rejects(() => save(articlesPool, first), /transaction-client-required/);
      await tx.query("BEGIN");
      await assert.rejects(() => save(tx, first), /open-writing-transaction-required/);
      await tx.query("SELECT txid_current()");
    });

    const water = capture(1, base, { salesUnit: "9x500ml", isAvailable: false });
    const pricedWitness = capture(2, base, { currentPrice: { priceValue: .59,
      validFrom: 1, validUntil: 1893366000 } });
    const oldAt = now - 30 * 86400000, dated = capture(3, oldAt);
    await test("native price-less and priced witnesses create only identities", async () => {
      for (const value of [first, water, pricedWitness]) {
        const saved = await save(tx, value);
        assert.equal(saved.accepted, 1); assert.equal(saved.upserted, 1);
        assert.equal(saved.priceRowsCreated, 0); assert.equal(saved.canonicalProductsCreated, 0);
        assert.equal(saved.truthEligible, false); assert.equal(saved.locationScope, "unknown");
      }
      const saved = await save(tx, dated, { now: oldAt });
      assert.equal(saved.accepted, 1); assert.equal(saved.upserted, 1);
      assert.equal(await total(tx, Service.TABLE), 4);
      const item = (await search(tx, 0)).items[0];
      assert.equal(Service.validateView(item, { now }).ok, true);
      assert.equal(item.gtin, null); assert.equal(item.storeId, undefined);
      assert.equal(item.identityScope, "retailer-sku");
      assert.equal(item.state, "last-observed"); assert.equal(item.availability, "unknown");
      assert.equal(item.scopeCountry, "DE"); assert.equal(item.scopeChannel, Service.CHANNEL);
      assert.equal(item.locationScope, "unknown"); assert.equal(item.observedAt, first.meta.capturedAt);
      assert.equal(item.sourceResponseHash, first.meta.sourceResponseHash);
      assert.equal(item.originalCategoryResponseUrl, CATEGORY);
      assert.notEqual(item.productIdentityUrl, item.sourceResponseUrl);
      for (const flag of ["truthEligible", "currentPriceVerified", "currentAvailabilityVerified",
        "physicalStorePriceVerified", "normalPriceClassificationVerified", "assortmentComplete"])
        assert.equal(item[flag], false);
      for (const absent of ["price", "deposit", "currency", "nativeProduct", "nativeWitness", "body", "productId"])
        assert.equal(item[absent], undefined);
      assert.equal(item.expiresAt, null);
      assert.equal((await search(tx, 3)).items[0].recentlyObserved, false);
      assert.equal((await search(tx, 3)).items[0].observedAt, dated.meta.capturedAt,
        "A dated article identity does not expire as if it were a current price");
      assert.deepEqual(first, beforeFirst, "Admission leaves the original page and capture untouched");
    });

    await test("native sales count is separate from equal total volume", async () => {
      assert.equal((await search(tx, 1, { pack: "9 x 500 ml" })).items.length, 1);
      assert.equal((await search(tx, 1, { pack: "4.5 l" })).items.length, 0);
      assert.equal((await search(tx, 0, { pack: "1000 ml" })).items.length, 1);
      assert.equal((await search(tx, 0, { pack: "2x500ml" })).items.length, 0);
    });

    await test("replay and same-body genuine new headers preserve provenance", async () => {
      const beforeReplay = await row(tx, 0), count = await total(tx, Service.CAPTURE_TABLE);
      const replay = await save(tx, first);
      assert.equal(replay.upserted, 0); assert.equal(replay.unchanged, 1);
      assert.deepEqual(await row(tx, 0), beforeReplay);
      assert.equal(await total(tx, Service.CAPTURE_TABLE), count);
      const retimed = clone(first);
      retimed.meta.capturedAt = new Date(base + 500).toISOString();
      retimed.page = Client.parsePage(retimed.body, retimed.meta, { now });
      const rejected = await save(tx, retimed);
      assert.equal(rejected.accepted, 0); assert.equal(rejected.retimedReplays, 1);
      assert.equal(rejected.rejected, 1); assert.deepEqual(await row(tx, 0), beforeReplay);
      const genuine = capture(0, base + 1000);
      assert.equal(genuine.body, first.body);
      const updated = await save(tx, genuine);
      assert.equal(updated.upserted, 1);
      assert.equal((await search(tx, 0)).items[0].observedAt, genuine.meta.capturedAt);
      assert.equal((await row(tx, 0)).source_response_hash, first.meta.sourceResponseHash);
      const latest = await row(tx, 0);
      await save(tx, first); assert.deepEqual(await row(tx, 0), latest, "An older page is not a latest identity fallback");
    });

    await test("same-time identity conflict holds and genuinely newer capture resolves", async () => {
      const contrary = capture(0, base + 1000, { salesUnit: "2x500ml" });
      const saved = await save(tx, contrary);
      assert.equal(saved.heldArticles, 1); assert.equal(saved.accepted, 0);
      assert.equal((await search(tx, 0)).items.length, 0);
      const held = await row(tx, 0);
      assert.equal(held.held, true);
      assert.equal(held.conflict_response_hash, contrary.meta.sourceResponseHash);
      assert.equal(held.conflict_capture.source_response_hash, contrary.meta.sourceResponseHash);
      await save(tx, first); await save(tx, contrary);
      assert.deepEqual(await row(tx, 0), held, "Old or tied clean evidence cannot reopen held identity");
      const resolved = capture(0, base + 2000, { name: "POSTGRES TEST genuinely newer category identity" });
      await save(tx, resolved);
      assert.equal((await row(tx, 0)).held, false);
      assert.equal((await row(tx, 0)).conflict_capture, null);
      assert.equal((await search(tx, 0)).items[0].observedAt, resolved.meta.capturedAt);
      const anotherCategory = "https://www.aldi-nord.de/sortiment/postgres-test.html";
      const sameAt = capture(0, base + 2000, { name: resolved.page.candidates[0].identity.name,
        categoryIDs: [CATEGORY_ID, "postgres-test"] }, { url: anotherCategory });
      assert.notEqual(sameAt.meta.sourceResponseHash, resolved.meta.sourceResponseHash);
      const beforeSameIdentity = await row(tx, 0);
      await save(tx, sameAt);
      assert.equal((await row(tx, 0)).held, false);
      assert.deepEqual(await row(tx, 0), beforeSameIdentity,
        "Equal native identity in another category is not an identity conflict or a recapture");
    });

    await test("admission rejects forged page, missing original and proof/authority changes", async () => {
      const beforeBad = await row(tx, 0), captureCount = await total(tx, Service.CAPTURE_TABLE);
      for (const mutate of [p => p.candidates[0].identity.gtin = "4046700026519",
        p => p.candidates[0].scopeCountry = "AT", p => p.candidates[0].scopeChannel = "physical-store",
        p => p.candidates[0].truthEligible = true, p => p.candidates[0].identity.normalizedSalesPack.count = 2,
        p => p.candidates[0].rawNativeProduct.name = "Forged native witness",
        p => p.candidateCount = 2]) {
        const changed = clone(first.page); mutate(changed);
        await assert.rejects(() => Service.persist(tx, changed, { now, original: original(first) }), /page-original-conflict/);
      }
      await assert.rejects(() => Service.persist(tx, first.page, { now }), /original-required/);
      const noAge = clone(first); delete noAge.meta.sourceAgeSeconds;
      await assert.rejects(() => save(tx, noAge), /fresh-original-required/);
      const future = capture(4, now + 1);
      await assert.rejects(() => save(tx, future), /capture-future/);
      const stale = capture(4, now - 300001);
      await assert.rejects(() => save(tx, stale), /capture-stale/);
      const hashConflict = clone(first); hashConflict.meta.sourceResponseHash = "0".repeat(64);
      await assert.rejects(() => save(tx, hashConflict), /response-hash-conflict/);
      const dateConflict = clone(first); dateConflict.meta.sourceResponseDate = new Date(base - 300001).toISOString();
      await assert.rejects(() => save(tx, dateConflict), /source-proof-invalid/);
      assert.deepEqual(await row(tx, 0), beforeBad);
      assert.equal(await total(tx, Service.CAPTURE_TABLE), captureCount);
    });

    await test("ambiguous native rows remain explicit rejections and truncated pages stay partial", async () => {
      const rejected = capture(5, base, { salesUnit: "z. B. 770 g" });
      const saved = await save(tx, rejected);
      assert.equal(saved.received, 1); assert.equal(saved.validatedInputs, 0);
      assert.equal(saved.accepted, 0); assert.equal(saved.rejected, 1);
      assert.equal(saved.upserted, 0); assert.equal((await search(tx, 5)).items.length, 0);
      const partial = capture(5, base, {}, { hitsPerPage: 1, nbHits: 2 });
      const partialSaved = await save(tx, partial);
      assert.equal(partialSaved.accepted, 1); assert.equal(partial.page.extractionComplete, false);
      assert.equal((await Service.status(tx, { now })).assortmentComplete, false);
    });

    await test("actual SQL closed scopes, finite pack, witness and proof constraints", async () => {
      const violations = ["source_id='unapproved source'", "merchant='REWE'", "retailer_sku='0'",
        "scope_country='AT'", "scope_channel='physical-store'", "location_scope='Berlin'",
        "pack_amount=0", "pack_amount='NaN'::numeric", "pack_count=0", "pack_count=1001",
        "pack_unit='kg'", "product_identity_url='https://example.org/product/1'",
        "category_response_url='https://www.aldi-nord.de/produkt/article-1.html'",
        "source_response_hash='BAD'", "source_age_seconds=301",
        "source_response_date=observed_at-interval '6 minutes'", "native_product='[]'::jsonb",
        "witness_hash='BAD'", "held=true,conflict_capture=NULL", "held=true,conflict_capture='{}'::jsonb"];
      for (const change of violations) {
        await tx.query("SAVEPOINT invalid_category_sql");
        await assert.rejects(() => tx.query("UPDATE " + Service.TABLE + " SET " + change
          + " WHERE retailer_sku=$1", [sku(0)]), error => error.code === "23514", change);
        await tx.query("ROLLBACK TO SAVEPOINT invalid_category_sql");
      }
      await tx.query("SAVEPOINT category_fk");
      await assert.rejects(() => tx.query("UPDATE " + Service.TABLE
        + " SET source_response_hash=repeat('0',64) WHERE retailer_sku=$1", [sku(0)]), error => error.code === "23503");
      await tx.query("ROLLBACK TO SAVEPOINT category_fk");
      await tx.query("SAVEPOINT category_body_bound");
      await assert.rejects(() => tx.query("UPDATE " + Service.CAPTURE_TABLE + " SET body_bytes=0"), error => error.code === "23514");
      await tx.query("ROLLBACK TO SAVEPOINT category_body_bound");
    });

    await test("readers independently verify private original bytes and canonical row hashes", async () => {
      const template = await row(tx, 0), beforeStatus = await Service.status(tx, { now });
      for (const change of ["capture_hash=repeat('0',64)", "witness_hash=repeat('0',64)",
        "product_identity_url='https://www.aldi-nord.de/produkt/wrong-1.html'",
        "observed_at=observed_at+interval '2 days',source_response_date=source_response_date+interval '2 days'"]) {
        await tx.query("SAVEPOINT invalid_category_reader");
        await tx.query("UPDATE " + Service.TABLE + " SET " + change + " WHERE retailer_sku=$1", [sku(0)]);
        assert.equal((await search(tx, 0)).items.length, 0, change);
        const status = await Service.status(tx, { now });
        assert.equal(status.excludedInvalidArticles, beforeStatus.excludedInvalidArticles + 1);
        assert.equal(status.lastObservedArticles, beforeStatus.lastObservedArticles - 1);
        await tx.query("ROLLBACK TO SAVEPOINT invalid_category_reader");
      }
      await tx.query("SAVEPOINT corrupt_category_body");
      await tx.query("UPDATE " + Service.CAPTURE_TABLE
        + " SET body=replace(body,'POSTGRES TEST','POSTGRES XEST') WHERE source_response_hash=$1", [template.source_response_hash]);
      assert.equal((await search(tx, 0)).items.length, 0, "Self-sized body corruption cannot masquerade as the original hash");
      const unchangedOriginal = capture(0, base + 2000, { name: "POSTGRES TEST genuinely newer category identity" });
      assert.equal(unchangedOriginal.meta.sourceResponseHash, template.source_response_hash);
      await assert.rejects(() => save(tx, unchangedOriginal), /stored-original-conflict/,
        "A preexisting corrupt body cannot be silently accepted by ON CONFLICT DO NOTHING");
      await tx.query("ROLLBACK TO SAVEPOINT corrupt_category_body");
      assert.deepEqual(await row(tx, 0), template);
    });

    await test("self-consistent legacy uncertain pack still fails independent native admission", async () => {
      const fixed = capture(6, base + 4000, { salesUnit: "770-g-Packung" });
      await save(tx, fixed);
      const validated = Service.validateArticle(fixed.page.candidates[0], { now, original: original(fixed) });
      assert.equal(validated.ok, true);
      const baseline = await Service.status(tx, { now });
      for (const patch of [{ salesUnit: "z. B. 770 g" }, { salesUnit: "ca. 770 g" },
        { salesUnit: "700-900 g" }, { shortDescription: "verschiedene Gewichte" }]) {
        await tx.query("SAVEPOINT legacy_category_pack");
        const uncertain = capture(6, base + 4000, { salesUnit: "770-g-Packung", ...patch });
        assert.equal(uncertain.page.candidates.length, 0);
        const legacy = { ...clone(validated.article), pack: patch.salesUnit || validated.article.pack,
          variant: patch.shortDescription || validated.article.variant,
          nativeProduct: uncertain.native.props.pageProps.algoliaState.initialResults[Client.INDEX].results[0].hits[0],
          sourceResponseHash: uncertain.meta.sourceResponseHash };
        const nativeRow = Service.rowForArticle(legacy), keys = Object.keys(nativeRow);
        await tx.query("INSERT INTO " + Service.CAPTURE_TABLE
          + "(source_response_hash,body,body_bytes) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [uncertain.meta.sourceResponseHash, uncertain.body, Buffer.byteLength(uncertain.body)]);
        await tx.query("UPDATE " + Service.TABLE + " SET " + keys.map((key, index) => key + "=$" + (index + 1)).join(",")
          + " WHERE retailer_sku=$" + (keys.length + 1),
        [...keys.map(key => key === "native_product" ? JSON.stringify(nativeRow[key]) : nativeRow[key]), sku(6)]);
        assert.equal((await search(tx, 6)).items.length, 0, "Matching hashes cannot turn variable native sales weight into a fixed article");
        const status = await Service.status(tx, { now });
        assert.equal(status.storedArticles, baseline.storedArticles);
        assert.equal(status.excludedInvalidArticles, baseline.excludedInvalidArticles + 1);
        assert.equal(status.lastObservedArticles, baseline.lastObservedArticles - 1);
        await tx.query("ROLLBACK TO SAVEPOINT legacy_category_pack");
      }
    });

    await test("literal and scoped queries never promote price/stock or fabricated GTIN", async () => {
      assert.equal((await Service.search(tx, { search: "article%_", now })).items.length, 0);
      assert.equal((await Service.search(tx, { merchant: "REWE", now })).items.length, 0);
      assert.equal((await search(tx, 0, { scopeChannel: "physical-store" })).items.length, 0);
      assert.equal((await search(tx, 0, { categoryUrl: CATEGORY })).items.length, 1);
      assert.equal((await Service.search(tx, { gtin: "3017620422003", now })).items.length, 0);
      await assert.rejects(() => Service.search(tx, { gtin: "GTIN:3017620422003", now }), /invalid-category-article-gtin/);
      const status = await Service.status(tx, { now });
      assert.equal(status.storedArticles, status.heldArticles + status.excludedInvalidArticles + status.lastObservedArticles);
      assert.equal(status.currentAvailabilityVerified, false); assert.equal(status.currentPriceVerified, false);
      assert.equal(status.physicalStorePriceVerified, false); assert.equal(status.assortmentComplete, false);
      assert.equal(status.locationScope, "unknown"); assert.equal(status.scopeCountry, "DE");
    });

    await test("whole page shares one bounded original and retains exact native rejection counts", async () => {
      const page = capture(7, base, {}, { hits: [rawProduct(7), rawProduct(8),
        rawProduct(9, { salesUnit: "ca. 770 g" })] });
      assert.equal(page.page.receivedCount, 3); assert.equal(page.page.candidateCount, 2);
      const beforeCaptures = await total(tx, Service.CAPTURE_TABLE);
      const saved = await save(tx, page);
      assert.equal(saved.received, 3); assert.equal(saved.validatedInputs, 2);
      assert.equal(saved.accepted, 2); assert.equal(saved.rejected, 1); assert.equal(saved.upserted, 2);
      assert.equal(await total(tx, Service.CAPTURE_TABLE), beforeCaptures + 1);
      assert.equal((await row(tx, 7)).source_response_hash, (await row(tx, 8)).source_response_hash);
      assert.equal((await search(tx, 7)).items.length, 1); assert.equal((await search(tx, 8)).items.length, 1);
      assert.equal((await search(tx, 9)).items.length, 0);
      const replay = await save(tx, page);
      assert.equal(replay.upserted, 0); assert.equal(replay.unchanged, 2);
      assert.equal(await total(tx, Service.CAPTURE_TABLE), beforeCaptures + 1);
    });

    await test("outer rollback restores article and private capture tables together", async () => {
      await tx.query("ROLLBACK");
      assert.equal(await total(articlesPool, Service.TABLE), 0);
      assert.equal(await total(articlesPool, Service.CAPTURE_TABLE), 0);
    });

    await test("real Pool adapter commits article and checkpoint atomically, with failure retry", async () => {
      await articlesPool.query("CREATE TABLE category_test_checkpoint(source_id text PRIMARY KEY,page_count int NOT NULL CHECK(page_count>=0),cursor jsonb NOT NULL)");
      const checkpoint = async () => (await articlesPool.query("SELECT * FROM category_test_checkpoint ORDER BY source_id")).rows;
      async function commitPage(value, pageCount, failAfterWrite = false) {
        const client = await articlesPool.connect();
        try {
          await client.query("BEGIN"); await client.query("SELECT txid_current()");
          const saved = await save(client, value);
          if (failAfterWrite) throw new Error("POSTGRES TEST after real category write");
          await client.query("INSERT INTO category_test_checkpoint(source_id,page_count,cursor) VALUES($1,$2,$3::jsonb)"
            + " ON CONFLICT(source_id) DO UPDATE SET page_count=EXCLUDED.page_count,cursor=EXCLUDED.cursor",
          [Service.SOURCE, pageCount, JSON.stringify({ categoryUrl: CATEGORY, confirmedPages: pageCount })]);
          await client.query("COMMIT"); return saved;
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      }
      const one = capture(20, base), two = capture(21, base + 1000), three = capture(22, base + 2000);
      assert.equal((await commitPage(one, 1)).accepted, 1);
      const firstCheckpoint = await checkpoint(); assert.equal(firstCheckpoint[0].page_count, 1);
      const firstCaptures = await total(articlesPool, Service.CAPTURE_TABLE);
      await assert.rejects(() => commitPage(two, 2, true), /after real category write/);
      assert.equal((await search(articlesPool, 21)).items.length, 0);
      assert.deepEqual(await checkpoint(), firstCheckpoint);
      assert.equal(await total(articlesPool, Service.CAPTURE_TABLE), firstCaptures);
      assert.equal((await commitPage(two, 2)).upserted, 1);
      const secondCheckpoint = await checkpoint(); assert.equal(secondCheckpoint[0].page_count, 2);
      await articlesPool.query(`CREATE FUNCTION category_test_checkpoint_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.page_count=3 THEN RAISE EXCEPTION 'POSTGRES TEST category checkpoint failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER category_test_checkpoint_failure BEFORE INSERT OR UPDATE ON category_test_checkpoint
        FOR EACH ROW EXECUTE FUNCTION category_test_checkpoint_failure();`);
      const beforeThirdCaptures = await total(articlesPool, Service.CAPTURE_TABLE);
      await assert.rejects(() => commitPage(three, 3), /category checkpoint failure/);
      assert.equal((await search(articlesPool, 22)).items.length, 0);
      assert.deepEqual(await checkpoint(), secondCheckpoint);
      assert.equal(await total(articlesPool, Service.CAPTURE_TABLE), beforeThirdCaptures);
      await articlesPool.query("DROP TRIGGER category_test_checkpoint_failure ON category_test_checkpoint; DROP FUNCTION category_test_checkpoint_failure()");
      const retried = await commitPage(three, 3);
      assert.equal(retried.accepted, 1); assert.equal(retried.upserted, 1);
      assert.equal((await checkpoint())[0].page_count, 3);
      assert.equal((await Service.status(articlesPool, { now })).lastObservedArticles, 3);
      assert.equal(await total(articlesPool, Service.TABLE), 3);
      assert.equal(await total(articlesPool, Service.CAPTURE_TABLE), 3);
      const beforeRetry = await checkpoint(); const replay = await commitPage(three, 3);
      assert.equal(replay.upserted, 0); assert.deepEqual(await checkpoint(), beforeRetry);
    });

    await test("actual category handler atomically commits native article, published price and its source cursor", async () => {
      const Refresh = require("../aldi-category-refresh"), Prices = require("../aldi-category-price-service");
      const Fetch = require("../aldi-category-fetch-client");
      assert.equal(Fetch.SEED, CATEGORY);
      const childA = "https://www.aldi-nord.de/sortiment/postgres-checkpoint-a.html";
      const childB = "https://www.aldi-nord.de/sortiment/postgres-checkpoint-b.html";
      // Advance a virtual test clock through real cooldowns while remaining
      // strictly before the actual current time; no archived native proof is retimed.
      let runClock = now - 3 * 3600000, fetches = 0;
      const observed = (index, target, withPrice, navigation = []) => {
        const at = runClock - 1000, categoryId = new URL(target).pathname.split("/").at(-1).replace(/\.html$/, "");
        const value = capture(index, at, { categoryIDs: [categoryId],
          salesUnit: index === 32 ? "2x500ml" : "1-Liter-Packung",
          isDepositProduct: index === 32, depositValue: index === 32 ? .25 : 0,
          currentPrice: withPrice ? { priceValue: index === 32 ? 2.29 : 1.11,
            validFrom: Math.floor(at / 1000) - 60, validUntil: Math.floor(at / 1000) + 2 * 86400 } : null },
        { url: target, navigation });
        assert.deepEqual(Fetch.navigationTargets(value.body), [...navigation].sort());
        return { sourceId: Service.SOURCE, page: value.page, original: original(value), discoveredTargets: navigation,
          requests: 1, bytes: Buffer.byteLength(value.body), truthEligible: false, assortmentComplete: false };
      };
      const handlerState = async () => (await articlesPool.query("SELECT * FROM " + Refresh.TABLE
        + " WHERE source_id=$1", [Service.SOURCE])).rows[0];
      const run = async (index, target, withPrice, extras = {}) => Refresh.refresh(
        { pool: articlesPool, maxRequests: 1, now: () => runClock }, {
          canFetch: async () => true,
          fetchPage: async requested => { assert.equal(requested, target); fetches++;
            return observed(index, target, withPrice, index === 30 ? [childA, childB] : []); },
          ...extras
        });
      await Refresh.ensure(articlesPool); await Prices.ensure(articlesPool);
      const firstRun = await run(30, CATEGORY, true);
      assert.equal(firstRun.pages, 1); assert.equal(firstRun.requests, 1);
      assert.equal(firstRun.identityAccepted, 1); assert.equal(firstRun.accepted, 1);
      assert.equal(firstRun.catalog.targetCategories, 3); assert.equal(firstRun.catalog.scannedCategories, 1);
      assert.equal(firstRun.catalog.fullAssortment, false);
      const firstCursor = (await handlerState()).cursor;
      assert.equal(firstCursor.revision, 1); assert.equal(firstCursor.nextIndex, 1);
      assert.equal(firstCursor.targets[1], childA); assert.equal(firstCursor.targetProofs.length, 2);
      const firstArticle = (await search(articlesPool, 30, { now: runClock })).items[0];
      const firstPrice = (await Prices.search(articlesPool, { retailerSku: sku(30), now: runClock })).items[0];
      assert.equal(firstPrice.price, 1.11); assert.equal(firstPrice.gtin, null);
      assert.equal(firstPrice.sourceResponseHash, firstArticle.sourceResponseHash);
      assert.equal(firstPrice.capturedAt, firstArticle.observedAt);
      assert.equal(firstPrice.sourceUrl, CATEGORY);
      assert.notEqual(firstPrice.productIdentityUrl, firstPrice.sourceUrl);
      assert.equal(firstPrice.truthEligible, false); assert.equal(firstPrice.normalPriceClassificationVerified, false);

      runClock += Refresh.CONTINUATION_MS;
      const beforeFailedBodies = await total(articlesPool, Service.CAPTURE_TABLE);
      let writeFailure;
      try { await run(31, childA, false, { articles: { ...Service,
        persist: async (...args) => { const saved = await Service.persist(...args);
          assert.equal(saved.upserted, 1); throw new Error("POSTGRES TEST handler after actual article write"); } } }); }
      catch (error) { writeFailure = error; }
      assert(writeFailure && /after actual article write/.test(writeFailure.message));
      assert.deepEqual((await handlerState()).cursor, firstCursor);
      assert.equal((await search(articlesPool, 31, { now: runClock })).items.length, 0);
      assert.equal(await total(articlesPool, Service.CAPTURE_TABLE), beforeFailedBodies);
      const beforeCooldownFetches = fetches;
      const notDue = await run(31, childA, false);
      assert.equal(notDue.skipped, "category-not-due"); assert.equal(fetches, beforeCooldownFetches);
      assert.equal(notDue.nextAttemptAt, writeFailure.nextAttemptAt);
      assert.equal((await search(articlesPool, 30, { now: runClock })).items[0].observedAt, firstArticle.observedAt);
      assert.equal((await Prices.search(articlesPool, { retailerSku: sku(30), now: runClock })).items[0].capturedAt,
        firstPrice.capturedAt, "An error pause cannot renew the previous successful quote");

      runClock = Date.parse(writeFailure.nextAttemptAt) + 1;
      const secondRun = await run(31, childA, false);
      assert.equal(secondRun.pages, 1); assert.equal(secondRun.identityAccepted, 1); assert.equal(secondRun.accepted, 0);
      assert.equal((await Prices.search(articlesPool, { retailerSku: sku(31), now: runClock })).items.length, 0);
      const secondCursor = (await handlerState()).cursor;
      assert.equal(secondCursor.revision, 2); assert.equal(secondCursor.nextIndex, 2);
      assert.equal((await handlerState()).last_error, null);

      await articlesPool.query(`CREATE FUNCTION block_actual_category_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.last_error IS NULL AND (NEW.cursor->>'revision')::int=3 THEN
          RAISE EXCEPTION 'POSTGRES TEST actual handler checkpoint failure'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER block_actual_category_checkpoint BEFORE INSERT OR UPDATE ON ${Refresh.TABLE}
        FOR EACH ROW EXECUTE FUNCTION block_actual_category_checkpoint();`);
      runClock += Refresh.CONTINUATION_MS;
      const beforeThirdBodies = await total(articlesPool, Service.CAPTURE_TABLE);
      let checkpointFailure;
      try { await run(32, childB, true); } catch (error) { checkpointFailure = error; }
      assert(checkpointFailure && /actual handler checkpoint failure/.test(checkpointFailure.message));
      assert.deepEqual((await handlerState()).cursor, secondCursor);
      assert.equal((await search(articlesPool, 32, { now: runClock })).items.length, 0);
      assert.equal((await Prices.search(articlesPool, { retailerSku: sku(32), now: runClock })).items.length, 0);
      assert.equal(await total(articlesPool, Service.CAPTURE_TABLE), beforeThirdBodies);
      await articlesPool.query("DROP TRIGGER block_actual_category_checkpoint ON " + Refresh.TABLE
        + "; DROP FUNCTION block_actual_category_checkpoint()");
      const beforeCheckpointCooldownFetches = fetches;
      assert.equal((await run(32, childB, true)).skipped, "category-not-due");
      assert.equal(fetches, beforeCheckpointCooldownFetches);
      runClock = Date.parse(checkpointFailure.nextAttemptAt) + 1;
      assert(runClock < now, "All synthetic Retry captures remain before real now");
      const thirdRun = await run(32, childB, true);
      assert.equal(thirdRun.pages, 1); assert.equal(thirdRun.identityAccepted, 1); assert.equal(thirdRun.accepted, 1);
      assert.equal(thirdRun.catalog.categoryTraversalFinished, true); assert.equal(thirdRun.catalog.fullAssortment, false);
      const finalCursor = (await handlerState()).cursor;
      assert.equal(finalCursor.revision, 3); assert.equal(finalCursor.nextIndex, 3); assert.equal(finalCursor.completedPasses, 1);
      assert.equal((await handlerState()).last_error, null);
      const finalPrice = (await Prices.search(articlesPool, { retailerSku: sku(32), now: runClock })).items[0];
      assert.equal(finalPrice.price, 2.29); assert.equal(finalPrice.packCount, 2);
      assert.equal(finalPrice.deposit, null); assert.equal(finalPrice.payablePackPrice, null);
      assert.equal(finalPrice.capturedAt, new Date(runClock - 1000).toISOString());
      assert.equal(finalPrice.expiresAt, new Date(runClock - 1000 + 86400000).toISOString());
      assert.equal((await Service.status(articlesPool, { now })).lastObservedArticles, 6);
      assert.equal((await Prices.status(articlesPool, { now })).currentPrices, 2);
      assert.equal(await total(articlesPool, Service.TABLE), 6);
      assert.equal(await total(articlesPool, Service.CAPTURE_TABLE), 6);
      assert.equal((await Prices.status(articlesPool, { now })).productsWithCurrentPublishedPrices, 0);
    });

    await test("a genuinely newer price-less category identity hides the older quote without deleting it", async () => {
      const Prices = require("../aldi-category-price-service"), older = (await Prices.search(articlesPool,
        { retailerSku: sku(30), now })).items[0];
      assert(older && older.price === 1.11);
      const previousRow = await row(articlesPool, 30), bodies = await total(articlesPool, Service.CAPTURE_TABLE);
      const newer = capture(30, now - 1000, { currentPrice: null });
      await tx.query("BEGIN"); await tx.query("SELECT txid_current()");
      const articles = await save(tx, newer);
      assert.equal(articles.accepted, 1); assert.equal(articles.upserted, 1);
      const quotes = await Prices.persist(tx, newer.page, { now, original: original(newer) });
      assert.equal(quotes.accepted, 0); assert.equal(quotes.upserted, 0);
      assert.equal((await search(tx, 30)).items[0].observedAt, newer.meta.capturedAt);
      assert.equal((await Prices.search(tx, { retailerSku: sku(30), now })).items.length, 0);
      assert.equal((await tx.query("SELECT count(*)::int AS total FROM " + Prices.TABLE
        + " WHERE retailer_sku=$1", [sku(30)])).rows[0].total, 1, "Older quote is retained privately, not exposed as current");
      await tx.query("ROLLBACK");
      assert.deepEqual(await row(articlesPool, 30), previousRow);
      assert.equal(await total(articlesPool, Service.CAPTURE_TABLE), bodies);
      assert.equal((await Prices.search(articlesPool, { retailerSku: sku(30), now })).items[0].capturedAt, older.capturedAt);
    });

    const PDP = require("../aldi-assortment-article-service"), Directory = require("../aldi-native-article-directory");
    await PDP.ensure(articlesPool);
    const frontierSnapshot = async table => (await articlesPool.query(`SELECT count(*)::int AS total,
      md5(COALESCE(string_agg(row_to_json(t)::text, chr(10) ORDER BY row_to_json(t)::text), '')) AS hash
      FROM ${table} t`)).rows[0];
    const frontierBefore = {};
    for (const table of [PDP.TABLE, Service.TABLE, Service.CAPTURE_TABLE]) frontierBefore[table] = await frontierSnapshot(table);
    await tx.query("BEGIN"); await tx.query("SELECT txid_current()");
    const savePDP = async (index, at, patch = {}) => {
      const value = pdpCapture(index, at, patch), result = await PDP.persist(tx, [value.product], { now });
      assert.equal(result.accepted, 1); assert.equal(result.priceRowsCreated, 0);
      return value;
    };
    const directorySearch = (index, extra = {}) => Directory.search(tx, { retailerSku: sku(index), now, ...extra });

    await test("native frontier collapses duplicate SKU before search and pagination, retaining the latest price-less identity", async () => {
      await savePDP(40, base + 500, { name: "POSTGRES TEST frontier old milk" });
      const current = capture(40, base + 2000, { name: "POSTGRES TEST frontier current milk", salesUnit: "2x500ml" });
      assert.equal(current.page.candidates[0].rawNativeProduct.currentPrice, null);
      await save(tx, current);
      await savePDP(41, base + 1000, { name: "POSTGRES TEST frontier remaining butter", salesUnit: "250-g-Packung" });
      const latest = await directorySearch(40);
      assert.equal(latest.items.length, 1); assert.equal(latest.scannedRows, 1);
      assert.equal(latest.items[0].sourceId, Service.SOURCE);
      assert.equal(latest.items[0].name, current.page.candidates[0].identity.name);
      assert.equal(latest.items[0].observedAt, current.meta.capturedAt);
      assert.equal(latest.items[0].price, undefined); assert.equal(latest.items[0].currentPriceVerified, false);
      assert.equal(latest.items[0].availability, "unknown"); assert.equal(latest.items[0].gtin, null);
      assert.equal((await Directory.search(tx, { search: "frontier old milk", now })).items.length, 0,
        "Search cannot resurrect a label from an older observation of the same SKU");
      assert.equal((await directorySearch(40, { pack: "1 l" })).items.length, 0);
      assert.equal((await directorySearch(40, { pack: "2x500ml" })).items.length, 1);
      const firstPage = await Directory.search(tx, { search: "frontier", limit: 1, offset: 0, now });
      const secondPage = await Directory.search(tx, { search: "frontier", limit: 1, offset: 1, now });
      const lastPage = await Directory.search(tx, { search: "frontier", limit: 1, offset: 2, now });
      assert.equal(firstPage.items[0].retailerSku, sku(40)); assert.equal(firstPage.nextOffset, 1);
      assert.equal(secondPage.items[0].retailerSku, sku(41)); assert.equal(secondPage.nextOffset, 2);
      assert.equal(lastPage.items.length, 0); assert.equal(lastPage.scannedRows, 0);
      assert.equal(lastPage.hasMore, false, "A duplicate older source row cannot consume another page");
      assert.equal((await PDP.search(tx, { retailerSku: sku(40), now })).items.length, 1,
        "The older PDP still exists privately; only the cross-source frontier suppresses it");
    });

    await test("latest held category blocks older valid PDP fallback before search", async () => {
      await savePDP(42, base, { name: "POSTGRES TEST clean older held fallback" });
      const latest = capture(42, base + 1000, { name: "POSTGRES TEST held category original" });
      const contrary = capture(42, base + 1000, { name: "POSTGRES TEST held category contrary", salesUnit: "2x500ml" });
      await save(tx, latest); assert.equal((await save(tx, contrary)).heldArticles, 1);
      const baseline = await Directory.status(tx, { now });
      assert(baseline.heldArticles >= 1);
      assert.equal((await directorySearch(42)).items.length, 0);
      assert.equal((await Directory.search(tx, { search: "clean older held fallback", now })).items.length, 0);
      assert.equal((await PDP.search(tx, { retailerSku: sku(42), now })).items.length, 1);
      const raw = (await tx.query(Directory.FRONTIER + " WHERE n.retailer_sku=$1", [sku(42)])).rows;
      assert.equal(raw.length, 1); assert.equal(raw[0].latest_held, true);
    });

    await test("latest invalid category blocks an older valid PDP without hiding the validation gap", async () => {
      await savePDP(43, base, { name: "POSTGRES TEST clean older invalid fallback" });
      await save(tx, capture(43, base + 1000, { name: "POSTGRES TEST newest invalid category" }));
      const beforeInvalid = await Directory.status(tx, { now });
      await tx.query("UPDATE " + Service.TABLE + " SET capture_hash=repeat('0',64) WHERE retailer_sku=$1", [sku(43)]);
      assert.equal((await directorySearch(43)).items.length, 0);
      assert.equal((await Directory.search(tx, { search: "clean older invalid fallback", now })).items.length, 0);
      assert.equal((await PDP.search(tx, { retailerSku: sku(43), now })).items.length, 1);
      const invalid = await Directory.status(tx, { now });
      assert.equal(invalid.storedArticles, beforeInvalid.storedArticles);
      assert.equal(invalid.excludedInvalidArticles, beforeInvalid.excludedInvalidArticles + 1);
      assert.equal(invalid.lastObservedArticles, beforeInvalid.lastObservedArticles - 1);
    });

    await test("cross-source equal-time different identity holds one SKU and identical identity deduplicates", async () => {
      await savePDP(44, base + 1500, { name: "POSTGRES TEST tie PDP identity" });
      await save(tx, capture(44, base + 1500, { name: "POSTGRES TEST tie category identity" }));
      assert.equal((await PDP.search(tx, { retailerSku: sku(44), now })).items.length, 1);
      assert.equal((await search(tx, 44)).items.length, 1);
      assert.equal((await directorySearch(44)).items.length, 0);
      const tie = (await tx.query(Directory.FRONTIER + " WHERE n.retailer_sku=$1", [sku(44)])).rows;
      assert.equal(tie.length, 1); assert.equal(tie[0].identity_conflict, true);
      assert.equal(tie[0].latest_held, false, "Cross-source conflict is recognized even when neither private ledger is held");
      await savePDP(45, base + 2000, { name: "POSTGRES TEST exact equal native identity" });
      await save(tx, capture(45, base + 2000, { name: "POSTGRES TEST exact equal native identity" }));
      const identical = await directorySearch(45);
      assert.equal(identical.items.length, 1); assert.equal(identical.scannedRows, 1);
      const same = (await tx.query(Directory.FRONTIER + " WHERE n.retailer_sku=$1", [sku(45)])).rows;
      assert.equal(same.length, 1); assert.equal(same[0].identity_conflict, false);
      const status = await Directory.status(tx, { now });
      assert.equal(status.storedArticles, 12, "Six existing category SKUs plus six new native SKUs; source duplicates count once");
      assert.equal(status.heldArticles, 2); assert.equal(status.excludedInvalidArticles, 1);
      assert.equal(status.lastObservedArticles, 9);
      assert.equal(status.truthEligible, false); assert.equal(status.currentPriceVerified, false);
      assert.equal(status.assortmentComplete, false); assert.equal(status.locationScope, "unknown");
    });

    await test("native frontier rejects invalid GTIN while a valid unsupported GTIN gives no identities", async () => {
      for (const gtin of ["not-a-gtin", " 3017620422003", "GTIN:3017620422003", "3017620422004", null, 3017620422003])
        await assert.rejects(() => Directory.search(tx, { gtin, now }), /invalid-article-gtin/);
      const valid = await Directory.search(tx, { gtin: "3017620422003", search: "POSTGRES TEST", limit: 1, now });
      assert.equal(valid.items.length, 0); assert.equal(valid.scannedRows, 0); assert.equal(valid.hasMore, false);
      assert.equal(valid.nextOffset, 0);
      await tx.query("ROLLBACK");
      for (const table of [PDP.TABLE, Service.TABLE, Service.CAPTURE_TABLE])
        assert.deepEqual(await frontierSnapshot(table), frontierBefore[table], "Frontier test restores own " + table);
    });

    await test("native extreme Retry-After clamp roundtrips the actual PostgreSQL deadline parameter", async () => {
      const Refresh = require("../aldi-category-refresh"), Fetch = require("../aldi-category-fetch-client");
      const milliseconds = Fetch.retryAfter(new Headers({ "retry-after": "999999999999999999999999999999" }), now);
      assert.equal(milliseconds, 8640000000000000 - now);
      const deadline = new Date(now + milliseconds).toISOString();
      assert.equal(deadline, "+275760-09-13T00:00:00.000Z");
      const before = (await articlesPool.query("SELECT * FROM " + Refresh.TABLE + " WHERE source_id=$1", [Service.SOURCE])).rows[0];
      await tx.query("BEGIN"); await tx.query("SELECT txid_current()");
      // Same String parameter type as the production retry_after checkpoint;
      // no conversion to a fake Date object or a reduced, easier horizon.
      await tx.query("UPDATE " + Refresh.TABLE + " SET retry_after=$2::timestamptz WHERE source_id=$1", [Service.SOURCE, deadline]);
      const loaded = await Refresh.load(tx);
      assert.equal(new Date(loaded.retryAfter).getTime(), 8640000000000000);
      assert.equal(new Date(loaded.retryAfter).toISOString(), deadline);
      assert.equal(Refresh.dueAt(loaded, now), 8640000000000000);
      await tx.query("ROLLBACK");
      const restored = (await articlesPool.query("SELECT * FROM " + Refresh.TABLE + " WHERE source_id=$1", [Service.SOURCE])).rows[0];
      assert.deepEqual(restored, before, "Extreme deadline fixture rolls back its actual source checkpoint");
    });

    await test("genuine client temporary-schema ensure cannot cache rolled-back DDL", async () => {
      for (let index = 0; index < 2; index++) {
        await tx.query("BEGIN"); await tx.query("SET LOCAL search_path=pg_temp"); await Service.ensure(tx);
        assert((await tx.query("SELECT to_regclass('pg_temp.'||$1) AS name", [Service.TABLE])).rows[0].name);
        assert((await tx.query("SELECT to_regclass('pg_temp.'||$1) AS name", [Service.CAPTURE_TABLE])).rows[0].name);
        await tx.query("ROLLBACK");
      }
    });
    tx.release(); tx = null;
    await articlesPool.end(); articlesPool = null;
    await pool.query("DROP SCHEMA " + schemaName + " CASCADE"); schemaCreated = false;
    for (const table of immutableTables)
      assert.deepEqual(await snapshot(table), before[table], "Category identities preserve public " + table);
    groups++;
  } finally {
    if (tx) { try { await tx.query("ROLLBACK"); } catch {} tx.release(); }
    if (articlesPool) await articlesPool.end();
    if (schemaCreated) await pool.query("DROP SCHEMA " + schemaName + " CASCADE");
    await pool.end();
  }
  console.log(`aldi-category-article-postgres: PostgreSQL 18; ${groups} actual SQL groups passed`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
