import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { canPersonExportShopData, loadShopExportCounts } from "@/db/export";
import { getShopById } from "@/db/shops";
import { getShopBackupDestination, listBackupDeliveries } from "@/features/backup-export";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireStaffSession } from "@/lib/session";
import { BackupsSection, deliveryErrorText } from "./_components/BackupsSection";
import { DownloadExportButton } from "./DownloadExportButton";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English (ADR 20260729-diver-copy-localization). */
export const metadata: Metadata = { title: "Data export — DiveDay" };

const PAGE_SIZE = 10;

const NOTICE_TONE = {
  saved: "success",
  disconnected: "success",
  test_delivered: "success",
  test_failed: "danger",
  invalid: "danger",
  endpoint_invalid: "danger",
  endpoint_not_https: "danger",
  endpoint_private_host: "danger",
  secret_required: "danger",
  encryption_key_unset: "danger",
  encryption_key_invalid: "danger",
  no_destination: "danger",
} as const;

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
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; reason?: string; page?: string }>;
}) {
  const session = await requireStaffSession();
  const db = await getDb();

  // ORDER IS LOAD-BEARING: the gate is awaited to completion, alone, before a
  // single one of this page's reads is *started*. Checked against the
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
  if (!(await canPersonExportShopData(db, session.user.shopId, session.user.personId))) {
    redirect(`/shop/${session.user.shopSlug}?notice=export_not_authorized`);
  }

  // `searchParams` is not a database read, and `page` is needed to ask for the
  // right slice of history below.
  const { notice, reason, page } = await searchParams;

  // Four independent reads, none of which depends on another's result. Serial,
  // they were four round trips deep on a page whose whole job is to answer one
  // question.
  const [shop, families, destination, deliveries] = await Promise.all([
    getShopById(db, session.user.shopId),
    loadShopExportCounts(db, session.user.shopId),
    getShopBackupDestination(db, session.user.shopId),
    listBackupDeliveries(db, session.user.shopId, {
      page: Number(page) || 1,
      pageSize: PAGE_SIZE,
    }),
  ]);
  if (!shop) redirect("/");

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const banner = noticeFrom(notice);

  const basePath = `/shop/${session.user.shopSlug}/settings/export`;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("settings.export.eyebrow")}
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
          {banner === "test_failed"
            ? t("backup.notice.test_failed", { reason: deliveryErrorText(t, reason ?? null) })
            : t(`backup.notice.${banner}`)}
        </p>
      ) : null}

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">{t("settings.export.bundle.heading")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
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
              className="flex items-baseline justify-between gap-3 rounded-xl bg-surface-sunken px-4 py-3"
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
      </section>

      <BackupsSection
        t={t}
        locale={locale}
        timeZone={shop.timezone}
        destination={destination}
        deliveries={deliveries}
        basePath={basePath}
      />
    </main>
  );
}
