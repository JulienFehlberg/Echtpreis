"use strict";
const Sources=require("./price-sources"),Refresh=require("./price-source-refresh"),State=require("./source-refresh-state"),Wake=require("./price-refresh-wake-plan");
const diagnosticHandler=()=>{};
function eligibility(name,source,state,now,options={}){
 const handlers=options?.handlers,known=handlers!==undefined,configured=known&&handlers&&typeof handlers==="object"?typeof((Object.hasOwn(handlers,name)?handlers[name]:null)||handlers[source.type])==="function":known?false:null;
 const result=Wake.inspect({[name]:state},{[name]:diagnosticHandler},{now,nextFallbackAt:now,owner:"source-status-diagnostic",registry:{[name]:source}}),candidate=result.candidates[0],invalid=result.blocked[0]?.reason;
 const blockedBy=[];
 if(!source.active)blockedBy.push("inactive");
 if(configured===false)blockedBy.push("no-handler");
 if(invalid)blockedBy.push(invalid);
 if(candidate){if(candidate.sourceDueAt>now)blockedBy.push("source-deadline");if(candidate.backoffUntil>now)blockedBy.push("failure-backoff");if(candidate.leaseUntil>now)blockedBy.push("lease-held");}
 const eligible=!!candidate&&blockedBy.length===0;
 return{basis:"persisted-runner-state",handlerConfigured:configured,status:invalid?"invalid-state":!source.active?"inactive":configured===false?"no-handler":eligible?"eligible-by-schedule":"waiting",
  eligibleBySchedule:eligible,eligibleAt:candidate?new Date(candidate.eligibleAt).toISOString():null,sourceDueAt:candidate?new Date(candidate.sourceDueAt).toISOString():null,
  failureBackoffUntil:candidate?.backoffUntil?new Date(candidate.backoffUntil).toISOString():null,leaseBlocksUntil:candidate?.leaseUntil?new Date(candidate.leaseUntil).toISOString():null,
  blockedBy,nativeHandlerReadinessVerified:false,exactStartTimeVerified:false};
}
function view(states={},now=Date.now(),options={}){return Object.entries(Sources.SOURCES).map(([name,source])=>{const s=states[name]||{},f=Refresh.freshness(source,s.lastSuccessAt,now);return{name,type:source.type,active:!!source.active,allowed:Sources.canImport(name),cadenceMs:Refresh.interval(source),lastAttemptAt:s.lastAttemptAt||null,lastSuccessAt:s.lastSuccessAt||null,nextAttemptAt:s.nextAttemptAt||null,schedulerEligibility:eligibility(name,source,s,now,options),freshness:f.state,freshnessBasis:"fetch-success",note:source.notes||null,ageMs:f.ageMs,failures:Number(s.consecutiveFailures||0),alert:State.shouldAlert(s),lastReceived:Number(s.lastReceived||0),lastAccepted:Number(s.lastAccepted||0),lastDurationMs:Number(s.lastDurationMs||0),leased:!!(s.leaseUntil&&new Date(s.leaseUntil).getTime()>now),leaseUntil:s.leaseUntil||null}}).sort((a,b)=>Number(b.alert)-Number(a.alert)||Number(a.active)-Number(b.active)||String(a.name).localeCompare(String(b.name)))}
module.exports={view,eligibility};
