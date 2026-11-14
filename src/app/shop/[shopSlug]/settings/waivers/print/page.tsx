import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canPersonManageWaiverTemplates, getCurrentWaiverTemplate } from "@/db/waivers";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { questionnaireForJurisdiction } from "@/lib/medical";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { shopPath } from "@/lib/staff-notices";
import { SheetDocument } from "../../../print/_components/SheetDocument";
import { ShopSheet, sheetPrinted } from "../../../print/_components/ShopSheet";
import { BlankRelease } from "./BlankRelease";

export const instant = true;

export const metadata: Metadata = {
  title: "Blank release — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * **The current release, blank, for the counter** (issue #2972): what a shop
 * that keeps paper hands a diver, with the version on it so the paper can be
 * matched to the version recorded later (`recordInPersonWaiver`). Same gate as
 * the editor beside it: the release is owner and manager work. A shop with no
 * published release has nothing to print and is sent back to write one.
 *
 * One sheet of the shop's paper (issue #2745), run to as many pages as the
 * release takes; its door said Print, so the dialog opens on arrival.
 */
export default async function BlankReleasePage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const { db, shop, session } = await requireShopSurface(shopSlug, {
    allow: canPersonManageWaiverTemplates,
    refusal: { notice: "waivers-not-authorized" },
  });
  const current = await getCurrentWaiverTemplate(db, shop.id);
  if (!current) redirect(shopPath(shopSlug, "settings", "waivers"));
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  return (
    <SheetDocument
      backHref={shopPath(shopSlug, "settings", "waivers")}
      paper={PACKET_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("waiversStaff.title")}
      printLabel={t("waiversStaff.blank.print")}
    >
      <ShopSheet
        paper={PACKET_PAPER}
        shop={shop}
        shopSlug={shopSlug}
        printed={sheetPrinted(t, nowDate(), locale, shop.timezone, session.user.name)}
      >
        <BlankRelease
          version={current.version}
          body={current.body}
          questionnaire={questionnaireForJurisdiction(shop.jurisdiction)}
          shopQuestions={current.questions}
          copy={{
            version: t.raw("waiversStaff.blank.version") as string,
            medicalHeading: t("waiversStaff.blank.medicalHeading"),
            yes: t("waiversStaff.blank.yes"),
            no: t("waiversStaff.blank.no"),
            followUp: t.raw("waiversStaff.blank.followUp") as string,
            shopHeading: t("waiversStaff.blank.shopHeading", { shop: shop.name }),
            signatureHeading: t("waiversStaff.blank.signatureHeading"),
            printedName: t("waiversStaff.blank.printedName"),
            diverSignature: t("waiversStaff.blank.diverSignature"),
            guardianName: t("waiversStaff.blank.guardianName"),
            guardianSignature: t("waiversStaff.blank.guardianSignature"),
            guardianNote: t("waiversStaff.blank.guardianNote"),
            date: t("waiversStaff.blank.date"),
          }}
        />
      </ShopSheet>
    </SheetDocument>
  );
}
