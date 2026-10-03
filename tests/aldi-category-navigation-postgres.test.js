"use strict";
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const Fetch = require("../aldi-category-fetch-client"), Refresh = require("../aldi-category-refresh"), Navigation = require("../aldi-category-navigation-parser");
const Rejected = require("../aldi-category-rejected-capture-store"), Articles = require("../aldi-category-article-service"), Prices = require("../aldi-category-price-service");
const ProductParser = require("../aldi-assortment-category-client"), Fixture = require("./fixtures/aldi-navigation-capture");
const clone = value => structuredClone(value), iso = value => new Date(value).toISOString();
// Every body below is a newly authored synthetic original with its own HTTP
// clock/hash. No archive is retimed, no merchant HTTP or production DB runs.
function transport(original, at, changes = {}) {
  const headers = { "content-type": "text/html; charset=utf-8", date: new Date(original.meta.sourceResponseDate).toUTCString(),
    age: original.meta.sourceAgeSeconds === null ? null : String(original.meta.sourceAgeSeconds), ...changes.headers };
  return { status: changes.status ?? 200, url: changes.url ?? original.meta.sourceResponseUrl,
    headers: { get: key => headers[key.toLowerCase()] ?? null }, arrayBuffer: async () => Buffer.from(original.body),
    body: changes.status ? { cancel: async () => {} } : undefined, syntheticReceivedAt: iso(at) };
}
async function offlineFixtureCheck() {
  const now = Fixture.time, original = Fixture.parent(() => {}, now);
  let request;
  const observed = await Fetch.fetchPage(Fixture.parentUrl, { now: () => now,
    fetchImpl: async (url, options) => { request = { url, options }; return transport(original, now); } });
  assert.equal(request.url, Fixture.parentUrl); assert(request.options.signal.aborted);
  assert.equal(observed.page, undefined); assert.equal(observed.requests, 1);
  const proof = Navigation.parseNavigationParent(observed.original.body, observed.original.meta, { now });
  assert.deepEqual(observed.navigation, proof); assert.deepEqual(observed.discoveredTargets, proof.discoveredTargets);
  assert.throws(() => ProductParser.parsePage(observed.original.body, observed.original.meta, { now }), e => e.code === "aldi-category-native-index-conflict");
  assert.equal(Rejected.validateCapture(observed.rejectedCapture, { now }).sourceResponseHash, observed.original.meta.sourceResponseHash);
  assert.equal(proof.articleRowsCreated, 0); assert.equal(proof.priceRowsCreated, 0); assert.equal(proof.assortmentComplete, false);
  console.log("aldi-category-navigation-postgres: authored synthetic actual Fetch/Navigation/Product-rejection/retention fixture passed; no HTTP or DB");
}
async function main() {
  if (process.argv.includes("--offline-fixture-check")) { await offlineFixtureCheck(); return; }
  const { Pool } = require("pg"), connectionString = process.env.DATABASE_URL;
  assert(connectionString, "DATABASE_URL is required for the actual PostgreSQL integration");
  const database = new URL(connectionString);
  assert(["localhost", "127.0.0.1"].includes(database.hostname) && !database.search && !database.hash
    && /^\/[a-z][a-z0-9_]*_test$/.test(database.pathname), "Only a dedicated named loopback *_test database is allowed");
  const admin = new Pool({ connectionString, ssl: false, connectionTimeoutMillis: 5000 });
  const schema = "aldi_nav_sql_test_" + crypto.randomBytes(8).toString("hex");
  assert(/^aldi_nav_sql_test_[a-f0-9]{16}$/.test(schema));
  let pool, created = false, groups = 0, clock = Date.now(), articleWrites = 0, priceWrites = 0;
  const retainedTables = [Rejected.ORIGINAL_TABLE, Rejected.CAPTURE_TABLE, Rejected.TABLE];
  const articlePriceTables = [Articles.CAPTURE_TABLE, Articles.TABLE, Prices.TABLE];
  const untouched = [...new Set(["products", "stores", "merchants", "external_product_mappings", "external_store_mappings", "price_observations", "receipts", "receipt_submissions",
    "aldi_assortment_published_prices", "aldi_assortment_articles", "price_source_refresh_state", Refresh.TABLE, ...retainedTables, ...articlePriceTables])];
  const beforePublic = {};
  async function digest(client, table, prefix = "") {
    return (await client.query(`SELECT count(*)::int AS count,md5(COALESCE(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text),'')) AS hash FROM ${prefix}${table} t`)).rows[0];
  }
  async function publicSnapshot(table) {
    if (!(await admin.query("SELECT to_regclass($1) AS name", ["public." + table])).rows[0].name) return null;
    return digest(admin, table, "public.");
  }
  async function retainedSnapshot() { const result = {}; for (const table of retainedTables) result[table] = await digest(pool, table); return result; }
  async function noArticleOrPrice() {
    for (const table of articlePriceTables) assert.equal((await digest(pool, table)).count, 0, "Navigation never admits rows in " + table);
    assert.equal(articleWrites, 0); assert.equal(priceWrites, 0);
  }
  async function transaction(operation) {
    const tx = await pool.connect();
    try { await tx.query("BEGIN"); await tx.query("SELECT txid_current()"); const result = await operation(tx); await tx.query("COMMIT"); return result; }
    catch (error) { await tx.query("ROLLBACK"); throw error; } finally { tx.release(); }
  }
  function original(tag, at = clock, change = () => {}) {
    return Fixture.parent(native => { native.syntheticFixture = "NEW SYNTHETIC PG NAV " + tag; change(native); }, at);
  }
  async function prepare() {
    // This is isolated test checkpoint preparation, not a production pause
    // reset. The prior seed's actual native header witnesses this parent URL.
    clock = Math.max(Date.now(), clock + 1001);
    const prior = Fixture.leaf(native => { native.props.pageProps.page.header = [{ sideDrawerNavigation: [{ Produkte: { children: [{ path: Fixture.parentUrl }] } }] }]; }, clock - 120000);
    assert(Fetch.discoveryTargets(prior, { now: clock }).includes(Fixture.parentUrl));
    const cursor = Refresh.state(); cursor.targets.push(Fixture.parentUrl); cursor.nextIndex = 1; cursor.revision = 17;
    cursor.lastRunAt = prior.meta.capturedAt;
    cursor.targetProofs.push({ target: Fixture.parentUrl, from: Fetch.SEED, sourceResponseHash: prior.meta.sourceResponseHash, capturedAt: prior.meta.capturedAt });
    await pool.query(`INSERT INTO ${Refresh.TABLE}(source_id,cursor,last_error,retry_after,updated_at) VALUES($1,$2::jsonb,NULL,NULL,$3)
      ON CONFLICT(source_id) DO UPDATE SET cursor=EXCLUDED.cursor,last_error=NULL,retry_after=NULL,updated_at=EXCLUDED.updated_at`, [Refresh.SOURCE, JSON.stringify(cursor), iso(clock - 120000)]);
    return cursor;
  }
  async function currentCursor() { return (await pool.query(`SELECT cursor FROM ${Refresh.TABLE} WHERE source_id=$1`, [Refresh.SOURCE])).rows[0].cursor; }
  async function unchangedFrontier(expected) { assert.deepEqual(await currentCursor(), expected); await noArticleOrPrice(); }
  function faultPool(hook) {
    const events = [];
    // Genuine pg.PoolClients and real SQL results. Only explicit transport-
    // failure injection after actual query/ROLLBACK completion is substituted.
    const wrapper = { query: (...args) => pool.query(...args), connect: async () => {
      const tx = await pool.connect(), rawQuery = tx.query, rawRelease = tx.release;
      tx.query = async (...args) => { const sql = args[0]; events.push({ sql, client: tx }); const result = await rawQuery.apply(tx, args); await hook?.(sql, result, tx); return result; };
      tx.release = error => { events.push({ release: true, error, client: tx }); tx.query = rawQuery; tx.release = rawRelease; return rawRelease.call(tx, error); };
      return tx;
    } };
    return { pool: wrapper, events };
  }
  async function run(value, options = {}) {
    const requests = []; let observed, gates = 0, result, error;
    const articleService = { ensure: Articles.ensure, persist: async () => { articleWrites++; assert.fail("Navigation cannot call Article.persist"); } };
    const priceService = { ensure: Prices.ensure, persist: async () => { priceWrites++; assert.fail("Navigation cannot call Price.persist"); } };
    const deps = { articles: articleService, prices: priceService, rejected: options.rejected || Rejected,
      canFetch: async () => { gates++; return options.gate ? options.gate(gates) : true; },
      fetchPage: async target => {
        assert.equal(target, Fixture.parentUrl);
        observed = await Fetch.fetchPage(target, { now: () => clock, fetchImpl: async (url, request) => {
          requests.push({ url, request }); return transport(value, clock, options.response || {});
        } });
        if (options.mutateObserved) options.mutateObserved(observed);
        return observed;
      }, ...(options.checkpoint ? { checkpoint: options.checkpoint } : {}) };
    try { result = await Refresh.refresh({ pool: options.pool || pool, now: () => clock, maxRequests: 1 }, deps); } catch (caught) { error = caught; }
    for (const call of requests) {
      assert.equal(call.url, Fixture.parentUrl); assert.equal(call.request.method, "GET"); assert.equal(call.request.credentials, "omit");
      assert.equal(call.request.redirect, "error"); assert(call.request.signal.aborted);
    }
    return { result, error, observed, requests, gates };
  }
  function failed(answer, code) {
    assert(answer.error, "An unsafe navigation step must fail"); assert.equal(answer.error.code, code);
    assert.equal(answer.error.pages, 0); assert.equal(answer.error.navigationPages, 0); assert.equal(answer.error.requests, 1);
    assert.equal(answer.result, undefined); assert(!JSON.stringify(answer.error).includes("NEW SYNTHETIC PG NAV")); return answer.error;
  }
  async function retained(answer) {
    const c = Rejected.validateCapture(answer.observed.rejectedCapture, { now: clock });
    const rows = (await pool.query(`SELECT c.*,b.body,b.body_bytes FROM ${Rejected.CAPTURE_TABLE} c JOIN ${Rejected.ORIGINAL_TABLE} b USING(source_response_hash) WHERE c.capture_hash=$1`, [c.captureHash])).rows;
    assert.equal(rows.length, 1); const row = rows[0];
    assert.equal(row.body, answer.observed.original.body); assert.equal(row.body_bytes, answer.observed.bytes);
    assert.equal(row.source_response_hash, answer.observed.original.meta.sourceResponseHash); assert.equal(row.failure_code, "aldi-category-native-index-conflict");
    assert.equal(new Date(row.captured_at).toISOString(), answer.observed.original.meta.capturedAt);
    assert.equal(new Date(row.source_response_date).toISOString(), c.sourceResponseDate); assert.equal(row.original_response_date, answer.observed.original.meta.sourceResponseDate);
    return c;
  }
  async function failurePause(code, expectedTime = clock + 3600000) {
    const raw = await Refresh.load(pool); assert.equal(raw.lastError, code); assert.equal(new Date(raw.retryAfter).getTime(), expectedTime);
    assert.equal(new Date(await Refresh.resumeAt(pool, clock)).getTime(), expectedTime);
  }
  async function test(name, operation) { try { await operation(); groups++; } catch (error) { console.error("Failed: " + name); throw error; } }
  try {
    assert.equal(Math.floor(Number((await admin.query("SHOW server_version_num")).rows[0].server_version_num) / 10000), 18, "Actual PostgreSQL 18 is required");
    for (const table of untouched) beforePublic[table] = await publicSnapshot(table);
    await admin.query("CREATE SCHEMA " + schema); created = true;
    // No public fallback: even a mistaken service table name cannot mutate
    // canonical/public/source ledgers through this isolated connection.
    pool = new Pool({ connectionString, ssl: false, max: 4, connectionTimeoutMillis: 5000, options: "-c search_path=" + schema });
    await Rejected.ensure(pool); await Articles.ensure(pool); await Prices.ensure(pool); await Refresh.ensure(pool);
    await test("genuine PoolClient admission needs an actually assigned writing transaction", async () => {
      const tx = await pool.connect();
      try {
        assert.equal(typeof tx.connect, "function");
        const value = original("transaction-gate"), native = Navigation.parseNavigationParent(value.body, value.meta, { now: clock });
        assert.equal(native.priceRowsCreated, 0);
        const rejected = { status: 200, failureCode: "aldi-category-native-index-conflict", original: value, bytes: Buffer.byteLength(value.body) };
        await assert.rejects(Rejected.persist(pool, rejected, { now: clock }), /writing-client-required/);
        await assert.rejects(Rejected.persist(tx, rejected, { now: clock }), /writing-transaction-required/);
        await tx.query("BEGIN"); await assert.rejects(Rejected.persist(tx, rejected, { now: clock }), /writing-transaction-required/);
        await tx.query("SELECT txid_current()"); assert.equal((await tx.query("SELECT txid_current_if_assigned() IS NOT NULL AS assigned")).rows[0].assigned, true);
        await tx.query("ROLLBACK");
      } finally { tx.release(); }
      assert.equal((await digest(pool, Rejected.CAPTURE_TABLE)).count, 0); await noArticleOrPrice();
    });
    let successful;
    await test("actual Fetch navigation, private rejected original and child checkpoint commit atomically", async () => {
      const baseline = await prepare(), answer = await run(original("first committed parent")); assert.ifError(answer.error); successful = answer;
      assert.equal(answer.gates, 3); assert.equal(answer.result.requests, 1); assert.equal(answer.result.pages, 1); assert.equal(answer.result.navigationPages, 1);
      for (const key of ["received", "accepted", "identityReceived", "identityAccepted", "categoryRejected"]) assert.equal(answer.result[key], 0);
      assert.equal(answer.result.catalog.fullAssortment, false); assert.equal(answer.result.catalog.childDiscoveryComplete, false); assert.equal(answer.result.catalog.categoryTraversalFinished, false);
      const checked = await retained(answer), cursor = await currentCursor();
      assert.equal(cursor.nextIndex, baseline.nextIndex + 1); assert.equal(cursor.revision, baseline.revision + 1); assert.equal(cursor.completedPasses, 0);
      const expected = new Set([...baseline.targets, ...answer.observed.navigation.discoveredTargets]); assert.deepEqual(new Set(cursor.targets), expected);
      assert(!cursor.targets.includes("https://www.aldi-nord.de/sortiment/vorraete.html"), "Global header is not CHILDREN parent evidence");
      for (const target of cursor.targets.filter(target => !baseline.targets.includes(target))) {
        assert.deepEqual(cursor.targetProofs.find(proof => proof.target === target), { target, from: Fixture.parentUrl,
          sourceResponseHash: checked.sourceResponseHash, capturedAt: checked.capturedAt });
      }
      assert.equal((await digest(pool, Rejected.ORIGINAL_TABLE)).count, 1); assert.equal((await digest(pool, Rejected.CAPTURE_TABLE)).count, 1);
      const status = await Rejected.status(pool, { now: clock }); assert.equal(status.readableLatestUrls, 1); assert(!JSON.stringify(status).includes(answer.observed.original.body));
      await noArticleOrPrice();
    });
    await test("committed one-minute continuation deferral performs no GET or source-gate override", async () => {
      const cursor = await currentCursor(), before = await retainedSnapshot();
      const answer = await run(original("must not be fetched")); assert.ifError(answer.error); assert.equal(answer.result.skipped, "category-not-due");
      assert.equal(answer.requests.length, 0); assert.equal(answer.gates, 0); await unchangedFrontier(cursor); assert.deepEqual(await retainedSnapshot(), before);
    });
    await test("shared future source pause returns before the ordinary GET and preserves prior evidence", async () => {
      const cursor = await prepare(), before = await retainedSnapshot(), pause = iso(clock + 8 * 86400000);
      const answer = await run(original("source denied"), { gate: () => pause }); assert.ifError(answer.error);
      assert.equal(answer.result.skipped, "shared-source-not-eligible"); assert.equal(answer.result.nextAttemptAt, pause); assert.equal(answer.requests.length, 0);
      await unchangedFrontier(cursor); assert.deepEqual(await retainedSnapshot(), before);
    });
    await test("malformed local navigation retains genuine product rejection and never checkpoints children", async () => {
      const cursor = await prepare(), answer = await run(original("wrong native request parent", clock, native => {
        const entries = JSON.parse(native.props.pageProps.apiData); entries[0][1].req.categoryPath += "/foreign"; native.props.pageProps.apiData = JSON.stringify(entries);
      }));
      failed(answer, "aldi-category-native-index-conflict"); assert.equal(answer.error.failureCheckpointPersisted, true); await unchangedFrontier(cursor); await failurePause(answer.error.code);
      const rows = (await pool.query(`SELECT failure_code FROM ${Rejected.CAPTURE_TABLE} WHERE source_response_hash=$1`, [crypto.createHash("sha256").update(answer.error.rejectedCapture.original.body).digest("hex")])).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].failure_code, "aldi-category-native-index-conflict");
    });
    for (const [label, mutate] of [
      ["forged navigation targets", observed => { observed.navigation.discoveredTargets.push("https://www.aldi-nord.de/sortiment/foreign.html"); }],
      ["forged retained original binding", observed => { observed.rejectedCapture.original = clone(observed.original); observed.rejectedCapture.original.meta.sourceResponseHash = "0".repeat(64); }]
    ]) await test(label + " cannot write original evidence or advance the normal cursor", async () => {
      const cursor = await prepare(), before = await retainedSnapshot(), answer = await run(original(label), { mutateObserved: mutate });
      failed(answer, "aldi-category-navigation-result-unconfirmed"); await unchangedFrontier(cursor); assert.deepEqual(await retainedSnapshot(), before); await failurePause(answer.error.code);
    });
    await test("after-real-retention-write failure rolls back normal frontier then separately retains only the truthful diagnostic pause", async () => {
      const cursor = await prepare(), primary = Object.assign(Error("SYNTHETIC after actual original write"), { code: "synthetic-nav-after-write" }); let attempts = 0;
      const rejected = { ensure: Rejected.ensure, persist: async (...args) => { const saved = await Rejected.persist(...args); if (++attempts === 1) throw primary; return saved; } };
      const answer = await run(original("after-write rollback"), { rejected }); assert.equal(answer.error, primary); failed(answer, primary.code);
      assert.equal(attempts, 2); assert.equal(answer.error.failureCheckpointPersisted, true); await retained(answer); await unchangedFrontier(cursor); await failurePause(primary.code);
    });
    await test("actual SQL checkpoint trigger rejects normal advancement while fallback commits only original and pause", async () => {
      const cursor = await prepare();
      await pool.query(`CREATE FUNCTION nav_checkpoint_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.cursor IS DISTINCT FROM OLD.cursor THEN RAISE EXCEPTION 'SYNTHETIC nav checkpoint failure' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER nav_checkpoint_reject BEFORE UPDATE ON ${Refresh.TABLE} FOR EACH ROW EXECUTE FUNCTION nav_checkpoint_reject();`);
      try {
        const answer = await run(original("real checkpoint trigger")); failed(answer, "P0001"); assert.equal(answer.error.failureCheckpointPersisted, true);
        await retained(answer); await unchangedFrontier(cursor); await failurePause("P0001");
      } finally { await pool.query(`DROP TRIGGER nav_checkpoint_reject ON ${Refresh.TABLE}; DROP FUNCTION nav_checkpoint_reject();`); }
    });
    await test("actual blocked failure checkpoint rolls retained original back and never claims a saved pause", async () => {
      const cursor = await prepare(), before = await retainedSnapshot(), primary = Object.assign(Error("SYNTHETIC primary before fallback checkpoint"), { code: "synthetic-nav-failure-checkpoint" });
      let attempts = 0;
      const rejected = { ensure: Rejected.ensure, persist: async (...args) => { const saved = await Rejected.persist(...args); if (++attempts === 1) throw primary; return saved; } };
      await pool.query(`CREATE FUNCTION nav_failure_checkpoint_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.last_error IS NOT NULL THEN RAISE EXCEPTION 'SYNTHETIC blocked error checkpoint' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER nav_failure_checkpoint_reject BEFORE INSERT OR UPDATE ON ${Refresh.TABLE} FOR EACH ROW EXECUTE FUNCTION nav_failure_checkpoint_reject();`);
      try {
        const answer = await run(original("blocked failure checkpoint"), { rejected }); assert.equal(answer.error, primary); failed(answer, primary.code);
        assert.equal(answer.error.failureCheckpointPersisted, false); assert.equal(answer.error.failurePersistenceErrorCode, "P0001"); assert.equal(answer.error.retentionErrorCode, "P0001");
        assert.deepEqual(await retainedSnapshot(), before); await unchangedFrontier(cursor);
        const raw = await Refresh.load(pool); assert.equal(raw.retryAfter, null); assert.equal(raw.lastError, null);
      } finally { await pool.query(`DROP TRIGGER nav_failure_checkpoint_reject ON ${Refresh.TABLE}; DROP FUNCTION nav_failure_checkpoint_reject();`); }
    });
    await test("actual independently moved SQL checkpoint revision survives failed navigation CAS", async () => {
      const baseline = await prepare(), concurrent = { ...clone(baseline), revision: baseline.revision + 1 }; let moved = false;
      const answer = await run(original("real CAS conflict"), { checkpoint: async (tx, next, expected) => {
        await pool.query(`UPDATE ${Refresh.TABLE} SET cursor=$2::jsonb WHERE source_id=$1`, [Refresh.SOURCE, JSON.stringify(concurrent)]); moved = true;
        await Refresh.checkpoint(tx, next, expected);
      } });
      assert(moved); failed(answer, "aldi-category-checkpoint-moved"); await retained(answer); await unchangedFrontier(concurrent); await failurePause(answer.error.code);
    });
    await test("actual deferred COMMIT constraint rolls normal navigation back without losing private rejection evidence", async () => {
      const cursor = await prepare();
      await pool.query(`CREATE FUNCTION nav_commit_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (NEW.cursor->>'nextIndex')::int>1 THEN RAISE EXCEPTION 'SYNTHETIC deferred navigation commit' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
        CREATE CONSTRAINT TRIGGER nav_commit_reject AFTER UPDATE ON ${Refresh.TABLE} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nav_commit_reject();`);
      const traced = faultPool();
      try {
        const answer = await run(original("real deferred COMMIT"), { pool: traced.pool }); failed(answer, "23514");
        assert(traced.events.some(event => event.sql === "COMMIT")); assert(traced.events.some(event => event.sql === "ROLLBACK"));
        assert.equal(answer.error.failureCheckpointPersisted, true); await retained(answer); await unchangedFrontier(cursor); await failurePause("23514");
      } finally { await pool.query(`DROP TRIGGER nav_commit_reject ON ${Refresh.TABLE}; DROP FUNCTION nav_commit_reject();`); }
    });
    await test("actual blocked original INSERT leaves no new body/history and saves pause without frontier", async () => {
      const cursor = await prepare(), value = original("real original INSERT reject"), bodyHash = value.meta.sourceResponseHash, before = await retainedSnapshot();
      assert(/^[a-f0-9]{64}$/.test(bodyHash));
      await pool.query(`CREATE FUNCTION nav_original_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_response_hash='${bodyHash}' THEN RAISE EXCEPTION 'SYNTHETIC original INSERT failure' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER nav_original_reject BEFORE INSERT ON ${Rejected.ORIGINAL_TABLE} FOR EACH ROW EXECUTE FUNCTION nav_original_reject();`);
      try {
        const answer = await run(value); failed(answer, "P0001"); assert.equal(answer.error.retentionErrorCode, "P0001"); assert.equal(answer.error.failureCheckpointPersisted, true);
        await unchangedFrontier(cursor); assert.deepEqual(await retainedSnapshot(), before); await failurePause("P0001");
      } finally { await pool.query(`DROP TRIGGER nav_original_reject ON ${Rejected.ORIGINAL_TABLE}; DROP FUNCTION nav_original_reject();`); }
      const blocked = await Refresh.load(pool); clock = new Date(blocked.retryAfter).getTime() + 1;
      const genuineNewResponse = { body: value.body, meta: { ...value.meta, capturedAt: iso(clock), sourceResponseDate: iso(clock) } };
      const retry = await run(genuineNewResponse); assert.ifError(retry.error); assert.equal(retry.result.navigationPages, 1); await retained(retry); await noArticleOrPrice();
    });
    await test("same-clock contradictory original becomes held through fallback and cannot advance navigation", async () => {
      const cursor = await prepare(), first = original("same-clock held A"), second = original("same-clock held B");
      const observedFirst = await Fetch.fetchPage(Fixture.parentUrl, { now: () => clock, fetchImpl: async () => transport(first, clock) });
      await transaction(tx => Rejected.persist(tx, observedFirst.rejectedCapture, { now: clock }));
      const answer = await run(second); failed(answer, "aldi-category-navigation-original-unconfirmed"); await retained(answer); await unchangedFrontier(cursor);
      const latest = (await pool.query(`SELECT held,conflict_capture_hash FROM ${Rejected.TABLE} WHERE source_id=$1 AND source_response_url=$2`, [Rejected.SOURCE, Fixture.parentUrl])).rows[0];
      assert.equal(latest.held, true); assert(latest.conflict_capture_hash);
      const status = await Rejected.status(pool, { now: clock }); assert.equal(status.heldUrls, 1); assert.equal(status.readableLatestUrls, 0);
      const before = await retainedSnapshot(), paused = await run(second); assert.ifError(paused.error); assert.equal(paused.result.skipped, "category-not-due");
      assert.equal(paused.requests.length, 0); assert.deepEqual(await retainedSnapshot(), before);
      const raw = await Refresh.load(pool); clock = new Date(raw.retryAfter).getTime() + 1;
      const fresh = await run(original("genuinely newer resolves held")); assert.ifError(fresh.error); assert.equal(fresh.result.navigationPages, 1); await retained(fresh);
      assert.equal((await pool.query(`SELECT held FROM ${Rejected.TABLE} WHERE source_id=$1 AND source_response_url=$2`, [Rejected.SOURCE, Fixture.parentUrl])).rows[0].held, false);
      await noArticleOrPrice();
    });
    await test("old original Date/hash cannot be retimed into a new navigation checkpoint", async () => {
      const cursor = await prepare(), value = original("retime-protected body"), first = await run(value); assert.ifError(first.error); await retained(first);
      // Revisit the parent in this isolated fixture without modifying its old
      // original. Admission must reject a later receive clock with old Date/Age.
      await pool.query(`UPDATE ${Refresh.TABLE} SET cursor=$2::jsonb,last_error=NULL,retry_after=NULL WHERE source_id=$1`, [Refresh.SOURCE, JSON.stringify(cursor)]);
      const before = await retainedSnapshot(); clock += 2000;
      const retimed = await run(value); failed(retimed, "aldi-rejected-retimed-original-forbidden"); await unchangedFrontier(cursor);
      assert.deepEqual(await retainedSnapshot(), before); assert.equal(retimed.error.retentionErrorCode, "aldi-rejected-retimed-original-forbidden");
    });
    await test("genuine new Date and capture may reuse identical original bytes without rewriting prior capture", async () => {
      const cursor = await prepare(), value = original("same bytes genuine HTTP revalidation"), first = await run(value); assert.ifError(first.error);
      const old = await retained(first), oldRows = (await pool.query(`SELECT * FROM ${Rejected.CAPTURE_TABLE} WHERE capture_hash=$1`, [old.captureHash])).rows;
      await pool.query(`UPDATE ${Refresh.TABLE} SET cursor=$2::jsonb,last_error=NULL,retry_after=NULL WHERE source_id=$1`, [Refresh.SOURCE, JSON.stringify(cursor)]);
      clock += 2000; const fresh = { body: value.body, meta: { ...value.meta, capturedAt: iso(clock), sourceResponseDate: iso(clock) } }, next = await run(fresh);
      assert.ifError(next.error); const newCapture = await retained(next); assert.notEqual(newCapture.captureHash, old.captureHash); assert.equal(newCapture.sourceResponseHash, old.sourceResponseHash);
      assert.deepEqual((await pool.query(`SELECT * FROM ${Rejected.CAPTURE_TABLE} WHERE capture_hash=$1`, [old.captureHash])).rows, oldRows); await noArticleOrPrice();
    });
    await test("gate loss after actual checkpoint rolls it back and preserves an eight-day source pause", async () => {
      const cursor = await prepare(), pause = clock + 8 * 86400000;
      const answer = await run(original("late final source gate"), { gate: call => call === 3 ? iso(pause) : true });
      failed(answer, "aldi-category-navigation-shared-source-not-eligible"); assert.equal(answer.gates, 3); await retained(answer); await unchangedFrontier(cursor); await failurePause(answer.error.code, pause);
    });
    await test("freshness expiring after actual checkpoint rejects COMMIT and retains no stale body", async () => {
      const cursor = await prepare(), before = await retainedSnapshot();
      const answer = await run(original("late capture expiry"), { checkpoint: async (...args) => { await Refresh.checkpoint(...args); clock += 300001; } });
      failed(answer, "aldi-rejected-original-proof-required"); assert.equal(answer.gates, 3); assert.equal(answer.error.retentionErrorCode, answer.error.code);
      await unchangedFrontier(cursor); assert.deepEqual(await retainedSnapshot(), before); await failurePause(answer.error.code);
    });
    await test("actual completed ROLLBACK then connection failure evicts broken PoolClient without masking primary error", async () => {
      const cursor = await prepare(), primary = Object.assign(Error("SYNTHETIC nav persist after real write"), { code: "synthetic-nav-primary" }), broken = Error("SYNTHETIC connection broken after actual rollback");
      let persistCalls = 0, rolledBack = false;
      const traced = faultPool(async sql => { if (sql === "ROLLBACK" && !rolledBack) { rolledBack = true; throw broken; } });
      const rejected = { ensure: Rejected.ensure, persist: async (...args) => { const saved = await Rejected.persist(...args); if (++persistCalls === 1) throw primary; return saved; } };
      const answer = await run(original("real rollback eviction"), { pool: traced.pool, rejected }); assert.equal(answer.error, primary); failed(answer, primary.code);
      assert(rolledBack); assert(traced.events.some(event => event.release && event.error === broken)); assert.equal(persistCalls, 2);
      await retained(answer); await unchangedFrontier(cursor); assert.equal(answer.error.failureCheckpointPersisted, true);
    });
    for (const status of [403, 429]) await test("actual transport HTTP" + status + " preserves long Retry-After and creates no navigation original", async () => {
      const cursor = await prepare(), before = await retainedSnapshot(), answer = await run(original("native denial " + status), { response: { status, headers: { "retry-after": "691200" } } });
      failed(answer, "aldi-category-http-" + status); assert.equal(answer.error.rejectedCapture, undefined); await unchangedFrontier(cursor);
      assert.deepEqual(await retainedSnapshot(), before); await failurePause(answer.error.code, clock + 8 * 86400000);
    });
    await test("public source/core ledgers stay untouched and isolated navigation status never claims products or completeness", async () => {
      const status = await Refresh.status(pool, clock); assert.equal(status.fullAssortment, false); assert.equal(status.normalPriceClassificationVerified, false);
      assert.equal(status.locationScope, "unknown"); await noArticleOrPrice(); assert(successful.result.navigationPages === 1);
      await pool.end(); pool = null; await admin.query("DROP SCHEMA " + schema + " CASCADE"); created = false;
      for (const table of untouched) assert.deepEqual(await publicSnapshot(table), beforePublic[table], "Public table unchanged: " + table);
    });
    console.log(`aldi-category-navigation-postgres: ${groups} actual PostgreSQL 18 groups passed; real assigned PoolClient, original retention/navigation checkpoint, actual SQL failure/COMMIT/hold/gate/rollback/eviction, no article/price admission or merchant HTTP`);
  } finally {
    if (pool) await pool.end(); if (created) await admin.query("DROP SCHEMA " + schema + " CASCADE"); await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
