"use strict";

// Disabled, pure comparison gate. No fetch, DB, import or source capability.
// The production caller must still authenticate actual durable state/refs under
// its existing source advisory/checkpoint transaction before any later use.
const crypto = require("node:crypto");
const same = require("node:util").isDeepStrictEqual;
const Collector = require("./hit-assortment-collector");
const Binding = require("./hit-brand-partition-binding");
const Partition = require("./hit-native-brand-partition");
const Native = require("./hit-assortment-client");
const Import = require("./hit-price-import");
const Identity = require("./product-identity");
const Discovery = require("./price-query-discovery");
const Clock = require("./current-price-query-service");
const fail = code => Object.assign(new Error(code), { code });
const plain = x => x && typeof x === "object" && !Array.isArray(x)
  && [null, Object.prototype].includes(Object.getPrototypeOf(x));
const hash = x => crypto.createHash("sha256").update(x).digest("hex");
const sku = x => typeof x === "string" && /^\d{1,24}[A-Z]{1,3}$/.test(x);
const gtin = x => typeof x === "string" && /^(?:\d{8}|\d{12,14})$/.test(x) && Identity.gtinValid(x);
const code = suffix => "hit-partition-admission-" + suffix;
function clock(options) {
  const now = typeof options?.now === "function" ? options.now() : options?.now;
  if (!Number.isSafeInteger(now) || now < 0) throw fail(code("explicit-clock-required"));
  return now;
}
function packValid(p) {
  return plain(p) && ["g", "ml", "piece"].includes(p.unit) && typeof p.amount === "number"
    && Number.isFinite(p.amount) && p.amount > 0 && p.amount <= 1e9
    && Number.isSafeInteger(p.count) && p.count > 0 && p.count <= 1000 && p.amount * p.count <= 1e9
    && (p.unit !== "piece" || Number.isInteger(p.amount));
}
function tuple(key, value, extra = {}) {
  if (typeof key !== "string" || key.length > 160 || !plain(value)) throw fail(code("normal-quote-invalid"));
  const fields = key.split("|"), pack = { unit: fields[1], amount: Number(fields[2]), count: Number(fields[3]) };
  if (fields.length !== 4 || !gtin(fields[0]) || value.gtin !== fields[0]
    || !/^\d+(?:\.\d+)?$/.test(fields[2]) || !/^\d+$/.test(fields[3]) || !packValid(pack)
    || !/^[a-f0-9]{64}$/.test(value.signature || "")) throw fail(code("normal-quote-invalid"));
  return { key, gtin: value.gtin, pack, signature: value.signature, ...extra };
}
function quoteFor(c) {
  const pack = { unit: c.normalizedPack.unit, amount: c.normalizedPack.amount / c.packCount, count: c.packCount };
  const key = [c.gtin, pack.unit, pack.amount, pack.count].join("|");
  return { key, gtin: c.gtin, pack, signature: hash(JSON.stringify([c.name, c.priceCents, c.depositCents, c.nativePriceType])) };
}
function referenceFor(c) {
  const q = quoteFor(c);
  return { retailerSku: c.retailerSku, gtin: c.gtin, key: q.key, signature: q.signature,
    capturedAt: c.capturedAt, expiresAt: c.expiresAt, sourceResponseHash: c.sourceResponseHash, proofHash: c.proofHash };
}
function cycleFor(state, day) {
  const completedCycles = state.completedCycles ?? 0;
  if (!Number.isSafeInteger(completedCycles) || completedCycles < 0 || !Collector.validDay(day)) throw fail(code("cycle-invalid"));
  const ordinaryCycleId = state.ordinaryCycleId;
  if (ordinaryCycleId != null && (typeof ordinaryCycleId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(ordinaryCycleId)))
    throw fail(code("cycle-invalid"));
  return { cursorDay: day, completedCycles, ...(ordinaryCycleId != null ? { ordinaryCycleId } : {}) };
}
const cycleKey = c => JSON.stringify([c.cursorDay, c.completedCycles, c.ordinaryCycleId ?? null]);
function normalContext(result, state, now) {
  if (!plain(result) || !plain(state) || result.sourceId !== Native.SOURCE || !Collector.validDay(result.cursorDay)
    || !Array.isArray(result.pages) || result.pages.length > 16 || !Array.isArray(result.accepted) || result.accepted.length > 640
    || !Array.isArray(result.rejected) || result.rejected.length > 640 || !Number.isSafeInteger(result.requests) || result.requests < 1 || result.requests > 16
    || result.pages.length > result.requests || typeof result.complete !== "boolean" || result.physicalStoreAssortmentComplete !== false)
    throw fail(code("actual-result-required"));
  const currentDay = Clock.today(new Date(now));
  const reset = !!state.cursor && state.cursor.cursorDay !== result.cursorDay;
  if (reset && result.cursorDay !== currentDay || result.cursorDay > currentDay) throw fail(code("day-reset-unconfirmed"));
  const prior = Collector.cursorFor(reset ? null : state.cursor || null, Import.STORE_PROFILE, result.cursorDay);
  const cycle = cycleFor(state, result.cursorDay), quotes = [], bySku = new Map(), seen = new Set(prior.seenSkus);
  const known = structuredClone(prior.seenQuotes), conflicts = new Set(prior.conflictGtins);
  for (const [key, q] of Object.entries(known)) quotes.push(tuple(key, q, { origin: "ordinary", cycle }));
  const pending = new Set(prior.pending.map(n => n.id)), visited = new Set(prior.visited.map(n => n.id).filter(Boolean));
  for (const page of result.pages) {
    if (!plain(page) || !same(page.storeProfile, Import.STORE_PROFILE) || !/^[a-f0-9]{64}$/.test(page.sourceResponseHash || "")
      || !Number.isFinite(Date.parse(page.capturedAt)) || Date.parse(page.capturedAt) > now || now - Date.parse(page.capturedAt) > 300000
      || !Number.isFinite(Date.parse(page.responseDate)) || Date.parse(page.responseDate) > now
      || Math.abs(Date.parse(page.responseDate) - Date.parse(page.capturedAt)) > 300000
      || page.responseAgeSeconds !== null && (!Number.isSafeInteger(page.responseAgeSeconds) || page.responseAgeSeconds < 0 || page.responseAgeSeconds > 300)
      || !Number.isSafeInteger(page.rowCount) || page.rowCount < 0 || page.rowCount > 200
      || !Number.isSafeInteger(page.uniqueRowCount) || page.uniqueRowCount < 0 || page.uniqueRowCount > page.rowCount
      || page.pagination?.page !== 0 || page.pagination?.limit !== 40 || !Number.isSafeInteger(page.pagination.total)
      || page.pagination.total < 0 || page.rowCount !== Math.min(40, page.pagination.total)
      || !Array.isArray(page.children) || !Array.isArray(page.conflictGtins)) throw fail(code("normal-page-invalid"));
    try { Collector.allowedUrl(page.sourceResponseUrl, Import.STORE_PROFILE); } catch { throw fail(code("normal-page-url-invalid")); }
    if (page.categoryId !== null && (typeof page.categoryId !== "string" || !/^\d+$/.test(page.categoryId)
      || new URL(page.sourceResponseUrl).pathname.match(/-(\d+)$/)?.[1] !== page.categoryId)) throw fail(code("normal-category-invalid"));
    if (page.diagnosticOnly === true || page.gapId) {
      // This gate never admits gap rows. Existing refresh/original-gap gates
      // remain responsible for independently authenticating their originals.
      if (page.uniqueRowCount !== 0 || page.accepted !== 0 || page.children.length || page.conflictGtins.length
        || page.nativeSkuIds?.length || page.nativeQuotes?.length || page.nativeQuoteRows?.length)
        throw fail(code("diagnostic-normal-rows-forbidden"));
    } else {
      const all = page.nativeAllSkuIds, added = page.nativeSkuIds, rows = page.nativeQuoteRows;
      if (!Array.isArray(all) || all.length > page.rowCount || all.some(x => !sku(x)) || new Set(all).size !== all.length
        || !Array.isArray(added) || added.length !== page.uniqueRowCount || !same(added, all.filter(x => !seen.has(x)))
        || !Array.isArray(rows) || rows.length > page.rowCount || rows.some(q => !plain(q) || !all.includes(q.retailerSku))
        || !same(page.nativeQuotes, rows.map(({ key, quote }) => ({ key, quote })))) throw fail(code("normal-sidecars-unconfirmed"));
      for (const row of rows) {
        const q = tuple(row.key, row.quote, { sku: row.retailerSku, origin: "ordinary", cycle, capturedAt: page.capturedAt });
        quotes.push(q); bySku.set(row.retailerSku, q);
        if (!known[row.key]) known[row.key] = structuredClone(row.quote);
      }
      added.forEach(x => seen.add(x));
    }
    if (page.conflictGtins.some(x => !gtin(x))) throw fail(code("normal-quarantine-invalid"));
    page.conflictGtins.forEach(x => conflicts.add(x));
    for (const id of page.children) { if (typeof id !== "string" || !/^\d+$/.test(id)) throw fail(code("normal-child-invalid")); if (!visited.has(id)) pending.add(id); }
    if (page.categoryId) { pending.delete(page.categoryId); visited.add(page.categoryId); }
  }
  if (result.received !== seen.size || result.pagesFetched !== prior.pagesFetched + result.pages.length
    || !same([...new Set(result.conflictGtins || [])].sort(), [...conflicts].sort())) throw fail(code("normal-counters-unconfirmed"));
  if (result.cursor) {
    const next = Collector.cursorFor(result.cursor, Import.STORE_PROFILE, result.cursorDay);
    const retained = prior.pending.filter(n => pending.has(n.id));
    if (!same(next.seenSkus, [...seen]) || !same(next.seenQuotes, known) || !same(next.conflictGtins, [...conflicts])
      || !same(next.visited.slice(0, prior.visited.length), prior.visited)
      || !same(next.pending.filter(n => retained.some(old => old.id === n.id)), retained)
      || !same(next.pending.map(n => n.id).sort(), [...pending].sort())
      || !same(result.categoryCoverage, Collector.coverageFor(next))) throw fail(code("normal-checkpoint-unconfirmed"));
    for (const [i, page] of result.pages.entries()) {
      const visit = next.visited[prior.visited.length + i];
      if (!visit || visit.id !== page.categoryId || visit.url !== page.sourceResponseUrl || visit.total !== page.pagination.total
        || visit.rowCount !== page.rowCount || visit.uniqueRowCount !== page.uniqueRowCount
        || !same(visit.children, page.children) || !same(visit.conflictGtins, page.conflictGtins)) throw fail(code("normal-visit-unconfirmed"));
    }
  } else if (!result.complete || pending.size) throw fail(code("normal-completion-unconfirmed"));
  for (const candidate of result.accepted) {
    const checked = Import.validateCandidate(candidate, { now, storeProfile: Import.STORE_PROFILE });
    const q = checked.ok ? quoteFor(candidate) : null;
    if (!q || !result.pages.some(page => page.diagnosticOnly !== true && !page.gapId
      && ["sourceResponseHash", "sourceResponseUrl", "capturedAt"].every(k => candidate[k] === page[k])
      && candidate.sourceResponseDate === new Date(page.responseDate).toISOString()
      && candidate.sourceAgeSeconds === page.responseAgeSeconds
      && page.nativeQuoteRows?.some(row => same(row, { retailerSku: candidate.retailerSku, key: q.key, quote: { gtin: q.gtin, signature: q.signature } }))))
      throw fail(code("ordinary-candidate-unconfirmed"));
  }
  return { prior, quotes, bySku, seenSkus: seen, conflictGtins: conflicts, cycle, reset,
    checkpointFingerprint: hash(JSON.stringify([state.updatedAt ?? null, state.cursor ?? null, state.completedCycles ?? 0, state.retryAfter ?? null])) };
}
function previousContexts(raw, now) {
  if (!Array.isArray(raw) || raw.length > 1) throw fail(code("previous-partition-bound"));
  const active = [], expired = [];
  for (const previous of raw) {
    if (!plain(previous) || previous.version !== 1 || !plain(previous.record) || !Array.isArray(previous.acceptedRefs)
      || previous.acceptedRefs.length > 40 || !plain(previous.ordinaryCycle)) throw fail(code("previous-original-required"));
    const cycle = cycleFor(previous.ordinaryCycle, previous.ordinaryCycle.cursorDay);
    const at = Date.parse(previous.record.filtered?.meta?.capturedAt), controlAt = Date.parse(previous.record.control?.meta?.capturedAt);
    if (!Number.isFinite(at) || !Number.isFinite(controlAt) || at > now || controlAt > now
      || cycle.cursorDay !== Clock.today(new Date(controlAt))) throw fail(code("previous-capture-invalid"));
    const record = Partition.validateRecord(previous.record, { now: Math.max(at, controlAt) });
    if (record.outcome !== "confirmed") throw fail(code("previous-original-not-confirmed"));
    const parsed = Native.parsePage(record.filtered.body, record.filtered.meta), candidates = new Map();
    for (const c of parsed.accepted) if (Import.validateCandidate(c, { now: at, storeProfile: Import.STORE_PROFILE }).ok) candidates.set(c.retailerSku, c);
    const refs = new Set();
    for (const ref of previous.acceptedRefs) {
      const candidate = candidates.get(ref?.retailerSku);
      if (!candidate || !same(referenceFor(candidate), ref) || refs.has(ref.retailerSku)) throw fail(code("previous-accepted-ref-unconfirmed"));
      refs.add(ref.retailerSku);
    }
    const id = hash(JSON.stringify([Native.SOURCE, 1775, record.control.meta.sourceResponseHash, record.filtered.meta.sourceResponseHash, record.filtered.meta.capturedAt]));
    if (at + 86400000 <= now) { expired.push(id); continue; }
    active.push({ id, record, cycle, candidates: previous.acceptedRefs.map(ref => candidates.get(ref.retailerSku)) });
  }
  return { active, expired };
}
function compare(quotes, initialBlocked) {
  const blocked = new Set(initialBlocked), conflicts = [], unresolved = [], seen = new Set(), byGtin = new Map(), bySku = new Map();
  function conflict(reason, a, b) {
    const ids = [...new Set([a.gtin, b.gtin])].sort(), key = JSON.stringify([reason, ids, a.sku || null, b.sku || null]);
    ids.forEach(x => blocked.add(x));
    if (!seen.has(key)) { seen.add(key); conflicts.push({ reason, gtins: ids, origins: [a.origin, b.origin], retailerSkus: [a.sku, b.sku].filter(Boolean) }); }
  }
  for (const q of quotes) {
    const group = byGtin.get(q.gtin), key = cycleKey(q.cycle);
    if (group && !Discovery.samePack(group.first.pack, q.pack)) conflict("gtin-sales-pack-disagreement", group.first, q);
    if (group) {
      const sameCycle = group.cycles.get(key);
      if (sameCycle && sameCycle.signature !== q.signature) conflict("exact-native-quote-disagreement", sameCycle, q);
      else if (!sameCycle) {
        group.cycles.set(key, q);
        if (group.first.signature !== q.signature) unresolved.push({ gtin: q.gtin, reason: "cross-cycle-normal-quote-change", retailerSku: q.sku ?? null });
      }
    } else byGtin.set(q.gtin, { first: q, cycles: new Map([[key, q]]) });
    if (q.sku) {
      const old = bySku.get(q.sku);
      if (old && (old.gtin !== q.gtin || !Discovery.samePack(old.pack, q.pack))) conflict("native-sku-identity-disagreement", old, q);
      else if (!old) bySku.set(q.sku, q);
    }
  }
  return { blocked, conflicts, unresolved };
}
function evaluate(result, state, options = {}) {
  const now = clock(options), ordinary = normalContext(result, state, now);
  const previous = previousContexts(options.previousPartitions ?? [], now);
  const record = result.brandPartitionProbe == null ? null : Binding.confirmed(result, state.cursor?.cursorDay !== result.cursorDay ? { ...state, cursor: null } : state, now);
  const partitionQuotes = previous.active.flatMap(p => p.candidates.map(c => ({ ...quoteFor(c), sku: c.retailerSku, origin: "partition", cycle: p.cycle })));
  const previousSkus = new Set(previous.active.flatMap(p => p.candidates.map(c => c.retailerSku)));
  const rejected = [], valid = [], unresolved = [];
  if (record?.outcome === "confirmed") {
    const parsed = Native.parsePage(record.filtered.body, record.filtered.meta), rows = Native.extractRows(record.filtered.body).rows;
    if (rows.length > 40 || rows.length !== record.facet.count) throw fail(code("bounded-filtered-rows-required"));
    rejected.push(...structuredClone(parsed.rejected));
    for (const candidate of parsed.accepted) {
      const checked = Import.validateCandidate(candidate, { now, storeProfile: Import.STORE_PROFILE });
      if (checked.ok) valid.push(candidate); else rejected.push({ retailerSku: candidate.retailerSku, reasons: checked.reasons });
    }
    const validSkus = new Set(valid.map(c => c.retailerSku)), knownGtins = new Set([...ordinary.quotes, ...partitionQuotes].map(q => q.gtin));
    for (const row of rows) if (!validSkus.has(row.external_id) && (knownGtins.has(row.ean) || ordinary.seenSkus.has(row.external_id) || previousSkus.has(row.external_id)))
      unresolved.push({ gtin: gtin(row.ean) ? row.ean : null, retailerSku: sku(row.external_id) ? row.external_id : null, reason: "native-normal-quote-or-sales-pack-unconfirmed" });
  }
  const incoming = valid.map(c => ({ ...quoteFor(c), sku: c.retailerSku, origin: "incoming-partition", cycle: ordinary.cycle }));
  const compared = compare([...ordinary.quotes, ...partitionQuotes, ...incoming], ordinary.conflictGtins);
  const known = new Map(), candidates = [], duplicateSkus = [], duplicateIdentities = [];
  for (const q of [...ordinary.quotes, ...partitionQuotes]) if (!known.has(q.key)) known.set(q.key, q);
  const emittedSkus = new Set();
  for (const c of valid) {
    if (compared.blocked.has(c.gtin)) continue;
    const q = quoteFor(c);
    if (ordinary.seenSkus.has(c.retailerSku) || previousSkus.has(c.retailerSku) || emittedSkus.has(c.retailerSku)) {
      duplicateSkus.push(c.retailerSku);
      if (ordinary.seenSkus.has(c.retailerSku) && !ordinary.bySku.has(c.retailerSku)) unresolved.push({ gtin: c.gtin, retailerSku: c.retailerSku, reason: "ordinary-sku-identity-unconfirmed" });
      continue;
    }
    if (known.get(q.key)?.signature === q.signature) { duplicateIdentities.push({ retailerSku: c.retailerSku, gtin: c.gtin, key: q.key }); continue; }
    emittedSkus.add(c.retailerSku); known.set(q.key, q); candidates.push(c);
  }
  return { version: 1, mode: "disabled-original-bound-partition-admission-gate", sourceId: Native.SOURCE,
    nativeStoreId: 1775, nativeStoreNumber: "258", collectionEnabled: false, priceImportEnabled: false, complete: false,
    databaseAuthorityVerified: false, importAuthorized: false, ordinaryCheckpointFingerprint: ordinary.checkpointFingerprint,
    ordinaryCycle: ordinary.cycle, dailyCycleReset: ordinary.reset, candidates, candidateRefs: candidates.map(referenceFor), rejected,
    conflicts: compared.conflicts, quarantineGtins: [...compared.blocked].sort(), duplicateSkus: [...new Set(duplicateSkus)], duplicateIdentities,
    unresolved: [...unresolved, ...compared.unresolved], activePreviousPartitionCount: previous.active.length, expiredPreviousPartitionIds: previous.expired,
    recordOutcome: record?.outcome ?? null, original: record ? { controlResponseHash: record.control.meta.sourceResponseHash,
      filteredResponseHash: record.filtered?.meta.sourceResponseHash ?? null, capturedAt: record.filtered?.meta.capturedAt ?? null,
      expiresAt: record.filtered ? new Date(Date.parse(record.filtered.meta.capturedAt) + 86400000).toISOString() : null } : null };
}
module.exports = Object.freeze({ evaluate, quoteFor, referenceFor });
