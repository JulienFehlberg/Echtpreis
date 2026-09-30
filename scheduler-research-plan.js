"use strict";
const Sources=require("./price-sources"),Budget=require("./research-budget");
function runnable(handlers={}){return Object.entries(Sources.SOURCES).filter(([name,s])=>s.active&&typeof (handlers[name]||handlers[s.type])==="function").map(([name])=>name)}
function plan(handlers={},states={},total=500,context={}){const names=runnable(handlers),rows=Budget.allocate(names,states,Math.max(names.length,Number(total)||500),context);return Object.fromEntries(rows.map(x=>[x.source,x]))}
module.exports={runnable,plan};
