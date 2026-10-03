"use strict";

// Read-only planning types are appended only after the native Directory reader.
// An annotation never changes an article DTO or authorizes a price/identity.
const Directory = require("./assortment-article-directory"), Mapper = require("./grocery-assortment-type-mapper");
const Taxonomy = require("./data/grocery-assortment.json");
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = code => Object.assign(new Error(code), { code });
const clone = structuredClone;
const TYPE_IDS = Object.freeze(Taxonomy.categories.flatMap(category => category.productTypes.map(type => type.id)));
function dependencies(deps) {
  if (deps === undefined) return Directory;
  if (!plain(deps) || Object.keys(deps).some(key => key !== "directory") || !deps.directory
    || typeof deps.directory.search !== "function" || typeof deps.directory.status !== "function")
    throw fail("invalid-grocery-article-type-dependencies");
  return deps.directory;
}
function poolRequired(pool) { if (!pool || typeof pool.query !== "function") throw fail("database-required"); }
function metadata() {
  return { ...Mapper.metadata, sourceRevalidationRequired: true, matchMeaning: "planning-type-not-product-equivalence",
    productEquivalence: false, canonicalIdentityChanged: false, packVerifiedByAnnotation: false,
    priceVerifiedByAnnotation: false, currentPriceVerified: false, physicalStorePriceVerified: false,
    truthEligible: false, countMeaning: "rule-capabilities-not-article-or-retailer-coverage" };
}
function typeSupport(productTypeId) {
  const type = Mapper.ruleForType(productTypeId);
  return { productTypeId: type.productTypeId, name: type.name, categoryId: type.categoryId, state: type.state };
}
function mappingStatus() { return { ok: true, ...metadata(), types: TYPE_IDS.map(typeSupport) }; }
function queryOptions(options = {}) {
  if (!plain(options) || Object.keys(options).some(key => !["merchant", "search", "limit", "offset", "now", "productTypeId"].includes(key)))
    throw fail("invalid-grocery-article-type-query");
  let support = null;
  if (Object.hasOwn(options, "productTypeId")) support = typeSupport(options.productTypeId);
  const native = { ...options }; delete native.productTypeId;
  return { directory: Directory.queryOptions(native), type: support };
}
function assertSearchResponse(result, query) {
  if (!plain(result) || result.ok !== true || result.merchant !== query.merchant || result.scopeCountry !== "DE"
    || result.truthEligible !== false || result.currentPriceVerified !== false || result.physicalStorePriceVerified !== false
    || result.assortmentComplete !== false || result.total !== null || result.limit !== query.limit || result.offset !== query.offset
    || !Array.isArray(result.items) || result.items.length > query.limit || result.returnedCount !== result.items.length
    || !Number.isSafeInteger(result.excludedRows) || result.excludedRows < 0
    || !["observed-articles", "no-observed-articles", "unsupported-source"].includes(result.status))
    throw fail("grocery-article-type-source-response-conflict");
  if (result.status === "unsupported-source") {
    if (result.items.length || result.offsetSupported !== false
      || result.scannedRows != null || result.nextOffset != null || result.hasMore != null && result.hasMore !== false)
      throw fail("grocery-article-type-source-pagination-conflict");
  } else if (result.offsetSupported) {
    if (result.offsetSupported !== true || !["ALDI", "EDEKA", "REWE"].includes(query.merchant)
      || !Number.isSafeInteger(result.scannedRows) || result.scannedRows < result.items.length || result.scannedRows > query.limit
      || !Number.isSafeInteger(result.nextOffset) || result.nextOffset !== query.offset + result.scannedRows
      || result.hasMore !== (result.scannedRows === query.limit && result.nextOffset <= Directory.MAX_OFFSET))
      throw fail("grocery-article-type-source-pagination-conflict");
  } else if (result.offsetSupported !== false || result.scannedRows !== null || result.nextOffset !== null || result.hasMore !== false)
    throw fail("grocery-article-type-source-pagination-conflict");
}
function annotationFor(article, query) {
  const annotation = Mapper.annotate(article), key = JSON.stringify([article?.sourceId, article?.scopeChannel, article?.retailerSku]);
  if (!annotation.inputAccepted || article.merchant !== query.merchant || article.identityKey !== key
    || Date.parse(article.observedAt) > query.now)
    throw fail("grocery-article-type-source-article-conflict");
  return { identityKey: article.identityKey, binding: { sourceId: article.sourceId, scopeChannel: article.scopeChannel,
    retailerSku: article.retailerSku, observedAt: article.observedAt, sourceResponseHash: article.sourceResponseHash }, annotation };
}
function unavailable(query, type) {
  return { ok: true, merchant: query.merchant, sourceId: null, scopeCountry: "DE", scopeChannel: "unknown", locationScope: "unknown",
    items: [], returnedCount: 0, excludedRows: 0, total: null, limit: query.limit, offset: query.offset,
    offsetSupported: false, scannedRows: null, nextOffset: null, hasMore: false, scanPerformed: false,
    status: "mapping-unavailable", reason: "product-type-rule-unavailable", truthEligible: false,
    currentPriceVerified: false, physicalStorePriceVerified: false, assortmentComplete: false,
    typeAnnotations: [], typeMapping: { ...metadata(), ...type }, typeFilteredRows: 0,
    note: "Für diese Produktart gibt es noch keine Zuordnungsregel. Es wurden keine Händlerartikel dafür durchsucht; das bestätigt weder fehlende Produkte noch fehlende Preise." };
}
async function search(pool, options = {}, deps) {
  const query = queryOptions(options), service = dependencies(deps); poolRequired(pool);
  if (query.type?.state === "mapping-unavailable") return unavailable(query.directory, query.type);
  const request = { ...query.directory };
  // Directory deliberately rejects even an explicitly supplied zero offset
  // for nonpaged sources; its normalized default is not a caller request.
  if (!["ALDI", "EDEKA", "REWE"].includes(request.merchant)) delete request.offset;
  const result = await service.search(pool, request); assertSearchResponse(result, query.directory);
  const paired = result.items.map(article => ({ article, sidecar: annotationFor(article, query.directory) }));
  const selected = query.type ? paired.filter(value => value.sidecar.annotation.state === "assigned"
    && value.sidecar.annotation.productTypeIds.includes(query.type.productTypeId)) : paired;
  const stateCounts = { assigned: 0, ambiguous: 0, unassigned: 0 };
  for (const value of paired) stateCounts[value.sidecar.annotation.state]++;
  return { ...result, items: selected.map(value => value.article), returnedCount: selected.length,
    status: result.status === "unsupported-source" ? result.status : selected.length ? "observed-articles" : "no-observed-articles",
    reason: result.status === "unsupported-source" ? result.reason : selected.length ? null
      : query.type ? "no-assigned-type-in-examined-page" : result.reason,
    typeAnnotations: selected.map(value => value.sidecar),
    typeMapping: { ...metadata(), productTypeId: query.type?.productTypeId ?? null,
      state: query.type?.state ?? "unfiltered", examinedValidArticles: paired.length, stateCounts },
    typeFilteredRows: paired.length - selected.length, scanPerformed: result.status !== "unsupported-source" };
}
async function status(pool, options = {}, deps) {
  if (!plain(options) || Object.keys(options).some(key => key !== "now")) throw fail("invalid-grocery-article-type-query");
  // The existing Directory validates the clock and each source's native counts.
  if (options.now !== undefined && (typeof options.now !== "number" || !Number.isSafeInteger(options.now) || options.now < 0
    || !Number.isFinite(new Date(options.now).getTime()))) throw fail("invalid-grocery-article-type-query");
  const service = dependencies(deps); poolRequired(pool);
  const result = await service.status(pool, { ...options });
  if (!plain(result) || result.ok !== true || result.scopeCountry !== "DE" || result.total !== null
    || result.assortmentComplete !== false || result.currentPriceVerified !== false || result.physicalStorePriceVerified !== false
    || !Array.isArray(result.merchants) || result.merchants.length !== Directory.MERCHANTS.length)
    throw fail("grocery-article-type-source-response-conflict");
  return { ...result, typeMapping: mappingStatus() };
}
module.exports = { search, status, queryOptions, typeSupport, mappingStatus, metadata };
