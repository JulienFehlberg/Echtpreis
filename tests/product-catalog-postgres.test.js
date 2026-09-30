"use strict";

const assert=require("assert/strict");
const {Pool}=require("pg");
const Catalog=require("../canonical-product-catalog-import");
const Service=require("../product-catalog-service");
const Discovery=require("../price-query-discovery");
const CurrentPriceQuery=require("../current-price-query-service");
const SOURCE="Open Food Facts",legacyGtin="4002971253504";
function testGtin(index){
 const base=String(900000000000+index);let sum=0,odd=true;
 for(let i=base.length-1;i>=0;i--){sum+=Number(base[i])*(odd?3:1);odd=!odd}
 return base+((10-sum%10)%10);
}
function fixture(index,patch={}){
 return{code:testGtin(index),product_name:"POSTGRES TEST catalog item "+index,product_name_de:"POSTGRES TEST Katalogartikel "+index,brands:"SPARKORB PostgreSQL TEST",quantity:index%2?"1000 ml":"250 g",countries_tags:["en:germany"],...patch};
}
async function main(){
 const connectionString=process.env.DATABASE_URL;
 assert(connectionString,"DATABASE_URL is required for the product catalog PostgreSQL integration test");
 const database=new URL(connectionString);
 assert.equal(database.hostname,"localhost","Only a local PostgreSQL test service is allowed");
 assert(database.pathname.endsWith("_test"),"Use a dedicated database whose name ends in _test");
 const pool=new Pool({connectionString,ssl:false,connectionTimeoutMillis:5000});
 let sqlCalls=0,testError;
 const measuredPool={connect:async()=>{const client=await pool.connect();return{query:(...args)=>{sqlCalls++;return client.query(...args)},release:()=>client.release()}}};
 try{
  const legacy=(await pool.query("SELECT id,name,brand,pack_amount::float AS amount,pack_unit AS unit,pack_count::int AS count FROM products WHERE gtin=$1",[legacyGtin])).rows[0];
  assert(legacy,"Run the price inventory PostgreSQL integration before this test");
  assert.equal(legacy.name,"Grand Dessert Double Coffee");assert.equal(legacy.amount,190);assert.equal(legacy.unit,"g");
  const baseline=(await pool.query("SELECT (SELECT count(*)::int FROM products) AS products,(SELECT count(*)::int FROM stores) AS stores,(SELECT count(*)::int FROM price_observations) AS prices")).rows[0];
  const products=Array.from({length:1001},(_,i)=>fixture(i)),gtins=products.map(p=>p.code);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM products WHERE gtin=ANY($1::text[])",[gtins])).rows[0].count,0,"Synthetic test GTINs must not already exist");
  const first=await Catalog.importBatch(measuredPool,products,{sourceId:SOURCE,sourceUrl:"https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz",fetchedAt:"2026-09-30T12:00:00Z",limit:1001});
  assert.equal(first.counts.created,1001,JSON.stringify(first.counts));assert.equal(first.counts.accepted,1001);assert.equal(first.counts.mappingsCreated,1001);assert.equal(first.counts.evidenceCreated,1001);assert.equal(first.counts.rejected,0);
  assert(sqlCalls<=30,"1001 products should use at most 30 bulk SQL calls, received "+sqlCalls);
  assert.equal(first.purpose,"identity");assert.equal(first.truthEligible,false);assert.equal(first.attribution.license,"ODbL-1.0");assert.equal(first.attribution.licenseUrl,"https://opendatacommons.org/licenses/odbl/1-0/");assert.equal(first.sourceUrl,"https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz");
  for(const row of first.accepted){assert.equal(row.purpose,"identity");assert.equal(row.truthEligible,false);assert.equal(row.proofVerified,false);assert.equal(row.sourceUrl,"https://world.openfoodfacts.org/product/"+row.gtin);assert.match(row.productId,/^[a-f\d-]{36}$/)}
  const stored=(await pool.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE identity_status='verified')::int AS identified,count(*) FILTER(WHERE name LIKE 'POSTGRES TEST Katalogartikel%')::int AS german_names FROM products WHERE gtin=ANY($1::text[])",[gtins])).rows[0];
  assert.equal(stored.total,1001);assert.equal(stored.identified,1001);assert.equal(stored.german_names,1001);
  const mapped=(await pool.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE ep.status='verified' AND ep.confidence=1 AND ep.match_reason='gtin' AND ep.external_product_id='off:'||p.gtin)::int AS exact FROM external_product_mappings ep JOIN products p ON p.id=ep.product_id WHERE ep.source_id=$1 AND p.gtin=ANY($2::text[])",[SOURCE,gtins])).rows[0];assert.equal(mapped.total,1001);assert.equal(mapped.exact,1001);
  const evidence=(await pool.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE match_score=1 AND match_level='exact' AND proof='https://world.openfoodfacts.org/product/'||gtin)::int AS attributable FROM product_identity_evidence WHERE source=$1 AND gtin=ANY($2::text[])",[SOURCE,gtins])).rows[0];assert.equal(evidence.total,1001);assert.equal(evidence.attributable,1001);
  const milk=(await pool.query("SELECT pack_amount::float AS amount,pack_unit AS unit,pack_count::int AS count FROM products WHERE gtin=$1",[testGtin(1)])).rows[0];assert.equal(milk.amount,1000);assert.equal(milk.unit,"ml");assert.equal(milk.count,1);

  sqlCalls=0;const repeated=await Catalog.importBatch(measuredPool,products,{limit:1001});
  assert.equal(repeated.counts.created,0);assert.equal(repeated.counts.reused,1001);assert.equal(repeated.counts.mappingsCreated,0);assert.equal(repeated.counts.evidenceCreated,0);assert(sqlCalls<=30);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM products WHERE gtin=ANY($1::text[])",[gtins])).rows[0].count,1001);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM product_identity_evidence WHERE source=$1 AND gtin=ANY($2::text[])",[SOURCE,gtins])).rows[0].count,1001);

  const oldCatalog={code:legacyGtin,product_name_de:"Abweichender deutscher Katalogname",product_name:"Catalog dessert",brands:legacy.brand,quantity:"190 g",countries_tags:["en:germany"]};
  const reused=await Catalog.importBatch(pool,[oldCatalog]);assert.equal(reused.counts.created,0);assert.equal(reused.counts.reused,1);assert.equal(reused.accepted[0].productId,legacy.id);assert.equal(reused.accepted[0].name,legacy.name);
  const unchanged=(await pool.query("SELECT name,pack_amount::float AS amount,pack_unit AS unit,pack_count::int AS count FROM products WHERE id=$1",[legacy.id])).rows[0];assert.equal(unchanged.name,legacy.name);assert.equal(unchanged.amount,190);assert.equal(unchanged.unit,"g");assert.equal(unchanged.count,1);
  const conflict=await Catalog.importBatch(pool,[{...oldCatalog,quantity:"750 g"}]);assert.equal(conflict.counts.accepted,0);assert(conflict.rejected[0].reasons.includes("catalog-existing-pack-conflict"));assert.equal((await pool.query("SELECT pack_amount::float AS amount FROM products WHERE id=$1",[legacy.id])).rows[0].amount,190);
  const alias=(await pool.query("SELECT raw_name AS name,proof FROM product_identity_evidence WHERE product_id=$1 AND source=$2",[legacy.id,SOURCE])).rows.find(row=>row.name===oldCatalog.product_name_de);assert(alias);assert.equal(alias.proof,"https://world.openfoodfacts.org/product/"+legacyGtin);

  const invalidRows=[fixture(1101,{countries_tags:["en:france"]}),fixture(1102,{code:testGtin(1102).slice(0,-1)+((Number(testGtin(1102).at(-1))+1)%10)}),fixture(1103,{product_name_de:"",product_name:""}),fixture(1104,{quantity:"unknown"})];
  const invalid=await Catalog.importBatch(pool,invalidRows);assert.equal(invalid.counts.accepted,0);assert.equal(invalid.counts.rejected,4);assert.equal((await pool.query("SELECT count(*)::int AS count FROM products WHERE gtin=ANY($1::text[])",[invalidRows.map(p=>p.code)])).rows[0].count,0);
  const reviewGtin=testGtin(500);await pool.query("UPDATE external_product_mappings SET status='review',confidence=.5,verified_at=NULL WHERE source_id=$1 AND external_product_id=$2",[SOURCE,"off:"+reviewGtin]);
  const review=await Catalog.importBatch(pool,[fixture(500)]);assert.equal(review.counts.accepted,0);assert(review.rejected[0].reasons.includes("catalog-existing-mapping-needs-review"));const mapping=(await pool.query("SELECT status,confidence::float AS confidence,verified_at FROM external_product_mappings WHERE source_id=$1 AND external_product_id=$2",[SOURCE,"off:"+reviewGtin])).rows[0];assert.equal(mapping.status,"review");assert.equal(mapping.confidence,.5);assert.equal(mapping.verified_at,null);

  const after=(await pool.query("SELECT (SELECT count(*)::int FROM products) AS products,(SELECT count(*)::int FROM stores) AS stores,(SELECT count(*)::int FROM price_observations) AS prices")).rows[0];assert.equal(after.products,baseline.products+1001);assert.equal(after.stores,baseline.stores);assert.equal(after.prices,baseline.prices,"A catalog import may not fabricate any price observations");
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM price_observations WHERE source_id=$1",[SOURCE])).rows[0].count,0);
  // A small injected source exercises the real operator service and catalog
  // search. All names and GTINs are explicit test fixtures, never live stock.
  const staples=[fixture(1200,{product_name_de:"POSTGRES TEST Vollmilch",quantity:"1000 ml",categories_tags:["en:milks"]}),fixture(1201,{product_name_de:"POSTGRES TEST Mineralwasser",quantity:"1000 ml",categories_tags:["en:mineral-waters"]}),fixture(1202,{product_name_de:"POSTGRES TEST Reis",quantity:"1000 g",categories_tags:["en:rices"]})];
  let collections=0;const sourceUrl="https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz";
  const serviceResult=await Service.refresh(pool,{targetProducts:6000,force:true},{collect:async options=>{collections++;assert.equal(options.limit,20000);return{ok:true,products:staples,sourceUrl,fetchedAt:"2026-09-30T12:00:00Z",rowsRead:3,rowsScanned:3,bytesRead:512,complete:true,reason:"source-end",stopReason:"source-end"}}});
  assert.equal(collections,1);assert.equal(serviceResult.ok,true,JSON.stringify(serviceResult));assert.equal(serviceResult.import.created,3);assert.equal(serviceResult.import.accepted,3);assert.equal(serviceResult.selected,3);assert.equal(serviceResult.totalProducts,after.products+3);assert.equal(serviceResult.minimumReached,false);assert.equal(serviceResult.targetReached,false);assert.equal(serviceResult.purpose,"identity");assert.equal(serviceResult.truthEligible,false);
  const serviceStatus=await Service.status(pool);assert.equal(serviceStatus.totalProducts,after.products+3);assert.equal(serviceStatus.minimumReached,false);assert.equal(serviceStatus.lastRun.status,"partial");assert.equal(serviceStatus.lastRun.sourceUrl,sourceUrl);assert.equal(serviceStatus.lastRun.result.targetReached,false);assert.equal(serviceStatus.attribution.license,"ODbL-1.0");
  const metadata=(await pool.query("SELECT cm.countries_tags AS countries,cm.categories_tags AS categories,cm.basket_family AS family,cm.source_id AS source,cm.source_url AS url,p.gtin FROM product_catalog_metadata cm JOIN products p ON p.id=cm.product_id WHERE p.gtin=ANY($1::text[]) ORDER BY p.gtin",[staples.map(p=>p.code)])).rows;
  assert.equal(metadata.length,3);for(const row of metadata){assert(row.countries.includes("en:germany"));assert(row.categories.length);assert.equal(row.source,SOURCE);assert.equal(row.url,"https://world.openfoodfacts.org/product/"+row.gtin)}assert.deepEqual(new Set(metadata.map(row=>row.family)),new Set(["milk","water","rice"]));
  const search=await Service.search(pool,{search:"Vollmilch",limit:30});assert.equal(search.ok,true);assert(search.items.some(row=>row.gtin===testGtin(1200)&&row.basketFamily==="milk"));
  const familySearch=await Service.search(pool,{family:"water",limit:30});assert(familySearch.items.some(row=>row.gtin===testGtin(1201)&&row.basketFamily==="water"));
  const finalCounts=(await pool.query("SELECT (SELECT count(*)::int FROM stores) AS stores,(SELECT count(*)::int FROM price_observations) AS prices")).rows[0];assert.equal(finalCounts.stores,baseline.stores);assert.equal(finalCounts.prices,baseline.prices);
  // Import the production snapshot into PostgreSQL as well: all bulk chunks,
  // metadata, repeated imports and target checks must work with real source rows.
  const snapshot=require("../product-catalog-snapshot").read();
  const real=await Service.refresh(pool,{targetProducts:6000,force:true});
  assert.equal(real.import.accepted,6000,JSON.stringify(real.reasons));assert.equal(real.minimumReached,true);assert.equal(real.targetReached,true);assert(real.stapleProducts>=6000);assert.equal(real.purpose,"identity");assert.equal(real.truthEligible,false);
  const repeat=await Service.refresh(pool,{targetProducts:6000,force:true});assert.equal(repeat.import.created,0);assert.equal(repeat.totalProducts,real.totalProducts);assert.equal(repeat.stapleProducts,real.stapleProducts);
  const current=await Service.refresh(pool,{targetProducts:6000});assert.equal(current.skipped,"catalog-current");
  const identityOnly=(await pool.query("SELECT (SELECT count(*)::int FROM stores) AS stores,(SELECT count(*)::int FROM price_observations) AS prices")).rows[0];assert.equal(identityOnly.stores,baseline.stores);assert.equal(identityOnly.prices,baseline.prices);
  const branch=(await pool.query("SELECT id FROM stores WHERE external_id='osm:node:990001'")).rows[0];assert(branch,"Use the real canonical REWE branch established by the preceding price inventory integration");
  const snapshotCodes=new Set(snapshot.products.map(p=>p.code));
  const natural=await Discovery.resolveQuery(pool,{product:"Milch",merchants:["REWE"],storeId:branch.id});assert.equal(natural.ok,true);assert(["candidate","ambiguous"].includes(natural.productResolution.state),JSON.stringify(natural.productResolution));assert.equal(natural.requiresProductSelection,true);assert.equal(natural.product,null);assert.equal(natural.stores[0].id,branch.id);
  const candidateGtins=natural.products.filter(p=>snapshotCodes.has(p.gtin)).map(p=>p.gtin);assert(candidateGtins.length,"A natural milk query must reach real snapshot identities, rather than only the synthetic test item");
  const realMilkMetadata=(await pool.query("SELECT p.gtin,cm.basket_family AS family FROM products p JOIN product_catalog_metadata cm ON cm.product_id=p.id WHERE p.gtin=ANY($1::text[]) AND cm.basket_family IN ('milk','milk_fresh','milk_uht')",[candidateGtins])).rows;assert(realMilkMetadata.length,"The natural milk candidates must contain actual milk identities from the source snapshot");
  const selected=natural.products.find(p=>p.gtin===realMilkMetadata[0].gtin);assert(selected&&selected.canonical===true);assert(selected.pack);
  const exact=await Discovery.resolveQuery(pool,{product:selected.name,productId:selected.id,gtin:selected.gtin,brand:selected.brand,pack:selected.pack,merchants:["REWE"],storeId:branch.id});assert.equal(exact.productResolution.state,"exact");assert.equal(exact.product.id,selected.id);assert.equal(exact.product.gtin,selected.gtin);
  const genericPrice=await CurrentPriceQuery.compareCurrentPrices(pool,{product:"Milch",merchants:["REWE"],storeId:branch.id,today:"2026-09-30"},{includeRefreshTargets:false});assert.equal(genericPrice.ok,true);assert.equal(genericPrice.results[0].state,"unknown");assert.equal(genericPrice.results[0].price,null);
  const exactPrice=await CurrentPriceQuery.compareCurrentPrices(pool,{product:selected.name,productId:selected.id,gtin:selected.gtin,brand:selected.brand,pack:selected.pack,merchants:["REWE"],storeId:branch.id,today:"2026-09-30"},{includeRefreshTargets:false});assert.equal(exactPrice.ok,true);assert.equal(exactPrice.productResolution.state,"exact");assert.equal(exactPrice.query.productId,selected.id);assert.equal(exactPrice.query.gtin,selected.gtin);assert.equal(exactPrice.results[0].state,"unknown");assert.equal(exactPrice.results[0].price,null,"A real catalog SKU without price evidence must not acquire a fabricated price");
  const afterNaturalQuery=(await pool.query("SELECT (SELECT count(*)::int FROM stores) AS stores,(SELECT count(*)::int FROM price_observations) AS prices")).rows[0];assert.equal(afterNaturalQuery.stores,baseline.stores);assert.equal(afterNaturalQuery.prices,baseline.prices);
  console.log("product-catalog-postgres: 1001 synthetic TEST identities in 30 bulk SQL calls plus the 6000 selected real DE snapshot identities, exact OFF provenance, repeat imports, existing SKU conflict protection, staple metadata/search, natural milk discovery and exact price queries without fabricated prices or stores OK");
 }catch(error){testError=error;throw error}
 finally{try{await pool.end()}catch(error){if(!testError)throw error}}
}
main().catch(error=>{console.error(error);process.exitCode=1});
