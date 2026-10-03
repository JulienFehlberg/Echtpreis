"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const Mapper = require("../grocery-assortment-type-mapper");
const rules = require("../data/grocery-type-rules.json");
const taxonomyJSON = fs.readFileSync(path.join(__dirname, "../data/grocery-assortment.json"), "utf8");
let count = 0;
function test(name, run) { try { run(); count++; } catch (error) { console.error("Failed test:", name); throw error; } }
function deepFreeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
// These are explicitly synthetic directory views, not retailer captures.
function article(name, variant = null, overrides = {}) {
  const value = {
    kind: "native-retailer-article", state: "last-observed", availability: "unknown",
    merchant: "ALDI", sourceMerchant: "ALDI Nord", sourceId: "ALDI Nord published assortment",
    scopeCountry: "DE", scopeChannel: "assortment-publication", locationScope: "unknown",
    retailerSku: "unit-test-900001", gtin: null, name, brand: null, variant,
    pack: "1 l", packAmount: 1000, packUnit: "ml", packCount: 1,
    sourceUrl: "https://www.aldi-nord.de/produkt/unit-test-900001.html",
    observedAt: "2026-10-01T12:00:00.123Z", sourceResponseHash: "a".repeat(64),
    sourceResponseDate: "2026-10-01T12:00:00.000Z", sourceAgeSeconds: null,
    truthEligible: false, currentPriceVerified: false, physicalStorePriceVerified: false,
    normalPriceClassificationVerified: false, currentAvailabilityVerified: false,
    assortmentComplete: false, ...overrides
  };
  value.identityKey ??= JSON.stringify([value.sourceId, value.scopeChannel, value.retailerSku]);
  return value;
}
function mapped(name, expected, variant = null, overrides = {}) {
  const value = Mapper.annotate(article(name, variant, overrides));
  assert.equal(value.inputAccepted, true); assert.equal(value.state, "assigned");
  assert.deepEqual(value.productTypeIds, [expected]); assert.deepEqual(value.candidateTypeIds, []);
  assert.deepEqual(value.reasonCodes, ["explicit-native-type"]);
  assert(value.ruleIds.length > 0 && value.evidence.length > 0);
  assert.equal(value.truthEligible, false); assert.equal(value.productEquivalence, false);
  return value;
}
function open(name, expected = "unassigned", variant = null, overrides = {}) {
  const value = Mapper.annotate(article(name, variant, overrides));
  assert.equal(value.inputAccepted, true); assert.equal(value.state, expected);
  assert.deepEqual(value.productTypeIds, []); return value;
}
function boundary(overrides, reason) {
  const value = Mapper.annotate(article("Feta", null, overrides));
  assert.equal(value.inputAccepted, false); assert.equal(value.state, "unassigned");
  assert.deepEqual(value.productTypeIds, []); assert.deepEqual(value.evidence, []);
  assert(value.reasonCodes.includes(reason)); return value;
}

test("master hash and exact IDs bind 40 capabilities to 705 planning types", () => {
  assert.equal(Mapper.metadata.taxonomySha256, crypto.createHash("sha256").update(taxonomyJSON.replace(/\r\n/g, "\n")).digest("hex"));
  assert.equal(Mapper.metadata.taxonomyProductTypes, 705);
  assert.equal(Mapper.metadata.ruleCoveredProductTypes, 40); assert.equal(Mapper.metadata.unruledProductTypes, 665);
  assert.equal(rules.initialPlanRuleCount, 23);
  assert.deepEqual(rules.additionalDisjointRules, ["kaffee-tee.gemahlener-kaffee", "kaffee-tee.kaffeebohnen"]);
  for (const rule of rules.rules) assert.equal(Mapper.ruleForType(rule.productTypeId).state, "mapping-supported");
  for (const key of ["sourceValidationPerformed", "identityValidationPerformed", "packValidationPerformed", "priceValidationPerformed", "currentAvailabilityVerified", "assortmentComplete"])
    assert.equal(Mapper.metadata[key], false);
  assert(Object.isFrozen(Mapper.metadata));
});

for (const [name, id] of [
  ["H-Kuhmilch ultrahocherhitzt 1,5%", "milch-sahne.h-kuhmilch"],
  ["Frische Kuhmilch", "milch-sahne.frische-kuhmilch"],
  ["Reine Buttermilch", "milch-sahne.buttermilch"],
  ["Naturjoghurt", "joghurt-quark.naturjoghurt"],
  ["Griechischer Joghurt", "joghurt-quark.griechischer-joghurt"],
  ["Skyr natur", "joghurt-quark.skyr"],
  ["Speisequark", "joghurt-quark.speisequark"],
  ["Gouda jung in Scheiben", "kaese.gouda"],
  ["Mozzarella", "kaese.mozzarella"],
  ["Frischkäse", "kaese.frischkase"],
  ["Feta", "kaese.feta-und-hirtenkase"],
  ["Deutsche Marken Butter", "eier-fette.butter"],
  ["Gesalzene Butter", "eier-fette.gesalzene-butter"],
  ["Salami", "wurst-aufschnitt.salami"],
  ["Kochschinken", "wurst-aufschnitt.kochschinken"],
  ["Fleischwurst", "wurst-aufschnitt.fleischwurst"],
  ["Spaghetti trocken", "getreide-nudeln.spaghetti"],
  ["Penne ungekocht", "getreide-nudeln.penne"],
  ["Basmati Reis trocken", "getreide-nudeln.basmatireis"],
  ["Haferdrink", "pflanzliche-alternativen.haferdrink"],
  ["Cola", "getraenke.cola"],
  ["Isotonisches Sportgetränk", "getraenke.sportgetrank"],
  ["Zitronen", "obst.zitronen-und-limetten"],
  ["Röstkaffee gemahlen", "kaffee-tee.gemahlener-kaffee"],
  ["Röstkaffee ganze Bohnen", "kaffee-tee.kaffeebohnen"]
]) test("explicit closed rule " + id, () => mapped(name, id));

test("shared Feta/Hirtenkaese taxonomy never merges native article identity", () => {
  const feta = mapped("Feta", "kaese.feta-und-hirtenkase", null, { retailerSku: "unit-feta", gtin: "native-feta-value", pack: "200 g", packAmount: 200, packUnit: "g" });
  const cheese = mapped("Hirtenkäse", "kaese.feta-und-hirtenkase", null, { retailerSku: "unit-hirtenkaese", gtin: "native-other-value", pack: "250 g", packAmount: 250, packUnit: "g" });
  assert.notEqual(feta.nativeRef.identityKey, cheese.nativeRef.identityKey);
  assert.notEqual(feta.nativeRef.gtin, cheese.nativeRef.gtin); assert.notEqual(feta.nativeRef.pack, cheese.nativeRef.pack);
  assert.equal(feta.productEquivalence, false); assert.equal(cheese.canonicalIdentityChanged, false);
});
test("literal named alternatives are ambiguous instead of first match", () => {
  const value = open("Feta oder Gouda", "ambiguous");
  assert.deepEqual(value.candidateTypeIds, ["kaese.feta-und-hirtenkase", "kaese.gouda"]);
  assert(value.reasonCodes.includes("multiple-native-type-candidates"));
});
test("combined citrus type preserves each fruit name", () => {
  const value = mapped("Limetten", "obst.zitronen-und-limetten"); assert.equal(value.nativeRef.name, "Limetten");
});
test("explicit native variant definition can annotate opaque marketing name", () => {
  const value = mapped("Isolight", "getraenke.sportgetrank", "Isotonisches Sportgetränk");
  assert(value.evidence.some(e => e.field === "variant" && e.value === "Isotonisches Sportgetränk"));
});
test("multiline native variant stays unchanged and can supply standalone definition", () => {
  const variant = "Sportgetränk\n500 ml";
  const value = mapped("Unit drink", "getraenke.sportgetrank", variant);
  assert.equal(value.nativeRef.variant, variant);
});
for (const variant of ["Zutaten: Feta", "Rezept für Feta", "Ideal zu Feta", "Enthält Feta", "Mit Feta", "Serviervorschlag: Feta"])
  test("ingredient/recipe variant cannot be a definition " + variant, () => open("Unit neutral", "unassigned", variant));
for (const name of ["Salat mit Feta", "Pizza Gouda", "Tomaten mit Mozzarella", "Brot mit Salami", "Keks mit Butter", "Streichfett mit Butter", "Schokolade mit Kaffee gemahlen"])
  test("ingredient or dish terms cannot assign standalone type " + name, () => open(name));
for (const name of ["Kartoffelchips Gouda Geschmack", "Aroma Gouda", "Gouda Aromapulver", "Cola Geschmack Wassereis", "Butter Ersatz"])
  test("explicit flavour or substitute form is not the standalone grocery type " + name, () => {
    const value = open(name); assert(value.reasonCodes.includes("excluded-native-product-form"));
    assert(value.evidence.some(e => e.value === name && e.reason === "excluded-native-product-form"));
  });
for (const [name, definition] of [["Gouda Cracker", "Gouda"], ["Gouda Knabbergebäck", "Gouda"],
  ["Cola Eis", "Cola"], ["Cola Lutscher", "Cola"], ["Butter Blätterteig", "Butter"], ["Gesalzene Butter Blätterteig", "Gesalzene Butter"]])
  test("literal native prepared product form cannot become its ingredient type " + name, () => {
    const value = open(name, "unassigned", definition);
    assert(value.reasonCodes.includes("excluded-native-product-form"));
    assert(value.evidence.some(e => e.field === "name" && e.value === name && e.reason === "excluded-native-product-form"));
    assert.equal(value.productEquivalence, false); assert.equal(value.sourceValidationPerformed, false);
  });
for (const [name, form] of [["Gouda", "Cracker"], ["Gouda", "Knabbergebäck"], ["Cola", "Eis"],
  ["Cola", "Lutscher"], ["Butter", "Blätterteig"], ["Gesalzene Butter", "Blätterteig"]])
  test("explicit native variant product form blocks standalone type " + name + " " + form, () => {
    const value = open(name, "unassigned", form);
    assert(value.evidence.some(e => e.field === "variant" && e.value === form && e.reason === "excluded-native-product-form"));
  });
for (const [name, id] of [["Gouda", "kaese.gouda"], ["Cola", "getraenke.cola"], ["Butter", "eier-fette.butter"]])
  test("plain literal product remains assigned after narrow form exclusions " + name, () => mapped(name, id));
for (const name of ["Kein Feta", "Nicht Gouda", "Ohne Mozzarella", "Unit ohne Butter", "No Cola"])
  test("negated product terms cannot assign standalone type " + name, () => open(name));

test("H-Milch without species evidence stays ambiguous", () => {
  const value = open("H-Milch 1,5%", "ambiguous"); assert.deepEqual(value.missingEvidence, ["species-cow"]);
});
test("generic milk has no guessed processing or animal origin", () => {
  const value = open("Milch", "ambiguous");
  assert(value.candidateTypeIds.includes("milch-sahne.esl-kuhmilch")); assert(value.missingEvidence.includes("processing-and-species"));
});
for (const name of ["Milchdrink Schoko", "Schoko Milchdrink", "H-Kuhmilch Milchmischgetränk", "H-Kuhmilch vegan", "H-Kuhmilch Schokomilch", "Reinigungsmilch", "Frische Kuhmilch ESL", "H-Kuhmilch frisch"])
  test("nonplain or conflicting milk is not H/fresh cow milk " + name, () => open(name));
test("plant drink has its own type and never cow milk", () => mapped("Hafer-Drink", "pflanzliche-alternativen.haferdrink"));
test("brand and pack cannot fill missing milk qualifiers", () => {
  const value = open("H-Milch", "ambiguous", null, { brand: "Kuhmilch", pack: "1 l ultrahocherhitzt" });
  assert.deepEqual(value.missingEvidence, ["species-cow"]);
});

test("salted Butter wins specific type without asserting unsalted elsewhere", () => {
  const value = mapped("Butter mit Meersalz", "eier-fette.gesalzene-butter");
  assert(!value.ruleIds.includes("type-eier-fette-butter"));
  const generic = mapped("Butter", "eier-fette.butter"); assert(!generic.evidence.some(e => /ungesalzen/.test(e.matchedTerm)));
});
test("native standalone salted variant overrides generic butter", () => mapped("Butter", "eier-fette.gesalzene-butter", "Gesalzene Butter"));

test("margarine has its own planning type and never becomes butter", () => {
  const value = mapped("Margarine", "eier-fette.margarine");
  assert(!value.productTypeIds.includes("eier-fette.butter"));
  assert(!value.productTypeIds.includes("eier-fette.gesalzene-butter"));
  assert.equal(value.ruleSetVersion, 2);
  assert.equal(value.productEquivalence, false);
});

for (const flag of [false, null, "true", 1, {}])
  test("raw variant refusal opt-in rejects malformed rule flags " + JSON.stringify(flag), () => {
    const copy = structuredClone(rules);
    copy.rules.find(rule => rule.productTypeId === "milch-sahne.kefir").excludeRawVariant = flag;
    assert.throws(() => Mapper.createMapper({ ruleData: copy }), error => error.code === "invalid-grocery-type-rule");
  });

test("raw variant opt-in refuses plant forms while never promoting description ingredients into positive facts", () => {
  for (const [name, variant] of [["Kefir", "Pflanzlicher Kefir mit Hafer"], ["Trinkjoghurt", "Soja Trinkjoghurt mit Frucht"],
    ["Kondensmilch", "Hafer Kondensmilch mit Zucker"]]) {
    const result = open(name, "unassigned", variant);
    assert(result.evidence.some(item => item.field === "variant" && item.value === variant && item.reason === "excluded-native-product-form"));
    assert.equal(result.priceValidationPerformed, false); assert.equal(result.productEquivalence, false);
  }
  const positive = mapped("Kefir", "milch-sahne.kefir", "Milder Kefir mit Milch");
  assert(positive.evidence.every(item => item.field === "name"));
  open("Unit neutral", "unassigned", "Kefir mit Milch");
});
test("native salted-only qualifier needs actual butter name", () => {
  mapped("Butter", "eier-fette.gesalzene-butter", "gesalzen"); open("Unit neutral", "unassigned", "gesalzen");
});
test("contradictory salted choice cannot assign salted butter", () => open("Butter ungesalzen oder gesalzen"));
for (const name of ["Zitronen Eis", "Limetten Sorbet", "Zitronen Marmelade"])
  test("citrus ingredient form is not fresh fruit " + name, () => open(name));
for (const name of ["Margarine mit Butter", "Butter Streichmischung", "Butter mit Rapsöl", "Peanut Butter", "Butter Toast", "Kräuterbutter", "Pflanzliche Butter Alternative"])
  test("butter alternatives and compounds are excluded " + name, () => open(name));
for (const name of ["Paniermehl", "Semmelbrösel", "Brotmischung", "Paniermehl mit Butter", "Semmelbrösel mit Gouda"])
  test("breadcrumbs and bread mixes do not become bread or dairy " + name, () => open(name));
test("generic yoghurt needs a kind; flavour is no natural yoghurt", () => {
  open("Joghurt", "ambiguous"); open("Naturjoghurt Vanille"); open("Naturjoghurt pflanzlich");
});
test("Greek natural yogurt crosses two supported master types and stays ambiguous", () => {
  const value = open("Griechischer Joghurt natur", "ambiguous");
  assert.deepEqual(value.candidateTypeIds, ["joghurt-quark.griechischer-joghurt", "joghurt-quark.naturjoghurt"]);
});
for (const name of ["Spaghetti Eis", "Penne gekocht", "Spaghetti mit Sauce", "Penne frisch", "Pizza Salami", "Salami pflanzlich"])
  test("prepared pasta and sausage imitations are not the closed types " + name, () => open(name));
test("pasta preparation is not inferred from 500g sales pack", () => {
  const value = open("Spaghetti", "ambiguous", null, { pack: "500 g", packAmount: 500, packUnit: "g" });
  assert.deepEqual(value.missingEvidence, ["dry-unprepared"]);
});
test("negated pasta preparation never fills dry evidence", () => open("Spaghetti nicht trocken", "ambiguous"));
test("dry processing can be an explicit native variant fact", () => mapped("Penne", "getreide-nudeln.penne", "trocken"));

for (const name of ["Basmati & Wildreis trocken", "Basmati Reis Mix trocken", "Basmati Reismischung trocken"])
  test("rice blend never becomes pure Basmati " + name, () => {
    const value = open(name, "ambiguous");
    assert(value.reasonCodes.includes("mixed-or-contradictory-native-type"));
    assert(!value.productTypeIds.includes("getreide-nudeln.basmatireis"));
  });
test("generic or unknown-preparation rice remains ambiguous", () => { open("Reis", "ambiguous"); open("Basmatireis", "ambiguous"); });
for (const name of ["Basmati Express", "Basmatireis Curry", "Basmati gekocht"])
  test("prepared rice is excluded " + name, () => open(name));

test("coffee requires explicit grinding form; brand and quantity do not fill it", () => {
  const value = open("Kaffee", "ambiguous", null, { brand: "Gemahlen", pack: "500 g", packAmount: 500, packUnit: "g" });
  assert.deepEqual(value.candidateTypeIds, ["kaffee-tee.gemahlener-kaffee", "kaffee-tee.kaffeebohnen"]);
  assert(value.missingEvidence.includes("ground-form")); assert(value.missingEvidence.includes("whole-bean-form"));
});
test("two explicit coffee forms stay ambiguous", () => {
  const value = open("Kaffee gemahlen oder ganze Bohnen", "ambiguous");
  assert.deepEqual(value.candidateTypeIds, ["kaffee-tee.gemahlener-kaffee", "kaffee-tee.kaffeebohnen"]);
});
test("ground coffee beans do not become whole beans from noun alone", () => open("Gemahlene Kaffeebohnen", "ambiguous"));
for (const name of ["Kaffee Kapseln gemahlen", "Kaffee Pads gemahlen", "Instant Kaffee gemahlen", "Kaffee Schokolade ganze Bohnen", "Kaffeegetränk", "Espresso Cappuccino"])
  test("other coffee sales forms are not ground/whole coffee " + name, () => open(name));
test("cola caffeine variant is not a coffee match", () => mapped("Cola", "getraenke.cola", "Koffeinhaltiges Erfrischungsgetränk"));
test("native original punctuation and spelling remain evidence", () => {
  const name = "UNIT – GOUDA, jung"; const value = mapped(name, "kaese.gouda");
  assert.equal(value.nativeRef.name, name); assert(value.evidence.some(e => e.value === name && e.matchedTerm === "gouda"));
});
test("whole term boundaries do not match embedded spellings", () => { open("Supergoudax"); open("Colariegel"); open("Milchschokolade"); });
test("unknown and valid unruled types have no invented mapping", () => { open("Unit unfamiliar zqx"); open("Mineralwasser"); });
test("known unruled type differs from invalid taxonomy identity", () => {
  assert.equal(Mapper.ruleForType("getraenke.mineralwasser").state, "mapping-unavailable");
  assert.equal(Mapper.ruleForType("getraenke.mineralwasser").rule, null);
  assert.throws(() => Mapper.ruleForType("getraenke.unit-invented"), e => e.code === "invalid-grocery-product-type");
});

test("deep frozen native inputs and original capture metadata are unchanged", () => {
  const value = deepFreeze(article("Feta", null, { sourceAgeSeconds: 18, expiresAt: "2026-10-02T12:00:00.123Z" }));
  const before = JSON.stringify(value), result = Mapper.annotate(value);
  assert.equal(JSON.stringify(value), before); assert.equal(result.nativeRef.observedAt, value.observedAt);
  assert.equal(result.nativeRef.sourceResponseHash, value.sourceResponseHash); assert.equal(result.nativeRef.expiresAt, value.expiresAt);
  assert.equal(result.nativeRef.sourceResponseDate, value.sourceResponseDate); assert.equal(result.nativeRef.sourceAgeSeconds, 18);
  result.nativeRef.name = "changed annotation copy"; assert.equal(value.name, "Feta");
  assert.deepEqual(Mapper.annotate(value), Mapper.annotate(value));
});
test("annotation does not validate or repair GTIN and pack", () => {
  const value = mapped("Feta", "kaese.feta-und-hirtenkase", null, { gtin: "unvalidated-upstream-value", pack: "native unavailable", packAmount: null, packUnit: null });
  assert.equal(value.nativeRef.gtin, "unvalidated-upstream-value"); assert.equal(value.nativeRef.pack, "native unavailable");
  assert.equal(value.sourceValidationPerformed, false); assert.equal(value.packVerifiedByAnnotation, false);
  assert.equal(value.identityValidationPerformed, false); assert.equal(value.sourceRevalidationRequired, true);
  assert.equal(value.inputValidation, "native-view-shape-and-scope-only");
});
test("source scope boundaries retain online and pickup distinctions", () => {
  const wolt = mapped("Feta", "kaese.feta-und-hirtenkase", null, { merchant: "EDEKA", sourceMerchant: "EDEKA", sourceId: "Wolt EDEKA Berlin", scopeChannel: "online", locationScope: "native-venue", sourceUrl: "https://wolt.com/de/deu/berlin/venue/edeka-hilbrecht" });
  const rewe = mapped("Feta", "kaese.feta-und-hirtenkase", null, { merchant: "REWE", sourceMerchant: "REWE", sourceId: "REWE Berlin pickup", scopeChannel: "pickup", locationScope: "pickup-market", sourceUrl: "https://www.rewe.de/shop/p/unit-test/900001" });
  assert.equal(wolt.nativeRef.scopeChannel, "online"); assert.equal(rewe.nativeRef.scopeChannel, "pickup");
  assert.equal(wolt.physicalStorePriceVerified, false); assert.equal(rewe.currentPriceVerified, false);
});
function categoryArticle(overrides = {}) {
  return article("Butter", null, { sourceId: "ALDI Nord category publication", retailerSku: "1018999",
    identityKey: JSON.stringify(["ALDI Nord category publication", "assortment-publication", "1018999"]),
    sourceUrl: "https://www.aldi-nord.de/sortiment/milchprodukte/butter.html",
    sourceResponseUrl: "https://www.aldi-nord.de/sortiment/milchprodukte/butter.html",
    originalCategoryResponseUrl: "https://www.aldi-nord.de/sortiment/milchprodukte/butter.html",
    productIdentityUrl: "https://www.aldi-nord.de/produkt/unit-butter-1018999.html",
    proofKind: "original-category-html", gtin: null, shop: null, ...overrides });
}
test("closed category display contract preserves original category versus PDP link without new rules", () => {
  const value = deepFreeze(categoryArticle()), before = JSON.stringify(value), result = Mapper.annotate(value);
  assert.equal(result.inputAccepted, true); assert.equal(result.state, "assigned");
  assert.deepEqual(result.productTypeIds, ["eier-fette.butter"]); assert.equal(JSON.stringify(value), before);
  assert.equal(result.nativeRef.sourceId, "ALDI Nord category publication");
  assert.equal(result.nativeRef.sourceResponseUrl, value.sourceUrl);
  assert.equal(result.nativeRef.productIdentityUrl, value.productIdentityUrl);
  assert.equal(result.sourceValidationPerformed, false); assert.equal(result.priceValidationPerformed, false);
  assert.equal(result.packValidationPerformed, false); assert.equal(result.identityValidationPerformed, false);
  assert.equal(result.sourceRevalidationRequired, true); assert.equal(result.truthEligible, false);
  assert.equal(result.ruleCoveredProductTypes, 40); assert.equal(result.unruledProductTypes, 665);
});
for (const overrides of [{ sourceUrl: "https://www.aldi-nord.de/produkt/unit-butter-1018999.html" },
  { sourceResponseUrl: "https://www.aldi-nord.de/produkt/unit-butter-1018999.html" },
  { originalCategoryResponseUrl: "https://www.aldi-nord.de/sortiment/other.html" },
  { productIdentityUrl: "https://www.aldi-nord.de/produkt/unit-butter-1019000.html" },
  { productIdentityUrl: "https://www.aldi-nord.de/produkt/unit-butter-1018999.html?x=1" },
  { proofKind: "original-product-html" }, { gtin: "4046700026519" }, { shop: { city: "Berlin" } },
  { nativeProduct: {} }, { rawNativeProduct: {} }, { body: "private original" }])
  test("category annotations cannot relabel product links or raw authority " + JSON.stringify(overrides), () => {
    const result = Mapper.annotate(categoryArticle(overrides)); assert.equal(result.inputAccepted, false);
    assert.equal(result.state, "unassigned"); assert.deepEqual(result.productTypeIds, []);
    assert(result.reasonCodes.includes("native-category-view-boundary-conflict"));
  });
for (const overrides of [{ merchant: "EDEKA" }, { sourceMerchant: "ALDI Süd" }, { scopeChannel: "physical-store" }, { locationScope: "Berlin" }])
  test("category source remains exact merchant/channel/scope " + JSON.stringify(overrides), () => {
    const result = Mapper.annotate(categoryArticle(overrides)); assert.equal(result.inputAccepted, false);
    assert(result.reasonCodes.includes("unsupported-native-source-scope"));
  });
for (const overrides of [{ kind: "physical-price" }, { state: "held" }, { truthEligible: true }, { currentPriceVerified: true }, { physicalStorePriceVerified: true }, { assortmentComplete: true }, { availability: "in-stock" }, { currentAvailabilityVerified: true }, { held: true }, { nativeWitness: {} }, { scopeCountry: "AT" }])
  test("raw or authoritative object is refused " + JSON.stringify(overrides), () => boundary(overrides, "native-article-view-boundary-conflict"));
for (const overrides of [{ price: 2.99 }, { deposit: 0 }, { productId: "canonical-id" }, { storeId: "canonical-store" }])
  test("canonical or price authority is refused " + JSON.stringify(overrides), () => boundary(overrides, "article-price-or-canonical-authority-forbidden"));
for (const overrides of [{ merchant: "REWE" }, { sourceId: "unsupported source" }, { scopeChannel: "physical-store" }, { locationScope: "store" }])
  test("unsupported source/channel coupling is refused " + JSON.stringify(overrides), () => boundary(overrides, "unsupported-native-source-scope"));
for (const sourceUrl of ["http://www.aldi-nord.de/produkt/unit", "https://www.aldi-nord.de.evil.test/unit", "https://other.test/unit", "https://user@www.aldi-nord.de/unit", "https://www.aldi-nord.de/unit?market=other"])
  test("unsupported source URL is refused " + sourceUrl, () => boundary({ sourceUrl }, "native-source-url-boundary-conflict"));
for (const overrides of [{ retailerSku: "" }, { sourceResponseHash: "old" }, { observedAt: "2026-10-01" }, { observedAt: null }])
  test("capture/reference cannot be guessed " + JSON.stringify(overrides), () => boundary(overrides, "native-article-reference-required"));
test("identity key cannot mix sources or captures", () => boundary({ identityKey: JSON.stringify(["Wolt EDEKA Berlin", "online", "same-sku"]) }, "native-article-reference-conflict"));
test("empty optional native variant is retained without supplying facts", () => {
  const result = mapped("Gouda", "kaese.gouda", "");
  assert.equal(result.nativeRef.variant, "");
  assert(result.evidence.every(value => value.field === "name"));
  const missing = open("Milch", "ambiguous", "");
  assert(missing.missingEvidence.length > 0);
});
for (const overrides of [{ name: "<img src=x>Feta" }, { variant: "<script>Feta</script>" }, { variant: " \t\n" }, { name: "Feta\u0000" }])
  test("unsafe native labels are refused " + JSON.stringify(overrides), () => boundary(overrides, "native-article-label-invalid"));
test("nonobject input stays unassigned without throwing", () => {
  for (const value of [null, false, "Feta", [], 5]) {
    const result = Mapper.annotate(value); assert.equal(result.state, "unassigned"); assert.equal(result.inputAccepted, false); assert.equal(result.nativeRef, null);
  }
});
test("rule lookup returns independent copy and cannot change later mapping", () => {
  const copy = Mapper.ruleForType("kaese.feta-und-hirtenkase"); copy.rule.aliases[0] = "unit-other";
  mapped("Feta", "kaese.feta-und-hirtenkase"); assert.equal(Mapper.ruleForType("kaese.feta-und-hirtenkase").rule.aliases[0], "feta");
});
test("different retained same-name articles are not deduplicated or equated", () => {
  const first = article("Feta"), second = article("Feta", null, { retailerSku: "unit-test-900002", pack: "2x200 g", packCount: 2, observedAt: "2026-10-01T12:01:00.123Z", sourceResponseHash: "b".repeat(64) });
  const a = Mapper.annotate(first), b = Mapper.annotate(second);
  assert.notEqual(a.nativeRef.identityKey, b.nativeRef.identityKey); assert.notEqual(a.nativeRef.packCount, b.nativeRef.packCount);
  assert.notEqual(a.nativeRef.observedAt, b.nativeRef.observedAt); assert.notEqual(a.nativeRef.sourceResponseHash, b.nativeRef.sourceResponseHash);
});
test("taxonomy byte changes require an explicit new binding", () => {
  assert.throws(() => Mapper.createMapper({ taxonomyJSON: taxonomyJSON + " " }), e => e.code === "grocery-type-taxonomy-rule-binding-conflict");
  assert.equal(Mapper.createMapper({ taxonomyJSON: taxonomyJSON.replace(/\n/g, "\r\n") }).metadata.taxonomySha256, Mapper.metadata.taxonomySha256);
});
for (const mutate of [d => d.rules.push(structuredClone(d.rules[0])), d => d.rules[0].productTypeId = "unit.fake", d => d.rules[0].guessedStock = true, d => d.rules[0].aliases.push("H-Milch"), d => d.rules[0].suppresses = ["unit.fake"]])
  test("invalid/duplicate or invented rule data is refused " + count, () => {
    const ruleData = structuredClone(rules); mutate(ruleData); assert.throws(() => Mapper.createMapper({ ruleData }), e => e.code.startsWith("invalid-grocery-type-"));
  });
test("unknown mapper options and invalid master purpose are refused", () => {
  assert.throws(() => Mapper.createMapper({ refresh: true }), e => e.code === "invalid-grocery-type-mapper-options");
  const taxonomy = JSON.parse(taxonomyJSON); taxonomy.retailerStockVerified = true;
  assert.throws(() => Mapper.createMapper({ taxonomyJSON: JSON.stringify(taxonomy) }), e => e.code === "invalid-grocery-type-taxonomy");
});
console.log("grocery assortment type mapper: " + count + " test groups passed");
