"use strict";
const assert = require("node:assert/strict"), Navigation = require("../aldi-category-navigation-parser"), Fixture = require("./fixtures/aldi-navigation-capture");
// Newly authored originals, not a freshened copy of the retained 09:00 capture.
const now = Fixture.time + 1000, parentPath = "/sortiment/obst-gemuese", parentUrl = "https://www.aldi-nord.de" + parentPath + ".html";
const nativeRow = (id, reference) => ({ categoryKey: id, title: "SYNTHETIC TEST " + id, reference: { type: "pages", path: reference }, hideInCategory: false, marketingCategory: false, children: [] });
function nativeParent(path = parentPath) {
  const native = Fixture.parentNative(), id = path.split("/").at(-1), props = native.props.pageProps;
  native.query.categories = path.slice("/sortiment/".length).split("/");
  Object.assign(props.page, { "@name": id, "@path": "/germany" + path, categoryKey: id });
  props.apiData = JSON.stringify([[Navigation.CHILDREN, { req: { categoryPath: path, locale: "de" }, res: [nativeRow("frisches-obst-gemuese", path + "/frisch"), nativeRow("tk-obst-gemuese", path + "/tk-obst-gemuese")] }]]);
  return native;
}
function valueFor(change = () => {}, path = parentPath) { const native = nativeParent(path); change(native); const url = "https://www.aldi-nord.de" + path + ".html"; return Fixture.original(Fixture.html(native, url), url); }
function changeContext(native, fn) { const context = JSON.parse(native.props.pageProps.apiData); fn(context); native.props.pageProps.apiData = JSON.stringify(context); }
const parse = value => Navigation.parseNavigationParent(value.body, value.meta, { now });
let groups = 0;
function test(name, fn) { try { fn(); groups++; } catch (error) { console.error("Failed: " + name); throw error; } }
function rejects(value, code) { assert.throws(() => parse(value), error => error.code === code); }
test("only the witnessed native CHILDREN ID/path tuple is admitted as navigation", () => {
  const value = valueFor(), before = JSON.stringify(value), result = parse(value);
  assert.equal(result.contextKind, Navigation.CHILDREN); assert.equal(result.parentCategoryId, "obst-gemuese");
  assert.equal(result.children[0].categoryId, "frisches-obst-gemuese"); assert.equal(result.children[0].reference.path, parentPath + "/frisch");
  assert.equal(result.children[0].sourceUrl, "https://www.aldi-nord.de/sortiment/obst-gemuese/frisch.html");
  assert.deepEqual(result.discoveredTargets, [result.children[0].sourceUrl, "https://www.aldi-nord.de/sortiment/obst-gemuese/tk-obst-gemuese.html"]);
  assert.equal(result.nativeChildCount, 2); assert.equal(result.categoryProof.sourceResponseHash, value.meta.sourceResponseHash); assert.equal(result.categoryProof.capturedAt, value.meta.capturedAt);
  assert.equal(result.categoryProof.sourceResponseDate, value.meta.sourceResponseDate); assert.equal(result.categoryProof.sourceAgeSeconds, 0); assert.equal(result.categoryProof.sourceResponseUrl, parentUrl);
  assert.equal(JSON.stringify(value), before);
  for (const key of ["admitted", "truthEligible", "currentPriceVerified", "physicalStorePriceVerified", "currentAvailabilityVerified", "canonicalIdentityVerified", "assortmentComplete", "childDiscoveryComplete"]) assert.equal(result[key], false);
  for (const key of ["articleRowsCreated", "priceRowsCreated", "canonicalProductsCreated", "gtinsAssigned"]) assert.equal(result[key], 0);
});
test("ordinary exact ID/path binding remains valid for the same native key", () => {
  const result = parse(valueFor(n => changeContext(n, e => e[0][1].res[0].reference.path = parentPath + "/frisches-obst-gemuese")));
  assert.equal(result.children[0].sourceUrl, "https://www.aldi-nord.de" + parentPath + "/frisches-obst-gemuese.html");
});
for (const [name, edit, code] of [
  ["other ID", row => row.categoryKey = "frisches-obst", "aldi-navigation-child-parent-conflict"],
  ["other slug", row => row.reference.path = parentPath + "/frische", "aldi-navigation-child-parent-conflict"],
  ["other parent ref", row => row.reference.path = "/sortiment/gemuese/frisch", "aldi-navigation-child-parent-conflict"],
  ["grandchild ref", row => row.reference.path = parentPath + "/frisch/obst", "aldi-navigation-child-parent-conflict"],
  ["trailing slash", row => row.reference.path += "/", "aldi-navigation-child-reference-invalid"],
  ["query", row => row.reference.path += "?page=1", "aldi-navigation-child-reference-invalid"],
  ["fragment", row => row.reference.path += "#child", "aldi-navigation-child-reference-invalid"],
  ["foreign origin", row => row.reference.path = "https://other.example" + parentPath + "/frisch", "aldi-navigation-child-reference-invalid"],
  ["encoded ref", row => row.reference.path = parentPath + "/%66risch", "aldi-navigation-child-reference-invalid"],
  ["wrong ref type", row => row.reference.type = "products", "aldi-navigation-child-reference-invalid"],
  ["extra ref field", row => row.reference.href = parentUrl, "aldi-navigation-child-reference-invalid"]
]) test("alias rejects " + name, () => rejects(valueFor(n => changeContext(n, e => edit(e[0][1].res[0]))), code));
test("the exact ID and slug do not authorize a different parent", () => rejects(valueFor(() => {}, "/sortiment/other"), "aldi-navigation-child-parent-conflict"));
test("duplicate native ID still rejects the entire original", () => rejects(valueFor(n => changeContext(n, e => e[0][1].res.push(structuredClone(e[0][1].res[0])))), "aldi-navigation-duplicate-child"));
test("alias and ordinary row cannot share their target URL", () => rejects(valueFor(n => changeContext(n, e => e[0][1].res[1] = nativeRow("frisch", parentPath + "/frisch"))), "aldi-navigation-duplicate-child"));
test("hidden native alias is counted but does not become a target", () => {
  const result = parse(valueFor(n => changeContext(n, e => e[0][1].res[0].hideInCategory = true)));
  assert.equal(result.hiddenChildren, 1); assert.equal(result.nativeChildCount, 2); assert.deepEqual(result.discoveredTargets, ["https://www.aldi-nord.de" + parentPath + "/tk-obst-gemuese.html"]);
});
for (const [name, edit, code] of [
  ["wrong request", n => changeContext(n, e => e[0][1].req.categoryPath = "/sortiment/other"), "aldi-navigation-request-conflict"],
  ["wrong request locale", n => changeContext(n, e => e[0][1].req.locale = "at"), "aldi-navigation-request-conflict"],
  ["native country", n => n.props.pageProps.country = "AT", "aldi-navigation-native-parent-conflict"],
  ["native locale", n => n.props.pageProps.locale = "en", "aldi-navigation-native-parent-conflict"],
  ["query", n => n.query.page = "1", "aldi-navigation-native-route-conflict"],
  ["positive product index", n => n.props.pageProps.algoliaState = {}, "aldi-navigation-product-index-present"]
]) test("original-bound alias rejects " + name, () => rejects(valueFor(edit), code));
for (const [name, edit] of [
  ["scope country", v => v.meta.scopeCountry = "AT"], ["body hash", v => v.meta.sourceResponseHash = "0".repeat(64)],
  ["future capture", v => v.meta.capturedAt = new Date(now + 1).toISOString()], ["stale capture", v => v.meta.capturedAt = new Date(now - 300001).toISOString()],
  ["old Date", v => v.meta.sourceResponseDate = new Date(Fixture.time - 300001).toISOString()], ["future Date", v => v.meta.sourceResponseDate = new Date(Fixture.time + 300001).toISOString()],
  ["missing Date", v => delete v.meta.sourceResponseDate], ["old Age", v => v.meta.sourceAgeSeconds = 301], ["missing Age", v => delete v.meta.sourceAgeSeconds],
  ["wrong actual URL", v => v.meta.sourceResponseUrl = parentUrl + "?page=1"]
]) test("alias keeps original HTTP proof gate for " + name, () => { const value = valueFor(); edit(value); rejects(value, "aldi-navigation-original-proof-required"); });
test("the exception does not widen SIBLINGS references", () => {
  const native = Fixture.leafNative(), path = parentPath + "/frisch", url = "https://www.aldi-nord.de" + path + ".html", props = native.props.pageProps;
  native.query.categories = ["obst-gemuese", "frisch"]; Object.assign(props.page, { "@name": "frisch", "@path": "/germany" + path, categoryKey: "frisch" });
  const entry = Object.values(props.algoliaState.initialResults)[0], filter = "categoryIDs:frisch";
  entry.state.filters = filter; entry.requestParams[0].filters = filter;
  const params = new URLSearchParams(entry.results[0].params); params.set("filters", filter); entry.results[0].params = params.toString();
  entry.results[0].hits.forEach(item => item.categoryIDs = ["frisch"]);
  props.apiData = JSON.stringify([[Navigation.SIBLINGS, { req: { categoryPath: path, locale: "de" }, res: [nativeRow("frisches-obst-gemuese", parentPath + "/frisch")] }]]);
  const source = Fixture.original(Fixture.html(native, url), url);
  assert.throws(() => Navigation.parseSiblingTargets(source.body, source.meta, { now }), { code: "aldi-navigation-child-parent-conflict" });
});
console.log(`aldi-category-navigation-alias: ${groups} authored offline groups passed; exact native CHILDREN tuple only, original capture/proof preserved, no HTTP or SQL`);
