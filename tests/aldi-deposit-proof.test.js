"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),Client=require("../aldi-assortment-client"),Proof=require("../aldi-deposit-proof"),Contract=require("../aldi-deposit-render-contract.json");
const dir=path.join(__dirname,"fixtures","retailers","aldi-deposit"),hash=raw=>crypto.createHash("sha256").update(raw).digest("hex"),clone=structuredClone;
const originals=["original-taste-4039","classic-1026202"].map(name=>{const raw=fs.readFileSync(path.join(dir,name+".html"),"utf8"),response=require(path.join(dir,name+"-response.json"));assert.equal(hash(raw),response.sourceResponseHash,"Original response bytes remain immutable");assert.equal(response.status,200);return{raw,product:Client.extractProducts(raw).products[0],meta:{...response,raw,sourceResponseDate:response.headers.date,sourceAgeSeconds:null}};});
const modules=Object.fromEntries(Contract.modules.map(m=>{const bytes=fs.readFileSync(path.join(dir,m.file));assert.equal(hash(bytes),m.sourceResponseHash);assert.equal(bytes.length,m.bytes);assert.equal(m.status,200);return[m.file,bytes.toString("utf8")];}));
// Actual immutable source graph: PDP entry -> wrapper -> config55056 ->
// ProductCardDetail2308 -> Tag45310, whose raw depositValue is already pack total.
assert(modules["module-2.js"].includes("58294"));
assert(modules["module-2.js"].includes("55056")&&modules["module-2.js"].includes("n.e(78781)"));
assert(modules["observed-config.js"].includes('eM=a(2308)'));
assert(modules["observed-config.js"].includes('deposit:r["/products/info/deposit"]'));
assert(modules["observed-product-presenter.js"].includes("2308:")&&modules["observed-product-presenter.js"].includes("n(45310)"));
assert(modules["observed-product-presenter.js"].includes('P.T,{product:t,salesUnit:X,disabled:!G||Y,footnotes:ev,parentElement:ei,legalFields:I,locale:R}'));
assert(modules["observed-detail-prices.js"].includes('P="offer"===a||"offer_highlight"===a?t?.promotionPrices?.at(0):t?.currentPrice'));
assert(modules["observed-detail-prices.js"].includes('isDepositProduct:S=!1,depositValue:N=0'));
assert(modules["observed-detail-prices.js"].includes('children:`${k}: ${(0,i.a)(N,b)}`'));
for(const[id,token]of[[78781,'5d6fd8c2e0093a2a'],[18346,'e4daeb619d345729']])assert(modules["webpack-module.js"].includes(id+':"'+token+'"'));
assert(modules["webpack-module.js"].includes('62903===e?"static/chunks/"+e+"-2185e131bc432b84.js"'));
const dom=require("./fixtures/retailers/aldi-deposit/rendered-dom-proof.json");assert.equal(dom.isProductionFallback,false);assert.equal(dom.observations.length,2);
for(const[o,deposit,payable,count]of[[originals[0],.25,1.84,1],[originals[1],2.25,3.60,9]]){
 const parsed=Client.parseProduct(o.product,o.meta);assert.equal(parsed.ok,true);assert.equal(parsed.offer.deposit,deposit);assert.equal(parsed.offer.depositIncluded,false);assert.equal(parsed.offer.packCount,count);assert.equal(Math.round((parsed.offer.price+parsed.offer.deposit)*100)/100,payable);assert(Proof.validateProof(parsed.offer));assert.equal(parsed.offer.depositBasisProof.depositAmountBasis,"sales-pack-total");
 for(const patch of[{deposit:deposit*count+1},{price:parsed.offer.price+.01},{pack:"1 l"},{sourceResponseHash:"b".repeat(64)},{sourceUrl:originals[count===9?0:1].meta.sourceUrl},{capturedAt:"2026-10-03T00:00:00.000Z"},{retailerSku:"123"},{depositIncluded:true}])assert.equal(Proof.validateProof({...parsed.offer,...patch}),false);
 for(const patch of[{buildId:"new-build"},{rendererManifestHash:"c".repeat(64)},{depositAmountBasis:"per-container"},{depositPriceBasis:"included"},{proofHash:"a".repeat(64)},{extra:true}])assert.equal(Proof.validateProof({...parsed.offer,depositBasisProof:{...parsed.offer.depositBasisProof,...patch}}),false);
 assert.equal(Proof.proofForProduct({...o.product,depositValue:.2},o.meta),null,"Native product must exactly match original HTML response");
 assert.equal(Proof.proofForProduct(o.product,{...o.meta,sourceResponseHash:"a".repeat(64)}),null);
 assert.equal(Proof.proofForProduct(o.product,{...o.meta,raw:undefined}),null);
 assert.equal(Client.parseProduct(o.product,{...o.meta,raw:undefined}).offer,null);
 for(const replace of[s=>s.replace(Proof.BUILD_ID,"new-build"),s=>s.replace('zzgl. Pfand','inkl. Pfand'),s=>s.replace('productDetailPage','pressReleasePage'),s=>s.replace('webpack-ed83aec7aee5f9e2.js','webpack-unknown.js'),s=>s.replace('51c210556f32ed9e.js','unknown.js'),s=>s.replace('465e46d10bfd276f.js','unknown.js')]){const changed=replace(o.raw);assert.notEqual(changed,o.raw);assert.equal(Client.parseProduct(o.product,{...o.meta,raw:changed,sourceResponseHash:hash(changed)}).offer,null,"Changed renderer/localization/route holds deposit price instead of guessing");}
}
async function main(){
 let reads=0;const at=originals[0].meta.capturedAt;
 const collected=await Client.fetchProducts([originals[0].meta.sourceUrl],{maxRequests:1,now:()=>at,sleep:async()=>{},fetchImpl:async url=>{reads++;assert.equal(url,originals[0].meta.sourceUrl);return{status:200,headers:{get:key=>key==='date'?originals[0].meta.headers.date:null},text:async()=>originals[0].raw};}});
 assert.equal(reads,1,"Deposit proof adds no unbudgeted native module requests");assert.equal(collected.requests,1);assert.equal(collected.offers.length,1);assert.equal(collected.offers[0].deposit,.25);assert.equal(collected.confirmedTargets.length,1);assert(Proof.validateProof(collected.offers[0]));
 console.log("aldi-deposit-proof: immutable original bytes and reviewed PDP renderer graph, exact native pack-total deposit, changed build fail-closed, no additional HTTP requests OK");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
