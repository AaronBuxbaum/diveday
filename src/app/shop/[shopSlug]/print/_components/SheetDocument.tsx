import Link from "next/link";
import type { ReactNode } from "react";
import { BrandStyle } from "@/components/BrandStyle";
import { PrintButton } from "@/components/PrintButton";
import { buttonClass } from "@/components/ui/button";
import type { BrandDisplayFontCode } from "@/lib/brand";
import { type PrintSheetPaper, printSheetPageRule } from "@/lib/print-sheets";
import { shopPath } from "@/lib/staff-notices";
import { AutoPrint } from "../../trips/[id]/_components/AutoPrint";

/**
 * **The page a sheet is printed from** — ADR 20260908-one-hand, decision 6,
 * lever X.
 *
 * Three things, and deliberately nothing else:
 *
 * - **The `@page` block**, from the sheet's own paper. It is emitted here
 *   rather than in `globals.css` because `@page` is document-scoped and each of
 *   these routes *is* one document; the rule lands after the stylesheet, so it
 *   is the one that decides the paper.
 * - **The shop's face.** `BrandStyle` with the display font only — the band's
 *   colour is resolved by the sheet itself and handed down as a value, because
 *   print redefines the colour tokens (`globals.css`'s paper-sheet block says
 *   why). A sheet that rides a boat passes no font either, so nothing about a
 *   hull's card depends on the storefront.
 * - **The way back and the way out**, both `print:hidden`: the register this
 *   was opened from, and a second Print for a staffer who dismissed the dialog.
 *
 * `AutoPrint` opens the dialog on arrival, the same as the trip and day
 * packets: the door that reached this page said Print, so the page does not
 * ask again.
 */
export function SheetDocument({
  shopSlug,
  paper,
  brandDisplayFont,
  backLabel,
  printLabel,
  children,
}: {
  shopSlug: string;
  paper: PrintSheetPaper;
  /** The shop's display face, or null for a sheet that rides a boat. */
  brandDisplayFont: BrandDisplayFontCode | null;
  backLabel: string;
  printLabel: string;
  children: ReactNode;
}) {
  return (
    <>
      {/* A closed list of `size` values, built from the route's own paper by
          `printSheetPageRule` — never a request value. */}
      <style data-print-sheet="">{printSheetPageRule(paper)}</style>
      <BrandStyle brandColor={null} brandDisplayFont={brandDisplayFont} />
      <AutoPrint />
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 print:hidden">
        <Link
          href={shopPath(shopSlug, "settings", "print")}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          {backLabel}
        </Link>
        <PrintButton label={printLabel} />
      </div>
      <div className="paper-sheet-frame">
        <div>{children}</div>
      </div>
    </>
  );
}
