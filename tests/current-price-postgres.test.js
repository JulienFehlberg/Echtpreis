"use strict";

const assert=require("assert/strict");
const {randomUUID}=require("crypto");
const {Pool}=require("pg");
const Connector=require("../current-price-connector");
const Registry=require("../current-price-connectors");
const Provider=require("../providers/open-prices");
const Import=require("../external-price-import");
const OpenPricesClient=require("../open-prices-client");
const CurrentClient=require("../app/current-price-client");

async function main(){
 const connectionString=process.env.DATABASE_URL;
 assert(connectionString,"DATABASE_URL is required for the PostgreSQL integration test");
 const database=new URL(connectionString);
 assert.equal(database.hostname,"localhost","Use a local PostgreSQL test service");
 assert(database.pathname.endsWith("_test"),"Use a dedicated database whose name ends in _test");
 const pool=new Pool({connectionString,ssl:false,connectionTimeoutMillis:5000});
 const originalFetchPage=OpenPricesClient.fetchPage;let sourceCalls=0;
 OpenPricesClient.fetchPage=async input=>{sourceCalls++;assert.equal(input.orderBy,"-date");assert.equal(input.locationId,"12");return{url:"https://example.test/latest-price",page:1,pages:1,accepted:[{merchant:"EDEKA",product:"Nutella",brand:"Ferrero",pack:"450 g",gtin:"3017620422003",externalProductId:"openprices:3017620422003",externalLocationId:"openprices:12",price:3.99,priceType:"regular",currency:"EUR",observedAt:"2026-09-30T12:00:00Z",source:"Open Prices",sourceId:"Open Prices",sourceType:"open_data",proof:"openprices:proof:107",proofHash:"refresh-image",proofActor:"refresh-observer",truthEligible:true,registryTrust:80}],rejected:[]}};
 const api=require("../server");
 let testError;
 try{
  assert.equal(typeof api.initDb,"function");
  assert.equal(typeof api.closeDb,"function");
  const existing=await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
  assert.equal(existing.rowCount,0,"This test must start with a fresh, empty database");
  await api.initDb();
  await api.initDb();

  const merchantId=randomUUID(),storeId=randomUUID(),productId=randomUUID();
  const today="2026-09-30",gtin="3017620422003",region="Berlin, DE";
  await pool.query("INSERT INTO merchants(id,name,normalized_name) VALUES($1,'EDEKA','edeka')",[merchantId]);
  await pool.query("INSERT INTO stores(id,merchant_id,address,postal_code,city,region) VALUES($1,$2,'Engine Test 1','10115','Berlin',$3)",[storeId,merchantId,region]);
  await pool.query("INSERT INTO products(id,canonical_key,gtin,name,brand,pack_amount,pack_unit,pack_count,identity_status) VALUES($1,$2,$3,'Nutella','Ferrero',450,'g',1,'verified')",[productId,"gtin:"+gtin,gtin]);
  await pool.query("INSERT INTO external_store_mappings(source_id,external_location_id,store_id,status,confidence,match_reason,verified_at) VALUES('Open Prices','openprices:12',$1,'verified',1,'e2e-canonical-store',now())",[storeId]);

  const price=(id,hash,owner)=>({id,product:{code:gtin,product_name:"Nutella",brands:"Ferrero",quantity:"450 g"},location:{id:12,osm_brand:"EDEKA",osm_address_city:"Berlin",osm_address_country:"DE"},price:3.99,currency:"EUR",date:today,proof:{id,type:"PRICE_TAG",image_md5_hash:hash},owner});
  async function persist(adapted,accepted,rejected=0){
   const saved=await Import.persist(pool,adapted,{source:"Open Prices",sourceUrl:"https://example.test/price-engine-fixture"});
   assert.equal(saved.accepted,accepted,JSON.stringify(saved));
   assert.equal(saved.rejected,rejected,JSON.stringify(saved));
   return saved;
  }
  await persist(Provider.adapt({items:[price(101,"same-image","observer-1"),price(102,"same-image","observer-2")]}),2);
  const stored=(await pool.query('SELECT product_id AS "productId",store_id AS "storeId",brand,pack,proof_hash AS "proofHash",region FROM price_observations ORDER BY proof')).rows;
  assert.equal(stored.length,2);
  for(const row of stored){
   assert.equal(row.productId,productId);assert.equal(row.storeId,storeId);
   assert.equal(row.brand,"Ferrero");assert.equal(row.pack,"450 g");
   assert.equal(row.proofHash,"same-image");assert.equal(row.region,region);
  }
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM store_alias_evidence")).rows[0].count,0,"External imports must not create receipt alias evidence");
  assert((await pool.query("SELECT count(*)::int AS count FROM external_store_alias_evidence")).rows[0].count>0,"Verified external locations must retain external alias evidence");

  await new Promise((resolve,reject)=>{api.server.once("error",reject);api.server.listen(0,"127.0.0.1",()=>{api.server.off("error",reject);resolve()})});
  const baseUrl="http://127.0.0.1:"+api.server.address().port;
  async function current(extra={}){
   const response=await fetch(baseUrl+"/v1/current-prices",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({product:"Nutella",brand:"Ferrero",pack:"450 g",gtin,merchants:["EDEKA"],storeId,today,...extra}),signal:AbortSignal.timeout(10000)});
   const body=await response.json();
   assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.ok,true);
   assert.equal(body.results.length,1);
   return body.results[0];
  }
  function priced(result,value){
   assert.equal(result.price,value,JSON.stringify(result));
   assert.equal(result.gtin,gtin);assert.equal(result.storeId,storeId);
   assert.equal(result.unit,"kg");
   assert(Math.abs(result.unitPrice-value/.45)<1e-9,JSON.stringify(result));
  }
  let result=await current();
  priced(result,3.99);assert.equal(result.state,"observed");
  assert.equal(result.truth.independentEvidence,1,"Two proof IDs for the same image must remain one piece of evidence");
  result=await current({gtin:null});
  priced(result,3.99);assert.equal(result.queryMode,"exact");

  await persist(Provider.adapt({items:[price(103,"independent-image","observer-3")]}),1);
  result=await current();
  priced(result,3.99);assert.equal(result.state,"verified");assert.equal(result.truth.independentEvidence,2);

  const multi={merchant:"EDEKA",storeId,externalLocationId:"openprices:12",externalProductId:"openprices:"+gtin,product:"Nutella",brand:"Ferrero",pack:"450 g",gtin,region,price:2.99,regularPrice:3.99,priceType:"multi_buy",minQuantity:3,observedAt:today+"T12:00:00Z",proof:"openprices:proof:104",proofHash:"multi-image",proofActor:"observer-4"};
  await persist(Connector.ingest(Registry.contracts.openPrices,[multi]),1);
  const quantity=(await pool.query("SELECT min_quantity::float AS quantity FROM price_observations WHERE proof='openprices:proof:104'")).rows[0].quantity;
  assert.equal(quantity,3);
  priced(await current({quantity:1}),3.99);
  priced(await current({quantity:2}),3.99);
  result=await current({quantity:3});
  priced(result,2.99);assert.equal(result.priceType,"multi_buy");assert.equal(result.conditional,true);assert.equal(result.publicReferencePrice,3.99);
  const invalid=Connector.ingest(Registry.contracts.openPrices,[{...multi,minQuantity:undefined,proof:"invalid-multi"}]);
  assert.equal(invalid.accepted.length,0);assert(invalid.rejected[0].reasons.includes("minQuantity"));
  await persist(invalid,0,1);

  // Legacy observations can use canonical product metadata through the API's products join.
  await pool.query("UPDATE price_observations SET brand=NULL,pack=NULL,pack_amount=NULL,pack_unit=NULL,gtin=NULL");
  result=await current({gtin:null,quantity:1});
  priced(result,3.99);assert.equal(result.queryMode,"exact");assert.equal(result.state,"verified");
  priced(await current({quantity:3}),2.99);
  // The real HTTP discovery route returns the same product and branch used by the browser client.
  const discoveredResponse=await fetch(baseUrl+"/v1/price-query",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({product:"Nutella",gtin,merchants:["EDEKA"],storeId})});
  assert.equal(discoveredResponse.status,200);const discovered=await discoveredResponse.json();assert.equal(discovered.product.id,productId);assert.equal(discovered.stores[0].id,storeId);assert.equal(discovered.refreshTargets[0].locationId,"12");
  const canonicalClient=CurrentClient.create({apiBase:baseUrl,fetchImpl:fetch});
  const decision=await canonicalClient.compare({product:"Nutella",brand:"Ferrero",pack:"450 g",gtin,productId,merchants:["EDEKA"]},{today,storeIds:{EDEKA:storeId},quantity:1,refresh:true});
  assert.equal(decision.ok,true);assert.equal(decision.results[0].state,"verified");assert.equal(sourceCalls,1);
  const comparable=CurrentClient.toComparablePrice(decision.results[0],"kg");assert(Math.abs(comparable.price*.45-3.99)<1e-9);assert.equal(comparable.productId,productId);assert.equal(comparable.storeId,storeId);
  const unsupported=await current({productId,pack:"750 g"});assert.equal(unsupported.state,"unknown");assert.equal(unsupported.price,null);
  const denied=await fetch(baseUrl+"/v1/price-missions/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({submissionId:randomUUID(),storeMatch:true,productMatch:true,proofValid:true})});assert.equal(denied.status,403);

  const receiptId=randomUUID();await pool.query("INSERT INTO receipt_submissions(id,proof_hash,merchant_name,store_id,store_resolution_state,purchased_at) VALUES($1,'receipt-native-date-test','EDEKA',$2,'verified','2026-09-30T10:00:00Z')",[receiptId,storeId]);
  await pool.query("INSERT INTO receipt_items(receipt_id,raw_name,product_id,line_total,price,item_count) VALUES($1,'Butter 250 g',$2,2.49,3.99,1)",[receiptId,productId]);
  const materialized=await api.materializeReceiptPrices(receiptId);assert.equal(materialized.accepted,1);
  const receiptFact=(await pool.query("SELECT price::float,product_id,gtin,date::text,status,identity_verified,proof_verified,per FROM price_observations WHERE proof=$1",["receipt:"+receiptId])).rows[0];
  assert.equal(receiptFact.price,2.49);assert.equal(receiptFact.product_id,null);assert.equal(receiptFact.gtin,null);assert.equal(receiptFact.date,today);assert.equal(receiptFact.status,"observed");assert.equal(receiptFact.identity_verified,false);assert.equal(receiptFact.proof_verified,false);assert.equal(receiptFact.per,"piece");

  const submissionId=randomUUID();await pool.query("INSERT INTO price_mission_submissions(id,product_id,store_id,price,proof,observed_at,fingerprint) VALUES($1,$2,$3,3.99,'photo:reviewed-shelf','2026-09-30T10:00:00Z','native-shelf-fingerprint')",[submissionId,productId,storeId]);
  process.env.ECHTPREIS_ADMIN_TOKEN="postgres-admin-test";
  const verifiedResponse=await fetch(baseUrl+"/v1/price-missions/verify",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer postgres-admin-test"},body:JSON.stringify({submissionId,storeMatch:true,productMatch:true,proofValid:true})});
  const verifiedBody=await verifiedResponse.json();assert.equal(verifiedResponse.status,200,JSON.stringify(verifiedBody));
  const reviewed=(await pool.query("SELECT date::text,status,identity_verified,proof_verified,per FROM price_observations WHERE id=$1",[verifiedBody.observationId])).rows[0];assert.equal(reviewed.date,today);assert.equal(reviewed.status,"verified");assert.equal(reviewed.identity_verified,true);assert.equal(reviewed.proof_verified,true);assert.equal(reviewed.per,"piece");
  const health=await fetch(baseUrl+"/health/price-engine").then(response=>response.json());assert.equal(health.ready,true);assert(health.coverage.current_products>=1);assert(health.coverage.current_stores>=1);
  console.log("current-price-postgres: fresh schema, import, identity, proof deduplication, conditional pricing, discovery, browser client, bounded refresh, native-date receipt/shelf facts and admin HTTP authorization OK");
 }catch(error){testError=error;throw error}
 finally{
  OpenPricesClient.fetchPage=originalFetchPage;delete process.env.ECHTPREIS_ADMIN_TOKEN;
  const cleanup=[pool.end()];
  if(typeof api.closeDb==="function")cleanup.push(api.closeDb());
  if(api.server.listening)cleanup.push(new Promise((resolve,reject)=>api.server.close(error=>error?reject(error):resolve())));
  const outcomes=await Promise.allSettled(cleanup),errors=outcomes.filter(outcome=>outcome.status==="rejected").map(outcome=>outcome.reason);
  if(errors.length&&!testError)throw new AggregateError(errors,"PostgreSQL integration test cleanup failed");
 }
}

main().catch(error=>{console.error(error);process.exitCode=1});
