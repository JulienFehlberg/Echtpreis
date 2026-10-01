"use strict";
function nextAttempt(value,now){const t=typeof value==="string"||value instanceof Date?new Date(value).getTime():NaN;return Number.isFinite(t)&&t>new Date(now).getTime()?new Date(t).toISOString():null}
function success(prev={},meta={},now=new Date().toISOString()){return{...prev,lastAttemptAt:now,lastSuccessAt:now,lastError:null,consecutiveFailures:0,lastReceived:Number(meta.received||0),lastAccepted:Number(meta.accepted||0),lastDurationMs:Number(meta.durationMs||0),nextAttemptAt:nextAttempt(meta.nextAttemptAt,now)}}
function failure(prev={},error,now=new Date().toISOString()){return{...prev,lastAttemptAt:now,lastError:String(error&&error.message||error||"refresh-failed").slice(0,300),consecutiveFailures:Number(prev.consecutiveFailures||0)+1,nextAttemptAt:nextAttempt(error?.nextAttemptAt,now)}}
function shouldAlert(state={},threshold=3){return Number(state.consecutiveFailures||0)>=threshold}
module.exports={success,failure,shouldAlert,nextAttempt};
