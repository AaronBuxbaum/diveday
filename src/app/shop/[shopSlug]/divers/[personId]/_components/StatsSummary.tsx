import { type DiverProfile, needsImportConfirm } from "./shared";

export function StatsSummary({ diver }: { diver: DiverProfile }) {
  const profile = diver.rentalFit;
  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-muted">Cards</p>
        <p className="mt-1 text-2xl font-semibold">
          {diver.certifications.length +
            diver.specialtyCertifications.length +
            diver.nitroxCertifications.length}
        </p>
        {/* An imported specialty or nitrox card counts as needing attention even
            though its status is `verified`: each one's gate — the specialty dive,
            the enriched-air fill — stays shut until a staffer attests they have
            seen the card (H-24). A header reading "0 pending review" would say
            all-clear while a deep dive or a fill is still blocked. A level card
            is not counted: it cleared readiness on arrival, so its confirm is a
            soft nudge and lives on the card itself. */}
        <p className="text-sm text-muted">
          {diver.certifications.filter((card) => card.status === "pending").length +
            diver.specialtyCertifications.filter(
              (card) => card.status === "pending" || needsImportConfirm(card),
            ).length +
            diver.nitroxCertifications.filter(
              (card) => card.status === "pending" || needsImportConfirm(card),
            ).length}{" "}
          needing a look
        </p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-muted">Rental fit</p>
        <p className="mt-1 text-2xl font-semibold">{profile ? "Saved" : "Needed"}</p>
        <p className="text-sm text-muted">Reusable for future bookings</p>
      </div>
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-muted">Shop history</p>
        <p className="mt-1 text-2xl font-semibold">{diver.bookings.length}</p>
        <p className="text-sm text-muted">booking{diver.bookings.length === 1 ? "" : "s"}</p>
      </div>
    </div>
  );
}
