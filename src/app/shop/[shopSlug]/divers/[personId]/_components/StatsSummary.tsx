import type { ReactNode } from "react";
import { sectionCardClass } from "@/components/ui/card";
import { rentalItemLabel } from "@/i18n/rental-labels";
import { staffTranslator } from "@/i18n/staff-messages";
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
 * The signifier is the card's warning-tinted border and fill. The top line
 * stays a compact summary; the detail line explains what still needs work.
 */
function StatCard({
  label,
  value,
  detail,
  attention,
  success,
}: {
  label: string;
  value: ReactNode;
  /** Null when the value says everything there is to say — see the Bookings card. */
  detail: ReactNode;
  /** Set when this card is holding something a staffer still has to do. */
  attention?: boolean;
  /** Set for an affirmative status that deserves calm success chrome. */
  success?: boolean;
}) {
  return (
    <div
      // A stat tile is the same object as a card and a table shell, so the
      // calm state takes its chrome from `sectionCardClass()`. "Needs
      // attention" is a *tone* variant of that one geometry — same radius,
      // same padding, same elevation, only the border and fill change.
      className={
        success
          ? "rounded-2xl border border-success/40 bg-success/5 p-4 shadow-sm sm:p-5"
          : attention
            ? "rounded-2xl border border-warning/40 bg-warning/5 p-4 shadow-sm sm:p-5"
            : sectionCardClass()
      }
    >
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {detail ? <p className="text-sm text-muted">{detail}</p> : null}
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
        label={t("divers.stats.cards")}
        attention={needingLook > 0}
        value={
          diver.certifications.length +
          diver.specialtyCertifications.length +
          diver.nitroxCertifications.length
        }
        detail={needingLook > 0 ? t("divers.stats.needingLook", { count: needingLook }) : null}
      />
      <StatCard
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
      <StatCard
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
    </div>
  );
}
