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
import { restoreDiveSitesAction } from "./actions";

// See the gear register's copy of this comment (ADR 20260804-instant-navigation).
export const instant = true;

export const metadata: Metadata = { title: "Restore dive sites — DiveDay" };

/**
 * Kebab, because `noticeUrl` writes kebab: `noticeCode` lowercases the value
 * and replaces every `_`, so a map keyed on the parser's own `unknown_columns`
 * matches nothing and renders no banner at all — which looks exactly like the
 * import having silently worked. `noticeCode`'s own docblock names that as the
 * failure it cannot grep for, and the sibling gear importer was carrying it.
 */
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  "import-empty": { tone: "danger", key: "diveSites.notice.importEmpty" },
  "import-unknown-columns": { tone: "danger", key: "diveSites.notice.importUnknownColumns" },
  "import-no-name-column": { tone: "danger", key: "diveSites.notice.importNoNameColumn" },
  "import-file-empty": { tone: "danger", key: "diveSites.notice.importFileEmpty" },
};

/**
 * **The other half of `dive_sites.csv`** (issue #1771). The bundle carried the
 * shop's whole library and three comments around it described a shop exporting
 * and re-importing, while nothing could read one back.
 *
 * In Settings' "Data & integrations" group beside the contacts and gear
 * importers, gated owner/manager like every other bulk-write door there. No
 * template to download, unlike its two neighbours: those read a competitor's
 * file and a template is how a shop knows what to put in it, while the only
 * file this accepts is one DiveDay wrote.
 */
export default async function DiveSiteImportPage({
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
    refusal: { notice: "dive-site-import-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);

  const imported = notice?.match(/^imported-(\d+)-(\d+)-(\d+)-(\d+)$/);
  const banner = noticeFromParam(notice, NOTICES);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("diveSites.import.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("diveSites.import.title")}
        description={t("diveSites.import.description")}
      />

      {imported ? (
        <StaffNoticeBanner tone="success">
          {t("diveSites.notice.imported", {
            updated: imported[1],
            created: imported[2],
            deleted: imported[3],
            skipped: imported[4],
          })}
        </StaffNoticeBanner>
      ) : banner ? (
        <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner>
      ) : null}

      <SectionCard padding="lg" className="mt-8">
        <p className="text-sm text-muted">{t("diveSites.import.help")}</p>
        <p className="mt-3 text-sm text-muted">{t("diveSites.import.notRestored")}</p>
        <form
          action={restoreDiveSitesAction}
          encType="multipart/form-data"
          className="mt-5 flex flex-wrap items-end gap-3"
        >
          <label className="grid gap-1 text-sm font-medium">
            {t("diveSites.import.file")}
            <input
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              className={controlClass}
            />
          </label>
          <SubmitButton
            pendingLabel={t("diveSites.import.pending")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("diveSites.import.submit")}
          </SubmitButton>
        </form>
      </SectionCard>
    </main>
  );
}
