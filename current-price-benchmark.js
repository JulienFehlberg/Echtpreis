"use strict";
const Coverage=require("./current-price-coverage");
const DEFAULT_PRODUCTS=["Hackfleisch","Milch","Eier","Butter","Bananen","Nutella","Coca-Cola","Kaffee","Toilettenpapier","Olivenöl","Hähnchenbrust","Gurke","Tomaten","Kartoffeln","Reis"];
const DEFAULT_MERCHANTS=["EDEKA","REWE","ALDI Nord","Lidl","Kaufland","PENNY","Netto"];
function matrix(entries=[],products=DEFAULT_PRODUCTS,merchants=DEFAULT_MERCHANTS){
 const cells=[],missing=[];for(const product of products)for(const merchant of merchants){const x=entries.find(e=>e.product===product&&e.merchant===merchant);const cell=x||{product,merchant,state:"unknown",price:null};cells.push(cell);if(!(cell.price>0))missing.push({product,merchant})}
 const known=cells.filter(x=>x.price>0),verified=known.filter(x=>x.state==="verified");return{products:products.length,merchants:merchants.length,totalCells:cells.length,knownCells:known.length,verifiedCells:verified.length,currentCoverage:cells.length?known.length/cells.length:0,verifiedCoverage:cells.length?verified.length/cells.length:0,missing,cells};
}
function productSummary(m){return[...new Set(m.cells.map(x=>x.product))].map(product=>{const rows=m.cells.filter(x=>x.product===product),s=Coverage.summarize(rows);return{product,...s}})}
function merchantSummary(m){return[...new Set(m.cells.map(x=>x.merchant))].map(merchant=>{const rows=m.cells.filter(x=>x.merchant===merchant),known=rows.filter(x=>x.price>0);return{merchant,total:rows.length,known:known.length,coverage:rows.length?known.length/rows.length:0}})}
module.exports={DEFAULT_PRODUCTS,DEFAULT_MERCHANTS,matrix,productSummary,merchantSummary};
