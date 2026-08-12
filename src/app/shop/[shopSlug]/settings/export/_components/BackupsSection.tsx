import { Pager } from "@/components/Pager";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import type { ShopBackupDelivery } from "@/db/schema";
import type { getShopBackupDestination, listBackupDeliveries } from "@/features/backup-export";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatByteSize, formatDateTimeTz } from "@/lib/format";
import { disconnectBackupAction, saveBackupDestinationAction, testBackupAction } from "../actions";

/**
 * The scheduled half of the one data-out surface (ADR 20260806-one-data-out-surface):
 * status, on-demand test delivery, the destination form, how it works, the
 * delivery history, and disconnect.
 *
 * A server component, colocated under the route that owns it rather than
 * `src/components` — nothing else renders it, and it reaches the three server
 * actions in the sibling `actions.ts` directly. It takes the translator rather
 * than ~40 word props: the staff bundle is server-side only
 * (`src/i18n/staff-messages.ts`), and the "words as props" rule exists for
 * staff *client* components, which cannot read it. Nothing here is
 * interactive beyond plain forms.
 *
 * It deliberately does **not** authorize: the page above it runs
 * `canPersonExportShopData` before this component is ever constructed, and the
 * three actions re-check it themselves on every mutation. A section component
 * is not a gate, and must never be mistaken for one.
 */

/** Rows this section renders as `destination` / `deliveries`, straight off their readers. */
type BackupDestination = Awaited<ReturnType<typeof getShopBackupDestination>>;
type BackupDeliveries = Awaited<ReturnType<typeof listBackupDeliveries>>;

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

/** Exported for the page's own notice banner, which names the same reasons. */
export function deliveryErrorText(t: StaffTranslator, code: string | null): string {
  const key = code ? DELIVERY_ERROR_KEYS[code] : undefined;
  return key ? t(key) : t("backup.deliveryError.unknown");
}

const STATUS_TONE = { succeeded: "success", failed: "danger", started: "neutral" } as const;

function statusText(t: StaffTranslator, status: ShopBackupDelivery["status"]): string {
  if (status === "succeeded") return t("backup.history.status.succeeded");
  if (status === "failed") return t("backup.history.status.failed");
  return t("backup.history.status.started");
}

export function BackupsSection({
  t,
  locale,
  timeZone,
  destination,
  deliveries,
  basePath,
}: {
  t: StaffTranslator;
  locale: string;
  timeZone: string;
  destination: BackupDestination;
  deliveries: BackupDeliveries;
  basePath: string;
}) {
  return (
    // `id`/`scroll-mt` because the settings hub still keeps a "Set up backups"
    // door of its own — one surface, two doors — and it deep-links here rather
    // than to a route of its own. The 308 from `/settings/backup` lands here too.
    <section id="backups" className="mt-10 scroll-mt-8">
      <h2 className="text-lg font-semibold">{t("backup.title")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t("backup.description")}</p>

      <div className="mt-4 rounded-lg border border-border bg-surface p-6">
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
                  ? formatDateTimeTz(destination.verifiedAt, locale, timeZone)
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
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-6">
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
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h3 className="font-medium">{t("backup.how.heading")}</h3>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>{t("backup.how.weekly")}</li>
          <li>{t("backup.how.contents")}</li>
          <li>{t("backup.how.sealed")}</li>
          <li>{t("backup.how.failures")}</li>
        </ul>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h3 className="font-medium">{t("backup.history.heading")}</h3>
        {deliveries.total === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("backup.history.empty")}</p>
        ) : (
          <>
            {/* Five columns at `sm` and up; one stacked block below it.
                `overflow-x-auto` stays as the desktop-narrow safety net, but it
                cannot be the phone answer: a horizontal scroller nested in a
                vertically-scrolling settings page advertises itself to nobody
                on a phone, and the column it was hiding is Details — where a
                *failed* delivery says why. A shop opens this list precisely to
                find out that last Monday's backup did not land, so that
                sentence has to be on screen without a guessed gesture
                (FU-20260811-backup-delivery-history-clips-on-a-phone).

                The fold is the orders index's pattern (`orders/page.tsx`): one
                set of values, rendered into the date cell below `sm` and into
                their own columns above it, with `hidden` doing the choosing —
                so a screen reader is only ever offered the arrangement that is
                actually on screen. */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                {/* Below `sm` the rows are self-describing stacks rather than a
                    grid, so a lone "When" heading over them would be noise. */}
                <thead className="hidden sm:table-header-group">
                  <tr className="border-b border-border text-left text-xs text-muted uppercase">
                    <th className="py-2 pr-4 font-medium">{t("backup.history.when")}</th>
                    <th className="py-2 pr-4 font-medium">{t("backup.history.kind")}</th>
                    <th className="py-2 pr-4 font-medium">{t("backup.history.outcome")}</th>
                    <th className="py-2 pr-4 font-medium">{t("backup.history.size")}</th>
                    <th className="py-2 font-medium">{t("backup.history.details")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {deliveries.rows.map((delivery) => {
                    const kind =
                      delivery.trigger === "scheduled"
                        ? t("backup.history.trigger.scheduled")
                        : t("backup.history.trigger.manual");
                    const outcome = (
                      <Badge tone={STATUS_TONE[delivery.status]}>
                        {statusText(t, delivery.status)}
                      </Badge>
                    );
                    const size =
                      delivery.byteCount === null
                        ? "—"
                        : formatByteSize(delivery.byteCount, locale);
                    const details =
                      delivery.status === "failed" ? (
                        deliveryErrorText(t, delivery.errorCode)
                      ) : delivery.objectKey ? (
                        <span className="font-mono text-xs break-all">{delivery.objectKey}</span>
                      ) : (
                        "—"
                      );
                    return (
                      <tr key={delivery.id}>
                        <td className="py-2 align-top sm:pr-4 sm:whitespace-nowrap">
                          <span className="font-medium sm:font-normal">
                            {formatDateTimeTz(delivery.startedAt, locale, timeZone)}
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                            {outcome}
                            <span className="text-muted">{kind}</span>
                            <span className="text-muted tabular-nums">{size}</span>
                          </span>
                          <span className="mt-1 block text-muted sm:hidden">{details}</span>
                        </td>
                        <td className="hidden py-2 pr-4 sm:table-cell">{kind}</td>
                        <td className="hidden py-2 pr-4 sm:table-cell">{outcome}</td>
                        <td className="hidden py-2 pr-4 whitespace-nowrap tabular-nums sm:table-cell">
                          {size}
                        </td>
                        <td className="hidden py-2 text-muted sm:table-cell">{details}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* `#backups` on every pager link: paging the delivery history is a
                move *within* this section, and landing back at the top of a long
                page is how a reader loses the row they were reading. */}
            <Pager
              page={deliveries.page}
              pageCount={deliveries.pageCount}
              href={(nextPage) => `${basePath}?page=${nextPage}#backups`}
              t={t}
              total={t("backup.history.total", { count: deliveries.total })}
              className="mt-4"
            />
          </>
        )}
      </div>

      {destination ? (
        <div className="mt-6 rounded-lg border border-border bg-surface p-6">
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
        </div>
      ) : null}
    </section>
  );
}
