import type { Metadata } from "next";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { canPersonExportShopData } from "@/db/export";
import { PAGE_SIZE } from "@/db/paging";
import {
  getShopBackupDestination,
  listBackupDeliveries,
  type SaveBackupDestinationRefusal,
} from "@/features/backup-export";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { requireShopSurface } from "@/lib/session";
import type { NoticeCodeOf, NoticeTone } from "@/lib/staff-notices";
import { DataTabs } from "../../_components/DataTabs";
import { settingsPaneClass } from "../../_components/settings-pane";
import { BackupsSection, deliveryErrorText } from "../_components/BackupsSection";
import type { Notice } from "../actions";

// See the sibling pages of Your data (ADR 20260804-instant-navigation).
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English (ADR 20260729-diver-copy-localization). */
export const metadata: Metadata = { title: "Backups — DiveDay" };

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
 * **Backups**, the second tab of Your data: the same bundle the Export tab
 * downloads, weekly, to storage the shop owns (ADR 20260804-shop-owned-backup-export),
 * rendered by `../_components/BackupsSection.tsx`. Not a second feature:
 * `run-backup.ts` builds it from `loadShopExportBundleInput`, the export loader.
 * It shares the Export tab's gate, `canPersonExportShopData`, checked against
 * the database rather than the JWT.
 */
export default async function BackupsSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; reason?: string; page?: string }>;
}) {
  const { shopSlug } = await params;

  // ORDER IS LOAD-BEARING: the gate is awaited to completion, alone, before a
  // single one of this page's own reads is *started*. An unauthorized caller's
  // request must not touch the delivery ledger or the shop's storage
  // credentials before the refusal lands. Bounced to Today with an explanatory
  // notice rather than teleporting silently (task 82).
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonExportShopData,
    refusal: { notice: "export-not-authorized" },
  });

  const { notice, reason, page } = await searchParams;

  const [destination, deliveries, latest] = await Promise.all([
    getShopBackupDestination(db, session.user.shopId),
    listBackupDeliveries(db, session.user.shopId, {
      page: Number(page) || 1,
      pageSize: DELIVERY_PAGE_SIZE,
    }),
    listBackupDeliveries(db, session.user.shopId, { page: 1, pageSize: 1 }),
  ]);

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const banner = noticeFrom(notice);

  const basePath = `/shop/${session.user.shopSlug}/settings/export/backups`;

  return (
    <main className={settingsPaneClass()}>
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${session.user.shopSlug}/settings`}
        title={t("settings.data.title")}
      />

      <DataTabs t={t} shopSlug={session.user.shopSlug} current="backups" />

      {/* Page-level on purpose, even though every code below is a backup-form
          outcome: the form that produced it sits far down a long page, and a
          server redirect lands the reader back at the top. Same tone→role rule
          as `noticeRole` in src/lib/staff-notices.ts — a refused destination is
          a refusal and has to interrupt, not murmur as an ambient `status`. */}
      {/* Successful delivery and removal are shown from stored destination/history
          state below, never asserted from a hand-editable notice query. */}
      {banner && banner !== "test-delivered" && banner !== "disconnected" ? (
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

      <BackupsSection
        t={t}
        locale={locale}
        timeZone={shop.timezone}
        destination={destination}
        deliveries={deliveries}
        latestDelivery={latest.rows[0] ?? null}
        expandDestination={Boolean(
          banner && !["test-delivered", "test-failed", "disconnected"].includes(banner),
        )}
        basePath={basePath}
      />
    </main>
  );
}
