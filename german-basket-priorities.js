"use strict";
const Identity=require("./product-identity");
// Taxonomy IDs are exact Open Food Facts categories; this module ranks identity metadata only.
const TAXONOMY_SOURCE="https://static.openfoodfacts.org/data/taxonomies/categories.full.json";
const definition=(id,label,priority,tags,name,exclude=null)=>Object.freeze({id,label,priority,tags:Object.freeze(tags.map(tag=>"en:"+tag)),name,exclude});
const FAMILIES=Object.freeze([
 definition("milk_fresh","Frischmilch",100,["fresh-milks"],/^(?:frischmilch|frische (?:vollmilch|milch)|esl milch)(?: |$)/,/(schokolade|schoko|kakao|riegel|keks|pudding|kaffee|vanille|vanilla|shake)/),
 definition("milk_uht","Haltbare Milch",100,["uht-milks"],/^(?:h milch|h vollmilch|haltbare (?:vollmilch|milch)|uht (?:milch|milk))(?: |$)/,/(schokolade|schoko|kakao|riegel|keks|pudding|kaffee|vanille|vanilla|shake)/),
 definition("milk","Milch",98,["milks","cow-milks","whole-milks","semi-skimmed-milks","skimmed-milks"],/^(?:vollmilch|fettarme milch|milch|milk)(?: |$)/,/(schokolade|schoko|kakao|riegel|keks|pudding|kaffee|vanille|vanilla|shake)/),
 definition("butter","Butter",99,["butters"],/^(?:(?:deutsche|deutscher|milde) )*(?:butter|markenbutter)(?: |$)/,/(keks|cookie|toast|croissant|peanut|erdnuss|chicken)/),
 definition("eggs","Eier",99,["eggs"],/^(?:\d+ )?(?:(?:freiland|bodenhaltung|frische) )*(?:eier|eggs)(?: |$)/,/(schokolade|chocolate|osterei|oster eier|easter)/),
 definition("rolls","Brötchen",96,["bread-rolls"],/^(?:brotchen|vollkornbrotchen|weizenbrotchen|broetchen|semmeln|schrippen)(?: |$)/),
 definition("bread","Brot",98,["breads"],/^(?:brot|vollkornbrot|mischbrot|roggenbrot|toastbrot|toast|sandwichbrot)(?: |$)/,/(keks|cookie|lebkuchen)/),
 definition("quark","Quark",95,["quarks"],/^(?:quark|magerquark|speisequark)(?: |$)/),
 definition("yogurt","Joghurt",95,["yogurts"],/^(?:naturjoghurt|joghurt|jogurt|yogurt)(?: |$)/),
 definition("cheese","Käse",96,["cheeses"],/^(?:kase|gouda|emmentaler|edamer|mozzarella|feta|frischkase|camembert|parmesan)(?: |$)/),
 definition("pasta","Nudeln",99,["pastas"],/^(?:nudeln|pasta|spaghetti|penne|fusilli|rigatoni|tagliatelle|lasagneplatten)(?: |$)/),
 definition("rice","Reis",97,["rices"],/^(?:reis|basmati ?reis|jasminreis|langkornreis|naturreis|rice)(?: |$)/,/(pudding|waffel|crackers|riegel)/),
 definition("flour","Mehl",96,["flours"],/^(?:mehl|weizenmehl|dinkelmehl|roggenmehl|flour)(?: |$)/),
 definition("sugar","Zucker",95,["sugars"],/^(?:zucker|haushaltszucker|raffinadezucker|rohrzucker|puderzucker|sugar)(?: |$)/),
 definition("cooking_oil","Speiseöl",96,["vegetable-oils"],/^(?:rapsol|sonnenblumenol|olivenol|speiseol|kokosol)(?: |$)/),
 definition("oats","Haferflocken",97,["rolled-oats"],/^(?:haferflocken|zarte haferflocken|kernige haferflocken|oat flakes|rolled oats)(?: |$)/,/(riegel|bar|keks|cookie)/),
 definition("muesli","Müsli und Frühstücksflocken",91,["mueslis","breakfast-cereals"],/^(?:musli|muesli|müsli|cornflakes|granola)(?: |$)/,/(riegel|bar|keks|cookie)/),
 definition("water","Wasser",99,["waters","mineral-waters"],/^(?:mineralwasser|wasser|sprudelwasser|tafelwasser|water)(?: |$)/),
 definition("coffee","Kaffee",95,["coffees"],/^(?:kaffee|filterkaffee|espresso|coffee)(?: |$)/,/(keks|cookie|riegel|eiscreme)/),
 definition("tea","Tee",91,["teas"],/^(?:tee|schwarzer tee|gruner tee|krautertee|fruchtetee|tea)(?: |$)/),
 definition("juice","Saft",91,["fruit-juices"],/^(?:apfelsaft|orangensaft|traubensaft|direktsaft|multivitaminsaft|saft)(?: |$)/),
 definition("potatoes","Kartoffeln",97,["potatoes"],/^(?:kartoffeln|speisekartoffeln|potatoes)(?: |$)/,/(chips|crisps|pommes|fritten|salat)/),
 definition("onions","Zwiebeln",95,["onions"],/^(?:zwiebeln|speisezwiebeln|rote zwiebeln|onions)(?: |$)/,/(pulver|powder|ringe|chips)/),
 definition("tomato_products","Tomaten zum Kochen",92,["canned-tomatoes","tomato-pastes","tomato-sauces"],/^(?:passierte tomaten|gehackte tomaten|tomatenmark|tomatenpassata|passata)(?: |$)/),
 definition("tomatoes","Tomaten",95,["tomatoes"],/^(?:tomaten|cherrytomaten|rispentomaten|tomatoes)(?: |$)/,/(mark|pulver|suppe|sauce|passiert|getrocknet)/),
 definition("cucumbers","Gurken",95,["cucumbers"],/^(?:gurken|salatgurke|salatgurken|cucumber)(?: |$)/,/(eingelegt|gewurz|essig|pickled|salat$)/),
 definition("apples","Äpfel",96,["apples"],/^(?:apfel|apfels|apples)(?: |$)/,/(saft|juice|mus|sauce|chips|getrocknet)/),
 definition("bananas","Bananen",96,["bananas"],/^(?:banane|bananen|bananas)(?: |$)/,/(chips|getrocknet|saft|juice|brot)/),
 definition("tofu","Tofu",89,["plain-tofu","smoked-tofu","silken-tofu","marinated-tofu"],/^(?:tofu|naturtofu|rauchertofu|seidentofu)(?: |$)/),
 definition("meat","Fleisch",92,["meats"],/^(?:hackfleisch|rinderhack|rindfleisch|schweinefleisch|hahnchenbrust|hahnchen|putenbrust|rindersteak)(?: |$)/),
 definition("frozen_vegetables","Tiefkühlgemüse",89,["frozen-vegetables"],/^(?:tk|tiefkuhl|tiefgekuhltes|tiefgekuhlte) (?:gemuse|erbsen|brokkoli|spinat)(?: |$)/),
 definition("frozen_fish","Tiefkühlfisch",86,["frozen-fishes"],/^(?:tk|tiefkuhl|tiefgekuhlte|tiefgekuhltes) (?:fischstabchen|fischfilet|lachsfilet|fisch)(?: |$)/),
 definition("frozen_meals","Tiefkühlgerichte",82,["frozen-ready-made-meals","frozen-pizzas"],/^(?:tk|tiefkuhl|tiefgekuhlte) (?:pizza|lasagne|gerichte)(?: |$)/),
 definition("legumes","Hülsenfrüchte",88,["pulses"],/^(?:linsen|kichererbsen|kidneybohnen|weisse bohnen|rote bohnen|beans|lentils|chickpeas)(?: |$)/),
 definition("plant_drinks","Pflanzendrinks",86,["plant-based-milk-alternatives"],/^(?:haferdrink|sojadrink|mandeldrink|hafermilch|sojamilch|mandelmilch)(?: |$)/),
 definition("cream","Sahne",88,["creams"],/^(?:sahne|schlagsahne|susses sahne|kochcreme)(?: |$)/,/(keks|cookie|riegel|pudding|dessert)/),
 definition("salt","Salz",88,["salts"],/^(?:salz|jodsalz|speisesalz|meersalz|salt)(?: |$)/),
 definition("household","Grundhaushalt",80,["detergents"],/^(?:waschmittel|waschpulver|vollwaschmittel|spulmittel|geschirrspulmittel|toilettenpapier|kuchenrolle|kuchenpapier|mullbeutel)(?: |$)/)
]);
const BY_ID=new Map(FAMILIES.map(value=>[value.id,value]));
const CATEGORY_ORDER=["plant_drinks","quark","yogurt","cheese","milk_fresh","milk_uht","milk","frozen_meals","frozen_vegetables","frozen_fish","tomato_products","rolls","oats",...FAMILIES.map(value=>value.id)].filter((id,index,ids)=>ids.indexOf(id)===index).map(id=>BY_ID.get(id));
const FALLBACK_BLOCKED_TAGS=new Set(["en:snacks","en:chocolates","en:chocolate-bars","en:confectioneries","en:candies","en:biscuits","en:cereal-bars","en:ice-creams","en:cakes","en:baby-foods","en:alcoholic-beverages"]);
const MILK_CONFLICT_TAGS=new Set(["en:plant-based-milk-alternatives","en:milk-substitutes","en:plant-based-creams","en:condensed-milks","en:evaporated-milks","en:coffee-drinks","en:latte-macchiato","en:snacks","en:chocolates","en:cereal-bars"]);
const FRESH_CONFLICT_TAGS=new Set(["en:beverages","en:juices-and-nectars","en:fruit-based-beverages","en:fruit-juices","en:fruit-nectars","en:pickles","en:pickled-vegetables","en:dried-products","en:frozen-foods","en:meals","en:soups","en:fries","en:chips-and-fries"]);
const FRESH_FAMILIES=new Set(["potatoes","onions","tomatoes","cucumbers","apples","bananas"]);
const MILK_CONFLICT_NAME=/(bacon|rashers|speck|schinken|spargel|asparagus|chocolat|chocolate|schoko|kakao|snack|\bbars?\b|pudding|dessert|milchreis|coffee|kaffee|macchiato|\blatte\b|almond|mandel|soy|soja|coconut|kokos|hafer|\boat\b)/;
const FRESH_CONFLICT_NAME=/(saft|juice|schorle|ne[ck]tar|drink|smoothie|milchreis|rice pudding|pudding|joghurt|yogurt|marmelade|apfelmus|getrocknet|dried|pickl|cornichon|gherkins?|gewurz|essig|soup|suppe)/;
function name(row={}){return String(row.product_name_de||row.product_name||row.name||"").trim()}
function code(row={}){return String(row.code||row.gtin||"").trim()}
function tags(row={}){const values=Array.isArray(row.categories_tags)?row.categories_tags:Array.isArray(row.categories)?row.categories:[];return new Set(values.filter(value=>typeof value==="string").map(value=>value.trim().toLowerCase()))}
function german(row={}){
 const values=Array.isArray(row.countries_tags)?row.countries_tags:Array.isArray(row.countries)?row.countries:null;
 if(values?.length)return values.some(value=>["en:germany","de:deutschland","germany","deutschland","de"].includes(String(value).trim().toLowerCase()));
 if(typeof row.countries==="string"&&row.countries.trim())return row.countries.split(",").some(value=>["en:germany","deutschland","germany","de"].includes(value.trim().toLowerCase()));
 return String(row.countryCode||row.country_code||row.country||"").trim().toUpperCase()==="DE";
}
function placeholder(row){return /^(?:test(?: product| roast)?(?:\s|$)|placeholder(?:\s|$)|dummy(?: product)?(?:\s|$)|example product(?:\s|$))/i.test(name(row))}
function eligible(row){if(!row||typeof row!=="object"||Array.isArray(row))return false;const gtin=code(row);return german(row)&&/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)&&Identity.gtinValid(gtin)&&name(row).length>=2&&!placeholder(row)}
function fallbackName(row){let value=Identity.norm(name(row));const brand=Identity.norm(typeof row.brands==="string"?row.brands:typeof row.brand==="string"?row.brand:"");if(brand&&value.startsWith(brand+" "))value=value.slice(brand.length+1);return value.replace(/^(?:bio |organic |biologisch |laktosefrei |laktosefreie )+/,"")}
function quantityUnit(row){const match=String(row.quantity||row.pack||"").toLowerCase().match(/\d+(?:[.,]\d+)?\s*(kg|g|ml|cl|l|pcs|pc|pieces|piece|stk|stuck|stück)\b/);return match?.[1]||null}
function conflicts(item,row,categories,value){
 if(item.exclude?.test(value))return true;const unit=quantityUnit(row),liquid=["ml","cl","l"].includes(unit),mass=["g","kg"].includes(unit);
 if(item.id.startsWith("milk"))return MILK_CONFLICT_NAME.test(value)||[...categories].some(tag=>MILK_CONFLICT_TAGS.has(tag))||!!unit&&!liquid;
 if(item.id==="butter"||item.id==="eggs")return /(powder|pulver)/.test(value);
 if(item.id==="plant_drinks"||item.id==="juice")return!!unit&&!liquid;
 if(FRESH_FAMILIES.has(item.id))return liquid||FRESH_CONFLICT_NAME.test(value)||[...categories].some(tag=>FRESH_CONFLICT_TAGS.has(tag));
 if(item.id==="bread")return categories.has("en:bread-crumbs")||categories.has("en:chocolates")||categories.has("en:chocolate-bars")||/(paniermehl|chapelure|breadcrumbs|bread crumbs|vegan(?:e)? (?:bloc |block )?butter|margarine|streichfett)/.test(value);
 if(item.id==="cooking_oil")return /(?:^| )(?:crema|creme|spread|aufstrich)(?: |$)/.test(value);
 if(item.id==="flour")return categories.has("en:nut-flours")||categories.has("en:almond-flours")||categories.has("en:starches")||/(mandeln gerieben|ground almonds|speisestarke|maisstarke|corn ?starch|\bstarch\b)/.test(value);
 if(item.id==="water")return!!unit&&!liquid||[...categories].some(tag=>/^(?:en:flavored-waters|en:flavored-sparkling-waters|en:bottled-water-flavoured-with-sugar)$/.test(tag));
 if(item.id==="tea"||item.id==="coffee")return liquid||/(eistee|iced tea|ready to drink|latte|coffee drink)/.test(value);
 if(item.id==="household"){
  const original=name(row).toLowerCase().normalize("NFC");
  if(/\bkuchenrolle\b/.test(original)||/(erdbeer|strawberry|schoko|chocolate|kuchen|cake)/.test(original.replace(/k[üu]e?chen(?:rolle|papier)/g,"")))return true;
  if(mass&&/(toilettenpapier|kuchenrolle|kuechenrolle|kuchenpapier|mullbeutel)/.test(value))return true;
 }
 return false;
}
function family(row={}){
 if(!name(row)||placeholder(row))return null;
 const categories=tags(row),value=fallbackName(row);
 if(categories.has("en:breads")&&categories.has("en:chocolate-cereals"))return null;
 if(categories.has("en:breads")&&categories.has("en:frozen-pizzas")&&!/\bpizza\b/.test(value))return null;
 for(const item of CATEGORY_ORDER){if(conflicts(item,row,categories,value))continue;if(item.tags.some(tag=>categories.has(tag)))return item.id}
 if([...categories].some(tag=>FALLBACK_BLOCKED_TAGS.has(tag)))return null;
 for(const item of FAMILIES){if(!conflicts(item,row,categories,value)&&item.name.test(value))return item.id}
 return null;
}
function nonnegative(value){const number=Number(value);return Number.isFinite(number)&&number>0?number:0}
function popularity(row={}){return Math.min(60,Math.log2(1+nonnegative(row.unique_scans_n??row.uniqueScans))*4)+Math.min(15,Math.log10(1+nonnegative(row.popularity_key??row.popularity))*2)}
function score(row){if(!eligible(row))return 0;const item=BY_ID.get(family(row)),quality=(name(row).length>4?2:0)+(String(row.brands||row.brand||"").trim()?3:0)+(String(row.quantity||row.pack||"").trim()?4:0)+(tags(row).size?3:0);return Math.round(((item?.priority||1)*100+popularity(row)*10+quality)*100)/100}
function rank(rows=[]){const seen=new Map();for(const row of Array.isArray(rows)?rows:[]){if(!eligible(row))continue;const key=code(row),priority=score(row),old=seen.get(key);if(!old||priority>old.priority)seen.set(key,{row,priority,key})}return[...seen.values()].sort((a,b)=>b.priority-a.priority||a.key.localeCompare(b.key)).map(value=>value.row)}
function select(rows=[],options={}){
 const requested=Number(options.limit??6000),limit=Number.isFinite(requested)&&requested>=0?Math.floor(requested):6000,min=Number(options.minPerFamily??10),minimum=Number.isFinite(min)&&min>=0?Math.floor(min):10;
 const ordered=rank(rows),buckets=new Map(FAMILIES.map(value=>[value.id,[]])),other=[];
 for(const row of ordered){const key=family(row);if(key)buckets.get(key).push(row);else other.push(row)}
 const selected=[],positions=new Map(FAMILIES.map(value=>[value.id,0]));
 function round(maxPerFamily){let added=0;for(const item of FAMILIES){if(selected.length>=limit)break;const position=positions.get(item.id),bucket=buckets.get(item.id);if(position>=bucket.length||position>=maxPerFamily)continue;selected.push(bucket[position]);positions.set(item.id,position+1);added++}return added}
 for(let index=0;index<Math.min(minimum,limit)&&selected.length<limit;index++)if(!round(minimum))break;
 while(selected.length<limit&&round(Infinity)){}
 if(options.includeOther===true&&selected.length<limit)selected.push(...other.slice(0,limit-selected.length));
 return selected;
}
function coverage(rows=[]){
 const input=Array.isArray(rows)?rows:[],valid=rank(input),counts=Object.fromEntries(FAMILIES.map(value=>[value.id,0]));let unclassified=0;
 for(const row of valid){const key=family(row);if(key)counts[key]++;else unclassified++}
 const families=FAMILIES.map(value=>({id:value.id,label:value.label,count:counts[value.id]}));
 return{total:input.length,eligible:valid.length,excluded:input.length-valid.length,classified:valid.length-unclassified,unclassified,representedFamilies:families.filter(value=>value.count>0).length,familyCount:FAMILIES.length,missingFamilies:families.filter(value=>value.count===0).map(value=>value.id),counts,families};
}
module.exports={FAMILIES,TAXONOMY_SOURCE,family,score,select,coverage,rank,eligible,german};
