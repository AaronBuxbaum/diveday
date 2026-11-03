import Link from "next/link";
import type { ReactNode } from "react";
import { BrandStyle } from "@/components/BrandStyle";
import { PrintButton } from "@/components/PrintButton";
import { buttonClass } from "@/components/ui/button";
import type { BrandDisplayFontCode } from "@/lib/brand";
import { PRINT_SHEET_BOX_MM, type PrintSheetPaper, printSheetPageRule } from "@/lib/print-sheets";
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
 *   colour is resolved by the sheet itself and handed down as a value.
 * - **The way back and the way out**, both `print:hidden`: the screen this
 *   was opened from, and a second Print for a staffer who dismissed the
 *   dialog. A packet may add one more door beside them (`doors`).
 *
 * `AutoPrint` opens the dialog on arrival: the door that reached this page
 * said Print, so the page does not ask again. A document reached by its own
 * name rather than by Print (the departure log) turns it off (`autoPrint`).
 * A packet composed from many readers names the marker it renders last
 * (`readySelector`), so the dialog never opens on half a document.
 *
 * A counter rental's ticket is also where the rental is worked: the acts that
 * move it sit above the sheet (`screen`), screen-only like the doors, so the
 * sheet under them is still the page that comes out of the printer.
 *
 * **Every document the app prints is this page around `PaperSheet`s**
 * (issue #2745): the passes, the counter card, and the trip, day and
 * medical-alerts packets, the departure log and the crew rota, the rental
 * tickets, the claim tag, the dispute sheet and the blank release. One paper
 * face, on `--sheet-*`.
 */
export function SheetDocument({
  backHref,
  paper,
  brandDisplayFont,
  backLabel,
  printLabel,
  readySelector,
  doors,
  screen,
  printOnly,
  autoPrint = true,
  children,
}: {
  /** The counter this sheet was printed from. */
  backHref: string;
  paper: PrintSheetPaper;
  /** The shop's display face. */
  brandDisplayFont: BrandDisplayFontCode | null;
  backLabel: string;
  printLabel: string;
  /** What `AutoPrint` waits for; see `PACKET_READY_SELECTOR`. */
  readySelector?: string;
  /** Opens the print dialog on arrival; `false` when the door did not say Print. */
  autoPrint?: boolean;
  /** One more screen-only door beside Back and Print. */
  doors?: ReactNode;
  /** The screen's own work above the sheet: a ticket's notices and acts. Never printed. */
  screen?: ReactNode;
  /**
   * **The sheets reach paper and never the screen**, which shows this
   * instead. The medical-alerts packet only (layer 4 security review, note 1):
   * an alert's words are for the sheet in the crew's hands, never for a tablet
   * left open after the print dialog closes.
   */
  printOnly?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {/* A closed list of `size` values, built from the route's own paper by
          `printSheetPageRule` — never a request value. */}
      <style data-print-sheet="">{printSheetPageRule(paper)}</style>
      <BrandStyle brandColor={null} brandDisplayFont={brandDisplayFont} />
      {autoPrint ? <AutoPrint readySelector={readySelector} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 print:hidden">
        <Link href={backHref} className={buttonClass({ variant: "ghost", size: "sm" })}>
          {backLabel}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {doors}
          <PrintButton label={printLabel} />
        </div>
      </div>
      {screen ? (
        <div
          className="mx-auto flex flex-col gap-6 px-4 py-3 print:hidden"
          style={{ maxWidth: `calc(${PRINT_SHEET_BOX_MM[paper].width}mm + 2rem)` }}
        >
          {screen}
        </div>
      ) : null}
      {printOnly ? <div className="px-4 py-3 print:hidden">{printOnly}</div> : null}
      {/* `data-paper-print-only`, not Tailwind's `hidden`: the frame's own
          rule sits outside every cascade layer and would beat a utility, so
          the screen-side hide is an unlayered rule too (`globals.css`). */}
      <div className="paper-sheet-frame" data-paper-print-only={printOnly ? "" : undefined}>
        <div>{children}</div>
      </div>
    </>
  );
}
