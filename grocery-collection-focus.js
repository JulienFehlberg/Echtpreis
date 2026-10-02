"use strict";
// Collection priorities do not change the authority or expiry of saved prices.
const retailers = Object.freeze(["PENNY", "EDEKA", "Lidl", "ALDI", "Kaufland", "REWE"]);
const retailerSources = Object.freeze(["Wolt EDEKA Berlin", "ALDI Nord published assortment", "REWE Berlin pickup", "PENNY Berlin regional price publications", "Lidl DE dated price announcements"]);
const supportingSources = Object.freeze(["Open Prices", "Open Prices locations", "Open Food Facts"]);
const allowed = new Set([...retailerSources, ...supportingSources]);
function apply(handlers) {
  if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) throw new TypeError("refresh handlers required");
  for (const name of Object.keys(handlers)) if (!allowed.has(name)) delete handlers[name];
  return handlers;
}
function status() {
  return { city: "Berlin", country: "DE", retailers: [...retailers], retailerSources: [...retailerSources],
    supportingSources: [...supportingSources], otherRetailerCollectionPaused: true, coverageComplete: false,
    coverageUnit: "retailer-product", referenceCity: "Berlin", allStoresRequired: false,
    rolloutOrder: ["Berlin retailer assortment and price references", "Other German states", "Individual stores"],
    note: "Priority retailers only. Each source keeps its actual online, pickup or published-assortment scope. Registered connectors do not prove complete physical-store price coverage." };
}
module.exports = Object.freeze({ apply, status });
