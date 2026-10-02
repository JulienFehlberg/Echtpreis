"use strict";

// Internal preparation only: no fetch, import, scheduler or productive admit caller.
// Admit records only evidence already written by the caller's real transaction.
const crypto=require("node:crypto"),same=require("node:util").isDeepStrictEqual;
const Gate=require("./hit-partition-admission-gate"),Partition=require("./hit-native-brand-partition"),Native=require("./hit-assortment-client"),Import=require("./hit-price-import"),Collector=require("./hit-assortment-collector"),Clock=require("./current-price-query-service");
const TABLE="hit_partition_admissions",REF_TABLE="hit_partition_admission_refs",MAX_RECORDS=32,MAX_BYTES=24*1024*1024;
const fail=s=>Object.assign(new Error("hit-partition-store-"+s),{code:"hit-partition-store-"+s});
const hash=s=>crypto.createHash("sha256").update(s).digest("hex");
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
const encode=value=>JSON.stringify(sorted(value));
const uuid=s=>typeof s==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s);
const stamp=s=>s==null?null:new Date(s).toISOString();
function clock(now){if(!Number.isSafeInteger(now)||now<0)throw fail("explicit-clock-required");return now;}
function client(tx){if(!tx||typeof tx.query!=="function"||typeof tx.release!=="function")throw fail("transaction-client-required");}
const schemaJobs=new WeakMap();
async function ensure(pool){
 if(schemaJobs.has(pool))return schemaJobs.get(pool);
 const job=pool.query(`SELECT pg_advisory_xact_lock(hashtext('HIT partition admission schema'));
 CREATE TABLE IF NOT EXISTS ${TABLE}(
 admission_id text PRIMARY KEY CHECK(admission_id~'^[a-f0-9]{64}$'),
 source_id text NOT NULL CHECK(source_id='HIT Berlin store assortment'),
 native_store_id int NOT NULL CHECK(native_store_id=1775),ordinary_cycle_id uuid NOT NULL,
 captured_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 checkpoint_fingerprint text NOT NULL CHECK(checkpoint_fingerprint~'^[a-f0-9]{64}$'),
 payload jsonb NOT NULL,payload_hash text NOT NULL CHECK(payload_hash~'^[a-f0-9]{64}$'),
 record_bytes int NOT NULL CHECK(record_bytes>0 AND record_bytes<=25165824),
 created_at timestamptz NOT NULL DEFAULT now(),CHECK(expires_at=captured_at+interval '24 hours'));
 CREATE TABLE IF NOT EXISTS ${REF_TABLE}(
 admission_id text NOT NULL REFERENCES ${TABLE}(admission_id),retailer_sku text NOT NULL,
 observation_id uuid NOT NULL REFERENCES price_observations(id),
 product_id uuid NOT NULL REFERENCES products(id),store_id uuid NOT NULL REFERENCES stores(id),
 PRIMARY KEY(admission_id,retailer_sku),UNIQUE(admission_id,observation_id));
 CREATE INDEX IF NOT EXISTS hit_partition_admission_active_idx ON ${TABLE}(source_id,native_store_id,expires_at);
 CREATE OR REPLACE FUNCTION hit_partition_admission_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'HIT partition admission records are immutable' USING ERRCODE='55000'; END $$;
 DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='${TABLE}'::regclass AND tgname='hit_partition_admission_immutable_guard') THEN
 CREATE TRIGGER hit_partition_admission_immutable_guard BEFORE UPDATE OR DELETE ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION hit_partition_admission_immutable(); END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='${REF_TABLE}'::regclass AND tgname='hit_partition_admission_ref_immutable_guard') THEN
 CREATE TRIGGER hit_partition_admission_ref_immutable_guard BEFORE UPDATE OR DELETE ON ${REF_TABLE} FOR EACH ROW EXECUTE FUNCTION hit_partition_admission_immutable(); END IF;
 END $$;`);
 schemaJobs.set(pool,job);try{await job;}catch(error){schemaJobs.delete(pool);throw error;}
}
function original(record,now){
 const checked=Partition.validateRecord(record,{now});
 if(checked.outcome!=="confirmed"||!checked.filtered||!same(checked,record))throw fail("confirmed-unchanged-original-required");
 return checked;
}
function candidateRows(record,now){
 const parsed=Native.parsePage(record.filtered.body,record.filtered.meta),rows=new Map();
 for(const c of parsed.accepted){const checked=Import.validateCandidate(c,{now,storeProfile:Import.STORE_PROFILE});if(checked.ok)rows.set(c.retailerSku,{candidate:c,checked});}
 return rows;
}
function admissionId(record){return hash(JSON.stringify([Import.SOURCE,1775,record.control.meta.sourceResponseHash,record.filtered.meta.sourceResponseHash,record.filtered.meta.capturedAt]));}
async function actualReference(tx,c,checked,{historical=false,expectedCycleId=null}={}){
 const q=await tx.query(`SELECT row_to_json(e) AS evidence,row_to_json(po) AS observation,
 row_to_json(p) AS product,row_to_json(s) AS store,row_to_json(m) AS merchant,
 row_to_json(pm) AS "productMapping",row_to_json(sm) AS "storeMapping"
 FROM ${Import.TABLE} e JOIN price_observations po ON po.id=e.observation_id
 JOIN products p ON p.id=e.product_id JOIN stores s ON s.id=e.store_id JOIN merchants m ON m.id=s.merchant_id
 JOIN external_product_mappings pm ON pm.source_id=e.source_id AND pm.external_product_id=$2
 JOIN external_store_mappings sm ON sm.source_id=e.source_id AND sm.external_location_id='1775'
 WHERE e.observation_id=$1 AND e.source_id=$3 AND e.native_store_id=1775 AND e.native_store_number='258'
 FOR SHARE OF e,po,p,s,m,pm,sm`,
 [checked.observationId,checked.externalProductId,Import.SOURCE]);
 if(!q.rows.length)return null;if(q.rows.length!==1)throw fail("persisted-reference-ambiguous");
 const {evidence:e,observation:o,product:p,store:s,merchant:m,productMapping:pm,storeMapping:sm}=q.rows[0];
 const expected={retailer_sku:c.retailerSku,gtin:c.gtin,source_response_hash:c.sourceResponseHash,
 source_url:c.sourceUrl,source_response_url:c.sourceResponseUrl,proof_hash:c.proofHash,signature:checked.signature};
 const dateKeys={captured_at:c.capturedAt,expires_at:c.expiresAt,source_response_date:c.sourceResponseDate};
 const checkout=c.depositCents!==null&&(c.depositCents===0||c.packCount===1&&(c.normalizedPack.unit!=="piece"||c.normalizedPack.amount===1));
 if(Object.entries(expected).some(([k,v])=>e[k]!==v)||Object.entries(dateKeys).some(([k,v])=>stamp(e[k])!==v)
  ||e.source_id!==Import.SOURCE||e.native_store_id!==1775||e.native_store_number!=="258"
  ||e.observation_id!==checked.observationId||Number(e.pack_amount)!==checked.pack.amount||e.pack_unit!==checked.pack.unit||e.pack_count!==checked.pack.count
  ||e.price_cents!==c.priceCents||e.deposit_cents!==c.depositCents||e.source_age_seconds!==c.sourceAgeSeconds||!same(e.native_proof,c.nativeProof)
  ||o.id!==e.observation_id||o.product_id!==e.product_id||o.store_id!==e.store_id||o.source!==Import.SOURCE||o.source_id!==Import.SOURCE
  ||o.gtin!==c.gtin||o.currency!=="EUR"||o.price_type!=="regular"||o.kind!=="external"||o.source_type!=="official_retailer"
  ||o.evidence_purpose!=="current-price"||o.per!=="piece"||o.key!=="gtin:"+c.gtin||o.store!=="HIT"||o.region!=="Berlin"
  ||o.merchant_id!==m.id||o.pricing_confidence!=="exact-native-pack"
  ||o.external_location_id!=="1775"||o.external_product_id!==checked.externalProductId||Number(o.price)!==c.priceCents/100
  ||Number(o.pack_amount)!==checked.pack.amount||o.pack_unit!==checked.pack.unit||o.pack!==checked.strictPack
  ||o.product!==c.name||o.brand!==c.brand||o.source_url!==c.sourceUrl||o.proof_hash!==c.proofHash
  ||o.proof!=="hit:store:1775:sku:"+c.retailerSku+":capture:"+c.capturedAt+":sha256:"+c.sourceResponseHash
  ||o.proof_type!=="OFFICIAL_STORE_ASSORTMENT"||o.identity_verified!==true||o.proof_verified!==false
  ||stamp(o.observed_at)!==c.capturedAt||stamp(o.fetched_at)!==c.capturedAt||o.date!==checked.date||o.valid_from!==checked.validFrom||o.valid_to!==checked.validTo
  ||o.eligibility?.scopeChannel!=="physical-store"||o.eligibility?.sourceScope!=="physical-store"
  ||o.eligibility?.nativeStoreId!==1775||o.eligibility?.nativeStoreNumber!=="258"
  ||o.eligibility?.goodsPriceCents!==c.priceCents||o.eligibility?.depositCents!==c.depositCents
  ||o.eligibility?.priceIncludesDeposit!==false||o.eligibility?.checkoutPriceVerified!==checkout||o.eligibility?.sourceExpiresAt!==c.expiresAt
  ||p.id!==e.product_id||p.gtin!==c.gtin||p.identity_status!=="verified"||Number(p.pack_amount)!==checked.pack.amount||p.pack_unit!==checked.pack.unit||p.pack_count!==checked.pack.count
  ||s.id!==e.store_id||s.merchant_id!==m.id||s.external_id!=="hit:store:1775"||s.country!=="DE"||s.city!=="Berlin"||s.region!=="Berlin"
  ||s.address!==Import.STORE_PROFILE.address||s.postal_code!==Import.STORE_PROFILE.postalCode
  ||Number(s.latitude)!==Import.STORE_PROFILE.latitude||Number(s.longitude)!==Import.STORE_PROFILE.longitude||s.active!==true
  ||m.name!=="HIT"||m.normalized_name!=="hit"||m.active!==true
  ||pm.product_id!==p.id||pm.status!=="verified"||Number(pm.confidence)!==1||sm.store_id!==s.id||sm.status!=="verified"||Number(sm.confidence)!==1)
  throw fail("persisted-reference-conflict");
 if(!historical&&(o.truth_eligible!==true||o.status!=="observed"||e.ordinary_cycle_id!==expectedCycleId))return null;
 return{retailerSku:c.retailerSku,observationId:e.observation_id,productId:e.product_id,storeId:e.store_id};
}
function snapshot(row,now){
 const raw=row.payload;if(!raw||raw.version!==1||!uuid(raw.ordinaryCycle?.ordinaryCycleId)||!Array.isArray(raw.acceptedRefs)
  ||raw.acceptedRefs.length<1||raw.acceptedRefs.length>40||!Array.isArray(raw.observationRefs)||raw.observationRefs.length!==raw.acceptedRefs.length)
  throw fail("stored-snapshot-invalid");
 const at=Date.parse(raw.record?.filtered?.meta?.capturedAt),controlAt=Date.parse(raw.record?.control?.meta?.capturedAt);
 if(!Number.isFinite(at)||!Number.isFinite(controlAt)||at>now||controlAt>now
  ||!Collector.validDay(raw.ordinaryCycle.cursorDay)||raw.ordinaryCycle.cursorDay!==Clock.today(new Date(controlAt))
  ||!Number.isSafeInteger(raw.ordinaryCycle.completedCycles)||raw.ordinaryCycle.completedCycles<0)throw fail("stored-capture-invalid");
 const record=original(raw.record,Math.max(at,controlAt)),canonical={version:1,record,
 ordinaryCycle:raw.ordinaryCycle,ordinaryCheckpointFingerprint:raw.ordinaryCheckpointFingerprint,
 acceptedRefs:raw.acceptedRefs,observationRefs:raw.observationRefs};
 if(!same(canonical,raw)||row.admissionId!==admissionId(record)||row.ordinaryCycleId!==raw.ordinaryCycle.ordinaryCycleId
  ||stamp(row.capturedAt)!==record.filtered.meta.capturedAt||stamp(row.expiresAt)!==new Date(at+86400000).toISOString()
  ||row.checkpointFingerprint!==raw.ordinaryCheckpointFingerprint||row.payloadHash!==hash(encode(canonical))
  ||row.recordBytes!==Buffer.byteLength(encode(canonical)))throw fail("stored-snapshot-conflict");
 return canonical;
}
async function references(tx,id,payload,now){
 const rows=candidateRows(payload.record,Math.max(Date.parse(payload.record.control.meta.capturedAt),Date.parse(payload.record.filtered.meta.capturedAt)));
 const q=await tx.query(`SELECT retailer_sku AS "retailerSku",observation_id AS "observationId",product_id AS "productId",store_id AS "storeId" FROM ${REF_TABLE} WHERE admission_id=$1 ORDER BY retailer_sku`,[id]);
 if(q.rows.length!==payload.acceptedRefs.length)throw fail("stored-observation-refs-required");
 const seen=new Set();for(const [index,ref]of payload.acceptedRefs.entries()){
  const row=rows.get(ref?.retailerSku);if(!row||seen.has(ref.retailerSku)||!same(Gate.referenceFor(row.candidate),ref))throw fail("stored-original-ref-conflict");seen.add(ref.retailerSku);
  const actual=await actualReference(tx,row.candidate,row.checked,{historical:true});
  if(!actual||!same(actual,payload.observationRefs[index])||!q.rows.some(x=>same(x,actual)))throw fail("stored-observation-ref-conflict");
 }
}
const select=`SELECT admission_id AS "admissionId",ordinary_cycle_id AS "ordinaryCycleId",captured_at AS "capturedAt",expires_at AS "expiresAt",checkpoint_fingerprint AS "checkpointFingerprint",payload,payload_hash AS "payloadHash",record_bytes AS "recordBytes" FROM ${TABLE}`;
async function previous(tx,{now}={}){
 client(tx);clock(now);const q=await tx.query(select+" WHERE source_id=$1 AND native_store_id=1775 AND expires_at>$2::timestamptz ORDER BY captured_at,admission_id",[Import.SOURCE,new Date(now).toISOString()]);
 if(q.rows.length>1)throw fail("active-partition-bound");const values=[];
 for(const row of q.rows){const payload=snapshot(row,now);await references(tx,row.admissionId,payload,now);values.push({version:1,record:payload.record,ordinaryCycle:payload.ordinaryCycle,acceptedRefs:payload.acceptedRefs});}return values;
}
async function admit(tx,result,expectedCheckpoint,{now}={}){
 client(tx);clock(now);
 // A standalone autocommit connection has no previously assigned transaction.
 const assigned=await tx.query('SELECT txid_current_if_assigned() IS NOT NULL AS "transactionOpen",floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS "nowMs"');
 if(assigned.rows[0]?.transactionOpen!==true)throw fail("open-writing-transaction-required");
 const databaseNow=Number(assigned.rows[0].nowMs);if(!Number.isSafeInteger(databaseNow)||Math.abs(databaseNow-now)>300000)throw fail("database-clock-conflict");
 await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",[Import.SOURCE+":store:1775"]);
 const Refresh=require("./hit-price-refresh"),state=await Refresh.readState(tx);
 if(typeof expectedCheckpoint!=="string"||Refresh.checkpointKey(state)!==expectedCheckpoint)throw fail("checkpoint-changed");
 if(!uuid(state.ordinaryCycleId))throw fail("actual-durable-cycle-required");
 now=Number((await tx.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS "nowMs"')).rows[0]?.nowMs);clock(now);
 const raw=result?.brandPartitionProbe;if(!raw?.filtered?.meta||!raw.control?.meta)throw fail("confirmed-unchanged-original-required");
 const id=admissionId(raw);
 const existing=await tx.query(select+" WHERE admission_id=$1",[id]);
 if(existing.rows.length){const saved=snapshot(existing.rows[0],now);await references(tx,id,saved,now);
  const record=original(raw,Math.max(Date.parse(raw.control.meta.capturedAt),Date.parse(raw.filtered.meta.capturedAt)));
  if(!same(saved.record,record)||saved.ordinaryCycle.ordinaryCycleId!==state.ordinaryCycleId||saved.ordinaryCheckpointFingerprint!==hash(expectedCheckpoint))throw fail("original-already-conflicting");
  return{inserted:0,persistedCandidateCount:saved.acceptedRefs.length,historicalReuse:true,priceImportEnabled:false,complete:false};}
 const record=original(raw,now);
 const prior=await previous(tx,{now}),gate=Gate.evaluate(result,state,{now,previousPartitions:prior});
 if(gate.conflicts.length){
  const quarantine=require("./hit-partition-quarantine-store"),recorded=await quarantine.record(tx,result,expectedCheckpoint,{now});
  await Import.quarantineConflictingIdentities(tx,recorded.quarantineGtins);
  // Return a withheld admission so the future caller can commit genuine
  // quarantine evidence instead of rolling it back with a thrown admission.
  return{inserted:0,persistedCandidateCount:0,quarantineEventsInserted:recorded.inserted,quarantineGtins:recorded.quarantineGtins,priceImportEnabled:false,complete:false};
 }
 if(gate.recordOutcome!=="confirmed"||gate.quarantineGtins.length||gate.unresolved.length)throw fail("unconflicted-original-required");
 const blockedGtins=new Set(await require("./hit-partition-quarantine-store").blocked(tx,gate.candidates.map(c=>c.gtin)));
 const acceptedRefs=[],observationRefs=[];
 for(const c of gate.candidates){if(blockedGtins.has(c.gtin))continue;const checked=Import.validateCandidate(c,{now,storeProfile:Import.STORE_PROFILE});if(!checked.ok)throw fail("candidate-invalid");const actual=await actualReference(tx,c,checked,{expectedCycleId:state.ordinaryCycleId});if(actual){acceptedRefs.push(Gate.referenceFor(c));observationRefs.push(actual);}}
 // Candidate/reference metadata alone cannot manufacture an admission event.
 if(!acceptedRefs.length)return{inserted:0,persistedCandidateCount:0,priceImportEnabled:false,complete:false};
 const payload={version:1,record,ordinaryCycle:gate.ordinaryCycle,ordinaryCheckpointFingerprint:hash(expectedCheckpoint),acceptedRefs,observationRefs},encoded=encode(payload),bytes=Buffer.byteLength(encoded);
 if(prior.length)throw fail("active-partition-bound");
 const totals=(await tx.query(`SELECT count(*)::int AS records,COALESCE(sum(record_bytes),0)::bigint AS bytes FROM ${TABLE}`)).rows[0];
 if(!Number.isSafeInteger(Number(totals?.records))||!Number.isSafeInteger(Number(totals?.bytes))||Number(totals.records)<0||Number(totals.bytes)<0||Number(totals.records)>=MAX_RECORDS||Number(totals.bytes)+bytes>MAX_BYTES)throw fail("ledger-bound");
 const finalNow=Number((await tx.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS "nowMs"')).rows[0]?.nowMs);clock(finalNow);original(record,finalNow);
 for(const c of gate.candidates)if(!Import.validateCandidate(c,{now:finalNow,storeProfile:Import.STORE_PROFILE}).ok)throw fail("capture-expired-before-write");
 if(Refresh.checkpointKey(await Refresh.readState(tx))!==expectedCheckpoint)throw fail("checkpoint-changed");
 const written=await tx.query(`INSERT INTO ${TABLE}(admission_id,source_id,native_store_id,ordinary_cycle_id,captured_at,expires_at,checkpoint_fingerprint,payload,payload_hash,record_bytes) VALUES($1,$2,1775,$3,$4,$5,$6,$7::jsonb,$8,$9) ON CONFLICT DO NOTHING`,[id,Import.SOURCE,state.ordinaryCycleId,record.filtered.meta.capturedAt,new Date(Date.parse(record.filtered.meta.capturedAt)+86400000).toISOString(),payload.ordinaryCheckpointFingerprint,encoded,hash(encoded),bytes]);
 if(written.rowCount!==1)throw fail("original-write-conflict");
 for(const ref of observationRefs)await tx.query(`INSERT INTO ${REF_TABLE}(admission_id,retailer_sku,observation_id,product_id,store_id) VALUES($1,$2,$3,$4,$5)`,[id,ref.retailerSku,ref.observationId,ref.productId,ref.storeId]);
 return{inserted:1,persistedCandidateCount:acceptedRefs.length,priceImportEnabled:false,complete:false};
}
module.exports=Object.freeze({TABLE,REF_TABLE,MAX_RECORDS,MAX_BYTES,ensure,admit,previous});
