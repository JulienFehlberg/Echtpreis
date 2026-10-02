"use strict";
const assert = require("assert/strict");
const Reference = require("../berlin-reference-prices");
const Wolt = require("../wolt-retailer-price-service"), Rewe = require("../rewe-retailer-price-service");
const now = Date.parse("2026-10-02T16:00:00.000Z"), iso = value => new Date(value).toISOString();
let groups = 0;
function test(name, run) { run(); groups++; }
// Synthetic offers using the existing closed native contracts; no retailer calls.
function wolt(patch = {}) {
  const capturedAt = patch.capturedAt ?? iso(now - 1000), price = patch.price ?? 1.89, deposit = patch.deposit === undefined ? .15 : patch.deposit;
  return { sourceId: Wolt.SOURCE, merchant: "EDEKA", nativeVenueId: Wolt.VENUE.nativeVenueId,
    retailerSku: "1dc18e85145be6774701f54d", gtin: "5449000017888", name: "SYNTHETIC Milch 3,5% 1 l", brand: "LOCAL TEST", description: null,
    pack: "1 l", packAmount: 1000, packUnit: "ml", packCount: 1, price, deposit, depositLabel: deposit === null ? null : "MEHRWEG",
    displayedPrice: (Math.round(price * 100) + Math.round((deposit ?? 0) * 100)) / 100,
    nativePriceIncludesDeposit: true, currency: "EUR", priceType: "unknown", promotionStatus: "unknown", availability: "unknown",
    capturedAt, expiresAt: iso(Date.parse(capturedAt) + Wolt.DAY_MS),
    sourceUrl: "https://wolt.com/de/deu/berlin/venue/edeka-hilbrecht",
    sourceResponseUrl: "https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/edeka-hilbrecht/assortment",
    proofHash: "a".repeat(64), sourceResponseHash: "a".repeat(64), shop: { ...Wolt.VENUE },
    scopeCountry: "DE", scopeChannel: "online", state: "published", current: true, priceBasis: "pack", truthEligible: false, ...patch };
}
function rewe(patch = {}) {
  const capturedAt = patch.capturedAt ?? iso(now - 1000), price = patch.price ?? 1.49, deposit = patch.deposit === undefined ? .25 : patch.deposit;
  return { sourceId: Rewe.SOURCE, merchant: "REWE", nativeMarketId: Rewe.MARKET.nativeMarketId, nativeStoreId: Rewe.MARKET.nativeStoreId,
    retailerSku: "8-FKRIL2JI-" + Rewe.MARKET.nativeStoreId, nativeArticleId: "FKRIL2JI", retailerProductId: "9482185", gtin: "90486647",
    name: "SYNTHETIC Red Bull Glacier 0,25 l", brand: "Red Bull", pack: "0.25 l", packAmount: 250, packUnit: "ml", packCount: 1,
    price, deposit, displayedPrice: price, nativePriceIncludesDeposit: false, currency: "EUR", priceType: "unknown", promotionStatus: "unknown", availability: "unknown",
    capturedAt, expiresAt: iso(Date.parse(capturedAt) + Rewe.DAY_MS),
    sourceUrl: "https://www.rewe.de/shop/p/red-bull-energy-drink-glacier-0-25l/9482185",
    sourceResponseUrl: "https://www.rewe.de/shop/api/products?marketId=8321066&serviceTypes=PICKUP&page=1&objectsPerPage=40",
    proofHash: "b".repeat(64), sourceResponseHash: "b".repeat(64), shop: { ...Rewe.MARKET }, scopeCountry: "DE", scopeChannel: "pickup",
    state: "published", current: true, priceBasis: "pack", truthEligible: false, ...patch };
}
const select = (rows, opts = {}) => Reference.select(rows, { now, ...opts });
test("Existing validators authenticate fixtures and reference shape", () => {
  assert(Wolt.validateOffer(wolt(), { now }).ok); assert(Rewe.validateOffer(rewe(), { now }).ok);
  const result = select([wolt(), rewe()]);
  assert.equal(result.ok, true); assert.equal(result.city, "Berlin"); assert.equal(result.items.length, 2);
  assert.deepEqual(result.scopeChannels, ["online", "pickup"]); assert.equal(result.physicalStorePrices, false);
  const row = result.items.find(row => row.offer.merchant === "REWE");
  assert.equal(row.reference.kind, "last-observed"); assert.equal(row.reference.observedAt, row.offer.capturedAt);
  assert.equal(row.reference.sourceMarket.nativeMarketId, Rewe.MARKET.nativeMarketId);
  assert.equal(row.reference.sourceMarket.nativeStoreId, Rewe.MARKET.nativeStoreId);
  assert.equal(row.offer.truthEligible, false); assert.equal(row.offer.current, true); assert.equal(row.offer.state, "published");
  assert.equal(row.offer.shippingIncluded, false); assert.equal(row.offer.serviceFeesIncluded, false);
  assert(!("storeId" in row.offer)); assert(!("canonicalProductId" in row.offer));
});
test("Latest higher quote wins, and historical same-market prices do not become a range", () => {
  const old = wolt({ price: .99, capturedAt: iso(now - 5000) }), fresh = wolt({ price: 1.99 });
  const row = select([fresh, old]).items[0]; assert.equal(row.offer.price, 1.99);
  assert.deepEqual(row.reference.knownPriceRange, { min: 1.99, max: 1.99 }); assert.equal(row.reference.observedMarkets, 1);
  assert.equal(select([old, fresh]).items[0].reference.key, row.reference.key);
});
test("Newer native SKU with missing GTIN never inherits its old GTIN", () => {
  const result = select([wolt({ capturedAt: iso(now - 5000) }), wolt({ gtin: null })]);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].offer.gtin, null);
  assert.equal(result.items[0].reference.identityKind, "native-retailer-sku");
  assert.equal(select([wolt({ capturedAt: iso(now - 5000) }), wolt({ gtin: null })], { gtin: "5449000017888" }).items.length, 0);
});
test("Native SKU reuse does not resurrect an older sales pack", () => {
  const old = wolt({ capturedAt: iso(now - 5000) }), fresh = wolt({ pack: "750 ml", packAmount: 750, name: "SYNTHETIC Milch 3,5% 750 ml" });
  const result = select([old, fresh]); assert.equal(result.items.length, 1); assert.equal(result.items[0].offer.packAmount, 750);
  assert.equal(select([old, fresh], { pack: "1 l" }).items.length, 0);
});
test("Equal-time unequal prices are withheld rather than selecting the cheapest or old fallback", () => {
  const result = select([wolt({ capturedAt: iso(now - 5000), price: .79 }), wolt({ price: .99 }), wolt({ price: 1.99 })]);
  assert.equal(result.items.length, 0); assert.equal(result.coverage.excludedReasons["ambiguous-native-latest-capture"], 2);
});
test("Equal-time conflicting native identities and packs are withheld", () => {
  assert.equal(select([wolt(), wolt({ gtin: null })]).items.length, 0);
  assert.equal(select([wolt(), wolt({ pack: "750 ml", packAmount: 750 })]).items.length, 0);
});
test("Duplicate proof pages with the same native quote collapse without mutating inputs", () => {
  const rows = [wolt(), wolt({ proofHash: "c".repeat(64), sourceResponseHash: "c".repeat(64) })], before = JSON.stringify(rows);
  assert.equal(select(rows).items.length, 1); assert.equal(JSON.stringify(rows), before);
});
test("Two SKUs for the same GTIN/pack at unequal latest prices are ambiguous", () => {
  const result = select([wolt(), wolt({ retailerSku: "2dc18e85145be6774701f54d", price: 1.99 })]);
  assert.equal(result.items.length, 0); assert.equal(result.coverage.excludedReasons["ambiguous-market-latest-capture"], 1);
});
test("Two GTIN-less native listings remain distinct exact article/variant references", () => {
  const result = select([wolt({ gtin: null }), wolt({ gtin: null, retailerSku: "2dc18e85145be6774701f54d", name: "SYNTHETIC Milch 1,5% 1 l" })]);
  assert.equal(result.items.length, 2); assert.notEqual(result.items[0].reference.key, result.items[1].reference.key);
  assert(result.items.every(row => row.reference.identityKind === "native-retailer-sku"));
});
test("A GTIN match does not merge unequal multipacks or variants represented by separate codes", () => {
  const result = select([wolt(), wolt({ retailerSku: "2dc18e85145be6774701f54d", pack: "6 x 1 l", packCount: 6, name: "SYNTHETIC Milch 6 x 1 l" })]);
  assert.equal(result.items.length, 2); assert.notEqual(result.items[0].reference.key, result.items[1].reference.key);
  assert.equal(select(result.items.map(row => row.offer), { pack: "6 x 1000 ml" }).items.length, 1);
});
test("Promotions stay distinct from unclassified public quotes; latest listing classification wins", () => {
  const promo = wolt({ price: 1.29, originalPrice: 1.99, priceType: "promotion", promotionStatus: "promotion" });
  const result = select([wolt({ capturedAt: iso(now - 5000) }), promo]);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].offer.priceType, "promotion");
  assert.equal(select([promo, wolt({ retailerSku: "2dc18e85145be6774701f54d" })]).items.length, 2);
  assert.equal(select([wolt({ priceType: "regular" })]).items.length, 0);
});
test("Unknown deposit stays unknown; delivery and pickup payable totals retain native semantics", () => {
  const rows = select([wolt({ deposit: null }), rewe({ deposit: null })]).items;
  for (const row of rows) { assert.equal(row.offer.deposit, null); assert.equal(row.offer.payablePackPrice, null); }
  const known = select([wolt(), rewe()]).items;
  assert.equal(known.find(row => row.offer.merchant === "EDEKA").offer.payablePackPrice, 2.04);
  assert.equal(known.find(row => row.offer.merchant === "REWE").offer.payablePackPrice, 1.74);
});
test("Original shorter expiry is preserved and can never be renewed", () => {
  const originalExpiry = iso(now + 1000), row = select([wolt({ expiresAt: originalExpiry })]).items[0];
  assert.equal(row.offer.expiresAt, originalExpiry);
  assert.equal(select([wolt({ expiresAt: iso(now + Wolt.DAY_MS + 1000) })]).items.length, 0);
  assert.equal(select([wolt({ expiresAt: iso(now) })]).items.length, 0);
});
test("Conflicting same-capture expiry or native deadline cannot select a longer validity", () => {
  const short = wolt({ expiresAt: iso(now + 1000) }), long = wolt();
  assert.equal(select([short, long]).items.length, 0);
  assert.equal(select([long, short]).items.length, 0);
  const first = rewe({ nativePromotionValidTo: iso(now + 1000), expiresAt: iso(now + 1000) });
  const second = rewe({ nativePromotionValidTo: iso(now + 2000), expiresAt: iso(now + 2000) });
  assert.equal(select([first, second]).items.length, 0);
});
test("Capture time must be actual, valid, fresh, and no later than now", () => {
  for (const patch of [{ capturedAt: iso(now + 1) }, { capturedAt: iso(now - Wolt.DAY_MS - 1) }, { capturedAt: undefined }, { capturedAt: "2026-02-30T12:00:00Z" }]) {
    const raw = wolt(); Object.assign(raw, patch); assert.equal(select([raw]).items.length, 0);
  }
  const raw = wolt({ capturedAt: iso(now - 1000), sourceDate: "2020-01-01", updatedAt: iso(now) });
  assert.equal(select([raw]).items[0].reference.observedAt, iso(now - 1000));
});
test("REWE native offer deadline bounds reference expiry", () => {
  const row = rewe({ nativePromotionValidTo: iso(now + 2000), expiresAt: iso(now + 2000) });
  assert.equal(select([row]).items[0].offer.expiresAt, iso(now + 2000));
  assert.equal(select([rewe({ nativePromotionValidTo: iso(now) })]).items.length, 0);
  assert.equal(select([rewe({ nativePromotionValidTo: iso(now + 2000) })]).items.length, 0, "Original expiry cannot exceed actual native deadline");
});
test("Forged Berlin label, city, country, market ID, or shop cannot authorize a reference", () => {
  for (const patch of [{ shop: { ...Wolt.VENUE, city: "Hamburg" } }, { scopeCountry: "AT" }, { nativeMarketId: "999" }, { nativeVenueId: "a".repeat(24) }, { shop: { ...Wolt.VENUE, address: "Other 1" } }]) assert.equal(select([wolt(patch)]).items.length, 0);
  for (const patch of [{ nativeMarketId: "999" }, { nativeStoreId: "a".repeat(36) }, { shop: { ...Rewe.MARKET, city: "Hamburg" } }]) assert.equal(select([rewe(patch)]).items.length, 0);
});
test("Big-six focus alone does not establish Berlin scope for national ALDI or unsupported merchants", () => {
  for (const sourceId of ["ALDI Nord published assortment", "dm online", "Wolt nahkauf Berlin Wrangelstraße", "HIT Berlin native store prices", "PENNY Berlin"]) assert.equal(select([wolt({ sourceId })]).items.length, 0);
  assert.equal(select([wolt({ merchant: "PENNY" })]).items.length, 0);
});
test("Native product, exact pack, proof hash, and source URL checks remain active", () => {
  for (const patch of [{ gtin: "90486640" }, { retailerSku: "invented" }, { packAmount: 500 }, { pack: "ca. 1 l" }, { variableWeight: true }, { sourceResponseHash: "b".repeat(64) }, { sourceUrl: "https://evil.example/berlin" }, { storeId: "invented-physical-store" }, { canonicalProductId: "invented" }]) assert.equal(select([wolt(patch)]).items.length, 0);
});
test("Conditional and falsely authoritative prices cannot be silently relabeled public references", () => {
  for (const patch of [{ requiresMembership: true }, { requiresCoupon: true }, { requiresApp: true }, { multiBuy: true }, { minimumQuantity: 2 }, { loyaltyPrice: .79 }, { priceAudience: "personal" }, { truthEligible: true }, { state: "current" }, { current: false }]) assert.equal(select([wolt(patch)]).items.length, 0);
});
test("Unavailability of latest native listing cannot fall back to earlier available price", () => {
  const rows = [wolt({ capturedAt: iso(now - 5000), availability: "available" }), wolt({ availability: "unavailable" })];
  assert.equal(select(rows).items.length, 0); assert.equal(select(rows).coverage.excludedReasons["native-unavailable"], 1);
});
test("Exact filters never blend merchants or sales channels", () => {
  assert.equal(select([wolt(), rewe()], { merchant: "edeka" }).items.length, 1);
  assert.equal(select([wolt(), rewe()], { scopeChannel: "pickup" }).items[0].offer.merchant, "REWE");
  assert.equal(select([wolt(), rewe()], { scopeChannel: "physical-store" }).items.length, 0);
  assert.equal(select([wolt(), rewe()], { search: "milch" }).items.length, 1);
  assert.equal(select([wolt(), rewe()], { gtin: "90486647", pack: "250 ml" }).items.length, 1);
  assert.equal(select([wolt(), rewe()], { gtin: "90486647", pack: "4 x 250 ml" }).items.length, 0);
});
test("Coverage is query-bounded and records gaps without asserting total retailer assortment", () => {
  const result = select([wolt()], { limit: 1 }); assert.equal(result.bounded, true); assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.allStoresRequired, false); assert.equal(result.coverage.queryOnly, true);
  assert.equal(result.coverage.retailers.length, 6); assert.equal(result.coverage.retailers.find(row => row.merchant === "EDEKA").referenceRows, 1);
  assert(result.coverage.missingRetailers.includes("ALDI")); assert(result.coverage.missingRetailers.includes("REWE"));
  assert.equal(select([]).items.length, 0);
});
test("Malformed search/GTIN/pack/merchant/channel/limit inputs fail before inventory calls", () => {
  for (const [opts, code] of [[{ search: "x" }, "invalid-reference-search"], [{ gtin: "90486640" }, "invalid-reference-gtin"], [{ gtin: 90486647 }, "invalid-reference-gtin"], [{ pack: "unknown" }, "invalid-product-pack"], [{ merchant: "dm" }, "invalid-merchant"], [{ scopeChannel: "delivery" }, "invalid-scope-channel"], [{ limit: 201 }, "invalid-reference-limit"], [{ limit: true }, "invalid-reference-limit"], [{ now: null }, "invalid-time"], [{ city: "Berlin" }, "invalid-reference-search"]]) assert.throws(() => Reference.select([], { now, ...opts }), new RegExp(code));
  assert.throws(() => select({}), /invalid-reference-offers/);
});
test("Result limit remains strict without claiming omitted matches do not exist", () => {
  const result = select([wolt(), rewe()], { limit: 1 }); assert.equal(result.items.length, 1); assert.equal(result.truncated, true);
  assert.equal(result.coverage.matchedReferenceRows, 2);
});
(async () => {
  let calls = 0;
  const deps = { search: async (pool, request, services) => { calls++; assert.equal(pool.marker, "synthetic"); assert.equal(request.limit, 200);
    assert.deepEqual(Object.keys(services).sort(), ["rewe", "wolt"]); assert.equal(services.wolt, Wolt); assert.equal(services.rewe, Rewe);
    assert.equal(request.gtin, "5449000017888"); assert.equal(request.pack, "1 l"); return { items: [wolt(), rewe(), wolt({ sourceId: "dm online" })] }; } };
  const result = await Reference.search({ marker: "synthetic" }, { now, gtin: "5449000017888", pack: "1 l", limit: 1 }, deps);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].offer.merchant, "EDEKA"); assert.equal(calls, 1); groups++;
  assert.equal((await Reference.search({}, { now, search: "Milch", merchant: "ALDI" }, deps)).items.length, 0);
  assert.equal((await Reference.search({}, { now, search: "Milch", scopeChannel: "physical-store" }, deps)).items.length, 0);
  assert.equal(calls, 1, "Unsupported Berlin sources never expand inventory queries"); groups++;
  await assert.rejects(() => Reference.search(null, { search: "Milch" }), /database-required/);
  await assert.rejects(() => Reference.search({}, { now }, deps), /reference-query-required/);
  await assert.rejects(() => Reference.search({}, { search: "Milch" }, {}), /reference-inventory-required/);
  await assert.rejects(() => Reference.search({}, { now, search: "Milch" }, { search: async () => ({ items: null }) }), /invalid-reference-inventory-response/); groups++;
  const many = Array.from({ length: 200 }, (_, i) => wolt({ gtin: null, retailerSku: i.toString(16).padStart(24, "0") }));
  const bounded = await Reference.search({}, { now, search: "Milch", limit: 200 }, { search: async () => ({ items: many }) });
  assert.equal(bounded.items.length, 200); assert.equal(bounded.truncated, true); assert.equal(bounded.coverage.complete, false); groups++;
  console.log("berlin-reference-prices: " + groups + " synthetic contract groups OK; latest documented quotes, closed Berlin scope, exact native identity/pack/channel, no GTIN backfill or expiry renewal, honest bounded coverage");
})().catch(error => { console.error(error); process.exitCode = 1; });
