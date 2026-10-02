"use strict";
// Synthetic HTTP responses only. These fixtures are not live-price evidence.
const crypto = require("node:crypto"), Probe = require("../../hit-native-brand-probe");
const storeProfile = Object.freeze({ storeId: 1775, storeNumber: "258", name: "Berlin-Mitte", city: "Berlin", country: "DE", officialUrl: "https://www.hit.de/maerkte/berlin-mitte" });
const controlUrl = "https://www.hit.de/sortiment/kaese-eier-molkerei/milch-h-kuh-4261891";
const attr = value => JSON.stringify(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function page({ now = Date.now(), filtered = false, edit = () => {}, transform = body => body, patchMeta = {} } = {}) {
  const rows = Array.from({ length: filtered ? 2 : 3 }, (_, index) => ({ external_id: String(index + 1).padStart(18, "0") + "ST", storeId: 1775, storeNumber: "258" }));
  const data = { status: 200, data: rows, pagination: { page: 0, limit: 40, total: rows.length },
    meta: { category: { id: "4261891", name: "H- Kuh", url: "/sortiment/kaese-eier-molkerei/milch-h-kuh-4261891", count: rows.length } },
    filters: { brands: [{ id: "Synthetic A", key: "Synthetic A", label: "Synthetic A", count: 2 }] } };
  const params = { for_store: 1775, for_category: "4261891", limit: 40, return_exact_match: "1", ...(filtered ? { for_brands: "Synthetic A" } : {}) };
  edit(data, params);
  const body = transform('<html><head data-store="258" data-store-id="1775" data-hit-konto="" data-hit-admin=""></head><body><div data-component="assortment/list" data-data="' + attr(data) + '" data-params="' + attr(params) + '"></div></body></html>');
  const url = new URL(controlUrl); if (filtered) { url.searchParams.set("for_store", "1775"); url.searchParams.set("for_category", "4261891"); url.searchParams.set("for_brands", "Synthetic A"); }
  const meta = { storeProfile: { ...storeProfile }, capturedAt: new Date(now).toISOString(), responseDate: new Date(now).toUTCString(), responseAgeSeconds: 0,
    sourceResponseHash: crypto.createHash("sha256").update(body).digest("hex"), sourceResponseUrl: url.href, requestUrl: url.href,
    responseStatus: 200, responseContentType: "text/html; charset=UTF-8", responseBytes: Buffer.byteLength(body), responseAgeRaw: "0", redirects: [], anonymous: true, retried: false, ...patchMeta };
  return { body, meta };
}
function record({ now = Date.now(), outcome = "confirmed", control = {}, filtered = {}, status = 403 } = {}) {
  const first = page({ now, ...control }), token = Probe.prepareControl(first.body, first.meta, { now });
  if (outcome === "source-refused") return Probe.record(token, { filtered: null, error: { code: "hit-source-http-" + status, retryAfterMs: 7200000, responseStatus: status } }, { now });
  if (outcome === "failed") return Probe.record(token, { filtered: null, error: { code: "TimeoutError", retryAfterMs: 3600000, responseStatus: null } }, { now });
  const second = page({ now: now + 1000, filtered: true, ...filtered });
  return Probe.record(token, { filtered: second, error: null }, { now: now + 1000 });
}
module.exports = { storeProfile, controlUrl, attr, page, record };
