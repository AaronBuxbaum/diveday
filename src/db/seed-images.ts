/**
 * Bundled imagery for the demo shop.
 *
 * The seeded dive sites and recap photos point at files served from `public/`
 * rather than at a remote host: a demo that renders broken images the first
 * time a network hiccups is worse than no images, and the visual-regression
 * baselines need the same bytes on every run.
 */

/** Public-domain and CC0 images from Wikimedia Commons, bundled for reliable rendering. */
export function commonsImage(filename: string): string {
  return `/dive-sites/${encodeURIComponent(filename)}`;
}
