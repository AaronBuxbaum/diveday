import type { GuideSkeletonLines } from "./guide";

/*
 * **How far each switching guide's own words wrap**, for `GuideBodySkeleton`:
 * the lines its title, lede and "you are here" paragraphs take on a phone (390)
 * and a desk (1280), `{ base, sm }`. A width cannot stand in for text that
 * wraps, and how far a page's words wrap is the page's business (the same
 * split `ShopPageHeaderSkeleton` makes), so the counts sit here beside the
 * guides rather than in the skeleton.
 *
 * Counted in en-US, the locale the static shell paints for, on the pixel
 * probe's captures of 2026-09-25 (switching-eve, -fareharbor, -rezdy and
 * -spreadsheet): a `text-lg leading-8` line is 32px, a title line 40 (48 from
 * `sm`), a wedge item's line 24.
 *
 * DiveShop360 and Smartwaiver have no capture. Their counts are worked from
 * their copy at the rate every captured paragraph fits — all fifteen ledes and
 * paragraphs take ceil(characters / 41) lines at 390 and ceil(characters / 83)
 * at 1280 in the `max-w-2xl` column — and their titles, the length of EVE's
 * template ("Moving your … off …"), wrap as EVE's does. A capture of either
 * guide replaces the estimate with a count.
 *
 * Copy edits move these. Re-count from the capture (`node
 * scripts/pixel-probe-report.mjs --tiles <capture>`) when a guide's words
 * change.
 */

/** Keyed by `MigrationGuide.slug`; `guide-skeleton-lines.test.ts` holds every registered guide to an entry. */
export const GUIDE_SKELETON_LINES: Record<string, GuideSkeletonLines> = {
  eve: {
    title: { base: 2, sm: 1 },
    lede: { base: 7, sm: 4 },
    context: [
      { base: 8, sm: 4 },
      { base: 10, sm: 5 },
      { base: 4, sm: 2 },
    ],
  },
  // Estimated (no capture): lede 291 characters; paragraphs 296, 207, 139.
  diveshop360: {
    title: { base: 2, sm: 1 },
    lede: { base: 8, sm: 4 },
    context: [
      { base: 8, sm: 4 },
      { base: 6, sm: 3 },
      { base: 4, sm: 2 },
    ],
  },
  // Estimated (no capture): lede 268 characters; paragraphs 308, 264, 446, 151.
  smartwaiver: {
    title: { base: 2, sm: 1 },
    lede: { base: 7, sm: 4 },
    context: [
      { base: 8, sm: 4 },
      { base: 7, sm: 4 },
      { base: 11, sm: 6 },
      { base: 4, sm: 2 },
    ],
  },
  fareharbor: {
    title: { base: 3, sm: 2 },
    lede: { base: 9, sm: 5 },
    context: [
      { base: 9, sm: 5 },
      { base: 7, sm: 4 },
      { base: 8, sm: 4 },
    ],
  },
  rezdy: {
    title: 2,
    lede: { base: 10, sm: 5 },
    context: [
      { base: 10, sm: 5 },
      { base: 7, sm: 4 },
      { base: 7, sm: 4 },
    ],
  },
};

/**
 * The spreadsheet guide: its own hero, two paragraphs, then the four wedge
 * items, one column on a phone and two from `sm`.
 */
export const SPREADSHEET_SKELETON_LINES: GuideSkeletonLines = {
  title: { base: 2, sm: 1 },
  lede: { base: 4, sm: 2 },
  context: [{ base: 4, sm: 2 }, 1],
  list: [
    { title: { base: 2, sm: 1 }, detail: 3 },
    { title: 1, detail: { base: 3, sm: 2 } },
    { title: 1, detail: 3 },
    { title: 1, detail: { base: 4, sm: 3 } },
  ],
};
