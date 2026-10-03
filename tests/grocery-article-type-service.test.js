"use strict";
const assert = require("node:assert/strict"), Service = require("../grocery-article-type-service");
const Directory = require("../assortment-article-directory"), Mapper = require("../grocery-assortment-type-mapper");
const Category = require("../aldi-category-article-service"), Composite = require("../aldi-native-article-directory");
const Pdp = require("../aldi-assortment-client"), PdpArticle = require("../aldi-assortment-article-service");
const pdpFixture = require("./fixtures/retailers/aldi-public-assortment.json");
const Fixture = require("./fixtures/aldi-category-capture");
const now = Date.parse("2026-10-03T05:00:00.500Z"), at = now - 1000, clone = structuredClone;
const pool = { query() { throw Error("No real SQL or native-source request is permitted in these adapter tests"); } };
let groups = 0;
async function test(name, fn) { try { await fn(); groups++; } catch (error) { console.error("Failed:", name); throw error; } }
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
// Fresh whole bodies below are explicitly synthetic. The real category reader
// and real native Directory validate them; no archived capture is renewed.
async function nativeViews(names) {
  const body = Fixture.html(names.map((entry, i) => Fixture.item({ objectID: String(1041000 + i),
    productSlug: "unit-type-" + (1041000 + i), name: typeof entry === "string" ? entry : entry.name,
    shortDescription: typeof entry === "string" ? "" : entry.variant ?? "", currentPrice: null,
    isAvailable: false, salesUnit: typeof entry === "string" ? "250-g-Packung" : entry.pack ?? "250-g-Packung" })));
  const original = Fixture.original(body, at), parsed = Category.originalPage(original, now).parsed;
  assert.equal(parsed.candidates.length, names.length);
  const rows = parsed.candidates.map(candidate => Category.rowForArticle(Category.articleFor(candidate, parsed.categoryId)));
  const originals = { query: async () => ({ rows: [{ source_response_hash: original.meta.sourceResponseHash,
    body, body_bytes: Buffer.byteLength(body) }] }) };
  const views = await Category.readRows(originals, rows, { now }); assert(views.every(Boolean));
  return { views, original };
}
function harness(pages, statusPatch) {
  const calls = [], statuses = Directory.MERCHANTS.map(merchant => ({ merchant,
    status: ["ALDI", "EDEKA"].includes(merchant) ? "observed-articles" : "unsupported-source",
    lastObservedArticles: merchant === "ALDI" ? 100 : null, countBasis: merchant === "ALDI" ? "native-article-ledger" : "no-captured-article-source" }));
  const nativeProvider = { search: async (_pool, options) => {
    assert.equal(_pool, pool); const rows = typeof pages === "function" ? pages(options) : pages;
    return { ok: true, sourceId: Composite.SOURCE, scopeCountry: "DE", scopeChannel: "assortment-publication", truthEligible: false,
      items: rows, scannedRows: rows.length, nextOffset: options.offset + rows.length,
      hasMore: rows.length === options.limit && options.offset + rows.length <= Directory.MAX_OFFSET };
  } };
  const directory = { search: async (db, options) => { calls.push({ kind: "search", options: clone(options) });
    return Directory.search(db, options, { aldi: nativeProvider }); },
    status: async (db, options) => { assert.equal(db, pool); calls.push({ kind: "status", options: clone(options) });
      return { ok: true, merchants: statuses, total: null, scopeCountry: "DE", assortmentComplete: false,
        currentPriceVerified: false, physicalStorePriceVerified: false, ...statusPatch }; } };
  return { calls, deps: { directory }, directory };
}
function display(name, merchant = "ALDI", patch = {}) {
  const sources = { ALDI: ["ALDI Nord published assortment", "ALDI Nord", "assortment-publication", "unknown", "https://www.aldi-nord.de/produkt/unit-1041000.html"],
    EDEKA: ["Wolt EDEKA Berlin", "EDEKA", "online", "native-venue", "https://wolt.com/de/deu/berlin/venue/edeka-hilbrecht"],
    REWE: ["REWE Berlin pickup", "REWE", "pickup", "pickup-market", "https://www.rewe.de/shop/p/unit/1041000"] };
  const [sourceId, sourceMerchant, scopeChannel, locationScope, sourceUrl] = sources[merchant];
  return { identityKey: JSON.stringify([sourceId, scopeChannel, "1041000"]), kind: "native-retailer-article",
    state: "last-observed", merchant, sourceMerchant, sourceId, scopeCountry: "DE", scopeChannel, locationScope,
    retailerSku: "1041000", gtin: null, name, brand: null, variant: "", pack: "250 g", packAmount: 250, packUnit: "g", packCount: 1,
    sourceUrl, observedAt: new Date(at).toISOString(), sourceResponseHash: "a".repeat(64), availability: "unknown",
    truthEligible: false, currentPriceVerified: false, physicalStorePriceVerified: false, normalPriceClassificationVerified: false,
    assortmentComplete: false, ...patch };
}
function result(items, merchant = "ALDI", patch = {}) {
  const paged = ["ALDI", "EDEKA"].includes(merchant);
  return { ok: true, merchant, scopeCountry: "DE", truthEligible: false, currentPriceVerified: false,
    physicalStorePriceVerified: false, assortmentComplete: false, total: null, limit: 50, offset: 0,
    items, returnedCount: items.length, excludedRows: 0, offsetSupported: paged,
    scannedRows: paged ? items.length : null, nextOffset: paged ? items.length : null, hasMore: false,
    status: items.length ? "observed-articles" : "no-observed-articles", reason: null, ...patch };
}
function responseDeps(value) { return { directory: { search: async () => value, status: async () => value } }; }
function noAuthority(mapping) {
  for (const key of ["sourceValidationPerformed", "identityValidationPerformed", "packValidationPerformed", "priceValidationPerformed",
    "priceVerifiedByAnnotation", "packVerifiedByAnnotation", "currentAvailabilityVerified", "currentPriceVerified",
    "physicalStorePriceVerified", "truthEligible", "productEquivalence", "canonicalIdentityChanged", "assortmentComplete"])
    assert.equal(mapping[key], false, key);
  assert.equal(mapping.sourceRevalidationRequired, true);
}

(async () => {
  await test("705 exact type IDs expose 25 rule capabilities and 680 mapping-unavailable states", async () => {
    const mapping = Service.mappingStatus(); assert.equal(mapping.types.length, 705);
    assert.equal(mapping.taxonomySha256, Mapper.metadata.taxonomySha256);
    assert.equal(mapping.types.filter(t => t.state === "mapping-supported").length, 25);
    assert.equal(mapping.types.filter(t => t.state === "mapping-unavailable").length, 680);
    assert.equal(new Set(mapping.types.map(t => t.productTypeId)).size, 705); noAuthority(mapping);
    assert(mapping.types.every(t => !Object.hasOwn(t, "price") && !Object.hasOwn(t, "gtin") && !Object.hasOwn(t, "merchant") && !Object.hasOwn(t, "rule")));
    mapping.types[0].name = "changed caller copy"; assert.notEqual(Service.mappingStatus().types[0].name, "changed caller copy");
  });
  for (const productTypeId of [null, "", " eier-fette.butter", "eier-fette.butter ", "EIER-FETTE.BUTTER", "unit.fake", ["eier-fette.butter"], 12])
    await test("invalid type identity rejects before any Directory read " + JSON.stringify(productTypeId), async () => {
      const h = harness([]); await assert.rejects(() => Service.search(pool, { merchant: "ALDI", now, productTypeId }, h.deps),
        e => e.code === "invalid-grocery-product-type"); assert.equal(h.calls.length, 0);
    });
  for (const options of [null, [], {}, { merchant: "aldi" }, { merchant: "HIT" }, { merchant: "ALDI", unknown: true },
    { merchant: "ALDI", search: "a" }, { merchant: "ALDI", search: "x".repeat(121) }, { merchant: "ALDI", search: ["milk"] },
    { merchant: "ALDI", limit: 201 }, { merchant: "ALDI", limit: true }, { merchant: "ALDI", offset: 10001 },
    { merchant: "REWE", offset: 1 }, { merchant: "ALDI", gtin: "4046700026519" }, { merchant: "ALDI", scopeChannel: "physical-store" }])
    await test("ordinary Directory query boundaries survive the wrapper " + JSON.stringify(options), async () => {
      const h = harness([]); await assert.rejects(() => Service.search(pool, options, h.deps), /invalid-|offset-not-supported/);
      assert.equal(h.calls.length, 0);
    });
  await test("known unsupported rule is not an absence claim and performs no article read", async () => {
    const h = harness([]), filtered = await Service.search(pool,
      { merchant: "ALDI", now, productTypeId: "getraenke.mineralwasser" }, h.deps);
    assert.equal(filtered.ok, true); assert.equal(filtered.status, "mapping-unavailable");
    assert.equal(filtered.reason, "product-type-rule-unavailable"); assert.deepEqual(filtered.items, []);
    assert.equal(filtered.scanPerformed, false); assert.equal(filtered.scannedRows, null); assert.equal(filtered.nextOffset, null);
    assert.equal(filtered.sourceId, null); assert.equal(filtered.total, null); assert.equal(h.calls.length, 0);
    assert.equal(filtered.typeMapping.productTypeId, "getraenke.mineralwasser"); noAuthority(filtered.typeMapping);
  });
  await test("actual category original plus actual Directory yields bound sidecars without changing closed DTOs", async () => {
    const native = await nativeViews(["Butter", "Gouda", "Milch"]), before = JSON.stringify(native), h = harness(native.views);
    const listed = await Service.search(pool, { merchant: "ALDI", now }, h.deps);
    assert.equal(listed.items.length, 3); assert.equal(listed.typeAnnotations.length, 3); assert.equal(h.calls.length, 1);
    assert.equal(JSON.stringify(native), before); assert.equal(listed.typeMapping.state, "unfiltered");
    for (let i = 0; i < listed.items.length; i++) {
      const article = listed.items[i], sidecar = listed.typeAnnotations[i];
      assert.equal(article.typeMapping, undefined); assert.equal(article.annotation, undefined); assert.equal(article.price, undefined);
      assert.equal(article.sourceId, Category.SOURCE); assert.equal(article.sourceUrl, Fixture.url);
      assert.equal(article.productIdentityUrl, native.views[i].productIdentityUrl);
      assert.equal(sidecar.identityKey, article.identityKey); assert.equal(sidecar.binding.observedAt, native.original.meta.capturedAt);
      assert.equal(sidecar.binding.sourceResponseHash, native.original.meta.sourceResponseHash);
      assert.equal(sidecar.annotation.nativeRef.sourceResponseUrl, Fixture.url); assert.equal(sidecar.annotation.nativeRef.gtin, null);
      noAuthority(sidecar.annotation);
    }
    assert.equal(listed.scannedRows, 3); assert.equal(listed.nextOffset, 3); assert.equal(listed.hasMore, false);
  });
  await test("only assigned IDs filter; ambiguous milk candidates never become exact typed articles", async () => {
    const native = await nativeViews(["Milch", "Milch-Schokolade", "H-Kuhmilch ultrahocherhitzt", "Milchschokolade"]), h = harness(native.views);
    const listed = await Service.search(pool, { merchant: "ALDI", now, productTypeId: "milch-sahne.h-kuhmilch" }, h.deps);
    assert.deepEqual(listed.items.map(a => a.name), ["H-Kuhmilch ultrahocherhitzt"]);
    assert.equal(listed.typeAnnotations.length, 1); assert.equal(listed.typeAnnotations[0].annotation.state, "assigned");
    assert.equal(listed.typeMapping.stateCounts.ambiguous, 2); assert.equal(listed.typeMapping.stateCounts.unassigned, 1);
    assert.equal(listed.typeFilteredRows, 3); assert.equal(listed.scannedRows, 4); assert.equal(listed.nextOffset, 4);
    assert(!Object.hasOwn(h.calls[0].options, "productTypeId"), "Type is a post-validation planning filter, not SQL source input");
  });
  for (const [productTypeId, names] of [["eier-fette.butter", ["Butterersatz", "Butter Ersatz", "Butter Aroma", "Butterkeks"]],
    ["kaese.gouda", ["Kartoffelchips Gouda Geschmack", "Gouda Aroma", "Gouda Aromapulver"]],
    ["getraenke.cola", ["Cola-Geschmack Wassereis"]]])
    await test("literal flavors/replacement/dish cases cannot enter assigned filter " + productTypeId, async () => {
      const native = await nativeViews(names), h = harness(native.views), filtered = await Service.search(pool,
        { merchant: "ALDI", now, productTypeId }, h.deps);
      assert.deepEqual(filtered.items, []); assert.deepEqual(filtered.typeAnnotations, []);
      assert.equal(filtered.reason, "no-assigned-type-in-examined-page"); assert.equal(filtered.typeFilteredRows, names.length);
    });
  for (const [plainName, productTypeId, forms] of [["Gouda", "kaese.gouda", ["Cracker", "Knabbergebäck"]],
    ["Cola", "getraenke.cola", ["Eis", "Lutscher"]], ["Butter", "eier-fette.butter", ["Blätterteig"]],
    ["Gesalzene Butter", "eier-fette.gesalzene-butter", ["Blätterteig"]]])
    await test("actual native pipeline separates plain " + plainName + " from literal prepared product forms", async () => {
      const inputs = [plainName, ...forms.map(form => ({ name: plainName + " " + form, variant: plainName })),
        ...forms.map(form => ({ name: plainName, variant: form }))];
      const native = await nativeViews(inputs), before = JSON.stringify(native), h = harness(native.views);
      const unfiltered = await Service.search(pool, { merchant: "ALDI", now }, h.deps);
      assert.equal(unfiltered.items.length, inputs.length); assert.equal(unfiltered.typeAnnotations[0].annotation.state, "assigned");
      assert.deepEqual(unfiltered.typeAnnotations[0].annotation.productTypeIds, [productTypeId]);
      for (const sidecar of unfiltered.typeAnnotations.slice(1)) {
        assert.equal(sidecar.annotation.state, "unassigned"); assert.deepEqual(sidecar.annotation.productTypeIds, []);
        assert(sidecar.annotation.evidence.some(e => e.reason === "excluded-native-product-form"));
        noAuthority(sidecar.annotation);
      }
      const filtered = await Service.search(pool, { merchant: "ALDI", now, productTypeId }, h.deps);
      assert.deepEqual(filtered.items.map(article => article.name), [plainName]);
      assert.equal(filtered.items[0].variant, null); assert.equal(filtered.typeFilteredRows, forms.length * 2);
      assert.equal(filtered.scannedRows, inputs.length); assert.equal(filtered.nextOffset, inputs.length); assert.equal(filtered.hasMore, false);
      assert.equal(filtered.excludedRows, 0); assert.equal(JSON.stringify(native), before);
      assert.equal(filtered.typeAnnotations[0].binding.sourceResponseHash, native.original.meta.sourceResponseHash);
      assert.equal(filtered.typeAnnotations[0].binding.observedAt, native.original.meta.capturedAt);
      assert(filtered.items.every(article => article.gtin === null && article.currentPriceVerified === false));
      assert.equal(filtered.typeMapping.ruleCoveredProductTypes, 25); assert.equal(filtered.typeMapping.unruledProductTypes, 680);
    });
  await test("filter leaves raw pagination intact when all visible matches are removed", async () => {
    const first = await nativeViews(["Gouda", "Milch", "Butter"]), second = await nativeViews(["Butter"]);
    const invalid = { ...first.views[2], packAmount: 1 }, h = harness(options => options.offset === 0 ? [first.views[0], first.views[1], invalid] : second.views);
    const empty = await Service.search(pool, { merchant: "ALDI", now, limit: 3, productTypeId: "eier-fette.butter" }, h.deps);
    assert.deepEqual(empty.items, []); assert.equal(empty.scannedRows, 3); assert.equal(empty.nextOffset, 3);
    assert.equal(empty.hasMore, true); assert.equal(empty.excludedRows, 1, "Upstream invalid count remains separate from type filtering");
    assert.equal(empty.typeFilteredRows, 2); assert.equal(empty.typeMapping.examinedValidArticles, 2);
    const next = await Service.search(pool, { merchant: "ALDI", now, limit: 3, offset: empty.nextOffset, productTypeId: "eier-fette.butter" }, h.deps);
    assert.equal(next.items.length, 1); assert.equal(next.items[0].name, "Butter");
    assert.equal(next.scannedRows, 1); assert.equal(next.nextOffset, 4); assert.equal(next.hasMore, false);
    assert.equal(next.total, null); assert.equal(next.assortmentComplete, false);
  });
  await test("same names with different native SKU or pack stay separate without GTIN equivalence", async () => {
    const native = await nativeViews([{ name: "Butter", pack: "250 g" }, { name: "Butter", pack: "2x250 g" }]);
    const h = harness(native.views), selected = await Service.search(pool, { merchant: "ALDI", now, productTypeId: "eier-fette.butter" }, h.deps);
    assert.equal(selected.items.length, 2); assert.notEqual(selected.typeAnnotations[0].identityKey, selected.typeAnnotations[1].identityKey);
    assert.deepEqual(selected.items.map(a => a.packCount), [1, 2]); assert(selected.items.every(a => a.gtin === null));
    assert(selected.typeAnnotations.every(a => a.annotation.productEquivalence === false));
  });
  await test("actual PDP identity and Directory retain empty native variant without inventing matching facts", async () => {
    // This fresh metadata belongs to a deliberately modified synthetic raw row,
    // never a retimed claim about the archived native fixture.
    const meta = { ...Pdp.targetForUrl(pdpFixture.sourceUrl), capturedAt: new Date(at).toISOString(),
      sourceResponseDate: new Date(at).toISOString(), sourceAgeSeconds: 0, sourceResponseHash: "b".repeat(64) };
    const parsed = Pdp.parseProduct({ ...clone(pdpFixture.product), currentPrice: null, name: "Gouda", shortDescription: "" }, meta);
    assert.equal(parsed.ok, true); assert.equal(parsed.offer, null); assert.equal(parsed.product.variant, "");
    const checked = PdpArticle.validateArticle(parsed.product, { now }); assert.equal(checked.ok, true);
    const native = { ...checked.article, kind: "native-retailer-article", state: "last-observed", availability: "unknown",
      nativePublicationAvailableAtObservation: parsed.product.publicationAvailable, currentPriceVerified: false, assortmentComplete: false };
    const h = harness([native]), selected = await Service.search(pool,
      { merchant: "ALDI", now, productTypeId: "kaese.gouda" }, h.deps);
    assert.equal(selected.items.length, 1); assert.equal(selected.items[0].variant, "");
    assert.equal(selected.typeAnnotations[0].annotation.nativeRef.variant, "");
    assert(selected.typeAnnotations[0].annotation.evidence.every(value => value.field === "name"));
    noAuthority(selected.typeAnnotations[0].annotation);
  });
  for (const merchant of ["ALDI", "EDEKA", "REWE"]) await test("published identity scope retained for " + merchant, async () => {
    const article = freeze(display("Gouda", merchant)), response = freeze(result([article], merchant)), before = JSON.stringify(response);
    const listed = await Service.search(pool, { merchant, now, productTypeId: "kaese.gouda" }, responseDeps(response));
    assert.equal(listed.items[0], article); assert.equal(JSON.stringify(response), before);
    assert.equal(listed.typeAnnotations[0].binding.scopeChannel, article.scopeChannel);
    assert.equal(listed.typeAnnotations[0].annotation.nativeRef.sourceId, article.sourceId); noAuthority(listed.typeMapping);
  });
  for (const merchant of ["PENNY", "Lidl", "Kaufland"]) await test("unsupported native merchant remains unknown rather than lacks product " + merchant, async () => {
    const h = harness([]), listed = await Service.search(pool, { merchant, now, productTypeId: "eier-fette.butter" }, h.deps);
    assert.equal(listed.status, "unsupported-source"); assert.equal(listed.reason, "no-captured-article-source");
    assert.equal(listed.scanPerformed, false); assert.deepEqual(listed.items, []); assert.equal(listed.total, null);
  });
  await test("nonpaged REWE receives no synthesized zero-offset request", async () => {
    let called = 0;
    const deps = { directory: { search: async (_db, options) => {
      called++; assert.equal(Object.hasOwn(options, "offset"), false);
      assert.equal(Directory.queryOptions(options).offset, 0);
      return result([display("Gouda", "REWE")], "REWE");
    }, status: async () => { throw Error("No status request expected"); } } };
    const selected = await Service.search(pool, { merchant: "REWE", now, productTypeId: "kaese.gouda" }, deps);
    assert.equal(called, 1); assert.equal(selected.items.length, 1); assert.equal(selected.scannedRows, null);
    assert.equal(selected.offsetSupported, false); assert.equal(selected.typeAnnotations[0].binding.scopeChannel, "pickup");
  });
  for (const patch of [{ truthEligible: true }, { currentPriceVerified: true }, { physicalStorePriceVerified: true },
    { assortmentComplete: true }, { merchant: "EDEKA" }, { total: 100 }, { returnedCount: 2 }, { ok: false }])
    await test("unexpected upstream response is not annotated as validated " + JSON.stringify(patch), async () => {
      await assert.rejects(() => Service.search(pool, { merchant: "ALDI", now }, responseDeps(result([display("Butter")], "ALDI", patch))),
        e => e.code === "grocery-article-type-source-response-conflict");
    });
  for (const patch of [{ price: 1.19 }, { truthEligible: true }, { productId: "invented" }, { observedAt: new Date(now + 1).toISOString() },
    { identityKey: "wrong" }, { held: true }, { sourceId: "unregistered source" }])
    await test("unexpected unvalidated/authoritative article causes no partial annotations " + JSON.stringify(patch), async () => {
      const rows = [display("Butter"), display("Gouda", "ALDI", patch)];
      await assert.rejects(() => Service.search(pool, { merchant: "ALDI", now }, responseDeps(result(rows))),
        e => e.code === "grocery-article-type-source-article-conflict");
    });
  for (const patch of [{ scannedRows: "1" }, { nextOffset: "1" }, { nextOffset: 2 }, { hasMore: true }, { scannedRows: 201 }])
    await test("raw pagination cannot be replaced by filtered count " + JSON.stringify(patch), async () => {
      await assert.rejects(() => Service.search(pool, { merchant: "ALDI", now }, responseDeps(result([display("Butter")], "ALDI", patch))),
        e => e.code === "grocery-article-type-source-pagination-conflict");
    });
  await test("status preserves native source counts and appends rule capabilities, not mapped coverage", async () => {
    const h = harness([]), before = await h.directory.status(pool, { now }), saved = JSON.stringify(before);
    const status = await Service.status(pool, { now }, h.deps);
    assert.deepEqual(status.merchants, before.merchants); assert.equal(JSON.stringify(before), saved);
    assert.equal(status.merchants[3].lastObservedArticles, 100); assert.equal(status.typeMapping.ruleCoveredProductTypes, 25);
    assert.equal(status.typeMapping.unruledProductTypes, 680); assert.equal(status.typeMapping.types.length, 705);
    assert.equal(status.total, null); assert.equal(status.currentPrices, undefined); assert.equal(status.mappedArticles, undefined);
    noAuthority(status.typeMapping); assert.deepEqual(h.calls.at(-1), { kind: "status", options: { now } });
  });
  for (const options of [null, [], { merchant: "ALDI" }, { productTypeId: "eier-fette.butter" }, { now: "2026-10-03" }, { now: Infinity }])
    await test("status query remains closed " + JSON.stringify(options), async () => {
      const h = harness([]); await assert.rejects(() => Service.status(pool, options, h.deps), /invalid-/); assert.equal(h.calls.length, 0);
    });
  await test("underlying read errors preserve identity and no partial response", async () => {
    const failure = Error("native original reader failed"), deps = { directory: { search: async () => { throw failure; }, status: async () => { throw failure; } } };
    await assert.rejects(() => Service.search(pool, { merchant: "ALDI", now }, deps), e => e === failure);
    await assert.rejects(() => Service.status(pool, { now }, deps), e => e === failure);
  });
  await test("database/dependency boundaries do not fetch arbitrary providers", async () => {
    const h = harness([]); await assert.rejects(() => Service.search(null, { merchant: "ALDI", now }, h.deps), /database-required/);
    await assert.rejects(() => Service.search(pool, { merchant: "ALDI", now }, { url: "https://other.example" }), /invalid-grocery-article-type-dependencies/);
    assert.equal(h.calls.length, 0);
  });
  console.log(`grocery-article-type-service: ${groups} offline groups passed; validated native Directory, closed category source, bound immutable annotations, exact 25/705 planning capabilities and raw pagination without coverage/price identity claims`);
})().catch(error => { console.error(error); process.exitCode = 1; });
