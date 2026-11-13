import type { Metadata } from "next";
import Link from "next/link";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { requireShopSurface } from "@/features/session";
import {
  canPersonManageWaiverTemplates,
  getSignedRecordsPage,
  signedRecordViewParam,
} from "@/features/waivers-page";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { SignedRecordsSection } from "./_components/SignedRecordsSection";

export const instant = true;

export const metadata: Metadata = {
  title: "Signed waivers — DiveDay",
};

/**
 * **Who has signed: the signed records, read in Divers** (Aaron, 2026-11-13).
 * Writing the release and the course forms is setup and lives in Settings
 * (`settings/waivers/page.tsx`); this page is only the evidence trail, found by
 * a diver's name, email or phone, or by the two views a reviewer goes looking
 * for.
 *
 * Security-sensitive: staff read access to signed, medical-adjacent records,
 * behind `canPersonManageWaiverTemplates`, scoped to the shop the *session*
 * resolved. A `record` id copied from another shop resolves to nothing, and a
 * malformed one is simply no pin (`waiver_records.id` is a `uuid` column).
 */
export default async function SignedWaiversPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ page?: string; record?: string; q?: string; view?: string }>;
}) {
  const { shopSlug } = await params;
  const { page, record: recordParam, q, view: viewParam } = await searchParams;
  const query = q?.trim() ?? "";
  const view = signedRecordViewParam(viewParam);
  const record = uuidParam(recordParam);
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageWaiverTemplates,
    refusal: { notice: "waivers-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const { highlighted, auditPage } = await getSignedRecordsPage(db, shop.id, {
    record,
    page: Number.parseInt(page ?? "", 10),
    query,
    view,
  });

  return (
    <StaffPage width="full">
      <ShopPageHeader
        eyebrow={t("shared.shopSections.divers")}
        title={t("waiversStaff.signedTitle")}
        actions={
          <Link
            href={shopPath(shopSlug, "settings", "waivers")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("waiversStaff.editReleaseLink")}
          </Link>
        }
      />
      <SignedRecordsSection
        auditPage={auditPage}
        pinned={highlighted}
        query={query}
        view={view}
        record={record}
        shopSlug={shopSlug}
        locale={locale}
        timezone={shop.timezone}
        t={t}
      />
    </StaffPage>
  );
}
