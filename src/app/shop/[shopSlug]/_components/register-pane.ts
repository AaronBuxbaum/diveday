/**
 * The one `<main>` a register page draws (boats, trip tags, the pre-departure
 * checklist): the inset every staff page takes, at the width of a column of
 * rows. Registers sit beside dive sites and gear at `/shop/<slug>/<noun>`, so
 * there is no Settings rail beside them to offset (`settings-pane.ts` is the
 * pane that has one). Issue #2659, glossary "Register and setting".
 */
export function registerPaneClass(): string {
  return "mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10";
}
