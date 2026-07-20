/**
 * Commons files we ship locally. A filename that leaves this set (because the
 * image was dropped from the bundle) must leave the set too — otherwise a
 * legacy row's Commons URL is rewritten to a local path that 404s, where
 * falling through to Commons would still have shown the photo.
 */
const bundledCommonsFiles = new Set([
  "AtlanticGoliathGrouper.jpg",
  "Blue Tang Pickles 20080310.jpg",
  "Blue Tangs Molasses Reef 1999.jpg",
  "Brain coral 2 Molasses Reef 20080309.jpg",
  "Dasyatis americana NOAA.jpg",
  "Elkhorn coral 8 Molasses Reef 20080309.jpg",
  "FGBNMS - nurse shark (27551309652).jpg",
  "FKNMS - Goliath Grouper With Remora (27094933605).jpg",
  "French Angelfish Molasses Reef 20080309.jpg",
  "French Angelfish Pickles Reef 20230713.jpg",
  "Grouper 2 Molasses Reef 1999.jpg",
  "Sponge 06 Molasses Reef 20230714.jpg",
  "Stoplight parrotfish Pickles Reef.jpg",
  "Yellowtail Snappers Molasses Reef 1999.jpg",
]);

/** Keep older demo rows displayable after the Commons images became bundled locally. */
export function resolveDiveSiteImageUrl(url: string | null): string | null {
  if (!url || url.startsWith("/")) return url;
  const match = url.match(/commons\.wikimedia\.org\/wiki\/Special:FilePath\/([^?]+)/);
  if (!match?.[1]) return url;
  const filename = decodeURIComponent(match[1]);
  return bundledCommonsFiles.has(filename) ? `/dive-sites/${encodeURIComponent(filename)}` : url;
}
