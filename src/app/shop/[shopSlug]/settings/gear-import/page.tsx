import type { Metadata } from "next";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass } from "@/components/ui/form";
import { canPersonImportShopData } from "@/db/import";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import { importGearServiceHistoryAction } from "./actions";

// See the gear register's copy of this comment (ADR 20260804-instant-navigation).
export const instant = true;

export const metadata: Metadata = { title: "Import gear history — DiveDay" };

const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  "import-empty": { tone: "danger", key: "gear.notice.importEmpty" },
  "import-no_gear_column": { tone: "danger", key: "gear.notice.importNoGearColumn" },
};

/**
 * Bulk CSV import for the fleet and its dated service records — moved out of
 * the gear register (where it sat beside the day-to-day fleet, unrelated to
 * anything a shop does there most days) and into Settings, beside the
 * sibling contacts importer it mirrors in shape (ADR 20260723-contact-importer).
 * Gated owner/manager, like every other bulk-write door in this group.
 */
export default async function GearImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const { shop } = await requireShopSurface(shopSlug, {
    allow: canPersonImportShopData,
    refusal: { notice: "gear-import-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const importedMatch = notice?.match(/^imported-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$/);
  const banner = noticeFromParam(notice, NOTICES);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("gear.import.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("gear.import.title")}
        description={t("gear.import.description")}
      />

      {importedMatch ? (
        <StaffNoticeBanner tone="success">
          {t("gear.notice.imported", {
            events: importedMatch[1],
            units: importedMatch[2],
            skipped: importedMatch[3],
            assignments: importedMatch[4],
            assignmentSkipped: importedMatch[5],
          })}
        </StaffNoticeBanner>
      ) : banner ? (
        <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner>
      ) : null}

      <SectionCard padding="lg" className="mt-8">
        <p className="text-sm text-muted">{t("gear.import.help")}</p>
        <a
          className={buttonClass({ variant: "secondary", className: "mt-4" })}
          href="/diveday-gear-service-import-template.csv"
          download
        >
          {t("gear.import.downloadTemplate")}
        </a>
        <form
          action={importGearServiceHistoryAction}
          encType="multipart/form-data"
          className="mt-5 flex flex-wrap items-end gap-3"
        >
          <label className="grid gap-1 text-sm font-medium">
            {t("gear.import.file")}
            <input
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              className={controlClass}
            />
          </label>
          <SubmitButton
            pendingLabel={t("gear.import.pending")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("gear.import.submit")}
          </SubmitButton>
        </form>
      </SectionCard>
    </main>
  );
}
