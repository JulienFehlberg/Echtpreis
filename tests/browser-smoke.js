const fs=require("fs"),assert=require("assert");
const {JSDOM,VirtualConsole}=require("jsdom");
(async()=>{
 const html=fs.readFileSync("index.html","utf8"),errors=[],vc=new VirtualConsole();
 vc.on("jsdomError",e=>errors.push(String(e.message||e)));
 const dom=new JSDOM(html,{runScripts:"dangerously",url:"https://julienfehlberg.github.io/Echtpreis/",pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){
  w.fetch=async()=>({ok:false,status:503,json:async()=>({})});w.alert=()=>{};w.confirm=()=>true;w.prompt=()=>null;w.scrollTo=()=>{};
  if(w.HTMLElement)w.HTMLElement.prototype.scrollIntoView=function(){};
 }});
 await new Promise(r=>setTimeout(r,120));
 const w=dom.window,d=w.document;
 assert.strictEqual(errors.length,0,"browser startup errors: "+errors.join(" | "));
 assert.strictEqual(typeof w.parseWish,"function");
 let p=w.parseWish("0,5 kg Tomaten");assert.strictEqual(p.key,"tomaten");assert.strictEqual(p.amount,0.5);assert.strictEqual(p.unit,"kg");
 p=w.parseWish("2 l Coca Cola");assert.strictEqual(p.key,"cola");assert.strictEqual(p.matchMode,"exact");
 assert.strictEqual(w.identifyReceiptProduct("Red Bull 0,25").key,"energydrink");
 const rb=w.inferPackFromName("Red Bull 0,25");assert.strictEqual(rb.packAmount,0.25);assert.strictEqual(rb.packUnit,"l");
 const receipt=w.parseReceiptText("G&G Mini-Hörnchen 1,49\nOetker Ristorante 3,49\nRed Bull 0,25 1,49 x 2 2,98\nPfand 0,25 x 2 0,50\nSUMME 8,46");
 await w.addEchtpreisBarcode("Testprodukt","250 g","12345678");assert.strictEqual(d.querySelectorAll("#list .item").length,1,"barcode product should enter the primary basket");w.replaceEchtpreisList([]);
 assert(receipt.length>=4,"receipt parser lost rows");
 assert(receipt.some(x=>x.isDeposit),"deposit line not recognized");
 w.localStorage.removeItem("echtpreis_open_purchase");d.getElementById("compareBtn").click();assert.strictEqual(w.localStorage.getItem("echtpreis_open_purchase"),null,"failed comparison must not open a purchase");
 d.getElementById("demoListBtn").click();assert.strictEqual(d.querySelectorAll("#list .item").length,2,"demo list must use primary basket only");
 d.getElementById("productInput").value="0,5 kg Tomaten";d.getElementById("addBtn").click();assert.strictEqual(d.querySelectorAll("#list .item").length,3,"add button should add exactly one item");
 d.getElementById("compareBtn").click();assert.notStrictEqual(d.getElementById("results").style.display,"none","compare should render results");
 console.log("browser smoke OK · single basket · quantity parser · receipt parser");
 dom.window.close();
})().catch(e=>{console.error(e);process.exit(1)});
