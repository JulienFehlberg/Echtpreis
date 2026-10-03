"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), crypto = require("node:crypto");
const Refresh = require("../kaufland-berlin-publication-refresh"), Publications = require("../kaufland-berlin-publications");
// Reuse the actual collector's explicitly synthetic native originals and fake
// transaction semantics, without executing that program or making HTTP calls.
const fixtureFile = path.join(__dirname, "kaufland-berlin-publication-refresh.test.js"), fixtureSource = fs.readFileSync(fixtureFile, "utf8");
assert(fixtureSource.includes("async function main() {"));
const fixtureModule = new Module(fixtureFile, module);
fixtureModule.filename = fixtureFile; fixtureModule.paths = Module._nodeModulePaths(__dirname);
fixtureModule._compile(fixtureSource.slice(0, fixtureSource.indexOf("async function main() {")) + "\nmodule.exports={harness,response,time};", fixtureFile);
const { harness, response, time } = fixtureModule.exports;
const iso = value => new Date(value).toISOString(), http = value => new Date(value).toUTCString();
const CODE = "kaufland-source-original-http-time-required";
function requestContract(call) {
  const { url, request } = call;
  assert([Publications.PAGE_URL, Publications.INDEX_URL].includes(url));
  assert.equal(request.method, "GET"); assert.equal(request.credentials, "omit"); assert.equal(request.redirect, "error");
  assert.deepEqual(Object.keys(request).sort(), ["credentials", "headers", "method", "redirect", "signal"]);
  assert.deepEqual(request.headers, { Accept: url === Publications.PAGE_URL ? "text/html" : "application/json", "Cache-Control": "no-cache",
    "User-Agent": "CaddyPriceResearch/1.0 (public dated branch offer observation)" });
  assert(request.signal.aborted, "Every actual transport is cleaned up, including rejected replies");
}
async function main() {
  let groups = 0;
  const test = async (name, fn) => { await fn(); console.log("ok " + (++groups) + " - " + name); };
  await test("one regular capture requests revalidation on exactly two original canonical URLs", async () => {
    const h = harness(), result = await h.run();
    assert.deepEqual(h.calls.map(x => x.url), [Publications.PAGE_URL, Publications.INDEX_URL]); h.calls.forEach(requestContract);
    assert.equal(result.requests, 2); assert.equal(result.accepted, 1); assert.equal(result.current, false); assert.equal(result.currentPhysicalPriceImports, 0);
    assert.equal(h.stored.completedCaptures, 1); assert.equal(h.stored.nextAttemptAt, iso(time + 1000 + Refresh.REFRESH_MS));
    assert.deepEqual(h.snapshot.branch.headers, { date: http(time), age: "0", "content-type": "text/html; charset=UTF-8" });
    assert.deepEqual(h.snapshot.index.headers, { date: http(time + 1000), age: "0", "content-type": "application/json" });
    const before = structuredClone(h.stored); assert.equal((await h.run()).skipped, "source-not-due");
    assert.equal(h.calls.length, 2); assert.deepEqual(h.stored, before);
  });
  await test("caller headers cannot supply Date Age credentials conditional validators or a different cache policy", async () => {
    let call; const body = "NEW SYNTHETIC ORIGINAL: same response evidence";
    const callerHeaders = { Date: "PRIVATE_DATE", Age: "0", Authorization: "PRIVATE_TOKEN", Cookie: "PRIVATE_COOKIE", "Cache-Control": "max-stale",
      "If-None-Match": "PRIVATE_ETAG", "If-Modified-Since": "PRIVATE_DATE" }, before = structuredClone(callerHeaders);
    const got = await Refresh.get(Publications.INDEX_URL, { now: () => time, canFetch: async () => true, headers: callerHeaders,
      fetchImpl: async (url, request) => { call = { url, request }; return response(url, body, time, { headers: { age: "7", date: http(time - 1000) } }); } });
    requestContract(call); assert.deepEqual(callerHeaders, before);
    assert.equal(got.headers.age, "7"); assert.equal(got.headers.date, http(time - 1000)); assert.equal(got.capturedAt, iso(time));
    assert.equal(got.sourceResponseHash, crypto.createHash("sha256").update(Buffer.from(body)).digest("hex"));
    assert.equal(got.sourceResponseUrl, Publications.INDEX_URL); assert.equal(got.body, body); assert.equal(Object.hasOwn(got, "httpTime"), false);
  });
  for (const [name, headers] of [
    ["past Date and Age exactly five minutes", { date: http(time - 300000), age: "300" }],
    ["future Date exactly five minutes", { date: http(time + 300000), age: "0" }],
    ["optional missing Age", { age: null }]
  ]) await test("normal revalidation preserves successful original boundary: " + name, async () => {
    let call; const body = "NEW SYNTHETIC ORIGINAL BOUNDARY";
    const got = await Refresh.get(Publications.PAGE_URL, { now: () => time, canFetch: async () => true,
      fetchImpl: async (url, request) => { call = { url, request }; return response(url, body, time, { headers }); } });
    requestContract(call); assert.equal(got.headers.age, headers.age); assert.equal(got.headers.date, headers.date ?? http(time));
    assert.equal(got.capturedAt, iso(time)); assert.equal(got.sourceResponseHash, crypto.createHash("sha256").update(body).digest("hex"));
  });
  for (const index of [false, true]) await test("actual Age17830 still rejects " + (index ? "index after exact branch GET" : "first branch") + " and retains the original closed diagnostic", async () => {
    const h = harness({ responses: index ? [{}, { headers: { age: "17830" } }] : [{ headers: { age: "17830" } }] });
    await assert.rejects(h.run(), error => error.code === CODE && error.requests === (index ? 2 : 1));
    h.calls.forEach(requestContract); assert.equal(h.snapshot, null); assert(!h.events.includes("connect"));
    const status = await Refresh.status(h.pool, h.now), next = iso(h.now + Refresh.MIN_RETRY_MS);
    assert.equal(status.lastError, CODE); assert.deepEqual(status.lastFailureHttpTime, { response: index ? "index" : "branch", receivedAt: iso(h.now),
      httpDate: iso(h.now), ageSeconds: 17830, dateValid: true, ageValid: false });
    assert.equal(h.stored.nextAttemptAt, next); assert.equal(status.nextAttemptAt, next); assert.equal(status.completedCaptures, 0);
    assert.equal(status.current, false); assert.equal(status.currentPhysicalPriceImports, 0); assert.equal(status.nativeProductIdentities, 0);
    const before = structuredClone(h.stored); assert.equal((await h.run()).skipped, "source-not-due");
    assert.equal(h.calls.length, index ? 2 : 1); assert.deepEqual(h.stored, before);
  });
  for (const [name, headers] of [
    ["missing Date", { date: null }], ["future Date301s", { date: http(time + 301000) }],
    ["invalid native Age", { age: "PRIVATE_AGE" }], ["Age301s", { age: "301" }]
  ]) await test("request revalidation cannot override rejected original " + name, async () => {
    const h = harness({ responses: [{ headers }] }); await assert.rejects(h.run(), error => error.code === CODE);
    assert.equal(h.calls.length, 1); requestContract(h.calls[0]); assert.equal(h.snapshot, null); assert(!h.events.includes("connect"));
    const status = await Refresh.status(h.pool, h.now); assert.equal(status.lastError, CODE); assert.equal(status.currentPhysicalPriceImports, 0);
    assert(!JSON.stringify(status).includes("PRIVATE_AGE"));
  });
  for (const status of [304, 403, 429]) await test(status + " remains one rejected ordinary GET with no fallback or retry", async () => {
    const h = harness({ responses: [{ status, headers: { "retry-after": "7200" } }] });
    await assert.rejects(h.run(), error => error.code === "kaufland-source-http-" + status && error.requests === 1);
    assert.equal(h.calls.length, 1); requestContract(h.calls[0]); assert.equal(h.snapshot, null); assert(!h.events.includes("connect"));
    assert.equal(h.stored.lastError, "kaufland-source-http-" + status); assert.equal(h.stored.nextAttemptAt, iso(time + 7200000));
    assert.equal((await h.run()).skipped, "source-not-due"); assert.equal(h.calls.length, 1);
  });
  await test("persisted source pause prevents every revalidation request without moving state", async () => {
    const h = harness(); h.stored = { revision: 2, lastError: CODE, nextAttemptAt: iso(time + Refresh.MIN_RETRY_MS) };
    const before = structuredClone(h.stored), result = await h.run();
    assert.equal(result.skipped, "source-not-due"); assert.equal(result.nextAttemptAt, before.nextAttemptAt);
    assert.equal(h.calls.length, 0); assert.deepEqual(h.stored, before); assert.equal(h.snapshot, null);
  });
  await test("global source backoff prevents revalidation despite an otherwise due local checkpoint", async () => {
    const h = harness({ source: { consecutiveFailures: 1, lastAttemptAt: iso(time), nextAttemptAt: iso(time + 7200000) } });
    const before = structuredClone(h.stored), result = await h.run(); assert.equal(result.skipped, "source-not-due");
    assert.equal(result.nextAttemptAt, iso(time + 7200000)); assert.equal(h.calls.length, 0); assert.deepEqual(h.stored, before);
  });
  await test("lease loss during existing one-second pause prevents the index GET and all writes", async () => {
    const h = harness({ onPause: ({ source }) => { source.leaseOwner = "different-real-owner"; } });
    const before = structuredClone(h.stored), result = await h.run(); assert.equal(result.skipped, "source-not-eligible");
    assert.equal(result.requests, 1); assert.equal(h.calls.length, 1); requestContract(h.calls[0]);
    assert.deepEqual(h.stored, before); assert.equal(h.snapshot, null); assert(!h.events.includes("connect"));
  });
  await test("new source pause during existing one-second pause prevents index without clearing cooldown", async () => {
    const h = harness({ onPause: ({ source }) => { source.nextAttemptAt = iso(time + 7200000); } });
    const result = await h.run(); assert.equal(result.skipped, "source-not-eligible"); assert.equal(result.nextAttemptAt, iso(time + 7200000));
    assert.equal(h.calls.length, 1); requestContract(h.calls[0]); assert.equal(h.source.nextAttemptAt, iso(time + 7200000));
    assert.equal(h.snapshot, null); assert.equal(h.stored.revision, undefined);
  });
  await test("arbitrary URL query or denied gate never starts a revalidation GET", async () => {
    let requests = 0; const fetchImpl = async () => { requests++; throw Error("No request authorized"); };
    await assert.rejects(Refresh.get(Publications.PAGE_URL + "?cachebust=1", { fetchImpl, canFetch: async () => true }), /unreviewed-source-url/);
    await assert.rejects(Refresh.get(Publications.INDEX_URL, { fetchImpl, canFetch: async () => false }), /source-not-eligible/);
    assert.equal(requests, 0);
  });
  console.log("kaufland-source-revalidation: " + groups + " original canonical GET/clock/lease/cooldown/no-retry groups passed; no actual HTTP or SQL");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
