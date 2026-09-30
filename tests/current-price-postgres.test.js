"use strict";

const assert=require("assert/strict");
const {randomUUID}=require("crypto");
const {Pool}=require("pg");
const Connector=require("../current-price-connector");
const Registry=require("../current-price-connectors");
const Provider=require("../providers/open-prices");
const Import=require("../external-price-import");

async function main(){
 const connectionString=process.env.DATABASE_URL;
 assert(connectionString,"DATABASE_URL is required for the PostgreSQL integration test");
 const database=new URL(connectionString);
 assert.equal(database.hostname,"localhost","Use a local PostgreSQL test service");
 assert(database.pathname.endsWith("_test"),"Use a dedicated database whose name ends in _test");
 const pool=new Pool({connectionString,ssl:false,connectionTimeoutMillis:5000});
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
  priced(result,3.99);assert.equal(result.queryMode,"sku");

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
  priced(result,3.99);assert.equal(result.queryMode,"sku");assert.equal(result.state,"verified");
  priced(await current({quantity:3}),2.99);
  console.log("current-price-postgres: fresh schema, import, identity, proof deduplication, conditional pricing and HTTP API OK");
 }catch(error){testError=error;throw error}
 finally{
  const cleanup=[pool.end()];
  if(typeof api.closeDb==="function")cleanup.push(api.closeDb());
  if(api.server.listening)cleanup.push(new Promise((resolve,reject)=>api.server.close(error=>error?reject(error):resolve())));
  const outcomes=await Promise.allSettled(cleanup),errors=outcomes.filter(outcome=>outcome.status==="rejected").map(outcome=>outcome.reason);
  if(errors.length&&!testError)throw new AggregateError(errors,"PostgreSQL integration test cleanup failed");
 }
}

main().catch(error=>{console.error(error);process.exitCode=1});
