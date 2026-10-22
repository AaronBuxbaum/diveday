import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { sectionCardClass } from "@/components/ui/card";
import { FormStatus } from "@/components/ui/form";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { TripLastMinutePromo } from "@/db/schema";
import type { TripLastMinutePromoRecipientItem } from "@/db/trip-promos";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz, formatMoneyScanned } from "@/lib/format";
import { promoDiscountOf } from "@/lib/promo-codes";
import type { FormNotice } from "@/lib/staff-notices";
import { WHO_WANTS_IN_ID } from "./WhoWantsInPanel";

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
 * **The deals this departure sent, and the way to send another.** The sender
 * itself is the Divers tab's "Who wants in" panel: one Offer, "with a discount"
 * (ADR 20261017-one-lead-with-a-scope). What stays here is history (the code,
 * how many, whether Stripe minted it) and the answer to the last send
 * (`FormStatus`, since a deal's outcome redirects to `#last-minute-deal`).
 */
export function LastMinuteDealSection({
  tripPath,
  promos,
  promoRecipients,
  timezone,
  currency = "usd",
  locale,
  status,
  leadTime,
}: {
  /** What the last deal did, beside the history it joined. */
  status?: FormNotice;
  /** The departure page (its Divers tab holds `#who-wants-in`), or null while nothing can be offered (full, cancelled). */
  tripPath: string | null;
  promos: TripLastMinutePromo[];
  promoRecipients?: TripLastMinutePromoRecipientItem[];
  timezone: string;
  /** The shop's currency: a fixed-amount deal is shown in it. */
  currency?: string;
  locale: string;
  /** "Saturday departures usually sell 40% of their seats in the last 3 days" (`DealLeadTime`). */
  leadTime?: ReactNode;
}) {
  const t = staffTranslator(locale);
  /** "25% off", or "$20 off each booking". */
  const dealDiscountText = (promo: TripLastMinutePromo): string => {
    const discount = promoDiscountOf(promo);
    return discount?.kind === "amount"
      ? t("trips.lastMinute.amountOff", {
          amount: formatMoneyScanned(discount.amountCents, currency, locale),
        })
      : t("trips.lastMinute.percentOff", { percent: discount?.percent ?? 0 });
  };
  return (
    // No top margin of its own: this renders inside a disclosure panel that
    // owns its inset. `scroll-mt-24` stays: a deal's outcome redirects to this
    // element's own `#last-minute-deal` anchor.
    <section id="last-minute-deal" className="scroll-mt-24">
      <h2 className={SECTION_TITLE_CLASS}>{t("trips.lastMinute.heading")}</h2>
      {leadTime}
      {tripPath ? (
        <p className="mt-2 text-sm">
          <a href={`${tripPath}#${WHO_WANTS_IN_ID}`} className="underline">
            {t("trips.lastMinute.offerWithDiscount")}
          </a>
        </p>
      ) : null}
      <FormStatus tone={status?.tone} className="mt-2">
        {status?.text}
      </FormStatus>

      {promos.length > 0 ? (
        <ol
          className={sectionCardClass({
            padding: "none",
            className: "mt-4 divide-y divide-border",
          })}
        >
          {promos.map((promo) => {
            const sentRecipients = promoRecipients?.filter((r) => r.promoId === promo.id) ?? [];
            return (
              <li key={promo.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {dealDiscountText(promo)} · <span className="font-mono">{promo.code}</span>
                    </p>
                    <p className="text-muted">
                      {t("trips.lastMinute.sentTo", {
                        date: formatDateTimeTz(promo.createdAt, locale, timezone),
                        count: promo.recipientCount,
                      })}
                    </p>
                  </div>
                  <Badge tone={STATUS_TONE[promo.status]}>{t(STATUS_KEYS[promo.status])}</Badge>
                </div>
                {sentRecipients.length > 0 ? (
                  <p className="text-xs text-muted">
                    {t("trips.lastMinute.recipients", {
                      names: sentRecipients.map((r) => r.fullName).join(", "),
                    })}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
