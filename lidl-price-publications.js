"use strict";
const crypto = require('node:crypto');
const Filters = require('./retailer-product-search-filters');
const Schema = require('./retailer-schema-lifecycle');
const SOURCE = 'Lidl DE dated price announcements';
const CHANNEL = 'retailer-price-publication';
const TABLE = 'lidl_dated_publication_captures';
const PAGE_URL = 'https://unternehmen.lidl.de/pressemitteilungen/2026/261001_preissenkung-snack-getraenke';
const PUBLISHED_ON = '2026-10-01';
const NATIVE_DATE = '01. Oktober 2026';
const HASH = /^[a-f0-9]{64}$/;
const fail = code => Object.assign(new Error(code), { code });
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function berlinDate(value) { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value).map(p => [p.type, p.value])); return parts.year + '-' + parts.month + '-' + parts.day; }
function clock(options = {}) {
  const value = options.now === undefined ? Date.now() : options.now;
  const now = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(now) || value === null || typeof value === 'boolean') throw fail('invalid-time');
  return now;
}
function time(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19) ? parsed : NaN;
}
function decode(text) {
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, key) => {
    if (key[0] !== '#') return entities[key] ?? all;
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all;
  });
}
function text(html) { return decode(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function normalizedName(value) { return value.normalize('NFD').replace(/[\u0300-\u036f\u00ad]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function cents(value) { return /^\d+,\d{2}$/.test(value) ? Number(value.replace(',', '')) : null; }
function salesPack(native) {
  let match = /^(\d+(?:,\d+)?) Gramm$/.exec(native);
  if (match) {
    const amount = Number(match[1].replace(',', '.'));
    return Number.isFinite(amount) && amount > 0 && amount <= 100000000 ? { pack: match[1].replace(',', '.') + ' g', packAmount: amount, packCount: 1, packUnit: 'g' } : null;
  }
  match = /^(\d+(?:,\d+)?)-Liter-(?:PET-Flasche|Dose|Packung)(?: \((\d+) x (\d+(?:,\d+)?) l\))?$/.exec(native);
  if (!match) return null;
  const total = Number(match[1].replace(',', '.')) * 1000;
  const count = Number(match[2] || 1), amount = match[3] ? Number(match[3].replace(',', '.')) * 1000 : total;
  if (!Number.isSafeInteger(count) || count < 1 || count > 999 || !Number.isFinite(total) || total <= 0 || total > 100000000 || !Number.isFinite(amount) || amount <= 0 || Math.abs(total - count * amount) > 1e-7) return null;
  return { pack: (count > 1 ? count + ' x ' : '') + (amount / 1000) + ' l', packAmount: amount, packCount: count, packUnit: 'ml' };
}
function nativeArticle(body) {
  const components = [];
  for (const match of body.matchAll(/<div\b[^>]*\bdata-props="([^"]+)"[^>]*>/gi)) {
    let data; try { data = JSON.parse(decodeURIComponent(decode(match[1]))); } catch { continue; }
    if (data.componentName === 'LiCoContentArticleModule') components.push(data.componentData);
  }
  if (components.length !== 1 || components[0]?.articleType !== 'press' || components[0]?.header?.date !== NATIVE_DATE || typeof components[0].introRichText !== 'string') throw fail('lidl-native-dated-article-required');
  const intro = components[0].introRichText;
  const introText = text(intro);
  if (!introText.includes('Diese Artikel werden deutschlandweit in allen Lidl-Filialen günstiger:') || !introText.includes('Ab sofort senkt') || !introText.includes('Es gibt keine regionalen Preisunterschiede.')) throw fail('lidl-native-national-scope-required');
  if (/\b(?:coupon|gutschein|lidl plus|mitglied|app-preis|mindestmenge|mindestkauf|nur online)\b/i.test(introText)) throw fail('lidl-unreviewed-publication-condition');
  const lists = [...intro.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => text(m[1]));
  // The independently rendered article must carry exactly the same native list.
  const visible = body.replace(/<div\b[^>]*\bdata-props="[^"]*"[^>]*>/gi, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const rendered = [...visible.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => text(m[1]));
  if (!lists.length || lists.length > 24 || JSON.stringify(lists) !== JSON.stringify(rendered) || !text(visible).includes(NATIVE_DATE) || !text(visible).includes('Diese Artikel werden deutschlandweit in allen Lidl-Filialen günstiger:')) throw fail('lidl-native-rendered-article-conflict');
  return lists;
}
function parseGroup(native, ordinal) {
  const reasons = [];
  const match = /^(.+), (.+), neu (\d+,\d{2}) Euro \(Grundpreis: (ab )?(\d+,\d{2}) Euro\/(kg|l)\) statt (\d+,\d{2}) Euro(?: \(Einzelflasche 0,5 l neu 0,34 Euro\))?$/.exec(native);
  if (!match) return { ordinal, native, reasons: ['unreviewed-native-price-group'] };
  const [, name, quantity, price, minimum, base, unit, old] = match;
  const pack = salesPack(quantity), priceCents = cents(price), baseCents = cents(base), oldCents = cents(old);
  if (!pack || minimum || /\d\/\d/.test(quantity)) reasons.push('exact-single-sales-pack-required');
  if (name.length > 250 || /[<>]|\b(?:coupon|gutschein|lidl plus|mitglied|app-preis)\b/i.test(name)) reasons.push('unsupported-native-name-or-condition');
  if (![priceCents, oldCents, baseCents].every(n => Number.isSafeInteger(n) && n > 0) || priceCents > 1000000 || oldCents > 1000000 || oldCents <= priceCents) reasons.push('native-price-reduction-required');
  if ([8, 10, 17, 19].includes(ordinal)) reasons.push('held-original-group-requires-review');
  if (pack && ((unit === 'kg' ? pack.packUnit !== 'g' : pack.packUnit !== 'ml') || Math.round(priceCents * 1000 / (pack.packAmount * pack.packCount)) !== baseCents)) reasons.push('native-pack-base-price-conflict');
  return { ordinal, native, name, quantity, pack, price: priceCents / 100, previousPublishedPrice: oldCents / 100, nativeBasePrice: (minimum || '') + base + ' Euro/' + unit, reasons };
}
function parseCapture(raw, options = {}) {
  const now = clock(options), captured = time(raw?.capturedAt), httpDate = Date.parse(raw?.headers?.date), age = raw?.headers?.age == null ? null : Number(raw.headers.age);
  if (!object(raw) || raw.status !== 200 || raw.sourceResponseUrl !== PAGE_URL || typeof raw.body !== 'string' || Buffer.byteLength(raw.body, 'utf8') > 1500000 || !HASH.test(raw.sourceResponseHash || '') || hash(raw.body) !== raw.sourceResponseHash) throw fail('lidl-original-capture-required');
  if (!Number.isFinite(captured) || captured > now || berlinDate(captured) < PUBLISHED_ON || !Number.isFinite(httpDate) || Math.abs(httpDate - captured) > 300000 || age !== null && (!Number.isSafeInteger(age) || age < 0 || age > 300) || !String(raw.headers?.['content-type'] || '').toLowerCase().includes('text/html')) throw fail('lidl-original-http-binding-required');
  const groups = nativeArticle(raw.body).map((native, i) => parseGroup(native, i + 1));
  const names = new Map();
  for (const group of groups) if (!group.reasons.length) {
    const key = JSON.stringify([normalizedName(group.name), group.pack]);
    if (!names.has(key)) names.set(key, []); names.get(key).push(group);
  }
  for (const rows of names.values()) if (rows.length > 1) for (const row of rows) row.reasons.push('duplicate-native-name-pack');
  const proofHash = hash(JSON.stringify(['lidl-dated-original-v1', PAGE_URL, raw.sourceResponseHash, raw.capturedAt, raw.headers.date, raw.headers.age ?? null, PUBLISHED_ON]));
  const datedPublications = [], quarantined = [];
  for (const group of groups) {
    if (group.reasons.length) { quarantined.push({ groupOrdinal: group.ordinal, nativeText: group.native, reasons: group.reasons }); continue; }
    const publication = { kind: 'dated-national-price-publication', identityKind: 'publication-group-not-sku', sourceId: SOURCE, merchant: 'Lidl', publicationId: PAGE_URL, groupOrdinal: group.ordinal, gtin: null, retailerSku: null, name: group.name, nativeQuantity: group.quantity, ...group.pack, price: group.price, displayedPrice: group.price, currency: 'EUR', previousPublishedPrice: group.previousPublishedPrice, nativeBasePrice: group.nativeBasePrice, sourcePublishedDate: PUBLISHED_ON, nativeValidity: null, publicationOriginalValidityVerified: false, current: false, expiresAt: null, priceObservedAt: null, capturedAt: raw.capturedAt, scopeCountry: 'DE', scopeCity: null, scopeChannel: CHANNEL, nationalScopeVerified: true, appliesToBerlin: true, shop: null, nativeMarketId: null, deposit: null, payablePackPrice: null, truthEligible: false, physicalStorePriceVerified: false, normalPriceClassificationVerified: false, priceType: 'unknown', promotionStatus: 'dated-price-reduction-announcement', sourceUrl: PAGE_URL, sourceResponseUrl: PAGE_URL, sourceResponseHash: raw.sourceResponseHash, proofHash, state: 'published' };
    const reference = { kind: 'dated-national-publication', identityKind: 'publication-group-not-sku', city: 'Berlin', country: 'DE', merchant: 'Lidl', key: JSON.stringify(['publication-group-not-sku', SOURCE, PAGE_URL, group.ordinal, group.pack.packCount, group.pack.packAmount, group.pack.packUnit]), publishedOn: PUBLISHED_ON, sourceMarket: null, observedMarkets: 0 };
    datedPublications.push({ publication, reference });
  }
  return { sourceId: SOURCE, sourcePublishedDate: PUBLISHED_ON, capturedAt: raw.capturedAt, proofHash, received: groups.length, accepted: datedPublications.length, rejected: quarantined.length, datedPublications, quarantined, current: false, currentPhysicalPriceImports: 0, nativeProductIdentities: 0, fullAssortment: false, rawCapture: raw };
}
async function ensure(pool) {
  if (!pool) throw fail('database-required');
  return Schema.ensure(pool, TABLE, () => pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE}(source_id text NOT NULL CHECK(source_id='${SOURCE}'),proof_hash text PRIMARY KEY CHECK(proof_hash~'^[a-f0-9]{64}$'),captured_at timestamptz NOT NULL,source_published_date date NOT NULL CHECK(source_published_date='2026-10-01'),raw_capture jsonb NOT NULL,received int NOT NULL CHECK(received>=0),accepted int NOT NULL CHECK(accepted>=0),quarantined jsonb NOT NULL);CREATE INDEX IF NOT EXISTS lidl_dated_capture_idx ON ${TABLE}(source_id,captured_at DESC);`));
}
async function persist(pool, raw, options = {}) {
  const parsed = parseCapture(raw, options); await ensure(pool);
  const result = await pool.query(`INSERT INTO ${TABLE}(source_id,proof_hash,captured_at,source_published_date,raw_capture,received,accepted,quarantined) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb) ON CONFLICT(proof_hash) DO NOTHING`, [SOURCE, parsed.proofHash, parsed.capturedAt, PUBLISHED_ON, JSON.stringify(raw), parsed.received, parsed.accepted, JSON.stringify(parsed.quarantined)]);
  return { received: parsed.received, accepted: parsed.accepted, rejected: parsed.rejected, proofHash: parsed.proofHash, upserted: result.rowCount, unchanged: result.rowCount ? 0 : 1, currentPhysicalPriceImports: 0, nativeProductIdentities: 0, fullAssortment: false };
}
async function latest(pool, options = {}) {
  await ensure(pool);
  const result = await pool.query(`SELECT proof_hash AS "proofHash",captured_at AS "capturedAt",raw_capture AS "rawCapture" FROM ${TABLE} WHERE source_id=$1 ORDER BY captured_at DESC,proof_hash LIMIT 2`, [SOURCE]);
  if (!result.rows.length) return null;
  const row = result.rows[0];
  if (result.rows.length > 1 && new Date(row.capturedAt).getTime() === new Date(result.rows[1].capturedAt).getTime()) return { ambiguous: true };
  const parsed = parseCapture(row.rawCapture, options);
  if (parsed.proofHash !== row.proofHash || new Date(row.capturedAt).toISOString() !== parsed.capturedAt) throw fail('lidl-stored-original-binding-conflict');
  return parsed;
}
async function search(pool, options = {}) {
  const limit = options.limit ?? 50, pack = Filters.salesPack(options.pack);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw fail('invalid-reference-limit');
  const eligible = !options.gtin && (!options.merchant || options.merchant === 'Lidl') && (!options.scopeChannel || options.scopeChannel === CHANNEL);
  const captured = eligible ? await latest(pool, options) : null;
  const rows = !options.gtin && (!options.merchant || options.merchant === 'Lidl') && (!options.scopeChannel || options.scopeChannel === CHANNEL) ? (captured?.datedPublications || []).filter(({ publication: p }) => Filters.matchesPack(p, pack) && (!options.search || normalizedName(p.name).includes(normalizedName(options.search)))) : [];
  return { datedPublications: rows.slice(0, limit), datedPublicationCoverage: { sourceId: SOURCE, merchant: 'Lidl', sourcePublishedDate: captured?.sourcePublishedDate ?? null, documentCapturedAt: captured?.capturedAt ?? null, receivedGroups: captured?.received ?? 0, acceptedGroups: captured?.accepted ?? 0, quarantinedGroups: captured?.rejected ?? 0, matchedGroups: rows.length, ambiguousLatestCapture: !!captured?.ambiguous, current: false, currentPhysicalPriceImports: 0, nativeProductIdentities: 0, fullAssortment: false }, truncated: rows.length > limit };
}
async function status(pool, options = {}) {
  const captured = await latest(pool, options);
  return { ok: true, sourceId: SOURCE, merchant: 'Lidl', scopeCountry: 'DE', scopeCity: null, appliesToBerlin: true, scopeChannel: CHANNEL, sourcePublishedDate: captured?.sourcePublishedDate ?? null, documentCapturedAt: captured?.capturedAt ?? null, storedLatestGroups: captured?.received ?? 0, datedPublicationGroups: captured?.accepted ?? 0, quarantinedGroups: captured?.rejected ?? 0, quarantined: captured?.quarantined ?? [], ambiguousLatestCapture: !!captured?.ambiguous, current: false, currentPhysicalPriceImports: 0, nativeProductIdentities: 0, fullAssortment: false, physicalStorePriceVerified: false, normalPriceClassificationVerified: false, truthEligible: false, independentOfUserReceipts: true };
}
module.exports = Object.freeze({ SOURCE, CHANNEL, TABLE, PAGE_URL, PUBLISHED_ON, NATIVE_DATE, hash, salesPack, parseCapture, ensure, persist, latest, search, status });
