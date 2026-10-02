"use strict";

// Source-native HTML filter diagnostics only: no fetch, price import or GTIN API.
// Proposal capabilities are private and bind one observed category and facet.
const crypto = require("node:crypto");
const Native = require("./hit-assortment-client");
const Identity = require("./product-identity");
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
  if (typeof body !== "string" || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body) || Buffer.byteLength(body) > MAX_BYTES || !object(proof) || proof.status !== 200
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
    store: STORE, nativeRows: Object.freeze(structuredClone(native.rows)),
    category: Object.freeze({ id: categoryId, name: category.name, nativeLevel: category.level, url: canonical.href, countEvidence: Object.freeze(categoryCountEvidence), countVerified: categoryCountEvidence.some(record => record.count !== null) }),
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
  const value = { storeProfile: Object.fromEntries(Object.keys(fixedProfile).map(key => [key, profile[key]])), capturedAt: meta.capturedAt, responseDate: meta.responseDate, responseAgeSeconds: Number.isNaN(meta.responseAgeSeconds) ? "invalid" : meta.responseAgeSeconds,
    sourceResponseHash: meta.sourceResponseHash, sourceResponseUrl: meta.sourceResponseUrl, requestUrl: meta.requestUrl,
    responseStatus: meta.responseStatus, responseContentType: meta.responseContentType, responseBytes: meta.responseBytes, responseAgeRaw: meta.responseAgeRaw,
    redirects: Array.isArray(meta.redirects) ? structuredClone(meta.redirects) : meta.redirects, anonymous: meta.anonymous, retried: meta.retried };
  if(Buffer.byteLength(JSON.stringify(value))>16384)throw fail("hit-brand-partition-capture-meta-bound-exceeded");
  return value;
}
function proofFor(body, meta, options) {
  const now = time(options), at = Date.parse(meta.capturedAt);
  const profile = meta.storeProfile;
  if (Object.keys(fixedProfile).some(key => profile[key] !== fixedProfile[key])) throw fail("hit-brand-probe-store-profile-conflict");
  if (!Number.isFinite(at) || at > now || now - at > 300000 || Date.parse(meta.responseDate) > now || meta.requestUrl !== meta.sourceResponseUrl
    || !(meta.responseAgeRaw === null && meta.responseAgeSeconds === null || typeof meta.responseAgeRaw === "string" && /^\d+$/.test(meta.responseAgeRaw) && Number(meta.responseAgeRaw) === meta.responseAgeSeconds)
    || meta.responseAgeSeconds !== null && (!Number.isSafeInteger(meta.responseAgeSeconds) || meta.responseAgeSeconds < 0 || meta.responseAgeSeconds > 300)) throw fail("hit-brand-probe-capture-time-or-url-invalid");
  return { status: meta.responseStatus, contentType: meta.responseContentType, sha256: meta.sourceResponseHash, bytes: meta.responseBytes,
    checkedAt: meta.capturedAt, date: meta.responseDate, age: meta.responseAgeSeconds === null ? null : String(meta.responseAgeSeconds),
    url: meta.requestUrl, finalUrl: meta.sourceResponseUrl, anonymous: meta.anonymous, retried: meta.retried, redirects: meta.redirects };
}

const controls = new WeakMap(), MAX_RECORD_BYTES = 16 * 1024 * 1024;
// For permitted HTML characters JSON uses at most two bytes per raw UTF-8 byte.
// Reserve a full six-MiB filtered body, its bounded metadata and all bounded
// native diagnostic arrays BEFORE authorizing any additional source request.
const FILTER_RECORD_RESERVE = 2 * MAX_BYTES + 65536;
const KIND = "large-leaf-native-brand-partition-diagnostic";
function plain(value) { return object(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function canonical(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function quoteSignature(row) {
  return JSON.stringify(canonical([row.storeId,row.storeNumber,row.ean,typeof row.headline === "string" ? row.headline.trim().replace(/\s+/g," ") : row.headline,row.overview,row.price,row.deposit??null,row.priceTag,row.stringBeforePrice,row.stringBelowPrice,row.stringBeforePriceIsStrikethrough,row.stringBelowPriceIsStrikethrough,row.inset,row.inApp,row.packageVariants,row.variantArticles]));
}
function identityKey(row) {
  const pack = Native.exactPack(row.overview);
  if (!pack || typeof row.ean !== "string" || !/^(?:\d{8}|\d{12,14})$/.test(row.ean)) return null;
  return JSON.stringify([row.ean,pack.total.unit,pack.total.amount/pack.count,pack.count]);
}
function productPaths(report) {
  const category = new URL(report.category.url);
  for (const row of report.nativeRows) {
    if (!validText(row.url, 1800) || /[\\%]/.test(row.url)) throw fail("hit-brand-partition-native-product-url-invalid");
    let url; try { url = new URL(row.url); } catch { throw fail("hit-brand-partition-native-product-url-invalid"); }
    const prefix = category.pathname + "/";
    if (url.protocol !== "https:" || url.hostname !== "www.hit.de" || url.port || url.username || url.password || url.hash
      || !url.pathname.startsWith(prefix) || url.pathname.slice(prefix.length).includes("/")
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*-\d{1,24}[A-Z]{1,3}$/.test(url.pathname.slice(prefix.length))
      || !url.pathname.endsWith("-"+row.external_id) || [...url.searchParams.keys()].some(key=>key!=="markt")
      || url.searchParams.getAll("markt").length>1 || url.searchParams.has("markt") && url.searchParams.get("markt")!==STORE.storeNumber)
      throw fail("hit-brand-partition-native-product-category-or-sku-conflict");
  }
}
function nativeConflicts(report) {
  const byIdentity = new Map(), conflicts=[];
  for (const row of report.nativeRows) {
    const key=identityKey(row); if (!key) continue;
    const signature=quoteSignature(row), known=byIdentity.get(key);
    if (known && known!==signature) conflicts.push(key); else if (!known) byIdentity.set(key,signature);
  }
  return [...new Set(conflicts)];
}
function nativeState(raw) {
  if(!plain(raw)||!plain(raw.seenQuotes)||Object.keys(raw.seenQuotes).length>100000||!Array.isArray(raw.conflictGtins)||raw.conflictGtins.length>100000
    ||new Set(raw.conflictGtins).size!==raw.conflictGtins.length||raw.conflictGtins.some(id=>typeof id!=="string"||!Identity.gtinValid(id)))throw fail("hit-brand-partition-native-state-invalid");
  for(const [key,quote] of Object.entries(raw.seenQuotes)){
    const fields=key.split("|");
    if(key.length>160||fields.length!==4||!plain(quote)||quote.gtin!==fields[0]||!Identity.gtinValid(quote.gtin)||!["g","ml","piece"].includes(fields[1])
      ||!/^\d+(?:\.\d+)?$/.test(fields[2])||!(Number(fields[2])>0)||!Number.isFinite(Number(fields[2]))||!/^\d+$/.test(fields[3])||!Number.isSafeInteger(Number(fields[3]))||Number(fields[3])<1
      ||!/^[a-f0-9]{64}$/.test(quote.signature))throw fail("hit-brand-partition-native-state-invalid");
  }
  return {seenQuotes:Object.fromEntries(Object.entries(raw.seenQuotes).map(([key,quote])=>[key,{gtin:quote.gtin,signature:quote.signature}])),conflictGtins:[...raw.conflictGtins]};
}
function cycleQuote(row,meta) {
  const parsed=Native.parseRow(row,meta);if(!parsed.ok)return null;
  const c=parsed.candidate,key=[c.gtin,c.normalizedPack.unit,c.normalizedPack.amount/c.packCount,c.packCount].join("|");
  return {key,gtin:c.gtin,signature:digest(JSON.stringify([c.name,c.priceCents,c.depositCents,c.nativePriceType]))};
}
function cycleIdentityKey(row) {
  const pack=Native.exactPack(row.overview);
  return pack&&typeof row.ean==="string"&&Identity.gtinValid(row.ean)?[row.ean,pack.total.unit,pack.total.amount/pack.count,pack.count].join("|"):null;
}
function prepareControl(body, rawMeta, node, options) {
  const meta=metadata(rawMeta), report=analyse(body,proofFor(body,meta,options));
  const existing=nativeState(options?.nativeState);
  if (!plain(node) || node.level!==3 || report.category.nativeLevel!==3 || report.nativePage.total<=40 || report.nativePage.total>100000
    || node.id!==report.category.id || node.name!==report.category.name || !Number.isSafeInteger(node.count) || node.count!==report.nativePage.total
    || sourceURL(node.url,node.id).href!==meta.requestUrl || new URL(node.url).pathname!==new URL(report.category.url).pathname)
    throw fail("hit-brand-partition-fresh-large-leaf-required");
  productPaths(report);
  if(nativeConflicts(report).length)throw fail("hit-brand-partition-control-native-identity-conflict");
  const facet=report.facets.find(value=>value.urlProposalEligible);
  if(!facet)throw fail("hit-brand-partition-offered-small-facet-required");
  const selected=composeProposal(report,facet.id),token=Object.freeze({});
  const value={body,meta:structuredClone(meta),report,existing,node:{id:node.id,name:node.name,url:node.url,level:3,count:node.count},facet:{id:facet.id,name:facet.name,count:facet.count},requestedUrl:selected.url};
  if(Buffer.byteLength(JSON.stringify(baseRecord(value)))+FILTER_RECORD_RESERVE>MAX_RECORD_BYTES)throw fail("hit-brand-partition-control-record-budget-exhausted");
  controls.set(token,value);
  return token;
}
function proposal(control) {
  const value=controls.get(control);if(!value)throw fail("hit-brand-partition-unverified-control");
  return Object.freeze({requestedUrl:value.requestedUrl,facet:Object.freeze({...value.facet}),collectionEnabled:false,priceImportEnabled:false,complete:false});
}
function authorizeRequest(control,url) { return controls.has(control) && controls.get(control).requestedUrl===url; }
function errorProof(raw) {
  if (!plain(raw) || typeof raw.code!=="string" || raw.code.length>160 || !/^(?:hit-[a-z0-9-]+|AbortError|TimeoutError|TypeError|Error)$/.test(raw.code)) throw fail("hit-brand-partition-error-invalid");
  const refused=/^hit-source-http-(403|429)$/.exec(raw.code);
  if(!Number.isSafeInteger(raw.retryAfterMs)||raw.retryAfterMs<3600000||refused && raw.responseStatus!==Number(refused[1])||!refused&&raw.responseStatus!==null)throw fail("hit-brand-partition-error-invalid");
  return {code:raw.code,retryAfterMs:raw.retryAfterMs,responseStatus:raw.responseStatus};
}
function bounded(result) {
  if(Buffer.byteLength(JSON.stringify(result))>MAX_RECORD_BYTES)throw fail("hit-brand-partition-record-bound-exceeded");
  return result;
}
function baseRecord(value) {
  return {version:1,kind:KIND,sourceId:Native.SOURCE,nativeStoreId:STORE.storeId,nativeStoreNumber:STORE.storeNumber,
    attempted:true,outcome:"inconclusive",control:{body:value.body,meta:structuredClone(value.meta),skuIds:[...value.report.nativePage.nativeSkus]},filtered:null,
    requestedUrl:value.requestedUrl,category:{id:value.report.category.id,name:value.report.category.name,url:value.report.category.url,level:3,total:value.report.nativePage.total},controlNode:{...value.node},facet:{...value.facet},
    nativeState:structuredClone(value.existing),error:null,reason:null,newSkuIds:[],overlapSkuIds:[],conflictingSkus:[],conflictingIdentities:[],quarantinedGtins:[],unresolvedKnownIdentities:[],actualHTMLFilterVerified:false,collectionEnabled:false,priceImportEnabled:false,complete:false};
}
function record(control,input,options) {
  const value=controls.get(control);if(!value)throw fail("hit-brand-partition-unverified-control");
  if(!plain(input)||!!input.filtered===!!input.error)throw fail("hit-brand-partition-result-required");
  // Recheck current time at the actual attempt/result. A token cannot make an
  // expired or future control original current again.
  proofFor(value.body,value.meta,options);
  const result=baseRecord(value);
  if(input.error){result.error=errorProof(input.error);result.reason=result.error.code;result.outcome=[403,429].includes(result.error.responseStatus)?"source-refused":"failed";return bounded(result);}
  if(!plain(input.filtered)||typeof input.filtered.body!=="string"||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input.filtered.body)||Buffer.byteLength(input.filtered.body)>MAX_BYTES)throw fail("hit-brand-partition-filtered-body-invalid");
  result.filtered={body:input.filtered.body,meta:metadata(input.filtered.meta),skuIds:[]};
  try{
    const filtered=result.filtered,checked=analyse(filtered.body,proofFor(filtered.body,filtered.meta,options),value.requestedUrl,value.facet.id);
    result.filtered.skuIds=[...checked.nativePage.nativeSkus];
    if(Date.parse(filtered.meta.capturedAt)<Date.parse(value.meta.capturedAt))throw fail("hit-brand-partition-filtered-before-control");
    if(checked.category.id!==value.report.category.id||checked.category.name!==value.report.category.name||checked.category.nativeLevel!==3)throw fail("hit-brand-partition-filtered-leaf-category-conflict");
    if(checked.nativePage.total!==value.facet.count||checked.nativePage.received!==checked.nativePage.total||checked.nativePage.total>40)throw fail("hit-brand-partition-complete-facet-count-required");
    productPaths(checked);
    const previous=new Map(value.report.nativeRows.map(row=>[row.external_id,row])),previousIdentities=new Map();
    const knownGtins=new Set([...Object.values(value.existing.seenQuotes).map(quote=>quote.gtin),...value.existing.conflictGtins]);
    for(const row of value.report.nativeRows){const key=identityKey(row);if(key)previousIdentities.set(key,quoteSignature(row));}
    result.conflictingIdentities=nativeConflicts(checked);
    for(const row of checked.nativeRows){
      const old=previous.get(row.external_id);if(old&&quoteSignature(old)!==quoteSignature(row))result.conflictingSkus.push(row.external_id);
      const key=identityKey(row);if(key&&previousIdentities.has(key)&&previousIdentities.get(key)!==quoteSignature(row))result.conflictingIdentities.push(key);
      const cycle=cycleQuote(row,filtered.meta);
      if(cycle&&value.existing.seenQuotes[cycle.key]&&value.existing.seenQuotes[cycle.key].signature!==cycle.signature)result.conflictingIdentities.push(cycle.key);
      const nativeKey=cycleIdentityKey(row);
      // Missing comparable normal-price/pack evidence is uncertainty. It must
      // not erase known cycle evidence or be relabelled an actual conflict.
      if(nativeKey&&value.existing.seenQuotes[nativeKey]&&!cycle)result.unresolvedKnownIdentities.push(nativeKey);
      if(typeof row.ean==="string"&&knownGtins.has(row.ean)&&!nativeKey)result.unresolvedKnownIdentities.push(row.ean+"|native-pack-unconfirmed");
      if(typeof row.ean==="string"&&value.existing.conflictGtins.includes(row.ean))result.quarantinedGtins.push(row.ean);
    }
    result.conflictingIdentities=[...new Set(result.conflictingIdentities)];
    result.quarantinedGtins=[...new Set(result.quarantinedGtins)];
    result.unresolvedKnownIdentities=[...new Set(result.unresolvedKnownIdentities)];
    if(result.conflictingSkus.length||result.conflictingIdentities.length||result.quarantinedGtins.length)throw fail("hit-brand-partition-overlap-native-identity-or-quote-conflict");
    if(result.unresolvedKnownIdentities.length)throw fail("hit-brand-partition-known-native-quote-or-pack-unconfirmed");
    result.newSkuIds=checked.nativePage.nativeSkus.filter(id=>!previous.has(id));result.overlapSkuIds=checked.nativePage.nativeSkus.filter(id=>previous.has(id));
    result.outcome="confirmed";result.reason="native-large-leaf-html-facet-count-and-product-path-confirmed";result.actualHTMLFilterVerified=true;
  }catch(error){result.reason=error.code||"hit-brand-partition-filtered-schema-invalid";}
  return bounded(result);
}
function validateRecord(raw,options) {
  if(!plain(raw)||raw.version!==1||raw.kind!==KIND||raw.sourceId!==Native.SOURCE||raw.nativeStoreId!==STORE.storeId||raw.nativeStoreNumber!==STORE.storeNumber||!plain(raw.control))throw fail("hit-brand-partition-record-invalid");
  const control=prepareControl(raw.control.body,raw.control.meta,raw.controlNode,{...options,nativeState:raw.nativeState});
  if(raw.requestedUrl!==proposal(control).requestedUrl)throw fail("hit-brand-partition-record-url-conflict");
  return record(control,{filtered:raw.filtered,error:raw.error},options);
}
function summarize(raw,options) {
  // Historical summaries describe the original diagnostic only. Recompute at
  // its original capture boundary, never renew evidence to the present clock.
  // Actual persistence must separately call validateRecord with its real batch
  // clock and bind nativeState/control to the actual ordinary checkpoint.
  const now=time(options),controlAt=Date.parse(raw?.control?.meta?.capturedAt),filteredAt=raw?.filtered?Date.parse(raw.filtered.meta?.capturedAt):controlAt;
  if(!Number.isFinite(controlAt)||!Number.isFinite(filteredAt)||controlAt>now||filteredAt>now)throw fail("hit-brand-partition-historical-capture-invalid");
  const checked=validateRecord(raw,{now:Math.max(controlAt,filteredAt)});
  return {attempted:true,outcome:checked.outcome,reason:checked.reason,actualHTMLFilterVerified:checked.actualHTMLFilterVerified,collectionEnabled:false,priceImportEnabled:false,complete:false,
    requestedUrl:checked.requestedUrl,categoryId:checked.category.id,nativeFacetId:checked.facet.id,nativeFacetCount:checked.facet.count,controlCapturedAt:checked.control.meta.capturedAt,
    filteredCapturedAt:checked.filtered?.meta.capturedAt??null,controlResponseHash:checked.control.meta.sourceResponseHash,filteredResponseHash:checked.filtered?.meta.sourceResponseHash??null,
    newNativeSkuCount:checked.newSkuIds.length,overlapNativeSkuCount:checked.overlapSkuIds.length,conflictingNativeSkuCount:checked.conflictingSkus.length,conflictingNativeIdentityCount:checked.conflictingIdentities.length,quarantinedGtinCount:checked.quarantinedGtins.length,unresolvedKnownIdentityCount:checked.unresolvedKnownIdentities.length};
}
module.exports=Object.freeze({prepareControl,proposal,authorizeRequest,record,validateRecord,summarize,summarizeHistoricalRecord:summarize,MAX_BYTES,MAX_RECORD_BYTES,STORE:fixedProfile});
