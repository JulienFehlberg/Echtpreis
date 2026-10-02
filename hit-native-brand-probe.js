"use strict";

// Source-native HTML filter diagnostics only: no fetch, price import or GTIN API.
// Proposal capabilities are private and bind one observed category and facet.
const crypto = require("node:crypto");
const Native = require("./hit-assortment-client");
const BOUND = 200, MAX_BYTES = 6 * 1024 * 1024;
const STORE = Object.freeze({ storeId: 1775, storeNumber: "258", city: "Berlin", name: "Berlin-Mitte" });
const proposals = new WeakMap();
const fail = code => Object.assign(new Error(code), { code });
const object = value => value && typeof value === "object" && !Array.isArray(value);
const validText = (value, limit) => typeof value === "string" && value.length > 0 && value.length <= limit
  && value.trim() === value && !/[\u0000-\u001f\u007f\ufffd]/.test(value);
const digest = body => crypto.createHash("sha256").update(body).digest("hex");
const ENTITIES = Object.freeze({ quot: '"', apos: "'", amp: "&", lt: "<", gt: ">", nbsp: "\u00a0", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", euro: "€", times: "×", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" });
function decode(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);/gi, (_all, key) => {
    if (key[0] !== "#") { if (!Object.hasOwn(ENTITIES, key)) throw fail("facet-html-entity-invalid"); return ENTITIES[key]; }
    const number = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    if (!Number.isInteger(number) || number < 1 || number > 0x10ffff || number >= 0xd800 && number <= 0xdfff) throw fail("facet-html-entity-invalid");
    return String.fromCodePoint(number);
  });
}
function attributes(raw) {
  const output = new Map();
  for (const match of raw.matchAll(/([a-z_:][a-z\d_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const key = match[1].toLowerCase(); if (output.has(key)) throw fail("facet-native-duplicate-attribute");
    output.set(key, decode(match[2] ?? match[3]));
  }
  return output;
}
function sourceURL(value, categoryId = null) {
  if (!validText(value, 1000) || /[\\%]/.test(value) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) throw fail("facet-source-url-invalid");
  let url; try { url = new URL(value); } catch (_) { throw fail("facet-source-url-invalid"); }
  const id = url.pathname.match(/^\/sortiment\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*-([1-9]\d{0,11})$/)?.[1];
  if (url.protocol !== "https:" || url.hostname !== "www.hit.de" || url.port || url.username || url.password || url.hash || !id
    || categoryId !== null && id !== categoryId || [...url.searchParams.keys()].some(key => key !== "markt")
    || url.searchParams.getAll("markt").length > 1 || url.searchParams.has("markt") && url.searchParams.get("markt") !== STORE.storeNumber)
    throw fail("facet-source-url-invalid");
  return url;
}
function original(body, proof, expectedURL = null) {
  if (typeof body !== "string" || Buffer.byteLength(body) > MAX_BYTES || !object(proof) || proof.status !== 200
    || !/^text\/html(?:\s*;|$)/i.test(proof.contentType || "") || !/^[a-f0-9]{64}$/.test(proof.sha256 || "")
    || digest(body) !== proof.sha256 || !Number.isSafeInteger(proof.bytes) || proof.bytes !== Buffer.byteLength(body)
    || typeof proof.checkedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(proof.checkedAt) || !Number.isFinite(Date.parse(proof.checkedAt))
    || new Date(proof.checkedAt).toISOString().slice(0, 19) !== proof.checkedAt.slice(0, 19)
    || typeof proof.date !== "string" || !/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(proof.date) || new Date(proof.date).toUTCString() !== proof.date || Math.abs(Date.parse(proof.date) - Date.parse(proof.checkedAt)) > 300000
    || proof.age !== null && !(typeof proof.age === "string" && /^\d+$/.test(proof.age) && Number(proof.age) <= 300)
    || proof.anonymous !== true || proof.retried !== false || !Array.isArray(proof.redirects) || proof.redirects.length)
    throw fail("facet-original-capture-invalid");
  const url = expectedURL === null ? sourceURL(proof.finalUrl) : new URL(expectedURL); if (expectedURL !== null && proof.finalUrl !== expectedURL) throw fail("facet-filtered-url-conflict"); if (proof.url !== proof.finalUrl) throw fail("facet-original-url-conflict");
  return url;
}
function analyse(body, proof, expectedURL = null, expectedFacet = null) {
  const url = original(body, proof, expectedURL), native = Native.extractRows(body);
  if (native.kind !== "assortment-list" || native.pagination.page !== 0 || native.pagination.limit !== 40 || native.rows.length !== Math.min(native.pagination.limit, native.pagination.total))
    throw fail("facet-native-page-zero-forty-required");
  const cleaned = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const headTags = [...cleaned.matchAll(/<head\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)];
  if (headTags.length !== 1) throw fail("facet-native-head-required");
  const head = attributes(headTags[0][1]);
  if (head.get("data-store") !== STORE.storeNumber || head.get("data-store-id") !== String(STORE.storeId)
    || head.get("data-hit-konto") !== "" || head.get("data-hit-admin") !== "") throw fail("facet-native-guest-store-conflict");
  if (native.params?.for_store !== STORE.storeId || native.params?.limit !== 40 || native.params?.return_exact_match !== "1" || native.rows.some(row => !object(row) || row.storeId !== STORE.storeId || row.storeNumber !== STORE.storeNumber))
    throw fail("facet-native-row-store-conflict");
  const nativeSkus = native.rows.map(row => row.external_id);
  if (nativeSkus.some(id => typeof id !== "string" || !/^\d{1,24}[A-Z]{1,3}$/.test(id)) || new Set(nativeSkus).size !== nativeSkus.length) throw fail("facet-native-sku-invalid-or-duplicate");
  // Diagnostics start only with the original unfiltered category. A fabricated
  // query or already-filtered response cannot silently become a control page.
  const allowedParams = ["for_store", "for_category", "limit", "return_exact_match", ...(expectedFacet === null ? [] : ["for_brands"])];
  if (Object.keys(native.params).some(key => !allowedParams.includes(key))) throw fail("facet-unfiltered-control-required");
  if (expectedFacet !== null && !(native.params.for_brands === expectedFacet || Array.isArray(native.params.for_brands) && native.params.for_brands.length === 1 && native.params.for_brands[0] === expectedFacet)) throw fail("facet-native-filter-echo-required");
  let data = null;
  for (const match of cleaned.matchAll(/<([a-z][a-z\d:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)) {
    const attrs = attributes(match[2]); if (attrs.get("data-component") !== "assortment/list") continue;
    if (data !== null) throw fail("facet-single-native-list-required");
    try { data = JSON.parse(attrs.get("data-data")); } catch (_) { throw fail("facet-native-json-invalid"); }
  }
  const category = data?.meta?.category, categoryId = typeof category?.id === "string" ? category.id : Number.isSafeInteger(category?.id) ? String(category.id) : null;
  if (!categoryId || !/^[1-9]\d{0,11}$/.test(categoryId) || String(native.params.for_category) !== categoryId || !validText(category.name, 300)) throw fail("facet-native-category-conflict");
  const categorySource = new URL(url); if (expectedURL !== null) categorySource.search = ""; sourceURL(categorySource.href, categoryId);
  const categoryUrl = typeof category.url === "string" && category.url.startsWith("/sortiment/") ? new URL(category.url, url).href : category.url;
  const canonical = sourceURL(categoryUrl, categoryId); if (canonical.pathname !== url.pathname) throw fail("facet-native-category-url-conflict");
  if (data.filters !== undefined && !object(data.filters) || data.filters?.brands !== undefined && !Array.isArray(data.filters.brands)) throw fail("facet-native-brands-schema-invalid");
  if (data.filters?.categories !== undefined && (!Array.isArray(data.filters.categories) || data.filters.categories.length > BOUND)) throw fail("facet-native-categories-schema-invalid");
  const categoryCountEvidence = [];
  for (const [origin, record] of [["meta.category", category], ...(data.filters?.categories || []).filter(record => String(record?.id) === categoryId).map(record => ["filters.categories", record])]) {
    if (!Object.hasOwn(record, "count")) continue;
    const count = record.count; if (count !== null && (!Number.isSafeInteger(count) || count < 0 || count !== native.pagination.total)) throw fail("facet-native-category-total-conflict");
    categoryCountEvidence.push(Object.freeze({ origin, count }));
  }
  const raw = data.filters?.brands || []; if (raw.length > BOUND) throw fail("facet-native-brand-bound-exceeded");
  const invalid = [], invalidIds = new Set(), groups = new Map();
  for (const [index, facet] of raw.entries()) {
    const reasons = [];
    if (!object(facet) || !validText(facet.id, 200) || !validText(facet.key, 200) || facet.id !== facet.key) reasons.push("native-brand-key-invalid");
    if (!object(facet) || !validText(facet.label, 300)) reasons.push("native-brand-label-invalid");
    if (!object(facet) || !Number.isSafeInteger(facet.count) || facet.count < 0 || facet.count > native.pagination.total) reasons.push("native-brand-count-invalid");
    if (reasons.length) { if (validText(facet?.id, 200)) invalidIds.add(facet.id); invalid.push({ index, reasons }); continue; }
    const value = { id: facet.id, key: facet.key, name: facet.label, count: facet.count }, group = groups.get(value.id) || [];
    group.push({ index, value }); groups.set(value.id, group);
  }
  const facets = [], duplicates = [], conflicts = [];
  for (const [id, entries] of groups) {
    if (invalidIds.has(id) || new Set(entries.map(entry => JSON.stringify(entry.value))).size !== 1) { conflicts.push({ id, indices: entries.map(entry => entry.index), reason: "conflicting-native-brand-facet" }); continue; }
    if (entries.length > 1) duplicates.push({ id, indices: entries.map(entry => entry.index) });
    const facet = entries[0].value, small = facet.count > 0 && facet.count <= 40, representable = !facet.id.includes(",");
    facets.push(Object.freeze({ ...facet, firstPageSubsetBounded: small, urlProposalEligible: small && representable,
      ...(facet.count === 0 ? { reason: "zero-native-count" } : !small ? { reason: "native-count-exceeds-first-page" } : !representable ? { reason: "native-comma-delimiter-ambiguous" } : {}) }));
  }
  const sum = facets.reduce((count, facet) => count + facet.count, 0), reportedTotal = native.pagination.total;
  const report = Object.freeze({ mode: "offline-native-brand-facet-diagnostics", collectionEnabled: false, priceImportEnabled: false,
    actualHTMLFilterVerified: false, storeIdentityForFutureFilteredResponseVerified: false, complete: false,
    source: Object.freeze({ url: proof.finalUrl, sha256: proof.sha256, bytes: proof.bytes, capturedAt: proof.checkedAt, responseDate: proof.date, responseAgeSeconds: proof.age === null ? null : Number(proof.age) }),
    store: STORE, category: Object.freeze({ id: categoryId, name: category.name, url: canonical.href, countEvidence: Object.freeze(categoryCountEvidence), countVerified: categoryCountEvidence.some(record => record.count !== null) }),
    nativePage: Object.freeze({ ...native.pagination, received: native.rows.length, nativeSkus: Object.freeze(nativeSkus) }),
    facets: Object.freeze(facets), invalid: Object.freeze(invalid), duplicates: Object.freeze(duplicates), conflicts: Object.freeze(conflicts),
    counts: Object.freeze({ nativeFacetListProvided: object(data.filters) && Object.hasOwn(data.filters, "brands"), rawFacets: raw.length, distinctValidFacets: facets.length, zeroCountFacets: facets.filter(facet => facet.count === 0).length,
      boundedSubsets: facets.filter(facet => facet.firstPageSubsetBounded).length, eligibleURLProposals: facets.filter(facet => facet.urlProposalEligible).length,
      brandCountSum: sum, reportedTotal, relation: sum === reportedTotal ? "equal" : sum < reportedTotal ? "below" : "above",
      positiveCountDifference: Math.max(0, reportedTotal - sum), potentialFacetListCap: raw.length === BOUND, unbrandedProductCount: null }),
    note: "Facet counts describe an original historical response. Equal totals, small subsets or count differences do not prove exclusivity, unbranded identities, current prices or complete assortment." });
  proposals.set(report, { categoryUrl: canonical.href, categoryId, facets: new Map(facets.map(facet => [facet.id, facet])) });
  return report;
}
function composeProposal(report, id) {
  const control = proposals.get(report), facet = control?.facets.get(id); if (!control || !facet?.urlProposalEligible) throw fail("facet-unverified-or-ineligible-proposal");
  const url = new URL(control.categoryUrl); url.search = "";
  // Literal native searchUrl()/changeBrands() contract. No guessed pagination,
  // limit, API endpoint, cookies, account or default product traits.
  url.searchParams.set("for_store", String(STORE.storeId)); url.searchParams.set("for_category", control.categoryId); url.searchParams.set("for_brands", facet.id);
  return Object.freeze({ url: url.href, enabled: false, collectionEnabled: false, nativeBrandId: facet.id, nativeReportedCount: facet.count,
    gate: "Actual guest HTML filter behavior and filtered-response store identity remain unverified; coordinate any future probe through existing source lease, budgets and pauses." });
}

const controls = new WeakMap();
const fixedProfile = Object.freeze({ storeId: 1775, storeNumber: "258", name: "Berlin-Mitte", city: "Berlin", country: "DE", officialUrl: "https://www.hit.de/maerkte/berlin-mitte" });
function time(options) {
  const now = typeof options?.now === "function" ? options.now() : options?.now ?? Date.now();
  if (!Number.isFinite(now)) throw fail("hit-brand-probe-clock-invalid");
  return now;
}
function metadata(meta) {
  if (!object(meta)) throw fail("hit-brand-probe-capture-required");
  const profile = meta.storeProfile;
  if (!object(profile)) throw fail("hit-brand-probe-store-profile-required");
  // Never retain headers, cookie jars, account data or unrecognized metadata.
  return { storeProfile: Object.fromEntries(Object.keys(fixedProfile).map(key => [key, profile[key]])), capturedAt: meta.capturedAt, responseDate: meta.responseDate, responseAgeSeconds: Number.isNaN(meta.responseAgeSeconds) ? "invalid" : meta.responseAgeSeconds,
    sourceResponseHash: meta.sourceResponseHash, sourceResponseUrl: meta.sourceResponseUrl, requestUrl: meta.requestUrl,
    responseStatus: meta.responseStatus, responseContentType: meta.responseContentType, responseBytes: meta.responseBytes, responseAgeRaw: meta.responseAgeRaw,
    redirects: Array.isArray(meta.redirects) ? structuredClone(meta.redirects) : meta.redirects, anonymous: meta.anonymous, retried: meta.retried };
}
function proofFor(body, meta, options) {
  const now = time(options), at = Date.parse(meta.capturedAt);
  const profile = meta.storeProfile;
  if (Object.keys(fixedProfile).some(key => profile[key] !== fixedProfile[key])) throw fail("hit-brand-probe-store-profile-conflict");
  if (!Number.isFinite(at) || at > now || now - at > 300000 || meta.requestUrl !== meta.sourceResponseUrl
    || !(meta.responseAgeRaw === null && meta.responseAgeSeconds === null || typeof meta.responseAgeRaw === "string" && /^\d+$/.test(meta.responseAgeRaw) && Number(meta.responseAgeRaw) === meta.responseAgeSeconds)
    || meta.responseAgeSeconds !== null && (!Number.isSafeInteger(meta.responseAgeSeconds) || meta.responseAgeSeconds < 0 || meta.responseAgeSeconds > 300)) throw fail("hit-brand-probe-capture-time-or-url-invalid");
  return { status: meta.responseStatus, contentType: meta.responseContentType, sha256: meta.sourceResponseHash, bytes: meta.responseBytes,
    checkedAt: meta.capturedAt, date: meta.responseDate, age: meta.responseAgeSeconds === null ? null : String(meta.responseAgeSeconds),
    url: meta.requestUrl, finalUrl: meta.sourceResponseUrl, anonymous: meta.anonymous, retried: meta.retried, redirects: meta.redirects };
}
function prepareControl(body, rawMeta, options) {
  const meta = metadata(rawMeta), report = analyse(body, proofFor(body, meta, options));
  if (report.nativePage.total < 2 || report.nativePage.total > 40) throw fail("hit-brand-probe-complete-control-required");
  const facet = report.facets.find(value => value.urlProposalEligible && value.count < report.nativePage.total);
  if (!facet) throw fail("hit-brand-probe-shrinking-facet-required");
  const selected = composeProposal(report, facet.id), token = Object.freeze({});
  controls.set(token, { body, meta: structuredClone(meta), report, facet: Object.freeze({ id: facet.id, name: facet.name, count: facet.count }), requestedUrl: selected.url });
  return token;
}
function proposal(control) {
  const value = controls.get(control); if (!value) throw fail("hit-brand-probe-unverified-control");
  return Object.freeze({ requestedUrl: value.requestedUrl, facet: value.facet });
}
function authorizeRequest(control, url) {
  return !!controls.has(control) && controls.get(control).requestedUrl === url;
}
function failure(raw) {
  if (!object(raw) || typeof raw.code !== "string" || !/^(?:hit-[a-z0-9-]+|AbortError|TimeoutError|TypeError|Error)$/.test(raw.code)) throw fail("hit-brand-probe-error-invalid");
  const refused = /^hit-source-http-(403|429)$/.exec(raw.code);
  if (!Number.isSafeInteger(raw.retryAfterMs) || raw.retryAfterMs < 3600000 || raw.retryAfterMs > Number.MAX_SAFE_INTEGER
    || refused && raw.responseStatus !== Number(refused[1]) || !refused && raw.responseStatus !== null) throw fail("hit-brand-probe-error-invalid");
  return { code: raw.code, retryAfterMs: raw.retryAfterMs, responseStatus: raw.responseStatus };
}
function record(control, input, options) {
  const value = controls.get(control); if (!value) throw fail("hit-brand-probe-unverified-control");
  if (!object(input) || !!input.filtered === !!input.error) throw fail("hit-brand-probe-result-required");
  const result = { version: 1, sourceId: Native.SOURCE, nativeStoreId: STORE.storeId, nativeStoreNumber: STORE.storeNumber,
    outcome: "inconclusive", control: { body: value.body, meta: structuredClone(value.meta), skuIds: [...value.report.nativePage.nativeSkus] }, filtered: null,
    requestedUrl: value.requestedUrl, category: { id: value.report.category.id, name: value.report.category.name, total: value.report.nativePage.total },
    facet: { ...value.facet }, error: null, reason: null, actualHTMLFilterVerified: false, collectionEnabled: false, priceImportEnabled: false, complete: false };
  if (input.error) {
    result.error = failure(input.error); result.outcome = result.error.responseStatus === 403 || result.error.responseStatus === 429 ? "source-refused" : "failed";
    result.reason = result.error.code; return result;
  }
  if (!object(input.filtered) || typeof input.filtered.body !== "string" || Buffer.byteLength(input.filtered.body) > MAX_BYTES) throw fail("hit-brand-probe-filtered-body-invalid");
  const filtered = input.filtered, meta = metadata(filtered.meta);
  result.filtered = { body: filtered.body, meta, skuIds: [] };
  try {
    const checked = analyse(filtered.body, proofFor(filtered.body, meta, options), value.requestedUrl, value.facet.id);
    result.filtered.skuIds = [...checked.nativePage.nativeSkus];
    if (Date.parse(meta.capturedAt) < Date.parse(value.meta.capturedAt)) throw fail("hit-brand-probe-filtered-before-control");
    if (checked.category.id !== value.report.category.id || checked.category.name !== value.report.category.name) throw fail("hit-brand-probe-filtered-category-conflict");
    if (checked.nativePage.total !== value.facet.count || checked.nativePage.total >= value.report.nativePage.total || checked.nativePage.received !== checked.nativePage.total) throw fail("hit-brand-probe-filtered-count-not-confirmed");
    const all = new Set(value.report.nativePage.nativeSkus);
    if (checked.nativePage.nativeSkus.some(id => !all.has(id))) throw fail("hit-brand-probe-filtered-sku-not-control-subset");
    result.outcome = "confirmed"; result.reason = "native-html-filter-and-sku-subset-confirmed"; result.actualHTMLFilterVerified = true;
  } catch (error) { result.reason = error.code || "hit-brand-probe-filtered-schema-invalid"; }
  return result;
}
function validateRecord(raw, options) {
  if (!object(raw) || raw.version !== 1 || raw.sourceId !== Native.SOURCE || raw.nativeStoreId !== STORE.storeId || raw.nativeStoreNumber !== STORE.storeNumber || !object(raw.control)) throw fail("hit-brand-probe-record-invalid");
  const control = prepareControl(raw.control.body, raw.control.meta, options), value = proposal(control);
  if (raw.requestedUrl !== value.requestedUrl) throw fail("hit-brand-probe-record-url-conflict");
  // Reconstruct from source originals; reported outcome, flags, SKU lists and
  // native counts are never an authority for persistence or later collection.
  return record(control, { filtered: raw.filtered, error: raw.error }, options);
}
module.exports = Object.freeze({ prepareControl, proposal, authorizeRequest, record, validateRecord });
