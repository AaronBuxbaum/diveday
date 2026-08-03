import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import type { TripLastMinutePromo } from "@/db/schema";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";

const STATUS_TONE: Record<TripLastMinutePromo["status"], BadgeTone> = {
  sent: "success",
  pending: "neutral",
  failed: "danger",
};

// A raw `status` enum value is a database detail, not copy — the badge shows
// the translated label the bundle carries for it (docs ADR
// 20260730-staff-copy-localization), the same shape as `promos.status`.
const STATUS_KEYS: Record<TripLastMinutePromo["status"], StaffMessageKey> = {
  sent: "trips.lastMinute.status.sent",
  pending: "trips.lastMinute.status.pending",
  failed: "trips.lastMinute.status.failed",
};

/**
 * The fill-the-boat lever: push a time-boxed Stripe discount code to every
 * last-minute-list diver whose date range covers this trip (docs ADR
 * 20260727-last-minute-fill-promos). A deliberate form submit, not a one-tap
 * control like the wait-list invite — the discount percent is a real
 * commercial choice.
 */
export function LastMinuteDealSection({
  shopSlug,
  eligibleCount,
  openSeats,
  cancelled,
  promos,
  timezone,
  locale,
  sendAction,
}: {
  /** Only used by the cancelled empty state's way out, back to the board. */
  shopSlug: string;
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
        // Three different reasons there is no send button, each with the one
        // door that helps from here: a cancelled boat sends you back to the
        // schedule, a full boat to the wait list this trip already keeps, and
        // an empty last-minute list to seating someone by hand.
        <EmptyState className="mt-4">
          <h3 className="font-medium">
            {cancelled
              ? t("trips.lastMinute.cancelledHeading")
              : openSeats <= 0
                ? t("trips.lastMinute.fullHeading")
                : t("trips.lastMinute.noneAroundHeading")}
          </h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {cancelled
              ? t("trips.lastMinute.cancelledNotice")
              : openSeats <= 0
                ? t("trips.lastMinute.fullNotice")
                : t("trips.lastMinute.noneAroundNotice")}
          </p>
          {cancelled ? (
            <Link
              href={`/shop/${shopSlug}/schedule/board`}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
            >
              {t("trips.lastMinute.cancelledAction")}
            </Link>
          ) : (
            <a
              href={openSeats <= 0 ? "#waitlist" : "#add-diver"}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
            >
              {openSeats <= 0
                ? t("trips.lastMinute.fullAction")
                : t("trips.lastMinute.noneAroundAction")}
            </a>
          )}
        </EmptyState>
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
              <Badge tone={STATUS_TONE[promo.status]}>{t(STATUS_KEYS[promo.status])}</Badge>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
