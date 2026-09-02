import { EmptyState } from "@/components/EmptyState";
import { Pager } from "@/components/Pager";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
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
    // No `mt-*`: the page stacks its two halves in `space-y-10`, and a card
    // carries no outer margin (docs/design/forms-and-controls.md).
    <section id="backups" className="scroll-mt-8">
      <h2 className={SECTION_TITLE_CLASS}>{t("backup.title")}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{t("backup.description")}</p>

      {/* The cards under this group are a stack within one section, not a run
          of sections — so they take the tighter list gap, and their headings
          step down to `h3` so the group above them still reads as their
          parent. */}
      <div className="mt-4 space-y-6">
        <SectionCard
          padding="lg"
          titleAs="h3"
          title={
            destination
              ? t("backup.status.configuredHeading")
              : t("backup.status.notConfiguredHeading")
          }
          actions={
            destination ? (
              <Badge tone={destination.verifiedAt ? "success" : "neutral"}>
                {destination.verifiedAt ? t("backup.status.verified") : t("backup.status.unproven")}
              </Badge>
            ) : null
          }
        >
          {destination ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
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
            <p className="text-sm text-muted">{t("backup.status.notConfiguredDescription")}</p>
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
        </SectionCard>

        <SectionCard
          padding="lg"
          titleAs="h3"
          title={t("backup.form.heading")}
          description={t("backup.form.description")}
        >
          <FieldGrid as="form" action={saveBackupDestinationAction} columns={2}>
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
            <Field label={t("backup.form.prefixLabel")} hint={t("backup.form.optionalHint")}>
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
        </SectionCard>

        <SectionCard padding="lg" titleAs="h3" title={t("backup.how.heading")}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>{t("backup.how.weekly")}</li>
            <li>{t("backup.how.contents")}</li>
            <li>{t("backup.how.failures")}</li>
          </ul>
        </SectionCard>

        <SectionCard padding="lg" titleAs="h3" title={t("backup.history.heading")}>
          {deliveries.total === 0 ? (
            // `icon={false}`: this sits inside the history card, under its own
            // `<h3>` — the bubbles belong to a page-level rest state, not to a
            // panel nested two boxes deep.
            <EmptyState title={t("backup.history.empty")} icon={false} />
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

                The fold is done by *reflowing* the row, not by rendering it
                twice. Below `sm` the `<tr>` becomes a wrapping flex line and the
                date and details cells claim a full line each, so the reading
                order is: date, then run/outcome/size together, then the reason.
                Every value exists exactly once in the DOM.
                The first draft did render both arrangements and hid one with
                `hidden`, which is the orders index's pattern — and it was wrong
                here: two copies of the same text made `getByText` inside a row
                ambiguous (`e2e/backup-export.spec.ts` failed on a strict-mode
                violation), and it doubled the DOM of a paged list for no gain.
                A layout switch belongs in CSS. */}
              {/* `flush` inside this card — no card-on-card shadow or second
                bg-surface; a thin border stays as the boundary of the grid,
                the same nested-table treatment as the import preview. */}
              <Table flush shellClassName="rounded-inset border border-border">
                {/* Below `sm` the rows are self-describing stacks rather than a
                  grid, so a lone "When" heading over them would be noise. */}
                <THead className="hidden sm:table-header-group">
                  <Th>{t("backup.history.when")}</Th>
                  <Th>{t("backup.history.kind")}</Th>
                  <Th>{t("backup.history.outcome")}</Th>
                  <Th numeric>{t("backup.history.size")}</Th>
                  <Th>{t("backup.history.details")}</Th>
                </THead>
                {/* One DOM, two layouts: below `sm` the tbody reflows to stacked
                  lines (the row owns the padding, `pad={false}` on every cell)
                  so the Details sentence — where a *failed* delivery says why —
                  is on screen without a guessed sideways scroll. Rendering the
                  fold twice instead would duplicate that text in the DOM and
                  break the strict-mode `getByText` in e2e/backup.spec.ts. */}
                <TBody className="block sm:table-row-group">
                  {deliveries.rows.map((delivery) => (
                    <tr
                      key={delivery.id}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 sm:table-row sm:gap-0 sm:p-0"
                    >
                      <Td
                        pad={false}
                        className="basis-full font-medium sm:basis-auto sm:px-4 sm:py-3 sm:font-normal sm:whitespace-nowrap"
                      >
                        {formatDateTimeTz(delivery.startedAt, locale, timeZone)}
                      </Td>
                      <Td pad={false} className="text-muted sm:px-4 sm:py-3 sm:text-foreground">
                        {delivery.trigger === "scheduled"
                          ? t("backup.history.trigger.scheduled")
                          : t("backup.history.trigger.manual")}
                      </Td>
                      <Td pad={false} className="sm:px-4 sm:py-3">
                        <Badge tone={STATUS_TONE[delivery.status]}>
                          {statusText(t, delivery.status)}
                        </Badge>
                      </Td>
                      <Td
                        pad={false}
                        className="text-muted tabular-nums sm:px-4 sm:py-3 sm:text-right sm:whitespace-nowrap sm:text-foreground"
                      >
                        {delivery.byteCount === null
                          ? "—"
                          : formatByteSize(delivery.byteCount, locale)}
                      </Td>
                      {/* Its own line below `sm`: this is the cell a shop came
                        for on a failed row, and it is a sentence, not a chip. */}
                      <Td pad={false} muted className="basis-full sm:basis-auto sm:px-4 sm:py-3">
                        {delivery.status === "failed" ? (
                          deliveryErrorText(t, delivery.errorCode)
                        ) : delivery.objectKey ? (
                          <span className="font-mono text-xs break-all">{delivery.objectKey}</span>
                        ) : (
                          "—"
                        )}
                      </Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
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
        </SectionCard>

        {destination ? (
          <SectionCard
            padding="lg"
            titleAs="h3"
            title={t("backup.disconnect.heading")}
            description={t("backup.disconnect.description")}
          >
            <form action={disconnectBackupAction}>
              <SubmitButton
                pendingLabel={t("backup.disconnect.submitting")}
                className={buttonClass({ variant: "danger" })}
              >
                {t("backup.disconnect.submit")}
              </SubmitButton>
            </form>
          </SectionCard>
        ) : null}
      </div>
    </section>
  );
}
