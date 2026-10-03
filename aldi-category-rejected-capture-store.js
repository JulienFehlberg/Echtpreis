"use strict";

// Private diagnostics of rejected HTTP 200 originals. This is not an article,
// navigation admission, price source, stock record or collector checkpoint.
const crypto = require("node:crypto"), Parser = require("./aldi-assortment-category-client"), Product = require("./aldi-assortment-client");
const SOURCE = Parser.SOURCE, TABLE = "aldi_category_rejected_captures", CAPTURE_TABLE = "aldi_category_rejected_capture_history", ORIGINAL_TABLE = "aldi_category_rejected_originals";
const MAX_BYTES = Parser.MAX_BYTES, MAX_URLS = 256, MAX_CAPTURES = 1024, MAX_TOTAL_BYTES = 64 * 1024 * 1024, FRESH_MS = 300000;
const FAILURE_CODES = Object.freeze([
  "aldi-category-canonical-required", "aldi-category-url-not-allowed", "aldi-category-next-data-required", "aldi-category-next-data-invalid",
  "aldi-category-source-canonical-conflict", "aldi-category-native-route-conflict", "aldi-category-native-country-or-category-conflict",
  "aldi-category-native-index-conflict", "aldi-category-native-query-conflict", "aldi-category-native-page-conflict", "aldi-category-native-count-conflict",
  "aldi-category-row-bound-exceeded", "aldi-category-duplicate-native-sku"
]);
const schemas = new WeakMap(), HASH = /^[a-f0-9]{64}$/;
const fail = code => Object.assign(new Error(code), { code });
const plain = v => v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const hash = v => crypto.createHash("sha256").update(v).digest("hex");
function clock(options = {}) {
  if (!plain(options) || Object.keys(options).some(k => k !== "now")) throw fail("invalid-aldi-rejected-capture-options");
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) throw fail("invalid-aldi-rejected-capture-time");
  return now;
}
function iso(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v; }
function bodyText(body) {
  if (typeof body !== "string" && !Buffer.isBuffer(body)) throw fail("aldi-rejected-original-body-required");
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  if (!bytes.length || bytes.length > MAX_BYTES) throw fail("aldi-rejected-original-byte-bound");
  let text; try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw fail("aldi-rejected-original-utf8-required"); }
  if (typeof body === "string" && text !== body || text.includes("\u0000")) throw fail("aldi-rejected-original-utf8-required");
  return { body: text, bytes: bytes.length, sourceResponseHash: hash(bytes) };
}
function checked(capture, now, fresh) {
  if (!plain(capture) || Object.keys(capture).some(k => !["status", "failureCode", "original", "bytes"].includes(k)) || capture.status !== 200
    || !FAILURE_CODES.includes(capture.failureCode) || !plain(capture.original) || Object.keys(capture.original).sort().join(",") !== "body,meta")
    throw fail("aldi-rejected-capture-required");
  const meta = capture.original.meta;
  if (!plain(meta) || Object.keys(meta).sort().join(",") !== "capturedAt,scopeCountry,sourceAgeSeconds,sourceResponseDate,sourceResponseHash,sourceResponseUrl"
    || meta.scopeCountry !== "DE" || !iso(meta.capturedAt) || Date.parse(meta.capturedAt) > now
    || fresh && now - Date.parse(meta.capturedAt) > FRESH_MS
    || meta.sourceAgeSeconds !== null && (!Number.isSafeInteger(meta.sourceAgeSeconds) || meta.sourceAgeSeconds < 0 || meta.sourceAgeSeconds > 300)
    || typeof meta.sourceResponseDate !== "string" || !meta.sourceResponseDate || meta.sourceResponseDate.length > 80)
    throw fail("aldi-rejected-original-proof-required");
  let url; try { url = Parser.categoryUrl(meta.sourceResponseUrl); } catch { throw fail("aldi-rejected-original-url-required"); }
  if (url !== meta.sourceResponseUrl) throw fail("aldi-rejected-original-url-required");
  const original = bodyText(capture.original.body);
  if (!HASH.test(meta.sourceResponseHash || "") || original.sourceResponseHash !== meta.sourceResponseHash || capture.bytes !== undefined && capture.bytes !== original.bytes)
    throw fail("aldi-rejected-original-hash-conflict");
  let responseDate; try { responseDate = Product.responseFreshness(meta, FRESH_MS); } catch { throw fail("aldi-rejected-original-proof-required"); }
  // Re-run the actual product parser at the original capture clock. A caller
  // cannot invent a rejection or turn the absence of an index into admission.
  let actual; try { Parser.parsePage(original.body, meta, { now: Date.parse(meta.capturedAt) }); } catch (error) { actual = error.code; }
  if (actual !== capture.failureCode) throw fail("aldi-rejected-parser-failure-conflict");
  const normalized = { sourceId: SOURCE, status: 200, failureCode: actual, sourceResponseUrl: url, sourceResponseHash: meta.sourceResponseHash,
    sourceResponseDate: responseDate, originalResponseDate: meta.sourceResponseDate, sourceAgeSeconds: meta.sourceAgeSeconds, capturedAt: meta.capturedAt,
    bytes: original.bytes, body: original.body };
  normalized.captureHash = hash(JSON.stringify([SOURCE, 200, url, normalized.sourceResponseHash, responseDate, normalized.sourceAgeSeconds, normalized.capturedAt, actual]));
  return normalized;
}
function validateCapture(capture, options = {}) { return checked(capture, clock(options), true); }
async function ensure(pool) {
  if (!pool || typeof pool.query !== "function") throw fail("database-required");
  const cacheable = typeof pool.connect === "function" && typeof pool.release !== "function";
  if (cacheable && schemas.has(pool)) return schemas.get(pool);
  const codes = FAILURE_CODES.map(v => "'" + v + "'").join(",");
  const job = Promise.resolve().then(() => pool.query(`SELECT pg_advisory_xact_lock(hashtext('ALDI rejected category capture schema'));
    CREATE TABLE IF NOT EXISTS ${ORIGINAL_TABLE}(
      source_response_hash text PRIMARY KEY CHECK(source_response_hash~'^[a-f0-9]{64}$'),
      body text NOT NULL,body_bytes integer NOT NULL CHECK(body_bytes BETWEEN 1 AND ${MAX_BYTES}),
      CHECK(octet_length(body)=body_bytes),CHECK(encode(sha256(convert_to(body,'UTF8')),'hex')=source_response_hash));
    CREATE TABLE IF NOT EXISTS ${CAPTURE_TABLE}(
      capture_hash text PRIMARY KEY CHECK(capture_hash~'^[a-f0-9]{64}$'),source_id text NOT NULL CHECK(source_id='${SOURCE}'),
      source_response_url text NOT NULL CHECK(source_response_url~'^https://www[.]aldi-nord[.]de/sortiment/([a-z0-9-]+/){0,5}[a-z0-9-]+[.]html$'),
      http_status integer NOT NULL CHECK(http_status=200),failure_code text NOT NULL CHECK(failure_code IN (${codes})),
      source_response_hash text NOT NULL REFERENCES ${ORIGINAL_TABLE}(source_response_hash),
      captured_at timestamptz NOT NULL CHECK(isfinite(captured_at)),source_response_date timestamptz NOT NULL CHECK(isfinite(source_response_date)),
      original_response_date text NOT NULL CHECK(length(original_response_date) BETWEEN 1 AND 80),source_age_seconds integer CHECK(source_age_seconds BETWEEN 0 AND 300),
      CHECK(source_response_date BETWEEN captured_at-interval '5 minutes' AND captured_at+interval '5 minutes'),
      UNIQUE(source_id,source_response_url,capture_hash));
    CREATE TABLE IF NOT EXISTS ${TABLE}(
      source_id text NOT NULL CHECK(source_id='${SOURCE}'),source_response_url text NOT NULL,capture_hash text NOT NULL,
      held boolean NOT NULL DEFAULT false,conflict_capture_hash text,PRIMARY KEY(source_id,source_response_url),
      FOREIGN KEY(source_id,source_response_url,capture_hash) REFERENCES ${CAPTURE_TABLE}(source_id,source_response_url,capture_hash),
      FOREIGN KEY(source_id,source_response_url,conflict_capture_hash) REFERENCES ${CAPTURE_TABLE}(source_id,source_response_url,capture_hash),
      CHECK(COALESCE((NOT held AND conflict_capture_hash IS NULL) OR (held AND conflict_capture_hash IS NOT NULL AND conflict_capture_hash<>capture_hash),false)));
    CREATE INDEX IF NOT EXISTS aldi_rejected_capture_original_idx ON ${CAPTURE_TABLE}(source_id,source_response_url,source_response_hash,source_response_date);`));
  if (cacheable) schemas.set(pool, job);
  try { await job; } catch (error) { if (cacheable && schemas.get(pool) === job) schemas.delete(pool); throw error; }
}
async function writingTransaction(tx) {
  if (!tx || typeof tx.query !== "function" || typeof tx.release !== "function") throw fail("aldi-rejected-writing-client-required");
  if ((await tx.query("SELECT txid_current_if_assigned() IS NOT NULL AS assigned")).rows[0]?.assigned !== true) throw fail("aldi-rejected-writing-transaction-required");
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [SOURCE + ":rejected-originals"]);
}
function rawFromRow(row) {
  return { status: row.http_status, failureCode: row.failure_code, bytes: Number(row.body_bytes), original: { body: row.body, meta: {
    sourceResponseUrl: row.source_response_url, sourceResponseHash: row.source_response_hash, sourceResponseDate: row.original_response_date,
    sourceAgeSeconds: row.source_age_seconds === null ? null : Number(row.source_age_seconds), capturedAt: new Date(row.captured_at).toISOString(), scopeCountry: "DE"
  } } };
}
function verifyRow(row, now) {
  if (row.source_id !== SOURCE) throw fail("aldi-rejected-stored-source-conflict");
  const c = checked(rawFromRow(row), now, false);
  if (c.captureHash !== row.capture_hash || c.sourceResponseDate !== new Date(row.source_response_date).toISOString()) throw fail("aldi-rejected-stored-checksum-conflict");
  return c;
}
const JOIN_COLUMNS = "c.*,b.body,b.body_bytes";
async function persist(tx, capture, options = {}) {
  const c = validateCapture(capture, options); await writingTransaction(tx);
  const oldOriginal = (await tx.query(`SELECT capture_hash,captured_at FROM ${CAPTURE_TABLE} WHERE source_id=$1 AND source_response_url=$2 AND source_response_hash=$3 AND source_response_date=$4 AND source_age_seconds IS NOT DISTINCT FROM $5`, [SOURCE, c.sourceResponseUrl, c.sourceResponseHash, c.sourceResponseDate, c.sourceAgeSeconds])).rows;
  if (oldOriginal.some(r => new Date(r.captured_at).toISOString() !== c.capturedAt)) throw fail("aldi-rejected-retimed-original-forbidden");
  const current = (await tx.query(`SELECT l.held,l.conflict_capture_hash,${JOIN_COLUMNS} FROM ${TABLE} l JOIN ${CAPTURE_TABLE} c ON c.capture_hash=l.capture_hash JOIN ${ORIGINAL_TABLE} b USING(source_response_hash) WHERE l.source_id=$1 AND l.source_response_url=$2 FOR UPDATE OF l`, [SOURCE, c.sourceResponseUrl])).rows[0];
  if (current) verifyRow(current, clock(options));
  const stored = (await tx.query(`SELECT ${JOIN_COLUMNS} FROM ${CAPTURE_TABLE} c JOIN ${ORIGINAL_TABLE} b USING(source_response_hash) WHERE c.capture_hash=$1`, [c.captureHash])).rows[0];
  if (stored) { const previous = verifyRow(stored, clock(options)); if (previous.body !== c.body || previous.originalResponseDate !== c.originalResponseDate) throw fail("aldi-rejected-capture-hash-conflict"); }
  const body = (await tx.query(`SELECT body,body_bytes FROM ${ORIGINAL_TABLE} WHERE source_response_hash=$1`, [c.sourceResponseHash])).rows[0];
  if (body && (body.body !== c.body || Number(body.body_bytes) !== c.bytes)) throw fail("aldi-rejected-original-hash-conflict");
  const bounds = (await tx.query(`SELECT (SELECT count(*)::int FROM ${CAPTURE_TABLE}) AS captures,(SELECT COALESCE(sum(body_bytes),0)::bigint FROM ${ORIGINAL_TABLE}) AS bytes,(SELECT count(*)::int FROM ${TABLE}) AS urls`)).rows[0];
  if (!stored && Number(bounds.captures) >= MAX_CAPTURES || !body && Number(bounds.bytes) + c.bytes > MAX_TOTAL_BYTES || !current && Number(bounds.urls) >= MAX_URLS)
    throw fail("aldi-rejected-storage-bound-exceeded");
  await tx.query(`INSERT INTO ${ORIGINAL_TABLE}(source_response_hash,body,body_bytes) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [c.sourceResponseHash, c.body, c.bytes]);
  await tx.query(`INSERT INTO ${CAPTURE_TABLE}(capture_hash,source_id,source_response_url,http_status,failure_code,source_response_hash,captured_at,source_response_date,original_response_date,source_age_seconds) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`, [c.captureHash, SOURCE, c.sourceResponseUrl, 200, c.failureCode, c.sourceResponseHash, c.capturedAt, c.sourceResponseDate, c.originalResponseDate, c.sourceAgeSeconds]);
  let latestUpdated = 0, held = !!current?.held;
  if (!current) { await tx.query(`INSERT INTO ${TABLE}(source_id,source_response_url,capture_hash) VALUES($1,$2,$3)`, [SOURCE, c.sourceResponseUrl, c.captureHash]); latestUpdated = 1; }
  else if (Date.parse(c.capturedAt) > new Date(current.captured_at).getTime()) { await tx.query(`UPDATE ${TABLE} SET capture_hash=$3,held=false,conflict_capture_hash=NULL WHERE source_id=$1 AND source_response_url=$2`, [SOURCE, c.sourceResponseUrl, c.captureHash]); latestUpdated = 1; held = false; }
  else if (c.capturedAt === new Date(current.captured_at).toISOString() && c.captureHash !== current.capture_hash && !held) { await tx.query(`UPDATE ${TABLE} SET held=true,conflict_capture_hash=$3 WHERE source_id=$1 AND source_response_url=$2`, [SOURCE, c.sourceResponseUrl, c.captureHash]); latestUpdated = 1; held = true; }
  return { sourceId: SOURCE, storedCaptures: stored ? 0 : 1, unchangedCaptures: stored ? 1 : 0, latestUpdated, held,
    captureHash: c.captureHash, capturedAt: c.capturedAt, failureCode: c.failureCode, retainedOnly: true, admissionPerformed: false,
    articleRowsCreated: 0, priceRowsCreated: 0, canonicalProductsCreated: 0, cursorAdvanced: false, cooldownChanged: false, truthEligible: false };
}
function printable(value, max = 300) { return typeof value === "string" && value.length <= max && !/[<>\u0000-\u001f\u007f]/.test(value) ? value : null; }
function diagnosticSummary(capture, options = {}) {
  const c = checked(capture, clock(options), false), flags = Object.fromEntries([
    "visitedNodes", "depth", "structures", "localStructures", "componentNames", "keys", "urls", "indexes", "queryCategories", "results", "requests", "path", "strings", "unsafeValues"
  ].map(k => [k, false]));
  const sensitive = /(?:api[ _-]?key|access[ _-]?token|authorization|bearer|password|secret|session[ _-]?id|cookie)/i;
  const kind = value => value === undefined ? "missing" : value === null ? "null" : Array.isArray(value) ? "array" : plain(value) ? "object" : typeof value;
  function safeText(value, max = 180) {
    if (typeof value !== "string") return null;
    if (value.length > max) { flags.strings = true; return null; }
    if (!printable(value, max) || sensitive.test(value) || /https?:\/\/|[?&][^\s]*=/.test(value)) { flags.unsafeValues = true; return null; }
    return value;
  }
  function safeKey(value) {
    if (typeof value !== "string" || value.length > 80) { flags.keys = true; return null; }
    if (!/^(?:@?[A-Za-z][A-Za-z0-9:_-]*|\d+)$/.test(value) || sensitive.test(value) || ["__proto__", "prototype", "constructor"].includes(value)) { flags.unsafeValues = true; return null; }
    return value;
  }
  function sourcePath(at) { if (at.length > 300) { flags.path = true; return at.slice(0, 300); } return at; }
  function keysFor(value, allowed) {
    if (!plain(value) && !Array.isArray(value)) return [];
    const all = Object.keys(value); if (all.length > 32) flags.keys = true;
    return all.slice(0,32).map(safeKey).filter(k => k !== null && (!allowed || allowed.includes(k)));
  }
  const integer = value => Number.isSafeInteger(value) && Math.abs(value) <= 1000000000 ? value : null;
  const boolean = value => typeof value === "boolean" ? value : null;
  function nativePath(value) {
    if (typeof value !== "string") return null;
    if (value.length > 300) { flags.strings = true; return null; }
    if (sensitive.test(value)) { flags.unsafeValues = true; return null; }
    if (/^\/germany\/sortiment\/[A-Za-z0-9/_-]+$/.test(value)) return value;
    try { return Parser.categoryUrl(value.startsWith("/sortiment/") ? Product.ORIGIN + value : value); } catch { flags.unsafeValues = true; return null; }
  }
  const attribute = (tag, name) => { const matches = [...tag.matchAll(new RegExp("(?:^|\\s)" + name + "\\s*=\\s*([\"'])(.*?)\\1", "gi"))]; return matches.length === 1 ? matches[0][2] : null; };
  const scripts = [...c.body.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)].filter(m => attribute(m[0].slice(0,m[0].indexOf(">")+1),"id") === "__NEXT_DATA__");
  const links = [...c.body.matchAll(/<link\b[^>]*>/gi)].filter(m => attribute(m[0],"rel")?.toLowerCase() === "canonical");
  let native = null, jsonParseState = scripts.length === 0 ? "missing" : scripts.length > 1 ? "duplicate" : "unsupported-type";
  if (scripts.length === 1 && attribute(scripts[0][0].slice(0,scripts[0][0].indexOf(">")+1),"type") === "application/json") {
    try { native = JSON.parse(scripts[0][0].slice(scripts[0][0].indexOf(">")+1).replace(/<\/script\s*>$/i,"")); jsonParseState = "parsed"; } catch { jsonParseState = "invalid-json"; }
  }
  let canonicalUrl = null, canonicalState = links.length === 0 ? "missing" : links.length > 1 ? "duplicate" : "invalid-url";
  if (links.length === 1) try { const value = attribute(links[0][0],"href"); if (typeof value === "string" && sensitive.test(value)) { flags.unsafeValues = true; } else { canonicalUrl = Parser.categoryUrl(value); canonicalState = "valid"; } } catch { /* No foreign/query URL is echoed. */ }
  const props = plain(native?.props?.pageProps) ? native.props.pageProps : null, page = plain(props?.page) ? props.page : null;
  const results = plain(props?.algoliaState?.initialResults) ? props.algoliaState.initialResults : null;
  const pageAt = "native.props.pageProps.page", urls = new Map(), localDescriptors = [], structures = [], seen = new WeakSet(); let visited = 0;
  const cmsKeys = ["@name","@path","@nodeType","mgnl:template","@nodes","type","title","label","path","props","text","children","items","links","entries","categories","category","subcategories","pageLink","linkType","href","reference","richText","headline","componentType","mediaType"];
  function descriptor(value, at) {
    const values = {}, keys = keysFor(value).filter(k => cmsKeys.includes(k) || /^\d+$/.test(k) || /^subNavCol\d+$/.test(k));
    for (const key of ["@name","@path","@nodeType","mgnl:template","type","title","label","path"]) {
      const text = key === "@path" || key === "path" ? nativePath(value?.[key]) : safeText(value?.[key]); if (text !== null) values[key] = text;
    }
    return { at: sourcePath(at), kind: kind(value), keyCount: plain(value) || Array.isArray(value) ? Object.keys(value).length : 0, keys, values };
  }
  const components = page?.componentList, componentNames = [];
  if (Array.isArray(components)) {
    if (components.length > 32) flags.componentNames = true;
    for (const value of components.slice(0,32)) { const name = safeText(value,80); if (name !== null) componentNames.push(name); }
  }
  function localArea(name) {
    const value = page?.[name], root = descriptor(value,pageAt+"."+name), children = [];
    if (plain(value) || Array.isArray(value)) {
      const childKeys = Object.keys(value).filter(k => !k.startsWith("@") && (plain(value[k]) || Array.isArray(value[k])));
      if (childKeys.length > 32) flags.localStructures = true;
      for (const key of childKeys.slice(0,32)) {
        const safe = safeKey(key); if (safe === null) continue;
        const child = descriptor(value[key],pageAt+"."+name+"."+safe); children.push({ key:safe,...child });
      }
    }
    if (root.kind === "object" || root.kind === "array") localDescriptors.push(root,...children);
    return { ...root, childCount: plain(value) || Array.isArray(value) ? Object.keys(value).filter(k => !k.startsWith("@") && (plain(value[k]) || Array.isArray(value[k]))).length : 0, children };
  }
  const localCms = { componentList: { kind:kind(components), count:Array.isArray(components)?components.length:null, names:componentNames }, opener:localArea("opener"), openContent:localArea("openContent"), bannerContent:localArea("bannerContent") };
  function visit(value, at, depth = 0) {
    if (visited >= 10000) { flags.visitedNodes = true; return; } visited++;
    if (depth > 12) { flags.depth = true; return; }
    if (typeof value === "string") {
      if (value.length > 2048) { flags.strings = true; return; }
      if (sensitive.test(value)) { flags.unsafeValues = true; return; }
      let url; try { url = Parser.categoryUrl(value.startsWith("/sortiment/") ? Product.ORIGIN+value : value); } catch { return; }
      if (!urls.has(url)) {
        if (urls.size >= 128) { flags.urls = true; return; }
        const scope = ["opener","openContent","bannerContent"].some(name=>at.startsWith(pageAt+"."+name)) ? "page-local" : at.startsWith(pageAt+".header")||at.startsWith(pageAt+".footer") ? "global-navigation" : "other";
        urls.set(url,{url,originalValue:value,at:sourcePath(at),scope,childParentBindingVerified:false});
      }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return; seen.add(value);
    if (plain(value) && (at.startsWith(pageAt+".header") || at.startsWith(pageAt+".footer")) && /Navigation/.test(at)) {
      if (structures.length < 32) structures.push(descriptor(value,at)); else flags.structures = true;
    }
    const keys = Object.keys(value), maxKeys = Array.isArray(value) ? 256 : 64; if (keys.length > maxKeys) flags.keys = true;
    for (const key of keys.slice(0,maxKeys)) { const safe = safeKey(key); if (safe === null) continue; visit(value[key],at+"."+safe,depth+1); if (visited >= 10000) { if (keys.indexOf(key) < keys.length-1) flags.visitedNodes = true; break; } }
  }
  // Local areas receive a separate structure budget and a shallow traversal
  // origin before global navigation. The header cannot displace their evidence.
  for (const name of ["opener","openContent","bannerContent","header","footer"]) visit(page?.[name],pageAt+"."+name);
  visit(native,"native");
  const allIndexKeys = results ? Object.keys(results) : [], indexKeys = allIndexKeys.slice(0,16), indexNames = [];
  if (allIndexKeys.length > 16) flags.indexes = true;
  function indexName(value) { if (typeof value !== "string") return null; if (value.length>120) {flags.strings=true;return null;} if (!/^an_[a-z0-9_]+$/.test(value)||sensitive.test(value)) {flags.unsafeValues=true;return null;} return value; }
  function categoryFilter(value) { if (typeof value !== "string") return null; if (sensitive.test(value)) { flags.unsafeValues = true; return null; } return /^categoryIDs:[a-z0-9-]{1,120}$/.test(value) ? value : null; }
  const queryShape = value => ({query:typeof value?.query==="string"&&value.query===""?"":null,queryPresent:typeof value?.query==="string",queryEmpty:typeof value?.query==="string"?value.query==="":null,
    filters:categoryFilter(value?.filters),filtersPresent:typeof value?.filters==="string",index:indexName(value?.index),page:integer(value?.page),hitsPerPage:integer(value?.hitsPerPage)});
  const stateQueryShapes = indexKeys.map((key,ordinal) => {
    const entry = results[key], state = plain(entry?.state) ? entry.state : null, rs = entry?.results, requests = entry?.requestParams, index = indexName(key);
    if (index !== null) indexNames.push(index);
    if (Array.isArray(rs)&&rs.length>2) flags.results=true; if(Array.isArray(requests)&&requests.length>2) flags.requests=true;
    return {indexName:index,ordinal,kind:kind(entry),keys:keysFor(state,["index","query","filters","page","hitsPerPage","facetsRefinements","facetsExcludes","disjunctiveFacetsRefinements","numericRefinements","tagRefinements","hierarchicalFacetsRefinements"]),...queryShape(state),resultArrays:Array.isArray(rs)?rs.length:null,requestArrays:Array.isArray(requests)?requests.length:null,
      resultsKind:kind(rs),requestsKind:kind(requests),results:Array.isArray(rs)?rs.slice(0,2).map(r=>({kind:kind(r),...queryShape(r),nbHits:integer(r?.nbHits),nbPages:integer(r?.nbPages),actualHits:Array.isArray(r?.hits)?r.hits.length:null,hitsKind:kind(r?.hits),paramsPresent:typeof r?.params==="string",exhaustiveNbHits:boolean(r?.exhaustiveNbHits),exhaustiveCount:boolean(r?.exhaustive?.nbHits)})):[],
      requests:Array.isArray(requests)?requests.slice(0,2).map(r=>({kind:kind(r),...queryShape(r),keys:keysFor(r,["index","query","filters","page","hitsPerPage"])})):[]};
  });
  const categories = native?.query?.categories; if (Array.isArray(categories)&&categories.length>6) flags.queryCategories=true;
  if (localDescriptors.length+structures.length>32) flags.structures=true;
  const responseUrl = sensitive.test(c.sourceResponseUrl) ? (flags.unsafeValues = true, null) : c.sourceResponseUrl;
  return { sourceId: SOURCE, failureCode: c.failureCode, sourceResponseUrl: responseUrl, sourceResponseHash: c.sourceResponseHash,
    sourceResponseDate: c.sourceResponseDate, sourceAgeSeconds: c.sourceAgeSeconds, capturedAt: c.capturedAt, bytes: c.bytes, captureHash: c.captureHash,
    summaryVersion:2,nextData:{scriptCount:scripts.length,jsonParseState,nativeKind:kind(native)},canonical:{linkCount:links.length,parseState:canonicalState,url:canonicalUrl,matchesResponseUrl:canonicalUrl===null?null:canonicalUrl===c.sourceResponseUrl},
    nativeRoute:safeText(native?.page,150),queryCategoriesKind:kind(categories),queryCategoryCount:Array.isArray(categories)?categories.length:null,queryCategories:Array.isArray(categories)?categories.slice(0,6).map(v=>safeText(v,100)).filter(v=>v!==null):null,locale:safeText(props?.locale??native?.locale,12),
    nativePage:Object.fromEntries(["@name","@path","categoryKey","mgnl:template"].map(k=>[k,k==="@path"?nativePath(page?.[k]):safeText(page?.[k])])),
    nativeFlags:{country:safeText(props?.country,12),hasError:boolean(props?.hasError),pageEdit:boolean(page?.isMagnoliaEdit),magnoliaEdit:boolean(props?.mgnlContext?.isMagnoliaEdit),magnoliaPreview:boolean(props?.mgnlContext?.isMagnoliaPreview)},
    localCms,algoliaStateKind:kind(props?.algoliaState),initialResultsKind:kind(props?.algoliaState?.initialResults),nativeIndexCount:results?allIndexKeys.length:null,algoliaIndexNames:indexNames,stateQueryShapes,presentCategoryUrls:[...urls.keys()],urlEvidence:[...urls.values()],cmsStructures:[...localDescriptors,...structures].slice(0,32),globalNavigationStructures:structures,
    truncation:flags,diagnosticTraversalBounded:Object.values(flags).some(Boolean),diagnosticVisitedNodes:visited,
    retainedOnly: true, discoveryOnly: true, admitted: false, current: false, fresh: false, expiresAt: null, availability: "unknown",
    truthEligible: false, currentPriceVerified: false, physicalStorePriceVerified: false, currentAvailabilityVerified: false,
    canonicalIdentityVerified: false, normalPriceClassificationVerified: false, assortmentComplete: false, articleRowsCreated: 0, priceRowsCreated: 0 };
}
async function status(pool, options = {}) {
  const now = clock(options); await ensure(pool);
  // A content-addressed body can back many URL captures. Fetch metadata first,
  // then each distinct original once; the JOIN must not expand one 4 MiB body
  // into 256 copies before the private storage bound can be checked.
  const rows = (await pool.query(`SELECT l.held,l.conflict_capture_hash,c.*,b.body_bytes FROM ${TABLE} l JOIN ${CAPTURE_TABLE} c ON c.capture_hash=l.capture_hash JOIN ${ORIGINAL_TABLE} b USING(source_response_hash) WHERE l.source_id=$1 ORDER BY c.captured_at DESC,c.source_response_url`, [SOURCE])).rows;
  if (rows.length > MAX_URLS) throw fail("aldi-rejected-storage-bound-exceeded");
  const diagnostics = [], originals = new Map(); let heldUrls = 0, excludedInvalidLatest = 0, originalBytes = 0;
  async function withOriginal(row) {
    if (!row || !HASH.test(row.source_response_hash || "")) throw fail("aldi-rejected-stored-checksum-conflict");
    if (!originals.has(row.source_response_hash)) {
      const body = (await pool.query(`SELECT body,body_bytes FROM ${ORIGINAL_TABLE} WHERE source_response_hash=$1`, [row.source_response_hash])).rows[0];
      if (!body || !Number.isSafeInteger(Number(body.body_bytes)) || Number(body.body_bytes) < 1 || Number(body.body_bytes) > MAX_BYTES) throw fail("aldi-rejected-stored-checksum-conflict");
      originalBytes += Number(body.body_bytes);
      if (originalBytes > MAX_TOTAL_BYTES) throw fail("aldi-rejected-storage-bound-exceeded");
      originals.set(row.source_response_hash, body);
    }
    const body = originals.get(row.source_response_hash);
    if (Number(row.body_bytes) !== Number(body.body_bytes)) throw fail("aldi-rejected-stored-checksum-conflict");
    return { ...row, body: body.body };
  }
  for (const row of rows) {
    try {
      const full = await withOriginal(row), original = verifyRow(full, now);
      if (typeof row.held !== "boolean") throw fail("aldi-rejected-stored-checksum-conflict");
      if (row.held) {
        const conflict = (await pool.query(`SELECT c.*,b.body_bytes FROM ${CAPTURE_TABLE} c JOIN ${ORIGINAL_TABLE} b USING(source_response_hash) WHERE c.capture_hash=$1`, [row.conflict_capture_hash])).rows[0];
        const other = verifyRow(await withOriginal(conflict), now);
        if (other.capturedAt !== original.capturedAt || other.sourceResponseUrl !== original.sourceResponseUrl || other.captureHash === original.captureHash) throw fail("aldi-rejected-stored-conflict-invalid");
        heldUrls++; continue;
      }
      if (row.conflict_capture_hash !== null) throw fail("aldi-rejected-stored-conflict-invalid");
      diagnostics.push(diagnosticSummary(rawFromRow(full), { now }));
    } catch { excludedInvalidLatest++; }
  }
  return { ok: true, sourceId: SOURCE, retainedLatestUrls: rows.length, readableLatestUrls: diagnostics.length, heldUrls, excludedInvalidLatest,
    diagnostics, retainedOnly: true, discoveryOnly: true, admitted: false, current: false, fresh: false, truthEligible: false,
    articleRowsCreated: 0, priceRowsCreated: 0, canonicalProductsCreated: 0, cursorAdvanced: false, cooldownChanged: false };
}
module.exports = Object.freeze({ SOURCE, TABLE, CAPTURE_TABLE, ORIGINAL_TABLE, MAX_BYTES, MAX_URLS, MAX_CAPTURES, MAX_TOTAL_BYTES, FRESH_MS, FAILURE_CODES,
  hash, ensure, validateCapture, persist, diagnosticSummary, status });
