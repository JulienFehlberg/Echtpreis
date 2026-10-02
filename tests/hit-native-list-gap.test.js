"use strict";
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const Gap = require("../hit-native-list-gap"), F = require("./fixtures/hit-list-gap");
const Native = require("../hit-assortment-client"), Collector = require("../hit-assortment-collector");
const tests = [], test = (name, fn) => tests.push({ name, fn }), at = { now: F.NOW };
function rejected(page, node = F.node(), pattern = /(?:gap-|hit-native-)/) { assert.throws(() => Gap.record(page, node, at), pattern); }
test("identical repetition remains fully excluded and its exact original is retained", () => {
  const page = F.page(), record = Gap.record(page, F.node(), at), result = Gap.isolate(F.cursor(), record, at);
  assert.deepEqual(record.duplicates, [{ sku: F.sku(1), indexes: [0, 1], kind: "identical-native-row" }]);
  assert.equal(result.originalRecord.original.body, page.body); assert.deepEqual(result.accepted, []); assert.deepEqual(result.children, []);
  assert.equal(result.cursor.received, 1); assert.deepEqual(result.cursor.seenSkus, [F.sku(9)]); assert.equal(result.sourceError.retryAfterMs, 3600000);
});
test("malformed native SKU excludes every row, including a valid independently parsed price", () => {
  const page = F.page({ rows: [F.row(1), { ...F.row(2), external_id: "invalid" }] }), record = Gap.record(page, F.node(), at);
  assert.equal(Native.parsePage(page.body, page.meta).accepted.length, 1); assert.deepEqual(record.invalidSkuIndexes, [1]);
  assert.equal(Gap.isolate(F.cursor(), record, at).accepted.length, 0);
});
test("metadata-different duplicates are classified without inventing a SKU identity", () => {
  const page = F.page({ rows: [F.row(1), { ...F.row(1), inventoryUpdatedAt: "SYNTHETIC changed inventory" }] });
  assert.equal(Gap.record(page, F.node(), at).duplicates[0].kind, "different-native-row");
});
test("conflicting native quotes stay in the existing identity-quarantine path", () => {
  const conflicting = { ...F.row(1), price: "1.35", priceTag: { ...F.row(1).priceTag, priceCent: "35" } };
  rejected(F.page({ rows: [F.row(1), conflicting] }), F.node(), /requires-existing-quarantine/);
  rejected(F.page({ rows: [F.row(1), conflicting, { ...F.row(2), external_id: "invalid" }] }), F.node(), /requires-existing-quarantine/);
});
test("valid distinct native SKUs never enter a diagnostic gap", () => rejected(F.page({ rows: [F.row(1), F.row(2)] }), F.node(), /guard-would-not-fail/));
test("a conflicting duplicate cannot hide a hard wrong-store row", () => rejected(F.page({ rows: [F.row(1), { ...F.row(1), storeId: 1729, storeNumber: "054" }] })));
test("null and primitive native rows cannot prove a store-bound isolated gap", () => { for (const row of [null, 42, "invalid"]) rejected(F.page({ rows: [F.row(1), row] })); });
test("missing, changed, filtered or incoherent native request echo fails closed", () => {
  for (const edit of [(_data, p) => delete p.for_store, (_data, p) => { p.for_store = 1729; }, (_data, p) => { p.for_category = "4261911"; },
    (_data, p) => { p.for_brands = "unproven"; }, (_data, p) => { p.limit = 20; }, (_data, p) => { p.return_exact_match = 1; }]) rejected(F.page({ edit }));
});
test("category self-ID, literal URL and native count must agree", () => {
  for (const edit of [(d) => { d.meta.category.id = "4261911"; }, (d) => { d.meta.category.url = "/sortiment/other-category-4261891"; },
    (d) => { d.meta.category.count = 9; }, (d) => { d.filters.categories[0].count = 9; }, (d) => { d.meta.is_exact_match = "true"; }, (d) => { delete d.meta.category; }]) rejected(F.page({ edit }));
});
test("native guest/head/store context cannot be supplied by caller flags alone", () => {
  for (const transform of [body => body.replace('data-store="258"', 'data-store="054"'), body => body.replace('data-hit-konto=""', 'data-hit-konto="123"'),
    body => body.replace(/<head[^>]*><\/head>/, ""), body => body.replace('<head ', '<head data-store="258" ')]) rejected(F.page({ transform }));
});
test("original body hash and bytes are rechecked, including tampering after capture", () => {
  for (const patchMeta of [{ sourceResponseHash: "0".repeat(64) }, { responseBytes: 1 }]) rejected(F.page({ patchMeta }));
  const page = F.page(); page.body += "<!--changed-->"; rejected(page);
});
test("future +1ms and older-than-five-minute captures cannot authorize isolation", () => {
  rejected(F.page({ now: F.NOW + 1 }), F.node(), /capture-stale-or-future/); rejected(F.page({ now: F.NOW - 300001 }), F.node(), /capture-stale-or-future/);
});
test("Date/Age evidence must be fresh, strict and bound to the exact original", () => {
  for (const patchMeta of [{ responseDate: null }, { responseDate: new Date(F.NOW - 600000).toUTCString() }, { responseDate: new Date(F.NOW + 1000).toUTCString() },
    { responseAgeSeconds: 301, responseAgeRaw: "301" }, { responseAgeSeconds: "0" }, { responseAgeSeconds: 0, responseAgeRaw: "broken" },
    { responseAgeSeconds: 1, responseAgeRaw: "0" }, { responseAgeSeconds: 0, responseAgeRaw: null }]) rejected(F.page({ patchMeta }));
});
test("redirect, wrong final URL, refusal, non-HTML and nonanonymous responses cannot be isolated", () => {
  for (const patchMeta of [{ redirects: [{ status: 302 }] }, { sourceResponseUrl: F.node("4261911").url }, { requestUrl: F.node("4261911").url },
    { responseStatus: 403 }, { responseStatus: 429 }, { responseContentType: "application/json" }, { anonymous: false }, { retried: true }]) rejected(F.page({ patchMeta }));
});
test("malformed pagination and short/ignored listing bodies retain global hard-failure behavior", () => {
  for (const edit of [d => { d.pagination.page = 1; }, d => { d.pagination.total = 3; }, d => { d.pagination.limit = 0; }]) rejected(F.page({ edit }));
});
test("an overview or arbitrary source URL cannot masquerade as a category gap", () => {
  for (const node of [{ ...F.node(), id: null }, { ...F.node(), url: "https://www.hit.de/sortiment/uebersicht" },
    { ...F.node(), url: F.node().url + "?page=1" }, { ...F.node(), url: "https://evil.example/sortiment/synthetic-category-4261891" }]) rejected(F.page(), node);
});
test("all category levels exclude children and explicitly expose a parent subtree gap", () => {
  for (const level of [1, 2, 3]) {
    const node = F.node("4261891", level), child = F.node("4261912", level === 3 ? 3 : level + 1), page = F.page({ category: node,
      edit: d => { d.filters.categories.push({ ...child, parentId: node.id }); } });
    const record = Gap.record(page, node, at), result = Gap.isolate(F.cursor([node, F.node("4261911")]), record, at);
    assert.equal(record.unresolvedSubtree, level < 3); assert.deepEqual(result.children, []); assert.deepEqual(result.cursor.visited.at(-1).children, []);
    assert.deepEqual(result.cursor.pending.map(node => node.id), ["4261911"]); assert.equal(result.cursor.categoryCoverage.unresolvedNodes.length, 1);
  }
});
test("only the exact pending node moves; original queues, quote signatures and quarantine remain immutable", () => {
  const prior = F.cursor([F.node("4261911"), F.node(), F.node("4261912")]), gtin = F.row(9).ean;
  prior.conflictGtins = [gtin]; prior.visited[0].conflictGtins = [gtin]; prior.seenQuotes.test = { gtin, signature: "a".repeat(64) };
  const before = F.clone(prior), result = Gap.isolate(prior, Gap.record(F.page(), F.node(), at), at);
  assert.deepEqual(prior, before); assert.deepEqual(result.cursor.pending, [before.pending[0], before.pending[2]]); assert.deepEqual(result.cursor.seenQuotes, before.seenQuotes);
  assert.deepEqual(result.cursor.conflictGtins, [gtin]); assert.equal(result.cursor.pagesFetched, 2); assert.equal(result.cursor.received, 1);
  Collector.cursorFor(JSON.parse(JSON.stringify(result.cursor)), Gap.STORE, result.cursor.cursorDay);
});
test("a changed cross-page quote cannot be hidden in an isolated category", () => {
  const prior = F.cursor(), row = F.row(1); prior.seenQuotes[row.ean + "|g|500|1"] = { gtin: row.ean, signature: "a".repeat(64) };
  assert.throws(() => Gap.isolate(prior, Gap.record(F.page(), F.node(), at), at), /cross-page-conflict-requires-existing-quarantine/);
});
test("canonical reconstruction rejects fabricated IDs, classifications, count or eligibility flags", () => {
  const record = Gap.record(F.page(), F.node(), at);
  for (const mutate of [r => { r.id = "0".repeat(64); }, r => { r.duplicates = []; }, r => { r.category.rowCount = 99; }, r => { r.priceImportEnabled = true; }, r => { r.complete = true; }]) {
    const changed = F.clone(record); mutate(changed); assert.throws(() => Gap.validateRecord(changed, at), /recomputed-record-conflict/);
  }
});
test("public summary excludes full HTML, rows, SKU arrays, cookies and headers", () => {
  const page = F.page({ patchMeta: { cookies: ["SYNTHETIC secret"], headers: { Authorization: "SYNTHETIC secret" } } });
  const record = Gap.record(page, F.node(), at), text = JSON.stringify(Gap.summarize(record, at));
  assert(!text.includes("SYNTHETIC secret")); assert(!text.includes("<html>")); assert(!text.includes(F.sku(1))); assert(!Object.hasOwn(record.original.meta, "headers"));
});
test("one verified empty restqueue can settle after cooldown without a request, import or completeness claim", () => {
  const record = Gap.record(F.page(), F.node(), at), isolated = Gap.isolate(F.cursor([F.node()]), record, at), retryAfter = new Date(F.NOW + 3600000).toISOString();
  const result = Gap.terminal(isolated.cursor, { now: F.NOW + 3600000, retryAfter, archivedRecords: [record] });
  assert.equal(result.requests, 0); assert.deepEqual(result.accepted, []); assert.deepEqual(result.pages, []); assert.equal(result.cursor, null);
  assert.equal(result.complete, true, "This existing internal flag means the queue ended, never assortment completeness");
  assert.equal(result.categoryCoverage.unresolvedNodes.length, 1); assert.equal(result.nativePaginationComplete, false); assert.equal(result.publishedTraversalComplete, false);
  assert.equal(result.physicalStoreAssortmentComplete, false); assert.equal(record.original.meta.capturedAt, new Date(F.NOW).toISOString());
});
test("terminal transition fails before cooldown, with remaining nodes, missing or tampered originals", () => {
  const record = Gap.record(F.page(), F.node(), at), isolated = Gap.isolate(F.cursor([F.node()]), record, at), retryAfter = new Date(F.NOW + 3600000).toISOString();
  const options = { now: F.NOW + 3600000, retryAfter, archivedRecords: [record] };
  assert.throws(() => Gap.terminal(isolated.cursor, { ...options, now: F.NOW + 3599999 }), /not-ready/);
  assert.throws(() => Gap.terminal(Gap.isolate(F.cursor(), record, at).cursor, options), /not-ready/);
  assert.throws(() => Gap.terminal(isolated.cursor, { ...options, archivedRecords: [] }), /original-ledger-required/);
  const changed = F.clone(record); changed.original.body += "<!--tampered-->"; assert.throws(() => Gap.terminal(isolated.cursor, { ...options, archivedRecords: [changed] }), /original-body-conflict/);
});
test("same Berlin day during DST does not extend the original diagnostic capture beyond 24 hours", () => {
  const capture = Date.parse("2025-10-25T22:05:00Z"), now = Date.parse("2025-10-26T22:10:00Z"), node = F.node();
  const record = Gap.record(F.page({ now: capture }), node, { now: capture }), isolated = Gap.isolate(F.cursor([node], capture), record, { now: capture });
  assert.throws(() => Gap.terminal(isolated.cursor, { now, retryAfter: new Date(capture + 3600000).toISOString(), archivedRecords: [record] }), /original-ledger-required/);
});
test("strict cursor markers cannot invent admitted rows, children, conflicts or unproved gap identifiers", () => {
  const record = Gap.record(F.page(), F.node(), at), isolated = Gap.isolate(F.cursor(), record, at);
  for (const mutate of [v => { v.quarantinedListing = false; }, v => { v.gapId = "invalid"; }, v => { delete v.gapId; },
    v => { v.uniqueRowCount = 1; }, v => { v.children = ["4261912"]; }, v => { v.unresolved = false; }, v => { v.unresolvedReason = "other"; },
    v => { v.conflictGtins = [F.row(1).ean]; }, v => { v.id = null; }, v => { v.level = null; }, v => { v.rowCount = 0; }]) {
    const state = F.clone(isolated.cursor); mutate(state.visited.at(-1));
    assert.throws(() => Collector.cursorFor(state, Gap.STORE, state.cursorDay), /continuation-cursor-conflict/);
  }
  const invented = F.cursor(); invented.visited[0].gapId = record.id;
  assert.throws(() => Collector.cursorFor(invented, Gap.STORE, invented.cursorDay), /continuation-cursor-conflict/);
});
test("Berlin day rollover never reuses an old gap as new source evidence", () => {
  const record = Gap.record(F.page(), F.node(), at), isolated = Gap.isolate(F.cursor([F.node()]), record, at), tomorrow = F.NOW + 86400000;
  assert.throws(() => Gap.terminal(isolated.cursor, { now: tomorrow, retryAfter: new Date(F.NOW + 3600000).toISOString(), archivedRecords: [record] }), /not-ready/);
  assert.throws(() => Gap.isolate(F.cursor([F.node()], tomorrow), record, { now: tomorrow }), /capture-stale-or-future/);
  assert.equal(record.original.meta.capturedAt, new Date(F.NOW).toISOString(), "Archived original never receives a new capture/expiry");
});
(async () => { for (const { name, fn } of tests) { await fn(); console.log("PASS " + name); } console.log(JSON.stringify({ tests: tests.length, passed: tests.length, sourceRequests: 0, mode: "original-listing-gap-unit" })); })().catch(error => { console.error(error); process.exitCode = 1; });
