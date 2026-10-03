"use strict";

// Planning annotations only. Source admission, identity, sales-pack and price
// validation belong to the caller; this module cannot authorize any of them.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const DEFAULT_TAXONOMY = fs.readFileSync(path.join(__dirname, "data/grocery-assortment.json"), "utf8");
const DEFAULT_RULES = require("./data/grocery-type-rules.json");
// This additive display-source contract changes no type rule or master ID.
const CATEGORY_SOURCE = "ALDI Nord category publication";
const CATEGORY_CONTRACT = { sourceId: CATEGORY_SOURCE, merchants: ["ALDI", "ALDI Nord"], sourceMerchant: "ALDI Nord",
  scopeChannel: "assortment-publication", locationScope: "unknown", host: "www.aldi-nord.de" };
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = code => Object.assign(new Error(code), { code });
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const clone = value => structuredClone(value);
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function normalize(value) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim(); }
function printable(value, max = 500) { return typeof value === "string" && value.length <= max && value.trim().length > 0 && !/[<>\u0000-\u001f\u007f]/.test(value); }
function variantText(value) { return typeof value === "string" && value.length <= 2000 && value.trim().length > 0 && !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value); }
function iso(value) { const n = typeof value === "string" ? Date.parse(value) : NaN; return Number.isFinite(n) && new Date(n).toISOString() === value; }
function terms(value, allowEmpty = false) {
  if (!Array.isArray(value) || !allowEmpty && !value.length || value.some(term => !printable(term, 120) || !normalize(term))
    || new Set(value.map(normalize)).size !== value.length) throw fail("invalid-grocery-type-rule-terms");
}
function matches(value, term) {
  const text = " " + normalize(value) + " ", needle = " " + normalize(term) + " ", result = [];
  let index = -1;
  while ((index = text.indexOf(needle, index + 1)) >= 0) result.push({ term, index });
  return result;
}
function termHits(value, list) { return list.flatMap(term => matches(value, term)); }

function createMapper(options = {}) {
  if (!plain(options) || Object.keys(options).some(key => !["taxonomyJSON", "ruleData"].includes(key))) throw fail("invalid-grocery-type-mapper-options");
  const taxonomyJSON = options.taxonomyJSON ?? DEFAULT_TAXONOMY;
  if (typeof taxonomyJSON !== "string") throw fail("invalid-grocery-type-taxonomy");
  const taxonomyHash = hash(taxonomyJSON.replace(/\r\n/g, "\n"));
  let taxonomy; try { taxonomy = JSON.parse(taxonomyJSON); } catch { throw fail("invalid-grocery-type-taxonomy"); }
  const data = clone(options.ruleData ?? DEFAULT_RULES);
  if (!plain(taxonomy) || taxonomy.purpose !== "planning-taxonomy" || taxonomy.retailerStockVerified !== false
    || taxonomy.canonicalProductIdentities !== false || taxonomy.currentPricesIncluded !== false || taxonomy.complete !== false
    || !Array.isArray(taxonomy.categories)) throw fail("invalid-grocery-type-taxonomy");
  const types = new Map();
  for (const category of taxonomy.categories) {
    if (!plain(category) || !Array.isArray(category.productTypes)) throw fail("invalid-grocery-type-taxonomy");
    for (const type of category.productTypes) {
      if (!plain(type) || typeof type.id !== "string" || !printable(type.name) || types.has(type.id)) throw fail("invalid-grocery-type-taxonomy");
      types.set(type.id, { id: type.id, name: type.name, categoryId: category.id });
    }
  }
  if (!plain(data) || data.schemaVersion !== 1 || data.purpose !== "planning-annotation" || !Number.isSafeInteger(data.version) || data.version < 1
    || data.taxonomySha256 !== taxonomyHash || data.taxonomyProductTypes !== types.size || taxonomy.statistics?.productTypes !== types.size
    || !Array.isArray(data.rules) || !data.rules.length || !Array.isArray(data.families) || !Array.isArray(data.sourceContracts))
    throw fail("grocery-type-taxonomy-rule-binding-conflict");
  for (const key of ["definitionDisqualifiers", "dishDisqualifiers", "ingredientPrefixes"]) terms(data[key]);
  const ruleIds = new Set(), assignedTypes = new Set(), familyIds = new Set();
  const ids = values => { if (!Array.isArray(values) || values.some(id => !types.has(id)) || new Set(values).size !== values.length) throw fail("invalid-grocery-type-rule-type"); };
  for (const rule of data.rules) {
    if (!plain(rule) || Object.keys(rule).some(key => !["id", "productTypeId", "family", "aliases", "definitionTerms", "requireFacts", "excludeTerms", "suppresses", "ambiguousExclusions", "excludedCandidateTypeIds"].includes(key))
      || !printable(rule.id, 120) || ruleIds.has(rule.id) || !types.has(rule.productTypeId) || assignedTypes.has(rule.productTypeId)
      || !printable(rule.family, 80)) throw fail("invalid-grocery-type-rule");
    ruleIds.add(rule.id); assignedTypes.add(rule.productTypeId);
    terms(rule.aliases); terms(rule.definitionTerms, true); terms(rule.excludeTerms, true);
    if (!Array.isArray(rule.requireFacts)) throw fail("invalid-grocery-type-rule-fact");
    const facts = new Set();
    for (const fact of rule.requireFacts) {
      if (!plain(fact) || Object.keys(fact).some(key => !["id", "terms"].includes(key)) || !printable(fact.id, 80) || facts.has(fact.id)) throw fail("invalid-grocery-type-rule-fact");
      facts.add(fact.id); terms(fact.terms);
    }
    if (rule.suppresses) ids(rule.suppresses);
    if (rule.ambiguousExclusions) terms(rule.ambiguousExclusions);
    if (rule.excludedCandidateTypeIds) ids(rule.excludedCandidateTypeIds);
  }
  for (const family of data.families) {
    if (!plain(family) || Object.keys(family).some(key => !["id", "terms", "excludeTerms", "candidateTypeIds", "missingFacts"].includes(key))
      || !printable(family.id, 80) || familyIds.has(family.id)) throw fail("invalid-grocery-type-family");
    familyIds.add(family.id); terms(family.terms); terms(family.excludeTerms, true); ids(family.candidateTypeIds); terms(family.missingFacts);
  }
  const sourceIds = new Set(), sourceContracts = [...data.sourceContracts, clone(CATEGORY_CONTRACT)];
  for (const source of sourceContracts) {
    if (!plain(source) || Object.keys(source).some(key => !["sourceId", "merchants", "sourceMerchant", "scopeChannel", "locationScope", "host", "sourceUrl"].includes(key))
      || !printable(source.sourceId, 120) || sourceIds.has(source.sourceId) || !printable(source.sourceMerchant, 120)
      || !["assortment-publication", "online", "pickup"].includes(source.scopeChannel) || !printable(source.locationScope, 80)
      || !!source.host === !!source.sourceUrl) throw fail("invalid-grocery-type-source-contract");
    sourceIds.add(source.sourceId); terms(source.merchants);
  }
  freeze(data);
  freeze(sourceContracts);
  const metadata = freeze({ purpose: "planning-annotation", ruleSetVersion: data.version, taxonomySha256: taxonomyHash,
    taxonomyHashFormat: "sha256-utf8-LF", taxonomyProductTypes: types.size, ruleCoveredProductTypes: assignedTypes.size,
    unruledProductTypes: types.size - assignedTypes.size, sourceValidationPerformed: false,
    identityValidationPerformed: false, packValidationPerformed: false, priceValidationPerformed: false,
    currentAvailabilityVerified: false, assortmentComplete: false });

  function boundary(article) {
    const reasons = [];
    if (!plain(article)) return ["native-article-view-required"];
    if (article.kind !== "native-retailer-article" || article.state !== "last-observed" || article.availability !== "unknown"
      || article.scopeCountry !== "DE" || article.truthEligible !== false || article.currentPriceVerified !== false
      || article.physicalStorePriceVerified !== false || article.assortmentComplete !== false
      || article.currentAvailabilityVerified === true || article.normalPriceClassificationVerified === true
      || article.held === true || article.validationIssue != null || article.validation_issue != null || article.nativeWitness != null)
      reasons.push("native-article-view-boundary-conflict");
    if (["price", "deposit", "displayedPrice", "payablePackPrice", "productId", "canonicalProductId", "storeId"].some(key => article[key] != null)) reasons.push("article-price-or-canonical-authority-forbidden");
    // A valid native Directory may retain an explicitly empty optional variant.
    // It supplies no matching evidence; nonempty malformed text still rejects.
    if (!printable(article.name) || article.variant != null && article.variant !== "" && !variantText(article.variant)) reasons.push("native-article-label-invalid");
    if (!printable(article.retailerSku, 120) || !iso(article.observedAt) || !/^[a-f0-9]{64}$/.test(article.sourceResponseHash || "")) reasons.push("native-article-reference-required");
    const source = sourceContracts.find(source => source.sourceId === article.sourceId);
    if (!source || !source.merchants.includes(article.merchant) || article.sourceMerchant != null && article.sourceMerchant !== source.sourceMerchant
      || source.scopeChannel !== article.scopeChannel || source.locationScope !== article.locationScope) reasons.push("unsupported-native-source-scope");
    try {
      const url = new URL(article.sourceUrl);
      if (!source || url.protocol !== "https:" || url.username || url.password || url.port || url.hash || url.search
        || source.sourceUrl && url.href !== source.sourceUrl || source.host && url.hostname !== source.host)
        reasons.push("native-source-url-boundary-conflict");
    } catch { reasons.push("native-source-url-boundary-conflict"); }
    if (article.sourceId === CATEGORY_SOURCE) {
      const sku = article.retailerSku;
      if (!/^[1-9]\d{0,14}$/.test(sku || "") || !Number.isSafeInteger(Number(sku))
        || !/^https:\/\/www\.aldi-nord\.de\/sortiment\/(?:[a-z0-9-]+\/){0,5}[a-z0-9-]+\.html$/.test(article.sourceUrl || "")
        || article.sourceResponseUrl !== article.sourceUrl || article.originalCategoryResponseUrl !== article.sourceUrl
        || article.proofKind !== "original-category-html" || article.gtin !== null || article.shop !== null
        || !new RegExp("^https://www\\.aldi-nord\\.de/produkt/[a-z0-9-]+-" + sku + "\\.html$").test(article.productIdentityUrl || "")
        || ["nativeProduct", "rawNativeProduct", "body"].some(key => article[key] != null))
        reasons.push("native-category-view-boundary-conflict");
    }
    const expectedKey = JSON.stringify([article.sourceId, article.scopeChannel, article.retailerSku]);
    if (article.identityKey !== undefined && article.identityKey !== expectedKey) reasons.push("native-article-reference-conflict");
    return [...new Set(reasons)];
  }
  function nativeRef(article) {
    if (!plain(article)) return null;
    const keys = ["identityKey", "merchant", "sourceMerchant", "sourceId", "scopeCountry", "scopeChannel", "locationScope", "retailerSku", "gtin",
      "name", "brand", "variant", "pack", "packAmount", "packUnit", "packCount", "sourceUrl", "observedAt", "sourceResponseHash",
      "sourceResponseDate", "sourceAgeSeconds", "expiresAt", "nativeVenueId", "nativeMarketId", "nativeStoreId",
      "sourceResponseUrl", "originalCategoryResponseUrl", "productIdentityUrl", "proofKind"];
    return Object.fromEntries(keys.filter(key => Object.hasOwn(article, key)
      && (article[key] == null || ["string", "boolean", "number"].includes(typeof article[key])))
      .map(key => [key, article[key]]));
  }
  function ingredient(text, hit) {
    const before = normalize(text).slice(0, hit.index).trim().split(" ").slice(-4);
    return before.some(word => data.ingredientPrefixes.map(normalize).includes(word));
  }
  function fields(article) {
    const result = [{ field: "name", value: article.name }];
    if (article.variant && !termHits(article.variant, data.definitionDisqualifiers).length) {
      for (const value of article.variant.split(/[;\n]/).map(value => value.trim()).filter(Boolean)) result.push({ field: "variant", value });
    }
    return result;
  }
  function evidence(field, hit, ruleId, reason) { return { field: field.field, value: field.value, matchedTerm: hit.term, ruleId, reason }; }
  function evaluate(rule, article, available) {
    const headline = available[0], dish = termHits(article.name, data.dishDisqualifiers);
    const hits = termHits(headline.value, rule.aliases).filter(hit => !ingredient(headline.value, hit));
    const definition = dish.length ? [] : available.slice(1).filter(field => rule.definitionTerms.some(term => normalize(term) === normalize(field.value)))
      .map(field => ({ field, hit: { term: rule.definitionTerms.find(term => normalize(term) === normalize(field.value)), index: 0 } }));
    if (!hits.length && !definition.length) return null;
    const exclusions = available.flatMap(field => termHits(field.value, rule.excludeTerms).map(hit => ({ field, hit })));
    const positives = [...hits.map(hit => evidence(headline, hit, rule.id, "explicit-native-product-term")),
      ...definition.map(({ field, hit }) => evidence(field, hit, rule.id, "explicit-native-product-definition"))];
    if (exclusions.length || dish.length) {
      const mixed = exclusions.some(({ hit }) => (rule.ambiguousExclusions || []).some(term => normalize(term) === normalize(hit.term)));
      return { rule, state: mixed ? "ambiguous" : "excluded", evidence: [...positives,
        ...exclusions.map(({ field, hit }) => evidence(field, hit, rule.id, "excluded-native-product-form")),
        ...dish.map(hit => evidence(headline, hit, rule.id, "excluded-native-product-form"))],
        missing: [], reason: mixed ? "mixed-or-contradictory-native-type" : "excluded-native-product-form",
        candidates: mixed ? rule.excludedCandidateTypeIds || [rule.productTypeId] : [] };
    }
    const missing = [], facts = [];
    for (const fact of rule.requireFacts) {
      const found = available.flatMap(field => termHits(field.value, fact.terms).filter(hit => !ingredient(field.value, hit))
        .map(hit => evidence(field, hit, rule.id, "explicit-native-fact:" + fact.id)));
      if (!found.length) missing.push(fact.id); else facts.push(...found);
    }
    return { rule, state: missing.length ? "ambiguous" : "assigned", evidence: [...positives, ...facts], missing,
      reason: missing.length ? "missing-type-defining-evidence" : "explicit-native-type", candidates: [rule.productTypeId] };
  }
  function annotate(article) {
    const invalid = boundary(article), reference = nativeRef(article);
    const base = { ...metadata, inputAccepted: invalid.length === 0, inputValidation: "native-view-shape-and-scope-only",
      sourceRevalidationRequired: true, matchMeaning: "planning-type-not-product-equivalence", nativeRef: reference,
      productEquivalence: false, canonicalIdentityChanged: false, packVerifiedByAnnotation: false, priceVerifiedByAnnotation: false,
      currentPriceVerified: false, physicalStorePriceVerified: false, truthEligible: false };
    if (invalid.length) return { ...base, state: "unassigned", productTypeIds: [], candidateTypeIds: [], ruleIds: [], evidence: [], missingEvidence: [], reasonCodes: invalid };
    const available = fields(article), evaluations = data.rules.map(rule => evaluate(rule, article, available)).filter(Boolean);
    const full = evaluations.filter(value => value.state === "assigned"), suppressed = new Set(full.flatMap(value => value.rule.suppresses || []));
    const assigned = full.filter(value => !suppressed.has(value.rule.productTypeId));
    const partial = evaluations.filter(value => value.state === "ambiguous");
    const resolvedFamilies = new Set(assigned.map(value => value.rule.family));
    const families = data.families.filter(family => !resolvedFamilies.has(family.id) && !evaluations.some(value => value.rule.family === family.id)
      && !termHits(article.name, [...family.excludeTerms, ...data.dishDisqualifiers]).length
      && termHits(article.name, family.terms).some(hit => !ingredient(article.name, hit)));
    const independentPartial = partial.filter(value => !resolvedFamilies.has(value.rule.family));
    const unique = values => [...new Set(values)].sort();
    let state, productTypeIds = [], candidateTypeIds = [], chosen;
    if (assigned.length === 1 && !independentPartial.length && !families.length) { state = "assigned"; productTypeIds = [assigned[0].rule.productTypeId]; chosen = assigned; }
    else if (assigned.length || partial.length || families.length) {
      state = "ambiguous"; chosen = [...assigned, ...partial];
      candidateTypeIds = unique([...chosen.flatMap(value => value.candidates), ...families.flatMap(value => value.candidateTypeIds)]);
    } else { state = "unassigned"; chosen = evaluations; }
    const evidenceList = chosen.flatMap(value => value.evidence);
    for (const family of families) for (const hit of termHits(article.name, family.terms).filter(hit => !ingredient(article.name, hit)))
      evidenceList.push(evidence(available[0], hit, "family-" + family.id, "unspecified-native-family"));
    const reasons = state === "assigned" ? ["explicit-native-type"] : state === "ambiguous"
      ? unique([...chosen.map(value => value.reason), ...(assigned.length > 1 || independentPartial.length || families.length && assigned.length ? ["multiple-native-type-candidates"] : []), ...(families.length ? ["missing-type-defining-evidence"] : [])])
      : unique(evaluations.map(value => value.reason).concat(evaluations.length ? [] : ["unmapped-native-type"]));
    return { ...base, state, productTypeIds, candidateTypeIds, ruleIds: unique(chosen.map(value => value.rule.id).concat(families.map(value => "family-" + value.id))),
      evidence: [...new Map(evidenceList.map(value => [JSON.stringify(value), value])).values()],
      missingEvidence: unique(chosen.flatMap(value => value.missing).concat(families.flatMap(value => value.missingFacts))), reasonCodes: reasons };
  }
  function ruleForType(typeId) {
    if (typeof typeId !== "string" || !types.has(typeId)) throw fail("invalid-grocery-product-type");
    const type = types.get(typeId), rule = data.rules.find(rule => rule.productTypeId === typeId);
    return { ...metadata, productTypeId: typeId, name: type.name, categoryId: type.categoryId,
      state: rule ? "mapping-supported" : "mapping-unavailable", rule: rule ? clone(rule) : null };
  }
  return Object.freeze({ annotate, ruleForType, metadata });
}

module.exports = Object.freeze({ ...createMapper(), createMapper });
