"use strict";
const assert = require("assert");
const Matcher = require("../shopping-need-matcher");
let count = 0;
function test(name, run) { run(); count++; }
function need(family, constraints = {}, search = { milk: "Milch", bread: "Brot", eggs: "Eier" }[family]) {
  return Matcher.parse({ search, constraints: { family, ...constraints } });
}
function classify(family, constraints, name, description) {
  return Matcher.classify(need(family, constraints), description === undefined ? { name } : { name, description });
}
function throws(code, input) { assert.throws(() => Matcher.parse(input), error => error.code === code); }

test("generic families add no qualifiers", () => {
  for (const family of ["milk", "bread", "eggs"]) assert.deepStrictEqual(need(family).constraints, { family });
});
test("explicit search qualifiers normalize without losing spelling", () => {
  assert.deepStrictEqual(need("milk", {}, "ja! H-Milch 1,5%"), {
    search: "ja! H-Milch 1,5%", constraints: { family: "milk", processing: "uht", fatPercent: 1.5 }
  });
  assert.deepStrictEqual(need("bread", {}, "geschnittenes Vollkornbrot").constraints, { family: "bread", grain: "wholegrain", sliced: true });
  assert.deepStrictEqual(need("eggs", {}, "Eier M Bodenhaltung ungekocht").constraints, { family: "eggs", husbandry: "barn", raw: true, size: "M" });
});
test("milk native brand prefix matches broad need without defaults", () => {
  const result = classify("milk", {}, "ja! H-Milch 1,5%");
  assert.strictEqual(result.status, "confirmed"); assert.deepStrictEqual(result.matched, ["family"]);
  assert.deepStrictEqual(result.evidence, [{ field: "name", value: "ja! H-Milch 1,5%", matches: ["family"] }]);
});
test("bread and egg brand prefixes match broad need", () => {
  assert.strictEqual(classify("bread", {}, "Küchenmeister Vollkornbrot mit Hefe").status, "confirmed");
  assert.strictEqual(classify("eggs", {}, "REWE Respeggt Eier FH Größe: S-L").status, "confirmed");
});
test("unsafe previous processing comparison is contradicted", () => {
  const result = classify("milk", { processing: "uht", fatPercent: 1.5 }, "Frisch-Milch 1,5%");
  assert.strictEqual(result.status, "contradicted"); assert.strictEqual(result.conflicts[0].field, "processing");
});
test("unsafe previous husbandry comparison is contradicted", () => {
  const result = classify("eggs", { size: "M", husbandry: "barn" }, "Eier Freilandhaltung Größe: M");
  assert.strictEqual(result.status, "contradicted"); assert.deepStrictEqual(result.conflicts, [{ field: "husbandry", expected: "barn", observed: ["free-range"] }]);
});
test("unsafe previous bread slicing comparison is unconfirmed", () => {
  const result = classify("bread", { grain: "wholegrain", sliced: true }, "Küchenmeister Vollkornbrot mit Hefe");
  assert.strictEqual(result.status, "unconfirmed"); assert.deepStrictEqual(result.missing, ["sliced"]);
});
test("milk fat lactose and plain flavour require positive evidence", () => {
  const result = classify("milk", { processing: "uht", fatPercent: 1.5, lactose: "contains", flavour: "plain" }, "ja! H-Milch 1,5%");
  assert.strictEqual(result.status, "unconfirmed"); assert.deepStrictEqual(result.missing, ["lactose", "flavour"]);
});
test("all explicitly stated milk qualifiers confirm", () => {
  const result = classify("milk", { processing: "uht", fatPercent: 1.5, lactose: "contains", flavour: "plain" }, "H-Milch 1,5% nicht laktosefrei, ohne Aroma");
  assert.strictEqual(result.status, "confirmed"); assert.deepStrictEqual(result.missing, []);
});
test("negated lactose does not match free", () => {
  assert.strictEqual(classify("milk", { lactose: "free" }, "Milch nicht laktosefrei").status, "contradicted");
  assert.strictEqual(classify("milk", { lactose: "contains" }, "Milch nicht laktosefrei").status, "confirmed");
});
test("ohne lactose and mit lactose are affirmative claims", () => {
  assert.strictEqual(classify("milk", { lactose: "free" }, "Milch ohne Laktose").status, "confirmed");
  assert.strictEqual(classify("milk", { lactose: "contains" }, "Milch mit Laktose").status, "confirmed");
});
test("marketing brand does not evidence lactose or flavour", () => {
  assert.deepStrictEqual(classify("milk", { lactose: "free", flavour: "plain" }, "MinusL Andechser Natur Milch").missing, ["lactose", "flavour"]);
});
test("plain claim and flavoured claim conflict", () => {
  assert.strictEqual(classify("milk", { flavour: "plain" }, "Milch mit Vanille").status, "contradicted");
  assert.strictEqual(classify("milk", { flavour: "plain" }, "Milch ohne Aroma Vanille").status, "contradicted");
});
test("absence of processing and fat remains missing", () => {
  assert.deepStrictEqual(classify("milk", { processing: "fresh", fatPercent: 3.5 }, "Milch").missing, ["processing", "fatPercent"]);
});
test("fresh and uht evidence conflicts across name and description", () => {
  const result = classify("milk", { processing: "uht" }, "H-Milch", "Frische Milch");
  assert.strictEqual(result.status, "contradicted"); assert.deepStrictEqual(result.conflicts[0].observed, ["uht", "fresh"]);
});
test("contradictory fat percentages cannot confirm", () => {
  assert.strictEqual(classify("milk", { fatPercent: 1.5 }, "Milch 1,5% und 3,5%").status, "contradicted");
});
test("native description needs explicit fat context", () => {
  assert.strictEqual(classify("milk", { fatPercent: 1.5 }, "Milch", "Fettgehalt: 1,5%").status, "confirmed");
  assert.deepStrictEqual(classify("milk", { fatPercent: 1.5 }, "Milch", "Eiweiß 1,5% und 1,5% Zucker").missing, ["fatPercent"]);
  assert.deepStrictEqual(classify("milk", { fatPercent: 1.5 }, "Milch", "1,5% Hafer").missing, ["fatPercent"]);
  assert.deepStrictEqual(classify("milk", { fatPercent: 0.1 }, "Milch 0,1% Laktose").missing, ["fatPercent"]);
  assert.strictEqual(classify("milk", { fatPercent: 1.5 }, "Milch", "Milch 0,1% Laktose, 1,5% Fett").status, "confirmed");
  assert.strictEqual(classify("milk", { fatPercent: 0.1 }, "Milch", "Milch 0,1% Laktose, 1,5% Fett").status, "contradicted");
  assert.deepStrictEqual(classify("milk", { fatPercent: 10 }, "Milch 10% Rabatt").missing, ["fatPercent"]);
});
test("native description can state qualifiers and original evidence survives", () => {
  const text = "Mit Laktose. Ohne Aromen. Fettgehalt: 1,5%.";
  const result = classify("milk", { fatPercent: 1.5, lactose: "contains", flavour: "plain" }, "H-Milch", text);
  assert.strictEqual(result.status, "confirmed"); assert.strictEqual(result.evidence[1].value, text);
  assert.deepStrictEqual(result.evidence[1].matches, ["fatPercent", "lactose", "flavour"]);
});
test("description cannot turn unrelated headline into milk", () => {
  assert.strictEqual(classify("milk", {}, "Kekse", "Zutaten: Milch").status, "unconfirmed");
});
test("family words as ingredients or cosmetics do not confirm a staple", () => {
  for (const name of ["Kaffee mit Milch", "Kaffee mit frischer Milch", "Kaffee mit H-Milch", "Milch & Honig Handcreme", "Kekse mit Milch", "Schokolade aus Milch"])
    assert.strictEqual(classify("milk", {}, name).status, "contradicted");
  for (const name of ["Spaghetti mit Ei", "Sauce mit Ei", "Salat mit Eier", "Duschgel mit Ei"])
    assert.strictEqual(classify("eggs", {}, name).status, "contradicted");
  assert.strictEqual(classify("bread", {}, "Fleischwurst auf Brot").status, "contradicted");
});
test("explicit product family before other ingredients still matches", () => {
  assert.strictEqual(classify("milk", {}, "H-Milch für Kaffee").status, "confirmed");
  assert.strictEqual(classify("bread", {}, "Brot mit Milch").status, "confirmed");
  assert.strictEqual(classify("eggs", {}, "Eier mit Brot").status, "confirmed");
});
test("several purchased families remain ambiguous", () => {
  assert.strictEqual(classify("milk", {}, "Milch und Brot Set").status, "unconfirmed");
});
for (const name of ["Milchreis", "Buttermilch", "Milchdrink mit Vanille", "Milchpulver", "Milchschokolade", "Hafermilch", "Kondensmilch", "Vanillemilch"]) {
  test(`milk family excludes ${name}`, () => assert.strictEqual(classify("milk", {}, name).status, "contradicted"));
}
for (const name of ["Brotbackmischung Vollkornbrot", "Toastbrot", "Vollkorn-Toast", "Brotaufstrich", "Brotchips"]) {
  test(`bread family excludes ${name}`, () => assert.strictEqual(classify("bread", {}, name).status, "contradicted"));
}
for (const name of ["Schokoladen Eier", "Eiernudeln", "Nudeln mit Eier", "Kinder Überraschung Ei", "Eierlikör", "Flüssigei", "Eiersalat"]) {
  test(`egg family excludes ${name}`, () => assert.strictEqual(classify("eggs", {}, name).status, "contradicted"));
}
test("ambiguous headlines remain unconfirmed", () => {
  for (const [family, name] of [["milk", "Bauernprodukt"], ["bread", "Backwaren"], ["eggs", "REWE Respeggt"]])
    assert.strictEqual(classify(family, {}, name).status, "unconfirmed");
});
test("wholegrain rye bread can evidence either qualifier", () => {
  assert.strictEqual(classify("bread", { grain: "wholegrain" }, "Roggenvollkornbrot").status, "confirmed");
  assert.strictEqual(classify("bread", { grain: "rye" }, "Roggenvollkornbrot").status, "confirmed");
  assert.strictEqual(classify("bread", { grain: "wheat" }, "Roggenvollkornbrot").status, "contradicted");
});
test("wholegrain missing does not infer non-wholegrain", () => {
  assert.deepStrictEqual(classify("bread", { grain: "wholegrain" }, "Roggenbrot").missing, ["grain"]);
});
test("grain species mix does not confirm one species", () => {
  assert.strictEqual(classify("bread", { grain: "wheat" }, "Brot mit Weizen und Roggen").status, "contradicted");
});
test("ungeschnitten and nicht geschnitten avoid substring match", () => {
  for (const text of ["Vollkornbrot ungeschnitten", "Vollkornbrot nicht geschnitten"]) {
    assert.strictEqual(classify("bread", { sliced: true }, text).status, "contradicted");
    assert.strictEqual(classify("bread", { sliced: false }, text).status, "confirmed");
  }
});
test("geschnitten and in Scheiben evidence slicing", () => {
  assert.strictEqual(classify("bread", { sliced: true }, "Geschnittenes Vollkornbrot").status, "confirmed");
  assert.strictEqual(classify("bread", { sliced: true }, "Vollkornbrot in Scheiben").status, "confirmed");
});
test("negated grain does not provide affirmative evidence", () => {
  assert.strictEqual(classify("bread", { grain: "wholegrain" }, "Brot kein Vollkornbrot").status, "contradicted");
  assert.strictEqual(classify("bread", { grain: "wheat" }, "Brot ohne Weizen").status, "contradicted");
});
test("trace allergen mention cannot confirm a grain", () => {
  assert.deepStrictEqual(classify("bread", { grain: "wheat" }, "Brot", "Kann Spuren von Weizen enthalten").missing, ["grain"]);
});
test("explicit egg size and raw claims confirm", () => {
  assert.strictEqual(classify("eggs", { size: "M", raw: true }, "Eier Größe: M ungekocht").status, "confirmed");
});
test("cooked and ungekocht avoid substring match", () => {
  assert.strictEqual(classify("eggs", { raw: true }, "Eier ungekocht").status, "confirmed");
  assert.strictEqual(classify("eggs", { raw: false }, "Eier ungekocht").status, "contradicted");
  assert.strictEqual(classify("eggs", { raw: true }, "Eier gekocht").status, "contradicted");
  assert.strictEqual(classify("eggs", { raw: false }, "Eier gekocht").status, "confirmed");
});
test("cooked broad eggs are a prepared variant requiring confirmation", () => {
  assert.strictEqual(classify("eggs", {}, "Gekochte Eier").status, "unconfirmed");
  assert.strictEqual(classify("eggs", {}, "Eier", "Gekocht und gefärbt").status, "unconfirmed");
});
test("fresh eggs do not default to raw", () => assert.deepStrictEqual(classify("eggs", { raw: true }, "Frische Eier").missing, ["raw"]));
test("FH abbreviation is not native positive evidence of husbandry", () => assert.deepStrictEqual(classify("eggs", { husbandry: "free-range" }, "REWE Respeggt Eier FH Größe: M").missing, ["husbandry"]));
test("organic and outdoor claims can coexist", () => {
  assert.strictEqual(classify("eggs", { husbandry: "organic" }, "Bio Eier Freilandhaltung").status, "confirmed");
  assert.strictEqual(classify("eggs", { husbandry: "barn" }, "Bio Eier").status, "contradicted");
  assert.deepStrictEqual(classify("eggs", { husbandry: "free-range" }, "Bio Eier").missing, ["husbandry"]);
});
for (const size of ["S-L", "M-L", "M/L", "M bis L", "M und L", "M, L"]) {
  test(`mixed egg size ${size} cannot confirm M`, () => assert.strictEqual(classify("eggs", { size: "M" }, `Eier Größe: ${size}`).status, "contradicted"));
}
test("two explicit egg sizes conflict", () => assert.strictEqual(classify("eggs", { size: "M" }, "Eier Größe M, Größe L").status, "contradicted"));
test("unknown brand letter is not an egg size", () => assert.deepStrictEqual(classify("eggs", { size: "M" }, "M Budget Eier").missing, ["size"]));
test("parse accepts each exact family schema", () => {
  assert.deepStrictEqual(need("milk", { processing: "fresh", fatPercent: 0, lactose: "free", flavour: "plain" }).constraints, { family: "milk", processing: "fresh", fatPercent: 0, lactose: "free", flavour: "plain" });
  assert.deepStrictEqual(need("bread", { grain: "rye", sliced: false }).constraints, { family: "bread", grain: "rye", sliced: false });
  assert.deepStrictEqual(need("eggs", { size: "XL", husbandry: "organic", raw: false }).constraints, { family: "eggs", size: "XL", husbandry: "organic", raw: false });
});
test("parse rejects wrong family and unknown cross-family keys", () => {
  for (const constraints of [{}, { family: "fish" }, { family: "Milk" }, { family: "milk", raw: true }, { family: "eggs", processing: "fresh" }, { family: "bread", arbitrary: true }])
    throws("invalid-shopping-need-constraints", { search: "Milch", constraints });
});
test("strict constraint types and numeric bounds", () => {
  for (const value of [-1, 10.1, Infinity, NaN, "1.5", null, undefined]) throws("invalid-shopping-need-constraints", { search: "Milch", constraints: { family: "milk", fatPercent: value } });
  for (const value of ["true", 1, null, undefined]) throws("invalid-shopping-need-constraints", { search: "Brot", constraints: { family: "bread", sliced: value } });
  for (const [family, field, value] of [["milk", "processing", "pasteurized"], ["milk", "lactose", "regular"], ["milk", "flavour", "vanilla"], ["bread", "grain", "mixed"], ["eggs", "size", "m"], ["eggs", "husbandry", "FH"]])
    throws("invalid-shopping-need-constraints", { search: "Artikel", constraints: { family, [field]: value } });
});
test("plain objects only and own family required", () => {
  for (const input of [null, [], "Milch", new Date(), { search: "Milch", constraints: { family: "milk" }, pack: "1 l" }]) throws("invalid-shopping-need-input", input);
  for (const constraints of [null, [], new Date(), Object.create({ family: "milk" })]) throws("invalid-shopping-need-constraints", { search: "Milch", constraints });
  const constraints = Object.assign(Object.create(null), { family: "milk" });
  assert.deepStrictEqual(Matcher.parse({ search: "Milch", constraints }).constraints, { family: "milk" });
});
test("search bounds and controls are rejected", () => {
  for (const search of [undefined, null, 123, "a", " a ", "a".repeat(121), "Milch\nBrot", "Milch\u0000"])
    throws("invalid-shopping-need-search", { search, constraints: { family: "milk" } });
  assert.strictEqual(Matcher.parse({ search: "ab", constraints: { family: "milk" } }).search, "ab");
});
test("symbols and unknown top-level keys are rejected", () => {
  throws("invalid-shopping-need-input", { search: "Milch", constraints: { family: "milk" }, [Symbol("extra")]: true });
  throws("invalid-shopping-need-constraints", { search: "Milch", constraints: { family: "milk", [Symbol("extra")]: true } });
});
test("search and explicit constraints must agree", () => {
  for (const input of [
    { search: "H-Milch 1,5%", constraints: { family: "milk", processing: "fresh" } },
    { search: "Milch 1,5%", constraints: { family: "milk", fatPercent: 3.5 } },
    { search: "Milch nicht laktosefrei", constraints: { family: "milk", lactose: "free" } },
    { search: "Brot ungeschnitten", constraints: { family: "bread", sliced: true } },
    { search: "Eier ungekocht", constraints: { family: "eggs", raw: false } },
    { search: "Eier M", constraints: { family: "eggs", size: "L" } },
    { search: "Brot", constraints: { family: "milk" } },
    { search: "Buttermilch", constraints: { family: "milk" } },
    { search: "keine Milch", constraints: { family: "milk" } }
  ]) throws("invalid-shopping-need-conflict", input);
});
test("ambiguous or unsupported explicit query qualifiers fail safely", () => {
  for (const [family, search] of [["milk", "Milch 1,5% oder 3,5%"], ["milk", "Milch 25%"], ["milk", "Milch Vanille"], ["milk", "nicht H-Milch"], ["eggs", "Eier Größe S-L"], ["eggs", "Eier Größe M, Größe L"], ["bread", "Roggenvollkornbrot"]])
    throws("invalid-shopping-need-conflict", { search, constraints: { family } });
});
test("parse and classify never mutate caller input or previous results", () => {
  const input = Object.freeze({ search: "H-Milch 1,5%", constraints: Object.freeze({ family: "milk", lactose: "contains" }) });
  const parsed = Matcher.parse(input), product = Object.freeze({ name: "H-Milch 1,5% nicht laktosefrei" });
  assert.strictEqual(Matcher.classify(parsed, product).status, "confirmed");
  parsed.constraints.lactose = "free";
  assert.strictEqual(input.constraints.lactose, "contains");
  const first = Matcher.classify(need("milk"), product); first.evidence[0].matches.push("fake");
  assert.deepStrictEqual(Matcher.classify(need("milk"), product).evidence[0].matches, ["family"]);
});
test("invalid native evidence throws without inventing a result", () => {
  for (const product of [null, [], { name: "" }, { name: 10 }, { name: "Milch", description: null }, { name: "a".repeat(1001) }, { name: "Milch", description: "a".repeat(8001) }])
    assert.throws(() => Matcher.classify(need("milk"), product), error => error.code === "invalid-shopping-need-evidence");
});

test("family must be a string even when another value coerces to a supported key", () => {
  for (const family of [["milk"], ["bread"], ["eggs"], new String("milk"), { toString: () => "milk" }])
    throws("invalid-shopping-need-constraints", { search: "Milch", constraints: { family } });
});

test("postposed fresh processing survives query parsing", () => {
  const parsed = need("milk", {}, "Milch frisch");
  assert.strictEqual(parsed.constraints.processing, "fresh");
  assert.strictEqual(Matcher.classify(parsed, { name: "H-Milch 1,5%" }).status, "contradicted");
});

test("fresh processing applies to an explicitly qualified milk headline", () => {
  const parsed = need("milk", {}, "Frische Weidemilch");
  assert.strictEqual(parsed.constraints.processing, "fresh");
  assert.strictEqual(Matcher.classify(parsed, { name: "H-Milch" }).status, "contradicted");
  assert.strictEqual(classify("milk", { processing: "uht" }, "Frische fettarme Milch").status, "contradicted");
});

test("qualitative query fat requests fail closed without an invented percentage", () => {
  for (const search of ["fettarme Milch", "frische fettarme Milch", "Milch fettarm", "fettreduzierte Milch", "Magermilch", "Vollmilch"])
    throws("invalid-shopping-need-conflict", { search, constraints: { family: "milk" } });
});

test("an explicit numeric constraint cannot erase an unsupported qualitative fat query", () => {
  throws("invalid-shopping-need-conflict", { search: "frische fettarme Milch", constraints: { family: "milk", fatPercent: 3.5 } });
});

test("native qualitative fat words do not manufacture a numeric fat claim", () => {
  for (const name of ["Fettarme Milch", "Milch fettarm", "Magermilch", "Vollmilch"])
    assert.deepStrictEqual(classify("milk", { fatPercent: 1.5 }, name).missing, ["fatPercent"]);
});

test("unsupported ESL and pasteurisation query qualifiers are not silently discarded", () => {
  for (const search of ["Milch ESL", "ESL Milch", "Milch pasteurisiert"])
    throws("invalid-shopping-need-conflict", { search, constraints: { family: "milk" } });
});

test("unsupported native ESL processing cannot confirm UHT", () => {
  assert.notStrictEqual(classify("milk", { processing: "uht" }, "Milch ESL").status, "confirmed");
});

test("Gewichtsklasse is an explicit egg size in queries and native evidence", () => {
  const parsed = need("eggs", {}, "Eier Gewichtsklasse M");
  assert.strictEqual(parsed.constraints.size, "M");
  assert.strictEqual(Matcher.classify(parsed, { name: "Eier Größe L" }).status, "contradicted");
  assert.strictEqual(classify("eggs", { size: "M" }, "Eier Gewichtsklasse M").status, "confirmed");
});

test("a negated egg size after its label fails closed in the query", () => {
  for (const search of ["Eier Größe: nicht M", "Eier Gewichtsklasse: nicht M"])
    throws("invalid-shopping-need-conflict", { search, constraints: { family: "eggs" } });
});

test("a native negated egg size cannot confirm that size", () => {
  for (const name of ["Eier Größe: nicht M", "Eier Gewichtsklasse: nicht M"])
    assert.strictEqual(classify("eggs", { size: "M" }, name).status, "contradicted");
});

test("one trailing percent sign does not turn a range into its upper endpoint", () => {
  for (const search of ["Milch 1,5-3,5%", "Milch 1,5 bis 3,5% Fett", "Milch 1,5 oder 3,5% Fett"])
    throws("invalid-shopping-need-conflict", { search, constraints: { family: "milk" } });
});

test("native fat ranges remain ambiguous for an exact percentage", () => {
  for (const text of ["1,5-3,5%", "1,5 bis 3,5%", "1,5 oder 3,5%"])
    for (const fatPercent of [1.5, 3.5]) {
      assert.notStrictEqual(classify("milk", { fatPercent }, `Milch ${text}`).status, "confirmed");
      assert.notStrictEqual(classify("milk", { fatPercent }, "Milch", `Fettgehalt: ${text}`).status, "confirmed");
    }
});

test("query negation connectors do not become affirmative grain requirements", () => {
  for (const search of ["Brot nicht aus Vollkorn", "Brot frei von Vollkorn"])
    throws("invalid-shopping-need-conflict", { search, constraints: { family: "bread" } });
});

test("native negation connectors contradict the named wholegrain claim", () => {
  for (const description of ["Nicht aus Vollkorn hergestellt", "Frei von Vollkorn"])
    assert.strictEqual(classify("bread", { grain: "wholegrain" }, "Brot", description).status, "contradicted");
});

test("native slicing negation through in cannot confirm sliced bread", () => {
  assert.strictEqual(classify("bread", { sliced: true }, "Brot nicht in Scheiben").status, "contradicted");
  assert.strictEqual(classify("bread", { sliced: false }, "Brot nicht in Scheiben").status, "confirmed");
});

test("a wholegrain ingredient percentage is not a wholegrain product claim", () => {
  const result = classify("bread", { grain: "wholegrain" }, "Brot", "Zutaten: Weizenmehl, 1% Vollkornmehl");
  assert.strictEqual(result.status, "unconfirmed");
  assert(result.missing.includes("grain"));
});

test("wholegrain flour in a non-wholegrain headline does not qualify the product", () => {
  const result = classify("bread", { grain: "wholegrain" }, "Weißbrot mit Vollkornmehl");
  assert.strictEqual(result.status, "unconfirmed");
  assert(result.missing.includes("grain"));
});

test("an explicit wholegrain bread description still supplies product evidence", () => {
  assert.strictEqual(classify("bread", { grain: "wholegrain" }, "Brot", "Vollkornbrot, geschnitten").status, "confirmed");
});

test("description self-identification can contradict a broad milk headline", () => {
  for (const description of ["Pflanzlicher Haferdrink", "Milchmischgetränk mit Vanille"])
    assert.strictEqual(classify("milk", {}, "Milch", description).status, "contradicted");
});

test("description self-identification can contradict broad bread and egg headlines", () => {
  assert.strictEqual(classify("bread", {}, "Brot", "Brotbackmischung").status, "contradicted");
  assert.strictEqual(classify("eggs", {}, "Eier", "Schokoladen Eier").status, "contradicted");
});

test("recipe suggestions do not turn real milk into the suggested product", () => {
  for (const description of ["Zum Kochen von Milchreis geeignet.", "Für Pudding und Kakao.", "Rezept: Milchreis mit Milch zubereiten."])
    assert.strictEqual(classify("milk", {}, "H-Milch 1,5%", description).status, "confirmed");
});

test("ingredient and usage references do not replace bread or egg identity", () => {
  assert.strictEqual(classify("bread", {}, "Brot", "Zutaten: Weizenmehl, Milch, Hefe.").status, "confirmed");
  assert.strictEqual(classify("bread", {}, "Brot", "Für Sandwiches und als Brotchips geeignet.").status, "confirmed");
  assert.strictEqual(classify("eggs", {}, "Eier", "Für Eiernudeln und Eiersalat geeignet.").status, "confirmed");
});

test("lactose-free query phrases survive both supported spellings", () => {
  for (const qualifier of ["frei von Laktose", "frei von Lactose", "ohne Laktose", "ohne Lactose"] ) {
    const parsed = need("milk", {}, `Milch ${qualifier}`);
    assert.strictEqual(parsed.constraints.lactose, "free");
    assert.strictEqual(Matcher.classify(parsed, { name: "Milch mit Laktose" }).status, "contradicted");
    assert.strictEqual(classify("milk", { lactose: "free" }, `Milch ${qualifier}`).status, "confirmed");
  }
});

test("lactose-containing evidence survives both supported spellings", () => {
  for (const qualifier of ["mit Laktose", "mit Lactose", "laktosehaltig", "lactosehaltig"] ) {
    assert.strictEqual(need("milk", {}, `Milch ${qualifier}`).constraints.lactose, "contains");
    assert.strictEqual(classify("milk", { lactose: "free" }, `Milch ${qualifier}`).status, "contradicted");
  }
});

test("articles and labels retain an excluded description product type", () => {
  for (const description of ["Ein pflanzlicher Haferdrink.", "Produktbeschreibung: Ein Milchmischgetränk mit Vanille.", "Pflanzlicher Bio-Haferdrink.", "Verkehrsbezeichnung: Ein pflanzlicher Bio-Haferdrink."])
    assert.strictEqual(classify("milk", {}, "Milch", description).status, "contradicted");
  assert.strictEqual(classify("bread", {}, "Brot", "Eine Brotbackmischung.").status, "contradicted");
  assert.strictEqual(classify("eggs", {}, "Eier", "Die Schokoladen Eier.").status, "contradicted");
});

test("recipe and usage descriptions cannot supply missing fresh processing", () => {
  for (const description of ["Rezept: Frische Milch zum Backen verwenden.", "Zum Backen frische Milch verwenden.", "Verwendung: Frische Milch für das Rezept."] ) {
    const result = classify("milk", { processing: "fresh" }, "Milch", description);
    assert.strictEqual(result.status, "unconfirmed");
    assert(result.missing.includes("processing"));
  }
});

test("recipe and usage descriptions cannot supply missing bread or egg attributes", () => {
  const bread = classify("bread", { grain: "wholegrain", sliced: true }, "Brot", "Rezept: Vollkornbrot geschnitten verwenden.");
  assert.strictEqual(bread.status, "unconfirmed");
  assert.deepStrictEqual(bread.missing, ["grain", "sliced"]);
  const eggs = classify("eggs", { size: "M", husbandry: "organic", raw: true }, "Eier", "Für das Rezept Bio Eier Größe M roh verwenden.");
  assert.strictEqual(eggs.status, "unconfirmed");
  assert.deepStrictEqual(eggs.missing, ["size", "husbandry", "raw"]);
});

test("native product claims remain separate from a later recipe clause", () => {
  assert.strictEqual(classify("milk", { processing: "fresh" }, "Milch", "Frische Milch. Rezept: H-Milch zum Backen verwenden.").status, "confirmed");
  assert.strictEqual(classify("bread", { grain: "wholegrain", sliced: true }, "Brot", "Vollkornbrot, geschnitten. Verwendung: Weißbrot ungeschnitten zum Rezept.").status, "confirmed");
  assert.strictEqual(classify("eggs", { size: "M", raw: true }, "Eier", "Eier Größe M roh. Rezept: Eier Größe L gekocht verwenden.").status, "confirmed");
});

test("native decimal fat evidence survives sentence splitting before a recipe", () => {
  const text = "H-Milch, 1.500% Fett. Rezept: Frische Milch 3,5% zum Backen verwenden.";
  assert.strictEqual(classify("milk", { processing: "uht", fatPercent: 1.5 }, "Milch", text).status, "confirmed");
});

test("negative and large percentages are rejected without truncating their numeric token", () => {
  for (const value of ["-1,5", "−1,5", "100,5", "101.5", "999999999999999999999"])
    throws("invalid-shopping-need-conflict", { search: `Milch ${value}%`, constraints: { family: "milk" } });
});

test("full decimal precision and an explicit positive sign preserve the exact percentage", () => {
  for (const value of ["1,500", "1.500", "+1,500"] )
    assert.deepStrictEqual(need("milk", {}, `Milch ${value}%`).constraints, { family: "milk", fatPercent: 1.5 });
  assert.strictEqual(need("milk", {}, "Milch 1,501%").constraints.fatPercent, 1.501);
  throws("invalid-shopping-need-conflict", { search: "Milch 1,501%", constraints: { family: "milk", fatPercent: 1.5 } });
});

test("native full-precision percentages are exact and malformed values cannot confirm", () => {
  assert.strictEqual(classify("milk", { fatPercent: 1.5 }, "Milch 1,500%").status, "confirmed");
  assert.strictEqual(classify("milk", { fatPercent: 1.5 }, "Milch 1,501%").status, "contradicted");
  for (const [name, fatPercent] of [["Milch -1,5%", 1.5], ["Milch 100,5%", 5]])
    assert.notStrictEqual(classify("milk", { fatPercent }, name).status, "confirmed");
});

test("symbolic percentage inequalities and approximations fail closed in queries", () => {
  for (const prefix of ["<", ">", "<=", ">=", "≤", "≥", "~", "≈"] )
    throws("invalid-shopping-need-conflict", { search: `Milch ${prefix}1,5%`, constraints: { family: "milk" } });
});

test("native symbolic inequalities cannot establish an exact percentage", () => {
  for (const prefix of ["<", ">", "<=", ">=", "≤", "≥", "~", "≈"] ) {
    assert.notStrictEqual(classify("milk", { fatPercent: 1.5 }, `Milch ${prefix}1,5%`).status, "confirmed");
    assert.notStrictEqual(classify("milk", { fatPercent: 1.5 }, "Milch", `Fettgehalt: ${prefix}1,5% Fett`).status, "confirmed");
  }
});

test("malformed query percentage runs cannot silently erase the requested qualifier", () => {
  for (const search of ["Milch 1,5,0%", "Milch 1..5%", "Milch %"])
    throws("invalid-shopping-need-conflict", { search, constraints: { family: "milk" } });
});

test("a malformed native percentage alongside an exact claim cannot confirm that claim", () => {
  for (const malformed of ["1,5,0%", "1..5%"] ) {
    assert.notStrictEqual(classify("milk", { fatPercent: 1.5 }, `Milch 1,5% und ${malformed}`).status, "confirmed");
    assert.notStrictEqual(classify("milk", { fatPercent: 1.5 }, "Milch", `Fettgehalt: 1,5% und ${malformed} Fett`).status, "confirmed");
  }
});

console.log(`shopping need matcher: ${count} passed`);
