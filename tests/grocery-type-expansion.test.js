"use strict";
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const Mapper = require("../grocery-assortment-type-mapper"), Rules = require("../data/grocery-type-rules.json");
const Category = require("../aldi-category-article-service"), Directory = require("../assortment-article-directory");
const Composite = require("../aldi-native-article-directory"), Typed = require("../grocery-article-type-service");
const Fixture = require("./fixtures/aldi-category-capture");
const now = Date.parse("2026-10-03T08:10:00.123Z"), at = now - 1000;
const pool = { query() { throw Error("No SQL or source request is allowed in this offline program"); } };
let groups = 0;
async function test(name, run) { try { await run(); groups++; } catch (error) { console.error("Failed:", name); throw error; } }
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

// These labels are copied unchanged from dated, archived native evidence. They
// establish a proposed product-type word, never today's assortment or an ALDI
// stock claim. The whole bodies built below are new, explicitly synthetic
// validation fixtures; no archived HTTP capture is re-timed.
const cases = [
  { id: "milch-sahne.kondensmilch", name: "Teilentrahmte Kondensmilch", pack: "340-g-Packung", origin: "ALDI category native SKU 642",
    negatives: ["Pudding mit Kondensmilch", "Vegane Kondensmilch Alternative", "Kondensmilch Pulver", "Kondensmilch Geschmack"] },
  { id: "milch-sahne.kaffeesahne", name: "Kaffeesahne-Portionen", pack: "20x10-g-Packung", origin: "ALDI category native SKU 626",
    negatives: ["Kaffeesahne Ersatz", "Pflanzliche Kaffeesahne", "Kaffeesahne Pulver", "Kaffee"] },
  { id: "milch-sahne.kefir", name: "Kefir", pack: "500-g-Becher", origin: "ALDI category native SKU 4680",
    negatives: ["Kalinka Kefir / Ayran", "Wasserkefir", "Pflanzlicher Kefir", "Dressing mit Kefir"] },
  { id: "milch-sahne.trinkjoghurt", name: "Trinkjoghurt", pack: "500-g-Flasche", origin: "ALDI category native SKU 1026634",
    negatives: ["Vegane Trinkjoghurt Alternative", "Trinkjoghurt Pulver", "Keks mit Trinkjoghurt", "Joghurt"] },
  { id: "eier-fette.margarine", name: "Gut & Günstig Die Leichte Halbfettmargarine, 500 g", pack: "500-g-Packung", origin: "Wolt butter native SKU 07070fc957eb1265e8b4604a",
    negatives: ["Becel Streichfett Classic", "Rama", "Kuchen mit Margarine", "Margarine Aroma"] },
  { id: "brot-backwaren.toastbrot", name: "Gut & Günstig Buttertoast, 500 g", pack: "500-g-Packung", origin: "Wolt venue native SKU bb52fbc15c9471e7a26ae25d",
    negatives: ["Buttertoast Backmischung", "Sandwich mit Buttertoast", "Buttertoast Paniermehl", "Butter Toast"] },
  { id: "haushalt.kuchenpapier", name: "Gut & Günstig Küchenpapier Hybrid 3-lagig, 4 Stück", pack: "4-Stück-Packung", origin: "Wolt venue native SKU 6a1589b6e23802bd50afc6c3",
    negatives: ["Küchenpapier Halter", "Küchenpapier Spender", "Backpapier", "Küchenrollenhalter"] },
  { id: "salat-kraeuter.eisbergsalat", name: "Eisbergsalat, 1 Stück", pack: "1-Stück-Packung", origin: "Wolt venue native SKU d49a38aa62920c7e2310d107",
    negatives: ["Sandwich mit Eisbergsalat", "Wrap mit Eisbergsalat", "Eisbergsalat Dressing", "Salatmischung"] },
  { id: "gemuese.auberginen", name: "Aubergine, 1 Stück, ca. 300 g", pack: "1-Stück-Packung", origin: "Wolt venue native SKU 1c28ac3dc36734c61a1d3ce0",
    negatives: ["Aubergine Antipasti", "Aubergine Aufstrich", "Pesto mit Auberginen", "Getrocknete Auberginen"] },
  { id: "gemuese.lauch-und-lauchzwiebeln", name: "Porree, 1 Stück, ca. 260 g", pack: "1-Stück-Packung", origin: "Wolt venue native SKU 86c34e4874132d6981aaf638",
    negatives: ["Lauch Suppe", "Lauch Pulver", "Rahm Lauch", "Lauch Geschmack"] },
  { id: "obst.apfel", name: "Äpfel Jonagold, 1 kg", pack: "1-kg-Packung", origin: "Wolt archived native SKU be8334b1e1a800312d3c4d56",
    negatives: ["Apfel Saft", "Apfel Birnen Mix", "Getrocknete Äpfel", "Apfel Joghurt"] },
  { id: "obst.birnen", name: "Birnen Xenia, 500 g", pack: "500-g-Packung", origin: "Wolt archived native SKU 970c12ae695fc652cf42f5d6",
    negatives: ["Birnen Saft", "Birnen Kompott", "Birnen Joghurt", "Getrocknete Birnen"] },
  { id: "obst.bananen", name: "Dole Mini Bananen, 250 g", pack: "250-g-Packung", origin: "Wolt archived native SKU 61a2f221c14bd830aaa98223",
    negatives: ["Bananen Chips", "Bananen Milch", "Bananen Smoothie", "Getrocknete Bananen"] },
  { id: "obst.trauben", name: "Trauben hell kernlos, 500 g", pack: "500-g-Packung", origin: "Wolt archived native SKU f6d6e339661a1aceab0ab2e3",
    negatives: ["Trauben Saft", "Trauben Gelee", "Getrocknete Trauben", "Joghurt mit Trauben"] },
  { id: "obst.avocado", name: "Avocado essfertig (RTE), 1 Stück", pack: "1-Stück-Packung", origin: "Wolt archived native SKU b7e6d281fa93ab167f9d5809",
    negatives: ["Avocado Öl", "Avocado Aufstrich", "Guacamole mit Avocado", "Avocado Aroma"] }
];

function noAuthority(annotation) {
  for (const field of ["sourceValidationPerformed", "identityValidationPerformed", "packValidationPerformed", "priceValidationPerformed",
    "priceVerifiedByAnnotation", "packVerifiedByAnnotation", "currentAvailabilityVerified", "currentPriceVerified", "physicalStorePriceVerified",
    "truthEligible", "productEquivalence", "canonicalIdentityChanged", "assortmentComplete"]) assert.equal(annotation[field], false, field);
  assert.equal(annotation.sourceRevalidationRequired, true);
}
async function nativeViews(entries) {
  const body = Fixture.html(entries.map((entry, i) => Fixture.item({ objectID: String(1047000 + i),
    productSlug: "synthetic-type-" + (1047000 + i), name: entry.name, brandName: "UNIT TEST",
    shortDescription: entry.variant ?? "", salesUnit: entry.pack ?? "250-g-Packung", currentPrice: null, isAvailable: false })));
  const original = Fixture.original(body, at), parsed = Category.originalPage(original, now).parsed;
  assert.equal(parsed.candidates.length, entries.length);
  const rows = parsed.candidates.map(candidate => Category.rowForArticle(Category.articleFor(candidate, parsed.categoryId)));
  const originals = { query: async () => ({ rows: [{ source_response_hash: original.meta.sourceResponseHash, body, body_bytes: Buffer.byteLength(body) }] }) };
  const views = await Category.readRows(originals, rows, { now }); assert(views.every(Boolean));
  return { original, views };
}
function provider(views) {
  const calls = [];
  const native = { search: async (db, options) => { assert.equal(db, pool); calls.push(structuredClone(options));
    return { ok: true, sourceId: Composite.SOURCE, scopeCountry: "DE", scopeChannel: "assortment-publication", truthEligible: false,
      items: views, scannedRows: views.length, nextOffset: options.offset + views.length, hasMore: views.length === options.limit }; } };
  return { calls, deps: { directory: { search: (db, options) => Directory.search(db, options, { aldi: native }),
    status() { throw Error("Search must not read source status"); } } } };
}
function syntheticView(name, patch = {}) {
  return { kind: "native-retailer-article", state: "last-observed", availability: "unknown", merchant: "ALDI", sourceMerchant: "ALDI Nord",
    sourceId: "ALDI Nord published assortment", scopeCountry: "DE", scopeChannel: "assortment-publication", locationScope: "unknown",
    retailerSku: "unit-test-1047000", gtin: null, name, brand: null, variant: null, pack: "1 l", packAmount: 1000, packUnit: "ml", packCount: 1,
    sourceUrl: "https://www.aldi-nord.de/produkt/unit-test-1047000.html", observedAt: new Date(at).toISOString(), sourceResponseHash: "a".repeat(64),
    truthEligible: false, currentPriceVerified: false, physicalStorePriceVerified: false, assortmentComplete: false, ...patch };
}

(async () => {
  await test("version2 means 40 capabilities, not 40 captured products or physical-stock coverage", () => {
    assert.equal(Rules.version, 2); assert.equal(Rules.initialPlanRuleCount, 23);
    assert.deepEqual(Rules.additionalEverydayRules, cases.map(c => c.id)); assert.equal(Rules.rules.length, 40);
    assert(Rules.rules.slice(0, 25).every(rule => !Object.hasOwn(rule, "excludeRawVariant")));
    assert(Rules.rules.slice(25).every(rule => rule.excludeRawVariant === true));
    assert.equal(Mapper.metadata.ruleSetVersion, 2); assert.equal(Mapper.metadata.ruleCoveredProductTypes, 40);
    assert.equal(Mapper.metadata.unruledProductTypes, 665); assert.equal(Mapper.metadata.taxonomyProductTypes, 705);
    assert.equal(Mapper.metadata.taxonomySha256, "e96a8f6c17a83ffe223d900f96bef2a7a6e96e05e56d20231794343df5d5d3ec");
    assert.equal(hash(Rules.rules.slice(0, 25)), "76cf2a939271521ef52456ce25fc5ddb1550ee9ec5129e38199f558bdf58c36a");
    assert.equal(hash({ taxonomySha256: Rules.taxonomySha256, taxonomyProductTypes: Rules.taxonomyProductTypes,
      initialPlanRuleCount: Rules.initialPlanRuleCount, additionalDisjointRules: Rules.additionalDisjointRules, sourceContracts: Rules.sourceContracts,
      definitionDisqualifiers: Rules.definitionDisqualifiers, dishDisqualifiers: Rules.dishDisqualifiers, ingredientPrefixes: Rules.ingredientPrefixes,
      families: Rules.families }), "5e9bd1e954755cbadb1d5e58b76409976c9c35094dc78eba16f40a6a979fb53e");
    const status = Typed.mappingStatus(); assert.equal(status.types.filter(t => t.state === "mapping-supported").length, 40);
    assert.equal(status.types.filter(t => t.state === "mapping-unavailable").length, 665); noAuthority(status);
  });
  for (const entry of cases) await test("actual parser→reader→Directory→typed selection: " + entry.id, async () => {
    const source = await nativeViews([entry]), frozen = JSON.stringify(source), h = provider(source.views);
    const result = await Typed.search(pool, { merchant: "ALDI", now, productTypeId: entry.id }, h.deps);
    assert.equal(result.items.length, 1); assert.equal(result.items[0].name, entry.name); assert.equal(result.items[0].price, undefined);
    assert.equal(result.items[0].gtin, null); assert.equal(result.items[0].pack, source.views[0].pack);
    assert.equal(result.items[0].observedAt, source.original.meta.capturedAt);
    assert.equal(result.items[0].sourceResponseHash, source.original.meta.sourceResponseHash);
    const sidecar = result.typeAnnotations[0]; assert.equal(sidecar.binding.observedAt, source.original.meta.capturedAt);
    assert.equal(sidecar.binding.sourceResponseHash, source.original.meta.sourceResponseHash);
    assert.deepEqual(sidecar.annotation.productTypeIds, [entry.id]); assert.equal(sidecar.annotation.state, "assigned"); noAuthority(sidecar.annotation);
    assert(sidecar.annotation.evidence.some(e => e.field === "name" && e.value === entry.name));
    assert.equal(JSON.stringify(source), frozen); assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].productTypeId, undefined); assert.equal(result.scannedRows, 1); assert.equal(result.nextOffset, 1);
  });
  for (const entry of cases) for (const name of entry.negatives) await test("unsafe product form cannot satisfy " + entry.id + ": " + name, async () => {
    const source = await nativeViews([{ name }]), h = provider(source.views), result = await Typed.search(pool,
      { merchant: "ALDI", now, productTypeId: entry.id }, h.deps);
    assert.deepEqual(result.items, []); assert.deepEqual(result.typeAnnotations, []); assert.equal(result.scanPerformed, true);
    assert.equal(result.scannedRows, 1); assert.equal(result.nextOffset, 1); assert.equal(result.typeFilteredRows, 1);
    assert.equal(result.reason, "no-assigned-type-in-examined-page");
  });
  // Independent reviewer reproductions, kept as complete native-product-form
  // cases rather than tests that merely mirror an exclusion-term array.
  for (const [id, name] of [["milch-sahne.kefir", "Kefir Kulturen"], ["milch-sahne.kefir", "Kefir Knollen"],
    ["milch-sahne.kefir", "Kefir Starter"], ["milch-sahne.kondensmilch", "Kondensmilch Pralinen"],
    ["milch-sahne.kondensmilch", "Hafer Kondensmilch"], ["milch-sahne.kaffeesahne", "Kokos Kaffeesahne"],
    ["milch-sahne.trinkjoghurt", "Soja Trinkjoghurt"], ["obst.apfel", "Gefriergetrocknete Äpfel"],
    ["obst.apfel", "Getrockneter Apfel"], ["obst.avocado", "Avocado Creme"], ["gemuese.auberginen", "Auberginen Dip"],
    ["gemuese.lauch-und-lauchzwiebeln", "Lauch Quiche"], ["obst.apfel", "Apfel Fruchtsaft"]])
    await test("independent native-form regression excludes " + name, async () => {
      const source = await nativeViews([{ name }]), h = provider(source.views), filtered = await Typed.search(pool,
        { merchant: "ALDI", now, productTypeId: id }, h.deps);
      assert.deepEqual(filtered.items, []); assert.deepEqual(filtered.typeAnnotations, []);
      assert.equal(filtered.scannedRows, 1); assert.equal(filtered.nextOffset, 1); assert.equal(filtered.typeFilteredRows, 1);
      const unfiltered = await Typed.search(pool, { merchant: "ALDI", now }, h.deps);
      const annotation = unfiltered.typeAnnotations[0].annotation; assert.equal(annotation.state, "unassigned");
      assert(annotation.evidence.some(e => e.reason === "excluded-native-product-form" && e.field === "name"));
      noAuthority(annotation); assert.equal(unfiltered.items[0].observedAt, source.original.meta.capturedAt);
    });
  for (const entry of cases) await test("definition/ingredients/brands/packs never substitute the explicit new headline " + entry.id, () => {
    const rule = Rules.rules.find(r => r.productTypeId === entry.id); assert.deepEqual(rule.definitionTerms, []); assert.deepEqual(rule.requireFacts, []);
    const raw = syntheticView("UNIT TEST unknown", { brand: entry.name, variant: "Zutaten: " + rule.aliases[0], gtin: "native-opaque-value", pack: entry.name });
    const before = JSON.stringify(raw), mapped = Mapper.annotate(raw); assert.equal(mapped.state, "unassigned");
    assert.deepEqual(mapped.productTypeIds, []); assert.equal(JSON.stringify(raw), before); noAuthority(mapped);
  });
  for (const [id, name, variant] of [["milch-sahne.kefir", "Kefir", "Pflanzlicher Kefir mit Hafer"],
    ["milch-sahne.trinkjoghurt", "Trinkjoghurt", "Soja Trinkjoghurt mit Frucht"],
    ["milch-sahne.kondensmilch", "Kondensmilch", "Hafer Kondensmilch mit Zucker"],
    ["milch-sahne.kaffeesahne", "Kaffeesahne", "Kokos Kaffeesahne mit Wasser"],
    ["obst.avocado", "Avocado", "Creme mit Zitrone"],
    ["gemuese.auberginen", "Auberginen", "Dip mit Gewürzen"],
    ["obst.apfel", "Apfel", "Getrockneter Apfel mit Schokolade"],
    ["milch-sahne.kefir", "Kefir", "Zutaten: Hafer und Zucker"],
    ["milch-sahne.kondensmilch", "Kondensmilch", "Rezept: Kokos Kondensmilch"],
    ["milch-sahne.trinkjoghurt", "Trinkjoghurt", "Serviervorschlag: Soja Trinkjoghurt"]])
    await test("original raw variant is negative evidence without a positive definition: " + name + " / " + variant, async () => {
      const source = await nativeViews([{ name, variant }]), original = JSON.stringify(source), h = provider(source.views);
      const filtered = await Typed.search(pool, { merchant: "ALDI", now, productTypeId: id }, h.deps);
      assert.deepEqual(filtered.items, []); assert.deepEqual(filtered.typeAnnotations, []);
      assert.equal(filtered.scannedRows, 1); assert.equal(filtered.nextOffset, 1); assert.equal(filtered.typeFilteredRows, 1);
      const unfiltered = await Typed.search(pool, { merchant: "ALDI", now }, h.deps), annotation = unfiltered.typeAnnotations[0].annotation;
      assert.equal(annotation.state, "unassigned"); assert.deepEqual(annotation.productTypeIds, []);
      assert(annotation.evidence.some(e => e.field === "variant" && e.value === variant && e.reason === "excluded-native-product-form"));
      assert.equal(unfiltered.items[0].variant, variant); assert.equal(unfiltered.items[0].observedAt, source.original.meta.capturedAt);
      assert.equal(unfiltered.items[0].sourceResponseHash, source.original.meta.sourceResponseHash); noAuthority(annotation);
      assert.equal(JSON.stringify(source), original);
    });
  for (const entry of cases) await test("raw ingredient/recipe variant cannot supply a positive new type " + entry.id, () => {
    for (const prefix of ["Zutaten: ", "Rezept mit ", "Serviervorschlag: "]) {
      const native = syntheticView("UNIT TEST unknown", { variant: prefix + entry.name });
      const annotation = Mapper.annotate(native); assert.equal(annotation.state, "unassigned");
      assert.deepEqual(annotation.productTypeIds, []); noAuthority(annotation);
      assert.equal(annotation.nativeRef.variant, native.variant);
    }
  });
  await test("raw-variant exclusion opt-in is a closed true-only rule key", () => {
    for (const value of [false, null, 1, "true", [], {}]) {
      const altered = structuredClone(Rules); altered.rules[25].excludeRawVariant = value;
      assert.throws(() => Mapper.createMapper({ ruleData: altered }), error => error.code === "invalid-grocery-type-rule");
    }
  });
  for (const [name, variant, state, id] of [["Trinkjoghurt", "Naturjoghurt", "ambiguous", null],
    ["Trinkjoghurt", "Griechischer Joghurt", "ambiguous", null], ["Rama Margarine", "Butter", "unassigned", null],
    ["Gut & Günstig Buttertoast, 500 g", "Butter", "assigned", "brot-backwaren.toastbrot"], ["Apfel Birnen", "", "ambiguous", null]])
    await test("native variant conflict stays visible: " + name + " / " + variant, async () => {
      const source = await nativeViews([{ name, variant }]), h = provider(source.views), result = await Typed.search(pool, { merchant: "ALDI", now }, h.deps);
      const annotation = result.typeAnnotations[0].annotation; assert.equal(annotation.state, state);
      assert.deepEqual(annotation.productTypeIds, id ? [id] : []); noAuthority(annotation);
      assert.equal(result.items[0].variant, source.views[0].variant); assert.equal(result.scannedRows, 1);
    });
  for (const patch of [{ sourceId: "unknown-upstream" }, { merchant: "HIT" }, { scopeChannel: "physical-store" }, { truthEligible: true },
    { currentPriceVerified: true }, { physicalStorePriceVerified: true }, { assortmentComplete: true }, { held: true }, { validationIssue: "held" },
    { price: 1 }, { storeId: "canonical-store" }, { productId: "canonical-product" }, { sourceUrl: "https://evil.example/product" }])
    await test("annotation cannot widen native source or price authority " + JSON.stringify(patch), () => {
      const value = Mapper.annotate(syntheticView("Kondensmilch", patch)); assert.equal(value.inputAccepted, false);
      assert.deepEqual(value.productTypeIds, []); assert.equal(value.state, "unassigned"); noAuthority(value);
    });
  await test("invalid native original cannot gain a planning type from otherwise matching labels", async () => {
    const body = Fixture.html([Fixture.item({ name: "Kondensmilch", currentPrice: null })]), original = Fixture.original(body, at);
    for (const patch of [{ sourceResponseHash: "0".repeat(64) }, { sourceResponseDate: new Date(at - 300001).toISOString() },
      { sourceAgeSeconds: 301 }, { capturedAt: new Date(now + 1).toISOString() }, { scopeCountry: "AT" }])
      assert.throws(() => Category.originalPage({ body, meta: { ...original.meta, ...patch } }, now));
  });
  await test("zero assigned matches preserve an entire raw page and allow the next offset", async () => {
    const first = await nativeViews(Array.from({ length: 50 }, () => ({ name: "Kondensmilch Geschmack" }))), second = await nativeViews([{ name: "Kondensmilch" }]);
    const requests = [], deps = { directory: { search: (db, options) => { requests.push(options.offset);
      return Directory.search(db, options, { aldi: { search: async () => ({ ok: true, sourceId: Composite.SOURCE,
        scopeCountry: "DE", scopeChannel: "assortment-publication", truthEligible: false,
        items: options.offset === 0 ? first.views : second.views, scannedRows: options.offset === 0 ? 50 : 1,
        nextOffset: options.offset === 0 ? 50 : 51, hasMore: options.offset === 0 }) } }); },
      status() { throw Error("Search must not read source status"); } } };
    const empty = await Typed.search(pool, { merchant: "ALDI", now, productTypeId: "milch-sahne.kondensmilch", limit: 50, offset: 0 }, deps);
    assert.deepEqual(empty.items, []); assert.equal(empty.scannedRows, 50); assert.equal(empty.nextOffset, 50); assert.equal(empty.hasMore, true);
    assert.equal(empty.typeFilteredRows, 50); assert.equal(empty.reason, "no-assigned-type-in-examined-page");
    const next = await Typed.search(pool, { merchant: "ALDI", now, productTypeId: "milch-sahne.kondensmilch", limit: 50, offset: empty.nextOffset }, deps);
    assert.deepEqual(next.items.map(v => v.name), ["Kondensmilch"]); assert.deepEqual(requests, [0, 50]); assert.equal(next.nextOffset, 51);
  });
  for (const id of ["getreide-nudeln.fusilli", "getreide-nudeln.langkornreis", "eier-fette.rohe-huhnereier"])
    await test("unsupported gated type means no examined source, never absence: " + id, async () => {
      let called = 0; const deps = { directory: { search() { called++; throw Error("Unsupported type must not scan"); },
        status() { throw Error("Unsupported type must not read status"); } } };
      const r = await Typed.search(pool, { merchant: "ALDI", now, productTypeId: id }, deps);
      assert.equal(called, 0); assert.equal(r.status, "mapping-unavailable"); assert.equal(r.scanPerformed, false);
      assert.equal(r.scannedRows, null); assert.equal(r.nextOffset, null); assert.equal(r.total, null);
    });
  console.log("grocery-type-expansion: " + groups + " groups passed (offline only; no SQL/source calls)");
})().catch(error => { console.error(error); process.exitCode = 1; });
