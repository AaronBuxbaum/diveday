import type { ReactNode } from "react";

/**
 * Shared staff and storefront chrome (ADR 20260827-clearwater-surface-language,
 * decision 10; phone behavior: ADR 20260830-responsive-surface-consistency).
 * Staff height is fixed; public chrome can wrap and publishes its measured
 * height as `--chrome-h` for sticky clearance. The title slot is decorative,
 * portal-filled, and absent from the storefront; connectivity stays page-level
 * (`onlyWhenOffline`). Keep the receding surface and fallback from decision 1.
 * The title behavior follows ADR 20260907-nothing-from-nowhere, decision 5.
 */

/**
 * The bar itself, exported so tests can read the one class string rather than
 * a rendered approximation of it.
 *
 * `h-(--chrome-h)` and not `h-14`: 3.5rem is the same 56px, but written this
 * way the bar's height and every sticky offset beneath it are one declaration.
 */
const CHROME_BAR_SURFACE_CLASS =
  "sticky top-0 z-30 border-b border-border bg-background backdrop-blur-xl supports-[backdrop-filter]:bg-background/85 print:hidden";
export const CHROME_BAR_CLASS = `${CHROME_BAR_SURFACE_CLASS} h-(--chrome-h)`;

export function ChromeBar({
  leading,
  trailing,
  staffChrome = false,
  stackedOnPhone = false,
  naturalHeight = false,
}: {
  /** The shop's own identity — the staff shell's menu, the shopfront's name. */
  leading: ReactNode;
  /** Search, language, the reader's own controls — always at the far edge. */
  trailing?: ReactNode;
  /** Marks the staff shell for the full-viewport live manifest exception. */
  staffChrome?: boolean;
  /**
   * Below `sm`, two rows rather than one: the leading slot on its own line
   * above the trailing cluster (issue #2303, the shopfront's name above its
   * tabs). `globals.css` reads the marker and sets the two-row baseline.
   * Natural-height public chrome can grow above it, with its observer keeping
   * every sticky offset in step.
   */
  stackedOnPhone?: boolean;
  /** Public navigation can wrap; its observer publishes the actual sticky clearance. Staff stay fixed. */
  naturalHeight?: boolean;
}) {
  return (
    // `data-chrome-bar` is what `globals.css` asks the document for before it
    // insets the scrollport by this bar's height — the marker, rather than the
    // class, because the class is a look and this is a fact about the page.
    <header
      className={
        naturalHeight
          ? `${CHROME_BAR_SURFACE_CLASS} flex min-h-(--chrome-base-h)`
          : CHROME_BAR_CLASS
      }
      data-chrome-bar=""
      data-staff-chrome={staffChrome || undefined}
      data-chrome-stacked={stackedOnPhone || undefined}
      data-chrome-natural={naturalHeight || undefined}
    >
      {/* Slots may shrink or wrap; min-w-0 contains long names. Keep the
          horizontal inset aligned with the page content. Staff chrome spans
          the window above its sidebar (ADR 20261001-logbook). */}
      <div
        className={`mx-auto flex ${naturalHeight ? "flex-wrap max-sm:flex-nowrap" : "h-full"} w-full items-center gap-x-2 px-4 sm:gap-x-3 sm:px-6 ${staffChrome ? "" : "max-w-6xl"} ${stackedOnPhone ? "max-sm:flex-col max-sm:items-stretch max-sm:justify-center max-sm:gap-0" : ""}`}
      >
        <div className="flex min-w-0 shrink items-center">{leading}</div>
        {trailing ? (
          <div
            className={`ms-auto flex ${naturalHeight ? "min-w-0 max-w-full shrink flex-wrap" : "shrink-0"} items-center gap-1.5 sm:gap-2 lg:gap-3 ${stackedOnPhone ? "max-sm:ms-0 max-sm:justify-between" : ""}`}
          >
            {trailing}
          </div>
        ) : null}
      </div>
    </header>
  );
}
