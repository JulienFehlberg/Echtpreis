"use strict";
const crypto=require("node:crypto"),Contract=require("./aldi-deposit-render-contract.json");
const hash=value=>crypto.createHash("sha256").update(value).digest("hex"),MANIFEST_HASH=hash(JSON.stringify(Contract)),CONTRACT_ID=Contract.contractId,BUILD_ID=Contract.buildId;
const fields=["version","contractId","buildId","rendererManifestHash","depositPriceBasis","depositAmountBasis","depositLabel","retailerSku","sourceUrl","sourceResponseHash","capturedAt","pack","priceCents","depositCents"];
const cents=value=>typeof value==="number"&&Number.isFinite(value)&&value>0&&value<=10000&&Math.abs(value*100-Math.round(value*100))<1e-6?Math.round(value*100):null;
const plain=value=>!!value&&typeof value==="object"&&!Array.isArray(value);
function signed(proof){return Object.fromEntries(fields.map(key=>[key,proof[key]]));}
function validateProof(offer){
 const p=offer?.depositBasisProof;
 if(!plain(p)||Object.keys(p).length!==fields.length+1||Object.keys(p).some(key=>!fields.includes(key)&&key!=="proofHash"))return false;
 if(p.version!==1||p.contractId!==CONTRACT_ID||p.buildId!==BUILD_ID||p.rendererManifestHash!==MANIFEST_HASH||p.depositPriceBasis!=="excluded"||p.depositAmountBasis!=="sales-pack-total"||p.depositLabel!=="zzgl. Pfand")return false;
 if(!/^[1-9]\d{0,14}$/.test(p.retailerSku)||p.retailerSku!==offer.retailerSku||p.sourceUrl!==offer.sourceUrl||!new RegExp('^https://www[.]aldi-nord[.]de/produkt/[a-z0-9-]+-'+p.retailerSku+'[.]html$').test(p.sourceUrl)||p.sourceResponseHash!==offer.sourceResponseHash||!/^[a-f0-9]{64}$/.test(p.sourceResponseHash)||p.capturedAt!==offer.capturedAt||typeof p.capturedAt!=="string"||!Number.isFinite(Date.parse(p.capturedAt))||new Date(p.capturedAt).toISOString()!==p.capturedAt||p.pack!==offer.pack)return false;
 if(offer.depositIncluded!==false||p.priceCents!==cents(offer.price)||p.depositCents!==cents(offer.deposit)||!Number.isSafeInteger(p.priceCents)||!Number.isSafeInteger(p.depositCents)||p.proofHash!==hash(JSON.stringify(signed(p))))return false;
 return true;
}
function proofForProduct(raw,meta){
 // This attestation is specific to the reviewed immutable PDP build. A generic
 // localization key or deposit flag on another page is never enough.
 if(!plain(raw)||typeof meta?.raw!=="string"||hash(meta.raw)!==meta.sourceResponseHash||raw.isDepositProduct!==true||cents(raw.depositValue)===null||cents(raw.currentPrice?.priceValue)===null)return null;
 const blocks=[...meta.raw.matchAll(/<script\b(?=[^>]*\bid\s*=\s*["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)];
 if(blocks.length!==1)return null;
 let outer;try{outer=JSON.parse(blocks[0][1]);}catch{return null;}
 const pageProps=outer?.props?.pageProps,page=pageProps?.page;
 if(outer.buildId!==BUILD_ID||outer.page!=="/product-detail/[product]"||outer.locale!=="de"||outer.isFallback!==false||pageProps?.hasError===true||pageProps?.locale!=="de"||page?.["mgnl:template"]!=="aldi-nord-foundation:pages/productDetailPage"||page?.i18nMap?.["/products/info/deposit"]!=="zzgl. Pfand"||outer.query?.product!==raw.productSlug)return null;
 const scriptPaths=[...meta.raw.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(m=>m[1]);
 const entry=Contract.modules.find(m=>m.file==="module-2.js"),wrapper=Contract.modules.find(m=>m.file==="module-1.js"),webpack=Contract.modules.find(m=>m.file==="webpack-module.js");
 if([entry,wrapper,webpack].some(m=>!m||scriptPaths.filter(p=>p===new URL(m.sourceUrl).pathname).length!==1)||["_buildManifest.js","_ssgManifest.js"].some(file=>scriptPaths.filter(p=>p==="/_next/static/"+BUILD_ID+"/"+file).length!==1))return null;
 let entries;try{entries=typeof pageProps.apiData==="string"?JSON.parse(pageProps.apiData):pageProps.apiData;}catch{return null;}
 if(!Array.isArray(entries))return null;
 const details=entries.filter(e=>Array.isArray(e)&&e[0]==="PRODUCT_DETAIL_GET"),detail=details[0]?.[1];
 if(details.length!==1||!Array.isArray(detail?.req?.productIds)||detail.req.productIds.length!==1||String(detail.req.productIds[0])!==String(raw.objectID)||!Array.isArray(detail.res?.products)||detail.res.products.length!==1||JSON.stringify(detail.res.products[0])!==JSON.stringify(raw))return null;
 const p={version:1,contractId:CONTRACT_ID,buildId:BUILD_ID,rendererManifestHash:MANIFEST_HASH,depositPriceBasis:"excluded",depositAmountBasis:"sales-pack-total",depositLabel:"zzgl. Pfand",retailerSku:String(raw.objectID),sourceUrl:meta.sourceUrl,sourceResponseHash:meta.sourceResponseHash,capturedAt:meta.capturedAt,pack:raw.salesUnit,priceCents:cents(raw.currentPrice.priceValue),depositCents:cents(raw.depositValue)};
 p.proofHash=hash(JSON.stringify(p));
 return validateProof({...p,price:raw.currentPrice.priceValue,deposit:raw.depositValue,depositIncluded:false,depositBasisProof:p})?p:null;
}
module.exports={proofForProduct,validateProof,MANIFEST_HASH,CONTRACT_ID,BUILD_ID};
