"use strict";

const Inventory = require("./published-retailer-inventory");
const Wolt = require("./wolt-retailer-price-service");
const Rewe = require("./rewe-retailer-price-service");
const Filters = require("./retailer-product-search-filters");
const Discovery = require("./price-query-discovery");
const Focus = require("./grocery-collection-focus");

const RETAILERS = Object.freeze(Focus.status().retailers);
const SERVICES = Object.freeze({ wolt: Wolt, rewe: Rewe });
const SOURCE_SERVICES = new Map([Wolt, Rewe].map(service => [service.SOURCE, service]));
const MAX_ROWS = 10000, QUERY_LIMIT = 200;
const fail = code => Object.assign(new Error(code), { code });
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19) ? time : null;
}
function options(raw = {}, requireQuery = false) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(key => !["search", "gtin", "pack", "merchant", "scopeChannel", "limit", "now"].includes(key))) throw fail("invalid-reference-search");
  const now = raw.now === undefined ? Date.now() : new Date(raw.now).getTime();
  if (!Number.isFinite(now) || raw.now === null || typeof raw.now === "boolean") throw fail("invalid-time");
  let search, gtin, merchant;
  if (raw.search !== undefined) {
    if (typeof raw.search !== "string" || raw.search.trim().length < 2 || raw.search.trim().length > 120) throw fail("invalid-reference-search");
    search = raw.search.trim();
  }
  if (raw.gtin !== undefined) {
    if (typeof raw.gtin !== "string" || !Discovery.validGtin(raw.gtin.trim())) throw fail("invalid-reference-gtin");
    gtin = raw.gtin.trim();
  }
  if (raw.merchant !== undefined) {
    if (typeof raw.merchant !== "string") throw fail("invalid-merchant");
    merchant = RETAILERS.find(value => value.toLowerCase() === raw.merchant.trim().toLowerCase());
    if (!merchant) throw fail("invalid-merchant");
  }
  const requestedPack = Filters.salesPack(raw.pack), scopeChannel = Filters.channel(raw.scopeChannel);
  const limit = raw.limit === undefined ? 50 : raw.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > QUERY_LIMIT) throw fail("invalid-reference-limit");
  if (requireQuery && !search && !gtin) throw fail("reference-query-required");
  return { now, search, gtin, merchant, pack: raw.pack, requestedPack, scopeChannel, limit };
}
function unsupportedConditions(raw) {
  return ["personalizedPrice", "loyaltyPrice", "personalPrice", "requiresMembership", "requiresCoupon", "requiresApp", "conditional", "multiBuy"].some(key => raw[key] != null && raw[key] !== false)
    || raw.priceAudience != null && raw.priceAudience !== "public"
    || ["minimumQuantity", "minQuantity", "minimumSpend"].some(key => raw[key] != null);
}
function validate(raw, now) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { reasons: ["offer-required"] };
  const service = SOURCE_SERVICES.get(raw.sourceId);
  if (!service || !RETAILERS.includes(raw.merchant)) return { reasons: ["Berlin-source-not-approved"] };
  if (raw.truthEligible === true || raw.current === false || raw.state != null && raw.state !== "published" || unsupportedConditions(raw)) return { reasons: ["unsupported-reference-authority-or-conditions"] };
  const checked = service.validateOffer(raw, { now });
  if (!checked.ok) return { reasons: checked.reasons };
  const offer = checked.offer, captured = timestamp(offer.capturedAt), expiry = timestamp(raw.expiresAt);
  // Never use updatedAt/sourceDate, or let revalidation renew an original expiry.
  if (captured < now - service.DAY_MS || expiry === null || expiry <= now || expiry <= captured || expiry > Date.parse(offer.expiresAt)) return { reasons: ["reference-expired-or-invalid-original-expiry"] };
  if (offer.shop.city !== "Berlin" || offer.shop.country !== "DE") return { reasons: ["native-Berlin-shop-scope-required"] };
  return { offer: { ...offer, expiresAt: new Date(expiry).toISOString(), current: true }, service };
}
function sourceMarket(offer, service) {
  return { ...offer.shop, sourceId: offer.sourceId,
    nativeMarketId: service === Wolt ? Wolt.VENUE.nativeMarketId : offer.nativeMarketId,
    ...(offer.nativeVenueId ? { nativeVenueId: offer.nativeVenueId } : {}),
    ...(offer.nativeStoreId ? { nativeStoreId: offer.nativeStoreId } : {}) };
}
const serialize = value => JSON.stringify(value);
const marketKey = offer => serialize([offer.sourceId, offer.nativeVenueId || offer.nativeMarketId, offer.nativeStoreId || null]);
const nativeKey = offer => serialize([marketKey(offer), offer.retailerSku]);
const packKey = offer => [offer.packCount, offer.packAmount, offer.packUnit];
const conditionKey = offer => [offer.priceType, offer.promotionStatus];
const identityKey = offer => serialize([offer.merchant, offer.gtin ? ["native-gtin", offer.gtin] : ["native-retailer-sku", offer.sourceId, offer.retailerSku], packKey(offer), offer.scopeChannel, conditionKey(offer)]);
const economicKey = offer => serialize([offer.price, offer.deposit, offer.displayedPrice, offer.payablePackPrice, offer.originalPrice, offer.nativePriceIncludesDeposit, offer.depositIncludedInDisplayedPrice]);
const nativeSnapshotKey = offer => serialize([offer.gtin, packKey(offer), conditionKey(offer), economicKey(offer), offer.name, offer.brand, offer.description, offer.availability, offer.expiresAt, offer.nativePromotionValidTo ?? null]);
const deterministic = (a, b) => nativeKey(a.offer).localeCompare(nativeKey(b.offer)) || a.offer.sourceResponseHash.localeCompare(b.offer.sourceResponseHash);
function matches(offer, query) {
  return (!query.merchant || offer.merchant === query.merchant) && (!query.scopeChannel || offer.scopeChannel === query.scopeChannel)
    && (!query.gtin || offer.gtin === query.gtin) && Filters.matchesPack(offer, query.requestedPack)
    && (!query.search || [offer.name, offer.brand, offer.gtin].some(value => typeof value === "string" && value.toLocaleLowerCase("de").includes(query.search.toLocaleLowerCase("de"))));
}
function select(inputs, rawOptions = {}) {
  const query = options(rawOptions);
  if (!Array.isArray(inputs) || inputs.length > MAX_ROWS) throw fail("invalid-reference-offers");
  const reasons = {}, native = new Map();
  const exclude = (reason, count = 1) => { reasons[reason] = (reasons[reason] || 0) + count; };
  for (const raw of inputs) {
    const row = validate(raw, query.now);
    if (!row.offer) { for (const reason of row.reasons) exclude(reason); continue; }
    const key = nativeKey(row.offer);
    if (!native.has(key)) native.set(key, []);
    native.get(key).push(row);
  }
  const identities = new Map();
  for (const rows of native.values()) {
    const newest = Math.max(...rows.map(row => Date.parse(row.offer.capturedAt)));
    const latest = rows.filter(row => Date.parse(row.offer.capturedAt) === newest).sort(deterministic);
    if (new Set(latest.map(row => nativeSnapshotKey(row.offer))).size !== 1) { exclude("ambiguous-native-latest-capture", latest.length); continue; }
    const row = latest[0];
    // Collapse the actual current native listing before filtering: no old GTIN,
    // old pack, cheaper price, or previous promotion can reappear as a fallback.
    if (row.offer.availability === "unavailable") { exclude("native-unavailable"); continue; }
    if (!matches(row.offer, query)) continue;
    const key = identityKey(row.offer);
    if (!identities.has(key)) identities.set(key, []);
    identities.get(key).push(row);
  }
  const all = [];
  for (const [key, rows] of identities) {
    const byMarket = new Map();
    for (const row of rows) {
      const key = marketKey(row.offer), current = byMarket.get(key);
      if (!current || Date.parse(row.offer.capturedAt) > Date.parse(current[0].offer.capturedAt)) byMarket.set(key, [row]);
      else if (row.offer.capturedAt === current[0].offer.capturedAt) current.push(row);
    }
    if ([...byMarket.values()].some(rows => new Set(rows.map(row => economicKey(row.offer))).size > 1)) { exclude("ambiguous-market-latest-capture"); continue; }
    const marketRows = [...byMarket.values()].map(rows => rows.sort(deterministic)[0]);
    const newest = Math.max(...marketRows.map(row => Date.parse(row.offer.capturedAt))), latest = marketRows.filter(row => Date.parse(row.offer.capturedAt) === newest).sort(deterministic);
    if (new Set(latest.map(row => economicKey(row.offer))).size > 1) { exclude("ambiguous-Berlin-latest-capture"); continue; }
    const row = latest[0], prices = marketRows.map(row => row.offer.price);
    all.push({ offer: row.offer, reference: { kind: "last-observed", city: "Berlin", country: "DE", merchant: row.offer.merchant, key,
      identityKind: row.offer.gtin ? "native-gtin" : "native-retailer-sku", observedAt: row.offer.capturedAt,
      sourceMarket: sourceMarket(row.offer, row.service), observedMarkets: marketRows.length,
      knownPriceRange: { min: Math.min(...prices), max: Math.max(...prices) },
      observedMarketPrices: marketRows.sort(deterministic).map(item => ({ sourceMarket: sourceMarket(item.offer, item.service), observedAt: item.offer.capturedAt, price: item.offer.price, deposit: item.offer.deposit, currency: "EUR" })) } });
  }
  all.sort((a, b) => Date.parse(b.offer.capturedAt) - Date.parse(a.offer.capturedAt) || a.reference.key.localeCompare(b.reference.key));
  const coverage = { complete: false, allStoresRequired: false, coverageUnit: "retailer-product", queryOnly: true, inputRows: inputs.length, matchedReferenceRows: all.length,
    retailers: RETAILERS.map(merchant => { const rows = all.filter(row => row.offer.merchant === merchant); return { merchant, referenceRows: rows.length,
      observedMarkets: new Set(rows.map(row => marketKey(row.offer))).size, scopeChannels: [...new Set(rows.map(row => row.offer.scopeChannel))].sort(),
      supportedSources: [Wolt, Rewe].filter(service => service.MERCHANT === merchant).map(service => service.SOURCE), missing: rows.length === 0 }; }),
    missingRetailers: RETAILERS.filter(merchant => !all.some(row => row.offer.merchant === merchant)), excludedReasons: reasons };
  return { ok: true, city: "Berlin", country: "DE", items: all.slice(0, query.limit), coverage, bounded: true, truncated: all.length > query.limit,
    scopeChannels: [...new Set(all.map(row => row.offer.scopeChannel))].sort(), maxAgeHours: 24, physicalStorePrices: false,
    note: "Zuletzt belegte Berliner Händlerreferenzen. Herkunftsmarkt und Kaufkanal bleiben sichtbar; eine Referenz belegt weder alle Filialen noch das vollständige Sortiment." };
}
async function search(pool, rawOptions = {}, inventoryDeps = Inventory) {
  if (!pool) throw fail("database-required");
  const query = options(rawOptions, true);
  if (!inventoryDeps || typeof inventoryDeps.search !== "function") throw fail("reference-inventory-required");
  if (query.merchant && ![Wolt.MERCHANT, Rewe.MERCHANT].includes(query.merchant) || query.scopeChannel && !["online", "pickup"].includes(query.scopeChannel)) return select([], rawOptions);
  const request = { now: query.now, limit: QUERY_LIMIT, ...(query.search ? { search: query.search } : {}), ...(query.gtin ? { gtin: query.gtin } : {}),
    ...(query.pack !== undefined ? { pack: query.pack } : {}), ...(query.merchant ? { merchant: query.merchant } : {}), ...(query.scopeChannel ? { scopeChannel: query.scopeChannel } : {}) };
  const result = await inventoryDeps.search(pool, request, SERVICES);
  if (!result || !Array.isArray(result.items) || result.items.length > QUERY_LIMIT) throw fail("invalid-reference-inventory-response");
  const selected = select(result.items, { ...rawOptions, now: query.now });
  selected.truncated ||= result.items.length === QUERY_LIMIT || result.truncated === true;
  return selected;
}
module.exports = Object.freeze({ select, search, RETAILERS, QUERY_LIMIT });
