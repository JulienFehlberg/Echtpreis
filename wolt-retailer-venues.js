"use strict";

// Closed, source-attested public customer shops; never accept caller-supplied venues.
function freeze(profile){return Object.freeze({...profile,stapleSlugs:Object.freeze([...profile.stapleSlugs]),allowedAddresses:Object.freeze(profile.allowedAddresses||[profile.address])});}
const PROFILES=Object.freeze({
 edekaBerlin:freeze({key:"edekaBerlin",sourceId:"Wolt EDEKA Berlin",merchant:"EDEKA",nativeVenueId:"67ebb70ed3581534a525c522",slug:"edeka-hilbrecht",nativeMarketId:"800401",name:"EDEKA Hilbrecht",brandName:"Edeka",address:"Ritterstr. 38-40",postalCode:"10969",city:"Berlin",country:"DE",latitude:52.50356,longitude:13.40358,officialMarketUrl:"https://www.edeka.de/maerkte/800401/",stapleSlugs:["milch-46","butter-margarine-44","eier-45","geschnittenes-brot-toast-21","pasta-nudeln-208","reis-209","mehl-bindemittel-240","wasser-125","milch-sahnealternativen-49","gemahlener-kaffee-138"]}),
 nahkaufWrangelBerlin:freeze({key:"nahkaufWrangelBerlin",sourceId:"Wolt nahkauf Berlin Wrangelstraße",merchant:"nahkauf",nativeVenueId:"657acc4eba505a018fb31b05",slug:"nahcity-wrangelstrae",nativeMarketId:"561888",name:"Nahkauf Wrangelstraße",brandName:"Nahcity",address:"Wrangelstraße 75",postalCode:"10997",city:"Berlin",country:"DE",latitude:52.4979576,longitude:13.4437284,officialMarketUrl:"https://www.rewe.de/marktseite/berlin-kreuzberg/561888/nahkauf-wrangelstr-75/",stapleSlugs:["milch-47","butter-margarine-45","eier-46","geschnittenes-brot-toast-22","pasta-nudeln-209","reis-210","mehl-bindemittel-240","wasser-127","milch-sahnealternativen-50","gemahlener-kaffee-140"]})
});
function resolve(key="edekaBerlin"){
 if(arguments.length>1||typeof key!=="string"||!Object.prototype.hasOwnProperty.call(PROFILES,key))throw Object.assign(new Error("wolt-venue-profile-not-approved"),{code:"wolt-venue-profile-not-approved"});
 return PROFILES[key];
}
module.exports={PROFILES,resolve};
