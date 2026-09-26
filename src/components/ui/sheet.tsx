import type { ReactNode } from "react";
import { LEAD_TITLE_CLASS } from "@/components/ui/typography";

/**
 * **A bottom sheet's panel**: the box a sheet rises in from the foot of the
 * screen, over a scrim — the manifest's person sheet (`PersonSheet`) and the
 * day's diver sheet (`DiverSheet`).
 *
 * The two were hand copies of one shell, and both rounded their top corners at
 * an arbitrary 22px against the 20px `rounded-panel` of every card they lie
 * over (K-557, pixel-craft class 6). One string now, on the ladder's panel
 * rung. The entrance and exit (`rise-in` / `sheet-out`) and anything a sheet
 * does with a finger stay the sheet's own; this is only its geometry: height
 * cap, scroll, radius, hairline, inset, safe-area foot and shadow.
 *
 * `outline-none` is not in it: it goes on the `tabIndex={-1}` dialog the focus
 * trap moves into, beside the `role="dialog"` that says why, where
 * `focus-ring.test.ts` can see it is a container and not a control.
 */
export const SHEET_PANEL_CLASS =
  "max-h-[min(90dvh,48rem)] w-full overflow-y-auto overscroll-contain rounded-t-panel border-t border-border bg-surface px-5 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:mx-auto sm:max-w-2xl sm:px-7";

/**
 * **A sheet's header: the name, a trailing group, and the line under both.**
 *
 * Two rows of one grid. The name and the trailing group — a status pill, the
 * close — share the first row and its centre (`items-center`); the subtitle
 * takes the second across both columns. It was a `flex items-start` row, which
 * hung a 26px pill, a 44px close and a 32px name line from one top edge: the
 * pill's centre 5px above the name's and the close 5.5px below it (K-269,
 * pixel-craft class 1). The subtitle sat in the name's column, which on a
 * phone left it 165px beside the pill and the close; across both columns it
 * has the sheet's width.
 *
 * The close is the caller's, passed in `actions` with anything that rides
 * beside it, because it closes the caller's own state.
 */
export function SheetHeader({
  titleId,
  descriptionId,
  title,
  subtitle,
  actions,
}: {
  /** The dialog's `aria-labelledby`. */
  titleId: string;
  /** The dialog's `aria-describedby`. */
  descriptionId: string;
  title: ReactNode;
  subtitle: ReactNode;
  /** The trailing group: the close, and a status beside it if there is one. */
  actions: ReactNode;
}) {
  return (
    <header className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <h2 id={titleId} className={LEAD_TITLE_CLASS}>
        {title}
      </h2>
      <div className="flex items-center gap-2">{actions}</div>
      <p id={descriptionId} className="col-span-2 text-sm text-muted">
        {subtitle}
      </p>
    </header>
  );
}
