/**
 * **The settings pane: the one `<main>` every settings page and skeleton
 * draws**, beside the rail from `lg` (settings/layout.tsx) and alone below it.
 *
 * Each page used to spell its own. Three widths (`max-w-2xl`, `3xl`, `5xl`)
 * centred in the pane started the column at x 476, 428 and 408 at 1280, and
 * Print and the pre-departure checklist dropped `sm:py-10`, so their eyebrow
 * sat 8px higher: every click in the rail moved the back link and the title
 * sideways and down (the pixel probe, K-250 and K-312). `settings-pane.test.ts`
 * refuses a settings `<main>` that does not take its class from here.
 *
 * - **One inset.** `px-4 py-8`, `sm:px-6 sm:py-10`, on every page.
 * - **One left edge beside the rail.** From `lg`, a pane that is not the
 *   frame's first child (the rail, or its skeleton, stands before it) drops
 *   its auto margins, so every column starts on the pane's own edge whatever
 *   its width. A staffer who may not manage the shop reaches
 *   `/settings/calendar` with no rail drawn; that pane is the frame's first
 *   child and stays centred, the page it has always been.
 * - **Two widths.** `3xl` for a column of settings; `5xl` for the two pages
 *   whose content is a grid of its own, Team's roster and Website embed's
 *   form beside its preview. Only the right edge differs.
 */
const PANE_WIDTH = {
  "3xl": "max-w-3xl",
  "5xl": "max-w-5xl",
} as const;

export type SettingsPaneWidth = keyof typeof PANE_WIDTH;

export function settingsPaneClass(width: SettingsPaneWidth = "3xl"): string {
  return `mx-auto w-full ${PANE_WIDTH[width]} flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:[:not(:first-child)>&]:mx-0`;
}
