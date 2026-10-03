"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const Service = require("../wolt-retailer-article-service");
const Client = require("../wolt-retailer-price-client");
const Price = require("../wolt-retailer-price-service");
const Refresh = require("../wolt-retailer-price-refresh");
const fixture = require("./fixtures/retailers/wolt-edeka-berlin.json");

const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const clone = value => structuredClone(value);

async function main() {
  const connectionString = process.env.DATABASE_URL;
  assert(connectionString, "DATABASE_URL is required");
  const database = new URL(connectionString);
  assert(["localhost", "127.0.0.1"].includes(database.hostname) && !database.search && !database.hash
    && /^\/[a-z][a-z0-9_]*_test$/.test(database.pathname),
  "Only a dedicated named loopback *_test database is allowed");
  const pool = new Pool({ connectionString, ssl: false, connectionTimeoutMillis: 5000 });
  const now = Date.now(), base = now - 10000;
  let tx, groups = 0;
  const test = async (name, fn) => { await fn(); groups++; };
  const sku = index => (0xf9000000n + BigInt(index)).toString(16).padStart(24, "0");

  // Every modified response below is a NEW, explicitly synthetic SQL original.
  // We do not move an archived native capture to today or make retailer calls.
  function capture(index, at = base, patch = {}) {
    const originalVenue = { ...clone(fixture.venueState.queries[0].state.data), syntheticSQLOriginal: true };
    const iso = new Date(at).toISOString();
    const venueProof = { capturedAt: iso, sourceResponseUrl: Client.VENUE_API_URL,
      sourceResponseHash: sha(JSON.stringify(originalVenue)), sourceResponseDate: iso, sourceAgeSeconds: 0 };
    const shop = Client.parseNativeVenue(originalVenue, venueProof);
    const originalItem = { ...clone(fixture.pages[1].items[0]), id: sku(index),
      name: "POSTGRES TEST Wolt native article " + index, price: null, deposit: null,
      original_price: null, unit_price: null, unit_info: "1 l", description: "POSTGRES TEST fixed native article",
      syntheticSQLOriginal: true, ...patch };
    const proof = { shop, capturedAt: iso,
      sourceResponseUrl: Client.API_ORIGIN + Client.API_PATH + "/categories/slug/postgres-test-native-articles",
      sourceResponseHash: sha(JSON.stringify({ syntheticSQLOriginal: true, items: [originalItem] })),
      sourceResponseDate: iso, sourceAgeSeconds: 0, venueIdentityOriginal: originalVenue,
      venueIdentityProof: venueProof };
    return { parsed: Client.parseItems([originalItem], proof), originalItem, originalVenue, proof };
  }
  const product = (index, at = base, patch = {}) => {
    const value = capture(index, at, patch);
    assert.equal(value.parsed.products.length, 1, JSON.stringify(value.parsed));
    return value.parsed.products[0];
  };
  async function tableSnapshot(table, client = pool) {
    const exists = (await client.query("SELECT to_regclass($1) AS name", ["public." + table])).rows[0].name;
    if (!exists) return null;
    return (await client.query(`SELECT count(*)::int AS total,
      md5(COALESCE(string_agg(row_to_json(t)::text, chr(10) ORDER BY row_to_json(t)::text), '')) AS hash
      FROM ${table} t`)).rows[0];
  }
  try {
    const version = (await pool.query("SHOW server_version_num")).rows[0].server_version_num;
    assert.equal(Math.floor(Number(version) / 10000), 18, "This program verifies PostgreSQL 18, not an older server");
    const immutableTables = ["products", "stores", "merchants", "external_product_mappings", "external_store_mappings",
      "price_observations", "receipt_submissions", "receipts", Price.TABLE, "wolt_retailer_catalog_state"];
    const before = {};
    for (const table of immutableTables) before[table] = await tableSnapshot(table);
    await Service.ensure(pool);
    const articlesBefore = await tableSnapshot(Service.TABLE);
    const articleStatusBefore = await Service.status(pool, { now });
    const schema = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [Service.TABLE])).rows.map(row => row.column_name);
    assert(!schema.includes("price") && !schema.includes("expires_at") && !schema.includes("store_id"), "Article storage is not a price/physical-store ledger");
    groups++;

    await test("original native fixture metadata stays dated and multiline", async () => {
      const originalVenue = fixture.venueState.queries[0].state.data, at = fixture.capturedAt;
      const venueIdentityProof = { capturedAt: at, sourceResponseUrl: Client.VENUE_API_URL,
        sourceResponseHash: sha(JSON.stringify(originalVenue)), sourceResponseDate: at, sourceAgeSeconds: 0 };
      const shop = Client.parseNativeVenue(originalVenue, venueIdentityProof);
      const parsed = Client.parseItems([fixture.pages[1].items[0]], { shop, capturedAt: at,
        sourceResponseUrl: Client.API_ORIGIN + Client.API_PATH + "/categories/slug/" + fixture.pages[1].category.slug,
        sourceResponseHash: sha(JSON.stringify(fixture.pages[1])), sourceResponseDate: at, sourceAgeSeconds: 0,
        venueIdentityOriginal: originalVenue, venueIdentityProof });
      assert.equal(parsed.products.length, 1);
      assert.equal(parsed.products[0].observedAt, fixture.capturedAt);
      assert.equal(parsed.products[0].description, fixture.pages[1].items[0].description);
      const valid = Service.validateArticle(parsed.products[0], { now });
      assert.equal(valid.ok, true, JSON.stringify(valid.reasons));
      assert.equal(parsed.products[0].gtin, "5449000017888", "Use the original native barcode, never infer one from text");
    });

    tx = await pool.connect();
    await test("genuine writing transaction", async () => {
      assert.equal(typeof tx.connect, "function");
      assert.equal(Object.hasOwn(tx, "connect"), false, "Use genuine PoolClient, not a masking adapter");
      await assert.rejects(() => Service.persist(tx, [product(0)], { now }), /open-writing-transaction-required/);
      await assert.rejects(() => Service.persist(pool, [], { now }), /transaction-client-required/);
      await tx.query("BEGIN");
      await assert.rejects(() => Service.persist(tx, [], { now }), /open-writing-transaction-required/);
      await tx.query("SELECT txid_current()");
    });

    const first = product(0), noGtin = product(1, base, { barcode_gtin: null, unit_info: "2 x 500 ml" }), old = product(2, now - 30 * 86400000);
    const search = (index, options = {}) => Service.search(tx, { retailerSku: sku(index), now, ...options });
    const row = index => tx.query(`SELECT * FROM ${Service.TABLE} WHERE source_id=$1 AND retailer_sku=$2`, [Service.SOURCE, sku(index)]).then(result => result.rows[0]);
    await test("price-less source-bound identities", async () => {
      const saved = await Service.persist(tx, [first, noGtin, old], { now });
      assert.equal(saved.accepted, 3); assert.equal(saved.upserted, 3); assert.equal(saved.rejected, 0);
      assert.equal(saved.priceRowsCreated, 0); assert.equal(saved.canonicalProductsCreated, 0);
      const item = (await search(0)).items[0];
      assert(item); assert.equal(item.gtin, fixture.pages[1].items[0].barcode_gtin);
      assert.equal(item.scopeChannel, "online"); assert.equal(item.locationScope, "native-venue");
      assert.equal(item.nativeVenueId, Client.VENUE_ID); assert.equal(item.nativeMarketId, Client.PROFILE.nativeMarketId);
      assert.equal(item.state, "last-observed"); assert.equal(item.availability, "unknown");
      assert.equal(item.truthEligible, false); assert.equal(item.currentPriceVerified, false);
      assert.equal(item.physicalStorePriceVerified, false); assert.equal(item.assortmentComplete, false);
      assert.equal(item.observedAt, first.observedAt); assert.equal(item.sourceResponseHash, first.sourceResponseHash);
      assert.equal(item.price, undefined); assert.equal(item.storeId, undefined);
      assert.equal(item.canonicalProductId, undefined); assert.equal(item.expiresAt, null);
      assert.equal((await search(1)).items[0].gtin, null);
      assert.equal((await search(2)).items[0].observedAt, old.observedAt);
      assert.equal((await search(2)).items[0].recentlyObserved, false, "Old identity survives price expiry without recapture");
    });

    await test("exact sales pack and literal queries", async () => {
      assert.equal((await search(1, { pack: "2 x 500 ml" })).items.length, 1);
      assert.equal((await search(1, { pack: "1 l" })).items.length, 0, "Equal total volume does not collapse the native multipack");
      assert.equal((await Service.search(tx, { search: "article%_", now })).items.length, 0);
      assert.equal((await Service.search(tx, { merchant: "nahkauf", now })).items.length, 0);
      assert.equal((await Service.search(tx, { scopeChannel: "pickup", now })).items.length, 0);
      assert.equal(Client.createClient("nahkaufWrangelBerlin").parseArticles([fixture.pages[1].items[0]], {}).products.length, 0,
        "This new article feed is explicitly EDEKA-only; it does not silently create a Nahkauf article source");
    });

    await test("duplicate retry and latest-only evidence", async () => {
      const original = await row(0);
      const replay = await Service.persist(tx, [first, first], { now });
      assert.equal(replay.upserted, 0); assert.equal(replay.duplicates, 1); assert.deepEqual(await row(0), original);
      const newer = product(0, base + 1000, { name: "POSTGRES TEST genuinely newer native item" });
      assert.equal((await Service.persist(tx, [newer], { now })).upserted, 1);
      const latest = await row(0); assert.equal((await search(0)).items[0].name, newer.name);
      assert.equal((await Service.persist(tx, [first], { now })).upserted, 0); assert.deepEqual(await row(0), latest);
      const retimed = { ...newer, observedAt: new Date(base + 2000).toISOString() };
      assert.equal((await Service.persist(tx, [retimed], { now })).accepted, 0);
      assert.deepEqual(await row(0), latest, "Original source proof cannot be retimed");
    });

    await test("equal-capture conflicts hold the latest identity", async () => {
      const a = product(3, base + 1000), b = product(3, base + 1000, { unit_info: "2 x 500 ml" }), older = product(3, base);
      const saved = await Service.persist(tx, [older, a, b], { now });
      assert.equal(saved.upserted, 1); assert.equal(saved.heldArticles, 1);
      assert.equal((await row(3)).held, true); assert.equal((await search(3)).items.length, 0);
      const held = await row(3);
      await Service.persist(tx, [a, b, older], { now }); assert.deepEqual(await row(3), held);
      const recovered = product(3, base + 3000, { name: "POSTGRES TEST new unique native original" });
      await Service.persist(tx, [recovered], { now });
      assert.equal((await row(3)).held, false); assert.equal((await row(3)).conflict_capture, null);
      assert.equal((await search(3)).items[0].observedAt, recovered.observedAt);
    });

    await test("native GTIN never merges retailer SKUs or creates canonical products", async () => {
      const sameGtin = product(4);
      await Service.persist(tx, [sameGtin], { now });
      const result = await Service.search(tx, { gtin: first.gtin, now, limit: 200 });
      assert(result.items.some(item => item.retailerSku === sku(0)));
      assert(result.items.some(item => item.retailerSku === sku(4)));
      assert.equal(result.items.filter(item => [sku(0), sku(4)].includes(item.retailerSku)).length, 2);
      for (const table of immutableTables) assert.deepEqual(await tableSnapshot(table, tx), before[table], "Article writes cannot mutate " + table);
    });

    await test("native price can accompany identity but is not copied to article storage", async () => {
      const priced = capture(5, base, { price: 204, deposit: { amount: 15, label: "MEHRWEG" }, unit_price: { base: 1, price: 189, unit: "litre" } });
      assert.equal(priced.parsed.products.length, 1); assert.equal(priced.parsed.offers.length, 1);
      await Service.persist(tx, priced.parsed.products, { now });
      assert.equal((await search(5)).items[0].price, undefined);
      assert.equal(priced.parsed.products[0].nativeWitness.item.price, undefined);
      assert.deepEqual(await tableSnapshot(Price.TABLE, tx), before[Price.TABLE]);
    });

    await test("remaining held article is not an observed article", async () => {
      const a = product(6), b = product(6, base, { barcode_gtin: null });
      const held = await Service.persist(tx, [a, b], { now });
      assert.equal(held.upserted, 1); assert.equal(held.accepted, 0); assert.equal(held.heldArticles, 1);
      assert.equal((await search(6)).items.length, 0);
    });

    await test("source venue pack proof and time negatives", async () => {
      const invalid = [
        { ...first, sourceId: "Wolt nahkauf Berlin Wrangelstraße" }, { ...first, merchant: "nahkauf" },
        { ...first, scopeCountry: "AT" }, { ...first, scopeChannel: "physical-store" },
        { ...first, nativeVenueId: "0".repeat(24) }, { ...first, nativeMarketId: "561888" },
        { ...first, packCount: 99 }, { ...first, gtin: "0000000000001" },
        { ...first, sourceResponseDate: new Date(base - 16 * 60000).toISOString() },
        { ...first, sourceAgeSeconds: 901 }, { ...first, observedAt: new Date(now + 1000).toISOString() },
        { ...first, sourceResponseHash: "BAD" }, { ...first, storeId: "fake-store" },
        { ...first, truthEligible: true }, { ...first, price: 1.29 }
      ];
      const saved = await Service.persist(tx, invalid, { now });
      assert.equal(saved.accepted, 0); assert.equal(saved.rejected, invalid.length);
      for (const patch of [{ unit_info: "ca. 1 kg" }, { unit_info: "37 g", name: "POSTGRES TEST 5 x 37 g" },
        { sell_by_weight_config: {} }, { variant: {} }, { options: [{}] },
        { barcode_gtin: "GTIN 5449000017888" }, { barcode_gtin: 5449000017888 }]) {
        assert.equal(capture(10, base, patch).parsed.products.length, 0, JSON.stringify(patch));
      }
      const nonNativeBarcode = clone(first);
      nonNativeBarcode.gtin = nonNativeBarcode.nativeWitness.item.barcode_gtin = "GTIN 5449000017888";
      const rejectedBarcode = await Service.persist(tx, [nonNativeBarcode], { now });
      assert.equal(rejectedBarcode.accepted, 0); assert.equal(rejectedBarcode.rejected, 1,
        "A malformed native barcode is a rejected input, not an unexpected SQL CHECK failure");
    });

    await test("actual SQL constraints retain source venue and proof bounds", async () => {
      for (const change of ["source_id='Wolt nahkauf Berlin Wrangelstraße'", "merchant='nahkauf'",
        "native_venue_id=repeat('0',24)", "native_market_id='561888'", "scope_country='AT'",
        "scope_channel='physical-store'", "location_scope='store'", "gtin='GTIN 5449000017888'", "pack_count=0", "pack_amount=0",
        "pack_amount='NaN'::numeric", "source_response_hash='BAD'", "source_age_seconds=901",
        "source_response_date=observed_at-interval '16 minutes'", "venue_captured_at=observed_at+interval '1 second'",
        "shop=jsonb_set(shop,'{city}','\"Hamburg\"'::jsonb)", "held=true,conflict_capture=NULL"] ) {
        await tx.query("SAVEPOINT invalid_article_sql");
        await assert.rejects(() => tx.query(`UPDATE ${Service.TABLE} SET ${change} WHERE source_id=$1 AND retailer_sku=$2`,
          [Service.SOURCE, sku(0)]), error => error.code === "23514", change);
        await tx.query("ROLLBACK TO SAVEPOINT invalid_article_sql");
      }
    });

    await test("legacy native witness is revalidated despite consistent stored hashes", async () => {
      const original = product(7);
      await Service.persist(tx, [original], { now });
      const baseline = await Service.status(tx, { now });
      const altered = [];
      let unsafe = clone(original);
      unsafe.nativeUnitInfo = unsafe.pack = "ca. 1 kg"; unsafe.packAmount = 1000; unsafe.packUnit = "g";
      unsafe.nativeWitness.item.unit_info = "ca. 1 kg"; altered.push(unsafe);
      unsafe = clone(original); unsafe.nativeWitness.item.sell_by_weight_config = {}; altered.push(unsafe);
      unsafe = clone(original); unsafe.nativeWitness.item.variant = {}; altered.push(unsafe);
      unsafe = clone(original); unsafe.nativeWitness.item.options = [{}]; altered.push(unsafe);
      unsafe = clone(original); unsafe.nativeWitness.venue.venue.city = "Hamburg"; altered.push(unsafe);
      unsafe = clone(original); unsafe.gtin = unsafe.nativeWitness.item.barcode_gtin = "0000000000001"; altered.push(unsafe);
      unsafe = clone(original); unsafe.name = unsafe.nativeWitness.item.name = "POSTGRES TEST 5 x 37 g";
      unsafe.nativeUnitInfo = unsafe.pack = unsafe.nativeWitness.item.unit_info = "37 g";
      unsafe.packAmount = 37; unsafe.packUnit = "g"; altered.push(unsafe);
      for (const invalid of altered) {
        await tx.query("SAVEPOINT legacy_invalid_article");
        const serialized = Service.rowForArticle(invalid), columns = Object.keys(serialized);
        assert.equal(serialized.witness_hash, Service.serializationHash(serialized.native_witness));
        const unhashed = { ...serialized }; delete unhashed.capture_hash;
        assert.equal(serialized.capture_hash, Service.serializationHash(unhashed), "Hash is valid so native semantic revalidation must reject");
        await tx.query(`UPDATE ${Service.TABLE} SET ${columns.map((column, index) => column + "=$" + (index + 1)).join(",")}
          WHERE source_id=$${columns.length + 1} AND retailer_sku=$${columns.length + 2}`,
        [...columns.map(column => serialized[column]), Service.SOURCE, sku(7)]);
        assert.equal((await search(7)).items.length, 0, JSON.stringify(invalid.nativeWitness.item));
        const excluded = await Service.status(tx, { now });
        assert.equal(excluded.storedArticles, baseline.storedArticles);
        assert.equal(excluded.heldArticles, baseline.heldArticles);
        assert.equal(excluded.excludedInvalidArticles, baseline.excludedInvalidArticles + 1);
        assert.equal(excluded.lastObservedArticles, baseline.lastObservedArticles - 1);
        await tx.query("ROLLBACK TO SAVEPOINT legacy_invalid_article");
      }
    });

    await test("same identity in two category originals does not create a held conflict", async () => {
      const firstOriginal = product(8), another = capture(8, base, { syntheticDifferentOriginal: true });
      another.proof.sourceResponseUrl = Client.API_ORIGIN + Client.API_PATH + "/categories/slug/postgres-test-another-category";
      const secondOriginal = Client.parseItems([another.originalItem], another.proof).products[0];
      assert(secondOriginal);
      assert.equal(Service.rowForArticle(firstOriginal).identity_hash, Service.rowForArticle(secondOriginal).identity_hash);
      assert.notEqual(firstOriginal.sourceResponseHash, secondOriginal.sourceResponseHash);
      const saved = await Service.persist(tx, [firstOriginal, secondOriginal], { now });
      assert.equal(saved.upserted, 1); assert.equal(saved.heldArticles, 0);
      assert.equal((await search(8)).items.length, 1);
      const stable = await row(8);
      await Service.persist(tx, [secondOriginal, firstOriginal], { now });
      assert.deepEqual(await row(8), stable, "Another same-time category original must not rewrite the stored capture");
    });

    await test("status counts and original proof reader revalidation", async () => {
      const baseline = await Service.status(tx, { now });
      assert.equal(baseline.currentPriceVerified, false); assert.equal(baseline.currentAvailabilityVerified, false);
      assert.equal(baseline.physicalStorePriceVerified, false); assert.equal(baseline.assortmentComplete, false);
      assert.equal(baseline.scopeChannel, "online"); assert.equal(baseline.locationScope, "native-venue");
      assert.equal(baseline.storedArticles, articlesBefore.total + 9);
      assert.equal(baseline.heldArticles, articleStatusBefore.heldArticles + 1);
      assert.equal(baseline.excludedInvalidArticles, articleStatusBefore.excludedInvalidArticles);
      assert.equal(baseline.lastObservedArticles, articleStatusBefore.lastObservedArticles + 8);
      assert.equal(baseline.lastObservedArticles + baseline.heldArticles + baseline.excludedInvalidArticles, baseline.storedArticles);
      await tx.query("SAVEPOINT article_bad_hash");
      await tx.query(`UPDATE ${Service.TABLE} SET capture_hash=repeat('0',64) WHERE source_id=$1 AND retailer_sku=$2`, [Service.SOURCE, sku(0)]);
      assert.equal((await search(0)).items.length, 0);
      const excluded = await Service.status(tx, { now });
      assert.equal(excluded.storedArticles, baseline.storedArticles);
      assert.equal(excluded.excludedInvalidArticles, baseline.excludedInvalidArticles + 1);
      assert.equal(excluded.lastObservedArticles, baseline.lastObservedArticles - 1);
      await tx.query("ROLLBACK TO SAVEPOINT article_bad_hash");
    });

    await test("real transaction failure preserves all existing evidence", async () => {
      await assert.rejects(() => tx.query(`UPDATE ${Service.TABLE} SET retailer_sku=NULL WHERE source_id=$1 AND retailer_sku=$2`, [Service.SOURCE, sku(0)]), error => error.code === "23502");
      await tx.query("ROLLBACK");
      assert.deepEqual(await tableSnapshot(Service.TABLE), articlesBefore, "Failed writing transaction restores the original article ledger");
      for (const table of immutableTables) assert.deepEqual(await tableSnapshot(table), before[table], "Rollback preserves existing " + table);
    });

    await test("standalone pool refresh commits articles and rolls back failed checkpoints", async () => {
      // A separate schema in this already-guarded PG18 test DB isolates the
      // production pool/COMMIT path. No outer test transaction can conceal it.
      const schemaName = "wolt_article_refresh_test_" + process.pid + "_" + Date.now();
      assert(/^[a-z][a-z0-9_]+$/.test(schemaName));
      await pool.query("CREATE SCHEMA " + schemaName);
      const refreshPool = new Pool({ connectionString, ssl: false, connectionTimeoutMillis: 5000,
        options: "-c search_path=" + schemaName });
      try {
        await Refresh.ensure(refreshPool);
        const batch = number => {
          const captured = capture(50 + number), assortmentHash = "e".repeat(64);
          const nextCursor = { version: 1, nativeVenueId: Client.VENUE_ID,
            nativeAssortmentId: captured.parsed.products[0].nativeAssortmentId,
            assortmentHash, categoryIndex: 1, pageToken: number === 1 ? null : "POSTGRES TEST token " + number,
            pageNumber: number === 1 ? 1 : number, received: number, pagesFetched: number };
          return { ...captured.parsed, complete: false, categoryCount: 2, categoriesCompleted: 1,
            pagesFetched: number, receivedCumulative: number, requests: 3, assortmentHash, nextCursor };
        };
        const checkpoint = async () => (await refreshPool.query("SELECT * FROM wolt_retailer_catalog_state WHERE source_id=$1", [Service.SOURCE])).rows[0];
        const firstBatch = batch(1);
        assert.equal(firstBatch.offers.length, 0); assert.equal(firstBatch.products.length, 1);
        let fetches = 0;
        const saved = await Refresh.refresh({ pool: refreshPool, maxRequests: 3, now: () => now }, {
          fetchOffers: async options => { fetches++; assert.equal(options.cursor, null); return firstBatch; }
        });
        assert.equal(fetches, 1); assert.equal(saved.accepted, 0); assert.equal(saved.nativeArticles.accepted, 1);
        assert.equal(saved.nativeArticles.priceRowsCreated, 0); assert.equal(saved.nativeArticles.canonicalProductsCreated, 0);
        assert.equal((await Service.search(refreshPool, { retailerSku: sku(51), now })).items.length, 1);
        assert.equal((await refreshPool.query(`SELECT count(*)::int AS total FROM ${Price.TABLE}`)).rows[0].total, 0);
        const firstState = await checkpoint(); assert.deepEqual(firstState.cursor, firstBatch.nextCursor);
        assert.equal(firstState.pages_fetched, 1);

        const secondBatch = batch(2);
        await assert.rejects(() => Refresh.refresh({ pool: refreshPool, now: () => now }, {
          fetchOffers: async options => { assert.deepEqual(options.cursor, firstBatch.nextCursor); return secondBatch; },
          persistArticles: async (client, products, options) => {
            assert.equal(Object.hasOwn(client, "connect"), false);
            assert.equal(typeof client.connect, "function", "Refresh must hand the real inherited PoolClient to article persistence");
            await Service.persist(client, products, options);
            throw Error("POSTGRES TEST article persist failure after actual write");
          }
        }), /POSTGRES TEST article persist failure/);
        assert.deepEqual(await checkpoint(), firstState);
        assert.equal((await Service.search(refreshPool, { retailerSku: sku(52), now })).items.length, 0);
        const resumed = await Refresh.refresh({ pool: refreshPool, now: () => now }, {
          fetchOffers: async options => { assert.deepEqual(options.cursor, firstBatch.nextCursor); return secondBatch; }
        });
        assert.equal(resumed.nativeArticles.accepted, 1); assert.equal(resumed.nativeArticles.upserted, 1);
        assert.equal((await Service.search(refreshPool, { retailerSku: sku(52), now })).items.length, 1);
        const secondState = await checkpoint(); assert.deepEqual(secondState.cursor, secondBatch.nextCursor);

        // This real PostgreSQL trigger fails only the final checkpoint statement.
        // The earlier article INSERT must roll back with that same transaction.
        await refreshPool.query(`CREATE FUNCTION block_test_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.pages_fetched=3 THEN RAISE EXCEPTION 'POSTGRES TEST checkpoint failure'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER block_test_checkpoint BEFORE INSERT OR UPDATE ON wolt_retailer_catalog_state
          FOR EACH ROW EXECUTE FUNCTION block_test_checkpoint();`);
        const thirdBatch = batch(3);
        await assert.rejects(() => Refresh.refresh({ pool: refreshPool, now: () => now }, {
          fetchOffers: async options => { assert.deepEqual(options.cursor, secondBatch.nextCursor); return thirdBatch; }
        }), /POSTGRES TEST checkpoint failure/);
        assert.deepEqual(await checkpoint(), secondState);
        assert.equal((await Service.search(refreshPool, { retailerSku: sku(53), now })).items.length, 0);
        await refreshPool.query("DROP TRIGGER block_test_checkpoint ON wolt_retailer_catalog_state; DROP FUNCTION block_test_checkpoint();");
        const retried = await Refresh.refresh({ pool: refreshPool, now: () => now }, { fetchOffers: async () => thirdBatch });
        assert.equal(retried.nativeArticles.accepted, 1); assert.equal(retried.nativeArticles.upserted, 1);
        assert.equal((await Service.search(refreshPool, { retailerSku: sku(53), now })).items.length, 1);
        assert.equal((await checkpoint()).pages_fetched, 3);
        assert.equal((await Service.status(refreshPool, { now })).lastObservedArticles, 3);
        assert.equal((await refreshPool.query(`SELECT count(*)::int AS total FROM ${Price.TABLE}`)).rows[0].total, 0);
      } finally {
        await refreshPool.end();
        await pool.query("DROP SCHEMA " + schemaName + " CASCADE");
      }
      assert.deepEqual(await tableSnapshot(Service.TABLE), articlesBefore);
      for (const table of immutableTables) assert.deepEqual(await tableSnapshot(table), before[table], "Standalone refresh preserves public " + table);
    });

    // ensure() must not cache a genuine PoolClient after temporary DDL rolls back.
    await test("temporary schema rollback cannot create a stale ensure success", async () => {
      for (let index = 0; index < 2; index++) {
        await tx.query("BEGIN"); await tx.query("SET LOCAL search_path=pg_temp"); await Service.ensure(tx);
        assert((await tx.query("SELECT to_regclass('pg_temp.'||$1) AS name", [Service.TABLE])).rows[0].name);
        await tx.query("ROLLBACK");
      }
    });
    console.log(`wolt-retailer-article-postgres: PostgreSQL 18; ${groups} actual SQL groups passed; genuine writing transactions, price-less dated native identities, exact venue/pack/proof, latest holds and zero canonical/price/stock promotion`);
  } finally {
    if (tx) { try { await tx.query("ROLLBACK"); } catch {} tx.release(); }
    await pool.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
