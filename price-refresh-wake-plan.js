"use strict";
// Pure scheduling diagnostics. No network, database, collection or lease API.
const Sources = require("./price-sources");
const Refresh = require("./price-source-refresh");
const Backoff = require("./price-refresh-backoff");
const MIN_WAKE_MS = 1000;
function object(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return true;
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  // Real plain objects can originate in a VM/other realm. Match that realm's
  // intrinsic Object prototype, not this module's prototype identity.
  return Object.getPrototypeOf(prototype) === null && typeof constructor === "function" && constructor.prototype === prototype
    && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object);
}
function timestamp(value) {
  if (value === null || value === undefined) return { absent: true, value: null };
  if (typeof value === "object" && Object.prototype.toString.call(value) === "[object Date]") {
    let time; try { time = Date.prototype.getTime.call(value); } catch { return { invalid: true }; }
    return Number.isFinite(time) ? { value: time } : { invalid: true };
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return { invalid: true };
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().replace(/\.000Z$/, "Z") === value.replace(/\.000Z$/, "Z") ? { value: time } : { invalid: true };
}
function inspect(states = {}, handlers = {}, options = {}) {
  const now = options?.now, fallback = options?.nextFallbackAt, owner = options?.owner;
  if (!object(states) || !object(handlers) || !object(options) || options.registry !== undefined && !object(options.registry)
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(fallback) || fallback < now || typeof owner !== "string" || !owner.trim()) return { candidates: [], blocked: [{ reason: "invalid-scheduler-context" }], nextFallbackAt: fallback };
  const registry = options.registry || Sources.SOURCES, candidates = [], blocked = [];
  for (const [name, source] of Object.entries(registry)) {
    if (!object(source) || source.active !== true) continue;
    const handler = (Object.hasOwn(handlers, name) ? handlers[name] : null) || (Object.hasOwn(handlers, source.type) ? handlers[source.type] : null);
    if (typeof handler !== "function") continue;
    const state = Object.hasOwn(states, name) ? states[name] : {};
    if (!object(state)) { blocked.push({ name, reason: "invalid-source-state" }); continue; }
    const values = Object.fromEntries(["nextAttemptAt", "lastAttemptAt", "lastSuccessAt", "leaseUntil"].map(key => [key, timestamp(state[key])]));
    if (Object.values(values).some(value => value.invalid)) { blocked.push({ name, reason: "invalid-source-timestamp" }); continue; }
    const failures = state.consecutiveFailures ?? 0;
    if (!Number.isSafeInteger(failures) || failures < 0 || failures > 0 && values.lastAttemptAt.absent) { blocked.push({ name, reason: "invalid-failure-state" }); continue; }
    const leaseOwner = state.leaseOwner;
    if (!values.leaseUntil.absent && (typeof leaseOwner !== "string" || !leaseOwner.trim()) || values.leaseUntil.absent && leaseOwner !== null && leaseOwner !== undefined) { blocked.push({ name, reason: "invalid-lease-state" }); continue; }
    const last = values.lastSuccessAt.absent ? values.lastAttemptAt : values.lastSuccessAt;
    const sourceDueAt = values.nextAttemptAt.absent ? last.absent ? now : last.value + Refresh.interval(source) : values.nextAttemptAt.value;
    const backoffUntil = failures ? values.lastAttemptAt.value + Backoff.delayMs(state) : 0;
    // PostgreSQL acquire blocks every live lease, including an old lease with
    // this owner. Conservatively retaining it avoids repeated empty wakeups.
    const leaseUntil = values.leaseUntil.absent || values.leaseUntil.value <= now ? 0 : values.leaseUntil.value;
    const eligibleAt = Math.max(sourceDueAt, backoffUntil, leaseUntil);
    if (!Number.isSafeInteger(eligibleAt)) { blocked.push({ name, reason: "invalid-source-deadline" }); continue; }
    candidates.push({ name, sourceDueAt, hasRecordedDeadline: Object.values(values).some(value => !value.absent), backoffUntil: backoffUntil || null, leaseUntil: leaseUntil || null,
      foreignLease: !!leaseUntil && leaseOwner !== owner, eligibleAt });
  }
  candidates.sort((a, b) => a.eligibleAt - b.eligibleAt || a.name.localeCompare(b.name));
  return { candidates, blocked, nextFallbackAt: fallback };
}
function decision(states = {}, handlers = {}, options = {}) {
  const evaluated = inspect(states, handlers, options), now = options?.now;
  // Only a real future deadline authorizes an additional wake. Sources with
  // no first-run history or no progress/new deadline stay on the fallback.
  const candidate = evaluated.candidates.find(value => value.eligibleAt > now) || null;
  const wakeAt = candidate ? Math.max(now + MIN_WAKE_MS, candidate.eligibleAt) : null;
  return { shouldArm: wakeAt !== null && wakeAt < evaluated.nextFallbackAt, candidate, wakeAt, delayMs: wakeAt === null ? null : wakeAt - now, nextFallbackAt: evaluated.nextFallbackAt, blocked: evaluated.blocked };
}
function candidateFor(states, handlers, options, name) {
  // A removed scheduling record cannot inherit the old timer's authority as
  // a new first-run source. The ordinary fallback handles that initial state.
  return inspect(states, handlers, options).candidates.find(candidate => candidate.name === name && candidate.hasRecordedDeadline) || null;
}
module.exports = Object.freeze({ decision, candidateFor, timestamp, MIN_WAKE_MS });
