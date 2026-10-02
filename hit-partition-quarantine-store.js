"use strict";

// Append-only native conflict evidence. No source access, expiry or unblock API.
// The caller owns the actual import/checkpoint transaction and rolls it back.
const crypto = require("node:crypto"), same = require("node:util").isDeepStrictEqual;
const Gate = require("./hit-partition-admission-gate"), Admission = require("./hit-partition-admission-store");
const Native = require("./hit-assortment-client"), Import = require("./hit-price-import");
const Discovery = require("./price-query-discovery"), Cycle = require("./hit-refresh-cycle"), Collector = require("./hit-assortment-collector");
const TABLE = "hit_partition_quarantine_events", BLOCK_TABLE = "hit_partition_quarantine_gtins", REF_TABLE = "hit_partition_quarantine_refs";
const MAX_RECORDS = 256, MAX_BYTES = 64 * 1024 * 1024, MAX_EVENT_BYTES = 24 * 1024 * 1024, MAX_BODY_BYTES = 6 * 1024 * 1024;
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const encode = value => JSON.stringify(sorted(value));
const fail = suffix => Object.assign(new Error("hit-partition-quarantine-" + suffix), { code: "hit-partition-quarantine-" + suffix });
const stamp = value => value == null ? null : new Date(value).toISOString();
function clock(now) { if (!Number.isSafeInteger(now) || now < 0) throw fail("explicit-clock-required"); return now; }
function client(tx) { if (!tx || typeof tx.query !== "function" || typeof tx.release !== "function") throw fail("transaction-client-required"); }
const schemaJobs = new WeakMap();
async function ensure(pool) {
  // Only cache a pool's committed implicit schema transaction. A borrowed client
  // may belong to an outer transaction which subsequently rolls back its DDL.
  const cacheable = typeof pool?.connect === "function";
  if (cacheable && schemaJobs.has(pool)) return schemaJobs.get(pool);
  const job = pool.query(`SELECT pg_advisory_xact_lock(hashtext('HIT partition quarantine schema'));
    CREATE TABLE IF NOT EXISTS ${TABLE}(
      event_id text PRIMARY KEY CHECK(event_id~'^[a-f0-9]{64}$'),batch_fingerprint text NOT NULL CHECK(batch_fingerprint~'^[a-f0-9]{64}$'),
      source_id text NOT NULL CHECK(source_id='HIT Berlin store assortment'),native_store_id int NOT NULL CHECK(native_store_id=1775),
      native_store_number text NOT NULL CHECK(native_store_number='258'),scope_country text NOT NULL CHECK(scope_country='DE'),
      scope_channel text NOT NULL CHECK(scope_channel='physical-store'),ordinary_cycle_id uuid NOT NULL,
      reason text NOT NULL CHECK(reason IN ('gtin-sales-pack-disagreement','exact-native-quote-disagreement','native-sku-identity-disagreement')),
      captured_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL,payload jsonb NOT NULL,
      payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),record_bytes int NOT NULL CHECK(record_bytes>0 AND record_bytes<=25165824));
    CREATE TABLE IF NOT EXISTS ${BLOCK_TABLE}(event_id text NOT NULL REFERENCES ${TABLE}(event_id),
      gtin text NOT NULL CHECK(gtin~'^(?:[0-9]{8}|[0-9]{12,14})$'),PRIMARY KEY(event_id,gtin));
    CREATE TABLE IF NOT EXISTS ${REF_TABLE}(event_id text NOT NULL REFERENCES ${TABLE}(event_id),
      observation_id uuid NOT NULL REFERENCES price_observations(id),product_id uuid NOT NULL REFERENCES products(id),
      store_id uuid NOT NULL REFERENCES stores(id),PRIMARY KEY(event_id,observation_id));
    CREATE INDEX IF NOT EXISTS hit_partition_quarantine_gtin_idx ON ${BLOCK_TABLE}(gtin);
    CREATE INDEX IF NOT EXISTS hit_partition_quarantine_batch_idx ON ${TABLE}(batch_fingerprint);
    CREATE OR REPLACE FUNCTION hit_partition_quarantine_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'HIT partition quarantine records are immutable' USING ERRCODE='55000'; END $$;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='${TABLE}'::regclass AND tgname='hit_partition_quarantine_event_guard') THEN
        CREATE TRIGGER hit_partition_quarantine_event_guard BEFORE UPDATE OR DELETE ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION hit_partition_quarantine_immutable(); END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='${BLOCK_TABLE}'::regclass AND tgname='hit_partition_quarantine_gtin_guard') THEN
        CREATE TRIGGER hit_partition_quarantine_gtin_guard BEFORE UPDATE OR DELETE ON ${BLOCK_TABLE} FOR EACH ROW EXECUTE FUNCTION hit_partition_quarantine_immutable(); END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='${REF_TABLE}'::regclass AND tgname='hit_partition_quarantine_ref_guard') THEN
        CREATE TRIGGER hit_partition_quarantine_ref_guard BEFORE UPDATE OR DELETE ON ${REF_TABLE} FOR EACH ROW EXECUTE FUNCTION hit_partition_quarantine_immutable(); END IF;
    END $$;`);
  if (cacheable) schemaJobs.set(pool, job); try { await job; } catch (error) { if (cacheable) schemaJobs.delete(pool); throw error; }
}
async function lock(tx, now = null) {
  client(tx); const q = await tx.query('SELECT txid_current_if_assigned() IS NOT NULL AS "transactionOpen",floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS "nowMs"');
  if (q.rows[0]?.transactionOpen !== true) throw fail("open-writing-transaction-required");
  if (now !== null && Math.abs(clock(Number(q.rows[0].nowMs)) - clock(now)) > 300000) throw fail("database-clock-conflict");
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [Import.SOURCE + ":store:1775"]);
}
async function actualNow(tx) { return clock(Number((await tx.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS "nowMs"')).rows[0]?.nowMs)); }

// Original normal HTML, not a normalized quote sidecar, proves the new identity.
function ordinaryOriginal(value, result, now) {
  const { body, meta, node } = value || {}, at = Date.parse(meta?.capturedAt);
  if (typeof body !== "string" || Buffer.byteLength(body) > MAX_BODY_BYTES || !meta || !Number.isFinite(at) || at > now || now - at > 300000
    || meta.responseStatus !== 200 || !/^text\/html(?:\s*;|$)/i.test(meta.responseContentType || "")
    || meta.responseBytes !== Buffer.byteLength(body) || hash(body) !== meta.sourceResponseHash
    || meta.requestUrl !== meta.sourceResponseUrl || meta.anonymous !== true || meta.retried !== false || !Array.isArray(meta.redirects) || meta.redirects.length
    || !(meta.responseAgeRaw === null && meta.responseAgeSeconds === null || typeof meta.responseAgeRaw === "string" && /^\d+$/.test(meta.responseAgeRaw) && Number(meta.responseAgeRaw) === meta.responseAgeSeconds))
    throw fail("ordinary-original-required");
  if (Object.entries({ storeId: 1775, storeNumber: "258", name: "Berlin-Mitte", city: "Berlin", country: "DE" }).some(([key, expected]) => meta.storeProfile?.[key] !== expected)) throw fail("ordinary-store-conflict");
  const url = Collector.allowedUrl(meta.sourceResponseUrl, Import.STORE_PROFILE);
  const parsed = Native.parsePage(body, meta), extracted = Native.extractRows(body);
  const cleaned = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const heads = [...cleaned.matchAll(/<head\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)];
  if (heads.length !== 1) throw fail("ordinary-guest-store-required");
  const attrs = new Map(); for (const match of heads[0][1].matchAll(/([a-z_:][a-z\d_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const key = match[1].toLowerCase(); if (attrs.has(key)) throw fail("ordinary-guest-store-required"); attrs.set(key, match[2] ?? match[3]);
  }
  if (attrs.get("data-store") !== "258" || attrs.get("data-store-id") !== "1775" || attrs.get("data-hit-konto") !== "" || attrs.get("data-hit-admin") !== "") throw fail("ordinary-guest-store-required");
  const page = result.pages?.find(p => p.diagnosticOnly !== true && !p.gapId && ["sourceResponseUrl", "sourceResponseHash", "capturedAt"].every(key => p[key] === meta[key]));
  const skus = [...new Set(extracted.rows.map(row => row.external_id))], quoteRows = parsed.accepted.map(c => ({ retailerSku: c.retailerSku, key: Gate.quoteFor(c).key, quote: { gtin: c.gtin, signature: Gate.quoteFor(c).signature } }));
  if (!page || parsed.extractionKind !== "assortment-list" || extracted.pagination.page !== 0 || extracted.pagination.limit !== 40
    || !same(extracted.pagination, page.pagination) || page.rowCount !== extracted.rows.length || extracted.params?.for_store !== 1775
    || extracted.params?.limit !== 40 || extracted.params?.return_exact_match !== "1" || Object.keys(extracted.params).some(k => !["for_store", "for_category", "limit", "return_exact_match"].includes(k))
    || page.responseDate !== meta.responseDate || page.responseAgeSeconds !== meta.responseAgeSeconds || !same(skus, page.nativeAllSkuIds)
    || !same(quoteRows, page.nativeQuoteRows) || !same(quoteRows.map(({ key, quote }) => ({ key, quote })), page.nativeQuotes)
    || extracted.rows.some(row => row.storeId !== 1775 || row.storeNumber !== "258")
    || (page.categoryId === null ? node !== null || new URL(url).pathname !== "/sortiment/uebersicht" : !node || node.id !== page.categoryId || node.url !== meta.sourceResponseUrl || extracted.params?.for_category !== node.id))
    throw fail("ordinary-page-binding-conflict");
  const safeMeta = Object.fromEntries(["storeProfile", "capturedAt", "responseDate", "responseAgeSeconds", "sourceResponseHash", "sourceResponseUrl", "requestUrl", "responseStatus", "responseContentType", "responseBytes", "responseAgeRaw", "redirects", "anonymous", "retried"].map(k => [k, structuredClone(meta[k])]));
  safeMeta.storeProfile = Object.fromEntries(["storeId", "storeNumber", "name", "city", "country"].map(k => [k, meta.storeProfile[k]]));
  const safeNode = node === null ? null : Object.fromEntries(["id", "name", "url", "level", "count"].map(k => [k, node[k]]));
  // Whole-page parsing deliberately withholds contradictory rows. Reparse each
  // original row to prove the conflict itself, without admitting either price.
  const candidates = extracted.rows.map(row => Native.parseRow(row, meta)).filter(x => x.ok).map(x => x.candidate)
    .filter(c => Import.validateCandidate(c, { now, storeProfile: Import.STORE_PROFILE }).ok);
  return { original: { body, meta: safeMeta, node: safeNode }, candidates, conflictGtins: page.conflictGtins };
}
function pairReason(a, b, reason) {
  const qa = Gate.quoteFor(a.candidate), qb = Gate.quoteFor(b.candidate), samePack = Discovery.samePack(qa.pack, qb.pack);
  if (reason === "gtin-sales-pack-disagreement") return qa.gtin === qb.gtin && !samePack;
  if (reason === "native-sku-identity-disagreement") return a.candidate.retailerSku === b.candidate.retailerSku && (qa.gtin !== qb.gtin || !samePack);
  return reason === "exact-native-quote-disagreement" && qa.gtin === qb.gtin && samePack && qa.signature !== qb.signature
    && Cycle.validId(a.cycleId) && a.cycleId === b.cycleId;
}
async function evidence(tx, gtins) {
  const q = await tx.query(`SELECT row_to_json(e) AS evidence,row_to_json(po) AS observation,row_to_json(p) AS product,
    row_to_json(s) AS store,row_to_json(m) AS merchant,row_to_json(pm) AS "productMapping",row_to_json(sm) AS "storeMapping"
    FROM ${Import.TABLE} e JOIN price_observations po ON po.id=e.observation_id JOIN products p ON p.id=e.product_id
    JOIN stores s ON s.id=e.store_id JOIN merchants m ON m.id=s.merchant_id
    JOIN external_product_mappings pm ON pm.source_id=e.source_id AND pm.external_product_id=('hit:store:1775:sku:'||e.retailer_sku)
    JOIN external_store_mappings sm ON sm.source_id=e.source_id AND sm.external_location_id='1775'
    WHERE e.source_id=$1 AND e.native_store_id=1775 AND e.native_store_number='258' AND e.gtin=ANY($2::text[])
    ORDER BY e.captured_at,e.retailer_sku LIMIT 257 FOR SHARE OF e,po,p,s,m,pm,sm`, [Import.SOURCE, gtins]);
  if (q.rows.length > 256) throw fail("native-reference-bound");
  const output = [];
  for (const row of q.rows) {
    const { evidence: e, observation: o, product: p, store: s, merchant: m, productMapping: pm, storeMapping: sm } = row;
    const meta = { storeProfile: Import.STORE_PROFILE, capturedAt: stamp(e.captured_at), responseDate: stamp(e.source_response_date), responseAgeSeconds: e.source_age_seconds, sourceResponseHash: e.source_response_hash, sourceResponseUrl: e.source_response_url };
    const parsed = Native.parseRow(e.native_proof, meta), checked = parsed.ok && Import.validateCandidate(parsed.candidate, { now: Date.parse(meta.capturedAt), storeProfile: Import.STORE_PROFILE });
    if (!checked?.ok) throw fail("persisted-native-reference-invalid");
    // JSONB preserves native values, but not the nested object's original key
    // order. The parser's original proof hash included that order. Reparse all
    // values first, then authenticate the saved original hash through its exact
    // import signature and observation; never replace it with a renewed hash.
    const c = { ...parsed.candidate, proofHash: e.proof_hash };
    const captureKey = JSON.stringify([Import.SOURCE, 1775, c.retailerSku, c.capturedAt, c.gtin, checked.pack]);
    const savedSignature = hash(JSON.stringify([captureKey, c.priceCents, c.depositCents, c.proofHash, c.sourceResponseHash, c.sourceResponseDate, c.sourceAgeSeconds, c.expiresAt]));
    const checkout = c.depositCents !== null && (c.depositCents === 0 || c.packCount === 1 && (c.normalizedPack.unit !== "piece" || c.normalizedPack.amount === 1));
    if (e.source_id !== Import.SOURCE || e.observation_id !== checked.observationId || e.retailer_sku !== c.retailerSku || e.gtin !== c.gtin
      || e.source_url !== c.sourceUrl || !/^[a-f0-9]{64}$/.test(e.proof_hash || "") || e.signature !== savedSignature || !same(e.native_proof, c.nativeProof)
      || Number(e.pack_amount) !== checked.pack.amount || e.pack_unit !== checked.pack.unit || e.pack_count !== checked.pack.count || e.price_cents !== c.priceCents || e.deposit_cents !== c.depositCents || stamp(e.expires_at) !== c.expiresAt
      || o.id !== e.observation_id || o.product_id !== e.product_id || o.store_id !== e.store_id || o.source !== Import.SOURCE || o.source_id !== Import.SOURCE
      || o.gtin !== c.gtin || o.currency !== "EUR" || o.price_type !== "regular" || o.kind !== "external" || o.source_type !== "official_retailer"
      || o.evidence_purpose !== "current-price" || o.per !== "piece" || o.key !== "gtin:" + c.gtin || o.store !== "HIT" || o.region !== "Berlin" || o.merchant_id !== m.id || o.pricing_confidence !== "exact-native-pack"
      || o.external_location_id !== "1775" || o.external_product_id !== checked.externalProductId || Number(o.price) !== c.priceCents / 100
      || Number(o.pack_amount) !== checked.pack.amount || o.pack_unit !== checked.pack.unit || o.pack !== checked.strictPack || o.product !== c.name || o.brand !== c.brand
      || o.proof !== "hit:store:1775:sku:" + c.retailerSku + ":capture:" + c.capturedAt + ":sha256:" + c.sourceResponseHash
      || o.source_url !== c.sourceUrl || o.proof_hash !== c.proofHash || o.proof_type !== "OFFICIAL_STORE_ASSORTMENT" || o.identity_verified !== true || o.proof_verified !== false
      || stamp(o.observed_at) !== c.capturedAt || stamp(o.fetched_at) !== c.capturedAt || o.date !== checked.date || o.valid_from !== checked.validFrom || o.valid_to !== checked.validTo
      || o.eligibility?.scopeChannel !== "physical-store" || o.eligibility?.sourceScope !== "physical-store" || o.eligibility?.nativeStoreId !== 1775 || o.eligibility?.nativeStoreNumber !== "258"
      || o.eligibility?.goodsPriceCents !== c.priceCents || o.eligibility?.depositCents !== c.depositCents || o.eligibility?.priceIncludesDeposit !== false || o.eligibility?.checkoutPriceVerified !== checkout || o.eligibility?.sourceExpiresAt !== c.expiresAt
      || p.id !== e.product_id || p.gtin !== c.gtin || p.identity_status !== "verified" || Number(p.pack_amount) !== checked.pack.amount || p.pack_unit !== checked.pack.unit || p.pack_count !== checked.pack.count
      || s.id !== e.store_id || s.merchant_id !== m.id || s.external_id !== "hit:store:1775" || s.country !== "DE" || s.city !== "Berlin" || s.region !== "Berlin" || s.active !== true
      || s.address !== Import.STORE_PROFILE.address || s.postal_code !== Import.STORE_PROFILE.postalCode || Number(s.latitude) !== Import.STORE_PROFILE.latitude || Number(s.longitude) !== Import.STORE_PROFILE.longitude
      || m.name !== "HIT" || m.normalized_name !== "hit" || m.active !== true || pm.product_id !== p.id || pm.status !== "verified" || Number(pm.confidence) !== 1 || sm.store_id !== s.id || sm.status !== "verified" || Number(sm.confidence) !== 1
      || e.ordinary_cycle_id != null && !Cycle.validId(e.ordinary_cycle_id)) throw fail("persisted-native-reference-conflict");
    output.push({ candidate: c, cycleId: e.ordinary_cycle_id ?? null, origin: "ordinary", reference: { observationId: e.observation_id, productId: e.product_id, storeId: e.store_id }, original: null });
  }
  return output;
}
async function blocked(tx, gtins) {
  if (!Array.isArray(gtins) || gtins.length > 4000 || gtins.some(g => typeof g !== "string" || !Discovery.validGtin(g))) throw fail("native-gtins-required");
  await lock(tx); if (!gtins.length) return [];
  const q = await tx.query(`SELECT DISTINCT b.gtin FROM ${BLOCK_TABLE} b JOIN ${TABLE} e ON e.event_id=b.event_id
    WHERE e.source_id=$1 AND e.native_store_id=1775 AND e.native_store_number='258' AND e.scope_country='DE' AND e.scope_channel='physical-store' AND b.gtin=ANY($2::text[]) ORDER BY b.gtin`, [Import.SOURCE, [...new Set(gtins)]]);
  return q.rows.map(row => row.gtin);
}
async function publicStatus(pool) {
  const row = (await pool.query(`SELECT count(*)::int AS "eventCount",(SELECT count(DISTINCT b.gtin)::int FROM ${BLOCK_TABLE} b JOIN ${TABLE} e ON e.event_id=b.event_id WHERE e.source_id=$1 AND e.native_store_id=1775 AND e.native_store_number='258' AND e.scope_country='DE' AND e.scope_channel='physical-store') AS "blockedGtinCount" FROM ${TABLE} WHERE source_id=$1 AND native_store_id=1775 AND native_store_number='258' AND scope_country='DE' AND scope_channel='physical-store'`, [Import.SOURCE])).rows[0];
  if (![row?.eventCount, row?.blockedGtinCount].every(n => Number.isSafeInteger(n) && n >= 0)) throw fail("public-count-invalid");
  return { eventCount: row.eventCount, blockedGtinCount: row.blockedGtinCount };
}
const eventSelect = `SELECT event_id AS "eventId",batch_fingerprint AS "batchFingerprint",ordinary_cycle_id AS "cycleId",reason,payload,payload_hash AS "payloadHash",record_bytes AS "recordBytes" FROM ${TABLE}`;
async function existingEvents(tx, fingerprint, state) {
  const q = await tx.query(eventSelect + " WHERE batch_fingerprint=$1 ORDER BY event_id", [fingerprint]);
  if (q.rows.length > 128) throw fail("stored-event-bound");
  const gtins = new Set();
  for (const row of q.rows) {
    const p = row.payload;
    if (!p || p.version !== 1 || p.sourceId !== Import.SOURCE || p.nativeStoreId !== 1775 || p.nativeStoreNumber !== "258" || p.scopeCountry !== "DE" || p.scopeChannel !== "physical-store"
      || p.cycleId !== state.ordinaryCycleId || row.cycleId !== p.cycleId || p.batchFingerprint !== fingerprint || row.batchFingerprint !== fingerprint || row.reason !== p.reason
      || row.payloadHash !== hash(encode(p)) || row.recordBytes !== Buffer.byteLength(encode(p)) || row.eventId !== hash(encode([fingerprint, p.reason, p.proofs]))) throw fail("stored-event-conflict");
    const b = await tx.query(`SELECT gtin FROM ${BLOCK_TABLE} WHERE event_id=$1 ORDER BY gtin`, [row.eventId]);
    const refs = await tx.query(`SELECT observation_id AS "observationId",product_id AS "productId",store_id AS "storeId" FROM ${REF_TABLE} WHERE event_id=$1 ORDER BY observation_id`, [row.eventId]);
    const expectedRefs = p.proofs.map(x => x.reference).filter(Boolean).filter((x, i, xs) => xs.findIndex(y => y.observationId === x.observationId) === i).sort((a, b) => a.observationId.localeCompare(b.observationId));
    if (!same(b.rows.map(x => x.gtin), p.gtins) || !same(refs.rows, expectedRefs)) throw fail("stored-event-reference-conflict");
    p.gtins.forEach(g => gtins.add(g));
  }
  return { count: q.rows.length, gtins: [...gtins].sort() };
}
async function record(tx, result, expectedCheckpoint, { now, ordinaryOriginals = result?.ordinaryConflictOriginals ?? [] } = {}) {
  clock(now); await lock(tx, now);
  const Refresh = require("./hit-price-refresh"), state = await Refresh.readState(tx);
  if (typeof expectedCheckpoint !== "string" || Refresh.checkpointKey(state) !== expectedCheckpoint) throw fail("checkpoint-changed");
  if (!Cycle.validId(state.ordinaryCycleId)) throw fail("actual-durable-cycle-required");
  now = await actualNow(tx);
  if (!Array.isArray(ordinaryOriginals) || ordinaryOriginals.length > 16 || ordinaryOriginals.some(x => typeof x?.body !== "string" || Buffer.byteLength(x.body) > MAX_BODY_BYTES)) throw fail("ordinary-original-bound");
  const context = { ...result }; delete context.ordinaryConflictOriginals;
  const fingerprint = hash(encode([Import.SOURCE, 1775, state.ordinaryCycleId, expectedCheckpoint, context, ordinaryOriginals.map(x => ({ hash: hash(x.body), meta: x.meta, node: x.node }))]));
  const existing = await existingEvents(tx, fingerprint, state);
  if (existing.count) return { inserted: 0, events: existing.count, quarantineGtins: existing.gtins, historicalReuse: true };
  const previous = await Admission.previous(tx, { now }), gate = Gate.evaluate(result, state, { now, previousPartitions: previous });
  if (!gate.conflicts.length && !ordinaryOriginals.length) return { inserted: 0, events: 0, quarantineGtins: [] };
  const captures = ordinaryOriginals.map(x => ordinaryOriginal(x, result, now));
  if (result.brandPartitionProbe?.control && !captures.some(x => x.original.meta.sourceResponseHash === result.brandPartitionProbe.control.meta.sourceResponseHash)) captures.push(ordinaryOriginal({ ...result.brandPartitionProbe.control, node: result.brandPartitionProbe.controlNode }, result, now));
  const conflicts = [...gate.conflicts];
  for (const capture of captures) for (let i = 0; i < capture.candidates.length; i++) for (let j = i + 1; j < capture.candidates.length; j++) {
    const a = { candidate: capture.candidates[i], cycleId: state.ordinaryCycleId }, b = { candidate: capture.candidates[j], cycleId: state.ordinaryCycleId };
    const reason = ["native-sku-identity-disagreement", "gtin-sales-pack-disagreement", "exact-native-quote-disagreement"].find(r => pairReason(a, b, r));
    if (!reason) continue;
    const gtins = [...new Set([a.candidate.gtin, b.candidate.gtin])].sort();
    const value = { reason, gtins, origins: ["ordinary", "ordinary"], retailerSkus: [a.candidate.retailerSku, b.candidate.retailerSku] };
    // Different sold packs can both survive whole-page parsing. Its collector
    // conflict sidecar then remains empty, while the actual bound gate already
    // proves their discrepancy. The native pair still comes only from the
    // authenticated original; neither gate nor collector metadata replaces it.
    const gateBound = gate.conflicts.some(c => c.reason === reason && same(c.gtins, gtins)
      && same([...c.origins].sort(), value.origins) && c.retailerSkus.every(s => value.retailerSkus.includes(s)));
    if (!gateBound && !gtins.every(g => capture.conflictGtins.includes(g))) throw fail("ordinary-native-conflict-binding-required");
    if (!conflicts.some(c => same(c, value))) conflicts.push(value);
  }
  if (!conflicts.length) return { inserted: 0, events: 0, quarantineGtins: [] };
  if (conflicts.length > 128) throw fail("conflict-bound");
  const ids = [...new Set(conflicts.flatMap(c => c.gtins))].sort(), persisted = await evidence(tx, ids), proofs = [];
  for (const proof of persisted) { const q = Gate.quoteFor(proof.candidate); if (state.cursor?.seenQuotes?.[q.key]?.signature === q.signature && state.cursor?.seenSkus?.includes(proof.candidate.retailerSku)) proofs.push(proof); }
  for (const capture of captures) for (const c of capture.candidates) if (ids.includes(c.gtin)) proofs.push({ candidate: c, cycleId: state.ordinaryCycleId, origin: "ordinary", reference: null, original: capture.original });
  if (gate.recordOutcome === "confirmed") {
    const original = result.brandPartitionProbe.filtered;
    for (const c of Native.parsePage(original.body, original.meta).accepted) if (ids.includes(c.gtin) && Import.validateCandidate(c, { now, storeProfile: Import.STORE_PROFILE }).ok) proofs.push({ candidate: c, cycleId: state.ordinaryCycleId, origin: "incoming-partition", reference: null, original });
  }
  for (const prior of previous) for (const ref of prior.acceptedRefs) if (ids.includes(ref.gtin)) {
    const found = persisted.find(x => same(Gate.referenceFor(x.candidate), ref));
    if (!found) throw fail("partition-observation-reference-required");
    proofs.push({ ...found, origin: "partition", cycleId: prior.ordinaryCycle.ordinaryCycleId, original: prior.record.filtered });
  }
  const entries = [];
  for (const conflict of conflicts) {
    let pair;
    for (let i = 0; i < proofs.length && !pair; i++) for (let j = i + 1; j < proofs.length && !pair; j++) {
      const a = proofs[i], b = proofs[j], g = [...new Set([a.candidate.gtin, b.candidate.gtin])].sort();
      if ((!a.original || a.origin === "partition") && (!b.original || b.origin === "partition") || !same(g, conflict.gtins) || !same([a.origin, b.origin].sort(), [...conflict.origins].sort())
        || !conflict.retailerSkus.every(s => [a.candidate.retailerSku, b.candidate.retailerSku].includes(s)) || !pairReason(a, b, conflict.reason)) continue;
      pair = [a, b];
    }
    if (!pair) throw fail("actual-conflict-evidence-required");
    const payload = { version: 1, sourceId: Import.SOURCE, nativeStoreId: 1775, nativeStoreNumber: "258", scopeCountry: "DE", scopeChannel: "physical-store", cycleId: state.ordinaryCycleId,
      batchFingerprint: fingerprint, reason: conflict.reason, gtins: conflict.gtins, proofs: pair, recordedAt: new Date(now).toISOString() };
    const encoded = encode(payload), bytes = Buffer.byteLength(encoded), id = hash(encode([fingerprint, conflict.reason, pair]));
    if (bytes > MAX_EVENT_BYTES) throw fail("event-byte-bound");
    if (!entries.some(x => x.id === id)) entries.push({ id, payload, encoded, bytes });
  }
  const totals = (await tx.query(`SELECT count(*)::int AS records,COALESCE(sum(record_bytes),0)::bigint AS bytes FROM ${TABLE}`)).rows[0];
  if (!Number.isSafeInteger(Number(totals?.records)) || !Number.isSafeInteger(Number(totals?.bytes)) || Number(totals.records) < 0 || Number(totals.bytes) < 0
    || Number(totals.records) + entries.length > MAX_RECORDS || Number(totals.bytes) + entries.reduce((n, e) => n + e.bytes, 0) > MAX_BYTES) throw fail("ledger-bound");
  const finalNow = await actualNow(tx);
  for (const { payload } of entries) for (const p of payload.proofs) if (p.original && p.origin !== "partition" && !Import.validateCandidate(p.candidate, { now: finalNow, storeProfile: Import.STORE_PROFILE }).ok) throw fail("capture-expired-before-write");
  if (Refresh.checkpointKey(await Refresh.readState(tx)) !== expectedCheckpoint) throw fail("checkpoint-changed");
  for (const entry of entries) {
    const at = Math.max(...entry.payload.proofs.map(p => Date.parse(p.candidate.capturedAt)));
    const q = await tx.query(`INSERT INTO ${TABLE}(event_id,batch_fingerprint,source_id,native_store_id,native_store_number,scope_country,scope_channel,ordinary_cycle_id,reason,captured_at,recorded_at,payload,payload_hash,record_bytes)
      VALUES($1,$2,$3,1775,'258','DE','physical-store',$4,$5,$6,$7,$8::jsonb,$9,$10) ON CONFLICT DO NOTHING`, [entry.id, fingerprint, Import.SOURCE, state.ordinaryCycleId, entry.payload.reason, new Date(at).toISOString(), entry.payload.recordedAt, entry.encoded, hash(entry.encoded), entry.bytes]);
    if (q.rowCount !== 1) throw fail("event-write-conflict");
    for (const gtin of entry.payload.gtins) await tx.query(`INSERT INTO ${BLOCK_TABLE}(event_id,gtin) VALUES($1,$2)`, [entry.id, gtin]);
    const refs = new Map(entry.payload.proofs.filter(p => p.reference).map(p => [p.reference.observationId, p.reference]));
    for (const ref of refs.values()) await tx.query(`INSERT INTO ${REF_TABLE}(event_id,observation_id,product_id,store_id) VALUES($1,$2,$3,$4)`, [entry.id, ref.observationId, ref.productId, ref.storeId]);
  }
  return { inserted: entries.length, events: entries.length, quarantineGtins: [...new Set(entries.flatMap(e => e.payload.gtins))].sort() };
}
module.exports = Object.freeze({ TABLE, BLOCK_TABLE, REF_TABLE, MAX_RECORDS, MAX_BYTES, MAX_EVENT_BYTES, ensure, record, blocked, publicStatus, ordinaryOriginal, pairReason });
