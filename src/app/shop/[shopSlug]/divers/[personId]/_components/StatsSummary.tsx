import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { sectionCardClass } from "@/components/ui/card";
import { rentalItemLabel } from "@/i18n/rental-labels";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { shopWaiverStatusText, shopWaiverStatusTone } from "@/i18n/waiver-labels";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { cachedListFormat } from "@/lib/intl-cache";
import { rentalFitCompleteness } from "@/lib/rentals";
import { cardsNeedingLookCount, type DiverProfile, type Shop, unpaidBookingCount } from "./shared";

/**
 * **One card, and whether it is a loose end.**
 *
 * Every card up here used to look identical, so the row read as four facts of
 * equal weight — three pending cards, no rental sizes and an unpaid seat sat in
 * exactly the same box as a booking count nobody has to do anything about. A
 * staffer scanning the record had to read all four sub-lines to find the work.
 *
 * The signifier is deliberately small and always doubled: a warning-tinted
 * border and fill, *plus* a badge that says what is wanted in words. Colour
 * never carries the meaning on its own (docs/design/principles.md #6), and the
 * `Badge` warning tone brings its own `▲` glyph for a colourblind scan.
 *
 * The word is "Needs attention", the roster's own; not readiness's "Blocked"
 * (`src/i18n/readiness-labels.ts`), which is a fact about one diver on one
 * departure and would be a bigger claim than any of this evidence supports —
 * nothing on this card decides whether anybody boards.
 */
function StatCard({
  label,
  value,
  detail,
  attention,
  t,
}: {
  label: string;
  value: ReactNode;
  /** Null when the value says everything there is to say — see the Bookings card. */
  detail: ReactNode;
  /** Set when this card is holding something a staffer still has to do. */
  attention?: boolean;
  t: StaffTranslator;
}) {
  return (
    <div
      // A stat tile is the same object as a card and a table shell, so the
      // calm state takes its chrome from `sectionCardClass()`. "Needs
      // attention" is a *tone* variant of that one geometry — same radius,
      // same padding, same elevation, only the border and fill change.
      className={
        attention
          ? "rounded-2xl border border-warning/40 bg-warning/5 p-4 shadow-sm sm:p-5"
          : sectionCardClass()
      }
    >
      {/* `flex-wrap`, and the badge nowraps. Four of these sit in one `lg`
          row, so each card is about 200px wide — and "Rental fit" beside
          "▲ Needs attention" does not fit in that. Without wrapping, flex shrank
          *both*: the label broke after "Rental" and the badge broke mid-phrase,
          giving a two-line label facing a two-line pill and a card that read as
          damaged. Wrapping drops the badge to its own full-width line instead,
          where it has room to stay one line and the label stays one line too. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-sm text-muted">{label}</p>
        {attention ? (
          <Badge tone="warning" size="sm" className="whitespace-nowrap">
            {t("divers.stats.needsAttention")}
          </Badge>
        ) : null}
      </div>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {detail ? <p className="text-sm text-muted">{detail}</p> : null}
    </div>
  );
}

/**
 * The diver's standing with the shop's release.
 *
 * It sits up here, beside cards and sizes, because that is what it is: a fact
 * about this person and this shop, signed once and carried across every
 * booking they have here. Before this card the answer to "has she signed?"
 * existed only inside individual bookings, so a staffer on the phone had to
 * open a *trip* to learn something about a *diver* — and if she had no booking
 * yet, they could not find out at all.
 *
 * Dates only. The signed medical answers stay on the waiver surfaces built to
 * review them; what belongs at a glance is when the signature happened and
 * when it stops counting.
 */
function WaiverStat({ diver, shop, locale }: { diver: DiverProfile; shop: Shop; locale: string }) {
  const t = staffTranslator(locale);
  const waiver = diver.waiver;
  const tone = shopWaiverStatusTone(waiver);
  /**
   * Resolved in the shop's own timezone, not the server's — a window that ends
   * at 01:00 UTC is the 4th in Key Largo and the 3rd further west, and the shop
   * reading this card is the one whose calendar decides.
   *
   * **With the year**, unlike most dates in this app. Every date on this card
   * is about a year from today, and the app's usual short format has no year:
   * "Good until Tue, Aug 3" on the 4th of August reads as *yesterday*, which
   * is the opposite of what it means.
   */
  const date = (value: Date) =>
    formatCalendarDate(calendarDateInTimezone(value, shop.timezone), locale);
  return (
    <StatCard
      t={t}
      label={t("divers.stats.waiver")}
      // The status badge is this card's value — it already carries the tone and
      // the glyph, so it needs no second "needs attention" pill beside it. What
      // the tinted frame adds is that the *card* reads as work from across the
      // row, the same as its three neighbours.
      value={<Badge tone={tone}>{shopWaiverStatusText(t, waiver)}</Badge>}
      detail={
        waiver.state === "current"
          ? t("divers.stats.waiverGoodUntil", { date: date(waiver.expiresAt) })
          : waiver.state === "expired"
            ? t("divers.stats.waiverLastSigned", { date: date(waiver.signedAt) })
            : waiver.state === "medical_review"
              ? t("divers.stats.waiverHeldSince", { date: date(waiver.at) })
              : null
      }
    />
  );
}

export function StatsSummary({
  diver,
  shop,
  locale,
}: {
  diver: DiverProfile;
  shop: Shop;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const profile = diver.rentalFit;
  const totalBookings = diver.bookings.length + diver.priorVisits.length;
  // An imported specialty or nitrox card counts as needing attention even
  // though its status is `verified`: each one's gate — the specialty dive, the
  // Nitrox fill — stays shut until a staffer attests they have seen the card
  // (H-24). A header reading "0 needing a look" would say all-clear while a
  // deep dive or a fill is still blocked.
  const needingLook = cardsNeedingLookCount(diver);
  // Scoped to the shop's own catalog, so a fit predating the shop dropping an
  // item never nags about a size nobody can be handed (src/lib/rentals.ts).
  const fit = rentalFitCompleteness(profile, shop.rentalItems);
  const unpaid = unpaidBookingCount(diver);
  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        t={t}
        label={t("divers.stats.cards")}
        attention={needingLook > 0}
        value={
          diver.certifications.length +
          diver.specialtyCertifications.length +
          diver.nitroxCertifications.length
        }
        detail={t("divers.stats.needingLook", { count: needingLook })}
      />
      <WaiverStat diver={diver} shop={shop} locale={locale} />
      <StatCard
        t={t}
        label={t("divers.stats.rentalFit")}
        // Three states, not two. "Saved" used to mean nothing more than "a row
        // exists", so a diver who ticked BCD, wetsuit and weights and typed one
        // fin size read as done — and the sizes they'd actually be handed gear
        // against were still blank (src/lib/rentals.ts's `rentalFitCompleteness`).
        attention={fit.state !== "complete" || Boolean(profile?.needsStaffFitAt)}
        value={
          fit.state === "not_recorded"
            ? t("divers.stats.needed")
            : fit.state === "incomplete"
              ? t("divers.stats.partial")
              : t("divers.stats.saved")
        }
        detail={
          fit.state === "incomplete"
            ? t("divers.stats.fitMissingSizes", {
                items: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(
                  fit.missing.map((kind) => rentalItemLabel(t, kind)),
                ),
              })
            : profile?.needsStaffFitAt
              ? t("divers.stats.fitNeedsStaffFit")
              : null
        }
      />
      {/* Bookings, deliberately — not dives. The imported half of this number is
          what a prior system recorded as booked (ADR 20260725-import-prior-visits),
          which includes rows it also recorded as cancelled; counting those as
          dives would invent trips the diver never made.
          The sub-line says what the number *doesn't*: how much of it is owed
          for, or how much of it predates this shop's records. It used to open
          by restating the count in words — "3" over "3 bookings" — which is the
          one thing a reader has already got from the digit above it
          (principle 9). With neither an unpaid seat nor an import there is
          nothing left to add, so the line is simply absent. */}
      <StatCard
        t={t}
        label={t("divers.stats.bookings")}
        attention={unpaid > 0}
        value={totalBookings}
        detail={
          unpaid > 0
            ? t("divers.stats.unpaidBookings", { count: unpaid })
            : diver.priorVisits.length > 0
              ? t("divers.stats.importedCount", { count: diver.priorVisits.length })
              : null
        }
      />
    </div>
  );
}
