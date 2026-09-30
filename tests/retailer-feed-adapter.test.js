const assert=require("assert"),A=require("../retailer-feed-adapter");
assert.throws(()=>A.normalize("rewe",[{name:"Milch",price:"1,19"}],{region:"Berlin"}),/not-approved/);
assert.throws(()=>A.normalize("unknown",[],{}),/unknown-retailer-contract/);
console.log("retailer-feed-adapter: governance ok");
