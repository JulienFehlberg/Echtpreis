"use strict";
function success(prev={},meta={},now=new Date().toISOString()){return{...prev,lastAttemptAt:now,lastSuccessAt:now,lastError:null,consecutiveFailures:0,lastReceived:Number(meta.received||0),lastAccepted:Number(meta.accepted||0),lastDurationMs:Number(meta.durationMs||0)}}
function failure(prev={},error,now=new Date().toISOString()){return{...prev,lastAttemptAt:now,lastError:String(error&&error.message||error||"refresh-failed").slice(0,300),consecutiveFailures:Number(prev.consecutiveFailures||0)+1}}
function shouldAlert(state={},threshold=3){return Number(state.consecutiveFailures||0)>=threshold}
module.exports={success,failure,shouldAlert};
