"use strict";
// Entirely synthetic HTTP responses. Their prices and captures are test data, never live evidence.
const crypto = require("node:crypto"), Gap = require("../../hit-native-list-gap"), Clock = require("../../current-price-query-service");
const NOW = Date.parse("2026-10-02T01:10:22.548Z"), clone = structuredClone;
const attr = value => JSON.stringify(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const node = (id = "4261891", level = 3) => ({ id, name: "SYNTHETIC native category", url: "https://www.hit.de/sortiment/synthetic-category-" + id,
  level, count: 2, order: Number(id), parentId: null, observedChildIds: [], evidence: "native-assortment-filters" });
const sku = index => String(index).padStart(18, "0") + "ST";
function row(index = 1) {
  const base = "4000000" + String(index).padStart(5, "0"), sum = [...base].reduce((total, number, i) => total + Number(number) * (i % 2 ? 3 : 1), 0);
  return { external_id: sku(index), ean: base + ((10 - sum % 10) % 10), storeId: 1775, storeNumber: "258", headline: "SYNTHETIC product " + index,
    overview: "500g Packung", price: "1.25", deposit: null, url: "https://www.hit.de/sortiment/synthetic-category-4261891/synthetic-product-" + sku(index),
    priceTag: { type: "standard", badgeText: null, priceEuro: "1", priceCent: "25", priceStrikeThroughText: null, beforeText: null, belowText: null, couponCode: null, couponName: null } };
}
function page({ category = node(), rows = [row(1), row(1)], now = NOW, edit = () => {}, patchMeta = {}, transform = body => body } = {}) {
  const data = { status: 200, data: clone(rows), pagination: { page: 0, limit: 40, total: rows.length },
    meta: { is_exact_match: true, category: { id: category.id, name: category.name, url: new URL(category.url).pathname, count: rows.length } },
    filters: { categories: [{ ...category, count: rows.length }] } };
  const params = { for_store: 1775, for_category: category.id, limit: 40, return_exact_match: "1" };
  edit(data, params);
  const body = transform('<html><head data-store="258" data-store-id="1775" data-hit-konto="" data-hit-admin=""></head><body><div data-component="assortment/list" data-data="' + attr(data) + '" data-params="' + attr(params) + '"></div></body></html>');
  const meta = { storeProfile: { ...Gap.STORE }, capturedAt: new Date(now).toISOString(), responseDate: new Date(now).toUTCString(), responseAgeSeconds: 0,
    sourceResponseHash: crypto.createHash("sha256").update(body).digest("hex"), sourceResponseUrl: category.url, requestUrl: category.url,
    responseStatus: 200, responseContentType: "text/html; charset=UTF-8", responseBytes: Buffer.byteLength(body), responseAgeRaw: "0", redirects: [], anonymous: true, retried: false, ...patchMeta };
  return { body, meta };
}
function cursor(pending = [node(), node("4261911")], now = NOW) {
  return { version: 2, cursorDay: Clock.today(new Date(now)), nativeStoreId: 1775, nativeStoreNumber: "258", total: 3,
    pagesFetched: 1, received: 1, initialIndexLoaded: true, overviewLoaded: true, pending: clone(pending),
    visited: [{ id: null, url: "https://www.hit.de/sortiment/uebersicht", level: null, total: 3, rowCount: 1, uniqueRowCount: 1, children: pending.map(node => node.id), truncated: false, unresolved: false, conflictGtins: [] }],
    seenSkus: [sku(9)], seenQuotes: {}, conflictGtins: [], categoryCoverage: { visited: 1, pending: pending.length, truncatedLeaves: [], unresolvedNodes: [], conflictingIdentities: [] } };
}
function harness(routes = {}, { now = NOW, maxRequests = 3 } = {}) {
  let clock = now; const calls = [];
  return { calls, options: { storeProfile: { ...Gap.STORE }, now: () => clock, maxRequests, delay: async ms => { clock += ms; },
    fetchImpl: async url => {
      calls.push(url); let body, spec = {};
      if (url === Gap.STORE.officialUrl) body = '<a href="' + Gap.STORE.officialUrl + '?mein-markt=1">Synthetic market choice</a>';
      else if (url === Gap.STORE.officialUrl + "?mein-markt=1") body = "<html>Synthetic guest selection</html>";
      else { const value = routes[url]; if (value && typeof value === "object") { spec = value; body = value.body; } else body = value; }
      if (body === undefined) throw Error("Unexpected synthetic URL: " + url);
      return { status: spec.status ?? 200, headers: { get: key => ({ date: new Date(clock).toUTCString(), age: "0", "content-type": "text/html; charset=UTF-8", ...spec.headers })[key] ?? null, getSetCookie: () => [] }, text: async () => body };
    } } };
}
module.exports = { NOW, clone, node, sku, row, page, cursor, harness };
