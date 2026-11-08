import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  canPersonExportDisputeSheet,
  getDisputeSheet,
  recordDisputeSheetOpened,
} from "@/features/dispute-sheet";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { SheetDocument } from "../../../../print/_components/SheetDocument";
import { ShopSheet, sheetPrinted } from "../../../../print/_components/ShopSheet";
import { DisputeSheetPaper } from "./_components/DisputeSheetPaper";

export const instant = true;

export const metadata: Metadata = {
  title: "Dispute sheet — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * **A seat's dispute sheet** (issue #2390): the order, the release the diver
 * signed, the check-in and every roll-call result on one printable page, for
 * the owner who has to show a card network that the diver came and dived.
 *
 * Owner or manager only, through `requireShopSurface`'s live gate, so a refused
 * staffer lands back on the order with a reason rather than on a blank page.
 * What may appear is decided in `assembleDisputeSheet` (src/features/dispute-sheet/rules.ts)
 * and nowhere here: this page prints the sheet it is handed and reads nothing
 * else about the diver, so it cannot show a medical answer it never receives.
 *
 * One sheet of the shop's paper (issue #2745): what the owner reviews on screen
 * is what the card network receives, and the sheet holds no control.
 */
export default async function DisputeSheetPage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const { shopSlug, id } = await params;
  // An unparseable id names no row; Postgres would raise on it rather than miss.
  const orderId = uuidParam(id);
  if (!orderId) notFound();
  const { db, shop, session } = await requireShopSurface(shopSlug, {
    allow: canPersonExportDisputeSheet,
    refusal: { notice: "dispute-not-authorized", landing: ["orders", orderId] },
  });
  const timezone = shop.timezone ?? "UTC";
  const sheet = await getDisputeSheet(db, shop.id, orderId, shop.name, timezone);
  if (!sheet) notFound();
  await recordDisputeSheetOpened(db, shop.id, orderId, session.user.personId);

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  return (
    <SheetDocument
      backHref={shopPath(shopSlug, "orders", orderId)}
      paper={PACKET_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("disputeSheet.back")}
      printLabel={t("print.sheet.door")}
      // The order's door says "Dispute sheet": the owner reads it before printing.
      autoPrint={false}
    >
      <ShopSheet
        paper={PACKET_PAPER}
        shop={shop}
        shopSlug={shopSlug}
        name={t("disputeSheet.title")}
        printed={sheetPrinted(t, sheet.generatedAt, locale, timezone)}
      >
        <DisputeSheetPaper sheet={sheet} t={t} locale={locale} timezone={timezone} />
      </ShopSheet>
    </SheetDocument>
  );
}
