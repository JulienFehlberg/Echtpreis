"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{EventEmitter}=require('node:events');
const Types=require('../grocery-article-type-service'),Directory=require('../assortment-article-directory');
// Actual HTTP routing and actual closed type service; the native read seam is
// empty and bounded. This fixture never opens a socket, DB or retailer request.
function fixture({database=true,failRead=false}={}){
 const file=path.resolve(__dirname,'../server.js'),nativeRequire=createRequire(file),module={exports:{}},reads=[];
 const pool={query:async()=>assert.fail('No SQL query is allowed in the HTTP fixture'),end:async()=>{}};
 const directory={status:async()=>assert.fail('No status scan requested'),search:async(_pool,options)=>{reads.push(options);if(failRead)throw Error('UNIT TEST original reader failed');return{ok:true,merchant:options.merchant,sourceId:null,scopeCountry:'DE',scopeChannel:'assortment-publication',locationScope:'unknown',truthEligible:false,currentPriceVerified:false,physicalStorePriceVerified:false,assortmentComplete:false,total:null,limit:options.limit,offset:options.offset,offsetSupported:true,scannedRows:options.limit,nextOffset:options.offset+options.limit,hasMore:options.offset+options.limit<=Directory.MAX_OFFSET,excludedRows:options.limit,items:[],returnedCount:0,status:'no-observed-articles'};}};
 const typed={...Types,search:(_pool,options)=>Types.search(pool,JSON.parse(JSON.stringify(options)),{directory})};
 const mocks={pg:{Pool:function(){return pool;}},http:{createServer:()=>({listening:false,close:cb=>cb?.()})},'./grocery-article-type-service':typed,'./assortment-article-directory':{search:async()=>({ok:true,legacyRawRoute:true}),status:async()=>({ok:true,legacyRawStatus:true})}};
 const localRequire=name=>Object.hasOwn(mocks,name)?mocks[name]:nativeRequire(name);localRequire.main=null;
 const sandbox={require:localRequire,module,exports:module.exports,process:{env:database?{DATABASE_URL:'postgres://unit.test/no-connection'}:{},pid:999},console:{log(){},error(){}},Buffer,URL,Date,Promise,setTimeout,clearTimeout,setInterval,clearInterval};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),sandbox,{filename:file});
 async function request(url,method='GET'){
  const req=new EventEmitter(),res=new EventEmitter();Object.assign(req,{method,url,headers:{}});res.setHeader=()=>{};res.writeHead=status=>{res.status=status;res.headersSent=true;};
  const done=new Promise(resolve=>{res.end=text=>{res.writableEnded=true;res.emit('finish');resolve({status:res.status,body:JSON.parse(text)});};});
  await module.exports.handle(req,res);return done;
 }
 return{request,reads,close:()=>module.exports.shutdown()};
}
async function main(){let groups=0;const check=fn=>{fn();groups++;};const f=fixture();
 const map=await f.request('/v1/assortment/type-mapping');check(()=>{assert.equal(map.status,200);assert.equal(map.body.types.length,705);assert.equal(map.body.ruleCoveredProductTypes,25);assert.equal(map.body.unruledProductTypes,680);assert.equal(map.body.countMeaning,'rule-capabilities-not-article-or-retailer-coverage');assert.equal(f.reads.length,0);});
 const unavailable=map.body.types.find(t=>t.state==='mapping-unavailable');const noRule=await f.request('/v1/assortment/typed-articles?merchant=ALDI&productTypeId='+encodeURIComponent(unavailable.productTypeId));check(()=>{assert.equal(noRule.status,200);assert.equal(noRule.body.status,'mapping-unavailable');assert.equal(noRule.body.scanPerformed,false);assert.equal(noRule.body.total,null);assert.equal(noRule.body.assortmentComplete,false);assert.equal(f.reads.length,0);});
 for(const query of['merchant=ALDI&merchant=EDEKA','merchant=ALDI&productTypeId=milchprodukte.unknown','merchant=ALDI&productTypeId=','merchant=ALDI&productTypeId=milchprodukte.butter&productTypeId=milchprodukte.butter','merchant=ALDI&__proto__=x','merchant=ALDI&refresh=true','merchant=ALDI&limit=501','merchant=ALDI&offset=-1','merchant=ALDI&search=x','merchant=REWE&offset=0','merchant=ALDI&now=1','merchant=ALDI&productTypeId=milchprodukte.butter%20']){const r=await f.request('/v1/assortment/typed-articles?'+query);check(()=>{assert.equal(r.status,400,query);assert.equal(f.reads.length,0,query+' must fail before native reader');});}
 for(const suffix of['?merchant=ALDI','?productTypeId=milchprodukte.butter','?','?__proto__=x']){const r=await f.request('/v1/assortment/type-mapping'+suffix);check(()=>{assert.equal(r.status,400);assert.equal(f.reads.length,0);});}
 const supported=map.body.types.find(t=>t.state==='mapping-supported'),page=await f.request('/v1/assortment/typed-articles?merchant=ALDI&limit=2&offset=8&productTypeId='+supported.productTypeId);check(()=>{assert.equal(page.status,200);assert.equal(page.body.returnedCount,0);assert.equal(page.body.hasMore,true);assert.equal(page.body.scannedRows,2);assert.equal(page.body.nextOffset,10);assert.equal(page.body.reason,'no-assigned-type-in-examined-page');assert.equal(page.body.typeMapping.productTypeId,supported.productTypeId);assert.equal(page.body.truthEligible,false);assert.equal(f.reads.length,1);});
 check(()=>assert.deepEqual(f.reads.map(x=>({merchant:x.merchant,limit:x.limit,offset:x.offset})),[{merchant:'ALDI',limit:2,offset:8}]));
 const legacy=await f.request('/v1/assortment/articles?merchant=ALDI');check(()=>{assert.equal(legacy.status,200);assert.equal(legacy.body.legacyRawRoute,true);assert.equal(f.reads.length,1);});
 const legacyReject=await f.request('/v1/assortment/articles?merchant=ALDI&productTypeId='+supported.productTypeId);check(()=>{assert.equal(legacyReject.status,400);assert.equal(legacyReject.body.error,'invalid-assortment-query');});await f.close();
 const absent=fixture({database:false});check(()=>assert.equal(absent.reads.length,0));check(()=>assert.equal((Types.mappingStatus()).types.length,705));const absentMap=await absent.request('/v1/assortment/type-mapping'),absentPage=await absent.request('/v1/assortment/typed-articles?merchant=ALDI');check(()=>{assert.equal(absentMap.status,200);assert.equal(absentPage.status,503);assert.equal(absentPage.body.error,'database-unavailable');assert.equal(absent.reads.length,0);});await absent.close();
 const broken=fixture({failRead:true}),error=await broken.request('/v1/assortment/typed-articles?merchant=ALDI');check(()=>{assert.equal(error.status,500);assert.equal(error.body.error,'grocery-article-type-search-failed');assert.equal(broken.reads.length,1);assert(!JSON.stringify(error).includes('original reader failed'));});await broken.close();
 console.log('server-grocery-article-types: '+groups+' actual HTTP/service boundary groups passed; no socket/database/retailer calls');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
