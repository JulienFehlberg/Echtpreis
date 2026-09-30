"use strict";
const fs=require("fs"),path=require("path"),crypto=require("crypto"),{gunzipSync}=require("zlib");
const Import=require("./canonical-product-catalog-import"),Basket=require("./german-basket-priorities"),Client=require("./open-food-facts-catalog-client"),Builder=require("./scripts/build-german-catalog");
const ROOT=path.join(__dirname,"data");
function read(){
 const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,"de-product-catalog-manifest.json"),"utf8"));
 if(manifest.version!==1||manifest.country!=="DE"||manifest.purpose!=="identity"||manifest.truthEligible!==false||manifest.source?.url!==Client.SOURCE_URL||manifest.source?.license!=="ODbL-1.0")throw new Error("catalog-snapshot-invalid-provenance");
 const encoded=fs.readFileSync(path.join(ROOT,"de-product-catalog.json.gz.base64"),"utf8").trim();if(encoded.length>12*1024*1024||!/^[A-Za-z0-9+/=\s]+$/.test(encoded))throw new Error("catalog-snapshot-invalid-encoding");
 const zipped=Buffer.from(encoded,"base64"),hash=crypto.createHash("sha256").update(zipped).digest("hex");if(hash!==manifest.snapshot?.gzipSha256||zipped.length!==manifest.snapshot?.gzipBytes)throw new Error("catalog-snapshot-checksum-mismatch");
 const json=gunzipSync(zipped,{maxOutputLength:20*1024*1024});if(crypto.createHash("sha256").update(json).digest("hex")!==manifest.snapshot?.sha256||json.length!==manifest.snapshot?.jsonBytes)throw new Error("catalog-snapshot-content-mismatch");
 const decoded=JSON.parse(json.toString("utf8")),products=decoded.products;
 if(decoded.version!==1||decoded.country!=="DE"||decoded.purpose!=="identity"||decoded.truthEligible!==false||decoded.sourceUrl!==manifest.source.url||decoded.sourceETag!==manifest.source.etag||decoded.sourceDate!==manifest.source.lastModified)throw new Error("catalog-snapshot-invalid-provenance");
 if(!Array.isArray(products)||products.length<5000||products.length>10000||products.length!==manifest.snapshot.products)throw new Error("catalog-snapshot-invalid-size");
 const seen=new Set();for(const product of products){const candidate=Import.productCandidate(product);if(!candidate.ok||!Builder.usable(product)||!Basket.family(product)||seen.has(candidate.gtin))throw new Error("catalog-snapshot-invalid-product");seen.add(candidate.gtin)}
 const coverage=Basket.coverage(products);if(JSON.stringify(coverage.counts)!==JSON.stringify(manifest.coverage?.counts)||coverage.classified!==products.length)throw new Error("catalog-snapshot-family-count-mismatch");
 const scan=manifest.scans?.at(-1)||{};
 return{ok:true,products,sourceUrl:manifest.source.url,fetchedAt:manifest.generatedAt,sourceDate:manifest.source.lastModified,sourceETag:manifest.source.etag,rowsRead:scan.rowsRead,bytesRead:scan.bytesRead,complete:true,sourceExhausted:false,reason:"validated-snapshot",snapshot:{sha256:hash,products:products.length,sourceDate:manifest.source.lastModified,sourceETag:manifest.source.etag},manifest};
}
async function fetchCatalog(){return read()}
module.exports={read,fetchCatalog};
