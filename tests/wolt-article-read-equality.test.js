"use strict";

const assert=require("node:assert/strict"),crypto=require("node:crypto"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module");
const Client=require("../wolt-retailer-price-client"),Service=require("../wolt-retailer-article-service"),fixture=require("./fixtures/retailers/wolt-edeka-berlin.json");
const now=Date.parse("2026-10-03T02:00:00.500Z"),base=now-10000,clone=structuredClone;
const filename=require.resolve("../wolt-retailer-article-service"),source=fs.readFileSync(filename,"utf8");
const reversals=[
 ['!serializationEqual(raw[k],article[k])','serializationHash(raw[k])!==serializationHash(article[k])'],
 ['!serializationEqual(raw.nativeWitness,article.nativeWitness)','serializationHash(raw.nativeWitness)!==serializationHash(article.nativeWitness)'],
 ['!serializationEqual(expected[key],["observed_at","source_response_date","venue_captured_at","venue_response_date"].includes(key)?new Date(r[key]).toISOString():["pack_amount","pack_count","source_age_seconds","venue_source_age_seconds"].includes(key)&&r[key]!==null?Number(r[key]):r[key])','serializationHash(expected[key])!==serializationHash(["observed_at","source_response_date","venue_captured_at","venue_response_date"].includes(key)?new Date(r[key]).toISOString():["pack_amount","pack_count","source_age_seconds","venue_source_age_seconds"].includes(key)&&r[key]!==null?Number(r[key]):r[key])']
];
let legacySource=source;
for(const[from,to]of reversals){assert.equal(legacySource.split(from).length-1,1,"Exactly the reviewed equality expressions must change");legacySource=legacySource.replace(from,to);}
function compile(code,tracked){
 const instance=new Module(filename,module);instance.filename=filename;instance.paths=Module._nodeModulePaths(path.dirname(filename));
 const nativeRequire=instance.require.bind(instance);
 instance.require=id=>id==="./wolt-retailer-price-client"&&tracked?{...Client,
  parseNativeVenue(...args){tracked.venue++;return Client.parseNativeVenue(...args);},
  parseArticles(...args){tracked.items++;return Client.parseArticles(...args);}
 }:nativeRequire(id);
 // Expose this private helper in this isolated test module, never the production export.
 instance._compile(code+"\nmodule.exports.__testEquality=serializationEqual;",filename);
 return instance.exports;
}
const calls={venue:0,items:0},Candidate=compile(source,calls),Legacy=compile(legacySource);
const hash=value=>crypto.createHash("sha256").update(value).digest("hex");
let groups=0;
const check=fn=>{fn();groups++;};
function outcome(fn){try{return{value:fn()};}catch(error){return{error:error.name,code:error.code??null};}}
function frozen(value){if(value&&typeof value==="object"){for(const v of Object.values(value))frozen(v);Object.freeze(value);}return value;}
// The fixture supplies native structure only. New, explicitly synthetic item
// bytes and HTTP proof clocks are generated together; no archive is retimed.
function product(patch={},at=base){
 const venue=clone(fixture.venueState.queries[0].state.data),stamp=new Date(at).toISOString();
 const venueIdentityProof={capturedAt:stamp,sourceResponseUrl:Client.VENUE_API_URL,sourceResponseHash:hash(JSON.stringify(venue)),sourceResponseDate:stamp,sourceAgeSeconds:0};
 const shop=Client.parseNativeVenue(venue,venueIdentityProof),item={...clone(fixture.pages[1].items[0]),id:"a".repeat(24),name:"Synthetic Coca-Cola read equality 1 l",price:null,deposit:null,original_price:null,unit_price:null,...patch};
 const meta={shop,capturedAt:stamp,sourceResponseUrl:Client.API_ORIGIN+Client.API_PATH+"/categories/slug/synthetic-equality-items",sourceResponseHash:hash(JSON.stringify({syntheticOriginal:true,items:[item]})),sourceResponseDate:stamp,sourceAgeSeconds:0,venueIdentityOriginal:venue,venueIdentityProof};
 const parsed=Client.parseArticles([item],meta);assert.equal(parsed.products.length,1,JSON.stringify(parsed));return parsed.products[0];
}
function reader(rows){const log=[];return{log,query:async(sql,params)=>{log.push({sql,params});return{rows:sql.includes("CREATE TABLE")?[]:rows};}};}
async function persist(service,articles){
 const queries=[],written=[],tx=Object.create(require("pg").Client.prototype);tx.release=()=>{};
 tx.query=async(sql,params)=>{queries.push({sql,params});
  if(sql.includes("txid_current_if_assigned"))return{rows:[{transactionOpen:true}]};
  if(sql.startsWith("SELECT count(*)"))return{rows:[{count:0}]};
  if(sql.startsWith("INSERT INTO ")){const rows=JSON.parse(params[0]);written.push(...rows);return{rows:[],rowCount:rows.length};}
  return{rows:[]};
 };
 return{result:await service.persist(tx,articles,{now}),queries,written};
}
function equalOutcome(left,right){assert.deepEqual(outcome(()=>Candidate.__testEquality(left,right)),outcome(()=>Legacy.serializationHash(left)===Legacy.serializationHash(right)));}
async function readPair(rows,options={now}){
 const before=JSON.stringify(rows),a=await Candidate.search(reader(rows),options),b=await Legacy.search(reader(rows),options);
 assert.deepEqual(a,b);assert.equal(JSON.stringify(rows),before);return a;
}
async function main(){
 for(const[left,right]of[
  [undefined,undefined],[undefined,1],[1,undefined],[()=>1,()=>1],[Symbol("x"),Symbol("x")],[-0,0],[NaN,null],[Infinity,null],[-Infinity,null],
  [new Date(base),new Date(base).toISOString()],[new Date(NaN),null],[[,],[null]],[[undefined],[null]],
  [{a:1,b:undefined},{a:1}],[{z:2,a:{b:2,a:1}},{a:{a:1,b:2},z:2}],
  [Object.assign(Object.create(null),{z:2,a:1}),{a:1,z:2}],[{a:1},{a:2}],["1",1],[null,{}],[1n,1n]
 ])check(()=>equalOutcome(left,right));
 check(()=>{const cycle={};cycle.self=cycle;equalOutcome(cycle,cycle);});
 check(()=>{for(const equal of[Candidate.__testEquality,(a,b)=>Legacy.serializationHash(a)===Legacy.serializationHash(b)]){let rightRead=0;const right={toJSON(){rightRead++;return null;}};const result=outcome(()=>equal(undefined,right));assert.equal(result.code,"ERR_INVALID_ARG_TYPE");assert.equal(rightRead,0,"An invalid left operand must throw before touching the right");}});
 check(()=>{for(const equal of[Candidate.__testEquality,(a,b)=>Legacy.serializationHash(a)===Legacy.serializationHash(b)]){const events=[];const value=label=>({toJSON(){events.push(label);return"same";}});assert.equal(equal(value("left"),value("right")),true);assert.deepEqual(events,["left","right"]);}});
 const p=frozen(product()),original=JSON.stringify(p);
 check(()=>{assert.deepEqual(Service.validateArticle(p,{now}),Legacy.validateArticle(p,{now}));assert.equal(Service.validateArticle(p,{now}).ok,true);assert.equal(p.gtin,"5449000017888");assert.equal(p.packAmount,1000);assert.equal(p.packCount,1);assert.equal(JSON.stringify(p),original);assert.equal(p.price,undefined);});
 const [actual,previous]=await Promise.all([persist(Service,[p]),persist(Legacy,[p])]);
 check(()=>{assert.deepEqual(actual,previous);assert.equal(actual.result.accepted,1);assert.equal(actual.result.priceRowsCreated,0);assert.equal(actual.result.canonicalProductsCreated,0);assert(actual.queries.every(q=>!q.sql.includes("price_observations")));assert.equal(JSON.stringify(p),original);});
 const row=frozen(actual.written[0]);
 check(()=>{assert.deepEqual({witness:row.witness_hash,identity:row.identity_hash,capture:row.capture_hash}, {
  witness:"22c52b4f65d84eb037f6e9ac7b23c6787e80bb44cf199ef5bcc8841c22c2e43c",identity:"58b87daaa653b7077c99cb2cf82a4c2f7c1ab17c1052a0f0819d0f176aa24af0",capture:"a1a2896103a1ce17500f3293b77ee610a5e25281a9999f029d55027cf7b2d3de"
 });});
 const positive=await readPair([row]);check(()=>{assert.equal(positive.items.length,1);const view=positive.items[0];assert(Service.validateView(view,{now}).ok);assert.equal(view.nativeWitness,undefined);assert.equal(view.storeId,undefined);assert.equal(view.currentPriceVerified,false);assert.equal(view.physicalStorePriceVerified,false);assert.equal(view.assortmentComplete,false);assert.equal(view.observedAt,p.observedAt);assert.equal(view.expiresAt,null);});
 const pgShape=clone(row);for(const key of["observed_at","source_response_date","venue_captured_at","venue_response_date"])pgShape[key]=new Date(pgShape[key]);for(const key of["pack_amount","pack_count","source_age_seconds","venue_source_age_seconds"])pgShape[key]=String(pgShape[key]);
 pgShape.shop=Object.fromEntries(Object.entries(pgShape.shop).reverse());pgShape.native_witness=Object.fromEntries(Object.entries(pgShape.native_witness).reverse());
 const pgResult=await readPair(frozen([pgShape]));check(()=>{assert.equal(pgResult.items.length,1);assert.equal(pgResult.items[0].observedAt,new Date(base).toISOString());});
 const mutations=[
  ["flattened name",r=>r.name="Different native name"],["flattened SKU",r=>r.retailer_sku="b".repeat(24)],
  ["GTIN",r=>r.gtin="3017620422003"],["pack metadata",r=>r.pack_amount=500],
  ["native item name",r=>r.native_witness.item.name="Different original"],["native item pack",r=>r.native_witness.item.unit_info="500 ml"],
  ["native venue city",r=>r.native_witness.venue.venue.city="Hamburg"],["native venue hash",r=>r.venue_response_hash="0".repeat(64)],
  ["response hash",r=>r.source_response_hash="0".repeat(64)],["original Date",r=>r.source_response_date=new Date(base-16*60000).toISOString()],
  ["missing Age",r=>delete r.source_age_seconds],["future",r=>r.observed_at=new Date(now+1).toISOString()],
  ["held",r=>r.held=true],["witness SHA",r=>r.witness_hash="0".repeat(64)],
  ["identity SHA",r=>r.identity_hash="0".repeat(64)],["capture SHA",r=>r.capture_hash="0".repeat(64)]
 ];
 const bad=[];
 for(const[name,mutate]of mutations){const r=clone(row);mutate(r);bad.push(r);const result=await readPair(frozen([r]));check(()=>assert.equal(result.items.length,0,name));}
 check(()=>{for(const mutate of[r=>delete r.description,r=>delete r.variant,r=>delete r.brand]){const input=clone(p);mutate(input);assert.deepEqual(Service.validateArticle(input,{now}),Legacy.validateArticle(input,{now}));assert.equal(Service.validateArticle(input,{now}).ok,false);}});
 const old=Service.rowForArticle(product({},now-30*Service.DAY_MS)),all=frozen([row,old,...bad]);
 const currentStatus=await Service.status(reader(all),{now}),legacyStatus=await Legacy.status(reader(all),{now});check(()=>{assert.deepEqual(currentStatus,legacyStatus);assert.equal(currentStatus.storedArticles,all.length);assert.equal(currentStatus.heldArticles,1);assert.equal(currentStatus.excludedInvalidArticles,bad.length-1);assert.equal(currentStatus.lastObservedArticles,2);assert.equal(currentStatus.lastObservedAt,p.observedAt);});
 const many=frozen(Array.from({length:75},()=>clone(row))),manyReader=reader(many),fullStatus=await Service.status(manyReader,{now});check(()=>{assert.equal(fullStatus.storedArticles,75);assert.equal(fullStatus.lastObservedArticles,75);assert(manyReader.log.filter(q=>q.sql.startsWith("SELECT source_id")).every(q=>!q.sql.includes("LIMIT")),"Status retains complete native metadata revalidation");});
 const sameReader=reader([clone(row)]);calls.venue=0;calls.items=0;
 await Candidate.search(sameReader,{now});await Candidate.status(sameReader,{now});check(()=>{assert.equal(calls.venue,2);assert.equal(calls.items,2,"Every read still reparses original venue and native item");});
 sameReader.query=async sql=>({rows:sql.includes("CREATE TABLE")?[]:[{...row,held:true}]});const changed=await Candidate.search(sameReader,{now});check(()=>assert.equal(changed.items.length,0,"Unchanged hashes do not cache away a new hold"));
 const clocked=await Candidate.search(reader([row]),{now:base-1});check(()=>assert.equal(clocked.items.length,0,"Clock revalidation happens on every request"));
 const mutable=(await Service.search(reader([row]),{now})).items[0];mutable.shop.city="Changed caller view";mutable.name="Changed caller label";
 const reread=await Service.search(reader([row]),{now});check(()=>{assert.equal(reread.items[0].shop.city,"Berlin");assert.equal(reread.items[0].name,p.name);assert.equal(row.shop.city,"Berlin");assert.equal(JSON.stringify(p),original);});
 const page=frozen(Array.from({length:50},(_,i)=>i===0?clone(row):{...clone(row),held:true})),raw=await readPair(page,{now,offset:100});check(()=>{assert.equal(raw.items.length,1);assert.equal(raw.scannedRows,50);assert.equal(raw.nextOffset,150);assert.equal(raw.hasMore,true);});
 async function hashes(service){let count=0;const native=crypto.createHash;crypto.createHash=(...args)=>{count++;return native(...args);};try{await service.status(reader([row]),{now});return count;}finally{crypto.createHash=native;}}
 const oldHashes=await hashes(Legacy),newHashes=await hashes(Service);check(()=>{assert(oldHashes>100);assert.equal(newHashes,3,"Only the three genuine stored SHA checks remain on a valid read");});
 console.log(`wolt-article-read-equality: ${groups} groups passed; native original→persisted row→reader/status unchanged, exact canonical/error semantics, immutable stored SHA, ${oldHashes}→${newHashes} SHA calls per valid read; no HTTP/real SQL or timing claim`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
