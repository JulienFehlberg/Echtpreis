"use strict";
const References = require('./berlin-reference-prices');
const Penny = require('./penny-berlin-publications');
// A CMS price card is neither a retailer SKU nor a canonical product.
// Keep both contracts separate, including their counts and eligibility.
async function search(pool, input = {}, deps = { references: References, penny: Penny }) {
  const query = References.options(input, true);
  const normalized = { now: query.now, limit: query.limit,
    ...(query.search ? { search: query.search } : {}), ...(query.gtin ? { gtin: query.gtin } : {}),
    ...(query.merchant ? { merchant: query.merchant } : {}), ...(query.pack !== undefined ? { pack: query.pack } : {}),
    ...(query.scopeChannel ? { scopeChannel: query.scopeChannel } : {}) };
  const [ordinary, regional] = await Promise.all([deps.references.search(pool, normalized), deps.penny.search(pool, normalized)]);
  const publicationRows = regional.publicationCoverage.matchedCards;
  const retailers = ordinary.coverage.retailers.map(row => {
    const count = row.merchant === 'PENNY' ? publicationRows : 0;
    return { ...row, publicationReferences: count, missing: row.referenceRows + count === 0,
      supportedSources: [...row.supportedSources, ...(row.merchant === 'PENNY' ? [Penny.SOURCE] : [])],
      scopeChannels: [...new Set([...row.scopeChannels, ...(count ? [Penny.CHANNEL] : [])])] };
  });
  return { ...ordinary, publications: regional.publications, publicationCoverage: regional.publicationCoverage,
    truncated: ordinary.truncated || regional.truncated,
    scopeChannels: [...new Set([...ordinary.scopeChannels, ...(publicationRows ? [Penny.CHANNEL] : [])])].sort(),
    coverage: { ...ordinary.coverage, matchedPublicationReferences: publicationRows, retailers,
      missingRetailers: retailers.filter(row => row.missing).map(row => row.merchant) } };
}
module.exports = Object.freeze({ search });
