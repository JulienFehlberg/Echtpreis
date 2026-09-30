"use strict";
function delayMs(state={},baseMs=60000,maxMs=6*60*60*1000){const n=Math.max(0,Number(state.consecutiveFailures||0));if(!n)return 0;return Math.min(maxMs,Math.max(baseMs,baseMs*2**Math.min(12,n-1)))}
function eligible(state={},now=Date.now(),baseMs,maxMs){if(!state.lastAttemptAt)return true;const d=delayMs(state,baseMs,maxMs);return now-new Date(state.lastAttemptAt).getTime()>=d}
module.exports={delayMs,eligible};
