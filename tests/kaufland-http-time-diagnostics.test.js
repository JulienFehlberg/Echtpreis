"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), crypto = require("node:crypto");
const Refresh = require("../kaufland-berlin-publication-refresh"), Publications = require("../kaufland-berlin-publications");
const CODE = "kaufland-source-original-http-time-required", CLOSED = ["ageSeconds", "ageValid", "dateValid", "httpDate", "receivedAt", "response"];
// Reuse the existing real collector/transaction fake without executing its suite.
// Original synthetic HTML, clocks and fake DB semantics remain exactly its own.
const fixtureFile = path.join(__dirname, "kaufland-berlin-publication-refresh.test.js"), fixtureSource = fs.readFileSync(fixtureFile, "utf8");
assert(fixtureSource.includes("async function main() {"));
const fixtureModule = new Module(fixtureFile, module);
fixtureModule.filename = fixtureFile; fixtureModule.paths = Module._nodeModulePaths(__dirname);
fixtureModule._compile(fixtureSource.slice(0, fixtureSource.indexOf("async function main() {")) + "\nmodule.exports={harness,response,time};", fixtureFile);
const { harness, response, time } = fixtureModule.exports;
const iso = value => new Date(value).toISOString(), http = value => new Date(value).toUTCString();
const wire = value => JSON.stringify(value), copy = value => structuredClone(value);
async function rejected(h) { try { await h.run(); assert.fail("A rejected original HTTP clock must not publish"); } catch (error) { assert.equal(error.code, CODE); return error; } }
async function clockFailure(headers, expected, index = false) {
  const h = harness({ responses: index ? [{}, { headers }] : [{ headers }] }), error = await rejected(h);
  const checkpoint = copy(h.stored), detail = JSON.parse(checkpoint.lastError);
  assert.equal(detail.v, 1); assert.equal(detail.code, CODE); assert.equal(Object.keys(detail).sort().join(","), "code,httpTime,v");
  assert.deepEqual(Object.keys(detail.httpTime).sort(), CLOSED);
  assert.deepEqual(detail.httpTime, { response: index ? "index" : "branch", receivedAt: iso(time + (index ? 1000 : 0)), ...expected });
  assert(checkpoint.lastError.length <= 300); assert.equal(checkpoint.revision, 1);
  assert.equal(checkpoint.nextAttemptAt, iso(h.now + Refresh.MIN_RETRY_MS)); assert.equal(h.snapshot, null);
  assert(!h.events.includes("connect")); assert.equal(error.requests, index ? 2 : 1);
  assert(h.calls.every(call => call.request.signal.aborted)); assert.equal(Object.hasOwn(error, "httpTime"), false);
  const status = await Refresh.status(h.pool, h.now);
  assert.equal(status.lastError, CODE); assert.deepEqual(status.lastFailureHttpTime, detail.httpTime);
  assert.equal(status.current, false); assert.equal(status.currentPhysicalPriceImports, 0); assert.equal(status.nativeProductIdentities, 0);
  assert.equal(status.nextAttemptAt, checkpoint.nextAttemptAt); assert.deepEqual(h.stored, checkpoint);
  assert.equal(Refresh.state(checkpoint).lastError, checkpoint.lastError, "Private scheduler state retains its exact stored envelope");
  const calls = h.calls.length; assert.equal((await h.run()).skipped, "source-not-due"); assert.equal(h.calls.length, calls);
  return { h, error, status, detail };
}
async function main() {
  let groups = 0;
  const test = async (name, fn) => { await fn(); console.log("ok " + (++groups) + " - " + name); };
  for (const [name, headers, expected] of [
    ["missing Date", { date: null }, { httpDate: null, ageSeconds: 0, dateValid: false, ageValid: true }],
    ["invalid Date never exposes its text", { date: "AUTHORIZATION Bearer PRIVATE_HEADER" }, { httpDate: null, ageSeconds: 0, dateValid: false, ageValid: true }],
    ["past Date beyond five minutes", { date: http(time - 301000) }, { httpDate: iso(time - 301000), ageSeconds: 0, dateValid: false, ageValid: true }],
    ["future Date beyond five minutes", { date: http(time + 301000) }, { httpDate: iso(time + 301000), ageSeconds: 0, dateValid: false, ageValid: true }],
    ["Age beyond five minutes", { age: "301" }, { httpDate: iso(time), ageSeconds: 301, dateValid: true, ageValid: false }],
    ["invalid Age never exposes its text", { age: "session=PRIVATE_HEADER" }, { httpDate: iso(time), ageSeconds: null, dateValid: true, ageValid: false }],
    ["negative Age remains rejected", { age: "-1" }, { httpDate: iso(time), ageSeconds: null, dateValid: true, ageValid: false }],
    ["fractional Age remains rejected", { age: "0.5" }, { httpDate: iso(time), ageSeconds: null, dateValid: true, ageValid: false }],
    ["overflow Age is sanitized", { age: "9".repeat(500) }, { httpDate: iso(time), ageSeconds: null, dateValid: true, ageValid: false }],
    ["unsafe integer Age is sanitized", { age: "9007199254740992" }, { httpDate: iso(time), ageSeconds: null, dateValid: true, ageValid: false }],
    ["maximum safe integer Age fits the closed envelope", { age: String(Number.MAX_SAFE_INTEGER) }, { httpDate: iso(time), ageSeconds: Number.MAX_SAFE_INTEGER, dateValid: true, ageValid: false }],
    ["missing Age preserves the original optional Age gate", { date: null, age: null }, { httpDate: null, ageSeconds: null, dateValid: false, ageValid: true }]
  ]) await test("actual transport and durable status: " + name, async () => { const result = await clockFailure(headers, expected); assert(!wire(result.status).includes("PRIVATE_HEADER")); });
  await test("index clock failure records index receive time after one exact branch request", async () => {
    await clockFailure({ date: null, age: "301" }, { httpDate: null, ageSeconds: 301, dateValid: false, ageValid: false }, true);
  });
  await test("the actual failed response body raw headers and tokens are never serialized", async () => {
    const h = harness({ responses: [{ body: "PRIVATE_BODY_TOKEN", headers: { date: "PRIVATE_DATE_TOKEN", age: "PRIVATE_AGE_TOKEN", cookie: "PRIVATE_COOKIE_TOKEN", authorization: "PRIVATE_AUTH_TOKEN" } }] });
    await rejected(h); const status = await Refresh.status(h.pool, h.now), serialized = wire({ stored: h.stored, status });
    for (const secret of ["PRIVATE_BODY_TOKEN", "PRIVATE_DATE_TOKEN", "PRIVATE_AGE_TOKEN", "PRIVATE_COOKIE_TOKEN", "PRIVATE_AUTH_TOKEN", "authorization", "cookie", "sourceResponseHash", '"body"', '"headers"']) assert(!serialized.includes(secret), secret);
    assert.equal(h.snapshot, null); assert.equal(status.lastFailureHttpTime.httpDate, null); assert.equal(status.lastFailureHttpTime.ageSeconds, null);
  });
  for (const [name, headers] of [
    ["exactly five minutes past and Age300", { date: http(time - 300000), age: "300" }],
    ["exactly five minutes future", { date: http(time + 300000), age: "0" }],
    ["missing Age", { age: null }],
    ["leading-zero Age", { age: "000300" }]
  ]) await test("unchanged successful transport boundary: " + name, async () => {
    let request; const body = "NEW SYNTHETIC ORIGINAL BODY";
    const got = await Refresh.get(Publications.PAGE_URL, { now: () => time, canFetch: async () => true, shouldContinue: () => true,
      fetchImpl: async (url, input) => { request = input; return response(url, body, time, { headers }); } });
    assert.equal(got.body, body); assert.equal(got.capturedAt, iso(time)); assert.equal(got.sourceResponseHash, crypto.createHash("sha256").update(Buffer.from(body)).digest("hex"));
    assert.equal(got.headers.age, headers.age ?? (Object.hasOwn(headers, "age") ? null : "0")); assert.equal(Object.hasOwn(got, "httpTime"), false); assert(request.signal.aborted);
  });
  await test("nonclock HTTP errors retain their original durable code and schedule", async () => {
    const h = harness({ responses: [{ status: 429, headers: { "retry-after": "7200", date: "PRIVATE_DATE_TOKEN" } }] });
    await assert.rejects(h.run(), error => error.code === "kaufland-source-http-429");
    assert.equal(h.stored.lastError, "kaufland-source-http-429"); assert.equal(h.stored.nextAttemptAt, iso(time + 7200000));
    const status = await Refresh.status(h.pool, h.now); assert.equal(status.lastError, h.stored.lastError); assert.equal(status.lastFailureHttpTime, null);
  });
  const good = { response: "branch", receivedAt: iso(time), httpDate: null, ageSeconds: 0, dateValid: false, ageValid: true };
  for (const [name, modify] of [
    ["extra header or body", d => { d.rawBody = "PRIVATE_BODY_TOKEN"; }],
    ["replaced diagnostic code", d => { d.code = CODE + "-TAMPER"; d.rawBody = "PRIVATE_BODY_TOKEN"; }],
    ["removed diagnostic code", d => { delete d.code; d.rawBody = "PRIVATE_BODY_TOKEN"; }],
    ["nonstring diagnostic code", d => { d.code = { raw: "PRIVATE_BODY_TOKEN" }; }],
    ["null diagnostic code", d => { d.code = null; d.rawBody = "PRIVATE_BODY_TOKEN"; }],
    ["foreign response kind", d => { d.httpTime.response = "https://foreign.test/?token=PRIVATE_BODY_TOKEN"; }],
    ["noncanonical received timestamp", d => { d.httpTime.receivedAt = "2026-10-03"; }],
    ["invalid HTTP ISO", d => { d.httpTime.httpDate = "PRIVATE_BODY_TOKEN"; }],
    ["unsafe Age number", d => { d.httpTime.ageSeconds = Number.MAX_SAFE_INTEGER + 1; }],
    ["negative Age number", d => { d.httpTime.ageSeconds = -1; }],
    ["Age flag contradicts number", d => { d.httpTime.ageSeconds = 301; }],
    ["Date flag contradicts timestamp", d => { d.httpTime.dateValid = true; }],
    ["successful clock cannot masquerade as a clock failure", d => { d.httpTime.httpDate = iso(time); d.httpTime.dateValid = true; }],
    ["unknown envelope version", d => { d.v = 2; }],
    ["unknown witness field", d => { d.httpTime.raw = "PRIVATE_BODY_TOKEN"; }]
  ]) await test("tampered stored diagnostic fails closed: " + name, async () => {
    const h = harness(), detail = { v: 1, code: CODE, httpTime: copy(good) }; modify(detail);
    const stored = { revision: 1, lastError: wire(detail), nextAttemptAt: iso(time + Refresh.MIN_RETRY_MS) }; assert(stored.lastError.length <= 300); h.stored = stored;
    const status = await Refresh.status(h.pool, time); assert.equal(status.lastError, CODE); assert.equal(status.lastFailureHttpTime, null); assert(!wire(status).includes("PRIVATE_BODY_TOKEN"));
    assert.deepEqual(h.stored, stored); assert.equal(h.calls.length, 0); assert.equal(status.nextAttemptAt, stored.nextAttemptAt);
  });
  await test("truncated stored diagnostic does not expose its damaged raw contents", async () => {
    const h = harness(); h.stored = { revision: 1, nextAttemptAt: iso(time + Refresh.MIN_RETRY_MS), lastError: '{"code":"' + CODE + '","raw":"PRIVATE_BODY_TOKEN"' };
    const status = await Refresh.status(h.pool, time); assert.equal(status.lastError, CODE); assert.equal(status.lastFailureHttpTime, null); assert(!wire(status).includes("PRIVATE_BODY_TOKEN"));
  });
  for (const [name, lastError] of [
    ["leading whitespace with replaced code", '  {"code":"TAMPER","raw":"PRIVATE_BODY_TOKEN"}'],
    ["array replacement", '[{"raw":"PRIVATE_BODY_TOKEN"}]'],
    ["truncated object without code", '{"raw":"PRIVATE_BODY_TOKEN"'],
    ["truncated array without code", '["PRIVATE_BODY_TOKEN"']
  ]) await test("damaged JSON envelope remains private: " + name, async () => {
    const h = harness(); h.stored = { revision: 1, nextAttemptAt: iso(time + Refresh.MIN_RETRY_MS), lastError };
    const before = copy(h.stored), status = await Refresh.status(h.pool, time);
    assert.equal(status.lastError, CODE); assert.equal(status.lastFailureHttpTime, null); assert(!wire(status).includes("PRIVATE_BODY_TOKEN"));
    assert.deepEqual(h.stored, before); assert.equal(status.nextAttemptAt, before.nextAttemptAt); assert.equal(h.calls.length, 0);
  });
  await test("CAS loss cannot manufacture a persisted HTTP-clock pause or overwrite another revision", async () => {
    const h = harness({ responses: [{ headers: { date: null } }], onFetch: ({ stored }) => { Object.assign(stored, { revision: 9, lastError: "another-owner-error", nextAttemptAt: iso(time + 8 * 3600000) }); } });
    const error = await rejected(h); assert.equal(error.failurePersistenceError.code, "kaufland-refresh-checkpoint-moved"); assert.equal(Object.hasOwn(error, "nextAttemptAt"), false);
    assert.equal(h.stored.revision, 9); assert.equal(h.stored.lastError, "another-owner-error"); assert.equal(h.stored.nextAttemptAt, iso(time + 8 * 3600000));
    const status = await Refresh.status(h.pool, h.now); assert.equal(status.lastFailureHttpTime, null); assert.equal(status.lastError, "another-owner-error"); assert.equal(h.snapshot, null);
  });
  await test("failure-checkpoint SQL error keeps the original error and untouched state", async () => {
    const sqlError = new Error("synthetic SQL failure"), h = harness({ failFailureSave: sqlError, responses: [{ headers: { date: null } }] });
    const error = await rejected(h); assert.equal(error.failurePersistenceError, sqlError); assert.equal(Object.hasOwn(error, "nextAttemptAt"), false); assert.deepEqual(h.stored, {}); assert.equal(h.snapshot, null);
  });
  await test("caller-supplied clock extras cannot impersonate an actual transport witness", async () => {
    const fake = Object.assign(new Error(CODE), { code: CODE, httpTime: { ...good, raw: "PRIVATE_BODY_TOKEN" }, headers: { date: "PRIVATE_DATE_TOKEN" } });
    const h = harness({ failPersist: fake }); await rejected(h);
    assert.equal(h.stored.lastError, CODE); assert.equal(h.snapshot, null); assert(h.events.includes("ROLLBACK"));
    const status = await Refresh.status(h.pool, h.now); assert.equal(status.lastFailureHttpTime, null); assert.equal(status.lastError, CODE);
    assert(!wire({ stored: h.stored, status }).includes("PRIVATE_BODY_TOKEN"));
  });
  await test("global durable hold still precedes all GETs and no clock detail is invented", async () => {
    const h = harness({ source: { nextAttemptAt: iso(time + 8 * 3600000) }, responses: [{ headers: { date: null } }] });
    const result = await h.run(); assert.equal(result.skipped, "source-not-due"); assert.equal(h.calls.length, 0); assert.deepEqual(h.stored, {});
    const status = await Refresh.status(h.pool, h.now); assert.equal(status.lastFailureHttpTime, null); assert.equal(status.lastError, null); assert.equal(status.nextAttemptAt, h.source.nextAttemptAt);
  });
  await test("successful later capture clears the old diagnostic only through the existing atomic checkpoint", async () => {
    const h = harness(); h.stored = { revision: 1, lastError: wire({ v: 1, code: CODE, httpTime: good }), nextAttemptAt: iso(time) };
    const result = await h.run(); assert.equal(result.accepted, 1); assert.equal(h.stored.revision, 2); assert.equal(h.stored.lastError, null); assert(h.snapshot);
    const status = await Refresh.status(h.pool, h.now); assert.equal(status.lastError, null); assert.equal(status.lastFailureHttpTime, null); assert.equal(status.current, false);
  });
  console.log(JSON.stringify({ ok: true, groups, merchantRequests: 0, actualPostgresRun: false }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
