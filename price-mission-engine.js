"use strict";
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function need(x={}){
 const searches=Math.max(0,Number(x.searches||0)),unknown=!!x.unknown,conflict=!!x.conflict,age=Math.max(0,Number(x.ageDays||0)),coverage=Math.max(0,Math.min(1,Number(x.coverageGap??(unknown?1:.4))));
 const demand=Math.min(1,Math.log1p(searches)/Math.log(21));
 const score=(unknown?35:0)+(conflict?25:0)+Math.min(20,age*1.2)+demand*15+coverage*5;
 return Math.round(clamp(score,0,100));
}
function rewardPoints(score){if(score>=90)return 100;if(score>=80)return 70;if(score>=65)return 45;if(score>=50)return 25;if(score>=35)return 10;return 0}
function reason(x={}){if(x.conflict)return"Preis widersprüchlich";if(x.unknown)return"Preis fehlt";if(Number(x.ageDays)>7)return"Preis veraltet";return"Preis bestätigen"}
function mission(x={}){const score=need(x),points=rewardPoints(score);return{...x,missionValue:score,rewardPoints:points,reason:reason(x),eligible:points>0&&!!x.productId&&!!x.storeId,requiresPhoto:true,requiresProductAndShelfLabel:true}}
module.exports={need,rewardPoints,reason,mission};
