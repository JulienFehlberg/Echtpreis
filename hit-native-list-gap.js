"use strict";
// Original-bound rejected listing diagnostics only. No fetch, DB calls or price admission.
const crypto = require("node:crypto");
const Native = require("./hit-assortment-client");
const cursorFor = (...args) => require("./hit-assortment-collector").cursorFor(...args);
const Clock = require("./current-price-query-service");
const SOURCE = Native.SOURCE, CODE = "hit-native-list-duplicate-or-invalid-sku", MAX_BYTES = 6 * 1024 * 1024;
const STORE = Object.freeze({ storeId: 1775, storeNumber: "258", name: "Berlin-Mitte", city: "Berlin", country: "DE", officialUrl: "https://www.hit.de/maerkte/berlin-mitte" });
const fail = code => Object.assign(new Error(code), { code });
const object = value => value && typeof value === "object" && !Array.isArray(value);
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const ENTITIES = Object.freeze({ quot: '"', apos: "'", amp: "&", lt: "<", gt: ">", nbsp: "\u00a0", euro: "€", times: "×", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—" });
function attrs(raw) {
  const output = new Map();
  for (const match of raw.matchAll(/([a-z_:][a-z\d_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const key = match[1].toLowerCase(); if (output.has(key)) throw fail("gap-native-duplicate-attribute");
    const value = (match[2] ?? match[3]).replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);/gi, (_all, entity) => {
      if (entity[0] !== "#") { if (!Object.hasOwn(ENTITIES, entity)) throw fail("gap-native-entity-invalid"); return ENTITIES[entity]; }
      const number = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (!Number.isInteger(number) || number < 1 || number > 0x10ffff || number >= 0xd800 && number <= 0xdfff) throw fail("gap-native-entity-invalid");
      return String.fromCodePoint(number);
    });
    output.set(key, value);
  }
  return output;
}
function nativeContext(body, node, pagination) {
  const cleaned = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const heads = [...cleaned.matchAll(/<head\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)];
  if (heads.length !== 1) throw fail("gap-native-head-required");
  const head = attrs(heads[0][1]);
  if (head.get("data-store") !== STORE.storeNumber || head.get("data-store-id") !== String(STORE.storeId)
    || head.get("data-hit-konto") !== "" || head.get("data-hit-admin") !== "") throw fail("gap-native-guest-store-unconfirmed");
  let data = null;
  for (const tag of cleaned.matchAll(/<([a-z][a-z\d:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
    const attributes = attrs(tag[2]); if (attributes.get("data-component") !== "assortment/list") continue;
    if (data !== null) throw fail("gap-single-native-list-required");
    try { data = JSON.parse(attributes.get("data-data")); } catch (_) { throw fail("gap-native-json-invalid"); }
  }
  const category = data?.meta?.category;
  if (!object(category) || String(category.id) !== node.id || typeof category.name !== "string" || !category.name.trim()
    || category.name.length > 300 || data?.meta?.is_exact_match !== true) throw fail("gap-native-category-self-identification-required");
  let categoryUrl; try { categoryUrl = new URL(category.url, node.url); } catch (_) { throw fail("gap-native-category-self-url-unconfirmed"); }
  if (categoryUrl.origin !== new URL(node.url).origin || categoryUrl.pathname !== new URL(node.url).pathname
    || categoryUrl.hash || categoryUrl.username || categoryUrl.password || categoryUrl.search && categoryUrl.href !== node.url) throw fail("gap-native-category-self-url-unconfirmed");
  for (const raw of [category, ...(data.filters?.categories || []).filter(item => String(item?.id) === node.id)]) {
    if (Object.hasOwn(raw, "count") && raw.count !== null && (!Number.isSafeInteger(raw.count) || raw.count !== pagination.total)) throw fail("gap-native-category-total-conflict");
  }
}
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
  const at = Date.parse(value); return Number.isFinite(at) && new Date(at).toISOString() === value ? at : NaN;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function canonicalNode(value) {
  if (!object(value) || typeof value.id !== "string" || !/^[1-9]\d{0,11}$/.test(value.id) || ![1, 2, 3].includes(value.level)) throw fail("gap-category-node-required");
  let url; try { url = new URL(value.url); } catch (_) { throw fail("gap-category-url-invalid"); }
  if (url.protocol !== "https:" || url.hostname !== "www.hit.de" || url.port || url.username || url.password || url.hash
    || !/^\/sortiment\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+-\d+$/.test(url.pathname) || !url.pathname.endsWith("-" + value.id)
    || [...url.searchParams.keys()].some(key => key !== "markt") || url.searchParams.getAll("markt").length > 1
    || url.searchParams.has("markt") && url.searchParams.get("markt") !== STORE.storeNumber || value.url !== url.href) throw fail("gap-category-url-invalid");
  return { id: value.id, url: url.href, level: value.level };
}
function proof(body, input, node, now) {
  const at = timestamp(input?.capturedAt);
  if (typeof body !== "string" || Buffer.byteLength(body) > MAX_BYTES || !object(input)
    || !Number.isSafeInteger(now) || !Number.isFinite(at) || at > now || now - at > 300000) throw fail("gap-original-capture-stale-or-future");
  if (Object.keys(STORE).some(key => input.storeProfile?.[key] !== STORE[key])) throw fail("gap-approved-store-required");
  if (input.responseStatus !== 200 || !/^text\/html(?:\s*;|$)/i.test(input.responseContentType || "") || input.anonymous !== true
    || input.retried !== false || !Array.isArray(input.redirects) || input.redirects.length || input.requestUrl !== node.url
    || input.sourceResponseUrl !== node.url) throw fail("gap-original-response-context-unconfirmed");
  if (!Number.isSafeInteger(input.responseBytes) || input.responseBytes !== Buffer.byteLength(body)
    || !/^[a-f0-9]{64}$/.test(input.sourceResponseHash || "") || digest(body) !== input.sourceResponseHash) throw fail("gap-original-body-conflict");
  if (typeof input.responseDate !== "string" || !/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(input.responseDate)
    || new Date(input.responseDate).toUTCString() !== input.responseDate || Date.parse(input.responseDate) > now
    || Math.abs(Date.parse(input.responseDate) - at) > 300000) throw fail("gap-original-response-date-unconfirmed");
  if (input.responseAgeSeconds !== null && (!Number.isSafeInteger(input.responseAgeSeconds) || input.responseAgeSeconds < 0 || input.responseAgeSeconds > 300)
    || input.responseAgeRaw !== null && (typeof input.responseAgeRaw !== "string" || !/^\d+$/.test(input.responseAgeRaw)
      || Number(input.responseAgeRaw) !== input.responseAgeSeconds) || input.responseAgeRaw === null && input.responseAgeSeconds !== null) throw fail("gap-original-cache-age-unconfirmed");
  // Whitelist original proof fields. Cookies, authorization and arbitrary headers are never retained.
  return { storeProfile: { ...STORE }, capturedAt: input.capturedAt, responseDate: input.responseDate,
    responseAgeSeconds: input.responseAgeSeconds, sourceResponseHash: input.sourceResponseHash,
    sourceResponseUrl: input.sourceResponseUrl, requestUrl: input.requestUrl, responseStatus: 200,
    responseContentType: input.responseContentType, responseBytes: input.responseBytes, responseAgeRaw: input.responseAgeRaw,
    redirects: [], anonymous: true, retried: false };
}
function record(page, inputNode, { now = Date.now() } = {}) {
  const node = canonicalNode(inputNode), meta = proof(page?.body, page?.meta, node, now);
  const extracted = Native.extractRows(page.body), parsed = Native.parsePage(page.body, meta), tree = Native.extractCategories(page.body, meta.sourceResponseUrl);
  const pagination = extracted.pagination;
  if (extracted.kind !== "assortment-list" || parsed.extractionKind !== "assortment-list" || !pagination || pagination.page !== 0
    || !Number.isSafeInteger(pagination.limit) || pagination.limit < 1 || pagination.limit > 200
    || !Number.isSafeInteger(pagination.total) || pagination.total < 0 || pagination.total > 100000
    || parsed.rowCount !== Math.min(pagination.limit, pagination.total)) throw fail("gap-native-pagination-unconfirmed");
  if (extracted.params?.for_store !== STORE.storeId || String(extracted.params?.for_category) !== node.id
    || extracted.params.limit !== pagination.limit || extracted.params.return_exact_match !== "1"
    || Object.keys(extracted.params).some(key => !["for_store", "for_category", "limit", "return_exact_match"].includes(key))
    || tree.nativeStoreId !== STORE.storeId || tree.currentCategoryId !== node.id
    || extracted.rows.some(row => !object(row) || row.storeId !== STORE.storeId || row.storeNumber !== STORE.storeNumber)
    || parsed.rejected.some(row => row.reasons?.some(reason => /store.*conflict|store.*required/.test(reason)))) throw fail("gap-native-store-category-unconfirmed");
  const current = tree.categories.find(category => category.id === node.id);
  if (tree.rejected.length || current && (current.level !== node.level || current.count !== null && current.count !== pagination.total)) throw fail("gap-native-category-metadata-unconfirmed");
  nativeContext(page.body, node, pagination);
  // Existing contradictory-identity quarantine is a separate path. Never replace it with this diagnostic gap.
  if (parsed.rejected.some(row => row.reasons?.some(reason => /^hit-conflicting-native-(gtin-pack|sku)-quotes$/.test(reason)))) throw fail("gap-native-conflict-requires-existing-quarantine");
  const grouped = new Map(), invalidSkuIndexes = [];
  for (const [index, row] of extracted.rows.entries()) {
    if (typeof row.external_id !== "string" || !/^\d{1,24}[A-Z]{1,3}$/.test(row.external_id)) { invalidSkuIndexes.push(index); continue; }
    const rows = grouped.get(row.external_id) || []; rows.push({ index, row }); grouped.set(row.external_id, rows);
  }
  const duplicates = [...grouped].filter(([, rows]) => rows.length > 1).map(([sku, rows]) => ({ sku, indexes: rows.map(row => row.index),
    kind: new Set(rows.map(({ row }) => JSON.stringify(stable(row)))).size === 1 ? "identical-native-row" : "different-native-row" }));
  if (!invalidSkuIndexes.length && !duplicates.length) throw fail("gap-current-sku-guard-would-not-fail");
  const id = digest(JSON.stringify([SOURCE, STORE.storeId, node.id, meta.capturedAt, meta.sourceResponseHash]));
  return { version: 1, sourceId: SOURCE, nativeStoreId: STORE.storeId, nativeStoreNumber: STORE.storeNumber, id,
    category: { ...node, total: pagination.total, rowCount: extracted.rows.length, limit: pagination.limit }, code: CODE,
    invalidSkuIndexes, duplicates, original: { body: page.body, meta }, childrenImported: false, skuImported: false,
    quoteImported: false, priceImportEnabled: false, complete: false, unresolvedSubtree: node.level < 3 };
}
function validateRecord(input, options = {}) {
  if (!object(input)) throw fail("gap-record-required");
  const canonical = record(input.original, input.category, options);
  if (JSON.stringify(stable(canonical)) !== JSON.stringify(stable(input))) throw fail("gap-recomputed-record-conflict");
  return canonical;
}
function isolate(cursor, diagnostic, { now = Date.now() } = {}) {
  const gap = validateRecord(diagnostic, { now }), original = cursorFor(cursor, STORE, Clock.today(new Date(now)));
  if (original.cursorDay !== Clock.today(new Date(now))) throw fail("gap-continuation-day-conflict");
  const index = original.pending.findIndex(node => node.id === gap.category.id && node.url === gap.category.url && node.level === gap.category.level);
  if (index < 0) throw fail("gap-original-pending-node-required");
  // Do not hide known cross-page contradictions in the rejected category.
  const parsed = Native.parsePage(gap.original.body, gap.original.meta);
  for (const candidate of parsed.accepted) {
    const key = [candidate.gtin, candidate.normalizedPack.unit, candidate.normalizedPack.amount / candidate.packCount, candidate.packCount].join("|");
    const signature = digest(JSON.stringify([candidate.name, candidate.priceCents, candidate.depositCents, candidate.nativePriceType]));
    if (original.seenQuotes[key] && original.seenQuotes[key].signature !== signature) throw fail("gap-cross-page-conflict-requires-existing-quarantine");
  }
  original.pending.splice(index, 1);
  original.visited.push({ id: gap.category.id, url: gap.category.url, level: gap.category.level, total: gap.category.total,
    rowCount: gap.category.rowCount, uniqueRowCount: 0, children: [], truncated: gap.category.level === 3 && gap.category.total > gap.category.limit,
    unresolved: true, unresolvedReason: CODE, conflictGtins: [], quarantinedListing: true, gapId: gap.id });
  original.pagesFetched++;
  const state = cursorFor(original, STORE, original.cursorDay);
  return { cursor: state, originalRecord: gap, accepted: [], children: [], sourceError: { code: CODE, retryAfterMs: 3600000, isolatedListingGapId: gap.id },
    page: { ...gap.original.meta, categoryId: gap.category.id, rowCount: gap.category.rowCount, uniqueRowCount: 0,
      pagination: { page: 0, limit: gap.category.limit, total: gap.category.total }, accepted: 0, rejected: gap.category.rowCount,
      children: [], truncated: gap.category.level === 3 && gap.category.total > gap.category.limit, conflictGtins: [], diagnosticOnly: true, gapId: gap.id },
    complete: false, nativePaginationComplete: false, publishedTraversalComplete: false, physicalStoreAssortmentComplete: false };
}
function summarize(input, options = {}) {
  const gap = validateRecord(input, options);
  return { id: gap.id, categoryId: gap.category.id, url: gap.category.url, level: gap.category.level, nativeTotal: gap.category.total,
    rowCount: gap.category.rowCount, capturedAt: gap.original.meta.capturedAt, sourceResponseHash: gap.original.meta.sourceResponseHash,
    reason: CODE, invalidSkuCount: gap.invalidSkuIndexes.length, duplicateSkuCount: gap.duplicates.length,
    unresolvedSubtree: gap.unresolvedSubtree, complete: false, priceImportEnabled: false };
}
function terminal(cursor, { now = Date.now(), retryAfter, archivedRecords = [] } = {}) {
  if (!Number.isSafeInteger(now) || !Array.isArray(archivedRecords) || archivedRecords.length > 32) throw fail("gap-terminal-original-ledger-required");
  const state = cursorFor(cursor, STORE, Clock.today(new Date(now)));
  const retry = timestamp(retryAfter);
  if (state.cursorDay !== Clock.today(new Date(now)) || !Number.isFinite(retry) || now < retry || !state.initialIndexLoaded
    || !state.overviewLoaded || state.pending.length || !state.pagesFetched) throw fail("gap-terminal-not-ready");
  const gaps = state.visited.filter(visit => visit.quarantinedListing === true);
  if (!gaps.length) throw fail("gap-terminal-original-ledger-required");
  for (const visit of gaps) {
    const saved = archivedRecords.find(record => record?.id === visit.gapId);
    const capture = timestamp(saved?.original?.meta?.capturedAt);
    if (!saved || !Number.isFinite(capture) || capture > now || now - capture > 86400000) throw fail("gap-terminal-original-ledger-required");
    // Audit archived proof at its original capture time; never call this a fresh capture.
    const original = validateRecord(saved, { now: timestamp(saved.original.meta.capturedAt) });
    if (original.category.id !== visit.id || original.category.url !== visit.url || original.category.level !== visit.level
      || original.category.total !== visit.total || original.category.rowCount !== visit.rowCount || visit.uniqueRowCount !== 0
      || visit.unresolved !== true || visit.unresolvedReason !== CODE || visit.children.length || visit.conflictGtins.length) throw fail("gap-terminal-visit-proof-conflict");
  }
  return { sourceId: SOURCE, terminalOnly: true, cursorDay: state.cursorDay, requests: 0, accepted: [], rejected: [], pages: [],
    cursor: null, complete: true, categoryTraversalCycleComplete: true, nativePaginationComplete: false,
    publishedTraversalComplete: false, physicalStoreAssortmentComplete: false, categoryCoverage: state.categoryCoverage,
    conflictGtins: [...state.conflictGtins], total: state.total, pagesFetched: state.pagesFetched, received: state.received, error: null,
    originalListingGaps: [] };
}
module.exports = { SOURCE, CODE, STORE, record, validateRecord, isolate, summarize, terminal };
