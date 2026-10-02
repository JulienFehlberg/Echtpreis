(function(root){
"use strict";

// Semantic evidence only. Product identity, pack, source and price remain the
// inventory caller's responsibility, and a confirmed need still needs a choice.
const FIELDS = Object.freeze({
  milk: { processing: ["uht", "fresh"], fatPercent: "number", lactose: ["free", "contains"], flavour: ["plain"] },
  bread: { grain: ["wholegrain", "rye", "wheat"], sliced: "boolean" },
  eggs: { size: ["S", "M", "L", "XL"], husbandry: ["barn", "free-range", "organic"], raw: "boolean" },
  butter: { salt: ["salted", "unsalted"] }
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function ownKeys(value) { return Reflect.ownKeys(value); }
function normalized(text) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss")
    .replace(/[–—−]/g, "-");
}
// Whole native product tokens identify toiletries/cleaners. Do not exclude
// generic "creme", "body" or "milk": those also occur in food or brand names.
const NON_FOOD_TOKEN = "(?:[a-z]*(?:handcreme|bodycreme|korpercreme|lotion|duschgel|duschcreme|shampoo|seifen?|waschmittel|spulmittel|reinigungsmittel|gesichtsmaske|hautpflege|cremebad(?:er)?|cremedusche)|[a-z]*(?:reinigungs|abschmink|sonnen|scheuer|pflege|korper|body|dusch)-?(?:milch|milk)|kerze|spielzeug|dekoration|kostum|brotdose|eierbecher)";
const NON_FOOD_HEADLINE = new RegExp("\\b" + NON_FOOD_TOKEN + "\\b");
const NON_FOOD_DESCRIPTION_START = new RegExp("^" + NON_FOOD_TOKEN + "\\b");
function negated(text, index) {
  return /\b(?:nicht|kein(?:e|en|em|er|es)?|ohne|frei von)\s+(?:(?:besonders|extra|mehr|auch|aus|von|mit)\s+){0,2}$/.test(text.slice(0, index));
}
function familyEvidence(text, family) {
  const t = normalized(text);
  if (NON_FOOD_HEADLINE.test(t)) return "contradicted";
  const excluded = {
    milk: /\b(?:buttermilch|milchreis|milchdrink\w*|milchmisch\w*|milchschokolad\w*|milchpulver|milchshake|kondensmilch|sauermilch|dickmilch|kefir|joghurt|quark|pudding|kakao|cappuccino|latte|hafermilch|sojamilch|mandelmilch|kokosmilch|reismilch|vanillemilch|schokomilch|erdbeermilch|bananenmilch|pflanzendrink|babymilch|milchnahrung|anfangsmilch|folgemilch|sauglingsmilch)\b|\b(?:hafer|soja|mandel|kokos|reis)[ -]?(?:milch|drink)\b|\b(?:vegan|pflanzlich)\w*\b/,
    bread: /\b\w*(?:backmischung|brotmischung|brotaufstrich|brotchips|brotcroutons|toast\w*|sandwich|paniermehl|semmelbrosel|pizzabrot)\b/,
    eggs: /\b(?:schoko\w*|schokolad\w*|marzipan\w*|uberraschungs?ei\w*|eierlikor|eiernudel\w*|eiersalat|eierteig\w*|nudeln?|pasta|spaghetti|spatzle|sauce|sosse|salat|quiche|omelett|ruhrei|eipulver|eierpulver|flussigei\w*|eiweiss\w*|eigelb\w*)\b|\bkinder\b.*\b(?:ei|eier|uberraschung)\b/,
    butter: /\b\w*(?:buttermilch|butterschmalz|butterreinfett|butterkeks\w*|buttergeback\w*|buttertoast\w*|butterbrotpapier|buttergemuse\w*|buttercroissant\w*|buttersosse\w*|buttersauce\w*)\b|\b(?:erdnuss|peanut|nuss|mandel|cashew|kokos|kakao|shea)[ -]?butter\b|\b(?:streichfett\w*|streichmisch\w*|mischfett\w*|margarine|ghee|butteralternative\w*|butterersatz\w*|vegan\w*|pflanzlich\w*|aroma\w*|keks\w*|cookies?|\w*geback\w*|toast\w*|brot|croissant\w*|hefeteig|blatterteig|sauce|sosse|chicken|fertiggericht\w*|gemuse|tiefkuhlgemuse)\b|\b(?:raps|pflanzen|oliven|sonnenblumen)(?:ol|oel)\b|\b(?:krauter|knoblauch|gewurz|truffel|zitrone)[ -]?butter\b|\bbutter\s+(?:mit\s+)?(?:krautern?|knoblauch|gewurzen?|truffeln?|zitrone)\b/
  };
  if (excluded[family].test(t)) return "contradicted";
  const positive = {
    milk: /\b(?:voll|frisch|weide|roh|ziegen|schafs|heu|mager)?milch\b/,
    bread: /\b[a-z]*brot\b|\bpumpernickel\b/,
    eggs: /\b(?:bio|freiland|huhner|bodenhaltungs|oster)?eier\b|\bei\b/,
    butter: /\b[a-z]*butter\b/
  };
  function ingredient(match) {
    return /\b(?:mit|aus|auf|ohne|enth[a-z]*lt|plus|with|contains)\s+(?:[a-z]+[ -]){0,3}$/.test(t.slice(0, match.index));
  }
  const match = positive[family].exec(t);
  const otherFamily = Object.keys(positive).some(other => {
    if (other === family) return false;
    const otherMatch = positive[other].exec(t);
    return otherMatch && !negated(t, otherMatch.index) && !ingredient(otherMatch);
  });
  if (match && ingredient(match)) return "contradicted";
  if (match && negated(t, match.index)) return "contradicted";
  if (match && !negated(t, match.index)) return otherFamily ? "unconfirmed" : "confirmed";
  return otherFamily ? "contradicted" : "unconfirmed";
}

function descriptionExcludesFamily(text, family) {
  // Only an initial self-description may contradict the headline's family.
  // Recipes, allergen notices and ingredient lists are not product identities.
  const t = normalized(text).trim().replace(/^(?:produktbeschreibung|produktart|verkehrsbezeichnung|bezeichnung|dieses produkt ist|das produkt ist|es ist|dies ist)(?:\s*:\s*|\s+)/, "")
    .replace(/^(?:ein|eine|einer|eines|der|die|das)\s+/, "").replace(/\bbio[ -](?=(?:hafer|soja|mandel|kokos|reis)(?:milch|drink)\b)/g, "");
  const types = {
    milk: /^(?:(?:pflanzlich|vegan|flavoured|aromatisiert)[a-z]*\s+)?(?:buttermilch|milchreis|milchdrink[a-z]*|milchmisch[a-z]*|milchschokolad[a-z]*|milchpulver|milchshake|kondensmilch|sauermilch|dickmilch|kefir|joghurt|quark|pudding|kakao|cappuccino|latte|hafermilch|sojamilch|mandelmilch|kokosmilch|reismilch|vanillemilch|schokomilch|erdbeermilch|bananenmilch|pflanzendrink|babymilch|milchnahrung|anfangsmilch|folgemilch|sauglingsmilch|(?:hafer|soja|mandel|kokos|reis)[ -]?(?:milch|drink)|brot|eier)\b|^(?:pflanzlich|vegan)[a-z]*\s+(?:[a-z]+[ -]){0,2}(?:milch|drink|alternative)\b/,
    bread: /^(?:[a-z]*backmischung|[a-z]*brotmischung|brotaufstrich|brotchips|brotcroutons|toast[a-z]*|sandwich|paniermehl|semmelbrosel|pizzabrot|milch|eier)\b/,
    eggs: /^(?:(?:flussig|pasteurisiert)[a-z]*\s+)?(?:schoko[a-z]*|schokolad[a-z]*|marzipan[a-z]*|uberraschungs?ei[a-z]*|eierlikor|eiernudel[a-z]*|eiersalat|eierteig[a-z]*|nudeln?|pasta|spaghetti|spatzle|sauce|sosse|salat|quiche|omelett|ruhrei|eipulver|eierpulver|flussigei[a-z]*|eiweiss[a-z]*|eigelb[a-z]*|milch|brot)\b/,
    butter: /^(?:(?:vegan|pflanzlich|streichfahig)[a-z]*\s+)?(?:streichfett[a-z]*|streichmisch[a-z]*|mischfett[a-z]*|margarine|ghee|butteralternative[a-z]*|butterersatz[a-z]*|butterschmalz|butterreinfett|buttermilch|(?:erdnuss|peanut|nuss|mandel|cashew|kokos|kakao|shea)[ -]?butter|(?:krauter|knoblauch|gewurz|truffel|zitrone)[ -]?butter|aroma[a-z]*|butter[ -]vanille|buttergemuse|buttersosse[a-z]*|buttersauce[a-z]*|butter[ -]chicken|butter[ -]toast[a-z]*|buttergeback[a-z]*|butterkeks[a-z]*|milch|brot|eier)\b/
  };
  if (family === "butter") {
    // A named product's initial self-description can disclose a blend. A later
    // recipe, ingredient list or suggestion must not replace its identity.
    const first = t.split(/[.!?\n;]/, 1)[0];
    if (!/^(?:rezept|zubereitung|serviervorschlag|verwendung|zutaten|fur|zum|ideal fur|geeignet fur)\b/.test(first)
        && /^(?:.{1,100}\s+ist\s+)?(?:(?:eine|unsere|herrliche|feine|streichfahige|leckere)\s+){0,4}mischung\s+aus\b/.test(first)
        && /\bbutter\b/.test(first) && /\b(?:raps|pflanzen|oliven|sonnenblumen)(?:ol|oel)\b/.test(first)) return true;
  }
  return types[family].test(t) || NON_FOOD_DESCRIPTION_START.test(t);
}

function observations(text, family, description = false) {
  const values = new Map();
  // Suggested recipes and usage instructions describe a different purchase.
  // Split at sentence boundaries without splitting decimal percentages.
  const t = normalized(description ? text.split(/(?<!\d)[.!?]|\.(?!\d)|[\n;]/).filter(part =>
    !/^(?:rezept|zubereitung|serviervorschlag|verwendung|zutaten fur|fur|zum|ideal fur|geeignet fur|kann fur|kann als)\b/.test(normalized(part).trim())).join("; ") : text);
  function add(field, value) {
    if (!values.has(field)) values.set(field, []);
    if (!values.get(field).includes(value)) values.get(field).push(value);
  }
  function scan(field, expression, value, negative = `not:${value}`) {
    for (const match of t.matchAll(expression)) {
      if (/\b(?:spuren von|spuren an|eventuell|moglicherweise)\s*$/.test(t.slice(0, match.index))) continue;
      add(field, negated(t, match.index) ? negative : value);
    }
  }
  if (family === "milk") {
    scan("processing", /\b(?:h[ -]+(?:voll)?milch|uht|ultrahocherhitzt(?:e|er|es|en)?|haltbare?(?:r|s|n)? (?:[a-z]+[ -]){0,3}(?:voll)?milch)\b/g, "uht");
    scan("processing", /\b(?:frisch[ -]*milch|frische(?:r|s|n)? (?:[a-z]+[ -]){0,3}(?:voll|weide|mager|heu|ziegen|schafs)?milch|milch\s+frisch(?:e|er|es|en)?)\b/g, "fresh");
    // ESL is a separate processing claim; never silently collapse it into fresh.
    scan("processing", /\b(?:esl|extended shelf life)\b/g, "esl");
    scan("processing", /\bpasteurisiert(?:e|er|es|en)?\b/g, "pasteurized");
    for (const token of t.matchAll(/[+-]?\d[\d.,]*\s*%/g)) {
      if (!/^[+-]?\d+(?:[.,]\d+)?\s*%$/.test(token[0])) add("fatPercent", "malformed-percentage");
    }
    for (const match of t.matchAll(/(?<![\d.,])([+-]?\d+(?:[.,]\d+)?)\s*%/g)) {
      // A stated protein or ingredient proportion is not a fat claim.
      if (/^\s*(?:eiweiss|protein|kakao|zucker|laktose|lactose|hafer|soja|mandel|kokos|reis|frucht|rabatt)\b/.test(t.slice(match.index + match[0].length))) continue;
      if (/\b(?:eiweiss|protein|kakao|zucker|laktose|lactose|hafer|soja|mandel|kokos|reis|frucht|rabatt)\s*:?\s*$/.test(t.slice(0, match.index))) continue;
      if (description && !/\b(?:fett(?:gehalt|arm)?|milch)\s*:?\s*$/.test(t.slice(0, match.index))
          && !/^\s*fett\b/.test(t.slice(match.index + match[0].length))) continue;
      const amount = Number(match[1].replace(",", "."));
      const before = t.slice(0, match.index), after = t.slice(match.index + match[0].length);
      const interval = /\d(?:[.,]\d+)?\s*%?\s*(?:-|\/|bis|und|oder|\.\.)\s*$/.test(before)
        || /^\s*(?:-|\/|bis|und|oder|\.\.)\s*\d/.test(after)
        || /[<>=≤≥~≈]\s*$/.test(before)
        || /\b(?:unter|uber|weniger als|mehr als|mindestens|maximal|bis zu|ca\.?|circa|etwa)\s*$/.test(before);
      add("fatPercent", interval ? "ambiguous-percentage" : negated(t, match.index) ? `not:${amount}` : amount);
    }
    scan("lactose", /\b(?:laktosefrei(?:e|er|es|en)?|lactosefrei(?:e|er|es|en)?|(?:ohne|frei von) (?:laktose|lactose))\b/g, "free", "contains");
    scan("lactose", /\b(?:laktosehaltig(?:e|er|es|en)?|lactosehaltig(?:e|er|es|en)?|mit (?:laktose|lactose))\b/g, "contains", "free");
    scan("flavour", /\b(?:ohne (?:aroma|aromen|geschmackszusatz(?:e)?)|unaromatisiert(?:e|er|es|en)?)\b/g, "plain");
    scan("flavour", /\bmilch (?:natur|naturell)\b/g, "plain");
    scan("flavour", /\b(?:vanille|schoko(?:lade)?|erdbeer(?:e)?|banane|aromatisiert(?:e|er|es|en)?)\b/g, "flavoured", "not:flavoured");
  } else if (family === "bread") {
    // Ingredient flour does not establish that the purchased bread is wholegrain.
    for (const match of t.matchAll(/\b(?:[a-z]*vollkornbrot|vollkorn(?:e|er|es|en)?(?:[ -]brot)?)\b/g)) {
      const before = t.slice(0, match.index);
      if (negated(t, match.index)) add("grain", "not:wholegrain");
      else if (!/\b(?:mit|aus|zutaten|enthalt|enth[a-z]*lt|anteil|spuren von)\s*:?\s*$/.test(before)
        && !/\d\s*%\s*$/.test(before) && !(description && /\bzutaten\s*:/.test(before))) add("grain", "wholegrain");
    }
    scan("grain", /\broggen(?:brot|mischbrot|vollkornbrot|mehl)?\b/g, "rye");
    scan("grain", /\bweizen(?:brot|mischbrot|vollkornbrot|mehl)?\b/g, "wheat");
    scan("grain", /\bweizenfrei(?:e|er|es|en)?\b/g, "not:wheat", "wheat");
    scan("grain", /\broggenfrei(?:e|er|es|en)?\b/g, "not:rye", "rye");
    scan("sliced", /\bungeschnitten(?:e|er|es|en)?\b/g, false, true);
    scan("sliced", /\b(?:geschnitten(?:e|er|es|en)?|in scheiben)\b/g, true, false);
  } else if (family === "eggs") {
    scan("husbandry", /\bbodenhaltung\b/g, "barn");
    scan("husbandry", /\bfreiland(?:haltung|eier)?\b/g, "free-range");
    scan("husbandry", /\b(?:bio(?:[ -]eier)?|okologisch(?:e|er|es|en)?)\b/g, "organic");
    scan("raw", /\b(?:ungekocht(?:e|er|es|en)?|roh(?:e|er|es|en)?)\b/g, true, false);
    scan("raw", /\b(?:hart[ -]?)?gekocht(?:e|er|es|en)?\b/g, false, true);
    const sizePatterns = [
      /\b(?:grosse|grossen|size|klasse|gewichtsklasse)\s*:?\s*((?:(?:nicht|kein(?:e|en|em|er|es)?)\s+)?(?:xl|[sml])(?:\s*(?:[-/,]|bis|und|oder)\s*(?:xl|[sml]))*)\b/g,
      /\beier\s+((?:xl|[sml])(?:\s*(?:[-/,]|bis|und|oder)\s*(?:xl|[sml]))*)\b/g,
      /\b((?:xl|[sml])(?:\s*(?:[-/,]|bis|und|oder)\s*(?:xl|[sml]))*)\s+eier\b/g
    ];
    for (const expression of sizePatterns) for (const match of t.matchAll(expression)) {
      const prefix = /^(?:nicht|kein(?:e|en|em|er|es)?)\s+/.exec(match[1]);
      const size = match[1].replace(/^(?:nicht|kein(?:e|en|em|er|es)?)\s+/, "").replace(/\s/g, "").toUpperCase();
      add("size", prefix || negated(t, match.index) ? `not:${size}` : size);
    }
  } else if (family === "butter") {
    // Only explicit product salt claims are supported; neither fat percentage,
    // brand, "mild" nor a recipe's salted ingredient establishes this variant.
    const saltText = description ? t.split(/\b(?:zutaten|ingredients)\s*:/, 1)[0].split(/;|\n/).filter(part => {
      const claim = part.trim().replace(/^(?:produktbeschreibung|produktart|verkehrsbezeichnung|bezeichnung)\s*:\s*/, "");
      // Only a self-stated variant may supply description evidence. Serving
      // prose is not a product claim even if it names the offered butter.
      if (/\b(?:ideal|geeignet|rezept|servier\w*|verwend\w*|zubereit\w*|wurzen|verfeinern|mischen|anrichten|bestreichen|hinzufugen|fur|zum|zu)\b/.test(claim)) return false;
      return /^(?:(?:(?:die|diese|unsere|eine)\s+)?(?:[a-z]*butter)(?:\s+ist)?\s*[,:-]?\s+)?(?:(?:nicht|kein(?:e|en|em|er|es)?)\s+)?(?:ungesalzen(?:e|er|es|en)?|salzfrei(?:e|er|es|en)?|gesalzen(?:e|er|es|en)?|(?:ohne|frei von|mit) (?:meer|speise)?salz|meersalz)\b/.test(claim);
    }).join("; ") : t;
    for (const [expression, value, negative] of [
      [/\b(?:ungesalzen|salzfrei)(?:e|er|es|en)?\b/g, "unsalted", "salted"],
      [/\b(?:ohne|frei von) salz\b/g, "unsalted", "salted"],
      [/\bgesalzen(?:e|er|es|en)?\b/g, "salted", "unsalted"],
      [/\bmit salz\b/g, "salted", "unsalted"],
      [/\b(?:meer|speise)salz(?:kornern?|koernern?)?\b/g, "salted", null]
    ]) for (const match of saltText.matchAll(expression)) {
      if (/\b(?:spuren von|spuren an|eventuell|moglicherweise)\s*$/.test(saltText.slice(0, match.index))) continue;
      const isNegative = negated(saltText, match.index);
      if (isNegative && negative === null) continue; // No sea salt does not prove no salt.
      add("salt", isNegative ? negative : value);
    }
  }
  return values;
}

function validateConstraints(constraints) {
  if (!plain(constraints) || !Object.hasOwn(constraints, "family") || typeof constraints.family !== "string" || !Object.hasOwn(FIELDS, constraints.family))
    fail("invalid-shopping-need-constraints", "A supported family is required");
  const family = constraints.family, allowed = FIELDS[family], output = { family };
  for (const key of ownKeys(constraints)) {
    if (key === "family") continue;
    if (typeof key !== "string" || !Object.hasOwn(allowed, key)) fail("invalid-shopping-need-constraints", "Unknown or cross-family constraint");
    const value = constraints[key], rule = allowed[key];
    if (rule === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10)
        fail("invalid-shopping-need-constraints", "fatPercent must be a finite number between 0 and 10");
    } else if (rule === "boolean") {
      if (typeof value !== "boolean") fail("invalid-shopping-need-constraints", `${key} must be boolean`);
    } else if (!rule.includes(value)) fail("invalid-shopping-need-constraints", `Unsupported ${key}`);
    output[key] = value;
  }
  return output;
}

function parse(input) {
  if (!plain(input) || ownKeys(input).some(key => key !== "search" && key !== "constraints"))
    fail("invalid-shopping-need-input", "Expected search and constraints only");
  if (typeof input.search !== "string" || input.search.length > 120 || input.search.trim().length < 2
      || /[\u0000-\u001f\u007f]/.test(input.search))
    fail("invalid-shopping-need-search", "Search must contain 2 to 120 printable characters");
  const search = input.search.trim(), constraints = validateConstraints(input.constraints), family = constraints.family;
  if (familyEvidence(search, family) === "contradicted") fail("invalid-shopping-need-conflict", "Search conflicts with the requested family");
  if (family === "milk" && /\b(?:fettarm\w*|fettreduziert\w*|vollmilch|magermilch|entrahmt\w*|fettfrei\w*|light)\b/.test(normalized(search)))
    fail("invalid-shopping-need-conflict", "Qualitative fat labels need a supported explicit formulation; no exact fat percentage is inferred");
  if (family === "butter" && /\b(?:pur|rein(?:e|er|es|en)?|salzarm\w*|salzreduziert\w*|fettarm\w*|fettreduziert\w*|fettfrei\w*|light|laktosefrei\w*|lactosefrei\w*|ohne zusatz\w*)\b|\b(?:ohne|frei von|nicht(?: mit)?) (?:meer|speise)salz\b/.test(normalized(search)))
    fail("invalid-shopping-need-conflict", "Butter composition, fat and reduced-salt claims are not supported constraints");
  const features = observations(search, family);
  if (search.includes("%") && (family !== "milk" || !features.has("fatPercent")))
    fail("invalid-shopping-need-conflict", "Unsupported percentage qualifier");
  for (const [field, values] of features) {
    if (values.length !== 1 || !FIELDS[family][field] || (Array.isArray(FIELDS[family][field]) && !FIELDS[family][field].includes(values[0]))
        || (field === "fatPercent" && (typeof values[0] !== "number" || !Number.isFinite(values[0]) || values[0] < 0 || values[0] > 10)))
      fail("invalid-shopping-need-conflict", `Search cannot express an unambiguous ${field} constraint`);
    if (Object.hasOwn(constraints, field) && constraints[field] !== values[0])
      fail("invalid-shopping-need-conflict", `Search conflicts with ${field}`);
    constraints[field] = values[0];
  }
  return { search, constraints };
}

function assessment(field, expected, observed) {
  if (!observed.length) return "missing";
  if (observed.includes(`not:${expected}`)) return "conflict";
  if (field === "grain") {
    // Wholegrain and grain species can coexist in a native product headline.
    const species = observed.filter(value => value === "rye" || value === "wheat");
    if (expected !== "wholegrain" && species.some(value => value !== expected)) return "conflict";
    return observed.includes(expected) ? "matched" : "missing";
  }
  if (field === "husbandry") {
    if ((expected === "barn" && observed.some(value => value === "free-range" || value === "organic"))
        || (expected !== "barn" && observed.includes("barn"))) return "conflict";
    return observed.includes(expected) ? "matched" : "missing";
  }
  if (observed.some(value => value !== expected && !String(value).startsWith("not:"))) return "conflict";
  return observed.includes(expected) ? "matched" : "missing";
}

function classify(need, product) {
  const parsed = parse(need);
  if (!plain(product) || typeof product.name !== "string" || !product.name.trim() || product.name.length > 1000
      || (Object.hasOwn(product, "description") && (typeof product.description !== "string" || product.description.length > 8000)))
    fail("invalid-shopping-need-evidence", "Expected a native name and optional native description");
  const { constraints } = parsed, family = constraints.family;
  const matched = [], missing = [], conflicts = [], evidence = [], observed = new Map();
  const headlineFamilyStatus = familyEvidence(product.name, family);
  const descriptionFamilyConflict = product.description && descriptionExcludesFamily(product.description, family);
  const familyStatus = descriptionFamilyConflict ? "contradicted" : headlineFamilyStatus;
  if (familyStatus === "confirmed") matched.push("family");
  else if (familyStatus === "contradicted") conflicts.push({ field: "family", expected: family, observed: ["outside-supported-family"] });
  else missing.push("family");
  for (const field of ["name", "description"]) {
    if (!Object.hasOwn(product, field) || !product[field].trim()) continue;
    const features = observations(product[field], family, field === "description"), matches = [];
    if (field === "name" && headlineFamilyStatus !== "unconfirmed") matches.push("family");
    if (field === "description" && descriptionFamilyConflict) matches.push("family");
    for (const [feature, values] of features) {
      if (!Object.hasOwn(constraints, feature)) continue;
      matches.push(feature);
      if (!observed.has(feature)) observed.set(feature, []);
      for (const value of values) if (!observed.get(feature).includes(value)) observed.get(feature).push(value);
    }
    if (matches.length) evidence.push({ field, value: product[field], matches });
  }
  for (const field of Object.keys(constraints).filter(field => field !== "family")) {
    const values = observed.get(field) || [], state = assessment(field, constraints[field], values);
    if (state === "matched") matched.push(field);
    else if (state === "missing") missing.push(field);
    else conflicts.push({ field, expected: constraints[field], observed: values.slice() });
  }
  const nativeText = `${product.name} ${product.description || ""}`;
  const preparedEggs = family === "eggs" && (/\b(?:oster(?:eier)?|bunt(?:e|er|es|en)?|gefarbt(?:e|er|es|en)?)\b/.test(normalized(nativeText))
    || (observations(nativeText, family).get("raw") || []).includes(false));
  if (preparedEggs && !Object.hasOwn(constraints, "raw") && familyStatus === "confirmed") {
    matched.splice(matched.indexOf("family"), 1);
    missing.unshift("family");
  }
  return { status: conflicts.length ? "contradicted" : missing.length ? "unconfirmed" : "confirmed", matched, missing, conflicts, evidence };
}

const api = Object.freeze({ parse, classify });
if (root) root.SparkorbShoppingNeedMatcher = api;
if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
