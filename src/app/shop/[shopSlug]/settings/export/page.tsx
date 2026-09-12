import type { Metadata } from "next";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field } from "@/components/ui/form";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { canPersonExportShopData, loadShopExportCounts } from "@/db/export";
import { PAGE_SIZE } from "@/db/paging";
import {
  getShopBackupDestination,
  listBackupDeliveries,
  type SaveBackupDestinationRefusal,
} from "@/features/backup-export";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { addMonths, type MonthRef, monthKey, monthLabel } from "@/lib/calendar";
import { nowDate } from "@/lib/clock";
import { requireShopSurface } from "@/lib/session";
import type { NoticeCodeOf, NoticeTone } from "@/lib/staff-notices";
import { utcToWallTime } from "@/lib/zoned";
import { BackupsSection, deliveryErrorText } from "./_components/BackupsSection";
import type { Notice } from "./actions";
import { DownloadExportButton } from "./DownloadExportButton";

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

const DELIVERY_PAGE_SIZE = PAGE_SIZE.section;

// Every key here is also a `backup.notice.<code>` key in the staff bundle —
// the banner below looks the words up by the code itself — so the two are
// renamed together or the banner renders nothing (src/lib/staff-notices.ts).
//
// The `satisfies` is what makes a missing tone a `pnpm typecheck` failure
// rather than a silent no-banner: `NoticeCodeOf` is the kebab spelling of the
// action's own `Notice` union plus `SaveBackupDestinationRefusal`, the
// snake_case refusal the feature module answers with, which reaches here
// normalised. Both halves of the drift are compile errors now — a code with no
// tone, and a tone for a code nothing can emit (issue #1782).
const NOTICE_TONE = {
  saved: "success",
  disconnected: "success",
  "test-delivered": "success",
  "test-failed": "danger",
  invalid: "danger",
  "endpoint-invalid": "danger",
  "endpoint-not-https": "danger",
  "endpoint-private-host": "danger",
  "secret-required": "danger",
  "encryption-key-unset": "danger",
  "encryption-key-invalid": "danger",
  "no-destination": "danger",
} as const satisfies Record<NoticeCodeOf<Notice | SaveBackupDestinationRefusal>, NoticeTone>;

type NoticeCode = keyof typeof NOTICE_TONE;

function noticeFrom(value: string | undefined): NoticeCode | null {
  return value && value in NOTICE_TONE ? (value as NoticeCode) : null;
}

/**
 * The one "your data leaves with you" surface (ADR 20260806-one-data-out-surface),
 * in two halves:
 *
 * - **Download now** — one button, the whole shop as documented CSVs (ADR
 *   20260722-full-shop-export). The file list comes from the same definitions
 *   as the bundle's README, so what we promise on screen is exactly what the
 *   ZIP contains; only row counts are queried here, never the rows.
 * - **Backups** — the same bundle, weekly, to storage the shop owns (ADR
 *   20260804-shop-owned-backup-export), rendered by `_components/BackupsSection.tsx`.
 *   Not a second feature: `run-backup.ts` builds it from
 *   `loadShopExportBundleInput`, the export loader.
 *
 * They were two routes until they weren't: same question ("how do I get my
 * data out?"), same bundle, and the same owner/manager gate —
 * `canPersonExportShopData`, checked once here for both halves, against the
 * database rather than the JWT. `/settings/backup` is a 308 to this page.
 *
 * The download endpoint stays at `settings/export/download`: it re-runs the
 * same gate itself, because a capability URL is never protected by the page
 * that links it.
 */
export default async function DataOutSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; reason?: string; page?: string }>;
}) {
  const { shopSlug } = await params;

  // ORDER IS LOAD-BEARING: the gate is awaited to completion, alone, before a
  // single one of this page's own reads is *started*. Checked against the
  // database, not the JWT — see the download route. Bounced to Today with an
  // explanatory notice rather than teleporting silently (task 82, UX persona
  // 11 "Kai") — Today already renders `shopHome.notice.*` codes.
  //
  // Do not fold this await into the `Promise.all` below to save a round trip.
  // `redirect()` throws, which unwinds this render — but a load hoisted above
  // or alongside the check would already be in flight, so an unauthorized
  // caller's request would touch the roster, the delivery ledger, and the
  // shop's storage credentials before the refusal landed. Everything that
  // follows the gate is fair game to parallelize; the gate itself is not.
  //
  // The one read `requireShopSurface` necessarily performs *ahead* of the gate
  // is the shop row itself — the tenant the gate is scoped to, and nothing this
  // page displays on its own.
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonExportShopData,
    refusal: { notice: "export-not-authorized" },
  });

  // `searchParams` is not a database read, and `page` is needed to ask for the
  // right slice of history below.
  const { notice, reason, page } = await searchParams;

  // Three independent reads, none of which depends on another's result. Serial,
  // they were three round trips deep on a page whose whole job is to answer one
  // question.
  const [families, destination, deliveries] = await Promise.all([
    loadShopExportCounts(db, session.user.shopId),
    getShopBackupDestination(db, session.user.shopId),
    listBackupDeliveries(db, session.user.shopId, {
      page: Number(page) || 1,
      pageSize: DELIVERY_PAGE_SIZE,
    }),
  ]);

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const banner = noticeFrom(notice);

  const basePath = `/shop/${session.user.shopSlug}/settings/export`;

  // The twelve months back from the shop's own current one — a bookkeeper
  // closes last month, and nobody reconciles a year and a half ago from here.
  // Read through `utcToWallTime` so a shop in Key Largo on the 1st at 01:00
  // sees the month it is actually in rather than the UTC one.
  const nowWall = utcToWallTime(nowDate(), shop.timezone);
  const thisMonth: MonthRef = { year: nowWall.year, month: nowWall.month };
  const crewSheetMonths = Array.from({ length: 12 }, (_, back) => addMonths(thisMonth, -back));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("settings.export.eyebrow")}
        eyebrowHref={`/shop/${session.user.shopSlug}/settings`}
        title={t("settings.export.title")}
        description={t("settings.export.description")}
        actions={
          <DownloadExportButton
            href={`${basePath}/download`}
            idleLabel={t("settings.export.downloadButton.idle")}
            acknowledgedLabel={t("settings.export.downloadButton.acknowledged")}
          />
        }
      />

      {/* Page-level on purpose, even though every code below is a backup-form
          outcome: the form that produced it sits far down a long page, and a
          server redirect lands the reader back at the top. Same tone→role rule
          as `noticeRole` in src/lib/staff-notices.ts — a refused destination is
          a refusal and has to interrupt, not murmur as an ambient `status`. */}
      {banner ? (
        <p
          className={`mb-6 rounded-lg border p-3 text-sm ${
            NOTICE_TONE[banner] === "success"
              ? "border-success/40 bg-success/10 text-foreground"
              : "border-danger/40 bg-danger/10 text-foreground"
          }`}
          role={NOTICE_TONE[banner] === "danger" ? "alert" : "status"}
        >
          {banner === "test-failed"
            ? t("backup.notice.test-failed", { reason: deliveryErrorText(t, reason ?? null) })
            : t(`backup.notice.${banner}`)}
        </p>
      ) : null}

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
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden sm:p-6">
            <div className="min-w-0">
              <h2 className={SECTION_TITLE_CLASS}>{t("settings.export.bundle.heading")}</h2>
              <p className="mt-1 max-w-2xl text-sm text-muted">
                {t("settings.export.bundle.fileCount", { count: (families ?? []).length })}
              </p>
            </div>
            <DisclosureCaret className="size-4 text-muted group-open/bundle:rotate-90" />
          </summary>
          <div className="border-t border-border p-5 sm:p-6">
            <p className="max-w-2xl text-sm text-muted">
              {t("settings.export.bundle.description")}
            </p>
            {/* `items-start`: these notes range from one line to fifteen, and grid's
              default stretch made every short card as tall as the essay beside it
              — `shop.csv`, a single sentence, rendered as a 300px box of empty
              grey. Let each card be its own height and put the slack between the
              rows instead. */}
            <ul className="mt-4 grid items-start gap-2 sm:grid-cols-2">
              {(families ?? []).map((family) => (
                <li
                  key={family.file}
                  className="flex items-baseline justify-between gap-3 rounded-inset bg-surface-sunken px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm break-all text-foreground">{family.file}</p>
                    <p className="mt-0.5 text-xs text-muted">{family.note}</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-muted tabular-nums">
                    {t("settings.export.rowCount", { count: family.count })}
                  </span>
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
            same owner/manager gate as the bundle above it, on the one "your
            data leaves with you" surface (ADR 20260806-one-data-out-surface).
            A plain GET form: the month is a path the browser navigates to, so
            the download needs no client component and no popup. */}
        <SectionCard>
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

        <BackupsSection
          t={t}
          locale={locale}
          timeZone={shop.timezone}
          destination={destination}
          deliveries={deliveries}
          basePath={basePath}
        />
      </div>
    </main>
  );
}
