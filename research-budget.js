"use strict";
const Econ=require("./source-economics"),Info=require("./information-gain");
function rank(sources=[],states={},context={}){return sources.map(name=>{const e=Econ.profile(name,states[name]||{}),gain=Info.score({...context,...e});return{...e,informationGain:gain}}).sort((a,b)=>b.informationGain-a.informationGain||a.requestCost-b.requestCost)}
function allocate(sources=[],states={},total=100,context={}){const ranked=rank(sources,states,context),weights=ranked.map(x=>Math.max(.1,x.informationGain)),sum=weights.reduce((a,b)=>a+b,0)||1;let used=0;return ranked.map((x,i)=>{const budget=i===ranked.length-1?Math.max(0,total-used):Math.max(1,Math.floor(total*weights[i]/sum));used+=budget;return{...x,budget}})}
module.exports={rank,allocate};
