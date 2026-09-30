"use strict";
const {Readable,Transform}=require("stream"),{pipeline}=require("stream/promises"),{createGunzip}=require("zlib"),{StringDecoder}=require("string_decoder");
const Catalog=require("./canonical-product-catalog-import");
const SOURCE_URL="https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz";
const REQUIRED=["code","product_name","quantity","countries_tags"];
const HEADERS={"User-Agent":"SPARKORB/1.0 (https://github.com/JulienFehlberg/Sparkorb) Germany product catalog","Accept":"application/gzip"};
function bounded(value,fallback,min,max){const n=Number(value);return Number.isSafeInteger(n)?Math.max(min,Math.min(max,n)):fallback}
function tags(value){return String(value||"").split(",").map(s=>s.trim()).filter(Boolean)}
class TsvParser{
 constructor(onRow,{maxRowChars=2*1024*1024}={}){this.onRow=onRow;this.maxRowChars=maxRowChars;this.field="";this.row=[];this.quoted=false;this.afterQuote=false;this.skipLf=false;this.rowChars=0;this.stopped=false;this.malformed=false;}
 fieldEnd(){this.row.push(this.field);this.field="";this.afterQuote=false;}
 rowEnd(){this.fieldEnd();const row=this.row,malformed=this.malformed;this.row=[];this.rowChars=0;this.malformed=false;if(this.onRow(row,{malformed})===false)this.stopped=true;}
 feed(text){for(const ch of text){if(this.stopped)break;if(this.skipLf){this.skipLf=false;if(ch==="\n")continue}if(++this.rowChars>this.maxRowChars)throw new Error("off-catalog-row-too-large");if(this.quoted){if(ch==='"'){this.quoted=false;this.afterQuote=true}else this.field+=ch;continue}if(this.afterQuote){if(ch==='"'){this.field+='"';this.quoted=true;this.afterQuote=false;continue}if(ch===" ")continue;if(ch!=="\t"&&ch!=="\n"&&ch!=="\r"){this.malformed=true;this.afterQuote=false}}if(ch==="\t")this.fieldEnd();else if(ch==="\n"||ch==="\r"){this.rowEnd();if(ch==="\r")this.skipLf=true}else if(ch==='"'&&!this.field.length){this.quoted=true;this.afterQuote=false}else this.field+=ch;}}
 finish(){if(this.stopped)return;if(this.quoted)throw new Error("off-catalog-incomplete-csv");if(this.field.length||this.row.length||this.afterQuote)this.rowEnd();}
}
function options(input={}){
 if(input.sourceUrl!=null&&input.sourceUrl!==SOURCE_URL)throw new Error("off-catalog-source-not-allowed");
 const cursor=input.cursor||null;if(cursor&&(!Number.isSafeInteger(cursor.rowsRead)||cursor.rowsRead<0||cursor.sourceUrl!==SOURCE_URL))throw new Error("off-catalog-invalid-cursor");
 return{limit:bounded(input.limit,15000,1,30000),maxBytes:bounded(input.maxBytes,150*1024*1024,1,1536*1024*1024),maxDurationMs:bounded(input.maxDurationMs,180000,1000,900000),cursor};
}
function rowProduct(values,index){const get=name=>index.has(name)?values[index.get(name)]||"":"";return{code:get("code"),product_name:get("product_name"),brands:get("brands"),quantity:get("quantity"),countries_tags:tags(get("countries_tags")),categories_tags:tags(get("categories_tags")),popularity_tags:tags(get("popularity_tags")),unique_scans_n:Number(get("unique_scans_n"))||0,last_modified_t:Number(get("last_modified_t"))||null};}
async function fetchCatalog(input={},fetchImpl=fetch){
 const cfg=options(input),started=Date.now(),controller=new AbortController(),products=[],seen=new Set(),rejected={};let header=null,index=null,rowsRead=0,bytesRead=0,sourceETag=null,sourceDate=null,stopReason=null,sourceEnded=false,error=null,source,counter,inflater,completion,lastProgress=started,lastCode=null;
 const reject=reason=>{rejected[reason]=(rejected[reason]||0)+1;};
 const progress=force=>{if(typeof input.onProgress!=="function"||!force&&Date.now()-lastProgress<30000)return;lastProgress=Date.now();try{input.onProgress({rowsRead,bytesRead,products:products.length,lastCode,durationMs:Date.now()-started})}catch{}};
 const timer=setTimeout(()=>{stopReason="duration-budget";controller.abort();source?.destroy(new Error("off-catalog-duration-budget"))},cfg.maxDurationMs);
 const parser=new TsvParser((values,meta)=>{
  if(!header){header=values.map((s,i)=>i===0?s.replace(/^\uFEFF/,""):s);index=new Map(header.map((s,i)=>[s,i]));if(meta.malformed||REQUIRED.some(s=>!index.has(s)))throw new Error("off-catalog-required-columns-missing");return true}
  if(values.length===1&&!values[0])return true;rowsRead++;lastCode=values[index.get("code")]||null;progress(false);if(cfg.cursor&&rowsRead<=cfg.cursor.rowsRead)return true;if(meta.malformed){reject("malformed-csv-row");return true}if(values.length!==header.length){reject("invalid-column-count");return true}
  const product=rowProduct(values,index);if(!product.countries_tags.includes("en:germany")){reject("outside-germany-market");return true}
  const candidate=Catalog.productCandidate(product);if(!candidate.ok){candidate.reasons.forEach(reject);return true}if(seen.has(candidate.gtin)){reject("duplicate-gtin");return true}seen.add(candidate.gtin);products.push(product);
  if(typeof input.stopWhen==="function"&&input.stopWhen(product)===true){stopReason="selection-goal";return false}if(products.length>=cfg.limit){stopReason="product-limit";return false}return true;
 });
 try{
  const response=await fetchImpl(SOURCE_URL,{headers:HEADERS,signal:controller.signal});if(!response.ok)throw new Error("off-catalog-http-"+response.status);if(!response.body)throw new Error("off-catalog-stream-required");
  sourceETag=response.headers?.get?.("etag")||null;sourceDate=response.headers?.get?.("last-modified")||null;
  if(cfg.cursor&&(cfg.cursor.sourceETag&&cfg.cursor.sourceETag!==sourceETag||cfg.cursor.sourceDate&&cfg.cursor.sourceDate!==sourceDate))throw new Error("off-catalog-export-changed");
  source=typeof response.body.getReader==="function"?Readable.fromWeb(response.body):Readable.from(response.body);
  counter=new Transform({transform(chunk,encoding,callback){bytesRead+=chunk.length;if(bytesRead>cfg.maxBytes){stopReason="byte-budget";callback(new Error("off-catalog-byte-budget"));return}callback(null,chunk)}});inflater=createGunzip();
  // All pipeline rejections are consumed here; the async iterator reports the
  // same failure and a deliberate limit stop returns its validated subset.
  completion=pipeline(source,counter,inflater).catch(e=>{if(!stopReason&&!error)error=e;inflater.destroy(e)});
  const decoder=new StringDecoder("utf8");for await(const chunk of inflater){parser.feed(decoder.write(chunk));if(parser.stopped)break}
  if(!stopReason){parser.feed(decoder.end());parser.finish();sourceEnded=true;if(!header)throw new Error("off-catalog-empty-export")}
 }catch(e){if(!stopReason)error=e}
 finally{clearTimeout(timer);controller.abort();source?.destroy();counter?.destroy();inflater?.destroy();if(completion)await completion}
 const sourceExhausted=sourceEnded&&!error,complete=!error&&(sourceExhausted||stopReason==="product-limit"||stopReason==="selection-goal"),reason=error?"source-failed":stopReason||"source-end",cursor=sourceExhausted?null:{sourceUrl:SOURCE_URL,sourceETag,sourceDate,rowsRead};
 const result={ok:!error,products,received:products.length,country:"DE",purpose:"identity",truthEligible:false,sourceUrl:SOURCE_URL,sourceETag,sourceDate,fetchedAt:new Date().toISOString(),rowsRead,bytesRead,durationMs:Date.now()-started,complete,sourceExhausted,reason,cursor,rejected,error:error?String(error.message||error):null};progress(true);
 if(error&&!products.length){error.result=result;throw error}return result;
}
module.exports={SOURCE_URL,HEADERS,TsvParser,options,rowProduct,fetchCatalog,readCatalog:fetchCatalog};
