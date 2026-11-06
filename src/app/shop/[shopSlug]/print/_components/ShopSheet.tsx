import type { ReactNode } from "react";
import { PaperSheet, SheetMark } from "@/components/paper/PaperSheet";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateWithYear, formatTimeTz } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { type PrintSheetPaper, storefrontAddress } from "@/lib/print-sheets";

/**
 * The fold line's left half: when the sheet came out of the printer, in the
 * shop's zone, the zone named.
 */
export function sheetPrinted(
  t: StaffTranslator,
  at: Date,
  locale: string,
  timeZone: string,
): string {
  return t("print.sheet.printed", {
    date: `${formatDateWithYear(at, locale, timeZone)} · ${formatTimeTz(at, locale, timeZone)}`,
  });
}

/**
 * **One sheet of the shop's paper with the shop's own head and foot** (issue
 * #2745): the band with the shop's mark and name, and the sheet's own name at
 * its far end when it has one ("Manifest", "Rental", "Claim tag"); the fold
 * line with the print time and the storefront's address. What sits between
 * is the caller's, and holds no control.
 */
export function ShopSheet({
  shop,
  shopSlug,
  paper,
  name,
  printed,
  children,
}: {
  shop: { name: string; brandColor: string | null };
  shopSlug: string;
  paper: PrintSheetPaper;
  /** What this sheet is, at the band's far end. */
  name?: string;
  /** The fold line's left half; see {@link sheetPrinted}. */
  printed: string;
  children: ReactNode;
}) {
  return (
    <PaperSheet
      paper={paper}
      band={
        <>
          <SheetMark name={shop.name} size="sm" />
          <span className="font-brand-display text-sm font-bold">{shop.name}</span>
          {name ? <span className="ms-auto text-sm font-semibold">{name}</span> : null}
        </>
      }
      foldLeft={printed}
      foldRight={storefrontAddress(shopSlug, publicAppUrl())}
    >
      {children}
    </PaperSheet>
  );
}
