"use strict";
// Synthetic transport/transaction fixture, never a public price observation.
const crypto=require("node:crypto");
const url="https://www.aldi-nord.de/sortiment/milchprodukte/milch-milchgetraenke.html",categoryId="milch-milchgetraenke",index="an_prd_de_de_products2";
function item(overrides={}){return{objectID:"1040001",productSlug:"synthetic-test-milk-1040001",name:"UNIT TEST Milk",brandName:"UNIT TEST",shortDescription:"Haltbare Vollmilch 3,5 %",salesUnit:"1-Liter-Packung",categoryIDs:[categoryId],isAvailable:true,isRecall:false,isComingSoon:false,isDepositProduct:false,depositValue:0,currentPrice:{priceValue:1.09,validFrom:Date.UTC(2020,0,1)/1000,validUntil:Date.UTC(2030,0,1)/1000},...overrides};}
function html(items=[item()],options={}){
 const filter="categoryIDs:"+categoryId,hitsPerPage=1000,params=new URLSearchParams({filters:filter,hitsPerPage:String(hitsPerPage)}).toString(),navigation=options.navigation??[{Produkte:{children:[{path:url},{path:"https://www.aldi-nord.de/sortiment/vorraete.html"}]}}];
 const result={index,query:"",params,page:0,hitsPerPage,nbHits:items.length,nbPages:items.length?1:0,hits:items,exhaustiveNbHits:true,exhaustive:{nbHits:true}};
 const entry={state:{index,filters:filter,hitsPerPage},requestParams:[{filters:filter,hitsPerPage}],results:[result]};
 const pageProps={locale:"de",page:{"@path":"/germany/sortiment/milchprodukte/"+categoryId,categoryKey:categoryId,header:[{sideDrawerNavigation:navigation}]},algoliaState:{initialResults:{[index]:entry}}};
 const native={page:"/product-overview/[...categories]",query:{categories:["milchprodukte",categoryId]},props:{pageProps}};
 return'<html><head><link rel="canonical" href="'+url+'"></head><body><script id="__NEXT_DATA__" type="application/json">'+JSON.stringify(native)+'</script></body></html>';
}
function original(body,time){return{body,meta:{sourceResponseUrl:url,sourceResponseHash:crypto.createHash("sha256").update(body).digest("hex"),sourceResponseDate:new Date(time).toISOString(),sourceAgeSeconds:0,capturedAt:new Date(time).toISOString(),scopeCountry:"DE"}};}
module.exports={url,categoryId,index,item,html,original};
