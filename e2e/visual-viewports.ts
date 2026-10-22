// Phone first, then desktop — matches scripts/screenshot.mjs. Navigation and
// clicks happen at the desktop base viewport (see viewport in test.use below);
// these only resize the page for the capture itself.
export const VIEWPORTS = [
  { width: 390, height: 844 }, // phone
  { width: 1280, height: 800 }, // desktop
] as const;

/**
 * **A portrait tablet — the device the shop is actually holding.**
 *
 * `VIEWPORTS` above is the standard responsive pair, and it is the right
 * default for a marketing page, a booking page and a diver's `/ready`. It is
 * the wrong device for the surfaces a dive shop works from: a departure's Divers
 * tab is the counter while its arrivals are open, and a counter device is an
 * iPad on a stand; the
 * manifest is read at the rail, often through a dry case.
 *
 * 768-1024px is also where Tailwind's `sm:`/`md:` breakpoints change a
 * layout's *shape* — where a two-column `FieldGrid` stands in columns while
 * the staff bar is still folded, its Today/Week/Season pills (`hidden
 * lg:flex`) and the calendar menu they fold into (`lg:hidden`) swapping
 * together at `lg`. Every one of those transitions was unphotographed, so a
 * regression there reached a shop before it reached CI.
 *
 * Portrait rather than landscape because portrait is the harder layout and the
 * posture a stand holds. A crew member holding a phone sideways at the rail is
 * a real posture too; it is not photographed here, and should not be until
 * something other than a hunch says it needs to be.
 */
/** The phone of `VIEWPORTS`, named — the fold is a phone behaviour and shoots there alone. */
export const PHONE_VIEWPORT = VIEWPORTS[0];

/**
 * **Dark mode is photographed at the desktop width only** (owner decision 1 of
 * the 2026-10-14 test review; ADR 20260729-reg-suit-visual-regression,
 * amendment 2026-10-15). Light keeps every width. The two schemes share one
 * layout and differ only in tokens, so a dark capture at a second width mostly
 * re-photographed the light one's geometry: about 300 of the suite's 1,220
 * images, a quarter of its capture minutes and of every UI pull request's
 * review. The price is a dark-only bug that shows at phone width alone.
 */
const DARK_VIEWPORTS = [VIEWPORTS[1]] as const;

/** The widths a capture in `scheme` is shot at, before any per-surface extra. */
export function schemeViewports(scheme: "light" | "dark", darkPhone = false) {
  return scheme === "dark" && !darkPhone ? DARK_VIEWPORTS : VIEWPORTS;
}
