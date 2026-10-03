"use strict";
const assert = require("node:assert/strict"), crypto = require("node:crypto"), { Pool } = require("pg");
const Publications = require("../kaufland-berlin-publications"), Refresh = require("../kaufland-berlin-publication-refresh");
const Store = require("../price-refresh-state-store");
const day = at => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
const displayDay = value => value.slice(8) + "." + value.slice(5, 7) + "." + value.slice(0, 4);

// Newly authored SYNTHETIC originals and HTTP clocks. No archive is retimed,
// and the handler's two fetches are local functions, never retailer requests.
function originals(at, price = "2.99") {
  const from = day(at), to = new Date(Date.parse(from + "T12:00:00Z") + 6 * Publications.DAY_MS).toISOString().slice(0, 10);
  const branch = `<!doctype html><html><head><script class="o-special-offers-controller__settings" type="application/json">{"settings":{"apiUrl":"/.kloffers.storeName={storeName}.json"}}</script></head><body>
    <!-- POSTGRES TEST synthetic original -->
    <div data-force-store-change="DE1980"><h1 itemprop="name" content="Kaufland Berlin-Reinickendorf">Kaufland Berlin-Reinickendorf</h1>
    <span itemprop="url" content="/service/filiale.storeName=DE1980.html"></span><div itemprop="streetAddress" content="Ollenhauerstraße 122">Ollenhauerstraße 122</div>
    <span itemprop="addressLocality" content="Berlin"></span><span itemprop="postalCode" content="13403"></span></div>
    <div class="t-tiles-slider"><h3>Unsere Knüller der Woche</h3><h3>Gültig vom ${displayDay(from)} bis ${displayDay(to)}</h3><div class="o-slider__list">
    <a class="k-product-tile k-product-tile--slider" href="/angebote/uebersicht.html?kloffer-category=135_Foodknueller&amp;kloffer-articleID=90000001">
    <div class="k-product-tile__title">POSTGRES TEST Gouda</div><div class="k-product-tile__subtitle">synthetic original</div>
    <div class="k-product-tile__unit-price">je 450-g-Stück</div><div class="k-product-tile__base-price">(1 kg = 6.65)</div>
    <div class="k-product-tile__pricetags-normal"><div class="k-price-tag"><div class="k-price-tag__price">${price}</div></div></div></a>
    </div></div></body></html>`;
  return { branch, index: JSON.stringify([{ dateFrom: from, dateTo: to, klNr: "90000001" }]) };
}
function record(url, body, at) {
  return { status: 200, sourceResponseUrl: url, sourceResponseHash: Publications.hash(body), body, capturedAt: new Date(at).toISOString(),
    headers: { date: new Date(at).toUTCString(), age: "0", "content-type": url === Publications.PAGE_URL ? "text/html; charset=UTF-8" : "application/json" }, bytes: Buffer.byteLength(body) };
}
function rawFixture(at) {
  const bodies = originals(at);
  return { branch: record(Publications.PAGE_URL, bodies.branch, at), index: record(Publications.INDEX_URL, bodies.index, at + 1000) };
}
function transport(context, changes = {}) {
  let requests = 0; const bodies = originals(context.now, changes.price), calls = [];
  const deps = {
    sleep: async ms => { context.now += ms; await changes.onPause?.(); },
    shouldContinue: () => !changes.stopping,
    fetchImpl: async (url, request) => {
      calls.push({ url, request }); requests++;
      assert([Publications.PAGE_URL, Publications.INDEX_URL].includes(url));
      assert.equal(request.method, "GET"); assert.equal(request.credentials, "omit"); assert.equal(request.redirect, "error");
      await changes.onFetch?.(url);
      const status = changes.statusAt === requests ? (changes.status ?? 403) : 200;
      const body = url === Publications.PAGE_URL ? bodies.branch : bodies.index;
      const headers = { date: new Date(context.now).toUTCString(), age: "0", "content-type": url === Publications.PAGE_URL ? "text/html; charset=UTF-8" : "application/json",
        "retry-after": changes.retryAfter ?? null };
      return { status, url, headers: { get: key => headers[key] ?? null }, arrayBuffer: async () => Buffer.from(body) };
    }
  };
  return { deps, calls, changes, get requests() { return requests; }, run: () => Refresh.refresh({ pool: context.pool, leaseOwner: context.owner, now: () => context.now }, deps) };
}
async function main() {
  const initial = Date.now() - 5000, raw = rawFixture(initial), offline = Publications.parseCapture(raw, { now: initial + 1000 });
  assert.equal(offline.accepted, 1); assert.equal(offline.currentPhysicalPriceImports, 0);
  assert.equal(offline.promotionalPublications[0].publication.numericComparisonEligible, false);
  if (process.argv.includes("--offline-fixture-check")) {
    console.log("kaufland-berlin-publication-refresh-postgres: synthetic original fixture passed; no SQL or HTTP executed"); return;
  }
  const connectionString = process.env.DATABASE_URL;
  assert(connectionString, "DATABASE_URL is required");
  const database = new URL(connectionString);
  assert(["localhost", "127.0.0.1"].includes(database.hostname) && !database.search && !database.hash && /^\/[a-z][a-z0-9_]*_test$/.test(database.pathname),
    "Only an explicit named loopback *_test database is allowed before creating a Pool");
  const basePool = new Pool({ connectionString, ssl: false, connectionTimeoutMillis: 5000 });
  const prefix = "kaufland_refresh_test_" + crypto.randomBytes(8).toString("hex");
  assert(/^kaufland_refresh_test_[a-f0-9]{16}$/.test(prefix));
  let groups = 0;
  const immutableTables = ["products", "stores", "merchants", "price_observations", "external_product_mappings", "external_store_mappings",
    "receipt_submissions", "receipts", "retailer_published_prices", "wolt_retailer_published_prices", "rewe_retailer_published_prices",
    "aldi_assortment_published_prices", "aldi_assortment_articles", "wolt_retailer_articles", "aldi_category_articles", "aldi_category_captures",
    "aldi_category_published_prices", "penny_berlin_publication_captures", "lidl_dated_publication_captures", "price_source_refresh_state", Publications.TABLE, Refresh.TABLE];
  const publicSnapshot = async table => {
    if (!(await basePool.query("SELECT to_regclass($1) AS name", ["public." + table])).rows[0].name) return null;
    return (await basePool.query(`SELECT count(*)::int AS total,md5(COALESCE(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text),'')) AS hash FROM public.${table} t`)).rows[0];
  };
  const checkpoint = context => context.pool.query(`SELECT * FROM ${Refresh.TABLE} WHERE source_id=$1`, [Publications.SOURCE]).then(q => q.rows[0]);
  const snapshot = context => context.pool.query(`SELECT * FROM ${Publications.TABLE} WHERE source_id=$1`, [Publications.SOURCE]).then(q => q.rows[0]);
  const sourceRow = context => context.pool.query("SELECT * FROM price_source_refresh_state WHERE source_name=$1", [Publications.SOURCE]).then(q => q.rows[0]);
  const countSnapshots = context => context.pool.query(`SELECT count(*)::int AS total FROM ${Publications.TABLE}`).then(q => q.rows[0].total);
  const before = {};
  async function test(name, fn, { initialize = true } = {}) {
    const schema = prefix + "_" + (groups + 1);
    assert(/^kaufland_refresh_test_[a-f0-9]{16}_\d+$/.test(schema));
    await basePool.query("CREATE SCHEMA " + schema);
    const pool = new Pool({ connectionString, ssl: false, max: 4, connectionTimeoutMillis: 5000, options: "-csearch_path=" + schema });
    const context = { pool, schema, now: Date.now() - 5000, owner: "kaufland-pg18-" + crypto.randomBytes(8).toString("hex") };
    try {
      if (initialize) {
        await Refresh.ensure(pool); await Publications.ensure(pool);
        // The explicit long TEST lease covers virtual failure-retry clocks, never production state.
        assert.equal(await Store.acquire(pool, Publications.SOURCE, context.owner, 7 * Publications.DAY_MS), true);
      }
      await fn(context); groups++; console.log("ok " + groups + " - " + name);
    } finally { await pool.end(); await basePool.query("DROP SCHEMA " + schema + " CASCADE"); }
  }
  try {
    const major = Math.floor(Number((await basePool.query("SHOW server_version_num")).rows[0].server_version_num) / 10000);
    assert.equal(major, 18, "Actual PostgreSQL18 is mandatory; no PG12 execution counts as this pass");
    for (const table of immutableTables) before[table] = await publicSnapshot(table);
    await test("refresh schema DDL rolls back on genuine connected clients without a cache shortcut", async context => {
      const tx = await context.pool.connect();
      try {
        assert.equal(typeof tx.connect, "function"); assert.equal(Object.hasOwn(tx, "connect"), false);
        for (let index = 0; index < 2; index++) {
          await tx.query("BEGIN"); await tx.query("SELECT txid_current()"); await Refresh.ensure(tx);
          assert((await tx.query("SELECT to_regclass($1) AS name", [context.schema + "." + Refresh.TABLE])).rows[0].name);
          await tx.query("ROLLBACK");
          assert.equal((await context.pool.query("SELECT to_regclass($1) AS name", [context.schema + "." + Refresh.TABLE])).rows[0].name, null);
        }
        await Refresh.ensure(context.pool);
        assert.equal((await Refresh.load(context.pool)).revision, 0);
      } finally { try { await tx.query("ROLLBACK"); } catch {} tx.release(); }
    }, { initialize: false });
    await test("actual handler atomically commits original pair and revision while retaining source lease", async context => {
      const source = await sourceRow(context), h = transport(context), result = await h.run();
      assert.equal(result.requests, 2); assert.equal(result.accepted, 1); assert.equal(result.currentPhysicalPriceImports, 0);
      const stored = await snapshot(context), progress = await checkpoint(context);
      assert.equal(stored.proof_hash, progress.proof_hash); assert.equal(Number(progress.revision), 1); assert.equal(progress.completed_captures, 1);
      assert.equal(stored.raw_capture.branch.sourceResponseUrl, Publications.PAGE_URL);
      assert.equal(stored.raw_capture.index.sourceResponseUrl, Publications.INDEX_URL);
      assert.equal(stored.raw_capture.branch.sourceResponseHash, Publications.hash(stored.raw_capture.branch.body));
      assert.equal(progress.last_completed_at.toISOString(), new Date(context.now).toISOString());
      assert.equal(progress.next_attempt_at.getTime(), context.now + Refresh.REFRESH_MS);
      assert.deepEqual(await sourceRow(context), source, "Collector does not release/reset the runner-owned source lease or failures");
      const read = await Publications.search(context.pool, { now: context.now });
      assert.equal(read.promotionalPublications.length, 1); assert.equal(read.promotionalPublications[0].publication.current, false);
      assert.equal(read.promotionalPublications[0].publication.gtin, null); assert.equal(read.promotionalPublications[0].publication.retailerSku, null);
      assert.equal(read.promotionalPublications[0].publication.price, undefined); assert.equal(read.promotionalPublications[0].publication.numericComparisonEligible, false);
      const paused = await h.run(); assert.equal(paused.skipped, "source-not-due"); assert.equal(h.requests, 2);
      assert.deepEqual(await snapshot(context), stored); assert.deepEqual(await checkpoint(context), progress);
    });
    await test("actual source owner mismatch prevents every GET and makes no checkpoint", async context => {
      await context.pool.query("UPDATE price_source_refresh_state SET lease_owner=$2 WHERE source_name=$1", [Publications.SOURCE, "another-instance"]);
      const beforeSource = await sourceRow(context), h = transport(context), result = await h.run();
      assert.equal(result.skipped, "source-not-eligible"); assert.equal(h.requests, 0); assert.equal(await checkpoint(context), undefined);
      assert.equal(await countSnapshots(context), 0); assert.deepEqual(await sourceRow(context), beforeSource);
    });
    await test("actual global source backoff remains authoritative and untouched", async context => {
      const until = new Date(context.now + 2 * 3600000);
      await context.pool.query("UPDATE price_source_refresh_state SET consecutive_failures=3,last_attempt_at=$2,next_attempt_at=$3 WHERE source_name=$1",
        [Publications.SOURCE, new Date(context.now), until]);
      const beforeSource = await sourceRow(context), h = transport(context), result = await h.run();
      assert.equal(result.skipped, "source-not-due"); assert.equal(result.nextAttemptAt, until.toISOString()); assert.equal(h.requests, 0);
      assert.deepEqual(await sourceRow(context), beforeSource); assert.equal(await checkpoint(context), undefined);
    });
    await test("HTTP403 creates a durable failure pause without snapshot or source-state reset", async context => {
      const at = context.now, originalSource = await sourceRow(context), h = transport(context, { statusAt: 1, status: 403, retryAfter: "7200" });
      await assert.rejects(h.run(), e => e.status === 403 && e.requests === 1 && e.nextAttemptAt === new Date(at + 7200000).toISOString());
      const progress = await checkpoint(context); assert.equal(progress.last_error, "kaufland-source-http-403");
      assert.equal(progress.next_attempt_at.getTime(), at + 7200000); assert.equal(progress.completed_captures, 0);
      assert.equal(progress.proof_hash, null); assert.equal(progress.last_completed_at, null); assert.equal(await countSnapshots(context), 0);
      assert.equal((await h.run()).skipped, "source-not-due"); assert.equal(h.requests, 1); assert.deepEqual(await sourceRow(context), originalSource);
    });
    await test("second HTTP refusal never commits a partial original pair", async context => {
      const h = transport(context, { statusAt: 2, status: 429, retryAfter: "5" });
      await assert.rejects(h.run(), e => e.status === 429 && e.requests === 2 && e.nextAttemptAt === new Date(context.now + 3600000).toISOString());
      assert.equal(await countSnapshots(context), 0); const progress = await checkpoint(context);
      assert.equal(progress.completed_captures, 0); assert.equal(progress.last_completed_at, null); assert.equal(progress.proof_hash, null);
    });
    await test("actual snapshot SQL failure rolls back before durable failure save and a genuine retry commits", async context => {
      await context.pool.query(`CREATE FUNCTION reject_snapshot_write() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
        RAISE EXCEPTION 'POSTGRES TEST original snapshot failure' USING ERRCODE='P0001'; END;$$;
        CREATE TRIGGER reject_snapshot_write BEFORE INSERT OR UPDATE ON ${Publications.TABLE} FOR EACH ROW EXECUTE FUNCTION reject_snapshot_write();`);
      const h = transport(context);
      await assert.rejects(h.run(), e => e.code === "P0001" && /original snapshot failure/.test(e.message));
      assert.equal(await countSnapshots(context), 0); const failed = await checkpoint(context);
      assert.equal(Number(failed.revision), 1); assert.equal(failed.completed_captures, 0); assert.equal(failed.proof_hash, null);
      await context.pool.query(`DROP TRIGGER reject_snapshot_write ON ${Publications.TABLE}; DROP FUNCTION reject_snapshot_write();`);
      context.now = failed.next_attempt_at.getTime() + 1; const retry = transport(context), result = await retry.run();
      assert.equal(result.accepted, 1); assert.equal(await countSnapshots(context), 1);
      const progress = await checkpoint(context); assert.equal(Number(progress.revision), 2); assert.equal(progress.completed_captures, 1);
      assert.equal(progress.last_error, null); assert.equal(progress.proof_hash, (await snapshot(context)).proof_hash);
    });
    await test("actual checkpoint SQL failure rolls snapshot back and failure-only checkpoint remains durable", async context => {
      await context.pool.query(`CREATE FUNCTION reject_success_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
        IF NEW.last_completed_at IS NOT NULL THEN RAISE EXCEPTION 'POSTGRES TEST success checkpoint failure' USING ERRCODE='P0001'; END IF;
        RETURN NEW; END;$$; CREATE TRIGGER reject_success_checkpoint BEFORE INSERT OR UPDATE ON ${Refresh.TABLE}
        FOR EACH ROW EXECUTE FUNCTION reject_success_checkpoint();`);
      const h = transport(context); await assert.rejects(h.run(), e => e.code === "P0001" && /success checkpoint failure/.test(e.message));
      assert.equal(await countSnapshots(context), 0); const failed = await checkpoint(context);
      assert.equal(failed.last_completed_at, null); assert.equal(failed.completed_captures, 0); assert.equal(failed.proof_hash, null);
      await context.pool.query(`DROP TRIGGER reject_success_checkpoint ON ${Refresh.TABLE}; DROP FUNCTION reject_success_checkpoint();`);
      context.now = failed.next_attempt_at.getTime() + 1; await transport(context).run();
      assert.equal((await checkpoint(context)).completed_captures, 1); assert.equal(await countSnapshots(context), 1);
    });
    await test("deferred COMMIT failure rolls both actual snapshot and completed checkpoint back", async context => {
      await context.pool.query(`CREATE FUNCTION reject_snapshot_commit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
        RAISE EXCEPTION 'POSTGRES TEST deferred snapshot commit failure' USING ERRCODE='P0001'; END;$$;
        CREATE CONSTRAINT TRIGGER reject_snapshot_commit AFTER INSERT OR UPDATE ON ${Publications.TABLE}
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_snapshot_commit();`);
      const h = transport(context); await assert.rejects(h.run(), e => e.code === "P0001" && /deferred snapshot commit failure/.test(e.message));
      assert.equal(await countSnapshots(context), 0); const failed = await checkpoint(context);
      assert.equal(failed.completed_captures, 0); assert.equal(failed.last_completed_at, null); assert.equal(failed.proof_hash, null);
      await context.pool.query(`DROP TRIGGER reject_snapshot_commit ON ${Publications.TABLE}; DROP FUNCTION reject_snapshot_commit();`);
      context.now = failed.next_attempt_at.getTime() + 1; await transport(context).run();
      assert.equal(await countSnapshots(context), 1); assert.equal((await checkpoint(context)).completed_captures, 1);
    });
    await test("a real separately committed stale revision wins and rolls pending original back", async context => {
      const h = transport(context);
      h.deps.publications = { ...Publications, persist: async (tx, capture, options) => {
        // All source admission remains the actual service; only the race is injected.
        const saved = await Publications.persist(tx, capture, options);
        await context.pool.query(`INSERT INTO ${Refresh.TABLE}(source_id,revision) VALUES($1,1)`, [Publications.SOURCE]);
        return saved;
      } };
      await assert.rejects(h.run(), e => e.code === "kaufland-refresh-checkpoint-moved" && e.failurePersistenceError?.code === "kaufland-refresh-checkpoint-moved");
      assert.equal(await countSnapshots(context), 0); const winner = await checkpoint(context);
      assert.equal(Number(winner.revision), 1); assert.equal(winner.last_error, null); assert.equal(winner.next_attempt_at, null);
      assert.equal(winner.completed_captures, 0); assert.equal(winner.proof_hash, null);
    });
    await test("actual lease loss after both originals reports GET2 and makes no failure/progress commit", async context => {
      const h = transport(context, { onFetch: async url => {
        if (url === Publications.INDEX_URL) await context.pool.query("UPDATE price_source_refresh_state SET lease_owner=$2 WHERE source_name=$1",
          [Publications.SOURCE, "replacement-instance"]);
      } });
      const result = await h.run(); assert.equal(result.skipped, "source-not-eligible"); assert.equal(result.requests, 2);
      const bodies = originals(context.now - 1000); assert.equal(result.bytes, Buffer.byteLength(bodies.branch) + Buffer.byteLength(bodies.index));
      assert.equal(await countSnapshots(context), 0); assert.equal(await checkpoint(context), undefined);
      assert.equal((await sourceRow(context)).lease_owner, "replacement-instance");
    });
    await test("shutdown after first original leaves no snapshot or progress authority", async context => {
      const changes = { onPause: async () => { changes.stopping = true; } }, h = transport(context, changes);
      const result = await h.run(); assert.equal(result.skipped, "server-stopping"); assert.equal(result.requests, 1);
      assert.equal(await countSnapshots(context), 0); assert.equal(await checkpoint(context), undefined);
    });
    await test("native RetryAfter overflow survives the actual PG18 timestamp roundtrip unchanged", async context => {
      const h = transport(context, { statusAt: 1, status: 429, retryAfter: "999999999999999999999999999999999" });
      await assert.rejects(h.run(), e => e.nextAttemptAt === "+275760-09-13T00:00:00.000Z");
      const paused = await checkpoint(context); assert(paused.next_attempt_at instanceof Date);
      assert.equal(paused.next_attempt_at.getTime(), 8640000000000000); assert.equal(paused.next_attempt_at.toISOString(), "+275760-09-13T00:00:00.000Z");
      assert.equal((await h.run()).nextAttemptAt, "+275760-09-13T00:00:00.000Z"); assert.equal(h.requests, 1);
      assert.equal(await countSnapshots(context), 0); assert.equal(paused.completed_captures, 0);
    });
    await test("a terminated owned transaction is rolled back and the pool recovers with a fresh client", async context => {
      const h = transport(context); let terminatedPid;
      h.deps.publications = { ...Publications, persist: async (tx, capture, options) => {
        const saved = await Publications.persist(tx, capture, options);
        // Observe the deliberate socket-close event; the handler's SQL error is
        // still required below, rather than crashing on an unhandled emitter.
        tx.on("error", () => {});
        terminatedPid = Number((await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
        assert(Number.isSafeInteger(terminatedPid) && terminatedPid > 0);
        assert.equal((await basePool.query("SELECT pg_terminate_backend($1) AS terminated", [terminatedPid])).rows[0].terminated, true,
          "Only the PID directly read from our own assigned test transaction may be terminated");
        return saved;
      } };
      await assert.rejects(h.run()); assert.equal(await countSnapshots(context), 0);
      const failed = await checkpoint(context); assert.equal(failed.completed_captures, 0); assert.equal(failed.proof_hash, null);
      assert.notEqual(Number((await context.pool.query("SELECT pg_backend_pid() AS pid")).rows[0].pid), terminatedPid);
      context.now = failed.next_attempt_at.getTime() + 1; await transport(context).run();
      assert.equal(await countSnapshots(context), 1); assert.equal((await checkpoint(context)).completed_captures, 1);
    });
    for (const table of immutableTables) assert.deepEqual(await publicSnapshot(table), before[table], "All public ledgers unchanged: " + table);
    groups++; console.log("ok " + groups + " - public canonical/article/price/receipt/source ledgers and public Kaufland snapshots remain unchanged");
  } finally { await basePool.end(); }
  console.log("kaufland-berlin-publication-refresh-postgres: PostgreSQL18; " + groups + " actual SQL/handler groups passed; no retailer HTTP");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
