"use strict";
const assert = require("node:assert/strict"), crypto = require("node:crypto"), Fetch = require("../aldi-category-fetch-client"), Navigation = require("../aldi-category-navigation-parser"), ProductParser = require("../aldi-assortment-category-client"), Rejected = require("../aldi-category-rejected-capture-store"), Fixture = require("./fixtures/aldi-navigation-capture");
const now = Fixture.time, sha = body => crypto.createHash("sha256").update(body).digest("hex");
const mutateContext = (native, mutate) => { const entries = JSON.parse(native.props.pageProps.apiData); mutate(entries); native.props.pageProps.apiData = JSON.stringify(entries); };
let groups = 0;
async function test(name, fn) { try { await fn(); groups++; } catch (error) { console.error("Failed: " + name); throw error; } }
async function capture(value, options = {}) {
  const calls = [], response = options.response ?? new Response(value.body, { status: 200, headers: Fixture.headers() });
  const result = await Fetch.fetchPage(value.meta.sourceResponseUrl, { now: () => now, fetchImpl: async (url, request) => { calls.push({ url, request }); return response; }, ...options.fetchOptions });
  return { result, calls };
}
async function rejected(value, options, check) {
  let calls = 0, caught;
  try { await Fetch.fetchPage(value.meta.sourceResponseUrl, { now: () => now, fetchImpl: async () => { calls++; return options.response ?? new Response(value.body, { status: 200, headers: Fixture.headers() }); }, ...options.fetchOptions }); } catch (error) { caught = error; }
  assert(caught, "Malformed/denied source must fail closed"); assert.equal(calls, options.calls ?? 1, "No retries or alternative hosts/URLs"); check(caught); return caught;
}
(async () => {
  await test("actual parent fetch yields only original-bound navigation and reproducible rejection", async () => {
    const value = Fixture.parent(), original = JSON.stringify(value), { result, calls } = await capture(value);
    assert.equal(calls.length, 1); assert.equal(calls[0].url, Fixture.parentUrl); assert.equal(calls[0].request.credentials, "omit"); assert.equal(calls[0].request.redirect, "error"); assert.equal(calls[0].request.method, "GET");
    assert.equal(result.requests, 1); assert.equal(result.bytes, Buffer.byteLength(value.body)); assert.equal(result.original.body, value.body); assert.equal(result.original.meta.sourceResponseHash, sha(value.body)); assert.equal(result.original.meta.capturedAt, new Date(now).toISOString()); assert.equal(result.original.meta.sourceResponseDate, new Date(now).toUTCString()); assert.equal(result.original.meta.sourceAgeSeconds, 0);
    assert(!Object.hasOwn(result, "page")); assert.equal(result.navigation.purpose, "category-navigation-candidate"); assert.equal(result.navigation.children.length, 3); assert.equal(result.navigation.articleRowsCreated, 0); assert.equal(result.navigation.priceRowsCreated, 0); assert.equal(result.truthEligible, false); assert.equal(result.assortmentComplete, false);
    assert.deepEqual(result.discoveredTargets, Fixture.childIds.map(id => "https://www.aldi-nord.de" + Fixture.parentPath + "/" + id + ".html")); assert.deepEqual(result.discoveredTargets, result.navigation.discoveredTargets);
    assert(!result.discoveredTargets.includes("https://www.aldi-nord.de/sortiment/vorraete.html"), "Global header is not native parent children proof");
    assert.equal(result.rejectedCapture.status, 200); assert.equal(result.rejectedCapture.failureCode, "aldi-category-native-index-conflict"); assert.deepEqual(result.rejectedCapture.original, result.original); assert.equal(result.rejectedCapture.bytes, result.bytes);
    assert.equal(Rejected.validateCapture(result.rejectedCapture, { now }).failureCode, "aldi-category-native-index-conflict"); assert.deepEqual(Navigation.parseNavigationParent(result.original.body, result.original.meta, { now }), result.navigation); assert.equal(JSON.stringify(value), original);
  });
  await test("product fetch keeps genuine product page and union of header plus actual sibling proofs", async () => {
    const value = Fixture.leaf(), { result, calls } = await capture(value);
    assert.equal(calls.length, 1); assert.equal(result.page.candidateCount, 1); assert(!Object.hasOwn(result, "navigation")); assert(!Object.hasOwn(result, "rejectedCapture"));
    const expected = [...new Set([...Fetch.navigationTargets(value.body), ...Fixture.siblingIds.map(id => "https://www.aldi-nord.de" + Fixture.parentPath + "/" + id + ".html")])].sort();
    assert.deepEqual(result.discoveredTargets, expected); assert.deepEqual(Fetch.discoveryTargets(result.original, { now, navigation: false }), expected); assert.equal(result.requests, 1); assert.equal(result.assortmentComplete, false);
  });
  await test("native navigation rejects forged original and product mode switch; legacy header hints grant no parent children", async () => {
    const result = (await capture(Fixture.parent())).result;
    assert.deepEqual(Fetch.discoveryTargets(result.original, { now, navigation: true }), result.discoveredTargets);
    assert.throws(() => Fetch.discoveryTargets({ body: result.original.body, meta: { ...result.original.meta, sourceResponseHash: "0".repeat(64) } }, { now, navigation: true }));
    assert.deepEqual(Fetch.discoveryTargets(result.original, { now, navigation: false }), Fetch.navigationTargets(result.original.body));
    assert(Fetch.discoveryTargets(result.original, { now, navigation: false }).every(url => !result.navigation.discoveredTargets.includes(url)));
    const leaf = (await capture(Fixture.leaf())).result; assert.throws(() => Fetch.discoveryTargets(leaf.original, { now, navigation: true }));
  });
  for (const [name, change] of [
    ["unknown template", n => n.props.pageProps.page["mgnl:template"] = "unproven-parent"],
    ["missing children", n => n.props.pageProps.apiData = "[]"],
    ["empty children", n => mutateContext(n, entries => entries[0][1].res = [])],
    ["hidden children", n => mutateContext(n, entries => entries[0][1].res.forEach(row => row.hideInCategory = true))],
    ["wrong request", n => mutateContext(n, entries => entries[0][1].req.categoryPath += "/other")],
    ["duplicate native children", n => mutateContext(n, entries => entries[0][1].res.push(structuredClone(entries[0][1].res[0])))],
    ["over-bound native children", n => mutateContext(n, entries => entries[0][1].res = Array.from({ length: 129 }, (_, i) => Fixture.childRow("test-" + i)))],
    ["foreign reference", n => mutateContext(n, entries => entries[0][1].res[0].reference.path = "https://other.example/child")],
    ["grandchild reference", n => mutateContext(n, entries => entries[0][1].res[0].reference.path = Fixture.parentPath + "/other/" + Fixture.childIds[0])],
    ["different locale", n => n.props.pageProps.locale = "en"],
    ["actual source error", n => n.props.pageProps.hasError = true],
    ["missing null index", n => delete n.props.pageProps.algoliaState],
    ["empty invalid index", n => n.props.pageProps.algoliaState = {}]
  ]) await test("unsupported parent " + name + " retains genuine error and never becomes a blank product page", async () => {
    const value = Fixture.parent(change); await rejected(value, {}, error => {
      assert.equal(error.requestStarted, true); assert(error.code.startsWith("aldi-category-")); assert(error.rejectedCapture); assert.equal(error.rejectedCapture.original.body, value.body); assert.equal(error.rejectedCapture.original.meta.sourceResponseHash, sha(value.body)); assert(!Object.keys(error).includes("rejectedCapture"));
      assert.equal(Rejected.validateCapture(error.rejectedCapture, { now }).failureCode, error.code);
    });
  });
  await test("a no-index leaf is still a genuine rejection, never parent fallback", async () => {
    const value = Fixture.leaf(n => n.props.pageProps.algoliaState = null); await rejected(value, {}, error => { assert.equal(error.code, "aldi-category-native-index-conflict"); assert(error.rejectedCapture); });
  });
  await test("canonical mismatch and malformed NEXT_DATA remain original source failures", async () => {
    const value = Fixture.parent(); const bad = Fixture.original(value.body.replace(Fixture.parentUrl, "https://www.aldi-nord.de/sortiment/other.html"));
    await rejected(bad, {}, error => { assert.equal(error.code, "aldi-category-source-canonical-conflict"); assert(error.rejectedCapture); });
    await rejected(Fixture.original(value.body.replace('type="application/json"', 'type="text/plain"')), {}, error => { assert.equal(error.code, "aldi-category-next-data-required"); assert(error.rejectedCapture); });
  });
  for (const [name, headers] of [
    ["missing Date", { "content-type": "text/html", age: "0" }],
    ["expired Date", { ...Fixture.headers(), date: new Date(now - 300001).toUTCString() }],
    ["future Date", { ...Fixture.headers(), date: new Date(now + 301000).toUTCString() }],
    ["expired Age", { ...Fixture.headers(), age: "301" }],
    ["invalid Age", { ...Fixture.headers(), age: "unknown" }]
  ]) await test("parent transport " + name + " cannot admit navigation", async () => {
    const value = Fixture.parent(); await rejected(value, { response: new Response(value.body, { status: 200, headers }) }, error => { assert(error.requestStarted); if (error.rejectedCapture) assert.throws(() => Rejected.validateCapture(error.rejectedCapture, { now })); });
  });
  await test("absent Age is preserved null with valid native Date", async () => {
    const value = Fixture.parent(), { result } = await capture(value, { response: new Response(value.body, { headers: Fixture.headers(now, null) }) }); assert.equal(result.original.meta.sourceAgeSeconds, null); assert.equal(result.navigation.categoryProof.sourceAgeSeconds, null);
  });
  for (const status of [403, 429, 500, 404, 301]) await test("HTTP" + status + " never falls back to any child or alternate URL", async () => {
    await rejected(Fixture.parent(), { response: new Response("SYNTHETIC refused", { status, headers: { "retry-after": "691200" } }) }, error => { assert.equal(error.code, "aldi-category-http-" + status); assert.equal(error.status, status); assert.equal(error.retryAfterMs, 8 * 86400000); assert.equal(error.rejectedCapture, undefined); });
  });
  await test("max Retry-After remains exact instead of shortening the shared hold", async () => {
    await rejected(Fixture.parent(), { response: new Response("SYNTHETIC refused", { status: 429, headers: { "retry-after": "99999999999999999999999999" } }) }, error => assert.equal(error.retryAfterMs, 8640000000000000 - now));
  });
  await test("one redirected or oversized parent response stops without alternate requests", async () => {
    const value = Fixture.parent(), wrongURL = new Response(value.body, { headers: Fixture.headers() }); Object.defineProperty(wrongURL, "url", { value: "https://other.example/parent" });
    await rejected(value, { response: wrongURL }, error => assert.equal(error.code, "aldi-category-response-url-conflict"));
    await rejected(value, { response: new Response(value.body, { headers: Fixture.headers() }), fetchOptions: { maxBytes: 10 } }, error => assert.equal(error.code, "aldi-category-response-byte-budget"));
    await rejected(value, { response: new Response(new Uint8Array([0xff]), { headers: Fixture.headers() }) }, error => assert.equal(error.code, "aldi-category-response-utf8-required"));
  });
  await test("default timeout schedules bounded15s and aborts only the attempted original request", async () => {
    const originalSet = global.setTimeout, originalClear = global.clearTimeout, scheduled = []; let fetched = 0, signal;
    try {
      global.setTimeout = (fn, milliseconds) => { const id = { fn, milliseconds, cleared: false }; scheduled.push(id); return id; }; global.clearTimeout = id => { id.cleared = true; };
      const pending = Fetch.fetchPage(Fixture.parentUrl, { now: () => now, fetchImpl: async (_url, request) => { fetched++; signal = request.signal; return new Promise((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new Error("SYNTHETIC timeout")), { once: true })); } });
      assert.equal(scheduled.length, 1); assert.equal(scheduled[0].milliseconds, 15000); scheduled[0].fn(); await assert.rejects(pending, error => error.code === "aldi-category-fetch-failed" && error.requestStarted === true); assert.equal(fetched, 1); assert.equal(signal.aborted, true); assert.equal(scheduled[0].cleared, true);
    } finally { global.setTimeout = originalSet; global.clearTimeout = originalClear; }
  });
  await test("explicit timeout overrides stay inside the existing transport cap", async () => {
    let fetched = 0; await assert.rejects(Fetch.fetchPage(Fixture.parentUrl, { timeoutMs: 30001, fetchImpl: async () => { fetched++; } }), { code: "aldi-category-request-budget-invalid" }); assert.equal(fetched, 0);
    const value = Fixture.parent(), result = await capture(value, { fetchOptions: { timeoutMs: 1000 } }); assert.equal(result.result.requests, 1);
  });
  await test("native child target bound and source rejection apply before discovery can expand", async () => {
    const value = Fixture.parent(n => mutateContext(n, entries => entries[0][1].res = Array.from({ length: 128 }, (_, i) => Fixture.childRow("test-" + i)))), result = (await capture(value)).result;
    assert.equal(result.discoveredTargets.length, 128); assert.equal(new Set(result.discoveredTargets).size, 128);
    assert(result.discoveredTargets.every(url => url.startsWith("https://www.aldi-nord.de/sortiment/milchprodukte/") && url.endsWith(".html")));
    const forged = { body: result.original.body, meta: { ...result.original.meta, sourceResponseUrl: result.original.meta.sourceResponseUrl + "?access_token=private" } }; assert.throws(() => Fetch.discoveryTargets(forged, { now, navigation: true }));
  });
  await test("leaf union larger than256 fails closed without truncating or inventing targets", async () => {
    const value = Fixture.leaf(n => { n.props.pageProps.page.header = [{ sideDrawerNavigation: [{ Produkte: { children: Array.from({ length: 253 }, (_, i) => ({ path: "https://www.aldi-nord.de/sortiment/unit-test-" + i + ".html" })) } }] }]; });
    const proof = { ...value.meta, sourceResponseDate: new Date(now).toUTCString() }; assert.throws(() => Fetch.discoveryTargets({ body: value.body, meta: proof }, { now, navigation: false }), error => /bound|targets-invalid/.test(error.code));
  });
  await test("malformed sibling context cannot create new references or mask an original product page", async () => {
    const value = Fixture.leaf(n => mutateContext(n, entries => entries[0][1].res[0].reference.path = "https://other.example/child"));
    assert.equal(ProductParser.parsePage(value.body, value.meta, { now }).candidateCount, 1);
    const validatedHeader = Fetch.navigationTargets(value.body);
    const result = await capture(value); assert.deepEqual(result.result.discoveredTargets, validatedHeader, "Unsafe siblings confer zero new targets; the separately valid product page remains"); assert.equal(result.result.page.candidateCount, 1);
  });
  console.log(`aldi-category-navigation-fetch: ${groups} offline mock transport/discovery groups passed; no native requests, no SQL`);
})().catch(error => { console.error(error); process.exitCode = 1; });
