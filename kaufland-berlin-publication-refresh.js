"use strict";

const crypto = require("node:crypto");
const Publications = require("./kaufland-berlin-publications");
const Store = require("./price-refresh-state-store");
const Backoff = require("./price-refresh-backoff");
const SOURCE = Publications.SOURCE, TABLE = "kaufland_berlin_publication_refresh_state";
const REFRESH_MS = 6 * 3600000, MIN_RETRY_MS = 3600000, TIMEOUT_MS = 15000, MAX_TIME = 8640000000000000;
const schemas = new WeakMap();
let running = false;
const fail = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
function clock(now = Date.now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIME) throw fail("kaufland-refresh-clock-invalid");
  return value;
}
function millis(value) {
  if (value == null) return null;
  const time = new Date(value).getTime();
  if (!Number.isSafeInteger(time) || time < 0) throw fail("kaufland-refresh-state-invalid");
  return time;
}
function state(raw = {}) {
  const revision = Number(raw.revision ?? 0), completedCaptures = Number(raw.completedCaptures ?? 0);
  const received = Number(raw.received ?? 0), accepted = Number(raw.accepted ?? 0);
  if (![revision, completedCaptures, received, accepted].every(Number.isSafeInteger) || revision < 0 || completedCaptures < 0
    || received < 0 || received > Publications.MAX_CARDS || accepted < 0 || accepted > received
    || raw.proofHash != null && !/^[a-f0-9]{64}$/.test(raw.proofHash)
    || raw.lastError != null && (typeof raw.lastError !== "string" || raw.lastError.length > 300)) throw fail("kaufland-refresh-state-invalid");
  millis(raw.lastCompletedAt); millis(raw.nextAttemptAt);
  return { revision, completedCaptures, received, accepted, lastCompletedAt: raw.lastCompletedAt ?? null,
    nextAttemptAt: raw.nextAttemptAt ?? null, lastError: raw.lastError ?? null, proofHash: raw.proofHash ?? null };
}
async function ensure(pool) {
  if (!pool || typeof pool.query !== "function") throw fail("database-required");
  const cacheable = typeof pool.connect === "function" && typeof pool.release !== "function";
  if (cacheable && schemas.has(pool)) return schemas.get(pool);
  const promise = pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(
    source_id text PRIMARY KEY CHECK(source_id='${SOURCE}'),revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
    completed_captures int NOT NULL DEFAULT 0 CHECK(completed_captures>=0),last_completed_at timestamptz CHECK(isfinite(last_completed_at)),
    next_attempt_at timestamptz CHECK(isfinite(next_attempt_at)),last_error text CHECK(length(last_error)<=300),
    proof_hash text CHECK(proof_hash~'^[a-f0-9]{64}$'),received int NOT NULL DEFAULT 0 CHECK(received BETWEEN 0 AND 50),
    accepted int NOT NULL DEFAULT 0 CHECK(accepted BETWEEN 0 AND received),updated_at timestamptz NOT NULL DEFAULT now());`)
    .catch(error => { if (cacheable) schemas.delete(pool); throw error; });
  if (cacheable) schemas.set(pool, promise);
  return promise;
}
async function load(pool) {
  await ensure(pool);
  const rows = (await pool.query(`SELECT revision,completed_captures AS "completedCaptures",last_completed_at AS "lastCompletedAt",
    next_attempt_at AS "nextAttemptAt",last_error AS "lastError",proof_hash AS "proofHash",received,accepted
    FROM ${TABLE} WHERE source_id=$1`, [SOURCE])).rows;
  if (rows.length > 1) throw fail("kaufland-refresh-state-invalid");
  return state(rows[0]);
}
function dueAt(checkpoint, source = {}, snapshot = null, time = Date.now()) {
  const own = state(checkpoint), times = [time, millis(own.nextAttemptAt) ?? 0];
  if (own.lastCompletedAt != null) times.push(Math.min(MAX_TIME, millis(own.lastCompletedAt) + REFRESH_MS));
  if (snapshot?.capturedAt != null) times.push(Math.min(MAX_TIME, millis(snapshot.capturedAt) + REFRESH_MS));
  times.push(millis(source.nextAttemptAt) ?? 0);
  const failures = Number(source.consecutiveFailures || 0);
  if (!Number.isSafeInteger(failures) || failures < 0) throw fail("kaufland-refresh-source-state-invalid");
  if (failures) {
    const attempted = millis(source.lastAttemptAt);
    if (attempted === null) throw fail("kaufland-refresh-source-state-invalid");
    times.push(Math.min(MAX_TIME, attempted + Backoff.delayMs(source)));
  }
  return Math.max(...times);
}
async function schedule(pool, time, deps = {}) {
  const checkpoint = await load(pool), sources = await (deps.store || Store).loadAll(pool);
  const snapshot = await (deps.publications || Publications).latest(pool, { now: time });
  const source = sources[SOURCE] || {};
  return { checkpoint, source, snapshot, due: dueAt(checkpoint, source, snapshot, time) };
}
function continuing(shouldContinue) {
  if (typeof shouldContinue === "function" && shouldContinue() !== true) throw fail("kaufland-refresh-stopped");
}
function retryAfter(headers, time) {
  const value = headers?.get?.("retry-after"), remaining = MAX_TIME - time;
  if (value == null) return Math.min(MIN_RETRY_MS, remaining);
  let delay = 0;
  if (/^\d+$/.test(value)) {
    const seconds = BigInt(value);
    delay = seconds > BigInt(Math.floor(remaining / 1000)) ? remaining : Number(seconds) * 1000;
  } else {
    const target = Date.parse(value); if (Number.isFinite(target) && target > time) delay = target - time;
  }
  return Math.min(remaining, Math.max(MIN_RETRY_MS, delay));
}
function retryDeadline(error, time) {
  const delay = Number(error?.retryAfterMs), remaining = MAX_TIME - time;
  return time + Math.min(remaining, Math.max(MIN_RETRY_MS, Number.isFinite(delay) && delay > 0 ? delay : 0));
}
async function permission(canFetch, shouldContinue) {
  continuing(shouldContinue);
  if (typeof canFetch !== "function") throw fail("kaufland-source-gate-required");
  const allowed = await canFetch();
  continuing(shouldContinue);
  if (allowed !== true) throw fail("kaufland-source-not-eligible", { skipped: true, nextAttemptAt: typeof allowed === "string" ? allowed : null });
}
async function get(url, { fetchImpl = fetch, now = Date.now, canFetch, shouldContinue, timeoutMs = TIMEOUT_MS } = {}) {
  const maxBytes = url === Publications.PAGE_URL ? Publications.MAX_HTML_BYTES : url === Publications.INDEX_URL ? Publications.MAX_INDEX_BYTES : null;
  if (!maxBytes) throw fail("kaufland-unreviewed-source-url");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > TIMEOUT_MS) throw fail("kaufland-request-budget-invalid");
  await permission(canFetch, shouldContinue); clock(now);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  let response, reader;
  try {
    try { response = await fetchImpl(url, { method: "GET", credentials: "omit", redirect: "error", signal: controller.signal,
      headers: { Accept: url === Publications.PAGE_URL ? "text/html" : "application/json", "User-Agent": "CaddyPriceResearch/1.0 (public dated branch offer observation)" } }); }
    catch (cause) { throw fail(controller.signal.aborted ? "kaufland-source-timeout" : "kaufland-source-fetch-failed", { cause, requestStarted: true }); }
    if (response.status !== 200) {
      await response.body?.cancel?.().catch(() => {});
      throw fail("kaufland-source-http-" + response.status, { status: response.status, requestStarted: true, retryAfterMs: retryAfter(response.headers, clock(now)) });
    }
    if (response.url !== url) throw fail("kaufland-source-response-url-conflict", { requestStarted: true });
    const contentType = response.headers?.get?.("content-type"), expectedType = url === Publications.PAGE_URL ? /^text\/html(?:\s*;|$)/i : /^application\/json(?:\s*;|$)/i;
    if (!expectedType.test(contentType || "")) throw fail("kaufland-source-content-type-invalid", { requestStarted: true });
    const declared = response.headers?.get?.("content-length");
    if (declared != null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw fail("kaufland-source-byte-budget", { requestStarted: true });
    const chunks = []; let size = 0;
    if (response.body?.getReader) {
      reader = response.body.getReader();
      while (true) {
        continuing(shouldContinue);
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength; if (size > maxBytes) { await reader.cancel(); throw fail("kaufland-source-byte-budget", { requestStarted: true }); }
        chunks.push(Buffer.from(part.value));
      }
    } else {
      const bytes = Buffer.from(await response.arrayBuffer()); size = bytes.length;
      if (size > maxBytes) throw fail("kaufland-source-byte-budget", { requestStarted: true }); chunks.push(bytes);
    }
    if (!size) throw fail("kaufland-source-empty-body", { requestStarted: true });
    const bytes = Buffer.concat(chunks); let body;
    try { body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw fail("kaufland-source-utf8-required", { requestStarted: true }); }
    const time = clock(now), date = response.headers.get("date"), age = response.headers.get("age"), dateTime = Date.parse(date);
    if (!Number.isFinite(dateTime) || Math.abs(dateTime - time) > 300000 || age !== null && (!/^\d+$/.test(age) || Number(age) > 300))
      throw fail("kaufland-source-original-http-time-required", { requestStarted: true });
    const sourceResponseHash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (Publications.hash(body) !== sourceResponseHash) throw fail("kaufland-source-utf8-hash-conflict", { requestStarted: true });
    continuing(shouldContinue);
    return { status: 200, sourceResponseUrl: url, sourceResponseHash, body, capturedAt: new Date(time).toISOString(),
      headers: { date, age, "content-type": contentType }, bytes: size };
  } catch (error) {
    // Permission precedes this block; every error here follows an actual GET.
    if (error && typeof error === "object") error.requestStarted = true;
    throw error;
  } finally {
    if (reader) { try { reader.releaseLock?.(); } catch {} }
    controller.abort(); clearTimeout(timer);
  }
}
async function capture(options = {}) {
  let requests = 0, bytes = 0;
  const one = async url => {
    try { const record = await get(url, options); requests++; bytes += record.bytes; return record; }
    catch (error) { if (error.requestStarted) requests++; throw error; }
  };
  try {
    const branch = await one(Publications.PAGE_URL);
    await (options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))(1000);
    // get() rechecks both actual source lease and lifecycle after this pause.
    const index = await one(Publications.INDEX_URL);
    continuing(options.shouldContinue);
    Publications.parseCapture({ branch, index }, { now: clock(options.now) });
    return { raw: { branch, index }, requests, bytes };
  } catch (error) { throw Object.assign(error, { requests, bytes }); }
}
async function checkpoint(tx, expected, saved, time) {
  if (!tx || typeof tx.query !== "function" || typeof tx.release !== "function"
    || !(await tx.query("SELECT pg_current_xact_id_if_assigned()::text AS id")).rows[0]?.id) throw fail("kaufland-writing-transaction-required");
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [SOURCE + ":refresh-checkpoint"]);
  const actual = (await tx.query(`SELECT revision FROM ${TABLE} WHERE source_id=$1 FOR UPDATE`, [SOURCE])).rows[0];
  if (Number(actual?.revision ?? 0) !== expected.revision) throw fail("kaufland-refresh-checkpoint-moved");
  const nextAttemptAt = new Date(Math.min(MAX_TIME, time + REFRESH_MS)).toISOString();
  await tx.query(`INSERT INTO ${TABLE}(source_id,revision,completed_captures,last_completed_at,next_attempt_at,last_error,proof_hash,received,accepted)
    VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8) ON CONFLICT(source_id) DO UPDATE SET revision=EXCLUDED.revision,
    completed_captures=EXCLUDED.completed_captures,last_completed_at=EXCLUDED.last_completed_at,next_attempt_at=EXCLUDED.next_attempt_at,
    last_error=NULL,proof_hash=EXCLUDED.proof_hash,received=EXCLUDED.received,accepted=EXCLUDED.accepted,updated_at=now()`,
  [SOURCE, expected.revision + 1, expected.completedCaptures + 1, Store.timestampParameter(new Date(time).toISOString()),
    Store.timestampParameter(nextAttemptAt), saved.proofHash, saved.received, saved.accepted]);
  return nextAttemptAt;
}
async function saveFailure(pool, expected, error, time) {
  const nextAttemptAt = new Date(retryDeadline(error, time)).toISOString();
  const result = await pool.query(`INSERT INTO ${TABLE}(source_id,revision,last_error,next_attempt_at) VALUES($1,$2,$3,$4)
    ON CONFLICT(source_id) DO UPDATE SET revision=${TABLE}.revision+1,last_error=EXCLUDED.last_error,next_attempt_at=EXCLUDED.next_attempt_at,updated_at=now()
    WHERE ${TABLE}.revision=$5 RETURNING revision`, [SOURCE, expected.revision + 1, String(error.code || error.message || "kaufland-refresh-failed").slice(0, 300),
    Store.timestampParameter(nextAttemptAt), expected.revision]);
  if (result.rowCount !== 1) throw fail("kaufland-refresh-checkpoint-moved");
  return nextAttemptAt;
}
async function refresh({ pool, now = Date.now, leaseOwner } = {}, deps = {}) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.release === "function") throw fail("kaufland-refresh-pool-required");
  if (typeof leaseOwner !== "string" || !leaseOwner.trim() || leaseOwner.length > 200) throw fail("kaufland-source-lease-owner-required");
  if (running) return { received: 0, accepted: 0, skipped: "already-running" };
  running = true; let expected, observed;
  try {
    const started = clock(now), initial = await schedule(pool, started, deps); expected = initial.checkpoint;
    if (initial.due > started) return { received: 0, accepted: 0, skipped: "source-not-due", nextAttemptAt: new Date(initial.due).toISOString() };
    const canFetch = async () => {
      continuing(deps.shouldContinue);
      const time = clock(now), current = await schedule(pool, time, deps), until = millis(current.source.leaseUntil);
      if (current.due > time) return new Date(current.due).toISOString();
      if (current.checkpoint.revision !== expected.revision || current.source.leaseOwner !== leaseOwner || until === null || until <= time)
        return new Date(Math.min(MAX_TIME, time + MIN_RETRY_MS)).toISOString();
      continuing(deps.shouldContinue); return true;
    };
    const publications = deps.publications || Publications;
    await publications.ensure(pool);
    try {
      observed = await capture({ fetchImpl: deps.fetchImpl, now, canFetch, shouldContinue: deps.shouldContinue, sleep: deps.sleep });
      continuing(deps.shouldContinue); await permission(canFetch, deps.shouldContinue);
      const tx = await pool.connect(); let rollbackError;
      try {
        await tx.query("BEGIN"); await tx.query("SELECT txid_current()");
        continuing(deps.shouldContinue);
        const saved = await publications.persist(tx, observed.raw, { now: clock(now) });
        const nextAttemptAt = await checkpoint(tx, expected, saved, clock(now));
        continuing(deps.shouldContinue); await tx.query("COMMIT");
        return { ...saved, sourceId: SOURCE, requests: observed.requests, bytes: observed.bytes, nextAttemptAt,
          current: false, fullAssortment: false, nativeProductIdentities: 0, currentPhysicalPriceImports: 0 };
      } catch (error) { try { await tx.query("ROLLBACK"); } catch (rollback) { rollbackError = rollback; } throw error; }
      finally { tx.release(rollbackError); }
    } catch (error) {
      if (error.code === "kaufland-refresh-stopped") return { received: 0, accepted: 0, requests: error.requests ?? observed?.requests ?? 0, skipped: "server-stopping" };
      if (error.skipped) return { received: 0, accepted: 0, requests: error.requests ?? observed?.requests ?? 0,
        bytes: error.bytes ?? observed?.bytes ?? 0, skipped: "source-not-eligible", nextAttemptAt: error.nextAttemptAt };
      try { error.nextAttemptAt = await saveFailure(pool, expected, error, clock(now)); }
      catch (persistenceError) { error.failurePersistenceError = persistenceError; }
      throw Object.assign(error, { requests: error.requests ?? observed?.requests ?? 0, bytes: error.bytes ?? observed?.bytes ?? 0 });
    }
  } finally { running = false; }
}
async function resumeAt(pool, time = Date.now()) { return new Date((await schedule(pool, time)).due).toISOString(); }
async function status(pool, time = Date.now()) {
  const scheduled = await schedule(pool, time);
  return { sourceId: SOURCE, ...scheduled.checkpoint, nextAttemptAt: new Date(scheduled.due).toISOString(), refreshIntervalMinutes: REFRESH_MS / 60000,
    maximumOrdinaryRequests: 2, current: false, fullAssortment: false, nativeProductIdentities: 0, currentPhysicalPriceImports: 0,
    scopeCity: "Berlin", scopeCountry: "DE", scopeChannel: Publications.CHANNEL, physicalStorePriceVerified: false, normalPriceClassificationVerified: false };
}
module.exports = { SOURCE, TABLE, REFRESH_MS, MIN_RETRY_MS, TIMEOUT_MS, ensure, load, state, dueAt, retryAfter, get, capture, checkpoint, refresh, status, resumeAt };
