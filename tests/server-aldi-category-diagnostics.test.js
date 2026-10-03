"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),{createRequire}=require("node:module"),{EventEmitter}=require("node:events");
function fixture({database=true,failRead=false}={}){
 const file=path.resolve(__dirname,"../server.js"),nativeRequire=createRequire(file),module={exports:{}},reads=[];
 const pool={query:async()=>assert.fail("No database call in actual HTTP route test"),end:async()=>{}};
 const mocks={pg:{Pool:function(){return pool;}},http:{createServer:()=>({listening:false,close:cb=>cb?.()})},"./aldi-category-rejected-capture-store":{status:async p=>{assert.equal(p,pool);reads.push(true);if(failRead)throw Error("PRIVATE BODY MUST NEVER LEAK");return{ok:true,retainedOnly:true,current:false,fresh:false,truthEligible:false,diagnostics:[],articleRowsCreated:0,priceRowsCreated:0};}}};
 const localRequire=name=>Object.hasOwn(mocks,name)?mocks[name]:nativeRequire(name);localRequire.main=null;
 vm.runInNewContext(fs.readFileSync(file,"utf8"),{require:localRequire,module,exports:module.exports,process:{env:database?{DATABASE_URL:"postgres://unit.test/no-connection"}:{},pid:999},console:{log(){},error(){}},Buffer,URL,Date,Promise,setTimeout,clearTimeout,setInterval,clearInterval},{filename:file});
 async function request(url,method="GET"){const req=new EventEmitter(),res=new EventEmitter();Object.assign(req,{method,url,headers:{}});res.setHeader=()=>{};res.writeHead=status=>{res.status=status;res.headersSent=true;};const done=new Promise(resolve=>res.end=text=>{res.writableEnded=true;res.emit("finish");resolve({status:res.status,body:JSON.parse(text)});});await module.exports.handle(req,res);return done;}
 return{request,reads,close:()=>module.exports.shutdown()};
}
(async()=>{let groups=0;const route="/v1/assortment/aldi-category-diagnostics",f=fixture();const result=await f.request(route);assert.equal(result.status,200);assert.equal(result.body.current,false);assert.equal(result.body.truthEligible,false);assert.equal(result.body.articleRowsCreated,0);assert.equal(f.reads.length,1);groups++;
 for(const suffix of["?","?refresh=true","?merchant=ALDI","?now=0","?__proto__=x"]){const result=await f.request(route+suffix);assert.equal(result.status,400);assert.equal(f.reads.length,1);groups++;}await f.close();
 const absent=fixture({database:false});assert.equal((await absent.request(route)).status,503);assert.equal(absent.reads.length,0);await absent.close();groups++;
 const broken=fixture({failRead:true}),error=await broken.request(route);assert.equal(error.status,500);assert.equal(error.body.error,"aldi-category-diagnostic-read-failed");assert(!JSON.stringify(error).includes("PRIVATE BODY"));await broken.close();groups++;
 console.log("server-aldi-category-diagnostics: "+groups+" exact read-only HTTP route/query/error groups passed; no socket/database/retailer calls");
})().catch(error=>{console.error(error);process.exitCode=1;});
