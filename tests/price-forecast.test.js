const assert=require("assert"),F=require("../price-forecast");
const stable=[];for(let i=1;i<=25;i++)stable.push({price:2.99+(i%5===0?.02:0),date:"2026-09-"+String(i).padStart(2,"0"),priceType:"regular",storeId:"s1"});
let x=F.forecast(stable,{targetDate:"2026-09-26",storeId:"s1"});assert(x.price>2.9&&x.price<3.1);assert(x.confidence>70);assert(x.max>x.min);
const volatile=[];for(let i=1;i<=20;i++)volatile.push({price:i%2?4.99:2.99,date:"2026-09-"+String(i).padStart(2,"0"),priceType:"regular",storeId:"s1"});
let v=F.forecast(volatile,{targetDate:"2026-09-21",storeId:"s1"});assert(v.uncertainty>x.uncertainty);assert(v.confidence<x.confidence);
const promos=[{price:3.99,date:"2026-07-01",priceType:"promotion"},{price:2.99,date:"2026-07-29",priceType:"promotion"},{price:2.89,date:"2026-08-26",priceType:"promotion"}];let p=F.promotionPattern(promos,"2026-09-23");assert(p.cycleDays>=27&&p.cycleDays<=29);assert(p.probability>.7);
console.log("price-forecast: ok");