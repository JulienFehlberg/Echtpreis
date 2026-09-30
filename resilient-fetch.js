"use strict";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function retryable(status){return status===408||status===425||status===429||status>=500}
function retryAfter(res){const h=res?.headers?.get?.("retry-after");if(!h)return null;const n=Number(h);if(Number.isFinite(n))return Math.max(0,n*1000);const t=Date.parse(h);return Number.isFinite(t)?Math.max(0,t-Date.now()):null}
async function request(url,opts={},cfg={}){
 const fetchImpl=cfg.fetchImpl||fetch,retries=Math.max(0,Math.min(5,Number(cfg.retries??2))),timeoutMs=Math.max(1000,Number(cfg.timeoutMs)||12000),baseMs=Math.max(50,Number(cfg.baseDelayMs)||400),maxMs=Math.max(baseMs,Number(cfg.maxDelayMs)||10000);
 let last;for(let attempt=0;attempt<=retries;attempt++){const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeoutMs);try{const res=await fetchImpl(url,{...opts,signal:ac.signal});clearTimeout(timer);if(res.ok||!retryable(res.status)||attempt===retries)return res;last=new Error("http-"+res.status);const ra=retryAfter(res),delay=Math.min(maxMs,ra??baseMs*2**attempt)+Math.floor(Math.random()*Math.min(250,baseMs));await sleep(delay)}catch(e){clearTimeout(timer);last=e;if(attempt===retries)throw e;const delay=Math.min(maxMs,baseMs*2**attempt)+Math.floor(Math.random()*Math.min(250,baseMs));await sleep(delay)}}throw last||new Error("fetch-failed")
}
module.exports={sleep,retryable,retryAfter,request};
