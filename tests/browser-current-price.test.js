const assert=require("assert"),fs=require("fs"),{JSDOM}=require("jsdom");
(async()=>{
 const dom=new JSDOM(fs.readFileSync("index.html","utf8"),{runScripts:"dangerously",url:"https://example.test/",pretendToBeVisual:true,beforeParse(w){
  w.eval(fs.readFileSync("app/price-engine.js","utf8"));
  w.eval(fs.readFileSync("wolt-sales-pack-validation.js","utf8"));
  w.eval(fs.readFileSync("app/current-price-client.js","utf8"));
  w.fetch=async()=>({ok:false,json:async()=>({})});w.alert=()=>{};w.confirm=()=>true;w.prompt=()=>null;w.scrollTo=()=>{};
  Object.defineProperty(w.navigator,"geolocation",{value:{getCurrentPosition:(_,fail)=>fail&&fail({code:1})}});
  w.HTMLElement.prototype.scrollIntoView=function(){};
 }});
 await new Promise(r=>setTimeout(r,120));
 try{
  const w=dom.window,today=w.eval("localDateKey()"),base={key:"milch",store:"EDEKA",price:1.09,per:"l",date:today,product:"Milch 1 L",kind:"official",source:"test",proof:"fresh",trust:96};
  const set=rows=>{w.localStorage.setItem("sparkorb_shared_observations_v1",JSON.stringify(rows));w.invalidateDataEngine();w.resetPriceLookupMemo();};
  set([base]);assert.strictEqual(w.trustedPrice("milch","EDEKA").price,1.09);
  set([{...base,priceType:"app"}]);assert.strictEqual(w.trustedPrice("milch","EDEKA"),null,"app price must survive normalization and require eligibility");
  set([{...base,truthEligible:false}]);assert.strictEqual(w.trustedPrice("milch","EDEKA"),null,"blocked sources cannot become current prices");
  set([{...base,date:"2020-01-01",validTo:"2099-12-31"}]);assert.strictEqual(w.trustedPrice("milch","EDEKA"),null,"long validity must not revive an old observation");
  set([{...base,priceType:"multi_buy",minQuantity:3}]);assert.strictEqual(w.trustedPrice("milch","EDEKA",{packCount:2}),null);
  assert.strictEqual(w.trustedPrice("milch","EDEKA",{packCount:3}).price,1.09);
  set([base,{...base,price:1.49,proof:"conflicting"}]);
  assert.strictEqual(w.trustedPrice("milch","EDEKA"),null,"a disputed current price must not appear as a proven checkout quote");
  set([base]);w.SparkorbPriceEngine.rankObservations=()=>null;
  assert.strictEqual(w.trustedPrice("milch","EDEKA"),null,"legacy fallback must not revive engine-rejected evidence");
  console.log("browser-current-price: normalization and current-price gates ok");
 }finally{dom.window.close();}
})().catch(e=>{console.error(e);process.exit(1)});
