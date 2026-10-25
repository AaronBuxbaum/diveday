import { staffPageClass } from "../../_components/staff-page";

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
 * - **One width.** Every settings page is a staff page at `reading` width
 *   (`_components/staff-page.ts`), Team's roster and Website embed's form
 *   beside its preview included: the preview stacks under the form below its
 *   container's `@4xl`, and the right edge holds still with the left.
 * - **One inset**, the staff page's own.
 * - **One left edge beside the rail.** From `lg`, a pane that is not the
 *   frame's first child (the rail, or its skeleton, stands before it) drops
 *   its auto margins, so the column starts on the pane's own edge. A staffer
 *   who may not manage the shop reaches `/settings/calendar` with no rail
 *   drawn; that pane is the frame's first child and stays centred, the page
 *   it has always been.
 */
export function settingsPaneClass(): string {
  return staffPageClass("reading", "lg:[:not(:first-child)>&]:mx-0");
}
