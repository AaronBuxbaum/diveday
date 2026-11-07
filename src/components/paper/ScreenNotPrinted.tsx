import type { ReactNode } from "react";

/**
 * **A screen that must not reach paper says so, and that is all it prints.**
 *
 * A screen never prints (issue #2745): nothing on it wears a print face. Most
 * screens print as the browser draws them when someone presses Ctrl+P, and
 * that costs nobody anything. A screen that can hold a medical alert's or a
 * medical answer's words cannot, because paper with them on it is the
 * medical-alerts packet's job, which records who printed it. Such a screen
 * renders this: a print-only frame (`data-paper-print-only`), so on paper the
 * page is its frame (`globals.css`, "a page that holds a sheet is its
 * sheets") and the one line in it says where the paper is.
 */
export function ScreenNotPrinted({ children }: { children: ReactNode }) {
  return (
    <div className="paper-sheet-frame" data-paper-print-only="">
      <div>
        <section className="paper-sheet">
          <p className="p-6 text-base font-semibold">{children}</p>
        </section>
      </div>
    </div>
  );
}
