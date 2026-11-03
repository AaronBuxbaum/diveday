import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { AutoPrint } from "@/app/shop/[shopSlug]/trips/[id]/_components/AutoPrint";
import { PrintButton } from "@/components/PrintButton";
import { buttonClass } from "@/components/ui/button";
import { canPersonManageWaiverTemplates, getCurrentWaiverTemplate } from "@/db/waivers";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { questionnaireForJurisdiction } from "@/lib/medical";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
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
 */
export default async function BlankReleasePage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageWaiverTemplates,
    refusal: { notice: "waivers-not-authorized" },
  });
  const current = await getCurrentWaiverTemplate(db, shop.id);
  if (!current) redirect(shopPath(shopSlug, "waivers"));
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  return (
    <StaffPage width="reading">
      <AutoPrint />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={shopPath(shopSlug, "waivers")}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          {t("waiversStaff.title")}
        </Link>
        <PrintButton label={t("waiversStaff.blank.print")} />
      </div>
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
    </StaffPage>
  );
}
