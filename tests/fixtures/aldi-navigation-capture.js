"use strict";
// Authored synthetic transport/transaction originals. These are not dated
// retailer archives, observed prices, stock records or canonical identities.
const crypto = require("node:crypto"), Leaf = require("./aldi-category-capture");
const time = Date.parse("2026-10-03T07:48:00.123Z"), parentPath = "/sortiment/milchprodukte", parentUrl = "https://www.aldi-nord.de" + parentPath + ".html";
const CHILDREN = "PRODUCT_MGNL_CATEGORY_CHILDREN_GET", SIBLINGS = "PRODUCT_MGNL_CATEGORY_SIBLINGS_GET";
const childIds = ["milch-milchgetraenke", "butter-sahne-sauerrahm", "joghurt-quark-milchdesserts"];
const siblingIds = ["joghurt-quark-milchdesserts", "scheibenkaese-geriebener-kaese", "frischkaese-weichkaese", "hartkaese-kaese-am-stueck", "butter-sahne-sauerrahm"];
function childRow(id) { return { categoryKey: id, title: "SYNTHETIC TEST " + id, reference: { type: "pages", path: parentPath + "/" + id }, hideInCategory: false, marketingCategory: false, children: [] }; }
function parentNative() {
  return { syntheticFixture: "NEW authored navigation original; never an actual retailer capture", page: "/product-overview/[...categories]", query: { categories: ["milchprodukte"] }, props: { pageProps: { locale: "de", page: { "@name": "milchprodukte", "@path": "/germany" + parentPath, categoryKey: "milchprodukte", "mgnl:template": "aldi-nord-foundation:pages/productCategoryWithSubcategoriesPage", isMagnoliaEdit: false, componentList: ["banner"], openContent: { "@name": "openContent", "@path": "/germany" + parentPath + "/openContent", "@nodeType": "mgnl:area", "@nodes": [] }, header: [{ sideDrawerNavigation: [{ Produkte: { children: [{ path: "https://www.aldi-nord.de/sortiment/vorraete.html" }] } }] }] }, mgnlContext: { isMagnoliaEdit: false, isMagnoliaPreview: false }, algoliaState: null, apiData: JSON.stringify([[CHILDREN, { req: { categoryPath: parentPath, locale: "de" }, res: childIds.map(childRow) }]]) } } };
}
function leafNative() {
  const native = JSON.parse(Leaf.html().match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]); native.syntheticFixture = "NEW authored leaf/sibling original; never an actual retailer capture";
  native.props.pageProps.apiData = JSON.stringify([[SIBLINGS, { req: { categoryPath: parentPath + "/" + Leaf.categoryId, locale: "de" }, res: siblingIds.map(childRow) }]]);
  return native;
}
function html(native, url = parentUrl) { return '<html><head><link rel="canonical" href="' + url + '"></head><body><script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(native).replace(/</g, "\\u003c") + '</script></body></html>'; }
function original(body, url = parentUrl, captured = time) { return { body, meta: { sourceResponseUrl: url, sourceResponseHash: crypto.createHash("sha256").update(body).digest("hex"), sourceResponseDate: new Date(captured).toISOString(), sourceAgeSeconds: 0, capturedAt: new Date(captured).toISOString(), scopeCountry: "DE" } }; }
function parent(change = () => {}, captured = time) { const native = parentNative(); change(native); return original(html(native), parentUrl, captured); }
function leaf(change = () => {}, captured = time) { const native = leafNative(); change(native); return original(html(native, Leaf.url), Leaf.url, captured); }
function headers(captured = time, age = "0") { return { "content-type": "text/html; charset=utf-8", date: new Date(captured).toUTCString(), ...(age === null ? {} : { age }) }; }
module.exports = { time, parentPath, parentUrl, leafUrl: Leaf.url, childIds, siblingIds, CHILDREN, SIBLINGS, childRow, parentNative, leafNative, html, original, parent, leaf, headers };
