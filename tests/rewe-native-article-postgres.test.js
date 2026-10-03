"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Client = require("../rewe-retailer-price-client");
const Service = require("../rewe-retailer-article-service");
const Price = require("../rewe-retailer-price-service");
const fixture = require("./fixtures/retailers/rewe-berlin-pickup.json");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const clone = value => structuredClone(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const metadataHash = value => sha(JSON.stringify(canonical(value)));
const CATEGORY = Object.freeze({ id: "921", slug: "getraenke-genussmittel", name: "Getränke & Genussmittel", nativeCount: 1 });
const sku = index => "8-PGART" + index + "-" + Client.NATIVE_STORE_ID;

// These are NEW, explicitly synthetic SQL originals. The archive supplies only
// the observed native listing shape; no old response is retimed or imported.
// Every test body has its own test SKU, title, hash, Date/Age and capture clock.
function capture(index, at, patch = {}, options = {}) {
  const item = { ...clone(fixture.items[0]), syntheticSQLOriginal: true,
    articleId: "PGART" + index, listingId: sku(index), productId: String(98000000 + index),
    title: "POSTGRES TEST native REWE article " + index,
    detailsUrl: "/p/postgres-test-native-article/" + (98000000 + index),
    pricing: { grammage: "0,25l", currentRetailPrice: null, totalRefundPrice: null },
    ...patch };
  const category = options.category || { ...CATEGORY };
  const pageNumber = options.pageNumber || 1;
  const hits = options.hits || [item];
  const raw = { syntheticSQLOriginal: true, hits,
    pagination: { currentPage: pageNumber, objectsPerPage: 40, pageCount: Math.ceil(hits.length / 40), objectCount: hits.length },
    search: { marketCode: Client.MARKET_ID, serviceTypes: ["PICKUP"], activeCategorySlug: category.slug } };
  const body = "\n" + JSON.stringify(raw, null, 2) + "\n";
  const iso = new Date(at).toISOString(), responseDate = new Date(at).toUTCString();
  const url = new URL(Client.PRODUCTS_URL);
  for (const [key, value] of Object.entries({ categorySlug: category.slug, marketId: Client.MARKET_ID,
    serviceTypes: "PICKUP", page: String(pageNumber), objectsPerPage: "40" })) url.searchParams.set(key, value);
  return { body, meta: { status: 200, sourceResponseUrl: url.href,
    sourceResponseHash: sha(body), capturedAt: iso, sourceResponseDate: new Date(responseDate).toISOString(),
    sourceAgeSeconds: 0, responseDate, responseAge: "0", contentType: Client.PRODUCTS_ACCEPT, bytes: Buffer.byteLength(body) },
  category, pageNumber };
}

function parse(original, now) { return Client.reparseOriginalPage(original, { now }); }
function assertDated(item, original) {
  assert.equal(item.sourceId, Service.SOURCE); assert.equal(item.merchant, "REWE");
  assert.equal(item.scopeCountry, "DE"); assert.equal(item.scopeChannel, "pickup");
  assert.equal(item.nativeMarketId, Client.MARKET_ID); assert.equal(item.nativeStoreId, Client.NATIVE_STORE_ID);
  assert.equal(item.observedAt, original.meta.capturedAt); assert.equal(item.sourceResponseHash, original.meta.sourceResponseHash);
  assert.equal(item.availability, "unknown"); assert.equal(item.truthEligible, false);
  assert.equal(item.currentPriceVerified, false); assert.equal(item.physicalStorePriceVerified, false);
  assert.equal(item.assortmentComplete, false); assert.equal(item.expiresAt, null);
  for (const key of ["price", "deposit", "displayedPrice", "payablePackPrice", "nativeWitness", "originalMetadata", "originalBody"])
    assert.equal(item[key], undefined, "A dated public identity must not expose " + key);
}

async function offlineCheck() {
  const now = Date.parse("2026-10-03T10:00:00.000Z"), original = capture(0, now - 1000);
  const before = clone(original), parsed = parse(original, now);
  assert.equal(parsed.products.length, 1); assert.equal(parsed.offers.length, 0);
  assert.equal(parsed.received, 1); assert.deepEqual(original, before, "Original validation is read-only");
  assert.equal(parsed.products[0].retailerSku, sku(0));
  assert.equal(parsed.products[0].sourceId, Service.SOURCE);
  assert.equal(parsed.products[0].gtin, fixture.items[0].gtin);
  assert.equal(parsed.products[0].observedAt, original.meta.capturedAt);
  const multi = capture(1, now - 1000, { baseQuantity: .5, multi1: 2,
    pricing: { grammage: "2x0,5l", currentRetailPrice: null } });
  assert.equal(parse(multi, now).products[0].packCount, 2);
  for (const patch of [{ gtin: "90486648" }, { volumeCode: "KGG" }, { hasVariants: true },
    { hasVariants: "true" }, { hasDiverseVariantPrices: 1 },
    { options: [] }, { pricing: { grammage: "ca. 250 ml" } }, { serviceType: "DELIVERY" },
    { nativeStoreId: "another-store" }, { marketId: "1" }]) {
    assert.equal(parse(capture(2, now - 1000, patch), now).products.length, 0, JSON.stringify(patch));
  }
  for (const mutate of [value => value.body += " ", value => value.meta.sourceResponseHash = "0".repeat(64),
    value => value.meta.sourceAgeSeconds = 901, value => value.meta.responseAge = "901",
    value => value.meta.sourceResponseDate = new Date(now - 16 * 60000).toISOString(),
    value => value.meta.capturedAt = new Date(now + 1).toISOString(),
    value => value.category.slug = "obst-gemuese", value => value.pageNumber = 2]) {
    const altered = clone(original); mutate(altered);
    assert.throws(() => parse(altered, now), undefined, "Unbound original or metadata must be rejected");
  }
  const stored = { ...Service.rowForArticle(parsed.products[0], original), held: false, conflict_capture: null };
  const metadata = { meta: original.meta, category: original.category, pageNumber: original.pageNumber };
  const reader = { query: async sql => ({ rows: sql.includes(Service.PROOF_TABLE)
    ? [{ capture_proof_hash: metadataHash(metadata), source_response_hash: original.meta.sourceResponseHash, original_metadata: metadata, admissible: true }]
    : [{ source_response_hash: original.meta.sourceResponseHash, body: original.body, body_bytes: Buffer.byteLength(original.body) }] }) };
  const items = await Service.readRows(reader, [stored], { now }); assert.equal(items.length, 1); assertDated(items[0], original);
  assert.equal(Service.validateView(items[0], { now }).ok, true);
  for (const patch of [{ price: 1 }, { gtin: "90486648" }, { nativeMarketId: "999" },
    { packCount: 2 }, { truthEligible: true }, { physicalStorePriceVerified: true },
    { expiresAt: new Date(now + 1000).toISOString() }, { availability: "available" }, { extra: "unsafe" }])
    assert.equal(Service.validateView({ ...items[0], ...patch }, { now }).ok, false, JSON.stringify(patch));
  const forged = clone(parsed.products[0]); forged.name = forged.nativeWitness.title = "POSTGRES TEST forged original label";
  assert.equal((await Service.readRows(reader, [{ ...Service.rowForArticle(forged, original), held: false, conflict_capture: null }], { now })).length, 0,
    "Self-consistent forged witness/hash still requires the exact retained original");
  assert.equal((await Service.readRows(reader, [{ ...stored, held: true }], { now })).length, 0);
  assert.equal((await Service.readRows(reader, [{ ...stored, observed_at: new Date(now + 1).toISOString() }], { now })).length, 0);
  assert.equal((await Service.readRows(reader, [stored], { now: now + 30 * 86400000 }))[0].observedAt, original.meta.capturedAt);
  const filters = { syntheticSQLOriginal: true, productCount: 1, items: [{ type: "category", key: "CATEGORY",
    options: [{ id: CATEGORY.id, value: CATEGORY.slug, label: CATEGORY.name, applied: false, productCount: 1,
      queryParams: [{ name: "categorySlug", value: CATEGORY.slug }] }] }] };
  let responses = 0;
  const collected = await Client.fetchOffers({ maxRequests: 2, pauseMs: 0, now: () => original.meta.capturedAt }, async url => {
    const isFilters = new URL(url).pathname === "/shop/api/filters", body = isFilters ? JSON.stringify(filters) : original.body;
    responses++;
    return { status: 200, url, headers: new Headers({ "content-type": isFilters ? Client.FILTERS_ACCEPT : Client.PRODUCTS_ACCEPT,
      date: original.meta.responseDate, age: "0" }), text: async () => body };
  });
  const Refresh = require("../rewe-retailer-price-refresh"), batch = Refresh.nativeBatch(collected, {}, 2, now);
  assert.equal(responses, 2); assert.equal(batch.received, 1); assert.equal(batch.products.length, 1); assert.equal(batch.offers.length, 0);
  assert.equal(collected.complete, true); assert.equal(collected.physicalStoreAssortmentVerified, false);
  const forgedResult = clone(collected); forgedResult.products[0].name = "FORGED result outside original";
  assert.throws(() => Refresh.nativeBatch(forgedResult, {}, 2, now), /rewe-native-original-result-conflict/);
  const missingOriginal = clone(collected); delete missingOriginal.originalPages;
  assert.throws(() => Refresh.nativeBatch(missingOriginal, {}, 2, now), /rewe-native-original-batch-required/);
  console.log("rewe-native-article-postgres offline: native price-less originals, closed proofs, public identities and actual native batch rederivation passed");
}

async function main() {
  if (process.argv.includes("--offline")) return offlineCheck();
  const { Pool } = require("pg"), connectionString = process.env.DATABASE_URL;
  assert(connectionString, "DATABASE_URL is required");
  const database = new URL(connectionString);
  assert(["localhost", "127.0.0.1"].includes(database.hostname) && !database.search && !database.hash
    && /^\/[a-z][a-z0-9_]*_test$/.test(database.pathname), "Only a dedicated named loopback *_test database is allowed");
  const admin = new Pool({ connectionString, ssl: false, connectionTimeoutMillis: 5000 });
  const schema = "rewe_native_article_test_" + crypto.randomBytes(8).toString("hex");
  const now = Math.floor(Date.now() / 1000) * 1000, base = now - 120000;
  let pool, tx, created = false, groups = 0;
  const test = async (name, fn) => { await fn(); groups++; };
  const publicTables = ["products", "stores", "merchants", "external_product_mappings", "external_store_mappings",
    "price_observations", "receipt_submissions", "receipts", Price.TABLE, "rewe_retailer_catalog_state",
    "retailer_published_prices", "wolt_retailer_published_prices", Service.PROOF_TABLE];
  async function snapshot(client, table, namespace = schema) {
    const exists = (await client.query("SELECT to_regclass($1) AS name", [namespace + "." + table])).rows[0].name;
    if (!exists) return null;
    return (await client.query(`SELECT count(*)::int AS total,
      md5(COALESCE(string_agg(row_to_json(t)::text, chr(10) ORDER BY row_to_json(t)::text), '')) AS hash
      FROM ${namespace}.${table} t`)).rows[0];
  }
  try {
    assert.equal(Math.floor(Number((await admin.query("SHOW server_version_num")).rows[0].server_version_num) / 10000),
      18, "This program verifies actual PostgreSQL 18, never an older server");
    const beforePublic = {};
    for (const table of publicTables) beforePublic[table] = await snapshot(admin, table, "public");
    await admin.query("CREATE SCHEMA " + schema); created = true;
    pool = new Pool({ connectionString, ssl: false, connectionTimeoutMillis: 5000, max: 2,
      options: "-c search_path=" + schema });
    await Service.ensure(pool); await Price.ensure(pool);
    await test("isolated schema and private original foreign key", async () => {
      assert.equal((await pool.query("SELECT current_schema() AS name")).rows[0].name, schema);
      const columns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",
        [schema, Service.TABLE])).rows.map(row => row.column_name);
      assert(!columns.includes("price") && !columns.includes("expires_at") && !columns.includes("store_id"));
      const fk = await pool.query("SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conrelid=$1::regclass AND contype='f'",
        [schema + "." + Service.TABLE]);
      assert(fk.rows.some(row => row.target.endsWith(Service.CAPTURE_TABLE)), "Stored article references its genuine original body");
    });
    const row = (index, client = tx) => client.query(`SELECT * FROM ${Service.TABLE} WHERE source_id=$1 AND retailer_sku=$2`,
      [Service.SOURCE, sku(index)]).then(result => result.rows[0]);
    const search = async (index, options = {}, client = tx) => {
      const rows = (await client.query(`SELECT * FROM ${Service.TABLE} WHERE source_id=$1 AND retailer_sku=$2`,
        [Service.SOURCE, sku(index)])).rows;
      return { items: await Service.readRows(client, rows, { now: options.now ?? now }) };
    };
    const save = (originals, clock = now) => Service.persist(tx, originals, { now: clock });
    tx = await pool.connect();
    await test("genuine assigned writing transaction required", async () => {
      assert.equal(typeof tx.connect, "function"); assert.equal(Object.hasOwn(tx, "connect"), false);
      await assert.rejects(() => Service.persist(pool, [capture(0, base)], { now }), /transaction-client-required/);
      await assert.rejects(() => save([capture(0, base)]), /open-writing-transaction-required/);
      await tx.query("BEGIN");
      await assert.rejects(() => save([]), /open-writing-transaction-required/);
      await tx.query("SELECT txid_current()");
    });
    await test("schemaEnsured price option cannot bypass the genuine writing transaction", async () => {
      await assert.rejects(() => Price.persist(pool, [], { now, schemaEnsured: true }), /writing-transaction-required/);
      const idle = await pool.connect();
      try { await assert.rejects(() => Price.persist(idle, [], { now, schemaEnsured: true }), /writing-transaction-required/); }
      finally { idle.release(); }
    });
    const first = capture(0, base), noGtin = capture(1, base, { gtin: null });
    await test("price-less originals create dated native identities only", async () => {
      const saved = await save([first, noGtin]);
      assert.equal(saved.accepted, 2); assert.equal(saved.upserted, 2); assert.equal(saved.rejected, 0);
      assertDated((await search(0)).items[0], first);
      assert.equal((await search(0)).items[0].gtin, fixture.items[0].gtin);
      assert.equal((await search(1)).items[0].gtin, null);
      const body = (await tx.query(`SELECT * FROM ${Service.CAPTURE_TABLE} WHERE source_response_hash=$1`,
        [first.meta.sourceResponseHash])).rows[0];
      assert.equal(body.body, first.body); assert.equal(Number(body.body_bytes), Buffer.byteLength(first.body));
      assert.equal((await tx.query(`SELECT count(*)::int AS total FROM ${Price.TABLE}`)).rows[0].total, 0);
    });
    await test("rollback restores private body and article ledgers", async () => {
      await tx.query("ROLLBACK");
      assert.equal((await search(0, {}, pool)).items.length, 0);
      assert.equal((await snapshot(pool, Service.TABLE)).total, 0);
      assert.equal((await snapshot(pool, Service.CAPTURE_TABLE)).total, 0);
      assert.equal((await snapshot(pool, Service.PROOF_TABLE)).total, 0);
      await tx.query("BEGIN"); await tx.query("SELECT txid_current()");
      await save([first, noGtin]);
    });
    await test("exact multipack is not collapsed by equal total quantity", async () => {
      const original = capture(2, base, { baseQuantity: .5, multi1: 2,
        pricing: { grammage: "2x0,5l", currentRetailPrice: null } });
      assert.equal((await save([original])).accepted, 1);
      const item = (await search(2)).items[0]; assert(item); assert.equal(item.packCount, 2);
      assert.equal(item.packAmount, 500); assert.equal(item.packUnit, "ml");
      assert.equal(Client.salesPack(item.pack).parsed.total.amount, 1000);
      assert.equal(Client.salesPack(item.pack).parsed.count, 2, "One litre total remains a native two-pack");
      assert.equal((await Service.search(tx, { search: "article%_", now })).items.length, 0);
      await assert.rejects(() => Service.search(tx, { merchant: "EDEKA", now }), /invalid-native-article-scope/);
      await assert.rejects(() => Service.search(tx, { scopeChannel: "online", now }), /invalid-native-article-scope/);
      await assert.rejects(() => Service.search(tx, { gtin: "3017620422003", now }), /invalid-native-article-query/);
    });
    await test("idempotent retry and latest original prevent old identity fallback", async () => {
      const before = await row(0), replay = await save([first, first]);
      assert.equal(replay.upserted, 0); assert.deepEqual(await row(0), before);
      const newer = capture(0, base + 1000, { title: "POSTGRES TEST newer native REWE title" });
      assert.equal((await save([newer])).upserted, 1); const latest = await row(0);
      assert.equal((await save([first])).upserted, 0); assert.deepEqual(await row(0), latest);
      assert.equal((await search(0)).items[0].name, "POSTGRES TEST newer native REWE title");
      assert.equal((await Service.search(tx, { search: "article 0", now })).items.length, 0);
    });
    await test("retimed same body does not refresh its original observation", async () => {
      const original = capture(3, base), retimed = clone(original);
      await save([original]); const before = await row(3);
      retimed.meta.capturedAt = new Date(base + 2000).toISOString();
      const replay = await save([retimed]); assert.equal(replay.upserted, 0);
      assert.equal(replay.retimedReplays, 1);
      assert.deepEqual(await row(3), before); assert.equal((await search(3)).items[0].observedAt, original.meta.capturedAt);
      const metadata = { meta: retimed.meta, category: retimed.category, pageNumber: retimed.pageNumber };
      const proof = (await tx.query(`SELECT * FROM ${Service.PROOF_TABLE} WHERE capture_proof_hash=$1`, [metadataHash(metadata)])).rows[0];
      assert(proof); assert.equal(proof.admissible, false, "A rejected replay is retained privately without identity authority");
      const forged = Service.rowForArticle(parse(retimed, now).products[0], retimed), columns = Object.keys(forged);
      await tx.query("SAVEPOINT rejected_replay_proof_forgery");
      await tx.query(`UPDATE ${Service.TABLE} SET ${columns.map((column, i) => column + "=$" + (i + 1)).join(",")}
        WHERE source_id=$${columns.length + 1} AND retailer_sku=$${columns.length + 2}`,
      [...columns.map(column => forged[column]), Service.SOURCE, sku(3)]);
      assert.equal((await search(3)).items.length, 0, "A known denied capture proof remains denied even after all article hashes are recomputed");
      await tx.query("ROLLBACK TO SAVEPOINT rejected_replay_proof_forgery");
      assert.deepEqual(await row(3), before);
    });
    await test("historical A then newer B prevents retimed A from replacing the latest native identity", async () => {
      const tables = [Service.TABLE, Service.CAPTURE_TABLE, Service.PROOF_TABLE], before = {};
      for (const table of tables) before[table] = await snapshot(tx, table);
      await tx.query("SAVEPOINT historical_native_original_replay");
      const originalA = capture(15, base, { title: "POSTGRES TEST historical native original A" });
      const originalB = capture(15, base + 1000, { title: "POSTGRES TEST genuinely newer native original B",
        syntheticNativeOriginalVersion: "B" });
      assert.notEqual(originalA.meta.sourceResponseHash, originalB.meta.sourceResponseHash);
      assert.equal((await save([originalA])).accepted, 1);
      assert.equal((await save([originalB])).accepted, 1);
      const latestB = await row(15), replayA = clone(originalA);
      replayA.meta.capturedAt = new Date(base + 2000).toISOString();
      assert.equal(replayA.meta.sourceResponseDate, originalA.meta.sourceResponseDate);
      assert.equal(replayA.meta.sourceAgeSeconds, originalA.meta.sourceAgeSeconds);
      assert.equal(replayA.meta.sourceResponseUrl, originalA.meta.sourceResponseUrl);
      const result = await save([replayA]);
      assert.equal(result.accepted, 0); assert.equal(result.upserted, 0);
      assert.equal(result.retimedReplays, 1); assert.equal(result.retimedCaptures, 1);
      assert.deepEqual(await row(15), latestB, "Historical replay cannot replace any column of the genuinely newer original B");
      assert.equal((await search(15)).items[0].name, "POSTGRES TEST genuinely newer native original B");
      const metadata = { meta: replayA.meta, category: replayA.category, pageNumber: replayA.pageNumber };
      const proof = (await tx.query(`SELECT * FROM ${Service.PROOF_TABLE} WHERE capture_proof_hash=$1`, [metadataHash(metadata)])).rows[0];
      assert(proof); assert.equal(proof.admissible, false);
      assert.equal(proof.source_response_hash, originalA.meta.sourceResponseHash);
      assert.deepEqual(proof.original_metadata, metadata);
      const forged = Service.rowForArticle(parse(replayA, now).products[0], replayA), columns = Object.keys(forged);
      await tx.query("SAVEPOINT historical_replay_article_forgery");
      await tx.query(`UPDATE ${Service.TABLE} SET ${columns.map((column, i) => column + "=$" + (i + 1)).join(",")}
        WHERE source_id=$${columns.length + 1} AND retailer_sku=$${columns.length + 2}`,
      [...columns.map(column => forged[column]), Service.SOURCE, sku(15)]);
      assert.equal((await search(15)).items.length, 0,
        "Original A's denied historical replay proof stays excluded even when every stored article hash is recomputed");
      await tx.query("ROLLBACK TO SAVEPOINT historical_replay_article_forgery");
      assert.deepEqual(await row(15), latestB);
      const articlesBeforeEmpty = await snapshot(tx, Service.TABLE), emptyA = capture(16, base + 3000, {}, { hits: [] });
      const firstEmpty = await save([emptyA]); assert.equal(firstEmpty.received, 0); assert.equal(firstEmpty.retimedCaptures, 0);
      const emptyReplay = clone(emptyA); emptyReplay.meta.capturedAt = new Date(base + 4000).toISOString();
      const replayEmpty = await save([emptyReplay]); assert.equal(replayEmpty.accepted, 0);
      assert.equal(replayEmpty.retimedReplays, 0, "An empty page has no retailer SKU replay count");
      assert.equal(replayEmpty.retimedCaptures, 1, "Its historical original capture is still a denied replay");
      const emptyMetadata = { meta: emptyReplay.meta, category: emptyReplay.category, pageNumber: emptyReplay.pageNumber };
      const emptyProof = (await tx.query(`SELECT admissible FROM ${Service.PROOF_TABLE} WHERE capture_proof_hash=$1`,
        [metadataHash(emptyMetadata)])).rows[0];
      assert(emptyProof); assert.equal(emptyProof.admissible, false);
      assert.deepEqual(await snapshot(tx, Service.TABLE), articlesBeforeEmpty, "Empty replay cannot invent or update an article");
      await tx.query("ROLLBACK TO SAVEPOINT historical_native_original_replay");
      for (const table of tables) assert.deepEqual(await snapshot(tx, table), before[table], "Historical replay fixture restores " + table);
    });
    await test("equal-clock identity conflict holds latest and newer genuine original recovers", async () => {
      const first = capture(4, base + 1000), contrary = capture(4, base + 1000, { title: "POSTGRES TEST contrary native identity" });
      await save([first]); await save([contrary]);
      assert.equal((await row(4)).held, true); assert.equal((await search(4)).items.length, 0);
      const held = await row(4); await save([capture(4, base), first]); assert.deepEqual(await row(4), held);
      const newer = capture(4, base + 3000, { title: "POSTGRES TEST recovered native identity" });
      await save([newer]); assert.equal((await row(4)).held, false); assert.equal((await row(4)).conflict_capture, null);
      assertDated((await search(4)).items[0], newer);
    });
    await test("native GTIN does not merge two retailer SKUs", async () => {
      await save([capture(5, base)]);
      const items = (await Service.search(tx, { now, limit: 200 })).items.filter(item => item.gtin === fixture.items[0].gtin);
      assert(items.some(item => item.retailerSku === sku(0))); assert(items.some(item => item.retailerSku === sku(5)));
      assert.equal((await tx.query(`SELECT count(*)::int AS total FROM ${Service.TABLE} WHERE retailer_sku=ANY($1::text[])`,
        [[sku(0), sku(5)]])).rows[0].total, 2);
    });
    await test("dated article survives source freshness without pretending a new price", async () => {
      const item = (await search(5, { now: now + 30 * 86400000 })).items[0];
      assert(item); assert.equal(item.observedAt, new Date(base).toISOString());
      assert.equal(item.currentPriceVerified, false);
      assert.equal(item.price, undefined); assert.equal(item.expiresAt, null);
    });
    await test("original foreign key cannot be deleted under an article", async () => {
      await tx.query("SAVEPOINT native_original_fk");
      await assert.rejects(() => tx.query(`DELETE FROM ${Service.CAPTURE_TABLE} WHERE source_response_hash=$1`,
        [noGtin.meta.sourceResponseHash]), error => error.code === "23503");
      await tx.query("ROLLBACK TO SAVEPOINT native_original_fk");
    });
    await test("actual SQL retains native country channel and held conflict bounds", async () => {
      for (const change of ["source_id='REWE another market'", "source_response_hash='BAD'",
        "article=jsonb_set(article,'{scopeCountry}','\"AT\"'::jsonb)",
        "article=jsonb_set(article,'{scopeChannel}','\"physical-store\"'::jsonb)",
        "article=jsonb_set(article,'{nativeMarketId}','\"999\"'::jsonb)",
        "article=jsonb_set(article,'{nativeStoreId}','\"another-store\"'::jsonb)",
        "held=true,conflict_capture=NULL"]) {
        await tx.query("SAVEPOINT invalid_native_article_sql");
        await assert.rejects(() => tx.query(`UPDATE ${Service.TABLE} SET ${change} WHERE source_id=$1 AND retailer_sku=$2`,
          [Service.SOURCE, sku(5)]), error => error.code === "23514", change);
        await tx.query("ROLLBACK TO SAVEPOINT invalid_native_article_sql");
      }
    });
    await test("tampered retained body is excluded by original revalidation", async () => {
      const original = capture(6, base); await save([original]); const before = await Service.status(tx, { now });
      await tx.query("SAVEPOINT tampered_native_original");
      const altered = original.body.replace("POSTGRES", "TAMPERED"); assert.equal(Buffer.byteLength(altered), Buffer.byteLength(original.body));
      await tx.query(`UPDATE ${Service.CAPTURE_TABLE} SET body=$2 WHERE source_response_hash=$1`, [original.meta.sourceResponseHash, altered]);
      assert.equal((await search(6)).items.length, 0);
      const after = await Service.status(tx, { now });
      assert.equal(after.storedArticles, before.storedArticles); assert.equal(after.excludedInvalidArticles, before.excludedInvalidArticles + 1);
      assert.equal(after.lastObservedArticles, before.lastObservedArticles - 1);
      await tx.query("ROLLBACK TO SAVEPOINT tampered_native_original");
      assert.equal((await search(6)).items.length, 1);
    });
    await test("tampered stored metadata and native DTO cannot gain authority", async () => {
      const original = await row(6);
      for (const [column, modify] of [
        ["original_metadata", value => value.meta.sourceAgeSeconds = 901],
        ["original_metadata", value => value.category.slug = "obst-gemuese"],
        ["article", value => value.name = "FORGED native title"],
        ["article", value => value.gtin = "3017620422003"],
        ["article", value => value.packCount = 99],
        ["article", value => value.truthEligible = true]
      ]) {
        await tx.query("SAVEPOINT tampered_native_metadata");
        const value = clone(original[column]); modify(value);
        await tx.query(`UPDATE ${Service.TABLE} SET ${column}=$3::jsonb WHERE source_id=$1 AND retailer_sku=$2`,
          [Service.SOURCE, sku(6), JSON.stringify(value)]);
        assert.equal((await search(6)).items.length, 0, column + " " + JSON.stringify(value));
        await tx.query("ROLLBACK TO SAVEPOINT tampered_native_metadata");
      }
    });
    await test("matching forged stored hashes cannot replace genuine original identity", async () => {
      const original = capture(6, base), stored = await row(6), forged = clone(stored.article);
      forged.name = "POSTGRES TEST internally consistent forgery";
      forged.nativeWitness.title = forged.name;
      const serialized = Service.rowForArticle(forged, original), columns = Object.keys(serialized);
      await tx.query("SAVEPOINT consistent_native_forgery");
      await tx.query(`UPDATE ${Service.TABLE} SET ${columns.map((column, i) => column + "=$" + (i + 1)).join(",")}
        WHERE source_id=$${columns.length + 1} AND retailer_sku=$${columns.length + 2}`,
      [...columns.map(column => serialized[column]), Service.SOURCE, sku(6)]);
      assert.equal((await search(6)).items.length, 0, "Semantic original reparse rejects even a recomputed witness/capture hash");
      await tx.query("ROLLBACK TO SAVEPOINT consistent_native_forgery");
      assert.equal((await search(6)).items.length, 1);
    });
    await test("retimed metadata with recomputed article hashes still requires a retained capture proof", async () => {
      const original = capture(6, base), forged = clone(original);
      forged.meta.capturedAt = new Date(base + 1000).toISOString();
      forged.meta.responseDate = new Date(base + 1000).toUTCString();
      forged.meta.sourceResponseDate = new Date(forged.meta.responseDate).toISOString();
      const metadata = { meta: forged.meta, category: forged.category, pageNumber: forged.pageNumber };
      assert.equal((await tx.query(`SELECT count(*)::int AS total FROM ${Service.PROOF_TABLE} WHERE capture_proof_hash=$1`,
        [metadataHash(metadata)])).rows[0].total, 0);
      const derived = parse(forged, now).products[0], serialized = Service.rowForArticle(derived, forged), columns = Object.keys(serialized);
      await tx.query("SAVEPOINT retimed_native_proof_forgery");
      await tx.query(`UPDATE ${Service.TABLE} SET ${columns.map((column, i) => column + "=$" + (i + 1)).join(",")}
        WHERE source_id=$${columns.length + 1} AND retailer_sku=$${columns.length + 2}`,
      [...columns.map(column => serialized[column]), Service.SOURCE, sku(6)]);
      assert.equal((await search(6)).items.length, 0, "Recomputed metadata/capture hashes are not an original capture record");
      await tx.query("ROLLBACK TO SAVEPOINT retimed_native_proof_forgery");
      assert.equal((await search(6)).items.length, 1);
    });
    await test("invalid original proofs and ambiguous native items create no identities", async () => {
      const before = await snapshot(tx, Service.TABLE), bodies = await snapshot(tx, Service.CAPTURE_TABLE);
      const malformed = clone(capture(7, base)); malformed.meta.sourceResponseHash = "0".repeat(64);
      const stale = capture(8, now - 6 * 60000), future = capture(9, now + 1000);
      for (const original of [malformed, stale, future]) await assert.rejects(() => save([original]), /original-/);
      assert.deepEqual(await snapshot(tx, Service.TABLE), before); assert.deepEqual(await snapshot(tx, Service.CAPTURE_TABLE), bodies);
      for (const patch of [{ gtin: "90486648" }, { sellByWeight: true }, { hasVariants: true },
        { serviceType: "DELIVERY" }, { pricing: { grammage: "ca. 250 ml" } }]) {
        assert.equal((await save([capture(10, base, patch)])).accepted, 0);
        assert.equal((await search(10)).items.length, 0);
      }
    });
    await test("priced native listing has a separate quote but article storage has none", async () => {
      const original = capture(11, base, { pricing: { grammage: "0,25l", currentRetailPrice: 149, totalRefundPrice: 25 } });
      const parsed = parse(original, now); assert.equal(parsed.offers.length, 1); assert.equal(parsed.products.length, 1);
      await save([original]); assertDated((await search(11)).items[0], original);
      assert.equal((await tx.query(`SELECT count(*)::int AS total FROM ${Price.TABLE}`)).rows[0].total, 0);
      assert.equal(parsed.offers[0].price, 1.49); assert.equal(parsed.offers[0].deposit, .25);
    });
    await test("all-rejected and empty genuine pages retain original metadata without inventing identities", async () => {
      const beforeArticles = await snapshot(tx, Service.TABLE), beforeBodies = await snapshot(tx, Service.CAPTURE_TABLE),
        beforeProofs = await snapshot(tx, Service.PROOF_TABLE);
      const rejected = capture(12, base, { gtin: "90486648" }), empty = capture(13, base, {}, { hits: [] });
      const result = await save([rejected, empty]); assert.equal(result.received, 1); assert.equal(result.accepted, 0);
      assert.equal(result.rejected, 1); assert.equal(result.upserted, 0);
      assert.deepEqual(await snapshot(tx, Service.TABLE), beforeArticles);
      assert.equal((await snapshot(tx, Service.CAPTURE_TABLE)).total, beforeBodies.total + 2);
      assert.equal((await snapshot(tx, Service.PROOF_TABLE)).total, beforeProofs.total + 2);
      for (const original of [rejected, empty]) {
        const metadata = { meta: original.meta, category: original.category, pageNumber: original.pageNumber };
        const proof = (await tx.query(`SELECT * FROM ${Service.PROOF_TABLE} WHERE capture_proof_hash=$1`, [metadataHash(metadata)])).rows[0];
        assert(proof); assert.equal(proof.source_response_hash, original.meta.sourceResponseHash);
        assert.deepEqual(proof.original_metadata, metadata);
      }
      assert.equal((await search(12)).items.length, 0); assert.equal((await search(13)).items.length, 0);
    });
    await test("held native identity suppresses its unsafe existing quote while retaining both originals", async () => {
      const tables = [Service.TABLE, Service.CAPTURE_TABLE, Service.PROOF_TABLE, Price.TABLE], before = {};
      for (const table of tables) before[table] = await snapshot(tx, table);
      await tx.query("SAVEPOINT held_native_price_originals");
      const priced = capture(14, base, { pricing: { grammage: "0,25l", currentRetailPrice: 149, totalRefundPrice: 25 } });
      const contrary = capture(14, base, { title: "POSTGRES TEST contrary held native article 14",
        pricing: { grammage: "0,25l", currentRetailPrice: 149, totalRefundPrice: 25 } });
      await save([priced]); assert.equal((await Price.persist(tx, parse(priced, now).offers, { now, schemaEnsured: true })).accepted, 1);
      assert.equal((await tx.query(`SELECT count(*)::int AS total FROM ${Price.TABLE} WHERE retailer_sku=$1`, [sku(14)])).rows[0].total, 1);
      await save([contrary]); assert.equal((await row(14)).held, true);
      const suppressed = await Price.suppressHeldArticles(tx); assert.equal(suppressed.suppressed, 1);
      assert(suppressed.retailerSkus.includes(sku(14)));
      assert.equal((await search(14)).items.length, 0);
      assert.equal((await tx.query(`SELECT count(*)::int AS total FROM ${Price.TABLE} WHERE retailer_sku=$1`, [sku(14)])).rows[0].total, 0);
      for (const original of [priced, contrary]) {
        assert.equal((await tx.query(`SELECT count(*)::int AS total FROM ${Service.CAPTURE_TABLE} WHERE source_response_hash=$1`,
          [original.meta.sourceResponseHash])).rows[0].total, 1);
        const metadata = { meta: original.meta, category: original.category, pageNumber: original.pageNumber };
        assert.equal((await tx.query(`SELECT count(*)::int AS total FROM ${Service.PROOF_TABLE} WHERE capture_proof_hash=$1`,
          [metadataHash(metadata)])).rows[0].total, 1);
      }
      await tx.query("ROLLBACK TO SAVEPOINT held_native_price_originals");
      for (const table of tables) assert.deepEqual(await snapshot(tx, table), before[table], "Rollback restores held suppression fixture " + table);
    });
    await tx.query("COMMIT");
    await test("committed originals roundtrip through an independent pool connection", async () => {
      const item = (await search(11, {}, pool)).items[0]; assert(item); assertDated(item, capture(11, base,
        { pricing: { grammage: "0,25l", currentRetailPrice: 149, totalRefundPrice: 25 } }));
      const status = await Service.status(pool, { now }); assert.equal(status.lastObservedArticles, 8);
      assert.equal(status.truthEligible, false); assert.equal(status.currentPriceVerified, false);
      assert.equal(status.physicalStorePriceVerified, false); assert.equal(status.assortmentComplete, false);
    });
    tx.release(); tx = null;
    await test("rolled-back genuine-client schema ensure cannot cache missing original tables", async () => {
      const schemaClient = await pool.connect();
      try {
        for (let i = 0; i < 2; i++) {
          await schemaClient.query("BEGIN"); await schemaClient.query("SET LOCAL search_path=pg_temp");
          await Service.ensure(schemaClient);
          for (const table of [Service.TABLE, Service.CAPTURE_TABLE, Service.PROOF_TABLE])
            assert((await schemaClient.query("SELECT to_regclass('pg_temp.'||$1) AS name", [table])).rows[0].name,
              "A new ensure creates the actual missing temporary " + table);
          await schemaClient.query("ROLLBACK");
        }
      } finally { try { await schemaClient.query("ROLLBACK"); } catch {} schemaClient.release(); }
    });
    const Refresh = require("../rewe-retailer-price-refresh"), Store = require("../price-refresh-state-store");
    await Refresh.ensure(pool); await Store.ensure(pool);
    const owner = "POSTGRES TEST REWE native transaction owner";
    assert.equal(await Store.acquire(pool, Refresh.SOURCE, owner), true);
    const secondCategory = { id: "9999", slug: "postgres-test-native-next", name: "POSTGRES TEST next category", nativeCount: 1 };
    const filters = { syntheticSQLOriginal: true, productCount: 2, items: [{ type: "category", key: "CATEGORY",
      options: [CATEGORY, secondCategory].map(category => ({ id: category.id, value: category.slug, label: category.name,
        applied: false, productCount: 1, queryParams: [{ name: "categorySlug", value: category.slug }] })) }] };
    const filterBody = JSON.stringify(filters, null, 2);
    let runClock = now - 20000, sourceCalls = 0;
    async function batch(options, index, priced, patch = {}) {
      const syntheticFetch = async url => {
        const parsedUrl = new URL(url), isFilters = parsedUrl.pathname === "/shop/api/filters";
        const category = parsedUrl.searchParams.get("categorySlug") === CATEGORY.slug ? CATEGORY : secondCategory;
        const page = capture(index, runClock, { ...(priced ? { pricing: { grammage: "0,25l", currentRetailPrice: 199, totalRefundPrice: 25 } } : {}), ...patch },
          { category });
        const body = isFilters ? filterBody : page.body; sourceCalls++;
        return { status: 200, url, headers: new Headers({ "content-type": isFilters ? Client.FILTERS_ACCEPT : Client.PRODUCTS_ACCEPT,
          date: new Date(runClock).toUTCString(), age: "0", "content-length": String(Buffer.byteLength(body)) }), text: async () => body };
      };
      return Client.fetchOffers({ ...options, pauseMs: 0 }, syntheticFetch);
    }
    const refresh = (index, priced, extra = {}) => {
      const { itemPatch = {}, ...deps } = extra;
      return Refresh.refresh({ pool, maxRequests: 2, now: () => runClock, leaseOwner: owner },
        { fetchOffers: options => batch(options, index, priced, itemPatch), ...deps });
    };
    const nativeTables = [Service.TABLE, Service.CAPTURE_TABLE, Service.PROOF_TABLE, Price.TABLE, Refresh.TABLE];
    const nativeSnapshot = async () => {
      const result = {}; for (const table of nativeTables) result[table] = await snapshot(pool, table); return result;
    };
    await test("actual handler commits a price-less page together with private original and cursor", async () => {
      const microsecondTimestamp = new Date(runClock - 1000).toISOString().replace(".000Z", ".123456Z");
      await pool.query(`INSERT INTO ${Refresh.TABLE}(source_id,updated_at) VALUES($1,$2::timestamptz)`, [Refresh.SOURCE, microsecondTimestamp]);
      const prior = (await pool.query(`SELECT xmin::text AS version,mod(extract(microseconds FROM updated_at)::numeric,1000)::int AS remainder
        FROM ${Refresh.TABLE} WHERE source_id=$1`, [Refresh.SOURCE])).rows[0];
      assert.equal(prior.remainder, 456, "The existing native checkpoint really retains PostgreSQL microseconds");
      const before = await nativeSnapshot(), result = await refresh(20, false);
      assert.equal(result.accepted, 0); assert.equal(result.identityAccepted, 1); assert.equal(result.pagesThisBatch, 1);
      assert.equal(result.catalog.publishedAssortmentComplete, false);
      const state = await Refresh.load(pool); assert.equal(state.cursor.categoryIndex, 1); assert.equal(state.cursor.pageNumber, 1);
      assert.equal(state.pagesFetched, 1); assert.equal(state.receivedCumulative, 1);
      assert.equal((await search(20, {}, pool)).items.length, 1);
      const after = await nativeSnapshot(); assert.equal(after[Service.TABLE].total, before[Service.TABLE].total + 1);
      assert.equal(after[Service.CAPTURE_TABLE].total, before[Service.CAPTURE_TABLE].total + 1);
      assert.equal(after[Service.PROOF_TABLE].total, before[Service.PROOF_TABLE].total + 1);
      assert.deepEqual(after[Price.TABLE], before[Price.TABLE]);
      const version = (await pool.query(`SELECT xmin::text AS version FROM ${Refresh.TABLE} WHERE source_id=$1`, [Refresh.SOURCE])).rows[0].version;
      assert.notEqual(version, prior.version, "Real CAS advances an existing microsecond checkpoint through a committed transaction");
    });
    await test("failed price write rolls back actual article original and cursor", async () => {
      runClock += 1000; const before = await nativeSnapshot();
      await assert.rejects(() => refresh(21, true, { persist: async writer => {
        assert.notEqual(writer, pool); assert.equal(typeof writer.release, "function");
        const assigned = (await writer.query("SELECT txid_current_if_assigned() IS NOT NULL AS open")).rows[0].open;
        assert.equal(assigned, true); throw new Error("POSTGRES TEST price write failed after native article");
      } }), /price write failed/);
      assert.deepEqual(await nativeSnapshot(), before); assert.equal((await search(21, {}, pool)).items.length, 0);
    });
    await test("checkpoint SQL failure rolls back actual article original and price", async () => {
      await pool.query(`CREATE FUNCTION block_rewe_native_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'POSTGRES TEST actual REWE checkpoint failure'; END $$;
        CREATE TRIGGER block_rewe_native_checkpoint BEFORE INSERT OR UPDATE ON ${Refresh.TABLE}
        FOR EACH ROW EXECUTE FUNCTION block_rewe_native_checkpoint();`);
      runClock += 1000; const before = await nativeSnapshot();
      try { await assert.rejects(() => refresh(22, true), /actual REWE checkpoint failure/); }
      finally { await pool.query("DROP TRIGGER block_rewe_native_checkpoint ON " + Refresh.TABLE
        + "; DROP FUNCTION block_rewe_native_checkpoint()"); }
      assert.deepEqual(await nativeSnapshot(), before); assert.equal((await search(22, {}, pool)).items.length, 0);
      assert.equal((await Price.search(pool, { search: "article 22", now: runClock })).items.length, 0);
    });
    await test("final shutdown gate rolls back a fully written page and checkpoint", async () => {
      runClock += 1000; const before = await nativeSnapshot(); let stopping = false;
      const result = await refresh(23, true, { shouldContinue: async () => !stopping,
        persist: async (writer, offers, options) => { const result = await Price.persist(writer, offers, options); stopping = true; return result; } });
      assert.equal(result.skipped, "server-stopping"); assert.equal(result.accepted, 0);
      assert.deepEqual(await nativeSnapshot(), before); assert.equal((await search(23, {}, pool)).items.length, 0);
    });
    await test("final shared lease check rolls back page and mutated test lease together", async () => {
      runClock += 1000; const before = await nativeSnapshot(), leaseBefore = await snapshot(pool, "price_source_refresh_state");
      const result = await refresh(24, true, { persist: async (writer, offers, options) => {
        const result = await Price.persist(writer, offers, options);
        await writer.query("UPDATE price_source_refresh_state SET lease_owner=$2 WHERE source_name=$1",
          [Refresh.SOURCE, "POSTGRES TEST different lease owner"]); return result;
      } });
      assert.equal(result.skipped, "source-lease-not-owned"); assert.deepEqual(await nativeSnapshot(), before);
      assert.deepEqual(await snapshot(pool, "price_source_refresh_state"), leaseBefore);
      assert.equal((await search(24, {}, pool)).items.length, 0);
    });
    await test("concurrent checkpoint change after fetch cannot skip or write a native page", async () => {
      runClock += 1000; const before = await nativeSnapshot(); let competingState;
      const result = await refresh(25, true, { fetchOffers: async options => {
        const collected = await batch(options, 25, true);
        await pool.query(`UPDATE ${Refresh.TABLE} SET updated_at=updated_at+interval '1 millisecond' WHERE source_id=$1`, [Refresh.SOURCE]);
        competingState = await snapshot(pool, Refresh.TABLE); return collected;
      } });
      assert.equal(result.skipped, "checkpoint-changed");
      const after = await nativeSnapshot();
      for (const table of [Service.TABLE, Service.CAPTURE_TABLE, Service.PROOF_TABLE, Price.TABLE]) assert.deepEqual(after[table], before[table], table);
      assert.deepEqual(after[Refresh.TABLE], competingState, "The newer competing checkpoint is preserved exactly");
      assert.equal((await search(25, {}, pool)).items.length, 0);
    });
    await test("successful second page commits exact pickup price separately from identity", async () => {
      runClock += 1000; const result = await refresh(26, true);
      assert.equal(result.accepted, 1); assert.equal(result.identityAccepted, 1);
      assert.equal(result.catalog.publishedAssortmentComplete, true); assert.equal(result.catalog.physicalStoreAssortmentVerified, false);
      const state = await Refresh.load(pool); assert.equal(state.cursor, null); assert.equal(state.completedCycles, 1);
      assert.equal(state.pagesFetched, 2); assert.equal(state.receivedCumulative, 2);
      const item = (await search(26, { now: runClock }, pool)).items[0]; assert(item); assert.equal(item.price, undefined);
      const quote = (await Price.search(pool, { search: "article 26", now: runClock })).items[0]; assert(quote);
      assert.equal(quote.price, 1.99); assert.equal(quote.deposit, .25); assert.equal(quote.payablePackPrice, 2.24);
      assert.equal(quote.scopeChannel, "pickup"); assert.equal(quote.truthEligible, false);
      assert.equal((await Service.status(pool, { now: runClock })).lastObservedArticles, 10);
      assert.equal(sourceCalls, 14, "Seven bounded two-response synthetic runs perform zero retailer HTTP calls");
    });
    await test("new rejected native identity removes its old quote without refreshing the older article", async () => {
      runClock += 1000; const first = await refresh(27, true); assert.equal(first.identityAccepted, 1); assert.equal(first.accepted, 1);
      const articleBefore = await row(27, pool), originalClock = articleBefore.observed_at;
      assert.equal((await Price.search(pool, { search: "article 27", now: runClock })).items.length, 1);
      const before = await nativeSnapshot();
      runClock += 1000; const rejected = await refresh(27, true, { itemPatch: { hasVariants: "true" } });
      assert.equal(rejected.identityReceived, 1); assert.equal(rejected.received, 0);
      assert.equal(rejected.identityAccepted, 0); assert.equal(rejected.accepted, 0); assert.equal(rejected.identityRejectedPrices, 1);
      assert.equal(rejected.suppressedHeldPrices, 1);
      assert.equal(rejected.catalog.publishedAssortmentComplete, true); assert.equal(rejected.catalog.physicalStoreAssortmentVerified, false);
      const after = await nativeSnapshot();
      assert.equal(after[Service.TABLE].total, before[Service.TABLE].total);
      assert.equal(after[Service.CAPTURE_TABLE].total, before[Service.CAPTURE_TABLE].total + 1);
      assert.equal(after[Service.PROOF_TABLE].total, before[Service.PROOF_TABLE].total + 1);
      assert.deepEqual(await row(27, pool), articleBefore, "The old dated identity is neither recaptured nor changed to known stock");
      const item = (await search(27, { now: runClock }, pool)).items[0]; assert(item);
      assert.equal(item.observedAt, new Date(originalClock).toISOString()); assert.equal(item.availability, "unknown");
      assert.equal(item.currentPriceVerified, false); assert.equal(item.price, undefined);
      assert.equal((await Price.search(pool, { search: "article 27", now: runClock })).items.length, 0,
        "Neither the rejected new price nor the formerly valid older quote remains current");
      assert.equal((await Price.search(pool, { search: "article 26", now: runClock })).items.length, 1,
        "Another safely quoted native SKU remains available");
      const state = await Refresh.load(pool); assert.equal(state.completedCycles, 2); assert.equal(state.pagesFetched, 2);
      assert.equal((await Service.status(pool, { now: runClock })).lastObservedArticles, 11);
      assert.equal(sourceCalls, 18, "Nine two-response synthetic batches perform zero retailer HTTP calls");
    });
    await pool.end(); pool = null;
    await admin.query("DROP SCHEMA " + schema + " CASCADE"); created = false;
    await test("public canonical and price tables stay byte-for-byte unchanged", async () => {
      for (const table of publicTables) assert.deepEqual(await snapshot(admin, table, "public"), beforePublic[table], table);
    });
  } finally {
    if (tx) { try { await tx.query("ROLLBACK"); } catch {} tx.release(); }
    if (pool) await pool.end();
    if (created) await admin.query("DROP SCHEMA " + schema + " CASCADE");
    await admin.end();
  }
  console.log(`rewe-native-article-postgres: PostgreSQL 18; ${groups} actual SQL groups passed`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
