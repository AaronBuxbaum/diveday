import { staffTranslator } from "@/i18n/staff-messages";
import { type DiverProfile, needsImportConfirm } from "./shared";

export function StatsSummary({ diver, locale }: { diver: DiverProfile; locale: string }) {
  const t = staffTranslator(locale);
  const profile = diver.rentalFit;
  const totalBookings = diver.bookings.length + diver.priorVisits.length;
  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-3">
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
        <p className="text-sm text-muted">{t("divers.stats.shopHistory")}</p>
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
