// i18n-exempt-file: pure SVG artwork — every node is aria-hidden path data, no
// words; each row's accessible name is its own label.

/**
 * The rail for the palette rows that are **not** staff destinations.
 *
 * Destinations draw `StaffDestinationIcon`, the registry's own artwork, so the
 * palette and the phone dock can never show one page two ways. What is left
 * over is everything the palette adds on top of the nav: the searched result
 * groups, the two boat-shaped shortcuts, and the two rows about this session
 * rather than this shop. They need a glyph for the same reason the
 * destinations do — a rail that stops halfway down the list is worse than no
 * rail (issue #773) — but they have nowhere in the registry to live.
 *
 * Same 24-grid, same stroke weight, deliberately: the panel has one family of
 * marks in it, not two.
 */
const GLYPHS = {
  // A person found by name — the search result, not the roster page.
  diver: (
    <>
      <circle cx="10" cy="8" r="4" />
      <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
    </>
  ),
  // A departure: a boat on the water.
  trip: (
    <>
      <path d="M3 17.5c1.5 0 1.5 1.2 3 1.2s1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2" />
      <path d="M5 14.5 6.5 9h11L19 14.5Z" />
      <path d="M12 9V4.5" />
    </>
  ),
  diveSite: (
    <>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  course: (
    <>
      <path d="M12 7v13" />
      <path d="M12 7a4 4 0 0 0-4-3H3v13h5a4 4 0 0 1 4 3" />
      <path d="M12 7a4 4 0 0 1 4-3h5v13h-5a4 4 0 0 0-4 3" />
    </>
  ),
  order: (
    <>
      <path d="M5 3h14v18l-2.33-1.5L14.33 21 12 19.5 9.67 21l-2.34-1.5L5 21V3Z" />
      <path d="M9 8h6" />
      <path d="M9 12h6" />
    </>
  ),
  gear: (
    <>
      <rect x="8" y="6" width="8" height="15" rx="3" />
      <path d="M10.5 6V3.5h3V6" />
      <path d="M13.5 4.5H16" />
      <path d="M8 11h8" />
    </>
  ),
  // Today's boat, at the rail: a life ring.
  boarding: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="m5.6 5.6 3.9 3.9" />
      <path d="m14.5 14.5 3.9 3.9" />
      <path d="m18.4 5.6-3.9 3.9" />
      <path d="m9.5 14.5-3.9 3.9" />
    </>
  ),
  // The copy that works with no signal: a phone with the connection cut.
  offline: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M10 18h4" />
      <path d="m3 3 18 18" />
    </>
  ),
  // Another language.
  language: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" />
    </>
  ),
  signOut: (
    <>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="m15 16 4-4-4-4" />
      <path d="M19 12H9" />
    </>
  ),
} as const;

export type PaletteGlyphName = keyof typeof GLYPHS;

export function PaletteGlyph({ name }: { name: PaletteGlyphName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      {GLYPHS[name]}
    </svg>
  );
}
