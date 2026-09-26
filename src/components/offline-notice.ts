/**
 * **The toned notice the offline views draw, in one anatomy**, with its tone
 * added at each call site: the dock copy's expired and freshness banners, the
 * discarded-records alert, and the shell's own stale and update banners
 * (`OfflineShellVersionBanner`), which open both offline views.
 *
 * They were copies of `rounded-lg … p-3`, which started their text 8px left of
 * the `p-4 sm:p-5` panels below them in the same column (4px on a phone), so
 * the page had two text edges a few pixels apart (docs/design/pixel-craft.md,
 * class 3). The inline padding is the panels' own. Not `ShopNotice`: that is
 * the desk's 14px notice with a mark, and these are read at 16px on a wet
 * deck.
 */
export const OFFLINE_NOTICE_CLASS = "rounded-inset border px-4 py-3 text-base leading-6 sm:px-5";
