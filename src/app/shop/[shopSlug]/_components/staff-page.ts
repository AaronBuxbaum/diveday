/**
 * **The two widths a staff page comes in, set here and nowhere else.**
 *
 * - `reading` (`max-w-3xl`): a form, one record, a setting, an editor. A
 *   comfortable line, and the page a staffer reads down.
 * - `full` (`max-w-6xl`): a board, a table, a ledger, a departure (all of its
 *   tabs, the manifest and prep among them), a report. The page a staffer
 *   scans across, and every tablet surface.
 *
 * Staff pages used to spell their own `<main>`, at five widths (`2xl` to
 * `6xl`), so moving between tabs at 1280 moved the heading's left edge and
 * the header actions' right edge every time (visual review 2026-10-24, A04).
 * There is no third value and no per-page exception: a page that "needs"
 * `4xl` or `5xl` is `full`. A `max-w-*` inside a page bounds a paragraph's
 * measure, never the page; `scripts/check-staff-widths.mjs` (in
 * `pnpm check:repo`) refuses any other in a staff `page.tsx` or
 * `loading.tsx`, and a skeleton takes its page's width.
 *
 * Every staff shell takes its width from here: `StaffPage` (most pages),
 * `settingsPaneClass` (beside the Settings rail), `registerPaneClass` (boats,
 * trip tags, the pre-departure checklist) and `TRIP_SHELL_CLASS` (every
 * departure surface and the day's packet).
 */
export const STAFF_PAGE_WIDTHS = {
  reading: "max-w-3xl",
  full: "max-w-6xl",
} as const;

export type StaffPageWidth = keyof typeof STAFF_PAGE_WIDTHS;

/** The one inset every staff page takes, phone and desk alike. */
export const STAFF_PAGE_INSET = "px-4 py-8 sm:px-6 sm:py-10";

/** The `<main>` class of a staff page: centred, at one of the two widths. */
export function staffPageClass(width: StaffPageWidth = "reading", className?: string): string {
  return ["mx-auto w-full", STAFF_PAGE_WIDTHS[width], "flex-1", STAFF_PAGE_INSET, className]
    .filter(Boolean)
    .join(" ");
}
