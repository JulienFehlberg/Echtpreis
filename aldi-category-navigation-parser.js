"use strict";

// Original-bound category discovery only. These references are not articles,
// identities, availability, prices or proof of complete retailer assortment.
const crypto = require("node:crypto"), Parser = require("./aldi-assortment-category-client"), Product = require("./aldi-assortment-client");
const SOURCE = Parser.SOURCE, TEMPLATE = "aldi-nord-foundation:pages/productCategoryWithSubcategoriesPage";
const CHILDREN = "PRODUCT_MGNL_CATEGORY_CHILDREN_GET", SIBLINGS = "PRODUCT_MGNL_CATEGORY_SIBLINGS_GET", PARENT = "PRODUCT_MGNL_CATEGORY_PARENT_GET";
const MAX_CONTEXT_BYTES = 1024 * 1024, MAX_ENTRIES = 32, MAX_CHILDREN = 128;
const sensitive = /(?:api[ _-]?key|access[ _-]?token|authorization|bearer|password|secret|session[ _-]?id|cookie)/i;
const fail = code => Object.assign(new Error(code), { code });
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const iso = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function nowFor(options = {}) {
  if (!plain(options) || Object.keys(options).some(key => key !== "now")) throw fail("aldi-navigation-options-invalid");
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) throw fail("aldi-navigation-clock-invalid");
  return now;
}
function safeText(value, max = 400) {
  return typeof value === "string" && value.length <= max && value.trim() === value && value.length > 0 && !/[\u0000-\u001f<>]/.test(value) && !sensitive.test(value) ? value : null;
}
function categoryPath(value) {
  return safeText(value, 500) && /^\/sortiment\/(?:[a-z0-9-]+\/){0,5}[a-z0-9-]+$/.test(value) ? value : null;
}
function decodeOriginal(raw) {
  if (typeof raw !== "string" && !Buffer.isBuffer(raw)) throw fail("aldi-navigation-original-required");
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
  if (!bytes.length || bytes.length > Parser.MAX_BYTES) throw fail("aldi-navigation-original-byte-bound");
  let body; try { body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw fail("aldi-navigation-original-utf8-required"); }
  if (body.includes("\u0000") || typeof raw === "string" && body !== raw) throw fail("aldi-navigation-original-utf8-required");
  const attribute = (tag, key) => { const values = [...tag.matchAll(new RegExp("(?:^|\\s)" + key + "\\s*=\\s*([\"'])(.*?)\\1", "gi"))]; return values.length === 1 ? values[0][2] : null; };
  const links = [...body.matchAll(/<link\b[^>]*>/gi)].filter(match => attribute(match[0], "rel")?.toLowerCase() === "canonical");
  if (links.length !== 1) throw fail("aldi-navigation-canonical-required");
  let url; try { url = Parser.categoryUrl(attribute(links[0][0], "href")); } catch { throw fail("aldi-navigation-canonical-required"); }
  if (sensitive.test(url)) throw fail("aldi-navigation-canonical-required");
  const scripts = [...body.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)].filter(match => attribute(match[0].slice(0, match[0].indexOf(">") + 1), "id") === "__NEXT_DATA__");
  if (scripts.length !== 1 || attribute(scripts[0][0].slice(0, scripts[0][0].indexOf(">") + 1), "type") !== "application/json") throw fail("aldi-navigation-next-data-required");
  let native; try { native = JSON.parse(scripts[0][0].slice(scripts[0][0].indexOf(">") + 1).replace(/<\/script\s*>$/i, "")); } catch { throw fail("aldi-navigation-next-data-invalid"); }
  return { bytes, body, url, native };
}
function contextEntries(native) {
  const data = native?.props?.pageProps?.apiData;
  if (typeof data !== "string") throw fail("aldi-navigation-context-required");
  if (!data.length || Buffer.byteLength(data, "utf8") > MAX_CONTEXT_BYTES) throw fail("aldi-navigation-context-bound-exceeded");
  let entries; try { entries = JSON.parse(data); } catch { throw fail("aldi-navigation-context-invalid"); }
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) throw fail("aldi-navigation-context-bound-exceeded");
  if (entries.some(entry => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !plain(entry[1]))) throw fail("aldi-navigation-context-invalid");
  return entries;
}
function selectedEntry(entries, name) {
  const matches = entries.filter(entry => entry[0] === name);
  if (matches.length !== 1) throw fail(matches.length ? "aldi-navigation-context-duplicate" : "aldi-navigation-context-required");
  const value = matches[0][1];
  if (Object.keys(value).sort().join(",") !== "req,res" || !plain(value.req) || Object.keys(value.req).sort().join(",") !== "categoryPath,locale" || !categoryPath(value.req.categoryPath) || value.req.locale !== "de") throw fail("aldi-navigation-request-conflict");
  if (!Array.isArray(value.res) || value.res.length > MAX_CHILDREN) throw fail("aldi-navigation-children-bound-exceeded");
  return value;
}
function referenceFor(row, parentPath) {
  if (!plain(row) || !safeText(row.categoryKey, 120) || !/^[a-z0-9-]+$/.test(row.categoryKey) || !safeText(row.title) || typeof row.hideInCategory !== "boolean" || typeof row.marketingCategory !== "boolean" || !Array.isArray(row.children) || row.children.length > MAX_CHILDREN || !plain(row.reference)) throw fail("aldi-navigation-child-schema-invalid");
  const reference = row.reference;
  if (Object.keys(reference).sort().join(",") !== "path,type" || reference.type !== "pages" || !categoryPath(reference.path)) throw fail("aldi-navigation-child-reference-invalid");
  // Native reference mapper ZV/$P adds .html to this pages path. Requiring an
  // immediate child plus matching native categoryKey prevents a guessed slug,
  // a header alias, a sibling from another parent or a nested grandchild.
  if (reference.path !== parentPath + "/" + row.categoryKey) throw fail("aldi-navigation-child-parent-conflict");
  const sourceUrl = Parser.categoryUrl(Product.ORIGIN + reference.path + ".html");
  return { categoryId: row.categoryKey, title: row.title, sourceUrl, reference: { type: "pages", path: reference.path }, hidden: row.hideInCategory, marketingCategory: row.marketingCategory, nestedChildCount: row.children.length };
}
function childrenFor(value, parentPath) {
  const children = value.res.map(row => referenceFor(row, parentPath)), ids = new Set(), urls = new Set();
  for (const child of children) { if (ids.has(child.categoryId) || urls.has(child.sourceUrl)) throw fail("aldi-navigation-duplicate-child"); ids.add(child.categoryId); urls.add(child.sourceUrl); }
  const visible = children.filter(child => !child.hidden);
  if (!visible.length) throw fail("aldi-navigation-visible-children-required");
  return { children: visible, hiddenChildren: children.length - visible.length, nativeChildCount: children.length, nestedChildrenNotTraversed: children.some(child => child.nestedChildCount > 0) };
}
function noAuthority() {
  return { state: "unadmitted", admitted: false, discoveryOnly: true, availability: "unknown", truthEligible: false, currentPriceVerified: false, physicalStorePriceVerified: false, currentAvailabilityVerified: false, canonicalIdentityVerified: false, assortmentComplete: false, childDiscoveryComplete: false, articleRowsCreated: 0, priceRowsCreated: 0, canonicalProductsCreated: 0, gtinsAssigned: 0 };
}
function parentProof(source, meta, now) {
  if (!plain(meta) || Object.keys(meta).sort().join(",") !== "capturedAt,scopeCountry,sourceAgeSeconds,sourceResponseDate,sourceResponseHash,sourceResponseUrl" || meta.scopeCountry !== "DE" || !iso(meta.capturedAt) || Date.parse(meta.capturedAt) > now || now - Date.parse(meta.capturedAt) > Parser.FRESH_MS || meta.sourceResponseUrl !== source.url || meta.sourceResponseHash !== hash(source.bytes) || meta.sourceAgeSeconds !== null && (!Number.isSafeInteger(meta.sourceAgeSeconds) || meta.sourceAgeSeconds < 0 || meta.sourceAgeSeconds > 300)) throw fail("aldi-navigation-original-proof-required");
  let date; try { date = Product.responseFreshness(meta, Parser.FRESH_MS); } catch { throw fail("aldi-navigation-original-proof-required"); }
  return { categoryUrl: source.url, sourceResponseUrl: source.url, sourceResponseHash: meta.sourceResponseHash, sourceResponseDate: date, sourceAgeSeconds: meta.sourceAgeSeconds, capturedAt: meta.capturedAt, bodyBytes: source.bytes.length, proofKind: "original-category-html-navigation", freshCaptureVerified: true, offlineOnly: false };
}
function parseNavigationParent(raw, meta, options = {}) {
  const now = nowFor(options), source = decodeOriginal(raw), proof = parentProof(source, meta, now), native = source.native, props = native?.props?.pageProps, path = new URL(source.url).pathname.slice(0, -5), categories = path.slice("/sortiment/".length).split("/"), categoryId = categories.at(-1);
  if (!plain(native) || native.page !== "/product-overview/[...categories]" || !plain(native.query) || Object.keys(native.query).sort().join(",") !== "categories" || JSON.stringify(native.query.categories) !== JSON.stringify(categories)) throw fail("aldi-navigation-native-route-conflict");
  if (!plain(props) || props.locale !== "de" || props.country != null && props.country !== "DE" || props.hasError != null && props.hasError !== false || !plain(props.page) || props.page["@name"] !== categoryId || props.page["@path"] !== "/germany" + path || props.page.categoryKey !== categoryId || props.page["mgnl:template"] !== TEMPLATE || props.page.isMagnoliaEdit !== false || props.mgnlContext?.isMagnoliaEdit !== false || props.mgnlContext?.isMagnoliaPreview !== false) throw fail("aldi-navigation-native-parent-conflict");
  if (props.algoliaState !== null) throw fail("aldi-navigation-product-index-present");
  // Independent unchanged product parser must reach exactly the missing index
  // rejection. A malformed canonical/route/query is not a navigation parent.
  let code; try { Parser.parsePage(source.bytes, meta, { now }); } catch (error) { code = error.code; }
  if (code !== "aldi-category-native-index-conflict") throw fail("aldi-navigation-product-parser-conflict");
  const value = selectedEntry(contextEntries(native), CHILDREN);
  if (value.req.categoryPath !== path) throw fail("aldi-navigation-request-conflict");
  const found = childrenFor(value, path);
  return { sourceId: SOURCE, merchant: "ALDI Nord", purpose: "category-navigation-candidate", parentCategoryId: categoryId, nativeTemplate: TEMPLATE, categoryProof: proof, contextKind: CHILDREN, request: { ...value.req }, ...found, discoveredTargets: found.children.map(child => child.sourceUrl), scopeCountry: "DE", scopeChannel: "category-navigation", locationScope: "unknown", freshCaptureVerified: true, offlineOnly: false, ...noAuthority() };
}
function parseSiblingTargets(raw, meta = {}, options = {}) {
  const now = nowFor(options), source = decodeOriginal(raw), page = Parser.parsePage(source.bytes, meta, { now }), path = new URL(source.url).pathname.slice(0, -5), parent = path.slice(0, path.lastIndexOf("/"));
  if (!categoryPath(parent)) throw fail("aldi-navigation-sibling-parent-required");
  const value = selectedEntry(contextEntries(source.native), SIBLINGS);
  if (value.req.categoryPath !== path) throw fail("aldi-navigation-request-conflict");
  const found = childrenFor(value, parent);
  return { sourceId: SOURCE, merchant: "ALDI Nord", purpose: "category-sibling-navigation-candidate", categoryId: page.categoryId, categoryProof: structuredClone(page.categoryProof), contextKind: SIBLINGS, request: { ...value.req }, ...found, discoveredTargets: found.children.map(child => child.sourceUrl), scopeCountry: "DE", scopeChannel: "category-navigation", locationScope: "unknown", freshCaptureVerified: page.freshCaptureVerified, offlineOnly: page.offlineOnly, ...noAuthority() };
}
function summarizeContext(native) {
  const summary = { apiDataKind: native?.props?.pageProps?.apiData === undefined ? "missing" : typeof native?.props?.pageProps?.apiData, parseState: "unknown", nativeEntryCount: null, knownEntries: [], truncation: { bytes: false, entries: false, children: false, unsafeValues: false }, discoveryOnly: true, admitted: false, sourceRevalidationRequired: true, articleRowsCreated: 0, priceRowsCreated: 0 };
  let entries; try { entries = contextEntries(native); summary.parseState = "parsed"; summary.nativeEntryCount = entries.length; } catch (error) { summary.parseState = error.code; if (error.code.includes("bound")) { const data = native?.props?.pageProps?.apiData; if (typeof data === "string" && Buffer.byteLength(data, "utf8") > MAX_CONTEXT_BYTES) summary.truncation.bytes = true; else summary.truncation.entries = true; } return summary; }
  for (const name of [CHILDREN, SIBLINGS, PARENT]) {
    const matches = entries.filter(entry => entry[0] === name); if (!matches.length) continue;
    if (matches.length !== 1) { summary.knownEntries.push({ name, duplicateCount: matches.length, held: true }); continue; }
    const value = matches[0][1], req = value.req, rows = value.res;
    const safeRequest = plain(req) && Object.keys(req).sort().join(",") === "categoryPath,locale" && categoryPath(req.categoryPath) && req.locale === "de" ? { categoryPath: req.categoryPath, locale: "de" } : null;
    const item = { name, held: false, request: safeRequest, requestVerifiedShape: safeRequest !== null, responseKind: Array.isArray(rows) ? "array" : rows === null ? "null" : typeof rows, nativeChildCount: Array.isArray(rows) ? rows.length : null, children: [] };
    if (!safeRequest) summary.truncation.unsafeValues = true;
    if (Array.isArray(rows)) {
      if (rows.length > MAX_CHILDREN) summary.truncation.children = true;
      for (const row of rows.slice(0, MAX_CHILDREN)) {
        const ref = row?.reference, path = categoryPath(ref?.path), id = safeText(row?.categoryKey, 120), title = safeText(row?.title);
        if (!plain(row) || !plain(ref) || Object.keys(ref).sort().join(",") !== "path,type" || ref.type !== "pages" || !path || !id || !/^[a-z0-9-]+$/.test(id) || !title || typeof row.hideInCategory !== "boolean" || typeof row.marketingCategory !== "boolean") { summary.truncation.unsafeValues = true; continue; }
        item.children.push({ categoryId: id, title, reference: { type: "pages", path }, hideInCategory: row.hideInCategory, marketingCategory: row.marketingCategory, nestedChildCount: Array.isArray(row.children) ? row.children.length : null, childParentBindingVerified: false });
      }
    }
    summary.knownEntries.push(item);
  }
  return summary;
}
module.exports = { SOURCE, TEMPLATE, CHILDREN, SIBLINGS, PARENT, MAX_CONTEXT_BYTES, MAX_ENTRIES, MAX_CHILDREN, parseNavigationParent, parseSiblingTargets, summarizeContext };
