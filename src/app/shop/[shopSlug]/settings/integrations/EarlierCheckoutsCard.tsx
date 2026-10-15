import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import type { AppDb } from "@/db/client";
import { previewIntegrationBackfill } from "@/db/integration-backfill";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear } from "@/lib/format";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { sendEarlierCheckoutsAction } from "./actions";
import { BACKFILL_PROVIDERS, backfillSince } from "./earlier-checkouts";

type Row = { id: string; provider: string; status: string; settings: { eventTypes?: string[] } };

/**
 * **"Send earlier checkouts"** (issue #2606, owner only): pick a connected
 * provider and a start day, see how many checkouts, tips and refunds it has
 * never been handed, then confirm. The preview is a plain GET of this page
 * (`?backfill=<integration>&since=<day>`), so nothing is written until the
 * confirm form posts, and the post recomputes what is unsent rather than
 * trusting the numbers shown here.
 */
export async function EarlierCheckoutsCard({
  db,
  shopId,
  timezone,
  locale,
  t,
  integrations,
  backfill,
  since,
  notice,
  count,
}: {
  db: AppDb;
  shopId: string;
  timezone: string;
  locale: string;
  t: StaffTranslator;
  integrations: readonly Row[];
  backfill: string | undefined;
  since: string | undefined;
  /** The `?notice=` and `?count=` this page was opened with. */
  notice: string | undefined;
  count: string | undefined;
}) {
  const choices = integrations.filter(
    (row) =>
      row.status === "connected" &&
      (BACKFILL_PROVIDERS as readonly string[]).includes(row.provider) &&
      (row.settings.eventTypes ?? []).includes("order.paid"),
  );
  if (choices.length === 0) return null;
  const chosen = choices.find((row) => row.id === backfill);
  const from = backfillSince(since, timezone);
  const preview =
    chosen && from
      ? await previewIntegrationBackfill(db, { shopId, integrationId: chosen.id, since: from })
      : null;
  const providerName = (provider: string) =>
    t(`integrations.${provider as (typeof BACKFILL_PROVIDERS)[number]}.name`);
  const banner = earlierBanner(notice, Number(count) || 0, t);
  const today = toDateInputValue(utcToWallTime(nowDate(), timezone));

  return (
    <SectionCard
      padding="lg"
      title={t("integrations.earlier.heading")}
      description={t("integrations.earlier.description")}
    >
      <div className="space-y-5">
        {banner ? <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner> : null}
        <FieldGrid as="form" method="get">
          <Field label={t("integrations.earlier.providerLabel")}>
            <select name="backfill" className={controlClass} defaultValue={chosen?.id}>
              {choices.map((row) => (
                <option key={row.id} value={row.id}>
                  {providerName(row.provider)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t("integrations.earlier.sinceLabel")}
            description={t("integrations.earlier.sinceDescription", { timezone })}
          >
            <input
              type="date"
              name="since"
              required
              max={today}
              className={controlClass}
              defaultValue={from ? (since ?? "") : ""}
            />
          </Field>
          <FieldActions>
            <SubmitButton
              pendingLabel={t("integrations.earlier.previewing")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("integrations.earlier.preview")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
        {preview?.ok && chosen && from ? (
          <PreviewResult
            counts={preview.counts}
            integrationId={chosen.id}
            since={since ?? ""}
            date={formatDateWithYear(from, locale, timezone)}
            provider={providerName(chosen.provider)}
            t={t}
          />
        ) : null}
      </div>
    </SectionCard>
  );
}

function PreviewResult({
  counts,
  integrationId,
  since,
  date,
  provider,
  t,
}: {
  counts: { checkouts: number; tips: number; refunds: number };
  integrationId: string;
  since: string;
  date: string;
  provider: string;
  t: StaffTranslator;
}) {
  if (counts.checkouts + counts.tips + counts.refunds === 0) {
    return (
      <p className="text-sm text-muted">
        {t("integrations.earlier.previewNothing", { date, provider })}
      </p>
    );
  }
  return (
    <form action={sendEarlierCheckoutsAction} className="space-y-3">
      <input type="hidden" name="integrationId" value={integrationId} />
      <input type="hidden" name="since" value={since} />
      <p className="font-medium">
        {t("integrations.earlier.previewLine", { date, provider, ...counts })}
      </p>
      <p className="text-sm text-muted">{t("integrations.earlier.caution", { provider })}</p>
      <SubmitButton pendingLabel={t("integrations.earlier.confirming")} className={buttonClass()}>
        {t("integrations.earlier.confirm", { provider })}
      </SubmitButton>
    </form>
  );
}

/** The outcome of the last send, shown where the owner pressed it. */
function earlierBanner(notice: string | undefined, count: number, t: StaffTranslator) {
  switch (notice) {
    case "earlier-sent":
      return { tone: "success" as const, text: t("integrations.notice.earlier-sent", { count }) };
    case "earlier-partial":
      return {
        tone: "success" as const,
        text: t("integrations.notice.earlier-partial", { count }),
      };
    case "earlier-none":
      return { tone: "warning" as const, text: t("integrations.notice.earlier-none") };
    case "earlier-not-owner":
      return { tone: "danger" as const, text: t("integrations.notice.earlier-not-owner") };
    case "earlier-invalid":
      return { tone: "danger" as const, text: t("integrations.notice.earlier-invalid") };
    default:
      return null;
  }
}
