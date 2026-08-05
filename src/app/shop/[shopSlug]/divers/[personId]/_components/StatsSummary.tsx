import { Badge } from "@/components/ui/badge";
import { staffTranslator } from "@/i18n/staff-messages";
import { shopWaiverStatusText, shopWaiverStatusTone } from "@/i18n/waiver-labels";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { type DiverProfile, needsImportConfirm, type Shop } from "./shared";

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
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm text-muted">{t("divers.stats.waiver")}</p>
      <p className="mt-1">
        <Badge tone={shopWaiverStatusTone(waiver)}>{shopWaiverStatusText(t, waiver)}</Badge>
      </p>
      <p className="mt-2 text-sm text-muted">
        {waiver.state === "current"
          ? t("divers.stats.waiverGoodUntil", { date: date(waiver.expiresAt) })
          : waiver.state === "expired"
            ? t("divers.stats.waiverLastSigned", { date: date(waiver.signedAt) })
            : waiver.state === "medical_review"
              ? t("divers.stats.waiverHeldSince", { date: date(waiver.at) })
              : t("divers.stats.waiverSignsOnce")}
      </p>
    </div>
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
  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-muted">{t("divers.stats.cards")}</p>
        <p className="mt-1 text-2xl font-semibold">
          {diver.certifications.length +
            diver.specialtyCertifications.length +
            diver.nitroxCertifications.length}
        </p>
        {/* An imported specialty or nitrox card counts as needing attention even
            though its status is `verified`: each one's gate — the specialty dive,
            the Nitrox fill — stays shut until a staffer attests they have
            seen the card (H-24). A header reading "0 pending review" would say
            all-clear while a deep dive or a fill is still blocked. A level card
            is not counted: it cleared readiness on arrival, so its confirm is a
            soft nudge and lives on the card itself. */}
        <p className="text-sm text-muted">
          {t("divers.stats.needingLook", {
            count:
              diver.certifications.filter((card) => card.status === "pending").length +
              diver.specialtyCertifications.filter(
                (card) => card.status === "pending" || needsImportConfirm(card),
              ).length +
              diver.nitroxCertifications.filter(
                (card) => card.status === "pending" || needsImportConfirm(card),
              ).length,
          })}
        </p>
      </div>
      <WaiverStat diver={diver} shop={shop} locale={locale} />
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-muted">{t("divers.stats.rentalFit")}</p>
        <p className="mt-1 text-2xl font-semibold">
          {profile ? t("divers.stats.saved") : t("divers.stats.needed")}
        </p>
        <p className="text-sm text-muted">{t("divers.stats.reusableForFuture")}</p>
      </div>
      {/* Bookings, deliberately — not dives. The imported half of this number is
          what a prior system recorded as booked (ADR 20260725-import-prior-visits),
          which includes rows it also recorded as cancelled; counting those as
          dives would invent trips the diver never made. The sub-line splits the
          number so nobody has to guess which part happened here. */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-muted">{t("divers.stats.bookings")}</p>
        <p className="mt-1 text-2xl font-semibold">{totalBookings}</p>
        <p className="text-sm text-muted">
          {t("divers.stats.bookingsText", { count: totalBookings })}
          {diver.priorVisits.length > 0
            ? t("divers.stats.importedSuffix", { count: diver.priorVisits.length })
            : ""}
        </p>
      </div>
    </div>
  );
}
