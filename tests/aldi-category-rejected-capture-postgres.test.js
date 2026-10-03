"use strict";
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const Store = require("../aldi-category-rejected-capture-store"), Parser = require("../aldi-assortment-category-client"), Refresh = require("../aldi-category-refresh");
const Fixture = require("./fixtures/aldi-category-capture");
const clone = structuredClone;

// New, explicitly synthetic originals built from the archived native shape.
// No old body/header/capture is moved to today and no merchant request runs.
function capture(at, tag, url = Fixture.url) {
  let body = Fixture.html();
  const script = /(<script\b[^>]*id="__NEXT_DATA__"[^>]*>)([\s\S]*?)(<\/script>)/.exec(body);
  const native = JSON.parse(script[2]), path = new URL(url).pathname.replace(/\.html$/, "");
  native.syntheticSQLDiagnosticFixture = tag;
  native.query.categories = path.slice("/sortiment/".length).split("/");
  native.props.pageProps.page["@path"] = "/germany" + path;
  native.props.pageProps.page.categoryKey = native.query.categories.at(-1);
  delete native.props.pageProps.algoliaState;
  body = body.replace(script[0], script[1] + JSON.stringify(native) + script[3]).replace(Fixture.url, url);
  const original = Fixture.original(body, at); original.meta.sourceResponseUrl = url;
  return { status: 200, failureCode: "aldi-category-native-index-conflict", original, bytes: Buffer.byteLength(body) };
}
function failure(value) {
  const error = Object.assign(new Error(value.failureCode), { code: value.failureCode });
  Object.defineProperty(error, "rejectedCapture", { value, enumerable: false });
  return error;
}
function offlineFixtureCheck() {
  const now = Date.parse("2026-10-03T05:30:00.123Z"), first = capture(now - 1000, "NEW SYNTHETIC SQL original"), before = clone(first);
  assert.throws(() => Parser.parsePage(first.original.body, first.original.meta, { now }), e => e.code === first.failureCode);
  const admitted = Store.validateCapture(first, { now });
  assert.equal(admitted.sourceResponseHash, Store.hash(first.original.body));
  assert.equal(admitted.bytes, Buffer.byteLength(first.original.body));
  const dated = Store.diagnosticSummary(first, { now: now + 30 * 86400000 });
  assert.equal(dated.capturedAt, first.original.meta.capturedAt);
  for (const key of ["current", "fresh", "admitted", "truthEligible", "physicalStorePriceVerified", "assortmentComplete"]) assert.equal(dated[key], false);
  assert(!Object.hasOwn(dated, "body")); assert(!Object.hasOwn(dated, "original"));
  assert.equal(JSON.stringify(failure(first)).includes(first.original.body), false);
  assert.deepEqual(first, before);
  console.log("aldi-category-rejected-capture-postgres: offline synthetic exact parser failure, immutable proof, dated private diagnostic and nonenumerable handler fixture passed; no DB or HTTP");
}

async function main() {
  if (process.argv.includes("--offline-fixture-check")) { offlineFixtureCheck(); return; }
  const { Pool } = require("pg"), connectionString = process.env.DATABASE_URL;
  assert(connectionString, "DATABASE_URL is required");
  const database = new URL(connectionString);
  assert(["localhost", "127.0.0.1"].includes(database.hostname) && !database.search && !database.hash && /^\/[a-z][a-z0-9_]*_test$/.test(database.pathname), "Only a dedicated named loopback *_test database is allowed");
  const admin = new Pool({ connectionString, ssl: false, connectionTimeoutMillis: 5000 });
  const schema = "aldi_rejected_sql_test_" + crypto.randomBytes(8).toString("hex");
  assert(/^aldi_rejected_sql_test_[a-f0-9]{16}$/.test(schema));
  let pool, tx, created = false, groups = 0;
  const now = Date.now(), at = now - 10000;
  const tables = [Store.ORIGINAL_TABLE, Store.CAPTURE_TABLE, Store.TABLE];
  const untouched = ["products", "stores", "merchants", "external_product_mappings", "external_store_mappings", "price_observations", "receipts", "receipt_submissions", "aldi_assortment_published_prices", "aldi_assortment_articles", "aldi_category_articles", "aldi_category_captures", "aldi_category_published_prices", Refresh.TABLE, "price_source_refresh_state", ...tables];
  async function publicSnapshot(table) {
    if (!(await admin.query("SELECT to_regclass($1) AS name", ["public." + table])).rows[0].name) return null;
    return (await admin.query(`SELECT count(*)::int AS count,md5(COALESCE(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text),'')) AS hash FROM public.${table} t`)).rows[0];
  }
  async function snapshot(client = pool, extra = []) {
    const values = {};
    for (const table of [...tables, ...extra]) values[table] = (await client.query(`SELECT count(*)::int AS count,md5(COALESCE(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text),'')) AS hash FROM ${table} t`)).rows[0];
    return values;
  }
  async function transaction(operation) {
    const client = await pool.connect();
    try { await client.query("BEGIN"); await client.query("SELECT txid_current()"); const result = await operation(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async function sqlReject(client, sql, params, code, constraint) {
    await client.query("SAVEPOINT rejected_constraint"); let thrown;
    try { await client.query(sql, params); } catch (error) { thrown = error; }
    await client.query("ROLLBACK TO SAVEPOINT rejected_constraint"); await client.query("RELEASE SAVEPOINT rejected_constraint");
    assert(thrown, "Actual SQL must reject the unsafe fixture"); assert.equal(thrown.code, code); if (constraint) assert.equal(thrown.constraint, constraint);
  }
  async function test(name, operation) { try { await operation(); groups++; } catch (error) { console.error("Failed: " + name); throw error; } }
  const beforePublic = {};
  try {
    assert.equal(Math.floor(Number((await admin.query("SHOW server_version_num")).rows[0].server_version_num) / 10000), 18, "Actual PostgreSQL 18 is required");
    for (const table of untouched) beforePublic[table] = await publicSnapshot(table);
    await admin.query("CREATE SCHEMA " + schema); created = true;
    pool = new Pool({ connectionString, ssl: false, connectionTimeoutMillis: 5000, options: "-c search_path=" + schema + ",public" });
    await Store.ensure(pool); await Refresh.ensure(pool);
    tx = await pool.connect();

    await test("genuine inherited PoolClient requires assigned writing transaction", async () => {
      assert.equal(typeof tx.connect, "function");
      await assert.rejects(Store.persist(tx, capture(at, "assigned-gate"), { now }), /writing-transaction-required/);
      await assert.rejects(Store.persist(pool, capture(at, "pool-is-not-client"), { now }), /writing-client-required/);
      await tx.query("BEGIN"); await tx.query("SELECT txid_current()");
      assert.equal((await tx.query("SELECT txid_current_if_assigned() IS NOT NULL AS assigned")).rows[0].assigned, true);
      await tx.query("ROLLBACK");
    });
    const first = capture(at, "NEW SYNTHETIC first"), firstHash = Store.validateCapture(first, { now }).captureHash;
    await test("real commit writes original capture and latest only, and exact replay is immutable", async () => {
      assert.equal((await transaction(client => Store.persist(client, first, { now }))).storedCaptures, 1);
      const saved = await snapshot();
      const replay = await transaction(client => Store.persist(client, first, { now }));
      assert.equal(replay.storedCaptures, 0); assert.equal(replay.latestUpdated, 0);
      assert.deepEqual(await snapshot(), saved);
      const status = await Store.status(pool, { now }); assert.equal(status.readableLatestUrls, 1); assert.equal(status.diagnostics[0].captureHash, firstHash);
      assert.equal(status.truthEligible, false); assert.equal(status.priceRowsCreated, 0);
    });
    await test("same Date hash and Age cannot be retimed while a new Date can reuse original bytes", async () => {
      const retimed = clone(first); retimed.original.meta.capturedAt = new Date(at + 1000).toISOString();
      const baseline = await snapshot(); await assert.rejects(transaction(client => Store.persist(client, retimed, { now })), /retimed-original-forbidden/);
      assert.deepEqual(await snapshot(), baseline);
      const genuineNew = clone(first); genuineNew.original.meta.capturedAt = genuineNew.original.meta.sourceResponseDate = new Date(at + 1000).toISOString();
      assert.equal((await transaction(client => Store.persist(client, genuineNew, { now }))).latestUpdated, 1);
      const counts = await snapshot(); assert.equal(counts[Store.ORIGINAL_TABLE].count, 1); assert.equal(counts[Store.CAPTURE_TABLE].count, 2);
    });
    await test("same-clock contradictory original holds latest; old replay cannot clear it", async () => {
      const conflict = capture(at + 1000, "NEW SYNTHETIC contradiction");
      assert.equal((await transaction(client => Store.persist(client, conflict, { now }))).held, true);
      await transaction(client => Store.persist(client, first, { now }));
      const held = await Store.status(pool, { now }); assert.equal(held.heldUrls, 1); assert.equal(held.diagnostics.length, 0);
      const future = capture(at + 2000, "NEW SYNTHETIC independently newer response");
      await transaction(client => Store.persist(client, future, { now }));
      assert.equal((await Store.status(pool, { now })).readableLatestUrls, 1);
    });
    await test("dated diagnostics preserve original metadata and raw body never enters DTO", async () => {
      const status = await Store.status(pool, { now: now + 30 * 86400000 }), value = status.diagnostics[0];
      assert.equal(value.capturedAt, new Date(at + 2000).toISOString()); assert.equal(value.current, false); assert.equal(value.fresh, false);
      assert(!Object.hasOwn(value, "body")); assert(!Object.hasOwn(value, "original")); assert.equal(value.availability, "unknown");
    });
    await test("actual SQL enforces original checksum UTF8 bytes capture FK source URL and status", async () => {
      await tx.query("BEGIN"); await tx.query("SELECT txid_current()");
      // PostgreSQL may shorten generated identifiers to 63 bytes. Bind the
      // exact real FK through its columns and target, not a guessed long name.
      const originalFks = (await tx.query("SELECT c.conname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='source_response_hash' WHERE c.contype='f' AND c.conrelid=$1::regclass AND c.confrelid=$2::regclass AND c.conkey=ARRAY[a.attnum]", [Store.CAPTURE_TABLE, Store.ORIGINAL_TABLE])).rows;
      assert.equal(originalFks.length, 1);
      await sqlReject(tx, `INSERT INTO ${Store.ORIGINAL_TABLE} VALUES($1,$2,$3)`, ["BAD", "test", 4], "23514");
      await sqlReject(tx, `INSERT INTO ${Store.ORIGINAL_TABLE} VALUES($1,$2,$3)`, ["0".repeat(64), "test", 4], "23514");
      await sqlReject(tx, `UPDATE ${Store.ORIGINAL_TABLE} SET body_bytes=body_bytes+1`, [], "23514");
      await sqlReject(tx, `UPDATE ${Store.CAPTURE_TABLE} SET source_response_hash=$1 WHERE capture_hash=$2`, ["0".repeat(64), firstHash], "23503", originalFks[0].conname);
      await sqlReject(tx, `UPDATE ${Store.CAPTURE_TABLE} SET source_age_seconds=301 WHERE capture_hash=$1`, [firstHash], "23514");
      await sqlReject(tx, `UPDATE ${Store.CAPTURE_TABLE} SET http_status=403 WHERE capture_hash=$1`, [firstHash], "23514");
      await sqlReject(tx, `UPDATE ${Store.CAPTURE_TABLE} SET source_id='unsupported-source' WHERE capture_hash=$1`, [firstHash], "23514");
      await sqlReject(tx, `UPDATE ${Store.TABLE} SET source_response_url=$1`, ["https://www.aldi-nord.de/sortiment/unknown.html"], "23503");
      await tx.query("ROLLBACK");
    });
    await test("full original and history rollback atomically on caller checkpoint failure", async () => {
      const baseline = await snapshot(), value = capture(at + 3000, "NEW SYNTHETIC rollback original");
      await assert.rejects(transaction(async client => { await Store.persist(client, value, { now }); await client.query("SELECT 1/0"); }), e => e.code === "22012");
      assert.deepEqual(await snapshot(), baseline);
      assert.equal((await transaction(client => Store.persist(client, value, { now }))).storedCaptures, 1);
    });
    await test("reader independently excludes SQL-mutated original metadata without older fallback", async () => {
      await tx.query("BEGIN"); await tx.query("SELECT txid_current()");
      const current = (await tx.query(`SELECT capture_hash FROM ${Store.TABLE}`)).rows[0].capture_hash;
      await tx.query(`UPDATE ${Store.CAPTURE_TABLE} SET captured_at=captured_at+interval '1 second',source_response_date=source_response_date+interval '1 second' WHERE capture_hash=$1`, [current]);
      const invalid = await Store.status(tx, { now }); assert.equal(invalid.excludedInvalidLatest, 1); assert.equal(invalid.readableLatestUrls, 0);
      await tx.query("ROLLBACK"); assert.equal((await Store.status(pool, { now })).readableLatestUrls, 1);
    });

    // Actual production handler, genuine Pool and commits. Dependencies only
    // replace HTTP and unused successful article/price admission with pure fakes.
    const handlerUrl = "https://www.aldi-nord.de/sortiment/alkoholische-getraenke.html";
    const cursor = Refresh.state(); cursor.targets.push(handlerUrl); cursor.nextIndex = 1; cursor.revision = 7;
    cursor.targetProofs.push({ target: handlerUrl, from: cursor.targets[0], sourceResponseHash: first.original.meta.sourceResponseHash, capturedAt: first.original.meta.capturedAt });
    cursor.lastRunAt = new Date(at - 120000).toISOString();
    await pool.query(`INSERT INTO ${Refresh.TABLE}(source_id,cursor,updated_at) VALUES($1,$2::jsonb,$3)`, [Refresh.SOURCE, JSON.stringify(cursor), new Date(at - 120000).toISOString()]);
    const unused = { ensure: async () => {}, persist: async () => assert.fail("Rejected page cannot admit articles or prices") };
    let fetches = 0;
    async function runRejected(value, rejected = Store) {
      const error = failure(value); let caught;
      try { await Refresh.refresh({ pool, maxRequests: 1, now: () => now }, { canFetch: async () => true, fetchPage: async target => { fetches++; assert.equal(target, handlerUrl); throw error; }, articles: unused, prices: unused, rejected }); }
      catch (actual) { caught = actual; }
      assert.equal(caught, error, "The original parser error survives retention errors"); assert.equal(caught.requests, 1); assert.equal(caught.pages, 0);
      assert.equal(caught.nextAttemptAt, new Date(now + 3600000).toISOString()); return caught;
    }
    async function clearTestPause() {
      // Isolated fixture preparation only, never a production/source-gate bypass.
      await pool.query(`UPDATE ${Refresh.TABLE} SET retry_after=NULL,last_error=NULL WHERE source_id=$1`, [Refresh.SOURCE]);
    }
    async function unchangedFrontier() { assert.deepEqual((await pool.query(`SELECT cursor FROM ${Refresh.TABLE} WHERE source_id=$1`, [Refresh.SOURCE])).rows[0].cursor, cursor); }
    await test("actual Refresh commits rejected capture and durable pause together without cursor advance", async () => {
      const caught = await runRejected(capture(at + 4000, "NEW SYNTHETIC handler rejected original", handlerUrl));
      assert.equal(caught.failureCheckpointPersisted, true); assert.equal(caught.retentionErrorCode, undefined); await unchangedFrontier();
      const state = await Refresh.load(pool); assert.equal(state.lastError, "aldi-category-native-index-conflict"); assert.equal(new Date(state.retryAfter).getTime(), now + 3600000);
      const diagnostic = (await Store.status(pool, { now })).diagnostics.find(x => x.sourceResponseUrl === handlerUrl); assert(diagnostic); assert.equal(diagnostic.current, false);
    });
    await test("a persisted pause blocks fetching and retains capture/frontier exactly", async () => {
      const baseline = await snapshot(pool, [Refresh.TABLE]), previousFetches = fetches;
      const answer = await Refresh.refresh({ pool, maxRequests: 1, now: () => now }, { canFetch: async () => assert.fail("Paused source cannot reach gate"), fetchPage: async () => assert.fail("Paused source cannot fetch") });
      assert.equal(answer.skipped, "category-not-due"); assert.equal(fetches, previousFetches); assert.deepEqual(await snapshot(pool, [Refresh.TABLE]), baseline);
    });
    await test("retention failure after actual writes rolls back all captures and preserves durable pause", async () => {
      await clearTestPause(); const baseline = await snapshot();
      const rejected = { ensure: Store.ensure, persist: async (...args) => { await Store.persist(...args); throw Object.assign(new Error("SYNTHETIC after original write"), { code: "synthetic-retention-write-failure" }); } };
      const caught = await runRejected(capture(at + 5000, "NEW SYNTHETIC handler rollback", handlerUrl), rejected);
      assert.equal(caught.retentionErrorCode, "synthetic-retention-write-failure"); assert.equal(caught.failureCheckpointPersisted, true);
      assert.deepEqual(await snapshot(), baseline); await unchangedFrontier();
    });
    await test("actual SQL checkpoint trigger failure rolls back capture and fallback still saves original pause", async () => {
      await clearTestPause(); const value = capture(at + 6000, "NEW SYNTHETIC SQL checkpoint failure", handlerUrl), checked = Store.validateCapture(value, { now }), baseline = await snapshot();
      await pool.query(`CREATE FUNCTION reject_test_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM ${Store.CAPTURE_TABLE} WHERE capture_hash='${checked.captureHash}') THEN RAISE EXCEPTION 'SYNTHETIC checkpoint failure' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_test_checkpoint BEFORE INSERT OR UPDATE ON ${Refresh.TABLE} FOR EACH ROW EXECUTE FUNCTION reject_test_checkpoint();`);
      try { const caught = await runRejected(value); assert.equal(caught.retentionErrorCode, "P0001"); assert.equal(caught.failureCheckpointPersisted, true); assert.deepEqual(await snapshot(), baseline); await unchangedFrontier(); }
      finally { await pool.query(`DROP TRIGGER reject_test_checkpoint ON ${Refresh.TABLE}; DROP FUNCTION reject_test_checkpoint();`); }
    });
    await test("same genuine failed capture retries after rolled-back SQL write with no lost checkpoint", async () => {
      await clearTestPause(); const value = capture(at + 6000, "NEW SYNTHETIC SQL checkpoint failure", handlerUrl);
      const before = await snapshot(), caught = await runRejected(value); assert.equal(caught.retentionErrorCode, undefined);
      const after = await snapshot(); assert.equal(after[Store.CAPTURE_TABLE].count, before[Store.CAPTURE_TABLE].count + 1); assert.equal(after[Store.ORIGINAL_TABLE].count, before[Store.ORIGINAL_TABLE].count + 1); await unchangedFrontier();
    });
    await test("global denial receives no rejected capture and cannot change private originals", async () => {
      await clearTestPause(); const before = await snapshot(), error = Object.assign(new Error("SYNTHETIC HTTP403"), { code: "aldi-category-source-denied" });
      await assert.rejects(Refresh.refresh({ pool, maxRequests: 1, now: () => now }, { canFetch: async () => true, fetchPage: async () => { throw error; }, articles: unused, prices: unused }), actual => actual === error);
      assert.deepEqual(await snapshot(), before); assert.equal(error.failureCheckpointPersisted, true); await unchangedFrontier();
    });
    await test("many malformed URL originals share one real UTF8 body without joined body expansion", async () => {
      const body = "<!doctype html><p>NEW SYNTHETIC SQL missing canonical: Grüße</p>", bodyHash = Store.hash(body), before = await snapshot();
      for (let index=0;index<12;index++) {
        const original = Fixture.original(body,at); original.meta.sourceResponseUrl = "https://www.aldi-nord.de/sortiment/synthetic-shared-"+index+".html";
        await transaction(client=>Store.persist(client,{status:200,failureCode:"aldi-category-canonical-required",original},{now}));
      }
      const after = await snapshot(); assert.equal(after[Store.ORIGINAL_TABLE].count,before[Store.ORIGINAL_TABLE].count+1);
      const stored = (await pool.query(`SELECT body,body_bytes FROM ${Store.ORIGINAL_TABLE} WHERE source_response_hash=$1`,[bodyHash])).rows[0];
      assert.equal(stored.body,body); assert.equal(stored.body_bytes,Buffer.byteLength(body));
      const status = await Store.status(pool,{now}); assert.equal(status.diagnostics.filter(value=>value.sourceResponseHash===bodyHash).length,12);
      assert(!JSON.stringify(status).includes(body));
    });
    await test("capture count budget is fail closed through actual SQL and leaves all prior rows intact", async () => {
      await tx.query("BEGIN"); await tx.query("SELECT txid_current()"); const baseline = await snapshot(tx);
      // Extra historical rows are explicitly isolated SQL-fixture data. The
      // reader will never admit these synthetic hashes as actual captures.
      await tx.query(`INSERT INTO ${Store.CAPTURE_TABLE}(capture_hash,source_id,source_response_url,http_status,failure_code,source_response_hash,captured_at,source_response_date,original_response_date,source_age_seconds) SELECT encode(sha256(convert_to('SYNTHETIC BOUND '||g::text,'UTF8')),'hex'),source_id,source_response_url,http_status,failure_code,source_response_hash,captured_at,source_response_date,original_response_date,source_age_seconds FROM ${Store.CAPTURE_TABLE} CROSS JOIN generate_series(1,$1) AS g WHERE capture_hash=$2`, [Store.MAX_CAPTURES - baseline[Store.CAPTURE_TABLE].count, firstHash]);
      await assert.rejects(Store.persist(tx, capture(at + 7000, "NEW SYNTHETIC exceeds retained bound"), { now }), /storage-bound-exceeded/);
      await tx.query("ROLLBACK"); assert.deepEqual(await snapshot(), baseline);
    });
    tx.release(); tx = null; await pool.end(); pool = null;
    await admin.query("DROP SCHEMA " + schema + " CASCADE"); created = false;
    for (const table of untouched) assert.deepEqual(await publicSnapshot(table), beforePublic[table], "Public source/core table is unchanged: " + table);
    console.log(`aldi-category-rejected-capture-postgres: ${groups} actual PostgreSQL 18 groups passed; real assigned PoolClient, checks/FK/latest/replay/hold, actual Refresh atomic diagnostics/pause/rollback/retry, no merchant HTTP`);
  } finally {
    if (tx) { try { await tx.query("ROLLBACK"); } finally { tx.release(); } }
    if (pool) await pool.end();
    if (created) await admin.query("DROP SCHEMA " + schema + " CASCADE");
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
