import { SubmitButton } from "@/components/SubmitButton";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import type { TripLastMinutePromo } from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";

const STATUS_TONE: Record<TripLastMinutePromo["status"], BadgeTone> = {
  sent: "success",
  pending: "neutral",
  failed: "danger",
};

/**
 * The fill-the-boat lever: push a time-boxed Stripe discount code to every
 * last-minute-list diver whose date range covers this trip (docs ADR
 * 20260727-last-minute-fill-promos). A deliberate form submit, not a one-tap
 * control like the wait-list invite — the discount percent is a real
 * commercial choice.
 */
export function LastMinuteDealSection({
  eligibleCount,
  openSeats,
  cancelled,
  promos,
  timezone,
  locale,
  sendAction,
}: {
  eligibleCount: number;
  openSeats: number;
  cancelled: boolean;
  promos: TripLastMinutePromo[];
  timezone: string;
  locale: string;
  sendAction: (formData: FormData) => void;
}) {
  const t = staffTranslator(locale);
  const canSend = !cancelled && openSeats > 0 && eligibleCount > 0;
  return (
    <section id="last-minute-deal" className="mt-10 scroll-mt-6">
      <h2 className="text-lg font-semibold">{t("trips.lastMinute.heading")}</h2>
      <p className="mt-1 text-sm text-muted">{t("trips.lastMinute.description")}</p>

      {canSend ? (
        <form
          action={sendAction}
          className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <FieldGrid columns={1} className="max-w-28">
            <Field label={t("trips.lastMinute.discountLabel")}>
              <div className="flex items-center gap-1.5">
                <input
                  name="discountPercent"
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={90}
                  step={5}
                  defaultValue={25}
                  aria-label={t("trips.lastMinute.discountPercentAriaLabel")}
                  className={controlClass}
                />
                <span className="text-sm text-muted">%</span>
              </div>
            </Field>
          </FieldGrid>
          <SubmitButton
            pendingLabel={t("trips.lastMinute.sending")}
            className={buttonClass({ className: "px-5 py-2.5" })}
          >
            {t("trips.lastMinute.sendTo", { count: eligibleCount })}
          </SubmitButton>
        </form>
      ) : (
        <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          {cancelled
            ? t("trips.lastMinute.cancelledNotice")
            : openSeats <= 0
              ? t("trips.lastMinute.fullNotice")
              : t("trips.lastMinute.noneAroundNotice")}
        </p>
      )}

      {promos.length > 0 ? (
        <ol className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
          {promos.map((promo) => (
            <li
              key={promo.id}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {t("trips.lastMinute.percentOff", { percent: promo.discountPercent })} ·{" "}
                  <span className="font-mono">{promo.code}</span>
                </p>
                <p className="text-muted">
                  {t("trips.lastMinute.sentTo", {
                    date: formatDateTimeTz(promo.createdAt, locale, timezone),
                    count: promo.recipientCount,
                  })}
                </p>
              </div>
              <Badge tone={STATUS_TONE[promo.status]}>{promo.status}</Badge>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
