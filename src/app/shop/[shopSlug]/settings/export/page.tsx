import type { Metadata } from "next";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { cardSummaryClass, SectionCard } from "@/components/ui/card";
import { SummaryCaret } from "@/components/ui/disclosure";
import { controlClass, Field } from "@/components/ui/form";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { canPersonExportShopData, loadShopExportCounts } from "@/db/export";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { addMonths, type MonthRef, monthKey, monthLabel } from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { requireShopSurface } from "@/lib/session";
import { utcToWallTime } from "@/lib/zoned";
import { DataTabs } from "../_components/DataTabs";
import { settingsPaneClass } from "../_components/settings-pane";
import { DownloadExportButton } from "./DownloadExportButton";
import { EXPORT_PURPOSE_KEYS } from "./file-index";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English (ADR 20260729-diver-copy-localization). */
export const metadata: Metadata = { title: "Data export — DiveDay" };

/**
 * **Export**, the first tab of Your data: download the whole shop as documented
 * CSVs, one button (ADR 20260722-full-shop-export). The file list comes from the
 * same definitions as the bundle's README, so what we promise on screen is
 * exactly what the ZIP contains; only row counts are queried here, never the
 * rows. The same bundle goes weekly to storage the shop owns on the Backups tab
 * (`./backups`), behind the same owner/manager gate, `canPersonExportShopData`,
 * checked against the database rather than the JWT.
 *
 * The download endpoint stays at `settings/export/download`: it re-runs the
 * same gate itself, because a capability URL is never protected by the page
 * that links it.
 */
export default async function DataOutSettingsPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;

  // ORDER IS LOAD-BEARING: the gate is awaited to completion, alone, before a
  // single one of this page's own reads is *started*. Checked against the
  // database, not the JWT — see the download route. Bounced to Today with an
  // explanatory notice rather than teleporting silently (task 82, UX persona
  // 11 "Kai") — Today already renders `shopHome.notice.*` codes.
  //
  // Do not hoist a read above or alongside this await: `redirect()` throws,
  // which unwinds this render, but a load already in flight would have touched
  // the roster before the refusal landed.
  //
  // The one read `requireShopSurface` necessarily performs *ahead* of the gate
  // is the shop row itself — the tenant the gate is scoped to, and nothing this
  // page displays on its own.
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonExportShopData,
    refusal: { notice: "export-not-authorized" },
  });

  const families = await loadShopExportCounts(db, session.user.shopId);

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const basePath = `/shop/${session.user.shopSlug}/settings/export`;

  // The twelve months back from the shop's own current one — a bookkeeper
  // closes last month, and nobody reconciles a year and a half ago from here.
  // Read through `utcToWallTime` so a shop in Key Largo on the 1st at 01:00
  // sees the month it is actually in rather than the UTC one.
  const nowWall = utcToWallTime(nowDate(), shop.timezone);
  const thisMonth: MonthRef = { year: nowWall.year, month: nowWall.month };
  const crewSheetMonths = Array.from({ length: 12 }, (_, back) => addMonths(thisMonth, -back));

  return (
    <main className={settingsPaneClass()}>
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${session.user.shopSlug}/settings`}
        title={t("settings.data.title")}
        actions={
          <DownloadExportButton
            href={`${basePath}/download`}
            idleLabel={t("settings.export.downloadButton.idle")}
            acknowledgedLabel={t("settings.export.downloadButton.acknowledged")}
          />
        }
      />

      <DataTabs t={t} shopSlug={session.user.shopSlug} current="export" />

      {/* Collapsed by default. This is the page's *reference*, not its work:
          forty-odd file cards, several of them fifteen lines of prose, ran
          about 5,000px and pushed Backups — a destination a shop actually
          configures — entirely below the fold. The question the page answers
          is "how do I get my data out", and the button above already answers
          it; "exactly which files, with how many rows in each" is the question
          after that, and it waits behind its own summary with the file count
          on the closed row so the reader knows what is in there. */}
      {/* Section rhythm belongs to the page, not to each section: one
          `space-y-10` here, and no `mt-*` on any card
          (docs/design/forms-and-controls.md). */}
      <div className="space-y-10">
        {/* `padding="none"`: the summary and the open body pad themselves, so a
            closed disclosure is one padded row rather than a row inside a box
            of extra space. */}
        <SectionCard as="details" padding="none" className="group/bundle">
          <summary
            className={cardSummaryClass({ className: "min-h-11 justify-between p-5 sm:p-6" })}
          >
            <div className="min-w-0">
              <h2 className={SECTION_TITLE_CLASS}>{t("settings.export.bundle.heading")}</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted">
                {t("settings.export.bundle.fileCount", { count: (families ?? []).length })}
              </p>
            </div>
            <SummaryCaret
              line={`h-lh ${SECTION_TITLE_CLASS}`}
              className="size-4 text-muted group-open/bundle:rotate-90"
            />
          </summary>
          <div className="border-t border-border p-5 sm:p-6">
            <p className="max-w-2xl text-sm text-muted">
              {t("settings.export.bundle.description")}
            </p>
            {/* Every file remains in the index, including zero rows. Its complete
                canonical README note stays copyable inside its own disclosure. */}
            <ul className="mt-4 divide-y divide-border">
              {(families ?? []).map((family) => (
                <li key={family.file}>
                  <details className="group/file">
                    <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-3 py-3 focus-visible:focus-ring-inset">
                      <span className="min-w-0">
                        <span className="block font-mono text-base wrap-anywhere">
                          {family.file}
                        </span>
                        <span className="mt-1 block text-sm text-muted">
                          {t(EXPORT_PURPOSE_KEYS[family.file as keyof typeof EXPORT_PURPOSE_KEYS])}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm text-muted tabular-nums">
                        {t("settings.export.rowCount", { count: family.count })}
                        <SummaryCaret className="ms-2 inline size-3 group-open/file:rotate-90" />
                      </span>
                    </summary>
                    <p className="pb-4 text-sm text-muted">{family.note}</p>
                  </details>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted">
              <span className="font-medium text-foreground">
                {t("settings.export.notIncluded.label")}
              </span>{" "}
              {t.rich("settings.export.notIncluded.text", {
                mono: (chunks) => <code>{chunks}</code>,
              })}
            </p>
          </div>
        </SectionCard>

        {/* **The crew sheet** (N-43): the month a bookkeeper asks for, as one
            CSV. It lives here rather than on Reports because it is data
            leaving the shop — crew names and money — and so belongs behind the
            same owner/manager gate as the bundle above it, on the data-out tab of
            Your data (ADR 20260806-one-data-out-surface).
            A plain GET form: the month is a path the browser navigates to, so
            the download needs no client component and no popup. `lg`, the
            inset of the bundle above it, so the page's headings share one
            left edge. */}
        <SectionCard padding="lg">
          <h2 className={SECTION_TITLE_CLASS}>{t("settings.crewSheet.heading")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t("settings.crewSheet.description")}</p>
          {/* The one sentence that earns its place here: hours and a tips
              column beside a person's name read as a pay run, and this is a
              record of the month rather than a statement of what anyone is
              owed. */}
          <p className="mt-1 max-w-2xl text-sm text-muted">{t("settings.crewSheet.note")}</p>
          <form
            action={`${basePath}/crew-sheet`}
            method="get"
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <Field label={t("settings.crewSheet.monthLabel")} className="w-56">
              <select name="month" defaultValue={monthKey(thisMonth)} className={controlClass}>
                {crewSheetMonths.map((month) => (
                  <option key={monthKey(month)} value={monthKey(month)}>
                    {monthLabel(month, locale)}
                  </option>
                ))}
              </select>
            </Field>
            <button type="submit" className={buttonClass({ variant: "secondary" })}>
              {t("settings.crewSheet.download")}
            </button>
          </form>
        </SectionCard>
      </div>
    </main>
  );
}
