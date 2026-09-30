"use strict";
const assert=require("assert/strict"),Service=require("../current-price-query-service");
const ids={product:"10000000-0000-4000-8000-000000000001",edeka:"20000000-0000-4000-8000-000000000001",other:"20000000-0000-4000-8000-000000000002",rewe:"20000000-0000-4000-8000-000000000003"};
const today="2026-09-30",gtin="3017620422003";
const product={id:ids.product,canonicalKey:"gtin:"+gtin,gtin,name:"Nutella",brand:"Ferrero",packAmount:450,packUnit:"g",packCount:1,identityStatus:"verified"};
const stores=[{id:ids.edeka,merchant:"EDEKA",region:"Berlin",active:true,merchantActive:true},{id:ids.other,merchant:"EDEKA",region:"Berlin",active:true,merchantActive:true},{id:ids.rewe,merchant:"REWE",region:"Berlin",active:true,merchantActive:true}];
const base={productId:ids.product,gtin,product:"Nutella",brand:"Ferrero",pack:"450 g",price:3.99,per:"item",store:"EDEKA",storeId:ids.edeka,region:"Berlin",date:today,observedAt:today+"T12:00:00Z",priceType:"regular",kind:"external",status:"observed",identityVerified:false,proofVerified:false,source:"Open Prices",sourceType:"open_data",sourceId:"Open Prices",proof:"proof:1",proofHash:"image:1",proofActor:"observer:1",currency:"EUR",eligibility:null};
function database({products=[product],canonicalStores=stores,observations=[base]}={}){
 const calls=[];
 return{calls,query:async(sql,args=[])=>{
  calls.push({sql,args});assert(/^SELECT\b/.test(sql),"The query service must not mutate the database");
  if(sql.includes("FROM price_observations po"))return{rows:observations};
  if(sql.includes("FROM external_store_mappings"))return{rows:canonicalStores.map((store,i)=>({storeId:store.id,sourceId:"Open Prices",externalLocationId:"openprices:"+(i+1),status:"verified",confidence:1}))};
  if(sql.includes("FROM stores s"))return{rows:canonicalStores.filter(store=>args[0].includes(store.id))};
  if(sql.includes("FROM products")){
   if(sql.includes("WHERE id=$1"))return{rows:products.filter(row=>row.id===args[0])};
   if(sql.includes("WHERE gtin=$1"))return{rows:products.filter(row=>row.gtin===args[0])};
   if(sql.includes("WHERE lower(name)=lower($1)"))return{rows:products.filter(row=>row.name.toLowerCase()===args[0].toLowerCase())};
   return{rows:products};
  }
  throw new Error("Unexpected SQL: "+sql);
 }};
}
const request={product:"Nutella",gtin,brand:"Ferrero",pack:"450 g",merchants:["EDEKA","REWE"],storeIds:{EDEKA:ids.edeka,REWE:ids.rewe},regions:{EDEKA:"Berlin",REWE:"Berlin"},today};
async function main(){
 for(const changes of [{gtin:"3017620422004"},{today:"2026-02-30"},{quantity:Infinity},{quantity:0},{merchants:[]},{merchants:"EDEKA"},{storeIds:{EDEKA:"external:12"}},{eligibility:[true]},{maxAgeDays:0}]){
  const pool=database(),result=await Service.compareCurrentPrices(pool,{...request,...changes});
  assert.equal(result.ok,false,JSON.stringify(changes));assert.equal(result.statusCode,400);assert.equal(pool.calls.length,0);
 }
 assert.equal(Service.validateRequest({...request,maxAgeDays:30}).value.maxAgeDays,7);
 assert.equal(Service.validateRequest({...request,eligibility:{app:"false",loyalty:1}}).value.eligibility.app,false);
 assert.equal(Service.validateRequest({...request,eligibility:{app:"false",loyalty:1}}).value.eligibility.loyalty,false);

 const wrongStore={...base,storeId:ids.other,price:.99,proof:"other",proofHash:"other"},regional={...base,storeId:null,price:.59,proof:"regional",proofHash:"regional"},rewe={...base,store:"REWE",storeId:ids.rewe,price:4.29,proof:"rewe",proofHash:"rewe"};
 let pool=database({observations:[wrongStore,regional,base,rewe]}),result=await Service.compareCurrentPrices(pool,request);
 assert.equal(result.ok,true);assert.deepEqual(result.results.map(row=>row.price),[3.99,4.29]);
 assert.deepEqual(result.results.map(row=>row.storeId),[ids.edeka,ids.rewe]);
 assert.equal(result.results[0].per,"piece");assert.equal(result.results[0].status,"observed");assert.equal(result.results[0].proofVerified,false);assert.equal(result.results[0].identityVerified,false);
 assert.equal(result.results[0].pack,"450 g");assert.equal(result.results[0].brand,"Ferrero");assert.equal(result.results[0].originalPer,"item");assert.equal(result.results[0].priceBasis,"pack");
 assert.equal(result.refreshTargets.length,2);
 const query=pool.calls.find(call=>call.sql.includes("FROM price_observations po"));
 for(const field of ['po.kind','po.status','AS "identityVerified"','AS "proofVerified"','po.eligibility','po.per','AS "proofHash"','AS pack'])assert(query.sql.includes(field),"Missing DB truth field "+field);
 assert(query.sql.includes("COALESCE(po.gtin,p.gtin)="));assert(query.sql.includes("po.store_id="));
 assert(query.args.includes(gtin));assert(query.args.includes(ids.edeka));assert(query.args.includes(ids.rewe));assert(!query.sql.includes(gtin));

 result=await Service.compareCurrentPrices(database({observations:[regional,wrongStore,rewe]}),request);
 assert.equal(result.results[0].state,"unknown","Local store requests must not fall back to regional/other-branch prices");assert.equal(result.results[1].price,4.29);
 result=await Service.compareCurrentPrices(database({observations:[base,rewe]}),{...request,storeIds:{EDEKA:ids.edeka}});
 assert.equal(result.results[1].reason,"store-selection-required");assert.equal(result.results[1].price,null);
 result=await Service.compareCurrentPrices(database(),{...request,storeIds:{EDEKA:ids.rewe,REWE:ids.rewe}});
 assert.equal(result.ok,false);assert(result.errors.includes("store-merchant-conflict:EDEKA"));
 result=await Service.compareCurrentPrices(database(),{...request,storeIds:{EDEKA:"20000000-0000-4000-8000-000000000099"}});
 assert.equal(result.ok,false);assert(result.errors.includes("canonical-store-not-found"));

 const duplicate={...base,proof:"proof:2",proofActor:"observer:2"};
 result=await Service.compareCurrentPrices(database({observations:[base,duplicate]}),{...request,merchants:["EDEKA"],storeIds:{EDEKA:ids.edeka}});
 assert.equal(result.results[0].state,"observed");assert.equal(result.results[0].truth.independentEvidence,1);
 result=await Service.compareCurrentPrices(database({observations:[base,{...duplicate,proofHash:"image:2"}]}),{...request,merchants:["EDEKA"],storeIds:{EDEKA:ids.edeka}});
 assert.equal(result.results[0].state,"verified");assert.equal(result.results[0].truth.independentEvidence,2);

 const multi={...base,price:2.49,regularPrice:3.99,priceType:"multi_buy",minQuantity:3,proof:"multi",proofHash:"multi"},app={...base,price:2.99,priceType:"app",proof:"app",proofHash:"app"};
 result=await Service.compareCurrentPrices(database({observations:[base,multi,app]}),{...request,quantity:2});assert.equal(result.results[0].price,3.99);
 result=await Service.compareCurrentPrices(database({observations:[base,multi,app]}),{...request,quantity:3});assert.equal(result.results[0].price,2.49);assert.equal(result.results[0].minQuantity,3);assert.equal(result.results[0].publicReferencePrice,3.99);
 result=await Service.compareCurrentPrices(database({observations:[base,app]}),{...request,eligibility:{app:true}});assert.equal(result.results[0].price,2.99);

 const unit=Service.normalizeObservation({...base,price:7.96,regularPrice:9.96,per:"kg",pack:"250 g"});
 assert.equal(unit.price,1.99);assert.equal(unit.regularPrice,2.49);assert.equal(unit.per,"piece");assert.equal(unit.originalPrice,7.96);assert.equal(unit.originalPer,"kg");assert.equal(unit.priceBasis,"derived-pack");
 assert.equal(Service.normalizeObservation({...base,price:1.2,per:"l",pack:"6 x 500 ml"}).price,3.6);
 for(const changes of [{per:"kg",pack:null},{per:"kg",pack:"500 ml"},{per:"l",pack:"250 g"},{per:"g"},{per:null},{price:Infinity},{price:-2}])assert.equal(Service.normalizeObservation({...base,...changes}),null,JSON.stringify(changes));
 result=await Service.compareCurrentPrices(database({observations:[{...base,price:7.96,per:"kg",pack:"250 g"}]}),{...request,pack:null});
 assert.equal(result.results[0].price,1.99);assert.equal(result.results[0].unitPrice,7.96);assert.equal(result.results[0].priceBasis,"derived-pack");assert.equal(result.results[0].originalPer,"kg");
 result=await Service.compareCurrentPrices(database({observations:[{...base,price:7.96,per:"kg",pack:null}]}),request);
 assert.equal(result.results[0].state,"unknown","Unknown unit-price pack must not become a checkout quote");

 pool=database();result=await Service.compareCurrentPrices(pool,{...request,productId:product.id,pack:"500 g"});
 assert.equal(result.results[0].reason,"product-pack-conflict");assert.equal(result.results[0].price,null);assert(!pool.calls.some(call=>call.sql.includes("FROM price_observations")));
 pool=database();result=await Service.compareCurrentPrices(pool,{...request,gtin:null,brand:null,pack:null});
 assert.equal(result.query.mode,"category");assert.equal(result.query.gtin,null);assert.equal(result.query.productId,null);assert.equal(result.results[0].comparisonOnly,true);assert.equal(result.refreshTargets.length,0);
 const fuzzy=pool.calls.find(call=>call.sql.includes("FROM price_observations"));assert(fuzzy.sql.includes("po.product ILIKE ANY("));assert(fuzzy.sql.includes("p.name ILIKE ANY("));
 result=await Service.compareCurrentPrices(database({observations:[{...base,date:"2026-09-01",observedAt:"2026-09-01"}]}),{...request,maxAgeDays:30});assert.equal(result.maxAgeDays,7);assert.equal(result.results[0].state,"unknown");
 result=await Service.compareCurrentPrices(database({observations:Array(5000).fill(base)}),request);
 assert(result.results.every(row=>row.state==="unknown"&&row.reason==="query-evidence-limit"));assert.equal(result.leaders.lowestCheckout,null);
 await assert.rejects(()=>Service.compareCurrentPrices(null,request),/database-required/);
 console.log("current-price-query-service: scoped DB reads, canonical identity, conditional quotes, verification flags and legacy price basis OK");
}
main().catch(error=>{console.error(error);process.exitCode=1});

assert.equal(Service.today(new Date("2026-09-29T22:30:00Z")),"2026-09-30");
