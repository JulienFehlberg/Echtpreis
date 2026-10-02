"use strict";
const crypto = require("node:crypto");
const Schema = require("./retailer-schema-lifecycle");

const SOURCE = "EDEKA Berlin counter preorder", TABLE = "edeka_counter_quote_captures", DAY_MS = 86400000;
const BASE = "https://bedientheke.minden.edeka.de";
const PAGE_URL = BASE + "/vorbestellen?store=10006944", STORES_URL = BASE + "/api/stores";
const PRODUCTS_URL = BASE + "/api/products?storeId=800411";
const MODULES = Object.freeze([
  Object.freeze({ key: "shared", url: BASE + "/_next/static/chunks/7688-4d7a6b4f8247fe7f.js", hash: "69ff4f21267ddb4184993569dd2445c56ffaf094aae69ed35949c83cf7eeca60" }),
  Object.freeze({ key: "page", url: BASE + "/_next/static/chunks/app/vorbestellen/page-e6838fd8f5ec7824.js", hash: "4258fc2976835e485317150435e098b49191689142abf94cea1f1b7a26b95f73" })
]);
const SHOP = Object.freeze({ nativeStoreId: "800411", nativeTenantId: "10004748", name: "EDEKA center Untergehrer", address: "Schnellerstr. 131, 12439 Berlin", city: "Berlin", postalCode: "12439", country: "DE" });
const fail = code => Object.assign(new Error(code), { code });
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const id = value => typeof value === "string" && /^[1-9]\d{0,15}$/.test(value);
function clock(options = {}) {
  const now = options.now === undefined ? Date.now() : options.now;
  if (typeof now !== "number" || !Number.isFinite(now)) throw fail("edeka-counter-invalid-time");
  return now;
}
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}
function record(raw, url, now, type, immutable = false) {
  if (!object(raw) || raw.status !== 200 || raw.sourceResponseUrl !== url || typeof raw.body !== "string" || Buffer.byteLength(raw.body) > 1500000 || hash(raw.body) !== raw.sourceResponseHash) throw fail("edeka-counter-original-capture-required");
  const captured = timestamp(raw.capturedAt), date = Date.parse(raw.headers?.date), age = raw.headers?.age == null ? null : Number(raw.headers.age);
  if (!Number.isFinite(captured) || captured > now || !Number.isFinite(date) || !String(raw.headers?.["content-type"] || "").toLowerCase().includes(type) || age !== null && (typeof raw.headers.age !== "string" || !/^\d+$/.test(raw.headers.age) || !Number.isSafeInteger(age) || age < 0) || !immutable && (Math.abs(date - captured) > 300000 || age > 300)) throw fail("edeka-counter-http-freshness-required");
  return raw;
}
function binding(raw, now) {
  const guest = record(raw?.guest, PAGE_URL, now, "text/html");
  for (const module of MODULES) {
    const script = record(raw[module.key], module.url, now, "javascript", true);
    const scriptPath = new URL(module.url).pathname;
    if (!new RegExp('<script\\b[^>]*\\bsrc="' + scriptPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"[^>]*>').test(guest.body) || script.sourceResponseHash !== module.hash) throw fail("edeka-counter-unreviewed-source-contract");
  }
  return guest;
}
function nativeShop(stores) {
  if (!Array.isArray(stores) || stores.length > 1000) throw fail("edeka-counter-native-stores-invalid");
  const matches = stores.filter(shop => shop?.id === SHOP.nativeStoreId || shop?.tenantId === SHOP.nativeTenantId);
  if (matches.length !== 1) throw fail("edeka-counter-exact-Berlin-shop-required");
  const shop = matches[0];
  if (shop.id !== SHOP.nativeStoreId || shop.tenantId !== SHOP.nativeTenantId || shop.name !== SHOP.name || shop.address !== SHOP.address || shop.settings?.currency !== "EUR" || shop.settings?.locale !== "de" || shop.latitude !== 52.458088 || shop.longitude !== 13.510366 || !Number.isSafeInteger(shop.orderSettings?.minOffsetDays) || shop.orderSettings.minOffsetDays < 3 || !Number.isSafeInteger(shop.orderSettings.maxOffsetDays) || shop.orderSettings.maxOffsetDays < shop.orderSettings.minOffsetDays || shop.orderSettings.maxOffsetDays > 366) throw fail("edeka-counter-exact-Berlin-shop-required");
  return shop;
}
function cents(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 10000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) return null;
  return Math.round(value * 100);
}
const normalized = text => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function parseCapture(raw, options = {}) {
  const now = clock(options);
  if (!object(raw)) throw fail("edeka-counter-capture-required");
  binding(raw, now);
  const stores = record(raw.stores, STORES_URL, now, "application/json"), products = record(raw.products, PRODUCTS_URL, now, "application/json");
  let storeRows, rows;
  try { storeRows = JSON.parse(stores.body); rows = JSON.parse(products.body); } catch { throw fail("edeka-counter-invalid-json"); }
  const shop = nativeShop(storeRows);
  if (!Array.isArray(rows) || rows.length > 2000) throw fail("edeka-counter-native-products-invalid");
  const captures = [raw.guest, raw.shared, raw.page, stores, products];
  const observed = Math.min(timestamp(stores.capturedAt), timestamp(products.capturedAt)), captured = timestamp(products.capturedAt);
  if (captures.some(item => timestamp(item.capturedAt) > captured || captured - timestamp(item.capturedAt) > 900000)) throw fail("edeka-counter-capture-binding-window-required");
  const expiresAt = new Date(observed + DAY_MS).toISOString();
  const proofHash = hash(JSON.stringify(["edeka-counter-original-capture-v1", ...captures.map(item => [item.sourceResponseUrl, item.sourceResponseHash, item.capturedAt, item.headers.date, item.headers.age ?? null])]));
  const ids = new Map();
  for (const row of rows) if (id(row?.id)) ids.set(row.id, (ids.get(row.id) || 0) + 1);
  const quotes = [], quarantined = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], reasons = [], priceCents = cents(row?.price);
    if (!object(row) || !id(row.id)) reasons.push("native-article-id-required");
    if (row?.storeId !== shop.id || row?.tenantId !== shop.tenantId) reasons.push("exact-native-store-tenant-required");
    if (id(row?.id) && ids.get(row.id) > 1) reasons.push("duplicate-native-article");
    if (typeof row?.name !== "string" || !row.name.trim() || row.name.length > 250 || /[<>\u0000-\u001f]/.test(row.name)) reasons.push("native-name-required");
    if (priceCents === null) reasons.push("positive-cent-price-required");
    // Native g is a price basis of 100 g. A gram-order quote has no sales pack.
    if (row?.price_unit !== "g" || row?.quantity_label !== "gramm" || row?.unit_range_options !== "") reasons.push("simple-gram-order-required");
    if (row?.dropdown !== false || row?.checkbox !== false || !Array.isArray(row?.dropdown_optionen) || row.dropdown_optionen.length !== 0 || row?.dropdown_label !== null || row?.checkbox_label !== null) reasons.push("explicit-variant-selection-required");
    if (![row?.min_quantity, row?.max_quantity].every(value => typeof value === "number" && Number.isFinite(value) && value === 0)) reasons.push("unreviewed-quantity-limits");
    if (["gtin", "ean", "validFrom", "validTo", "validity", "priceType", "actionPrice", "normalPrice", "deposit", "minimumQuantity"].some(key => row?.[key] != null) || ["conditional", "requiresMembership", "requiresCoupon", "requiresApp", "loyaltyPrice", "priceFrom"].some(key => row?.[key] != null && row[key] !== false)) reasons.push("unreviewed-price-metadata");
    if (reasons.length) { quarantined.push({ nativeProductId: id(row?.id) ? row.id : null, rawRowIndex: index, reasons }); continue; }
    quotes.push({ kind: "counter-preorder-unit-price", identityKind: "source-local-counter-article", sourceId: SOURCE, merchant: "EDEKA", nativeProductId: row.id, name: row.name, nativePriceUnit: "g", price: priceCents / 100, priceCents, currency: "EUR", basisAmount: 100, basisUnit: "g", gtin: null, pack: null, salesPackVerified: false, priceType: "unknown", scopeCountry: "DE", scopeCity: "Berlin", scopeChannel: "pickup", serviceType: "counter-preorder", shop: { ...SHOP }, minimumOrderOffsetDays: shop.orderSettings.minOffsetDays, maximumOrderOffsetDays: shop.orderSettings.maxOffsetDays, availability: "unknown", nativeValidity: null, deposit: null, capturedAt: products.capturedAt, expiresAt, expiryBasis: "application-ttl", current: now < observed + DAY_MS, physicalStorePriceVerified: false, normalPriceClassificationVerified: false, truthEligible: false, canonicalSelectionEligible: false, sourceUrl: BASE + "/vorbestellen?store=" + shop.tenantId, sourceResponseUrl: PRODUCTS_URL, sourceResponseHash: products.sourceResponseHash, storeResponseHash: stores.sourceResponseHash, proofHash });
  }
  return { sourceId: SOURCE, proofHash, capturedAt: products.capturedAt, expiresAt, current: now < observed + DAY_MS, received: rows.length, accepted: quotes.length, rejected: quarantined.length, quotes, quarantined, fullAssortment: false, rawCapture: raw };
}
async function ensure(pool) {
  if (!pool) throw fail("database-required");
  return Schema.ensure(pool, TABLE, () => pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(source_id text NOT NULL CHECK(source_id='${SOURCE}'),proof_hash text PRIMARY KEY CHECK(proof_hash~'^[a-f0-9]{64}$'),captured_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,raw_capture jsonb NOT NULL,received int NOT NULL CHECK(received>=0),accepted int NOT NULL CHECK(accepted>=0),quarantined jsonb NOT NULL,CHECK(expires_at>captured_at AND expires_at<=captured_at+interval '24 hours'));CREATE INDEX IF NOT EXISTS edeka_counter_latest_idx ON ${TABLE}(source_id,captured_at DESC);`));
}
async function persist(pool, raw, options = {}) {
  const parsed = parseCapture(raw, options);
  if (!parsed.current) throw fail("edeka-counter-capture-expired");
  await ensure(pool);
  const result = await pool.query(`INSERT INTO ${TABLE}(source_id,proof_hash,captured_at,expires_at,raw_capture,received,accepted,quarantined) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb) ON CONFLICT(proof_hash) DO NOTHING`, [SOURCE, parsed.proofHash, parsed.capturedAt, parsed.expiresAt, JSON.stringify(raw), parsed.received, parsed.accepted, JSON.stringify(parsed.quarantined)]);
  return { received: parsed.received, accepted: parsed.accepted, rejected: parsed.rejected, proofHash: parsed.proofHash, upserted: result.rowCount, unchanged: result.rowCount ? 0 : 1, fullAssortment: false };
}
async function latest(pool, options = {}) {
  await ensure(pool);
  const result = await pool.query(`SELECT proof_hash AS "proofHash",captured_at AS "capturedAt",raw_capture AS "rawCapture" FROM ${TABLE} WHERE source_id=$1 ORDER BY captured_at DESC,proof_hash LIMIT 2`, [SOURCE]);
  if (!result.rows.length) return null;
  if (result.rows.length > 1 && new Date(result.rows[0].capturedAt).getTime() === new Date(result.rows[1].capturedAt).getTime()) return { ambiguous: true };
  const first = result.rows[0], parsed = parseCapture(first.rawCapture, options);
  if (parsed.proofHash !== first.proofHash || parsed.capturedAt !== new Date(first.capturedAt).toISOString()) throw fail("edeka-counter-stored-proof-conflict");
  return parsed;
}
function query(input = {}) {
  if (!object(input) || Object.keys(input).some(key => !["search", "nativeProductId", "grams", "limit"].includes(key))) throw fail("invalid-edeka-counter-query");
  if (input.search !== undefined && (typeof input.search !== "string" || input.search.trim().length < 2 || input.search.length > 120 || /[<>\u0000-\u001f]/.test(input.search))) throw fail("invalid-edeka-counter-query");
  if (input.nativeProductId !== undefined && !id(input.nativeProductId)) throw fail("invalid-edeka-counter-query");
  if (input.search === undefined && input.nativeProductId === undefined) throw fail("invalid-edeka-counter-query");
  if (input.grams !== undefined && (!Number.isSafeInteger(input.grams) || input.grams < 1 || input.grams > 100000)) throw fail("invalid-edeka-counter-query");
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 200)) throw fail("invalid-edeka-counter-query");
  return { ...input, limit: input.limit ?? 50 };
}
async function search(pool, input, options = {}) {
  const request = query(input), saved = await latest(pool, options);
  const matched = saved?.current ? saved.quotes.filter(quote => (!request.search || normalized(quote.name).includes(normalized(request.search))) && (!request.nativeProductId || quote.nativeProductId === request.nativeProductId)) : [];
  const quotes = matched.slice(0, request.limit).map(quote => ({ ...quote, requestedGrams: request.grams ?? null, merchandiseEstimate: request.grams === undefined ? null : Math.round(quote.priceCents * request.grams / 100) / 100, checkoutPriceVerified: false }));
  return { ok: true, sourceId: SOURCE, city: "Berlin", country: "DE", scopeChannel: "pickup", serviceType: "counter-preorder", quotes, matched: matched.length, truncated: matched.length > request.limit, ambiguousLatestCapture: !!saved?.ambiguous, fullAssortment: false, physicalStorePrices: false, canonicalSelectionEligible: false };
}
async function status(pool, options = {}) {
  const saved = await latest(pool, options);
  return { ok: true, sourceId: SOURCE, merchant: "EDEKA", city: "Berlin", country: "DE", scopeChannel: "pickup", serviceType: "counter-preorder", storedLatestArticles: saved?.received ?? 0, currentUnitPriceQuotes: saved?.current ? saved.accepted : 0, quarantinedArticles: saved?.rejected ?? 0, lastCapturedAt: saved?.capturedAt ?? null, expiresAt: saved?.expiresAt ?? null, ambiguousLatestCapture: !!saved?.ambiguous, sourceMarket: { ...SHOP }, fullAssortment: false, physicalStorePriceVerified: false, normalPriceClassificationVerified: false, truthEligible: false, canonicalSelectionEligible: false, independentOfUserReceipts: true };
}
module.exports = Object.freeze({ SOURCE, TABLE, DAY_MS, PAGE_URL, STORES_URL, PRODUCTS_URL, MODULES, SHOP, hash, binding, parseCapture, ensure, persist, latest, query, search, status });
