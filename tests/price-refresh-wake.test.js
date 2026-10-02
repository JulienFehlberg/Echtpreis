"use strict";
const assert = require("node:assert/strict"), vm = require("node:vm"), { EventEmitter } = require("node:events"), Schedule = require("../price-refresh-wake-plan"), Wake = require("../price-refresh-wake-timer");
const Runner = require("../price-refresh-runner"), Lifecycle = require("../server-lifecycle"), Sources = require("../price-sources");
const NAME = "HIT Berlin store assortment", OWNER = "synthetic-test-instance", BASE = Date.parse("2026-10-02T03:00:00.000Z"), iso = value => new Date(value).toISOString();
const cases = [], evidence = [], test = (name, run) => cases.push({ name, run });
class Clock {
  constructor() { this.now = BASE; this.serial = 0; this.timers = new Map(); }
  setTimer = (callback, delay, interval = null) => { const id = ++this.serial; this.timers.set(id, { id, callback, at: this.now + delay, interval }); return id; };
  clearTimer = id => this.timers.delete(id);
  flush = async () => { for (let count = 0; count < 80; count++) await Promise.resolve(); };
  async advance(ms) {
    const target = this.now + ms; await this.flush();
    let visits = 0;
    while (true) {
      const next = [...this.timers.values()].filter(timer => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break; assert(++visits < 500, "No busy scheduling loop"); this.now = next.at;
      if (next.interval) next.at += next.interval; else this.timers.delete(next.id);
      next.callback(); await this.flush();
    }
    this.now = target; await this.flush();
  }
}
function plan(state = {}, patch = {}) {
  return Schedule.decision({ [NAME]: state }, { [NAME]: () => {} }, { now: BASE, nextFallbackAt: BASE + 60000, owner: OWNER, ...patch });
}
function harness({ duration = 8000, extraWake = true, fail = null, pause = 60000, skipped = false } = {}) {
  const clock = new Clock(), states = {}, runs = [], events = [], tasks = new Set(); let running = false, concurrent = 0, maxConcurrent = 0, nextFallbackAt = BASE + 60000, interval, wake;
  // Keep unrelated real registry entries non-due. Their configured server
  // handlers are not simulated or called by this isolated test.
  for (const [name, source] of Object.entries(Sources.SOURCES)) if (source.active && name !== NAME) states[name] = { nextAttemptAt: iso(BASE + 86400000) };
  const handlers = { [NAME]: async () => {
    runs.push({ start: clock.now }); concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise(resolve => clock.setTimer(resolve, duration)); concurrent--; runs[runs.length - 1].finish = clock.now;
    if (fail) throw Object.assign(new Error("Synthetic source refusal"), { code: fail, nextAttemptAt: iso(clock.now + pause) });
    if (skipped) return { skipped: "no-targets" };
    return { received: 6, accepted: 6, nextAttemptAt: iso(clock.now + pause) };
  } };
  const lifecycle = Lifecycle.create({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, stopScheduling: () => { events.push("stop"); clock.clearTimer(interval); wake.stop(); }, closeServer: () => events.push("http-close"), closePool: () => events.push("pool-end") });
  async function batch() {
    if (running || lifecycle.isStopping()) return { skipped: "server-stopping" }; running = true;
    try { return await Runner.runDue(states, handlers, { nowMs: clock.now, shouldContinue: () => !lifecycle.isStopping(), acquire: async name => { events.push("acquire:" + name); return true; }, persist: async name => events.push("persist:" + name), release: async name => events.push("release:" + name) }); }
    finally { running = false; if (extraWake && !lifecycle.isStopping()) wake.arm(); }
  }
  function launch() { const promise = lifecycle.runJob(batch); tasks.add(promise); promise.then(() => tasks.delete(promise), () => tasks.delete(promise)); return promise; }
  wake = Wake.create({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, getStates: () => states, getHandlers: () => handlers,
    getContext: () => ({ now: clock.now, nextFallbackAt, owner: OWNER }), isStopping: lifecycle.isStopping, isRunning: () => running, onWake: launch });
  interval = clock.setTimer(() => { nextFallbackAt = clock.now + 60000; if (extraWake) wake.beforeFallback(); launch(); }, 60000, 60000);
  launch();
  return { clock, states, runs, events, lifecycle, wake, launch, tasks, maxConcurrent: () => maxConcurrent, isRunning: () => running, setFallback: value => { nextFallbackAt = value; } };
}
test("real runner reproduction: eight-second HIT jobs run at 0/120 with fallback and 0/68 with wake", async () => {
  const baseline = harness({ extraWake: false }); await baseline.clock.advance(248000); assert.deepEqual(baseline.runs.map(row => (row.start - BASE) / 1000), [0, 120, 240]);
  const improved = harness(); await improved.clock.advance(248000); assert.deepEqual(improved.runs.map(row => (row.start - BASE) / 1000), [0, 68, 136, 204]);
  assert.equal(improved.runs[1].start - improved.runs[0].finish, 60000, "No shortening of the native pause"); assert.equal(improved.maxConcurrent(), 1);
  evidence.push({ kind: "synthetic-real-runner-eight-second-job", baseline: baseline.runs.map(row => ({ startSeconds: (row.start - BASE) / 1000, finishSeconds: (row.finish - BASE) / 1000 })), withDeadlineWake: improved.runs.map(row => ({ startSeconds: (row.start - BASE) / 1000, finishSeconds: (row.finish - BASE) / 1000 })), nativePauseMs: 60000, maxConcurrent: improved.maxConcurrent() });
});
test("foreign and retained own leases take precedence over earlier source due time", () => {
  for (const leaseOwner of ["other-instance", OWNER]) {
    const result = plan({ nextAttemptAt: iso(BASE + 5000), leaseOwner, leaseUntil: new Date(BASE + 30000) }); assert.equal(result.candidate.eligibleAt, BASE + 30000); assert.equal(result.delayMs, 30000); assert.equal(result.candidate.foreignLease, leaseOwner !== OWNER);
  }
  assert.equal(plan({ nextAttemptAt: iso(BASE + 5000), leaseOwner: "other", leaseUntil: iso(BASE - 1) }).delayMs, 5000);
});
test("native two-hour Retry-After and a longer exponential failure backoff cannot be bypassed", () => {
  const sourceDelay = plan({ nextAttemptAt: iso(BASE + 7200000), consecutiveFailures: 1, lastAttemptAt: iso(BASE) }); assert.equal(sourceDelay.candidate.eligibleAt, BASE + 7200000); assert.equal(sourceDelay.shouldArm, false);
  const longer = plan({ nextAttemptAt: iso(BASE + 7200000), consecutiveFailures: 9, lastAttemptAt: iso(BASE) }); assert.equal(longer.candidate.eligibleAt, BASE + 15360000); assert.equal(longer.shouldArm, false);
});
test("a real runner source failure retains its native two-hour pause through repeated fallback ticks", async () => {
  const h = harness({ fail: "hit-source-http-429", pause: 7200000 }); await h.clock.advance(180000); assert.equal(h.runs.length, 1); assert.equal(h.states[NAME].nextAttemptAt, iso(BASE + 8000 + 7200000)); assert.equal(h.wake.hasTimer(), false);
});
test("source changes after arming invalidate the captured wake without a new acquire", async () => {
  const h = harness(); await h.clock.advance(61000); assert.equal(h.wake.hasTimer(), true); const count = h.events.filter(event => event.startsWith("acquire:")).length;
  h.states[NAME].nextAttemptAt = iso(BASE + 7200000); await h.clock.advance(8000); assert.equal(h.runs.length, 1); assert.equal(h.events.filter(event => event.startsWith("acquire:")).length, count); assert.equal(h.wake.hasTimer(), false);
});
test("a newly published foreign lease also cancels a previously armed due wake", async () => {
  const h = harness(); await h.clock.advance(61000); Object.assign(h.states[NAME], { leaseOwner: "other", leaseUntil: iso(BASE + 7200000) }); await h.clock.advance(8000); assert.equal(h.runs.length, 1); assert.equal(h.wake.hasTimer(), false);
});
test("early fallback cancels and coherently re-evaluates a stale extra timer; arm never accumulates timers", async () => {
  const clock = new Clock(); let state = { nextAttemptAt: iso(BASE + 30000) }, woke = 0;
  const wake = Wake.create({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, getStates: () => ({ [NAME]: state }), getHandlers: () => ({ [NAME]: () => {} }), getContext: () => ({ now: clock.now, nextFallbackAt: BASE + 60000, owner: OWNER }), isStopping: () => false, isRunning: () => false, onWake: () => woke++ });
  wake.arm(); wake.arm(); wake.arm(); assert.equal(clock.timers.size, 1); await clock.advance(10000); wake.beforeFallback(); assert.equal(clock.timers.size, 0);
  state = { nextAttemptAt: iso(BASE + 50000) }; wake.arm(); await clock.advance(20000); assert.equal(woke, 0); await clock.advance(20000); assert.equal(woke, 1); assert.equal(clock.timers.size, 0);
});
test("slow admitted batches remain single and reserve their sixty-second source pause", async () => {
  const h = harness({ duration: 130000 }); await h.clock.advance(200000); assert.deepEqual(h.runs.map(row => (row.start - BASE) / 1000), [0, 190]); assert.equal(h.runs[0].finish, BASE + 130000); assert.equal(h.maxConcurrent(), 1); assert.equal(h.runs[1].start - h.runs[0].finish, 60000);
  // Finish this deliberately slow admitted handler before another test uses
  // the actual runner's module-scoped source lock. No lease is cleared early.
  h.lifecycle.stop(); await h.clock.advance(130000);
});
test("signal during an admitted handler clears both timers, drains its release and starts no next acquire", async () => {
  const h = harness(), signals = new EventEmitter(); let finish; const finishing = new Promise(resolve => { finish = resolve; });
  const remove = Lifecycle.installSignals(h.lifecycle, { target: signals, onComplete: finish }); await h.clock.advance(4000); signals.emit("SIGTERM"); signals.emit("SIGINT"); await h.clock.advance(4000); const result = await finishing; remove();
  assert.deepEqual(result, { ok: true, timedOut: false }); assert.equal(h.runs.length, 1); assert.equal(h.runs[0].finish, BASE + 8000); assert.equal(h.events.filter(event => event.startsWith("acquire:")).length, 1); assert.equal(h.events.filter(event => event.startsWith("release:")).length, 1); assert(h.events.indexOf("pool-end") > h.events.indexOf("release:" + NAME)); assert.equal(h.clock.timers.size, 0);
  await h.clock.advance(180000); assert.equal(h.runs.length, 1); assert.equal(h.wake.hasTimer(), false);
});
test("malformed state or removed configuration after arming cannot use a stale timer capability", async () => {
  for (const change of ["invalid-state", "handler-removed", "deadline-removed"]) {
    const clock = new Clock(), state = { nextAttemptAt: iso(BASE + 30000) }, handlers = { [NAME]: () => {} }; let woke = 0;
    const wake = Wake.create({ setTimer: clock.setTimer, clearTimer: clock.clearTimer, getStates: () => ({ [NAME]: state }), getHandlers: () => handlers, getContext: () => ({ now: clock.now, nextFallbackAt: BASE + 60000, owner: OWNER }), isStopping: () => false, isRunning: () => false, onWake: () => woke++ });
    wake.arm(); if (change === "invalid-state") state.nextAttemptAt = "broken"; else if(change === "deadline-removed") delete state.nextAttemptAt; else delete handlers[NAME]; await clock.advance(30000); assert.equal(woke, 0); assert.equal(clock.timers.size, 0);
  }
});
test("stop after a wake is armed clears it and suppresses all future source jobs", async () => {
  const h = harness(); await h.clock.advance(61000); assert(h.wake.hasTimer()); const result = await h.lifecycle.shutdown(); assert(result.ok); assert.equal(h.clock.timers.size, 0); await h.clock.advance(180000); assert.equal(h.runs.length, 1);
});
test("malformed and unknown source timestamps fail closed; optional missing state uses ordinary source defaults", () => {
  for (const value of ["broken", "2026-02-30T03:00:00Z", "2026-10-02", "", 0, NaN, {}, new Date(NaN)]) for (const key of ["nextAttemptAt", "lastAttemptAt", "lastSuccessAt", "leaseUntil"]) {
    const result = plan({ [key]: value, ...(key === "leaseUntil" ? { leaseOwner: "other" } : {}) }); assert.equal(result.shouldArm, false); assert.equal(result.candidate, null); assert.equal(result.blocked[0].reason, "invalid-source-timestamp");
  }
  for (const state of [{ consecutiveFailures: "2" }, { consecutiveFailures: -1 }, { consecutiveFailures: 1 }, { leaseOwner: "other" }, { leaseUntil: iso(BASE + 30000) }]) assert.equal(plan(state).candidate, null);
  assert.equal(plan({ nextAttemptAt: new Date(BASE + 30000) }).delayMs, 30000); assert.equal(plan({}).candidate, null);
});
test("unknown, disabled and unconfigured sources cannot authorize a deadline wake", () => {
  assert.equal(Schedule.decision({ Unknown: { nextAttemptAt: iso(BASE + 1000) } }, { Unknown: () => {} }, { now: BASE, nextFallbackAt: BASE + 60000, owner: OWNER }).candidate, null);
  const registry = { inactive: { active: false, type: "retailer", refreshMs: 60000 }, noHandler: { active: true, type: "retailer", refreshMs: 60000 }, [NAME]: Sources.SOURCES[NAME] };
  assert.equal(Schedule.decision({ [NAME]: { nextAttemptAt: iso(BASE + 30000) } }, { inactive: () => {}, [NAME]: () => {} }, { now: BASE, nextFallbackAt: BASE + 60000, owner: OWNER, registry }).candidate.name, NAME);
  assert.equal(Schedule.decision({}, {}, { now: BASE, nextFallbackAt: BASE + 60000, owner: OWNER }).candidate, null);
});
test("fallback at the deadline wins ties and invalid scheduler context never arms work", () => {
  assert.equal(plan({ nextAttemptAt: iso(BASE + 60000) }).shouldArm, false); assert.equal(plan({}, { nextFallbackAt: BASE }).shouldArm, false);
  for (const patch of [{ now: NaN }, { owner: null }, { nextFallbackAt: BASE - 1 }]) assert.equal(plan({}, patch).shouldArm, false);
});
test("malformed containers and source state cannot become an implicitly empty first-run source", () => {
  const context = { now: BASE, nextFallbackAt: BASE + 60000, owner: OWNER };
  for (const value of [null, [], "bad", 1, new Date(BASE), /invalid/, new Error("invalid")]) {
    assert.equal(Schedule.decision(value, { [NAME]: () => {} }, context).candidate, null);
    assert.equal(Schedule.decision({}, value, context).candidate, null);
    assert.equal(Schedule.decision({}, { [NAME]: () => {} }, { ...context, registry: value }).candidate, null);
    assert.equal(Schedule.decision({ [NAME]: value }, { [NAME]: () => {} }, context).candidate, null);
  }
  const inherited = Object.create({ [NAME]: () => {} }); assert.equal(Schedule.decision({}, inherited, context).candidate, null);
  assert.equal(Schedule.decision({ [NAME]: { nextAttemptAt: iso(BASE + 30000) } }, { official_retailer: () => {} }, context).candidate.name, NAME, "Explicit type handlers retain the existing runner contract");
});
test("missing first history and already due sources never authorize a one-second extra loop", () => {
  for (const state of [{}, { nextAttemptAt: iso(BASE) }, { nextAttemptAt: iso(BASE - 1) }, { lastAttemptAt: iso(BASE - 900001) }, { nextAttemptAt: iso(BASE - 1), consecutiveFailures: 1, lastAttemptAt: iso(BASE - 60001) }]) {
    const result = plan(state); assert.equal(result.shouldArm, false); assert.equal(result.candidate, null);
  }
  const soon = plan({ nextAttemptAt: iso(BASE + 1) }); assert.equal(soon.shouldArm, true); assert.equal(soon.delayMs, 1000, "A tiny real future deadline remains bounded");
});
test("real runner skipped without progress stays on initial/fallback ticks instead of reacquiring every second", async () => {
  const h = harness({ skipped: true }); await h.clock.advance(188000); assert.deepEqual(h.runs.map(row => (row.start - BASE) / 1000), [0, 60, 120, 180]); assert.equal(h.events.filter(event => event.startsWith("acquire:")).length, 4); assert.equal(h.wake.hasTimer(), false); assert.equal(h.states[NAME].nextAttemptAt, undefined);
});
test("plain objects and real Dates across VM realms work while custom/inherited prototypes remain closed", () => {
  const foreign = vm.runInNewContext('({states:{"HIT Berlin store assortment":{nextAttemptAt:new Date(' + (BASE + 30000) + ')}},handlers:{"HIT Berlin store assortment":()=>{}},options:{now:' + BASE + ',nextFallbackAt:' + (BASE + 60000) + ',owner:"synthetic-test-instance"}})');
  assert.equal(Schedule.decision(foreign.states, foreign.handlers, foreign.options).delayMs, 30000);
  const custom = Object.create(null); custom.constructor = Object;
  for (const value of [Object.create(custom), Object.create({ inherited: () => {} }), new (class Custom {})(), vm.runInNewContext('new (class Custom {})()')]) assert.equal(Schedule.decision(value, foreign.handlers, foreign.options).candidate, null);
  const spoof = { [Symbol.toStringTag]: "Date" }; assert.equal(Schedule.timestamp(spoof).invalid, true);
});
(async () => {
  const actualNow = Date.now, failures = [];
  for (const { name, run } of cases) try {
    // Each real runner test injects its fake epoch through ctx.nowMs; actual
    // elapsed runner metrics are irrelevant to the deadline assertions.
    await run();
  } catch (error) { failures.push(name + ": " + error.stack); }
  finally { Date.now = actualNow; }
  if (failures.length) { console.error(failures.join("\n\n")); process.exitCode = 1; }
  else { console.log("price-refresh-wake: OK (" + cases.length + " fake-clock and real-runner cases; zero source, DB or repository writes)"); console.log(JSON.stringify({ evidence })); }
})();
