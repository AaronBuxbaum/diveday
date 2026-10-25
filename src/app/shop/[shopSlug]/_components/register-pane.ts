import { staffPageClass } from "./staff-page";

/**
 * The one `<main>` a register page draws (boats, trip tags, the pre-departure
 * checklist): a staff page at `reading` width (`staff-page.ts`), the width of
 * a column of rows. Registers sit beside dive sites and gear at
 * `/shop/<slug>/<noun>`, so there is no Settings rail beside them to offset
 * (`settings-pane.ts` is the pane that has one). Issue #2659, glossary
 * "Register and setting".
 */
export function registerPaneClass(): string {
  return staffPageClass("reading");
}
