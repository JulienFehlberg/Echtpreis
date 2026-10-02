"use strict";

// Private durable traversal generation. The production caller chooses it only
// after reloading the actual checkpoint under its source/store transaction lock.
const { randomUUID } = require("node:crypto");
const Collector = require("./hit-assortment-collector");
const fail = code => Object.assign(new Error(code), { code });
const validId = value => typeof value === "string"
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

function select(state, { cursorDay, terminalOnly = false } = {}) {
  if (!state || typeof state !== "object" || Array.isArray(state) || !Collector.validDay(cursorDay))
    throw fail("hit-refresh-cycle-state-required");
  const previous = state.ordinaryCycleId ?? null;
  if (previous !== null && !validId(previous)) throw fail("hit-refresh-cycle-id-invalid");
  const continuing = state.cursor && state.cursor.version === 2
    && Collector.validDay(state.cursor.cursorDay) && state.cursor.cursorDay === cursorDay;
  if (terminalOnly && !continuing) throw fail("hit-refresh-terminal-cycle-unconfirmed");
  // Adoption of an existing cursor without a durable ID creates a new generation
  // for future work; it cannot retrospectively authenticate an earlier capture.
  return continuing && previous !== null ? previous : randomUUID();
}

module.exports = Object.freeze({ validId, select });
