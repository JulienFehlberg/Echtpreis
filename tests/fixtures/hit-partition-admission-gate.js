"use strict";
// Entirely synthetic source responses; never live, admitted or renewed evidence.
const F = require("./hit-brand-partition");
const B = require("./hit-brand-partition-refresh");
const L = require("./hit-list-gap");
const Collector = require("../../hit-assortment-collector");
const Import = require("../../hit-price-import");
const Gate = require("../../hit-partition-admission-gate");
const clone = structuredClone;
function price(raw, value = "1.35") {
  const row = clone(raw), [euros, cents] = value.split(".");
  row.price = value; row.priceTag.priceEuro = euros; row.priceTag.priceCent = cents; return row;
}
function state(batch, completedCycles = 0) { return { cursor: clone(batch.previous), completedCycles }; }
function snapshot(batch, selected = null, completedCycles = 0) {
  const checked = Gate.evaluate(batch.result, state(batch, completedCycles), { now: batch.time });
  return { version: 1, record: clone(batch.result.brandPartitionProbe),
    acceptedRefs: clone(selected === null ? checked.candidateRefs : checked.candidateRefs.filter(ref => selected.includes(ref.retailerSku))),
    ordinaryCycle: clone(checked.ordinaryCycle) };
}
async function threeNodeBatch(options = {}) {
  const prior = L.cursor([F.node(), L.node("4261911"), L.node("4262000")], options.now ?? F.NOW);
  return B.batch({ previous: prior, ...options });
}
async function continuation(cursor, rows, { now = F.NOW + 60000 } = {}) {
  const prior = clone(cursor), node = prior.pending[0], next = F.page({ now, category: node, total: rows.length,
    rows: rows.map(raw => ({ ...raw, url: node.url + "/synthetic-product-" + raw.external_id })) });
  const h = L.harness({ [node.url]: next.body }, { now, maxRequests: 3 });
  const result = await Collector.collect({ ...h.options, storeProfile: Import.STORE_PROFILE, cursor: prior,
    brandProbeEnabled: false, brandPartitionProbeEnabled: false });
  return { previous: prior, result, time: h.options.now(), calls: h.calls };
}
async function resetBatch({ now = F.NOW + 20 * 3600000, first = F.row(41) } = {}) {
  const root = { ...L.node("4261253", 1), count: 80 }, rows = [first, ...Array.from({ length: 39 }, (_, i) => F.row(i + 100))];
  const removeCategory = (data, params) => { delete data.meta.category; delete params.for_category; };
  const index = F.page({ now, category: root, total: 80, rows, edit: removeCategory });
  const overview = F.page({ now, category: root, total: 80, rows, edit: removeCategory });
  const h = L.harness({ "https://www.hit.de/sortiment": index.body, "https://www.hit.de/sortiment/uebersicht": overview.body }, { now, maxRequests: 4 });
  const originalDateNow = Date.now; let result;
  // Native.proof retains its real-clock future guard. Move the entire synthetic
  // collector clock together; never loosen the production parser for fixtures.
  try { Date.now = h.options.now; result = await Collector.collect({ ...h.options, storeProfile: Import.STORE_PROFILE, cursor: null,
    brandProbeEnabled: false, brandPartitionProbeEnabled: false }); } finally { Date.now = originalDateNow; }
  return { result, previous: null, time: h.options.now(), calls: h.calls };
}
module.exports = { ...F, batch: B.batch, state, snapshot, threeNodeBatch, continuation, resetBatch, price, clone };
