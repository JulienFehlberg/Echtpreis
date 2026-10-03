"use strict";
const assert = require("node:assert/strict");
const Refresh = require("../kaufland-berlin-publication-refresh"), Publications = require("../kaufland-berlin-publications");
const time = Date.parse("2026-10-03T06:00:00.000Z"), copy = value => structuredClone(value);
// Explicitly synthetic original HTML/JSON and HTTP clocks, never archive retiming.
function nativeBodies(price = "2.99") {
  return { branch: `<!doctype html><html><head><script class="o-special-offers-controller__settings" type="application/json">{"settings":{"apiUrl":"/.kloffers.storeName={storeName}.json"}}</script></head><body>
    <div data-force-store-change="DE1980"><h1 itemprop="name" content="Kaufland Berlin-Reinickendorf">Kaufland Berlin-Reinickendorf</h1>
    <span itemprop="url" content="/service/filiale.storeName=DE1980.html"></span><div itemprop="streetAddress" content="Ollenhauerstraße 122">Ollenhauerstraße 122</div>
    <span itemprop="addressLocality" content="Berlin"></span><span itemprop="postalCode" content="13403"></span></div>
    <div class="t-tiles-slider"><h3>Unsere Knüller der Woche</h3><h3>Gültig vom 01.10.2026 bis 07.10.2026</h3><div class="o-slider__list">
    <a class="k-product-tile k-product-tile--slider" href="/angebote/uebersicht.html?kloffer-category=135_Foodknueller&amp;kloffer-articleID=90000001">
    <div class="k-product-tile__title">TEST Gouda</div><div class="k-product-tile__subtitle">synthetic original</div><div class="k-product-tile__unit-price">je 450-g-Stück</div>
    <div class="k-product-tile__base-price">(1 kg = 6.65)</div><div class="k-product-tile__pricetags-normal"><div class="k-price-tag"><div class="k-price-tag__price">${price}</div></div></div></a>
    </div></div></body></html>`, index: '[{"dateFrom":"2026-10-01","dateTo":"2026-10-07","klNr":"90000001"}]' };
}
function response(url, body, at, changes = {}) {
  const bytes = Buffer.isBuffer(body) ? body : typeof body === "string" ? Buffer.from(body) : Buffer.alloc(0), headers = {
    date: new Date(at).toUTCString(), age: "0", "content-type": url === Publications.PAGE_URL ? "text/html; charset=UTF-8" : "application/json", ...changes.headers
  };
  return { status: changes.status ?? 200, url: changes.url ?? url, headers: { get: key => headers[key] ?? null },
    arrayBuffer: async () => bytes, ...changes, headers: { get: key => headers[key] ?? null } };
}
function harness(options = {}) {
  let at = time, stored = {}, snapshot = null, pending = null, assigned = false, releasedWith, sourceLoads = 0;
  const events = [], calls = [], bodies = nativeBodies(options.price);
  const source = { leaseOwner: "test-owner", leaseUntil: new Date(time + 3600000).toISOString(), consecutiveFailures: 0, ...options.source };
  const inherited = { connect() { throw Error("Never reconnect an already connected PoolClient"); } };
  const query = async (sql, p = []) => {
    events.push(sql);
    if (sql.startsWith("CREATE TABLE")) { if (options.failEnsure) throw options.failEnsure; return { rows: [] }; }
    if (sql === "BEGIN") { pending = { stored: copy(stored), snapshot: copy(snapshot) }; return { rows: [] }; }
    if (sql === "SELECT txid_current()") { assigned = !!pending; return { rows: [{ id: "1" }] }; }
    if (sql.startsWith("SELECT pg_current")) return { rows: [{ id: assigned ? "1" : null }] };
    if (sql.startsWith("SELECT pg_advisory")) return { rows: [] };
    if (sql.startsWith("SELECT revision FROM")) return { rows: options.actualRevision !== undefined ? [{ revision: options.actualRevision }]
      : (pending.stored.revision === undefined ? [] : [{ revision: pending.stored.revision }]) };
    if (sql.startsWith("SELECT revision,")) return { rows: stored.revision === undefined ? [] : [copy(stored)] };
    if (sql.startsWith("SELECT source_name")) return { rows: [{ sourceName: Publications.SOURCE, ...copy(source) }] };
    if (sql.startsWith("SELECT proof_hash")) return { rows: snapshot ? [{ proof_hash: Publications.parseCapture(snapshot, { now: at }).proofHash,
      captured_at: new Date(snapshot.index.capturedAt), raw_capture: copy(snapshot), held: false }] : [] };
    if (sql.startsWith("INSERT INTO " + Refresh.TABLE)) {
      if (sql.includes("RETURNING revision")) {
        if (options.failFailureSave) throw options.failFailureSave;
        if (stored.revision !== undefined && stored.revision !== p[4]) return { rows: [], rowCount: 0 };
        stored = { ...stored, revision: p[1], lastError: p[2], nextAttemptAt: p[3] }; return { rows: [{ revision: p[1] }], rowCount: 1 };
      }
      if (options.failCheckpoint) throw options.failCheckpoint;
      pending.stored = { revision: p[1], completedCaptures: p[2], lastCompletedAt: p[3], nextAttemptAt: p[4], proofHash: p[5], received: p[6], accepted: p[7], lastError: null };
      return { rows: [], rowCount: 1 };
    }
    if (sql === "COMMIT") {
      if (options.failCommit) throw options.failCommit;
      stored = pending.stored; snapshot = pending.snapshot; pending = null; assigned = false; return { rows: [] };
    }
    if (sql === "ROLLBACK") { pending = null; assigned = false; if (options.failRollback) throw options.failRollback; return { rows: [] }; }
    throw Error("Unexpected SQL " + sql);
  };
  const tx = Object.assign(Object.create(inherited), { query, release: error => { releasedWith = error; events.push("release"); } });
  const pool = { query, connect: async () => { events.push("connect"); return tx; } };
  const deps = {
    store: { loadAll: async () => { sourceLoads++; events.push("actual-store-lease-read"); return { [Publications.SOURCE]: copy(source) }; } },
    publications: { ensure: async () => events.push("snapshot-schema"), latest: async () => snapshot ? Publications.parseCapture(snapshot, { now: at }) : null,
      persist: async (client, raw, { now }) => {
        assert.equal(client, tx); assert(assigned); assert.equal(typeof tx.connect, "function");
        const parsed = Publications.parseCapture(raw, { now }); pending.snapshot = copy(raw); events.push("original-snapshot-write");
        if (options.failPersist) throw options.failPersist;
        return { received: parsed.received, accepted: parsed.accepted, rejected: parsed.rejected, proofHash: parsed.proofHash, upserted: 1 };
      } },
    sleep: async ms => { events.push("pause"); at += ms; options.onPause?.({ source, stored }); },
    shouldContinue: () => !options.stopping,
    fetchImpl: async (url, request) => {
      calls.push({ url, request }); events.push("GET " + url);
      assert.equal(request.redirect, "error"); assert.equal(request.credentials, "omit"); assert.equal(request.method, "GET");
      options.onFetch?.({ url, source, stored });
      const number = calls.length, changes = options.responses?.[number - 1] || {};
      if (changes.throw) throw changes.throw;
      return response(url, changes.body ?? (url === Publications.PAGE_URL ? bodies.branch : bodies.index), at, changes);
    }
  };
  return { pool, tx, deps, source, calls, events, options, get stored() { return stored; }, set stored(value) { stored = copy(value); },
    get snapshot() { return snapshot; }, set snapshot(value) { snapshot = copy(value); }, get sourceLoads() { return sourceLoads; },
    get releaseError() { return releasedWith; }, get now() { return at; }, set now(value) { at = value; },
    run: () => Refresh.refresh({ pool, leaseOwner: "test-owner", now: () => at }, deps) };
}
async function main() {
  let groups = 0;
  const test = async (name, fn) => { await fn(); console.log("ok " + (++groups) + " - " + name); };
  await test("two exact original GETs commit snapshot and CAS checkpoint together", async () => {
    const h = harness(), result = await h.run();
    assert.equal(result.requests, 2); assert.equal(result.received, 1); assert.equal(result.accepted, 1);
    assert.equal(result.current, false); assert.equal(result.currentPhysicalPriceImports, 0); assert.equal(result.nativeProductIdentities, 0);
    assert.deepEqual(h.calls.map(x => x.url), [Publications.PAGE_URL, Publications.INDEX_URL]);
    assert.equal(h.stored.revision, 1); assert.equal(h.stored.completedCaptures, 1); assert.equal(h.snapshot.branch.capturedAt, new Date(time).toISOString());
    assert.equal(h.snapshot.index.capturedAt, new Date(time + 1000).toISOString());
    assert(h.sourceLoads >= 4); assert(h.events.indexOf("original-snapshot-write") > h.events.indexOf("SELECT txid_current()"));
    assert(h.events.indexOf("COMMIT") > h.events.findIndex(x => x.startsWith("INSERT INTO " + Refresh.TABLE)));
    assert(h.calls.every(x => x.request.signal.aborted), "Timers and native fetch bodies are aborted during cleanup");
    assert.equal(h.releaseError, undefined); assert.equal(h.stored.nextAttemptAt, new Date(time + 1000 + Refresh.REFRESH_MS).toISOString());
    assert.equal((await h.run()).skipped, "source-not-due"); assert.equal(h.calls.length, 2);
  });
  for (const kind of ["failPersist", "failCheckpoint", "failCommit"]) await test(kind + " rolls content and completed cursor back, saving only durable failure", async () => {
    const error = Error(kind), h = harness({ [kind]: error });
    await assert.rejects(h.run(), e => e === error && e.nextAttemptAt === new Date(time + 1000 + Refresh.MIN_RETRY_MS).toISOString());
    assert.equal(h.snapshot, null); assert.equal(h.stored.completedCaptures, undefined); assert.equal(h.stored.lastCompletedAt, undefined);
    assert.equal(h.stored.revision, 1); assert(h.events.includes("ROLLBACK")); assert.equal(h.calls.length, 2);
    assert.equal((await h.run()).skipped, "source-not-due"); assert.equal(h.calls.length, 2);
  });
  await test("a rollback failure evicts the broken PoolClient without masking the admission error", async () => {
    const original = Error("snapshot write failed"), broken = Error("rollback connection lost"), h = harness({ failPersist: original, failRollback: broken });
    await assert.rejects(h.run(), e => e === original); assert.equal(h.releaseError, broken); assert.equal(h.snapshot, null);
  });
  for (const status of [403, 429, 404]) await test(status + " stops before the second GET and saves one-hour-or-longer pause", async () => {
    const h = harness({ responses: [{ status, headers: { "retry-after": "7200" } }] });
    await assert.rejects(h.run(), e => e.status === status && e.requests === 1 && e.nextAttemptAt === new Date(time + 7200000).toISOString());
    assert.equal(h.calls.length, 1); assert.equal(h.snapshot, null); assert(!h.events.includes("connect"));
    assert.equal((await h.run()).skipped, "source-not-due"); assert.equal(h.calls.length, 1);
  });
  await test("second original refusal never commits the partial first original", async () => {
    const h = harness({ responses: [{}, { status: 429, headers: { "retry-after": "5" } }] });
    await assert.rejects(h.run(), e => e.requests === 2 && e.nextAttemptAt === new Date(time + 1000 + 3600000).toISOString());
    assert.equal(h.snapshot, null); assert.equal(h.stored.completedCaptures, undefined); assert(!h.events.includes("connect"));
  });
  await test("long and expanded-year native Retry-After pauses are never shortened", async () => {
    const h = harness({ responses: [{ status: 429, headers: { "retry-after": "999999999999999999999999999999" } }] });
    await assert.rejects(h.run(), e => e.nextAttemptAt === "+275760-09-13T00:00:00.000Z");
    assert(h.stored.nextAttemptAt instanceof Date); assert.equal(h.stored.nextAttemptAt.getTime(), 8640000000000000);
    assert.equal((await h.run()).nextAttemptAt, "+275760-09-13T00:00:00.000Z"); assert.equal(h.calls.length, 1);
    const headers = raw => ({ get: () => raw });
    assert.equal(Refresh.retryAfter(headers("691200"), time), 8 * 86400000);
    assert.equal(Refresh.retryAfter(headers(new Date(time + 9 * 86400000).toUTCString()), time), 9 * 86400000);
    for (const raw of [null, "-1", "garbage", "5"]) assert.equal(Refresh.retryAfter(headers(raw), time), 3600000);
  });
  for (const source of [{ leaseOwner: "another-instance" }, { leaseUntil: new Date(time).toISOString() }, { leaseUntil: null }])
    await test("actual source lease " + JSON.stringify(source) + " prevents every native GET", async () => {
      const h = harness({ source }); assert.equal((await h.run()).skipped, "source-not-eligible");
      assert.equal(h.calls.length, 0); assert.equal(h.stored.revision, undefined);
    });
  await test("lease loss during the ordinary pause prevents the second native GET", async () => {
    const h = harness({ onPause: ({ source }) => { source.leaseOwner = "new-owner"; } });
    const result = await h.run(); assert.equal(result.skipped, "source-not-eligible"); assert.equal(result.requests, 1);
    assert.equal(h.snapshot, null); assert.equal(h.stored.revision, undefined); assert.equal(h.calls.length, 1);
  });
  await test("a newly persisted global source cooldown during the pause prevents the second GET", async () => {
    const h = harness({ onPause: ({ source }) => { source.nextAttemptAt = new Date(time + 8 * 86400000).toISOString(); } });
    const result = await h.run(); assert.equal(result.skipped, "source-not-eligible"); assert.equal(h.calls.length, 1);
    assert.equal(result.nextAttemptAt, new Date(time + 8 * 86400000).toISOString()); assert.equal(h.snapshot, null);
  });
  await test("lease loss after both successful GETs retains actual request and byte counts without commit", async () => {
    const h = harness({ onFetch: ({ url, source }) => { if (url === Publications.INDEX_URL) source.leaseOwner = "changed-after-second-get"; } });
    const result = await h.run(); assert.equal(result.skipped, "source-not-eligible"); assert.equal(result.requests, 2);
    const bodies = nativeBodies(); assert.equal(result.bytes, Buffer.byteLength(bodies.branch) + Buffer.byteLength(bodies.index));
    assert.equal(h.calls.length, 2); assert.equal(h.snapshot, null); assert.equal(h.stored.revision, undefined);
    assert(!h.events.includes("connect")); assert(!h.events.includes("COMMIT"));
    assert(!h.events.some(sql => sql.startsWith("INSERT INTO " + Refresh.TABLE)), "No failure or progress reset after lease denial");
  });
  await test("global failure backoff is respected without resetting another source state", async () => {
    const h = harness({ source: { consecutiveFailures: 3, lastAttemptAt: new Date(time).toISOString() } });
    const original = copy(h.source), result = await h.run(); assert.equal(result.skipped, "source-not-due"); assert.equal(h.calls.length, 0);
    assert.deepEqual(h.source, original); assert.equal(result.nextAttemptAt, new Date(time + 240000).toISOString());
  });
  await test("persisted snapshot imposes six-hour cadence even without a refresh checkpoint", async () => {
    const h = harness(), bodies = nativeBodies();
    const record = (url, body) => ({ status: 200, sourceResponseUrl: url, sourceResponseHash: Publications.hash(body), body,
      capturedAt: new Date(time - 1000).toISOString(), headers: { date: new Date(time - 1000).toUTCString(), age: "0",
        "content-type": url === Publications.PAGE_URL ? "text/html" : "application/json" }, bytes: Buffer.byteLength(body) });
    h.snapshot = { branch: record(Publications.PAGE_URL, bodies.branch), index: record(Publications.INDEX_URL, bodies.index) };
    const before = copy(h.snapshot), result = await h.run(); assert.equal(result.skipped, "source-not-due"); assert.equal(h.calls.length, 0);
    assert.equal(result.nextAttemptAt, new Date(time - 1000 + Refresh.REFRESH_MS).toISOString()); assert.deepEqual(h.snapshot, before);
  });
  await test("shutdown after the pause has no empty snapshot commit and no failure reset", async () => {
    const h = harness({ onPause: () => { h.options.stopping = true; } });
    const result = await h.run(); assert.equal(result.skipped, "server-stopping"); assert.equal(result.requests, 1);
    assert.equal(h.snapshot, null); assert.equal(h.stored.revision, undefined); assert.equal(h.calls.length, 1);
  });
  await test("shutdown before initial transport makes no native request", async () => {
    const h = harness({ stopping: true }); assert.equal((await h.run()).skipped, "server-stopping"); assert.equal(h.calls.length, 0);
  });
  await test("shutdown after both originals but before snapshot admission makes no commit", async () => {
    const h = harness({ onFetch: ({ url }) => { if (url === Publications.INDEX_URL) h.options.stopping = true; } });
    const result = await h.run(); assert.equal(result.skipped, "server-stopping"); assert.equal(result.requests, 2);
    assert.equal(h.snapshot, null); assert(!h.events.includes("connect"));
  });
  await test("CAS revision movement rolls the newly admitted snapshot back instead of overwriting progress", async () => {
    const h = harness(), original = h.deps.publications.persist;
    h.deps.publications.persist = async (...args) => { const saved = await original(...args); h.stored = { revision: 1 }; h.options.actualRevision = 1; return saved; };
    await assert.rejects(h.run(), /checkpoint-moved/); assert.equal(h.snapshot, null); assert.equal(h.stored.revision, 1);
  });
  await test("failure-save rejection retains the original error and makes persistence failure explicit", async () => {
    const original = Error("native transport failed"), secondary = Error("database failure save failed"), h = harness({ responses: [{ throw: original }], failFailureSave: secondary });
    await assert.rejects(h.run(), e => e.code === "kaufland-source-fetch-failed" && e.cause === original && e.failurePersistenceError === secondary);
    assert.equal(h.stored.revision, undefined); assert.equal(h.snapshot, null);
  });
  for (const [name, changes] of [
    ["redirected URL", { url: Publications.PAGE_URL + "?other=1" }], ["missing actual URL", { url: null }],
    ["wrong HTML content type", { headers: { "content-type": "application/json" } }],
    ["malformed declared byte size", { headers: { "content-length": "-1" } }],
    ["oversized declared body", { headers: { "content-length": String(Publications.MAX_HTML_BYTES + 1) } }],
    ["oversized received body", { body: Buffer.alloc(Publications.MAX_HTML_BYTES + 1, 32) }],
    ["invalid UTF8", { body: Buffer.from([0xc3, 0x28]) }], ["empty body", { body: Buffer.alloc(0) }],
    ["old native Date", { headers: { date: new Date(time - 3600000).toUTCString() } }],
    ["invalid native Age", { headers: { age: "NaN" } }], ["native Age above budget", { headers: { age: "301" } }]
  ]) await test(name + " stops with no second GET or snapshot", async () => {
    const h = harness({ responses: [changes] }); await assert.rejects(h.run(), /kaufland-/);
    assert.equal(h.calls.length, 1); assert.equal(h.snapshot, null); assert(!h.events.includes("connect"));
  });
  await test("index has its separate strict 512KiB budget", async () => {
    const h = harness({ responses: [{}, { body: Buffer.alloc(Publications.MAX_INDEX_BYTES + 1, 32) }] });
    await assert.rejects(h.run(), /byte-budget/); assert.equal(h.calls.length, 2); assert.equal(h.snapshot, null);
  });
  await test("stream bytes are bounded and reader lock is released even with dishonest header", async () => {
    let cancelled = false, released = false;
    const reader = { read: async () => ({ done: false, value: Buffer.alloc(Publications.MAX_INDEX_BYTES + 1) }),
      cancel: async () => { cancelled = true; }, releaseLock: () => { released = true; } };
    const h = harness({ responses: [{}, { headers: { "content-length": "1" }, body: { getReader: () => reader } }] });
    await assert.rejects(h.run(), /byte-budget/); assert(cancelled); assert(released); assert.equal(h.snapshot, null);
  });
  await test("timeout aborts the native request and clears the transport resource", async () => {
    let signal;
    await assert.rejects(Refresh.get(Publications.PAGE_URL, { now: () => time, canFetch: async () => true, timeoutMs: 5,
      fetchImpl: async (_url, request) => new Promise((_resolve, reject) => {
        signal = request.signal; signal.addEventListener("abort", () => reject(Error("synthetic request aborted")), { once: true });
      }) }), /source-timeout/);
    assert(signal.aborted);
  });
  await test("arbitrary native URL and missing gate cannot launch transport", async () => {
    let calls = 0; const fetchImpl = async () => { calls++; throw Error("must not fetch"); };
    await assert.rejects(Refresh.get(Publications.PAGE_URL + "?store=DE1999", { fetchImpl, canFetch: async () => true }), /unreviewed/);
    await assert.rejects(Refresh.get(Publications.PAGE_URL, { fetchImpl }), /source-gate-required/); assert.equal(calls, 0);
  });
  await test("invalid original pair is never admitted despite two successful HTTP statuses", async () => {
    const h = harness({ responses: [{}, { body: '[{"dateFrom":"2026-10-01","dateTo":"2026-10-07","klNr":"90000001","price":1}]' }] });
    await assert.rejects(h.run(), /native-index-invalid/);
    assert.equal(h.snapshot, null); assert(!h.events.includes("connect")); assert.equal(h.stored.completedCaptures, undefined);
  });
  await test("missing lease owner or connected-client input fails before network", async () => {
    const h = harness(); await assert.rejects(Refresh.refresh({ pool: h.pool }, h.deps), /lease-owner-required/);
    await assert.rejects(Refresh.refresh({ pool: h.tx, leaseOwner: "test-owner" }, h.deps), /refresh-pool-required/);
    assert.equal(h.calls.length, 0);
  });
  await test("metadata status and resume expose no current price, raw proof body or false coverage", async () => {
    const h = harness(); await h.run(); const result = await Refresh.status(h.pool, h.now), resume = await Refresh.resumeAt(h.pool, h.now);
    assert.equal(result.current, false); assert.equal(result.fullAssortment, false); assert.equal(result.physicalStorePriceVerified, false);
    assert.equal(result.normalPriceClassificationVerified, false); assert.equal(result.maximumOrdinaryRequests, 2);
    assert.equal(result.scopeChannel, Publications.CHANNEL); assert.equal(result.rawCapture, undefined); assert.equal(result.body, undefined);
    assert.equal(resume, h.stored.nextAttemptAt);
  });
  console.log("kaufland-berlin-publication-refresh: " + groups + " bounded HTTP/original/lease/cooldown/CAS/rollback/shutdown groups passed; no actual HTTP or SQL");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
