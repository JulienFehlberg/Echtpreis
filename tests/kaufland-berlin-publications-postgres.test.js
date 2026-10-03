"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Pool } = require("pg");
const Service = require("../kaufland-berlin-publications");
const clone = value => structuredClone(value);
const esc = value => String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const localDay = time => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date(time));
const displayDay = day => day.slice(8) + "." + day.slice(5, 7) + "." + day.slice(0, 4);

// All HTML, identifiers, HTTP metadata and clocks below are explicitly NEW
// synthetic SQL originals. No retailer is queried and no archive is retimed.
function fixture(at, change = {}) {
  const from = localDay(at), to = new Date(Date.parse(from + "T12:00:00Z") + 6 * Service.DAY_MS).toISOString().slice(0, 10);
  const rows = [
    { id: "90000001", title: "POSTGRES TEST Gouda", quantity: "je 450-g-Stück", price: "2.99", base: "(1 kg = 6.65)", ...change },
    { id: "90000002", title: "POSTGRES TEST Baguette", quantity: "je 160-g-Packg.", price: "0.99", base: "(1 kg = 6.19) / (1 kg = 5.50)**", card: "0.88" },
    { id: "90000003", title: "POSTGRES TEST Milch", quantity: "je 1-l-Packg.", price: "9.99", base: "", bby: "12 Stück", calculation: "entspr. pro Packg. 0.84" },
    { id: "90000004", title: "POSTGRES TEST Drink", quantity: "je 10 x 0,2-l-Packg.", price: "2.99", base: "(1 l = 1.50) / (1 l = 1.25)**", card: "2.49" },
    { id: "90000005", title: "POSTGRES TEST range group", quantity: "je 450 - 500-g-Packg.", price: "2.29", base: "(1 kg = 4.58 - 5.09)" },
    { id: "90000006", title: "POSTGRES TEST conflicting total", quantity: "je 6 St. = 168-g-Packg.", price: "1.59 *", base: "(1 kg = 9.30)" }
  ];
  const cards = rows.map(row => `<a class="k-product-tile k-product-tile--slider" href="/angebote/uebersicht.html?kloffer-category=135_Foodknueller&amp;kloffer-articleID=${row.id}">
    <div class="k-product-tile__title">${esc(row.title)}</div><div class="k-product-tile__subtitle">synthetic offer group</div>
    <div class="k-product-tile__unit-price">${esc(row.quantity)}</div><div class="k-product-tile__base-price">${esc(row.base)}</div>
    <div class="k-product-tile__pricetags-normal"><div class="k-price-tag">${row.bby ? `<div class="k-price-tag__bby-message"><div class="k-price-tag__bby-message-top">${esc(row.bby)}</div><div class="k-price-tag__bby-message-bottom">${esc(row.calculation)}</div></div>` : ""}
      <div class="k-price-tag__price">${esc(row.price)}</div></div></div>${row.card ? `<div class="k-product-tile__pricetags-loyalty"><div class="k-price-tag k-price-tag--xtra" is-k-card-only="false"><div class="k-price-tag__with-card">Mit Kaufland Card XTRA **</div><div class="k-price-tag__price">${esc(row.card)}</div></div></div>` : ""}</a>`).join("");
  const body = `<!doctype html><html><head><script class="o-special-offers-controller__settings" type="application/json">{"settings":{"apiUrl":"/.kloffers.storeName={storeName}.json"}}</script></head><body>
    <!-- POSTGRES TEST synthetic original, never a retailer capture -->
    <div data-force-store-change="DE1980"><h1 itemprop="name" content="Kaufland Berlin-Reinickendorf">Kaufland Berlin-Reinickendorf</h1>
    <span itemprop="url" content="/service/filiale.storeName=DE1980.html"></span><div itemprop="streetAddress" content="Ollenhauerstraße 122">Ollenhauerstraße 122</div>
    <span itemprop="addressLocality" content="Berlin"></span><span itemprop="postalCode" content="13403"></span></div>
    <div class="t-tiles-slider"><h3>Unsere Knüller der Woche</h3><h3>Gültig vom ${displayDay(from)} bis ${displayDay(to)}</h3><div class="o-slider__list">${cards}</div></div></body></html>`;
  const record = (url, content, time, type) => ({ status: 200, sourceResponseUrl: url, sourceResponseHash: Service.hash(content),
    body: content, capturedAt: new Date(time).toISOString(), headers: { date: new Date(time).toUTCString(), age: "0", "content-type": type }, bytes: Buffer.byteLength(content) });
  return { branch: record(Service.PAGE_URL, body, at, "text/html; charset=UTF-8"),
    index: record(Service.INDEX_URL, JSON.stringify(rows.map(row => ({ dateFrom: from, dateTo: to, klNr: row.id }))), at + 100, "application/json") };
}
function rehash(raw) {
  for (const record of [raw.branch, raw.index]) {
    record.sourceResponseHash = Service.hash(record.body); record.bytes = Buffer.byteLength(record.body);
  }
  return raw;
}
function offlineFixtureCheck(now) {
  const raw = fixture(now - 60000), parsed = Service.parseCapture(raw, { now });
  assert.equal(parsed.received, 6); assert.equal(parsed.accepted, 6); assert.equal(parsed.rejected, 0);
  const milk = parsed.promotionalPublications.find(row => row.publication.nativePublicationId === "90000003").publication;
  assert.equal(milk.announcedAmounts.default, null); assert.equal(milk.announcedAmounts.multibuy.amount, 9.99);
  assert.equal(milk.announcedAmounts.multibuy.minimumPurchaseCount, 12);
  assert.equal(milk.announcedAmounts.multibuy.nativePerPackCalculation, "entspr. pro Packg. 0.84");
  assert(parsed.promotionalPublications.find(row => row.publication.nativePublicationId === "90000006")
    .publication.numericComparisonHoldReasons.includes("native-pack-base-price-conflict"));
  for (const { publication } of parsed.promotionalPublications) {
    assert.equal(publication.current, false); assert.equal(publication.gtin, null); assert.equal(publication.retailerSku, null);
    assert.equal(publication.truthEligible, false); assert.equal(publication.numericComparisonEligible, false);
  }
  return raw;
}

async function main() {
  const now = Date.now(), base = now - 60000;
  offlineFixtureCheck(now);
  if (process.argv.includes("--offline-fixture-check")) {
    console.log("kaufland-berlin-publications-postgres: synthetic fixture contract passed; no SQL or HTTP executed");
    return;
  }
  const connectionString = process.env.DATABASE_URL;
  assert(connectionString, "DATABASE_URL is required");
  const database = new URL(connectionString);
  assert(["localhost", "127.0.0.1"].includes(database.hostname) && !database.search && !database.hash
    && /^\/[a-z][a-z0-9_]*_test$/.test(database.pathname),
  "Only an explicit named loopback *_test database is allowed before creating a Pool");
  const pool = new Pool({ connectionString, ssl: false, connectionTimeoutMillis: 5000 });
  const schema = "kaufland_publication_test_" + crypto.randomBytes(8).toString("hex");
  assert(/^kaufland_publication_test_[a-f0-9]{16}$/.test(schema));
  let sourcePool, tx, schemaCreated = false, groups = 0;
  const test = async (name, fn) => { await fn(); groups++; console.log("ok " + groups + " - " + name); };
  const immutableTables = ["products", "stores", "merchants", "price_observations", "external_product_mappings", "external_store_mappings",
    "receipt_submissions", "receipts", "retailer_published_prices", "wolt_retailer_published_prices", "rewe_retailer_published_prices",
    "aldi_assortment_published_prices", "aldi_assortment_articles", "wolt_retailer_articles", "aldi_category_articles", "aldi_category_captures",
    "aldi_category_published_prices", "penny_berlin_publication_captures", "lidl_dated_publication_captures", "price_source_refresh_state", Service.TABLE];
  async function publicSnapshot(table) {
    const exists = (await pool.query("SELECT to_regclass($1) AS name", ["public." + table])).rows[0].name;
    if (!exists) return null;
    return (await pool.query(`SELECT count(*)::int AS total,
      md5(COALESCE(string_agg(row_to_json(t)::text, chr(10) ORDER BY row_to_json(t)::text),'')) AS hash FROM public.${table} t`)).rows[0];
  }
  const row = client => client.query(`SELECT * FROM ${Service.TABLE} WHERE source_id=$1`, [Service.SOURCE]).then(q => q.rows[0]);
  const search = (client, options = {}) => Service.search(client, { now, ...options });
  async function begin() { await tx.query("BEGIN"); await tx.query("SELECT txid_current()"); }
  const before = {};
  try {
    const major = Math.floor(Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num) / 10000);
    assert.equal(major, 18, "Actual PostgreSQL 18 is mandatory; older versions do not count as this integration pass");
    for (const table of immutableTables) before[table] = await publicSnapshot(table);
    await pool.query("CREATE SCHEMA " + schema); schemaCreated = true;
    // No public fallback: every service DDL/write is isolated in this unique test schema.
    sourcePool = new Pool({ connectionString, ssl: false, connectionTimeoutMillis: 5000, options: "-csearch_path=" + schema });
    tx = await sourcePool.connect();

    await test("genuine PoolClient schema initialization rolls back without retaining a client cache", async () => {
      assert.equal(typeof tx.connect, "function"); assert.equal(Object.hasOwn(tx, "connect"), false);
      for (let index = 0; index < 2; index++) {
        await begin(); await Service.ensure(tx);
        assert.equal((await tx.query("SELECT to_regclass($1) AS name", [schema + "." + Service.TABLE])).rows[0].name, Service.TABLE);
        await tx.query("ROLLBACK");
        assert.equal((await sourcePool.query("SELECT to_regclass($1) AS name", [schema + "." + Service.TABLE])).rows[0].name, null);
      }
      await Service.ensure(sourcePool);
      const columns = (await sourcePool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2", [schema, Service.TABLE])).rows.map(r => r.column_name);
      for (const forbidden of ["price", "gtin", "retailer_sku", "store_id", "expires_at"])
        assert(!columns.includes(forbidden), "The publication snapshot is not a canonical product, current-price or stock table");
    });

    const first = fixture(base);
    await test("an autocommit PoolClient cannot authorize a snapshot write", async () => {
      assert.equal((await tx.query("SELECT pg_current_xact_id_if_assigned()::text AS id")).rows[0].id, null);
      await assert.rejects(() => Service.persist(tx, first, { now }), /writing-transaction-required/);
      assert.equal((await tx.query(`SELECT count(*)::int AS total FROM ${Service.TABLE}`)).rows[0].total, 0);
    });
    await test("assigned genuine client saves exact private originals with no public price identity", async () => {
      await begin();
      assert((await tx.query("SELECT pg_current_xact_id_if_assigned()::text AS id")).rows[0].id);
      const saved = await Service.persist(tx, first, { now });
      assert.equal(saved.upserted, 1); assert.equal(saved.accepted, 6); assert.equal(saved.currentPhysicalPriceImports, 0);
      const stored = await row(tx); assert.deepEqual(stored.raw_capture, first);
      assert.equal(stored.proof_hash, Service.parseCapture(first, { now }).proofHash);
      assert.equal(stored.captured_at.toISOString(), first.index.capturedAt);
      const result = await search(tx); assert.equal(result.promotionalPublications.length, 6);
      for (const { publication, reference } of result.promotionalPublications) {
        assert.equal(publication.capturedAt, first.branch.capturedAt); assert.equal(reference.observedAt, first.branch.capturedAt);
        assert.equal(publication.sourceResponseHash, first.branch.sourceResponseHash); assert.equal(publication.gtin, null);
        assert.equal(publication.retailerSku, null); assert.equal(publication.deposit, null); assert.equal(publication.current, false);
        assert.equal(publication.physicalStorePriceVerified, false); assert.equal(publication.normalPriceClassificationVerified, false);
        assert.equal(publication.numericComparisonEligible, false); assert.equal(publication.price, undefined);
        assert.equal(publication.body, undefined); assert.equal(publication.rawCapture, undefined); assert.equal(publication.nativeWitness, undefined);
      }
      await tx.query("COMMIT");
      assert.equal((await Service.status(sourcePool, { now })).storedLatestGroups, 6);
    });
    await test("source-aware published amounts retain Card XTRA, inner multipacks and bundle math", async () => {
      const results = (await search(sourcePool)).promotionalPublications.map(r => r.publication);
      const milk = results.find(r => r.nativePublicationId === "90000003");
      assert.equal(milk.announcedAmounts.default, null); assert.equal(milk.announcedAmounts.multibuy.amount, 9.99);
      assert.equal(milk.announcedAmounts.multibuy.minimumPurchaseCount, 12); assert.equal(milk.packCount, 1);
      const drink = results.find(r => r.nativePublicationId === "90000004");
      assert.equal(drink.packCount, 10); assert.equal(drink.packAmount, 200); assert.equal(drink.announcedAmounts.card.amount, 2.49);
      assert.equal((await search(sourcePool, { pack: "2 l" })).promotionalPublications.length, 0);
      assert.equal((await search(sourcePool, { pack: "10 x 200 ml" })).promotionalPublications.length, 1);
      for (const input of [{ gtin: "4063367116285" }, { scopeChannel: "physical-store" }, { merchant: "REWE" }])
        assert.equal((await search(sourcePool, input)).promotionalPublications.length, 0);
    });
    await test("identical capture retry is idempotent and never resets snapshot dates", async () => {
      const original = await row(sourcePool), retry = await Service.persist(sourcePool, first, { now });
      assert.equal(retry.upserted, 0); assert.equal(retry.unchanged, 1); assert.deepEqual(await row(sourcePool), original);
      assert.equal((await sourcePool.query(`SELECT count(*)::int AS total FROM ${Service.TABLE}`)).rows[0].total, 1);
    });
    await test("samecapture contradiction is durable and older clean replay cannot expose a price", async () => {
      const conflict = fixture(base, { price: "3.99" }), held = await Service.persist(sourcePool, conflict, { now });
      assert.equal(held.held, true); assert.equal(held.accepted, 0); assert.equal((await search(sourcePool)).promotionalPublications.length, 0);
      const stored = await row(sourcePool); assert.equal(stored.held, true); assert.deepEqual(stored.conflicting_capture, conflict);
      const state = await Service.status(sourcePool, { now }); assert.equal(state.ambiguousLatestCapture, true);
      assert.equal(state.storedLatestGroups, 6); assert.equal(state.heldGroups, 6); assert.equal(state.publishedOfferGroups, 0);
      await Service.persist(sourcePool, first, { now }); assert.deepEqual(await row(sourcePool), stored);
      await Service.persist(sourcePool, fixture(base - 1000), { now }); assert.deepEqual(await row(sourcePool), stored);
      assert.equal((await search(sourcePool, { search: "Gouda" })).promotionalPublications.length, 0);
    });
    await test("copied original witnesses cannot be retimed to clear a conflict", async () => {
      const stored = await row(sourcePool), retimed = clone(first);
      retimed.branch.capturedAt = new Date(base + 5000).toISOString(); retimed.index.capturedAt = new Date(base + 5100).toISOString();
      await assert.rejects(() => Service.persist(sourcePool, retimed, { now }), /retimed-original-forbidden/);
      assert.deepEqual(await row(sourcePool), stored);
    });
    let unique = fixture(base + 10000);
    await test("a new genuine synthetic response Date may recover using unchanged body bytes", async () => {
      // Simulate a distinct real HTTP response: new Date and capture, same native bytes.
      unique = clone(first);
      for (const key of ["branch", "index"]) {
        const shifted = Date.parse(first[key].capturedAt) + 10000;
        unique[key].capturedAt = new Date(shifted).toISOString(); unique[key].headers.date = new Date(shifted).toUTCString();
      }
      assert.equal(unique.branch.sourceResponseHash, first.branch.sourceResponseHash);
      assert.equal((await Service.persist(sourcePool, unique, { now })).upserted, 1);
      assert.equal((await row(sourcePool)).held, false); assert.equal((await search(sourcePool)).promotionalPublications.length, 6);
    });
    await test("latest rejected native group masks older clean publication without price fallback", async () => {
      const withheld = fixture(base + 20000, { price: "0.00" });
      await Service.persist(sourcePool, withheld, { now });
      assert.equal((await search(sourcePool, { search: "Gouda" })).promotionalPublications.length, 0);
      assert.equal((await search(sourcePool)).promotionalPublications.length, 5);
      await Service.persist(sourcePool, unique, { now });
      assert.equal((await search(sourcePool, { search: "Gouda" })).promotionalPublications.length, 0);
      unique = fixture(base + 30000); await Service.persist(sourcePool, unique, { now });
    });
    await test("old documents remain dated without price freshness; stale new admission is refused", async () => {
      const oldRead = await Service.search(sourcePool, { now: now + 30 * Service.DAY_MS });
      assert.equal(oldRead.promotionalPublications.length, 6);
      assert(oldRead.promotionalPublications.every(r => r.publication.current === false && r.publication.expiresAt === null
        && r.publication.priceObservedAt === null && r.publication.capturedAt === unique.branch.capturedAt));
      const original = await row(sourcePool);
      await assert.rejects(() => Service.persist(sourcePool, unique, { now: now + Service.DAY_MS }), /stale-original/);
      assert.deepEqual(await row(sourcePool), original);
    });
    await test("actual SQL constraints forbid fabricated source/hash/scalar/held snapshot states", async () => {
      await begin();
      for (const change of ["source_id='REWE invented source'", "proof_hash='BAD'", "captured_at='Infinity'::timestamptz",
        "raw_capture='[]'::jsonb", "held=true,conflicting_capture=NULL", "held=false,conflicting_capture='{}'::jsonb",
        "held=true,conflicting_capture='[]'::jsonb"]) {
        await tx.query("SAVEPOINT invalid_publication_state");
        await assert.rejects(() => tx.query(`UPDATE ${Service.TABLE} SET ${change} WHERE source_id=$1`, [Service.SOURCE]), e => e.code === "23514", change);
        await tx.query("ROLLBACK TO SAVEPOINT invalid_publication_state");
      }
      await tx.query("SAVEPOINT oversized_publication_state");
      await assert.rejects(() => tx.query(`UPDATE ${Service.TABLE} SET raw_capture=$2::jsonb WHERE source_id=$1`,
        [Service.SOURCE, JSON.stringify({ padding: "x".repeat(6000000) })]), e => e.code === "23514");
      await tx.query("ROLLBACK TO SAVEPOINT oversized_publication_state"); await tx.query("ROLLBACK");
    });
    await test("reader reparses SQL-stored private originals and rejects selfconsistent foreign branch proofs", async () => {
      await begin(); const current = await row(tx);
      const foreign = clone(current.raw_capture); foreign.branch.body = foreign.branch.body.replace('content="Berlin"', 'content="Hamburg"'); rehash(foreign);
      for (const parameters of [
        { raw: { ...clone(current.raw_capture), branch: { ...clone(current.raw_capture.branch), body: current.raw_capture.branch.body + " " } }, proof: current.proof_hash, captured: current.captured_at },
        { raw: foreign, proof: current.proof_hash, captured: current.captured_at },
        { raw: current.raw_capture, proof: "0".repeat(64), captured: current.captured_at },
        { raw: current.raw_capture, proof: current.proof_hash, captured: new Date(base + 40000) }
      ]) {
        await tx.query("SAVEPOINT corrupted_publication_original");
        await tx.query(`UPDATE ${Service.TABLE} SET raw_capture=$2::jsonb,proof_hash=$3,captured_at=$4 WHERE source_id=$1`,
          [Service.SOURCE, JSON.stringify(parameters.raw), parameters.proof, parameters.captured]);
        await assert.rejects(() => search(tx), /kaufland-/);
        await assert.rejects(() => Service.status(tx, { now }), /kaufland-/);
        await tx.query("ROLLBACK TO SAVEPOINT corrupted_publication_original");
      }
      assert.deepEqual(await row(tx), current); await tx.query("ROLLBACK");
    });
    await test("both conflict originals remain content-bound on an actual held SQL row", async () => {
      await begin(); await Service.persist(tx, fixture(base + 30000, { price: "4.99" }), { now });
      const held = await row(tx), corrupt = clone(held.conflicting_capture); corrupt.branch.body += " ";
      await tx.query(`UPDATE ${Service.TABLE} SET conflicting_capture=$2::jsonb WHERE source_id=$1`, [Service.SOURCE, JSON.stringify(corrupt)]);
      await assert.rejects(() => Service.status(tx, { now }), /original-capture-required/);
      await tx.query("ROLLBACK"); assert.equal((await row(sourcePool)).held, false);
    });
    await test("caller-owned original snapshot and synthetic checkpoint roll back together on actual SQL failure", async () => {
      await sourcePool.query("CREATE TABLE synthetic_publication_checkpoint(id int PRIMARY KEY,value int CHECK(value>0))");
      const original = await row(sourcePool); await begin();
      await Service.persist(tx, fixture(base + 40000, { title: "POSTGRES TEST pending source snapshot" }), { now });
      assert.notDeepEqual(await row(tx), original);
      await assert.rejects(() => tx.query("INSERT INTO synthetic_publication_checkpoint VALUES(1,0)"), e => e.code === "23514");
      await tx.query("ROLLBACK"); assert.deepEqual(await row(sourcePool), original);
      assert.equal((await sourcePool.query("SELECT count(*)::int AS total FROM synthetic_publication_checkpoint")).rows[0].total, 0);
    });
    await test("actual deferred commit failure rolls back content and a subsequent pool retry succeeds", async () => {
      const original = await row(sourcePool);
      await sourcePool.query(`CREATE FUNCTION synthetic_publication_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'POSTGRES TEST deferred snapshot commit failure' USING ERRCODE='P0001'; END; $$;
        CREATE CONSTRAINT TRIGGER synthetic_publication_commit_failure AFTER INSERT OR UPDATE ON ${Service.TABLE}
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION synthetic_publication_commit_failure();`);
      const next = fixture(base + 45000, { title: "POSTGRES TEST genuine retry publication" });
      await assert.rejects(() => Service.persist(sourcePool, next, { now }), e => e.code === "P0001" && /deferred snapshot commit failure/.test(e.message));
      assert.deepEqual(await row(sourcePool), original);
      await sourcePool.query(`DROP TRIGGER synthetic_publication_commit_failure ON ${Service.TABLE}; DROP FUNCTION synthetic_publication_commit_failure();`);
      assert.equal((await Service.persist(sourcePool, next, { now })).upserted, 1);
      assert.equal((await search(sourcePool, { search: "genuine retry" })).promotionalPublications.length, 1);
      assert.equal((await sourcePool.query(`SELECT count(*)::int AS total FROM ${Service.TABLE}`)).rows[0].total, 1);
    });
    await test("SQL writes never change public canonical, article, stock, receipt, source or price ledgers", async () => {
      for (const table of immutableTables) assert.deepEqual(await publicSnapshot(table), before[table], "Unchanged public " + table);
      const status = await Service.status(sourcePool, { now });
      assert.equal(status.currentPhysicalPriceImports, 0); assert.equal(status.nativeProductIdentities, 0);
      assert.equal(status.truthEligible, false); assert.equal(status.fullAssortment, false);
      assert.equal(status.numericComparisonHeldGroups, 6);
    });
    tx.release(); tx = null; await sourcePool.end(); sourcePool = null;
    await pool.query("DROP SCHEMA " + schema + " CASCADE"); schemaCreated = false;
    for (const table of immutableTables) assert.deepEqual(await publicSnapshot(table), before[table]);
  } finally {
    if (tx) { try { await tx.query("ROLLBACK"); } catch {} tx.release(); }
    if (sourcePool) await sourcePool.end();
    if (schemaCreated) await pool.query("DROP SCHEMA " + schema + " CASCADE");
    await pool.end();
  }
  console.log("kaufland-berlin-publications-postgres: PostgreSQL18; " + groups + " actual SQL groups passed; no retailer HTTP");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
