"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const Navigation = require("../aldi-category-navigation-parser"), Parser = require("../aldi-assortment-category-client"), Fixture = require("./fixtures/aldi-category-capture");
const now = Date.parse("2026-10-03T07:25:00.123Z"), captured = now - 1000, parentPath = "/sortiment/milchprodukte", parentUrl = "https://www.aldi-nord.de" + parentPath + ".html";
const siblingIds = ["joghurt-quark-milchdesserts", "scheibenkaese-geriebener-kaese", "frischkaese-weichkaese", "hartkaese-kaese-am-stueck", "butter-sahne-sauerrahm"];
const row = id => ({ categoryKey: id, title: "SYNTHETIC TEST " + id, reference: { type: "pages", path: parentPath + "/" + id }, hideInCategory: false, marketingCategory: false, children: [] });
const nativeFrom = body => JSON.parse(body.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);
function parentNative() {
  return { syntheticFixture: "New synthetic original based on independently retained parent shape; not the actual body", page: "/product-overview/[...categories]", query: { categories: ["milchprodukte"] }, props: { pageProps: { locale: "de", page: { "@name": "milchprodukte", "@path": "/germany" + parentPath, categoryKey: "milchprodukte", "mgnl:template": Navigation.TEMPLATE, isMagnoliaEdit: false, componentList: ["banner"], openContent: { "@name": "openContent", "@path": "/germany" + parentPath + "/openContent", "@nodeType": "mgnl:area", "@nodes": [] } }, mgnlContext: { isMagnoliaEdit: false, isMagnoliaPreview: false }, algoliaState: null, apiData: JSON.stringify([[Navigation.CHILDREN, { req: { categoryPath: parentPath, locale: "de" }, res: siblingIds.map(row) }]]) } } };
}
function bodyFor(native, url = parentUrl) { return '<html><head><link rel="canonical" href="' + url + '"></head><body><script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(native).replace(/</g, "\\u003c") + '</script></body></html>'; }
function original(body, url = parentUrl, time = captured) { return { body, meta: { sourceResponseUrl: url, sourceResponseHash: crypto.createHash("sha256").update(body).digest("hex"), sourceResponseDate: new Date(time).toISOString(), sourceAgeSeconds: null, capturedAt: new Date(time).toISOString(), scopeCountry: "DE" } }; }
function parent(change = () => {}) { const native = parentNative(); change(native); return original(bodyFor(native)); }
const parse = value => Navigation.parseNavigationParent(value.body, value.meta, { now });
const changeContext = (native, change) => { const entries = JSON.parse(native.props.pageProps.apiData); change(entries); native.props.pageProps.apiData = JSON.stringify(entries); };
function leaf() {
  const native = nativeFrom(Fixture.html()); native.syntheticFixture = "New synthetic leaf context; never an archived native capture";
  native.props.pageProps.apiData = JSON.stringify([[Navigation.SIBLINGS, { req: { categoryPath: parentPath + "/" + Fixture.categoryId, locale: "de" }, res: siblingIds.map(row) }]]);
  return original(bodyFor(native, Fixture.url), Fixture.url);
}
let groups = 0, archiveChecked = false;
function test(name, fn) { try { fn(); groups++; } catch (error) { console.error("Failed: " + name); throw error; } }
function rejects(value, code) { assert.throws(() => parse(value), error => error.code === code); }
test("fresh original parent proves only five explicit native navigation targets", () => {
  const value = parent(), before = JSON.stringify(value), result = parse(value);
  assert.equal(result.purpose, "category-navigation-candidate"); assert.equal(result.parentCategoryId, "milchprodukte"); assert.equal(result.nativeTemplate, Navigation.TEMPLATE);
  assert.equal(result.children.length, 5); assert.deepEqual(result.discoveredTargets, siblingIds.map(id => "https://www.aldi-nord.de" + parentPath + "/" + id + ".html"));
  assert.equal(result.categoryProof.sourceResponseHash, value.meta.sourceResponseHash); assert.equal(result.categoryProof.capturedAt, value.meta.capturedAt); assert.equal(result.categoryProof.sourceResponseDate, value.meta.sourceResponseDate); assert.equal(result.categoryProof.sourceAgeSeconds, null);
  assert.equal(result.freshCaptureVerified, true); assert.equal(result.offlineOnly, false); assert.equal(JSON.stringify(value), before);
  for (const key of ["admitted", "truthEligible", "currentPriceVerified", "physicalStorePriceVerified", "currentAvailabilityVerified", "canonicalIdentityVerified", "assortmentComplete", "childDiscoveryComplete"]) assert.equal(result[key], false);
  for (const key of ["articleRowsCreated", "priceRowsCreated", "canonicalProductsCreated", "gtinsAssigned"]) assert.equal(result[key], 0);
  for (const key of ["body", "original", "products", "offers", "gtin", "price", "storeId", "hits"]) assert(!Object.hasOwn(result, key));
});
test("positive visible references required; hidden counts do not become targets", () => {
  const result = parse(parent(n => changeContext(n, entries => { entries[0][1].res[0].hideInCategory = true; entries[0][1].res[1].children = [{ ignoredNestedIdentity: true }]; })));
  assert.equal(result.children.length, 4); assert.equal(result.hiddenChildren, 1); assert.equal(result.nativeChildCount, 5); assert.equal(result.nestedChildrenNotTraversed, true); assert(!result.discoveredTargets.some(url => url.includes(siblingIds[0])));
  rejects(parent(n => changeContext(n, entries => entries[0][1].res.forEach(r => r.hideInCategory = true))), "aldi-navigation-visible-children-required");
  rejects(parent(n => changeContext(n, entries => entries[0][1].res = [])), "aldi-navigation-visible-children-required");
});
for (const [name, edit, code] of [
  ["wrong route", n => n.page = "/other", "aldi-navigation-native-route-conflict"],
  ["extra query", n => n.query.token = "DO_NOT_DISCLOSE", "aldi-navigation-native-route-conflict"],
  ["wrong category", n => n.query.categories = ["other"], "aldi-navigation-native-route-conflict"],
  ["wrong locale", n => n.props.pageProps.locale = "en", "aldi-navigation-native-parent-conflict"],
  ["wrong country", n => n.props.pageProps.country = "AT", "aldi-navigation-native-parent-conflict"],
  ["has error", n => n.props.pageProps.hasError = true, "aldi-navigation-native-parent-conflict"],
  ["string error", n => n.props.pageProps.hasError = "false", "aldi-navigation-native-parent-conflict"],
  ["wrong name", n => n.props.pageProps.page["@name"] = "other", "aldi-navigation-native-parent-conflict"],
  ["wrong path", n => n.props.pageProps.page["@path"] += "/child", "aldi-navigation-native-parent-conflict"],
  ["wrong native key", n => n.props.pageProps.page.categoryKey = "other", "aldi-navigation-native-parent-conflict"],
  ["product template", n => n.props.pageProps.page["mgnl:template"] = "aldi-nord-foundation:pages/productCategoryPage", "aldi-navigation-native-parent-conflict"],
  ["edit", n => n.props.pageProps.page.isMagnoliaEdit = true, "aldi-navigation-native-parent-conflict"],
  ["preview", n => n.props.pageProps.mgnlContext.isMagnoliaPreview = true, "aldi-navigation-native-parent-conflict"],
  ["missing null index", n => delete n.props.pageProps.algoliaState, "aldi-navigation-product-index-present"],
  ["malformed index", n => n.props.pageProps.algoliaState = {}, "aldi-navigation-product-index-present"],
  ["product index", n => n.props.pageProps.algoliaState = nativeFrom(Fixture.html()).props.pageProps.algoliaState, "aldi-navigation-product-index-present"]
]) test("parent rejects " + name, () => rejects(parent(edit), code));
for (const [name, change] of [
  ["hash", value => value.meta.sourceResponseHash = "0".repeat(64)],
  ["country", value => value.meta.scopeCountry = "AT"],
  ["URL", value => value.meta.sourceResponseUrl = Fixture.url],
  ["future", value => value.meta.capturedAt = new Date(now + 1).toISOString()],
  ["stale", value => value.meta.capturedAt = new Date(now - 300001).toISOString()],
  ["noncanonical capture", value => value.meta.capturedAt = value.meta.capturedAt.replace(".123Z", "Z")],
  ["no Date", value => delete value.meta.sourceResponseDate],
  ["old Date", value => value.meta.sourceResponseDate = new Date(captured - 300001).toISOString()],
  ["future Date", value => value.meta.sourceResponseDate = new Date(captured + 300001).toISOString()],
  ["missing Age", value => delete value.meta.sourceAgeSeconds],
  ["old Age", value => value.meta.sourceAgeSeconds = 301],
  ["string Age", value => value.meta.sourceAgeSeconds = "0"],
  ["unknown meta", value => value.meta.rawToken = "PRIVATE_TOKEN"]
]) test("original proof rejects " + name, () => { const value = parent(); change(value); rejects(value, "aldi-navigation-original-proof-required"); });
for (const [name, edit, code] of [
  ["missing context", n => delete n.props.pageProps.apiData, "aldi-navigation-context-required"],
  ["object context", n => n.props.pageProps.apiData = {}, "aldi-navigation-context-required"],
  ["invalid JSON", n => n.props.pageProps.apiData = "[", "aldi-navigation-context-invalid"],
  ["context bound", n => n.props.pageProps.apiData = "x".repeat(Navigation.MAX_CONTEXT_BYTES + 1), "aldi-navigation-context-bound-exceeded"],
  ["missing child key", n => n.props.pageProps.apiData = "[]", "aldi-navigation-context-required"],
  ["duplicate key", n => changeContext(n, e => e.push(structuredClone(e[0]))), "aldi-navigation-context-duplicate"],
  ["wrong req path", n => changeContext(n, e => e[0][1].req.categoryPath += "/other"), "aldi-navigation-request-conflict"],
  ["wrong req locale", n => changeContext(n, e => e[0][1].req.locale = "en"), "aldi-navigation-request-conflict"],
  ["extra req", n => changeContext(n, e => e[0][1].req.headers = { authorization: "PRIVATE" }), "aldi-navigation-request-conflict"],
  ["error response", n => changeContext(n, e => e[0][1].res = { success: false }), "aldi-navigation-children-bound-exceeded"],
  ["too many children", n => changeContext(n, e => e[0][1].res = Array.from({ length: 129 }, (_, i) => row("test-" + i))), "aldi-navigation-children-bound-exceeded"],
  ["foreign reference", n => changeContext(n, e => e[0][1].res[0].reference.path = "https://other.example/child"), "aldi-navigation-child-reference-invalid"],
  ["query reference", n => changeContext(n, e => e[0][1].res[0].reference.path += "?token=PRIVATE"), "aldi-navigation-child-reference-invalid"],
  ["product reference", n => changeContext(n, e => e[0][1].res[0].reference.path = "/produkt/test-1"), "aldi-navigation-child-reference-invalid"],
  ["wrong type", n => changeContext(n, e => e[0][1].res[0].reference.type = "products"), "aldi-navigation-child-reference-invalid"],
  ["reference override", n => changeContext(n, e => e[0][1].res[0].reference.publicUrl = "https://other.example/child"), "aldi-navigation-child-reference-invalid"],
  ["other parent", n => changeContext(n, e => e[0][1].res[0].reference.path = "/sortiment/other/" + siblingIds[0]), "aldi-navigation-child-parent-conflict"],
  ["grandchild", n => changeContext(n, e => e[0][1].res[0].reference.path = parentPath + "/other/" + siblingIds[0]), "aldi-navigation-child-parent-conflict"],
  ["key mismatch", n => changeContext(n, e => e[0][1].res[0].categoryKey = "other"), "aldi-navigation-child-parent-conflict"],
  ["duplicate child", n => changeContext(n, e => e[0][1].res.push(structuredClone(e[0][1].res[0]))), "aldi-navigation-duplicate-child"],
  ["unknown hidden", n => changeContext(n, e => delete e[0][1].res[0].hideInCategory), "aldi-navigation-child-schema-invalid"],
  ["HTML title", n => changeContext(n, e => e[0][1].res[0].title = "<script>PRIVATE</script>"), "aldi-navigation-child-schema-invalid"],
  ["credential path", n => changeContext(n, e => e[0][1].res[0].reference.path = parentPath + "/access-token-private"), "aldi-navigation-child-reference-invalid"]
]) test("native context rejects " + name, () => rejects(parent(edit), code));
test("header-only references never fill missing children response", () => {
  rejects(parent(n => { n.props.pageProps.apiData = "[]"; n.props.pageProps.page.header = [{ child: { path: "https://www.aldi-nord.de" + parentPath + "/" + siblingIds[0] + ".html" } }]; }), "aldi-navigation-context-required");
});
test("body canonical next-data UTF8 and byte bounds are independently enforced", () => {
  assert.throws(() => Navigation.parseNavigationParent(Buffer.from([0xff]), {}, { now }), { code: "aldi-navigation-original-utf8-required" });
  assert.throws(() => Navigation.parseNavigationParent(Buffer.alloc(Parser.MAX_BYTES + 1), {}, { now }), { code: "aldi-navigation-original-byte-bound" });
  rejects(original(bodyFor(parentNative()).replace(parentUrl, "https://other.example/child")), "aldi-navigation-canonical-required");
  rejects(original(bodyFor(parentNative()).replace("</head>", '<link rel="canonical" href="' + parentUrl + '"></head>')), "aldi-navigation-canonical-required");
  rejects(original(bodyFor(parentNative()).replace("</body>", '<script id="__NEXT_DATA__" type="application/json">{}</script></body>')), "aldi-navigation-next-data-required");
  rejects(original(bodyFor(parentNative()).replace('type="application/json"', 'type="text/plain"')), "aldi-navigation-next-data-required");
});
test("fresh siblings require a genuine unchanged product page and same-leaf request", () => {
  const value = leaf(), before = JSON.stringify(value), result = Navigation.parseSiblingTargets(value.body, value.meta, { now });
  assert.equal(result.children.length, 5); assert.equal(result.freshCaptureVerified, true); assert.equal(result.offlineOnly, false); assert.equal(result.categoryProof.capturedAt, value.meta.capturedAt); assert.equal(JSON.stringify(value), before);
  assert.equal(result.articleRowsCreated, 0); assert.equal(result.priceRowsCreated, 0); assert.equal(result.assortmentComplete, false);
  const native = nativeFrom(value.body); changeContext(native, e => e[0][1].req.categoryPath = parentPath); const bad = original(bodyFor(native, Fixture.url), Fixture.url);
  assert.throws(() => Navigation.parseSiblingTargets(bad.body, bad.meta, { now }), { code: "aldi-navigation-request-conflict" });
  assert.throws(() => Navigation.parseSiblingTargets(value.body.replace(Fixture.index, "an_wrong_index"), {}, { now }), error => /^aldi-category-/.test(error.code));
});
test("closed summary exposes only bound safe request and reference shapes", () => {
  const native = parentNative(), before = JSON.stringify(native), result = Navigation.summarizeContext(native), wire = JSON.stringify(result);
  assert.equal(result.parseState, "parsed"); assert.equal(result.nativeEntryCount, 1); assert.equal(result.knownEntries[0].nativeChildCount, 5); assert.equal(result.knownEntries[0].children.length, 5); assert.equal(result.knownEntries[0].children[0].childParentBindingVerified, false);
  assert.equal(JSON.stringify(native), before); assert.equal(result.admitted, false); assert.equal(result.sourceRevalidationRequired, true);
  for (const key of ["rawNativeProduct", "body", "apiKey", "token", "headers", "price", "gtin"]) assert(!wire.includes('"' + key + '":'));
});
test("duplicate context is held before any old result can appear", () => {
  const native = parentNative(); changeContext(native, e => e.push(structuredClone(e[0]))); const result = Navigation.summarizeContext(native);
  assert.equal(result.knownEntries[0].held, true); assert.equal(result.knownEntries[0].duplicateCount, 2); assert(!Object.hasOwn(result.knownEntries[0], "children"));
});
test("unsafe context values credentials and unknown fields never leak", () => {
  const native = parentNative(); changeContext(native, e => { e.push(["access_token_PRIVATE", { req: {}, res: { rawSecret: "PRIVATE_CONTEXT_SECRET" } }]); e[0][1].req.categoryPath = "/sortiment/access-token-private-context-secret"; e[0][1].res[0].reference.path = "/sortiment/access-token-private-context-secret"; e[0][1].res[1].title = "Bearer PRIVATE_CONTEXT_SECRET"; e[0][1].res[2].rawHeaders = { authorization: "PRIVATE_CONTEXT_SECRET" }; });
  const result = Navigation.summarizeContext(native), wire = JSON.stringify(result); assert(!wire.includes("PRIVATE_CONTEXT_SECRET")); assert(!wire.includes("private-context-secret")); assert(!wire.includes("rawHeaders")); assert.equal(result.truncation.unsafeValues, true); assert.equal(result.knownEntries.length, 1);
});
test("summary child and byte bounds cannot expand originals into public bodies", () => {
  const native = parentNative(); changeContext(native, e => e[0][1].res = Array.from({ length: 500 }, (_, i) => row("test-" + i)));
  const result = Navigation.summarizeContext(native); assert.equal(result.knownEntries[0].children.length, 128); assert.equal(result.knownEntries[0].nativeChildCount, 500); assert.equal(result.truncation.children, true);
  native.props.pageProps.apiData = "x".repeat(Navigation.MAX_CONTEXT_BYTES + 1); const bad = Navigation.summarizeContext(native); assert.equal(bad.knownEntries.length, 0); assert.equal(bad.truncation.bytes, true);
  native.props.pageProps.apiData = "["; assert.equal(Navigation.summarizeContext(native).parseState, "aldi-navigation-context-invalid");
  native.props.pageProps.apiData = JSON.stringify(Array.from({ length: 33 }, (_, i) => ["UNKNOWN_" + i, {}])); const entries = Navigation.summarizeContext(native); assert.equal(entries.truncation.entries, true); assert.equal(entries.truncation.bytes, false); assert.equal(entries.knownEntries.length, 0);
});
test("RFC transport Date and the exact freshness/Age boundary preserve original values", () => {
  const value = parent(); value.meta.sourceResponseDate = new Date(captured).toUTCString(); value.meta.sourceAgeSeconds = 300;
  const result = parse(value); assert.equal(result.categoryProof.sourceResponseDate, new Date(Math.floor(captured / 1000) * 1000).toISOString()); assert.equal(result.categoryProof.sourceAgeSeconds, 300); assert.equal(result.categoryProof.capturedAt, value.meta.capturedAt);
  const atBoundary = original(bodyFor(parentNative()), parentUrl, now - Parser.FRESH_MS); assert.equal(parse(atBoundary).freshCaptureVerified, true);
});
test("summary parent object responses and unknown API names never acquire child authority", () => {
  const native = parentNative(); changeContext(native, entries => { entries[0][0] = Navigation.PARENT; entries[0][1].res = { success: true, data: { rawPrice: 1, token: "NEVER_PUBLIC" } }; entries.push(["UNKNOWN_PRIVATE", { req: {}, res: { rawOriginal: "NEVER_PUBLIC" } }]); });
  const result = Navigation.summarizeContext(native), wire = JSON.stringify(result); assert.equal(result.knownEntries.length, 1); assert.equal(result.knownEntries[0].responseKind, "object"); assert.deepEqual(result.knownEntries[0].children, []); assert(!wire.includes("NEVER_PUBLIC")); assert(!wire.includes("UNKNOWN_PRIVATE")); assert.equal(result.admitted, false);
});
test("original leaf without Date Age remains offline discovery only", () => {
  const value = leaf(), result = Navigation.parseSiblingTargets(value.body, {}, { now }); assert.equal(result.freshCaptureVerified, false); assert.equal(result.offlineOnly, true); assert.equal(result.categoryProof.sourceResponseDate, null); assert.equal(result.categoryProof.capturedAt, null); assert.equal(result.priceRowsCreated, 0);
});
function checkArchive() {
  const filename = path.resolve(__dirname, "../../price-sources-probes/aldi-nord-milk-category-live.html"); if (!fs.existsSync(filename)) return;
  const raw = fs.readFileSync(filename), before = hash(raw); assert.equal(before, "9d2cc334cda0b1653052d243635cac30fd25c54650015a6633c5edbc51bc9526");
  const result = Navigation.parseSiblingTargets(raw, {}, { now }); assert.deepEqual(result.children.map(child => child.categoryId), siblingIds); assert.equal(result.offlineOnly, true); assert.equal(result.freshCaptureVerified, false); assert.equal(result.categoryProof.capturedAt, null); assert.equal(result.categoryProof.sourceResponseDate, null);
  assert.equal(hash(raw), before); assert.equal(result.priceRowsCreated, 0); assert.equal(result.articleRowsCreated, 0); archiveChecked = true;
}
function hash(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
checkArchive();
console.log(`aldi-category-navigation-parser: ${groups} offline groups passed; original-bound parent/sibling references, closed context diagnostics, no article/price authority; archiveChecked=${archiveChecked}; no HTTP or SQL`);
