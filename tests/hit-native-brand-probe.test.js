"use strict";
const assert = require("node:assert/strict"), Probe = require("../hit-native-brand-probe"), Fixture = require("./fixtures/hit-brand-probe");
const now = Date.parse("2026-10-02T03:30:00.000Z"), cases = [], test = (name, run) => cases.push({ name, run });
const prepared = options => { const value = Fixture.page({ now, ...options }); return { value, control: Probe.prepareControl(value.body, value.meta, { now }) }; };
const diagnose = options => { const { control } = prepared(); return Probe.record(control, { filtered: Fixture.page({ now: now + 1000, filtered: true, ...options }), error: null }, { now: now + 1000 }); };
test("exact native guest category and smaller complete SKU subset confirm only HTML filtering", () => {
  const result = Fixture.record({ now }); assert.equal(result.outcome, "confirmed"); assert.equal(result.actualHTMLFilterVerified, true);
  for (const key of ["collectionEnabled", "priceImportEnabled", "complete"]) assert.equal(result[key], false);
  assert.equal(result.control.skuIds.length, 3); assert.equal(result.filtered.skuIds.length, 2); assert.equal(result.facet.count, 2);
  assert.deepEqual(Probe.validateRecord(JSON.parse(JSON.stringify(result)), { now: now + 1000 }), result);
  assert(!JSON.stringify(result).includes('"gtin"')); assert(!JSON.stringify(result).includes('"price"'));
});
test("record validation rebuilds flags, native facet and SKU arrays from actual bodies", () => {
  const raw = Fixture.record({ now }); raw.outcome = "inconclusive"; raw.actualHTMLFilterVerified = false; raw.collectionEnabled = true; raw.priceImportEnabled = true; raw.complete = true;
  raw.control.skuIds = ["invented"]; raw.filtered.skuIds = ["invented"]; raw.facet = { id: "invented", count: 999 }; raw.category = { id: "1", total: 999 };
  const result = Probe.validateRecord(raw, { now: now + 1000 }); assert.equal(result.outcome, "confirmed"); assert.equal(result.complete, false); assert.equal(result.facet.id, "Synthetic A"); assert.equal(result.control.skuIds.length, 3);
});
test("proposals require immutable control capability and never widen ordinary request URLs", () => {
  const { control } = prepared(), proposed = Probe.proposal(control), url = new URL(proposed.requestedUrl);
  assert.deepEqual([...url.searchParams], [["for_store", "1775"], ["for_category", "4261891"], ["for_brands", "Synthetic A"]]);
  assert.equal(Probe.authorizeRequest(control, url.href), true); assert.equal(Probe.authorizeRequest({}, url.href), false); assert.equal(Probe.authorizeRequest(control, url.href + "&page=1"), false);
  assert.throws(() => Probe.proposal(structuredClone(control))); assert(Object.isFrozen(control)); assert(Object.isFrozen(proposed.facet));
});
test("ignored HTML query or altered/missing native echo cannot confirm a filter", () => {
  for (const echo of [undefined, "Other", [], ["Synthetic A", "Other"], ["Other"], 2, { id: "Synthetic A" }]) {
    const result = diagnose({ edit: (_data, params) => { if (echo === undefined) delete params.for_brands; else params.for_brands = echo; } }); assert.equal(result.outcome, "inconclusive"); assert.equal(result.actualHTMLFilterVerified, false);
  }
  assert.equal(diagnose({ edit: (_data, params) => { params.for_brands = ["Synthetic A"]; } }).outcome, "confirmed");
  const original = Fixture.page({ now: now + 1000 }), { control } = prepared(); original.meta.requestUrl = original.meta.sourceResponseUrl = Probe.proposal(control).requestedUrl;
  assert.equal(Probe.record(control, { filtered: original, error: null }, { now: now + 1000 }).outcome, "inconclusive");
});
test("wrong guest head, row store, native params, category and URL stay inconclusive with original body", () => {
  for (const edit of [(data) => { data.data[0].storeId = 1729; }, (data) => { data.data[0].storeNumber = "054"; }, (_data, params) => { params.for_store = 1729; }, (_data, params) => { params.for_category = "4261892"; }, (data) => { data.meta.category.name = "Wrong category"; }]) {
    const result = diagnose({ edit }); assert.equal(result.outcome, "inconclusive"); assert(result.filtered.body.includes("data-component"));
  }
  assert.equal(diagnose({ transform: body => body.replace('data-store="258"', 'data-store="054"') }).outcome, "inconclusive");
  for (const patchMeta of [{ sourceResponseUrl: Fixture.controlUrl }, { requestUrl: Fixture.controlUrl }, { storeProfile: { ...Fixture.storeProfile, storeId: 1729 } }]) assert.equal(diagnose({ patchMeta }).outcome, "inconclusive");
});
test("unknown, duplicate and malformed native SKUs never prove a subset", () => {
  for (const edit of [(data) => { data.data[0].external_id = "999ST"; }, (data) => { data.data[1].external_id = data.data[0].external_id; }, (data) => { data.data[0].external_id = "1"; }, (data) => { data.data.pop(); }]) assert.equal(diagnose({ edit }).outcome, "inconclusive");
});
test("native count conflicts, zero, truncated and nonshrinking filtered lists stay unconfirmed", () => {
  for (const edit of [(data) => { data.meta.category.count = 3; }, (data) => { data.filters.categories = [{ id: "4261891", count: 3 }]; }, (data) => { data.pagination.total = 1; data.data.pop(); data.meta.category.count = 1; }, (data) => { data.pagination.page = 1; }, (data) => { data.pagination.limit = 1; data.data.pop(); }]) assert.equal(diagnose({ edit }).outcome, "inconclusive");
});
test("future, stale, cache, hash, byte, status, media and redirect proof errors remain original diagnostics", () => {
  const patches = [{ capturedAt: new Date(now + 600000).toISOString(), responseDate: new Date(now + 600000).toUTCString() }, { responseDate: new Date(now - 600000).toUTCString() }, { responseAgeSeconds: 301, responseAgeRaw: "301" }, { responseAgeSeconds: NaN, responseAgeRaw: "broken" }, { responseAgeRaw: "0.0" }, { sourceResponseHash: "0".repeat(64) }, { responseBytes: 1 }, { responseStatus: 403 }, { responseContentType: "application/json" }, { responseContentType: "application/x-text/html" }, { redirects: [{ status: 302 }] }, { anonymous: false }, { retried: true }];
  for (const patchMeta of patches) {
    const result = diagnose({ patchMeta }); assert.equal(result.outcome, "inconclusive"); assert.equal(result.actualHTMLFilterVerified, false);
    assert.equal(Probe.validateRecord(JSON.parse(JSON.stringify(result)), { now: now + 1000 }).outcome, "inconclusive");
  }
});
test("complete controls need distinct valid SKUs and precise native count/date/store proof", () => {
  for (const edit of [(data) => { data.data.pop(); }, (data) => { data.data[1].external_id = data.data[0].external_id; }, (data) => { data.meta.category.count = 4; }, (data) => { data.pagination.total = 41; }, (_data, params) => { params.for_brands = "Synthetic A"; }, (data) => { data.filters.brands = [{ id: "A", key: "A", label: "A", count: 0 }]; }]) assert.throws(() => prepared({ edit }));
  for (const patchMeta of [{ responseAgeSeconds: 301, responseAgeRaw: "301" }, { capturedAt: new Date(now + 600000).toISOString() }, { redirects: [{ status: 302 }] }, { anonymous: false }, { requestUrl: Fixture.controlUrl + "?page=1" }]) assert.throws(() => prepared({ patchMeta }));
});
test("even a one-millisecond future capture is refused, independently of the HTTP-Date tolerance", () => {
  assert.throws(() => prepared({ patchMeta: { capturedAt: new Date(now + 1).toISOString() } }), /capture-time/);
  assert.equal(diagnose({ patchMeta: { capturedAt: new Date(now + 1001).toISOString() } }).outcome, "inconclusive");
});
test("malformed and contradictory brand facets cannot authorize a URL", () => {
  for (const brands of [null, {}, [{ id: "A", key: "A", label: "A", count: "2" }], [{ id: "A,B", key: "A,B", label: "A,B", count: 2 }], [{ id: "A", key: "A", label: "A", count: 2 }, { id: "A", key: "A", label: "B", count: 2 }]]) assert.throws(() => prepared({ edit: data => { data.filters.brands = brands; } }));
});
test("real refusals and transport failures are attempted diagnostic records", () => {
  for (const status of [403, 429]) {
    const raw = Fixture.record({ now, outcome: "source-refused", status }); assert.equal(raw.outcome, "source-refused"); assert.equal(raw.filtered, null); assert.equal(raw.error.retryAfterMs, 7200000);
    assert.deepEqual(Probe.validateRecord(raw, { now }), raw); raw.error.responseStatus = status === 403 ? 429 : 403; assert.throws(() => Probe.validateRecord(raw, { now }));
  }
  const raw = Fixture.record({ now, outcome: "failed" }); assert.equal(raw.outcome, "failed"); assert.deepEqual(Probe.validateRecord(raw, { now }), raw);
});
test("private headers, cookies and metadata extras are absent from persisted records", () => {
  const raw = Fixture.record({ now, control: { patchMeta: { headers: { Cookie: "SECRET" }, cookieJar: "SECRET" } }, filtered: { patchMeta: { headers: { Cookie: "SECRET" } } } });
  assert(!JSON.stringify(raw).includes("SECRET")); assert(!Object.hasOwn(raw.control.meta, "headers"));
  raw.requestedUrl += "&page=1"; assert.throws(() => Probe.validateRecord(raw, { now: now + 1000 }));
});
const failures = []; for (const { name, run } of cases) try { run(); } catch (error) { failures.push(name + ": " + error.stack); }
if (failures.length) { console.error(failures.join("\n\n")); process.exitCode = 1; } else console.log("hit-native-brand-probe: OK (" + cases.length + " offline source-binding cases)");
