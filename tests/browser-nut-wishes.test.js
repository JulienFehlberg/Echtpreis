"use strict";
const assert=require("assert/strict"),fs=require("fs"),{JSDOM,VirtualConsole}=require("jsdom");
const Lidl=require("../lidl-price-publications"),fixture=require("./helpers/lidl-capture-fixture").fixture;

// Original, archived announcements are document evidence, never current prices.
const dated=Lidl.parseCapture(fixture(),{now:Date.parse("2026-10-02T18:00:00Z")}).datedPublications;
async function setup(){
 const errors=[],calls=[],vc=new VirtualConsole();vc.on("jsdomError",e=>errors.push(e.message));let rows=[];
 const dom=new JSDOM(fs.readFileSync("index.html","utf8"),{runScripts:"dangerously",url:"https://caddy.example.test/",pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.AbortController=global.AbortController;w.SPARKORB_CONFIG={apiBase:"https://prices.example.test"};
  w.fetch=async input=>{const url=new URL(String(input),w.location.href);if(url.pathname==="/v1/berlin-reference-prices"){calls.push(url);return{ok:true,json:async()=>({ok:true,city:"Berlin",country:"DE",items:[],publications:[],datedPublications:rows,bounded:true,truncated:false})};}return{ok:false,status:503,json:async()=>({})};};
  for(const file of ["app/price-engine.js","wolt-sales-pack-validation.js","app/current-price-client.js","app/published-product-client.js","app/penny-reference-client.js","app/lidl-reference-client.js","app/berlin-reference-client.js","shopping-need-matcher.js"])w.eval(fs.readFileSync(file,"utf8"));
  w.alert=()=>{};w.confirm=()=>true;w.prompt=()=>null;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){};
  Object.defineProperty(w.navigator,"geolocation",{value:{getCurrentPosition(){throw Error("Nut references do not require location permission");}}});
 }});await new Promise(r=>setTimeout(r,60));return{w:dom.window,errors,calls,set(next){rows=next;}};
}
(async()=>{const f=await setup(),w=f.w;let checks=0;try{
 const parse=raw=>w.parseWish(raw),assessment=(raw,name)=>w.berlinReferenceWishAssessment(parse(raw),{name});
 const cases=[
  ["Cashewkerne200g","cashewkerne",.2,"200 g"],["Cashewkerne 200 g","cashewkerne",.2,"200 g"],
  ["200g Cashewkerne","cashewkerne",.2,"200 g"],["Cashews 0,2kg","cashewkerne",.2,"200 g"],
  ["Studentenfutter200g","studentenfutter",.2,"200 g"],["Studentenfutter 200 Gramm","studentenfutter",.2,"200 g"],
  ["Mandeln150g","mandeln",.15,"150 g"],["150 g Mandeln","mandeln",.15,"150 g"],
  ["Erdnüsse200g","erdnuesse",.2,"200 g"],["Erdnuesse 200 g","erdnuesse",.2,"200 g"]
 ];
 for(const[raw,key,amount,pack]of cases){const wish=parse(raw);assert.equal(wish.key,key,raw);assert.equal(wish.calcAmount,amount,raw);assert.equal(wish.packLabel,pack,raw);assert.equal(wish.packCount,1);assert.equal(!!wish.needsQuantity,false);assert.equal(wish.selectedProduct,undefined);assert.equal(wish.ean,undefined);assert.equal(wish.gtin,undefined);assert.equal(wish.retailerSku,undefined);assert.equal(wish.price,undefined);assert.equal(w.referencePrice(key,"Lidl",wish),null);assert.equal(w.activePrice(key,"Lidl",wish),null);checks++;}
 for(const raw of ["Cashewkerne","Studentenfutter","Mandeln","Erdnüsse"]){const wish=parse(raw);assert.equal(wish.matched,true);assert.equal(wish.needsQuantity,true);assert.equal(wish.needsClarification,true);assert.equal(wish.packLabel,undefined,"No assumed standard pack: "+raw);checks++;}
 const multi=parse("2 Packungen Cashewkerne à 200 g");assert.equal(multi.key,"cashewkerne");assert.equal(multi.packCount,2);assert.equal(multi.packAmount,.2);assert.equal(multi.calcAmount,.4);assert.equal(multi.packLabel,"200 g");checks++;
 for(const raw of ["Cashewmilch 200g","Cashewcreme 200g","Cashewmus 200g","Nussmix mit Cashewkerne 200g","Nussmischung mit Cashewkerne 200g","Cashewkerne mit Walnüssen 200g","Schokolade mit Cashewkerne 200g","Cashewkerne und Mandeln 200g","Mandeln schokoliert 150g","Mandeln in Honig 150g","Mandeldrink 150g","Erdnussbutter 200g"]){assert(!["cashewkerne","studentenfutter","mandeln","erdnuesse"].includes(parse(raw).key),"Different product/form must not become a plain nut: "+raw);checks++;}
 for(const raw of ["0g Cashewkerne","200ml Cashewkerne"]){assert.notEqual(parse(raw).key,"cashewkerne",raw);checks++;}
 assert.equal(parse("Mandelmilch").key,null);assert.equal(parse("Erdnussbutter").key,"erdnussbutter");checks++;
 for(const[name,key]of [["Alesto Cashewkerne","cashewkerne"],["Alesto Studentenfutter","studentenfutter"],["Alesto Mandeln natur","mandeln"],["Bravo Erdnüsse geröstet und gesalzen","erdnuesse"]]){assert.equal(w.berlinReferenceWishAssessment(parse(w.eval("catalog["+JSON.stringify(key)+"].label")+" 200g"),{name}).status,"unconfirmed","Generic family never proves concrete identity");checks++;}
 for(const name of ["Cashewmilch","Cashewcreme","Cashewmus","Nussmix mit Cashewkerne","Nussmischung mit Cashewkerne","Cashewkerne mit Walnüssen","Cashewkerne mit Mandeln","Schokolade mit Cashewkerne","Honig Cashewkerne"]){assert.equal(assessment("Cashewkerne200g",name).status,"contradicted",name);checks++;}
 assert.equal(assessment("Cashewkerne ungesalzen 200g","Alesto Cashewkerne gesalzen").status,"contradicted");
 assert.equal(assessment("Cashewkerne natur 200g","Alesto Cashewkerne gesalzen").status,"contradicted");
 assert.equal(assessment("Cashewkerne geröstet 200g","Alesto Cashewkerne ungeröstet").status,"contradicted");
 assert.equal(assessment("Mandeln gehobelt 150g","Mandeln ganz").status,"contradicted");
 assert.equal(assessment("Mandeln Bio 150g","Mandeln konventionell").status,"contradicted");
 assert.equal(assessment("Studentenfutter mit Cranberries 200g","Studentenfutter mit Rosinen").status,"contradicted");
 assert.equal(assessment("Studentenfutter classic 200g","Studentenfutter mit Cranberries").status,"contradicted");checks+=7;
 assert.equal(assessment("ungesalzene Erdnüsse200g","Bravo gesalzene Erdnüsse").status,"contradicted","Native inflected salt adjective cannot be treated as missing");checks++;
 assert.equal(assessment("ungeröstete Cashewkerne200g","Alesto geröstete Cashewkerne").status,"contradicted","Native inflected roasting adjective cannot be treated as missing");checks++;
 for(const raw of ["Cashewkerne extra mild 200g","Studentenfutter ohne Rosinen 200g","Studentenfutter mit Mango 200g","Cashewkerne gesalzen ungesalzen 200g"]){const result=assessment(raw,"Alesto "+(raw.startsWith("Studenten")?"Studentenfutter":"Cashewkerne"));assert.equal(result.status,"contradicted");assert.equal(result.reason,"need-selection-required","Unsupported explicit properties stay unresolved: "+raw);checks++;}
 assert.equal(assessment("Cashewkerne Bio ungesalzen 200g","Alesto Cashewkerne").status,"unconfirmed","Missing properties are open rather than invented");checks++;
 w.learnProductAlias("Cashewmilch","cashewkerne");assert.notEqual(parse("Cashewmilch").key,"cashewkerne");assert.notEqual(w.identifyReceiptProduct("Cashewmilch").key,"cashewkerne");checks++;
 assert.deepEqual(Array.from(w.splitShoppingSpeech("Cashewkerne 200g und Studentenfutter 200g und Mandeln 150g und Erdnüsse 200g")),["Cashewkerne 200g","Studentenfutter 200g","Mandeln 150g","Erdnüsse 200g"]);checks++;
 w.eval("selected=new Set(['ALDI','PENNY','REWE','Lidl','Kaufland','EDEKA']);verifiedPriceLocation=null;nearbyStores=[];hasCompared=false;");
 const section=w.document.getElementById("berlinReferenceComparison");
 for(const[raw,ordinal,search,pack]of [["Cashewkerne200g",1,"Cashewkerne","200 g"],["Studentenfutter200g",2,"Studentenfutter","200 g"],["Mandeln150g",6,"Mandeln","150 g"]]){
  const row=dated.find(x=>x.publication.groupOrdinal===ordinal);assert(row,"Original announcement group exists");f.set([row]);w.eval("basket=[parseWish("+JSON.stringify(raw)+")];comparisonRevision++;");await w.compare({skipLocation:true,scroll:false});
  assert(section.textContent.includes(row.publication.name),"Real parsed wish displays its exact native group: "+raw);assert.equal(f.calls.at(-1).searchParams.get("search"),search);assert.equal(f.calls.at(-1).searchParams.get("pack"),pack);assert(section.textContent.includes("Veröffentlicht am 01.10.2026"));assert(section.textContent.includes("Heutiger Filialpreis/Pfand/Variante offen"));assert(section.textContent.includes("Noch kein aktueller Berliner Preisbeleg"));assert.equal(section.querySelectorAll("button").length,0);assert.equal(w.eval("basket[0].selectedProduct"),undefined);assert.equal(w.activePrice(w.eval("basket[0].key"),"Lidl",w.eval("basket[0]")),null);checks++;
 }
 const cashew=dated.find(x=>x.publication.groupOrdinal===1);f.set([cashew]);w.eval("basket=[parseWish('Studentenfutter200g')];comparisonRevision++;");await w.compare({skipLocation:true,scroll:false});assert(!section.textContent.includes(cashew.publication.name),"A raw Cashew group is not Studentenfutter");checks++;
 f.set([cashew]);w.eval("basket=[parseWish('Cashewkerne extra mild 200g')];comparisonRevision++;");await w.compare({skipLocation:true,scroll:false});assert(section.textContent.includes("Bitte wähle ein konkretes Produkt"));assert(!section.textContent.includes(cashew.publication.name));checks++;
 assert.deepEqual(f.errors,[]);console.log("browser-nut-wishes: "+checks+" parser/family/quantity/reference checks; no assumed identity, pack, price or winner OK");
 }finally{w.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
