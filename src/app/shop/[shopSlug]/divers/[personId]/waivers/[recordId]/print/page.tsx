import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireShopSurface } from "@/features/session";
import { getSignedWaiverPage } from "@/features/signed-waiver-page";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { SheetDocument } from "../../../../../print/_components/SheetDocument";
import { ShopSheet, sheetPrinted } from "../../../../../print/_components/ShopSheet";
import { SignedWaiverPaper } from "../_components/SignedWaiverPaper";

export const instant = true;

export const metadata: Metadata = {
  title: "Signed waiver — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * **A signed release, printed** (issue #4142): one sheet of the shop's paper,
 * run to as many pages as the release takes, for a shop that hands an insurer
 * or a diver the release on paper. It reads what the record's screen reads
 * (`getSignedWaiverPage`), with the same walls, and its door said Print, so
 * the dialog opens on arrival.
 */
export default async function SignedWaiverSheetPage({
  params,
}: {
  params: Promise<{ shopSlug: string; personId: string; recordId: string }>;
}) {
  const { shopSlug, personId, recordId } = await params;
  if (!uuidParam(personId) || !uuidParam(recordId)) notFound();
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const record = await getSignedWaiverPage(db, shop.id, personId, recordId, session.user.personId);
  if (!record) notFound();
  return (
    <SheetDocument
      backHref={shopPath(shopSlug, "divers", personId, "waivers", recordId)}
      paper={PACKET_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("waiversStaff.record.title")}
      printLabel={t("waiversStaff.record.print")}
    >
      <ShopSheet
        paper={PACKET_PAPER}
        shop={shop}
        shopSlug={shopSlug}
        name={t("waiversStaff.record.title")}
        printed={sheetPrinted(t, nowDate(), locale, shop.timezone)}
      >
        <SignedWaiverPaper record={record} locale={locale} timezone={shop.timezone} t={t} />
      </ShopSheet>
    </SheetDocument>
  );
}
