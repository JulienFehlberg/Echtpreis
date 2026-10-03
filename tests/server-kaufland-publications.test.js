"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createRequire, Module } = require("node:module"), { EventEmitter } = require("node:events");
const Publications = require("../kaufland-berlin-publications"), Refresh = require("../kaufland-berlin-publication-refresh");
const clone = value => JSON.parse(JSON.stringify(value));
const localDay = at => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
const displayDay = day => day.slice(8) + "." + day.slice(5, 7) + "." + day.slice(0, 4);

// Synthetic original content is parsed by the real source contract. Only its
// private latest-read seam is bound in memory; no source, socket or SQL is used.
function parsedOriginal() {
  const at = Date.now() - 2000, from = localDay(at), to = new Date(Date.parse(from + "T12:00:00Z") + 6 * Publications.DAY_MS).toISOString().slice(0, 10);
  const html = `<!doctype html><html><head><script class="o-special-offers-controller__settings" type="application/json">{"settings":{"apiUrl":"/.kloffers.storeName={storeName}.json"}}</script></head><body>
    <div data-force-store-change="DE1980"><h1 itemprop="name" content="Kaufland Berlin-Reinickendorf">Kaufland Berlin-Reinickendorf</h1>
    <span itemprop="url" content="/service/filiale.storeName=DE1980.html"></span><div itemprop="streetAddress" content="Ollenhauerstraße 122">Ollenhauerstraße 122</div>
    <span itemprop="addressLocality" content="Berlin"></span><span itemprop="postalCode" content="13403"></span></div>
    <div class="t-tiles-slider"><h3>Unsere Knüller der Woche</h3><h3>Gültig vom ${displayDay(from)} bis ${displayDay(to)}</h3><div class="o-slider__list">
    <a class="k-product-tile k-product-tile--slider" href="/angebote/uebersicht.html?kloffer-category=135_Foodknueller&amp;kloffer-articleID=90000001">
    <div class="k-product-tile__title">SYNTHETIC Gouda</div><div class="k-product-tile__subtitle">Route contract</div><div class="k-product-tile__unit-price">je 450-g-Stück</div>
    <div class="k-product-tile__base-price">(1 kg = 6.65)</div><div class="k-product-tile__pricetags-normal"><div class="k-price-tag"><div class="k-price-tag__price">2.99</div></div></div></a>
    </div></div></body></html>`;
  const record = (url, body, captured) => ({ status: 200, sourceResponseUrl: url, sourceResponseHash: Publications.hash(body), body,
    capturedAt: new Date(captured).toISOString(), headers: { date: new Date(captured).toUTCString(), age: "0",
      "content-type": url === Publications.PAGE_URL ? "text/html; charset=UTF-8" : "application/json" }, bytes: Buffer.byteLength(body) });
  return Publications.parseCapture({ branch: record(Publications.PAGE_URL, html, at),
    index: record(Publications.INDEX_URL, JSON.stringify([{ dateFrom: from, dateTo: to, klNr: "90000001" }]), at + 1000) }, { now: Date.now() });
}
function sourceReadSeam(latest) {
  const filename = require.resolve("../kaufland-berlin-publications"), instance = new Module(filename, module);
  instance.filename = filename; instance.paths = Module._nodeModulePaths(path.dirname(filename));
  // This isolated test module preserves real query/search/status code. The
  // production exports and tracked source file are never changed.
  instance._compile(fs.readFileSync(filename, "utf8") + "\nmodule.exports={...module.exports,__testBindLatest:fn=>{latest=fn}};", filename);
  instance.exports.__testBindLatest(latest); return instance.exports;
}
function fixture({ database = true, failPublicationRead = false, failResearchRead = false } = {}) {
  const filename = path.resolve(__dirname, "../server.js"), nativeRequire = createRequire(filename), localModule = { exports: {} };
  const parsed = parsedOriginal(), reads = [], serviceCalls = [], researchCalls = [];
  const pool = { query: async () => assert.fail("Actual HTTP route sandbox must not execute database SQL"), end: async () => {} };
  const bound = sourceReadSeam(async p => {
    assert.equal(p, pool); reads.push(true);
    if (failPublicationRead) throw Object.assign(Error("PRIVATE ORIGINAL BODY MUST NEVER LEAK"), { code: "kaufland-stored-original-binding-conflict" });
    return clone(parsed);
  });
  const research = { sourceId: Publications.SOURCE, revision: 1, completedCaptures: 1, received: 1, accepted: 1, lastError: null,
    proofHash: parsed.proofHash, lastCompletedAt: parsed.capturedAt, nextAttemptAt: new Date(Date.parse(parsed.capturedAt) + Refresh.REFRESH_MS).toISOString(),
    refreshIntervalMinutes: 360, maximumOrdinaryRequests: 2, current: false, fullAssortment: false, nativeProductIdentities: 0,
    currentPhysicalPriceImports: 0, scopeCity: "Berlin", scopeCountry: "DE", scopeChannel: Publications.CHANNEL,
    physicalStorePriceVerified: false, normalPriceClassificationVerified: false };
  const mocks = {
    pg: { Pool: function () { return pool; } }, http: { createServer: () => ({ listening: false, close: callback => callback?.() }) },
    "./kaufland-berlin-publications": { ...Publications,
      status: async p => { assert.equal(p, pool); serviceCalls.push({ kind: "status" }); return bound.status(p); },
      search: async (p, options = {}) => { assert.equal(p, pool); serviceCalls.push({ kind: "search", options: clone(options) });
        // Cross-realm VM records are converted to ordinary JSON only for the
        // source's plain-object guard, preserving exact HTTP values and types.
        return bound.search(p, clone(options)); } },
    "./kaufland-berlin-publication-refresh": { ...Refresh, status: async p => {
      assert.equal(p, pool); researchCalls.push(true);
      if (failResearchRead) throw Error("PRIVATE CHECKPOINT SOURCE CONNECTION MUST NEVER LEAK");
      return clone(research);
    }, refresh: async () => assert.fail("A read-only publication route cannot start collector HTTP") }
  };
  const localRequire = name => Object.hasOwn(mocks, name) ? mocks[name] : nativeRequire(name); localRequire.main = null;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { require: localRequire, module: localModule, exports: localModule.exports,
    process: { env: database ? { DATABASE_URL: "postgres://unit.test/no-connection" } : {}, pid: 999 },
    console: { log() {}, error() {} }, Buffer, URL, Date, Promise, setTimeout, clearTimeout, setInterval, clearInterval }, { filename });
  async function request(url, method = "GET") {
    const req = new EventEmitter(), res = new EventEmitter(); Object.assign(req, { method, url, headers: {} });
    res.setHeader = () => {}; res.writeHead = status => { res.status = status; res.headersSent = true; };
    const done = new Promise(resolve => res.end = body => { res.writableEnded = true; res.emit("finish"); resolve({ status: res.status, body: JSON.parse(body) }); });
    await localModule.exports.handle(req, res); return done;
  }
  return { request, reads, serviceCalls, researchCalls, parsed, research, bound, pool, close: () => localModule.exports.shutdown() };
}
function noAuthority(response) {
  const text = JSON.stringify(response);
  for (const privateToken of ["PRIVATE ORIGINAL", "PRIVATE CHECKPOINT", "raw_capture", "rawCapture", "nativeWitness", "<!doctype", "postgres://unit.test"])
    assert(!text.includes(privateToken), "Private originals, connection and witness details remain excluded");
}
async function main() {
  let groups = 0; const test = async (name, fn) => { await fn(); groups++; console.log("ok " + groups + " - " + name); };
  const base = "/v1/kaufland-berlin-publications", statusRoute = base + "/status";
  if (process.argv.includes("--fixture-handshake-check")) {
    const f = fixture();
    try {
      assert.equal((await f.request("/v1/synthetic-fixture-handshake-route-not-present")).status, 404);
      const read = await f.bound.search(f.pool, { search: "Gouda", limit: 2 });
      assert.equal(read.promotionalPublications.length, 1); assert.equal(read.promotionalPublications[0].publication.current, false);
      const before = f.reads.length;
      await assert.rejects(f.bound.search(f.pool, { search: "Gouda", limit: 2, nowFromUser: 1 }), /invalid-kaufland-query/);
      assert.equal(f.reads.length, before); noAuthority(read);
    } finally { await f.close(); }
    console.log("server-kaufland-publications: actual server sandbox and real source read seam handshake passed; Kaufland HTTP routes not claimed integrated"); return;
  }
  const f = fixture();
  try {
    await test("exact no-query status route includes safe original-source status and checkpoint research", async () => {
      const result = await f.request(statusRoute); assert.equal(result.status, 200);
      const expected = await f.bound.status(f.pool); assert.deepEqual(result.body, { ...expected, research: f.research });
      assert.equal(result.body.current, false); assert.equal(result.body.nativeProductIdentities, 0); assert.equal(result.body.currentPhysicalPriceImports, 0);
      assert.equal(result.body.truthEligible, false); assert.equal(result.body.fullAssortment, false); assert.equal(f.researchCalls.length, 1); noAuthority(result);
    });
    for (const suffix of ["?", "?search=Gouda", "?limit=2", "?now=0", "?refresh=true", "?__proto__=x"])
      await test("status rejects any query " + suffix + " before either reader", async () => {
        const calls = f.serviceCalls.length, reads = f.reads.length, research = f.researchCalls.length, result = await f.request(statusRoute + suffix);
        assert.equal(result.status, 400); assert.equal(result.body.error, "invalid-kaufland-publication-query");
        assert.equal(f.serviceCalls.length, calls); assert.equal(f.reads.length, reads); assert.equal(f.researchCalls.length, research); noAuthority(result);
      });
    await test("read-only search route uses actual closed source query and preserves dated noncanonical DTO", async () => {
      const result = await f.request(base + "?search=Gouda&limit=2"); assert.equal(result.status, 200, JSON.stringify(result.body));
      const expected = await f.bound.search(f.pool, { search: "Gouda", limit: 2 }); assert.deepEqual(result.body, { ok: true, ...expected });
      const forwarded = f.serviceCalls.at(-1).options; assert.equal(forwarded.search, "Gouda"); assert.equal(forwarded.limit, 2);
      const publication = result.body.promotionalPublications[0].publication;
      assert.equal(publication.nativePublicationId, "90000001"); assert.equal(publication.gtin, null); assert.equal(publication.retailerSku, null);
      assert.equal(publication.current, false); assert.equal(publication.price, undefined); assert.equal(publication.deposit, null);
      assert.equal(publication.numericComparisonEligible, false); assert.equal(publication.truthEligible, false); assert.equal(publication.physicalStorePriceVerified, false);
      assert.equal(publication.normalPriceClassificationVerified, false); assert.equal(publication.capturedAt, f.parsed.documentCapturedAt);
      assert.equal(result.body.promotionalPublicationCoverage.nativeProductIdentities, 0); noAuthority(result);
    });
    await test("default and maximum bounded read use actual native source filters", async () => {
      const first = await f.request(base); assert.equal(first.status, 200); assert.equal(first.body.promotionalPublications.length, 1);
      const maximum = await f.request(base + "?search=not-present&limit=200"); assert.equal(maximum.status, 200); assert.equal(maximum.body.promotionalPublications.length, 0);
      assert.equal(maximum.body.promotionalPublicationCoverage.receivedGroups, 1); assert.equal(f.serviceCalls.at(-1).options.limit, 200);
    });
    for (const query of ["search=Gouda&search=Milk", "limit=1&limit=2", "limit=1&%6cimit=2", "unknown=x", "now=0", "refresh=true",
      "merchant=Kaufland", "scopeChannel=physical-store", "pack=450g", "gtin=5449000017888", "sourceResponseUrl=https://example.invalid", "__proto__=x"])
      await test("duplicate or unknown query rejected before source reader: " + query, async () => {
        const calls = f.serviceCalls.length, reads = f.reads.length, result = await f.request(base + "?" + query);
        assert.equal(result.status, 400); assert.equal(result.body.error, "invalid-kaufland-publication-query");
        assert.equal(f.serviceCalls.length, calls); assert.equal(f.reads.length, reads); noAuthority(result);
      });
    for (const query of ["limit=0", "limit=201", "limit=-1", "limit=1.5", "limit=1e2", "limit=true", "limit=", "limit=%202%20",
      "search=", "search=%20Gouda", "search=Gouda%20", "search=%3Cscript%3E", "search=Gouda%00", "search=" + "x".repeat(121)])
      await test("invalid recognized value rejected without a source-data read: " + query.slice(0, 80), async () => {
        const reads = f.reads.length, result = await f.request(base + "?" + query); assert.equal(result.status, 400);
        assert.equal(result.body.error, "invalid-kaufland-publication-query"); assert.equal(f.reads.length, reads); noAuthority(result);
      });
    for (const route of [base, statusRoute]) await test("POST cannot turn publication reading into refresh/admission: " + route, async () => {
      const calls = f.serviceCalls.length, result = await f.request(route, "POST"); assert.equal(result.status, 404); assert.equal(f.serviceCalls.length, calls); noAuthority(result);
    });
  } finally { await f.close(); }
  for (const route of [base, statusRoute]) await test("database absence is503 without reader or collector: " + route, async () => {
    const absent = fixture({ database: false });
    try { const result = await absent.request(route); assert.equal(result.status, 503); assert.equal(result.body.error, "database-unavailable");
      assert.equal(absent.serviceCalls.length, 0); assert.equal(absent.researchCalls.length, 0); assert.equal(absent.reads.length, 0); noAuthority(result); }
    finally { await absent.close(); }
  });
  for (const route of [base, statusRoute]) await test("source reader error is closed500 with no private original: " + route, async () => {
    const broken = fixture({ failPublicationRead: true });
    try { const result = await broken.request(route); assert.equal(result.status, 500); assert.match(result.body.error, /^kaufland-publication-(?:status|search|read)-failed$/);
      assert.equal(result.body.promotionalPublications, undefined); assert.equal(result.body.research, undefined); noAuthority(result); }
    finally { await broken.close(); }
  });
  await test("checkpoint reader error cannot return a partially successful status or private cause", async () => {
    const broken = fixture({ failResearchRead: true });
    try { const result = await broken.request(statusRoute); assert.equal(result.status, 500); assert.match(result.body.error, /^kaufland-publication-(?:status|read)-failed$/);
      assert.equal(result.body.research, undefined); assert.equal(result.body.publishedOfferGroups, undefined); noAuthority(result); }
    finally { await broken.close(); }
  });
  console.log("server-kaufland-publications: " + groups + " actual server.handle/source-query read-only route groups passed; no socket/database/retailer calls");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
