"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const Store = require("../aldi-category-rejected-capture-store"), Parser = require("../aldi-assortment-category-client"), Fixture = require("./fixtures/aldi-category-capture");
const now = Date.parse("2026-10-03T06:25:00.123Z"), capturedAt = now - 1000;
const pagePath = "/germany/sortiment/milchprodukte/milch-milchgetraenke";
const url = name => "https://www.aldi-nord.de/sortiment/" + name + ".html";
function nativeFixture() {
  const body = Fixture.html(Array.from({length:32},(_,i)=>Fixture.item({objectID:String(1040001+i),productSlug:"unit-test-"+(1040001+i)})));
  const native = JSON.parse(body.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]);
  native.syntheticDiagnosticFixture = "NEW SYNTHETIC ORIGINAL, not a captured archive";
  native.props.pageProps.page = {...native.props.pageProps.page,"@name":"milch-milchgetraenke","mgnl:template":"aldi-nord-foundation:pages/productCategoryPage",categoryKey:"synthetic-deliberate-parser-rejection",
    componentList:["typography","textAndMedia","banner","richText"],opener:{"@name":"opener","@path":pagePath+"/opener","@nodes":[]},
    openContent:{"@name":"openContent","@path":pagePath+"/openContent",0:{"@name":"0","@path":pagePath+"/openContent/0","mgnl:template":"aldi-nord-foundation:components/typography"},
      "00":{"@name":"00","@path":pagePath+"/openContent/00","mgnl:template":"aldi-nord-foundation:components/textAndMedia",path:url("local-diagnostic-child")}},
    bannerContent:{"@name":"bannerContent","@path":pagePath+"/bannerContent",0:{"@name":"0","@path":pagePath+"/bannerContent/0","mgnl:template":"aldi-nord-foundation:components/banner"}}};
  return native;
}
function bodyFor(native) { return '<html><head><link rel="canonical" href="'+Fixture.url+'"></head><body><script id="__NEXT_DATA__" type="application/json">'+JSON.stringify(native)+'</script></body></html>'; }
function rejectedBody(body) {
  const original=Fixture.original(body,capturedAt); let failureCode;
  try { Parser.parsePage(body,original.meta,{now}); } catch(error) { failureCode=error.code; }
  assert(Store.FAILURE_CODES.includes(failureCode),"Only the actual parser's closed native error is diagnosed");
  return{status:200,failureCode,original};
}
const summary=(change=()=>{},options={now})=>{const native=nativeFixture();change(native);return Store.diagnosticSummary(rejectedBody(bodyFor(native)),options)};
const bodySummary=body=>Store.diagnosticSummary(rejectedBody(body),{now});
let groups=0,archiveChecked=false;
function test(name,fn){try{fn();groups++;}catch(error){console.error("Failed: "+name);throw error;}}

test("page-local CMS is reserved independently of a saturated global header",()=>{
  const s=summary(n=>n.props.pageProps.page.header=[{flyoutNavigation:[{Produkte:{children:Array.from({length:90},(_,i)=>({label:"HEADER "+i,path:url("header-"+i)}))}}]}]);
  assert.deepEqual(s.localCms.componentList.names,["typography","textAndMedia","banner","richText"]);
  assert.equal(s.localCms.openContent.children.find(x=>x.key==="00").values["mgnl:template"],"aldi-nord-foundation:components/textAndMedia");
  assert.equal(s.localCms.bannerContent.children[0].values["mgnl:template"],"aldi-nord-foundation:components/banner");
  assert(s.cmsStructures.some(x=>x.at.includes("openContent.00")));assert.equal(s.globalNavigationStructures.length,32);assert.equal(s.truncation.structures,true);
  assert(s.urlEvidence.some(x=>x.url===url("local-diagnostic-child")&&x.scope==="page-local"&&x.childParentBindingVerified===false));
  assert(s.urlEvidence.some(x=>x.scope==="global-navigation"));
});
test("native result and request shape are explicit without hits prices or identities",()=>{
  const s=summary(),state=s.stateQueryShapes[0],r=state.results[0],wire=JSON.stringify(s);
  assert.equal(state.indexName,Fixture.index);assert.equal(state.index,Fixture.index);assert.equal(state.resultArrays,1);assert.equal(state.requestArrays,1);
  assert.equal(r.page,0);assert.equal(r.nbHits,32);assert.equal(r.nbPages,1);assert.equal(r.hitsPerPage,1000);assert.equal(r.actualHits,32);assert.equal(r.exhaustiveNbHits,true);assert.equal(r.exhaustiveCount,true);
  assert.equal(state.requests[0].filters,"categoryIDs:"+Fixture.categoryId);assert.equal(state.requests[0].hitsPerPage,1000);
  for(const secret of["1040001","UNIT TEST Milk","priceValue",'"currentPrice":',"productSlug","salesUnit"])assert(!wire.includes(secret),secret);
});
test("original capture Date Age checksum and dated authority never change",()=>{
  const value=rejectedBody(bodyFor(nativeFixture())),before=JSON.stringify(value),s=Store.diagnosticSummary(value,{now:now+30*86400000});
  assert.equal(s.capturedAt,value.original.meta.capturedAt);assert.equal(s.sourceResponseDate,value.original.meta.sourceResponseDate);assert.equal(s.sourceAgeSeconds,0);assert.equal(s.sourceResponseHash,value.original.meta.sourceResponseHash);
  assert.equal(JSON.stringify(value),before);for(const key of["current","fresh","admitted","truthEligible","currentPriceVerified","physicalStorePriceVerified","currentAvailabilityVerified","canonicalIdentityVerified","normalPriceClassificationVerified","assortmentComplete"])assert.equal(s[key],false);
  assert.equal(s.discoveryOnly,true);assert.equal(s.expiresAt,null);assert.equal(s.availability,"unknown");assert.equal(s.articleRowsCreated,0);assert.equal(s.priceRowsCreated,0);
  for(const key of["body","original","gtin","price","storeId","products","hits"])assert(!Object.hasOwn(s,key));
});
test("NEXT_DATA parsed and canonical response binding are separately explicit",()=>{
  const s=summary();assert.deepEqual(s.nextData,{scriptCount:1,jsonParseState:"parsed",nativeKind:"object"});assert.deepEqual(s.canonical,{linkCount:1,parseState:"valid",url:Fixture.url,matchesResponseUrl:true});
});
for(const [name,edit,expected] of[
  ["missing",body=>body.replace(/<script[\s\S]*?<\/script>/,""),{scriptCount:0,jsonParseState:"missing"}],
  ["duplicate",body=>body.replace("</body>",'<script id="__NEXT_DATA__" type="application/json">{}</script></body>'),{scriptCount:2,jsonParseState:"duplicate"}],
  ["unsupported type",body=>body.replace('type="application/json"','type="text/plain"'),{scriptCount:1,jsonParseState:"unsupported-type"}],
  ["invalid JSON",body=>body.replace('"syntheticDiagnosticFixture":','"syntheticDiagnosticFixture" '),{scriptCount:1,jsonParseState:"invalid-json"}]
])test("NEXT_DATA "+name+" never becomes a navigation page",()=>{const s=bodySummary(edit(bodyFor(nativeFixture())));assert.equal(s.nextData.scriptCount,expected.scriptCount);assert.equal(s.nextData.jsonParseState,expected.jsonParseState);assert.equal(s.admitted,false);assert.equal(s.nativeRoute,null);});
for(const [name,edit,state,count] of[
  ["missing",body=>body.replace(/<link[^>]*>/,""),"missing",0],
  ["duplicate",body=>body.replace("</head>",'<link rel="canonical" href="'+Fixture.url+'"></head>'),"duplicate",2],
  ["foreign",body=>body.replace(Fixture.url,"https://other.example/page?access_token=TOP_SECRET"),"invalid-url",1],
  ["different native category",body=>body.replace(Fixture.url,url("different-category")),"valid",1]
])test("canonical "+name+" is explicit and unadmitted",()=>{const s=bodySummary(edit(bodyFor(nativeFixture())));assert.equal(s.canonical.parseState,state);assert.equal(s.canonical.linkCount,count);assert.equal(s.canonical.matchesResponseUrl,state==="valid"?false:null);assert(!JSON.stringify(s).includes("TOP_SECRET"));});
test("missing index with genuine header hints stays a failed unknown page",()=>{
  const s=summary(n=>{delete n.props.pageProps.algoliaState;n.props.pageProps.page.categoryKey=Fixture.categoryId;});
  assert.equal(s.failureCode,"aldi-category-native-index-conflict");assert.deepEqual(s.algoliaIndexNames,[]);assert.deepEqual(s.stateQueryShapes,[]);assert(s.presentCategoryUrls.length>0);assert.equal(s.assortmentComplete,false);assert.equal(s.admitted,false);
});
test("component names child descriptors and metadata keys expose all caps",()=>{
  const s=summary(n=>{const p=n.props.pageProps.page;p.componentList=Array.from({length:100},(_,i)=>"component"+i);p.openContent=Object.fromEntries(Array.from({length:70},(_,i)=>[String(i),{"@name":String(i),"@path":pagePath+"/openContent/"+i,"mgnl:template":"synthetic:component"}]));for(let i=0;i<100;i++)p.opener["field"+i]=i;});
  assert.equal(s.localCms.componentList.names.length,32);assert.equal(s.localCms.componentList.count,100);assert.equal(s.localCms.openContent.children.length,32);assert.equal(s.localCms.openContent.childCount,70);assert.equal(s.truncation.componentNames,true);assert.equal(s.truncation.localStructures,true);assert.equal(s.truncation.keys,true);assert.equal(s.diagnosticTraversalBounded,true);
});
test("index result request and category caps retain native counts without arbitrary params",()=>{
  const s=summary(n=>{const p=n.props.pageProps;const entry=p.algoliaState.initialResults[Fixture.index];entry.results=Array.from({length:4},()=>structuredClone(entry.results[0]));entry.requestParams=Array.from({length:5},()=>({filters:"categoryIDs:"+Fixture.categoryId,hitsPerPage:1000,page:0,apiKey:"NEVER_EXPOSE_API_KEY",headers:{authorization:"NEVER_EXPOSE_BEARER"},params:"access_token=NEVER_EXPOSE_TOKEN"}));p.algoliaState.initialResults=Object.fromEntries(Array.from({length:25},(_,i)=>["an_synthetic_index_"+i,structuredClone(entry)]));n.query.categories=Array.from({length:20},(_,i)=>"category"+i);});
  assert.equal(s.algoliaIndexNames.length,16);assert.equal(s.stateQueryShapes.length,16);assert.equal(s.stateQueryShapes[0].results.length,2);assert.equal(s.stateQueryShapes[0].resultArrays,4);assert.equal(s.stateQueryShapes[0].requests.length,2);assert.equal(s.stateQueryShapes[0].requestArrays,5);assert.equal(s.queryCategories.length,6);
  for(const key of["indexes","results","requests","queryCategories"])assert.equal(s.truncation[key],true);
  const wire=JSON.stringify(s);for(const secret of["NEVER_EXPOSE_API_KEY","NEVER_EXPOSE_BEARER","NEVER_EXPOSE_TOKEN",'"authorization":','"headers":','"params":'])assert(!wire.includes(secret),secret);
});
test("nonempty search opaque filters foreign URLs and token values are not copied",()=>{
  const s=summary(n=>{const p=n.props.pageProps,entry=p.algoliaState.initialResults[Fixture.index];entry.state.query="Bearer ACTUAL_SECRET";entry.state.filters="apiKey=ACTUAL_SECRET";entry.results[0].query="secret native query";entry.requestParams[0].filters="access_token=ACTUAL_SECRET";p.page.opener.title="Authorization: ACTUAL_SECRET";p.page.opener.path="https://other.example/?token=ACTUAL_SECRET";});
  assert.equal(s.stateQueryShapes[0].query,null);assert.equal(s.stateQueryShapes[0].queryEmpty,false);assert.equal(s.stateQueryShapes[0].filters,null);assert.equal(s.stateQueryShapes[0].requests[0].filters,null);assert(!JSON.stringify(s).includes("ACTUAL_SECRET"));assert.equal(s.truncation.unsafeValues,true);
});
test("URL cap scope and no foreign product query normalization",()=>{
  const s=summary(n=>{n.props.pageProps.page.openContent.urls=Array.from({length:200},(_,i)=>url("local-"+i));n.otherUrls=["https://www.aldi-nord.de/produkt/test-1040001.html",url("query")+"?token=SECRET",url("fragment")+"#fake","https://evil.example/sortiment/test.html"];});
  assert.equal(s.presentCategoryUrls.length,128);assert.equal(s.truncation.urls,true);assert(s.urlEvidence.every(x=>x.childParentBindingVerified===false));assert(!s.presentCategoryUrls.some(x=>x.includes("/produkt/")||x.includes("?")||x.includes("#")||x.includes("evil.example")));
});
test("sensitive native paths category filters canonical and URL evidence never leak nested values",()=>{
  const marker="PRIVATE_DIAGNOSTIC_TOKEN",slug="access-token-private-diagnostic-token";
  const n=nativeFixture(),entry=n.props.pageProps.algoliaState.initialResults[Fixture.index];
  n.props.pageProps.page.openContent[0]["@path"]="/germany/sortiment/access_token/"+marker;
  n.props.pageProps.page["@path"]="/germany/sortiment/access_token/"+marker;
  n.props.pageProps.page.openContent[0].path=url(slug);n.otherUrls=[url(slug)];
  entry.state.filters="categoryIDs:"+slug;entry.results[0].filters="categoryIDs:"+slug;entry.requestParams[0].filters="categoryIDs:"+slug;
  const s=bodySummary(bodyFor(n).replace('<link rel="canonical" href="'+Fixture.url+'">','<link rel="canonical" href="'+url(slug)+'">'));
  const wire=JSON.stringify(s);assert(!wire.includes(marker));assert(!wire.includes(slug));assert.equal(s.truncation.unsafeValues,true);
  assert.equal(s.nativePage["@path"],null);assert(!Object.hasOwn(s.localCms.openContent.children[0].values,"@path"));assert.equal(s.canonical.url,null);assert.equal(s.canonical.parseState,"invalid-url");
  assert.equal(s.stateQueryShapes[0].filters,null);assert.equal(s.stateQueryShapes[0].results[0].filters,null);assert.equal(s.stateQueryShapes[0].requests[0].filters,null);assert(s.presentCategoryUrls.every(x=>!x.includes(slug)));
});
test("depth cuts are visible even without the node budget being exhausted",()=>{
  const s=summary(n=>{let branch=n;for(let i=0;i<30;i++)branch=branch.deep={};branch.path=url("unreachable-depth");});
  assert.equal(s.truncation.depth,true);assert(s.diagnosticVisitedNodes<10000);assert.equal(s.diagnosticTraversalBounded,true);assert(!s.presentCategoryUrls.includes(url("unreachable-depth")));
});
test("node budget is bounded independently of depth and key flags",()=>{
  const s=summary(n=>{n.tree=Array.from({length:180},()=>Array.from({length:180},()=>({leaf:[1,2,3,4,5]})));});
  assert.equal(s.diagnosticVisitedNodes,10000);assert.equal(s.truncation.visitedNodes,true);assert.equal(s.diagnosticTraversalBounded,true);
});
test("huge strings keys path clipping and object injection never enter diagnostic values",()=>{
  const before={}.diagnosticPollution;
  const s=summary(n=>{const p=n.props.pageProps.page;p.opener.title="HUGE_PRIVATE_VALUE_"+"x".repeat(700000);p.openContent["z".repeat(1000)]={path:url("huge-key")};p.opener["__proto__"]={diagnosticPollution:true};Object.defineProperty(p.opener,"__proto__",{value:{diagnosticPollution:true},enumerable:true});let branch=p.openContent;for(let i=0;i<8;i++)branch=branch["p".repeat(70)]={};branch.path=url("long-source-path");n.rawHtml="<div>RAW_PRIVATE_BODY</div>";});
  assert.equal({}.diagnosticPollution,before);const wire=JSON.stringify(s);assert(!wire.includes("HUGE_PRIVATE_VALUE_"));assert(!wire.includes("RAW_PRIVATE_BODY"));assert(!wire.includes("diagnosticPollution"));assert.equal(s.truncation.strings,true);assert.equal(s.truncation.keys,true);assert.equal(s.truncation.path,true);assert(wire.length<150000);
});
test("typed malformed counts stay null and native flags are literal only",()=>{
  const s=summary(n=>{const p=n.props.pageProps,r=p.algoliaState.initialResults[Fixture.index].results[0];r.nbHits="32";r.nbPages={not:"a count"};r.page=false;r.hitsPerPage=Infinity;r.exhaustiveNbHits="true";r.exhaustive.nbHits=1;p.hasError="true";p.country="DE";p.mgnlContext={isMagnoliaEdit:false,isMagnoliaPreview:true};});
  const r=s.stateQueryShapes[0].results[0];for(const key of["nbHits","nbPages","page","hitsPerPage","exhaustiveNbHits","exhaustiveCount"])assert.equal(r[key],null);assert.equal(s.nativeFlags.hasError,null);assert.equal(s.nativeFlags.country,"DE");assert.equal(s.nativeFlags.magnoliaEdit,false);assert.equal(s.nativeFlags.magnoliaPreview,true);assert.equal(s.admitted,false);
});
test("component arrays containing objects are never echoed as a native navigation schema",()=>{
  const s=summary(n=>n.props.pageProps.page.componentList=[{rawNativeSecret:"NEVER_EXPOSE_OBJECT"},null,7,"typography"]);
  assert.deepEqual(s.localCms.componentList.names,["typography"]);assert.equal(s.localCms.componentList.count,4);assert(!JSON.stringify(s).includes("NEVER_EXPOSE_OBJECT"));assert.equal(s.admitted,false);
});
function checkSavedArchive(){
  const filename=path.resolve(__dirname,"../../price-sources-probes/aldi-nord-milk-category-live.html");
  if(!fs.existsSync(filename))return; // CI intentionally has no private work archive.
  const bytes=fs.readFileSync(filename);assert.equal(Store.hash(bytes),"9d2cc334cda0b1653052d243635cac30fd25c54650015a6633c5edbc51bc9526");
  const body=bytes.toString("utf8"),originalParse=Parser.parsePage(bytes,{},{});assert.equal(originalParse.receivedCount,32);assert.equal(originalParse.candidateCount,23);assert.equal(originalParse.freshCaptureVerified,false);assert.equal(originalParse.offlineOnly,true);
  const script=body.match(/(<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>)([\s\S]*?)(<\/script>)/i),native=JSON.parse(script[2]);native.syntheticDiagnosticFixture="NEW MUTATED TEST COPY; archive capture is unknown";native.props.pageProps.page.categoryKey="synthetic-deliberate-rejection";
  const modified=body.replace(script[0],script[1]+JSON.stringify(native)+script[3]),s=bodySummary(modified);
  assert.notEqual(s.sourceResponseHash,Store.hash(bytes));assert.equal(s.stateQueryShapes[0].results[0].actualHits,32);assert.equal(s.stateQueryShapes[0].results[0].page,0);assert.deepEqual(s.localCms.componentList.names,["typography","textAndMedia","banner","richText"]);
  assert.equal(s.localCms.openContent.children.length,7);assert.equal(s.localCms.bannerContent.children.length,1);assert.equal(s.presentCategoryUrls.length,26);assert.equal(s.truncation.structures,true);assert.equal(s.admitted,false);archiveChecked=true;
}
checkSavedArchive();
console.log(`aldi-category-navigation-diagnostics: ${groups} offline groups passed; reserved local CMS, explicit native parse/pagination shapes, privacy/caps/no admission; archiveChecked=${archiveChecked}; no HTTP or SQL`);
