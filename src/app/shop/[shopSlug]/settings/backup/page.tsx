import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Pager } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { canPersonExportShopData } from "@/db/export";
import type { ShopBackupDelivery } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { getShopBackupDestination, listBackupDeliveries } from "@/features/backup-export";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { formatByteSize, formatDateTimeTz } from "@/lib/format";
import { requireStaffSession } from "@/lib/session";
import { disconnectBackupAction, saveBackupDestinationAction, testBackupAction } from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English (ADR 20260729-diver-copy-localization). */
export const metadata: Metadata = { title: "Backups — DiveDay" };

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
 * Every code a delivery row (or the test-run notice) can carry, mapped to its
 * words. A closed set on purpose: `reason` arrives via the URL, and anything
 * outside this map renders as the generic failure line rather than echoing.
 */
const DELIVERY_ERROR_KEYS: Record<string, StaffMessageKey> = {
  upload_unauthorized: "backup.deliveryError.upload_unauthorized",
  bucket_not_found: "backup.deliveryError.bucket_not_found",
  upload_rejected: "backup.deliveryError.upload_rejected",
  network_unreachable: "backup.deliveryError.network_unreachable",
  credential_unreadable: "backup.deliveryError.credential_unreadable",
  shop_missing: "backup.deliveryError.shop_missing",
  bundle_failed: "backup.deliveryError.bundle_failed",
  encryption_key_unset: "backup.deliveryError.encryption_key_unset",
  encryption_key_invalid: "backup.deliveryError.encryption_key_invalid",
};

function deliveryErrorText(t: StaffTranslator, code: string | null): string {
  const key = code ? DELIVERY_ERROR_KEYS[code] : undefined;
  return key ? t(key) : t("backup.deliveryError.unknown");
}

const STATUS_TONE = { succeeded: "success", failed: "danger", started: "neutral" } as const;

function statusText(t: StaffTranslator, status: ShopBackupDelivery["status"]): string {
  if (status === "succeeded") return t("backup.history.status.succeeded");
  if (status === "failed") return t("backup.history.status.failed");
  return t("backup.history.status.started");
}

/**
 * Where a shop points its weekly backup at storage it owns (docs ADR
 * 20260804-shop-owned-backup-export). The other half of the export page's
 * promise: "your data is yours" should not require remembering to click
 * download — every week the full bundle (trips.ics riding along) lands in the
 * shop's own bucket, under a credential DiveDay stores sealed and never shows
 * back.
 */
export default async function BackupSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; reason?: string; page?: string }>;
}) {
  const session = await requireStaffSession();
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect("/");

  // Same bar as the export download, re-checked against live roles: this page
  // configures a continuous export of the whole shop, medical evidence included.
  if (!(await canPersonExportShopData(db, session.user.shopId, session.user.personId))) {
    redirect(`/shop/${session.user.shopSlug}?notice=backup_not_authorized`);
  }

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const { notice, reason, page } = await searchParams;
  const banner = noticeFrom(notice);

  const destination = await getShopBackupDestination(db, session.user.shopId);
  const deliveries = await listBackupDeliveries(db, session.user.shopId, {
    page: Number(page) || 1,
    pageSize: PAGE_SIZE,
  });

  const basePath = `/shop/${session.user.shopSlug}/settings/backup`;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("backup.eyebrow")}
        title={t("backup.title")}
        description={t("backup.description")}
        actions={
          <Link
            href={`/shop/${session.user.shopSlug}/settings`}
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            {t("settings.main.backToSettings")}
          </Link>
        }
      />

      {banner ? (
        <p
          className={`mb-6 rounded-lg border p-3 text-sm ${
            NOTICE_TONE[banner] === "success"
              ? "border-success/40 bg-success/10 text-foreground"
              : "border-danger/40 bg-danger/10 text-foreground"
          }`}
          role="status"
        >
          {banner === "test_failed"
            ? t("backup.notice.test_failed", { reason: deliveryErrorText(t, reason ?? null) })
            : t(`backup.notice.${banner}`)}
        </p>
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">
            {destination
              ? t("backup.status.configuredHeading")
              : t("backup.status.notConfiguredHeading")}
          </h3>
          {destination ? (
            <Badge tone={destination.verifiedAt ? "success" : "neutral"}>
              {destination.verifiedAt ? t("backup.status.verified") : t("backup.status.unproven")}
            </Badge>
          ) : null}
        </div>

        {destination ? (
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">{t("backup.status.endpoint")}</dt>
              <dd className="break-all">{destination.endpoint}</dd>
            </div>
            <div>
              <dt className="text-muted">{t("backup.status.bucket")}</dt>
              <dd className="break-all">
                {destination.prefix
                  ? `${destination.bucket}/${destination.prefix}`
                  : destination.bucket}
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t("backup.status.accessKeyId")}</dt>
              <dd className="break-all">{destination.accessKeyId}</dd>
            </div>
            <div>
              <dt className="text-muted">{t("backup.status.lastDelivered")}</dt>
              <dd>
                {destination.verifiedAt
                  ? formatDateTimeTz(destination.verifiedAt, locale, shop.timezone)
                  : t("backup.status.never")}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted">{t("backup.status.notConfiguredDescription")}</p>
        )}

        {destination ? (
          <form action={testBackupAction} className="mt-5">
            <SubmitButton
              pendingLabel={t("backup.test.submitting")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("backup.test.submit")}
            </SubmitButton>
          </form>
        ) : null}
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h3 className="font-medium">{t("backup.form.heading")}</h3>
        <p className="mt-1 text-sm text-muted">{t("backup.form.description")}</p>
        <FieldGrid as="form" action={saveBackupDestinationAction} columns={2} className="mt-4">
          <Field
            label={t("backup.form.endpointLabel")}
            description={t("backup.form.endpointHint")}
            className="sm:col-span-2"
          >
            <input
              name="endpoint"
              type="url"
              required
              maxLength={500}
              defaultValue={destination?.endpoint ?? ""}
              placeholder="https://accountid.r2.cloudflarestorage.com"
              className={controlClass}
            />
          </Field>
          <Field label={t("backup.form.regionLabel")} description={t("backup.form.regionHint")}>
            <input
              name="region"
              required
              maxLength={100}
              defaultValue={destination?.region ?? ""}
              placeholder="auto"
              className={controlClass}
            />
          </Field>
          <Field label={t("backup.form.bucketLabel")}>
            <input
              name="bucket"
              required
              maxLength={200}
              defaultValue={destination?.bucket ?? ""}
              placeholder="dive-shop-backups"
              className={controlClass}
            />
          </Field>
          <Field
            label={t("backup.form.prefixLabel")}
            hint={t("backup.form.optionalHint")}
            description={t("backup.form.prefixHint")}
          >
            <input
              name="prefix"
              maxLength={200}
              defaultValue={destination?.prefix ?? ""}
              placeholder="diveday"
              className={controlClass}
            />
          </Field>
          <Field label={t("backup.form.accessKeyIdLabel")}>
            <input
              name="accessKeyId"
              required
              maxLength={200}
              autoComplete="off"
              defaultValue={destination?.accessKeyId ?? ""}
              className={controlClass}
            />
          </Field>
          {/* Write-only, deliberately: no defaultValue, ever. The stored secret
              is sealed and there is no code path that could put it back into
              this page — blank on an update means "keep what is stored". */}
          <Field
            label={t("backup.form.secretLabel")}
            description={
              destination ? t("backup.form.secretKeepHint") : t("backup.form.secretHint")
            }
            className="sm:col-span-2"
          >
            <input
              name="secretAccessKey"
              type="password"
              maxLength={500}
              autoComplete="new-password"
              className={controlClass}
            />
          </Field>
          <FieldActions>
            <SubmitButton pendingLabel={t("backup.form.submitting")} className={buttonClass()}>
              {t("backup.form.submit")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h3 className="font-medium">{t("backup.how.heading")}</h3>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>{t("backup.how.weekly")}</li>
          <li>{t("backup.how.contents")}</li>
          <li>{t("backup.how.sealed")}</li>
          <li>{t("backup.how.failures")}</li>
        </ul>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h3 className="font-medium">{t("backup.history.heading")}</h3>
        {deliveries.total === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("backup.history.empty")}</p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted uppercase">
                    <th className="py-2 pr-4 font-medium">{t("backup.history.when")}</th>
                    <th className="py-2 pr-4 font-medium">{t("backup.history.kind")}</th>
                    <th className="py-2 pr-4 font-medium">{t("backup.history.outcome")}</th>
                    <th className="py-2 pr-4 font-medium">{t("backup.history.size")}</th>
                    <th className="py-2 font-medium">{t("backup.history.details")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {deliveries.rows.map((delivery) => (
                    <tr key={delivery.id}>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {formatDateTimeTz(delivery.startedAt, locale, shop.timezone)}
                      </td>
                      <td className="py-2 pr-4">
                        {delivery.trigger === "scheduled"
                          ? t("backup.history.trigger.scheduled")
                          : t("backup.history.trigger.manual")}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge tone={STATUS_TONE[delivery.status]}>
                          {statusText(t, delivery.status)}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap tabular-nums">
                        {delivery.byteCount === null
                          ? "—"
                          : formatByteSize(delivery.byteCount, locale)}
                      </td>
                      <td className="py-2 text-muted">
                        {delivery.status === "failed" ? (
                          deliveryErrorText(t, delivery.errorCode)
                        ) : delivery.objectKey ? (
                          <span className="font-mono text-xs break-all">{delivery.objectKey}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={deliveries.page}
              pageCount={deliveries.pageCount}
              href={(nextPage) => `${basePath}?page=${nextPage}`}
              t={t}
              total={t("backup.history.total", { count: deliveries.total })}
              className="mt-4"
            />
          </>
        )}
      </section>

      {destination ? (
        <section className="mt-6 rounded-lg border border-border bg-surface p-6">
          <h3 className="font-medium">{t("backup.disconnect.heading")}</h3>
          <p className="mt-1 text-sm text-muted">{t("backup.disconnect.description")}</p>
          <form action={disconnectBackupAction} className="mt-4">
            <SubmitButton
              pendingLabel={t("backup.disconnect.submitting")}
              className={buttonClass({ variant: "danger" })}
            >
              {t("backup.disconnect.submit")}
            </SubmitButton>
          </form>
        </section>
      ) : null}
    </main>
  );
}
