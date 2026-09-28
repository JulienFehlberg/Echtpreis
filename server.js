const http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const PORT=process.env.PORT||10000,DB_FILE=process.env.ECHTPREIS_DB_FILE||path.join("/tmp","echtpreis-db.json");
function load(){try{return JSON.parse(fs.readFileSync(DB_FILE,"utf8"))}catch(e){return{observations:[],aliases:[]}}}
function save(db){try{fs.writeFileSync(DB_FILE,JSON.stringify(db))}catch(e){}}
function send(res,status,obj){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"https://julienfehlberg.github.io","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST,GET,OPTIONS","Cache-Control":"no-store"});res.end(JSON.stringify(obj))}
function body(req,cb){let raw="";req.on("data",c=>{raw+=c;if(raw.length>1e6)req.destroy()});req.on("end",()=>{try{cb(null,JSON.parse(raw||"{}"))}catch(e){cb(e)}})}
function clean(x){return String(x||"").trim().slice(0,120)}
function validObs(x){return x&&["Lidl","Kaufland","REWE","EDEKA"].includes(x.store)&&/^[a-z0-9 äöüß-]{2,60}$/i.test(x.key||"")&&Number.isFinite(+x.price)&&+x.price>0&&+x.price<10000&&["kg","l","piece"].includes(x.per)&&/^20\d\d-\d\d-\d\d$/.test(x.date||"")&&clean(x.proof)}
const server=http.createServer((req,res)=>{
 if(req.method==="OPTIONS")return send(res,204,{});
 if(req.method==="GET"&&req.url==="/health"){let db=load();return send(res,200,{ok:true,service:"ECHTPREIS Data API",version:"3.3",observations:db.observations.length,aliases:db.aliases.length,storage:DB_FILE.startsWith("/tmp")?"ephemeral":"persistent"})}
 if(req.method==="GET"&&req.url.startsWith("/v1/observations")){let db=load(),u=new URL(req.url,"http://x"),since=u.searchParams.get("since"),rows=db.observations.filter(x=>!since||x.date>=since).slice(-5000);return send(res,200,{version:"3.3",items:rows})}
 if(req.method==="GET"&&req.url.startsWith("/v1/aliases")){let db=load();return send(res,200,{version:"3.3",items:db.aliases.slice(-5000)})}
 if(req.method==="POST"&&req.url==="/v1/receipt-observations")return body(req,(err,b)=>{
  if(err||!b||!Array.isArray(b.items)||!clean(b.proof))return send(res,400,{error:"Ungültige Anfrage"});
  let db=load(),accepted=0,rejected=0,proof=clean(b.proof);
  for(const raw of b.items.slice(0,100)){let x={id:crypto.randomUUID(),key:clean(raw.key).toLowerCase(),store:clean(raw.store),price:+raw.price,per:clean(raw.per),date:clean(raw.date),region:clean(raw.region),kind:"community",source:"ECHTPREIS Bon",product:clean(raw.product),proof,trust:60,status:"observed",createdAt:new Date().toISOString()};if(!validObs(x)){rejected++;continue}let dupe=db.observations.some(o=>o.proof===x.proof&&o.key===x.key&&o.store===x.store&&o.price===x.price);if(dupe){rejected++;continue}db.observations.push(x);accepted++;
   if(raw.rawName){let n=clean(raw.rawName).toLowerCase(),a=db.aliases.find(a=>a.normalized===n&&a.key===x.key);if(a){a.seen++;a.lastSeen=x.createdAt}else db.aliases.push({normalized:n,raw:clean(raw.rawName),key:x.key,seen:1,lastSeen:x.createdAt})}
  }
  db.observations=db.observations.slice(-50000);db.aliases=db.aliases.slice(-10000);save(db);return send(res,200,{ok:true,accepted,rejected})
 });
 return send(res,404,{error:"Not found"});
});
server.listen(PORT,()=>console.log("ECHTPREIS Data API 3.3 on "+PORT));