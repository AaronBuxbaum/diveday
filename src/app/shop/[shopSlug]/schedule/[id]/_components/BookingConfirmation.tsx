import Link from "next/link";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { readinessLinkPath } from "@/lib/readiness-links";
import { buildDiverChecklist, nextDiverStep } from "@/lib/readiness-summary";
import type { GearRef } from "../actions";
import { RentalGearForm } from "./RentalGearForm";
import type {
  Confirmed,
  Readiness,
  RentalProfile,
  RentalRequest,
  Requirement,
  Shop,
  Trip,
} from "./types";

export function BookingConfirmation({
  shop,
  shopSlug,
  trip,
  confirmed,
  readiness,
  requirement,
  gearRef,
  rentalRequest,
  rentalProfile,
  gearSaved,
}: {
  shop: Shop;
  shopSlug: string;
  trip: Trip;
  confirmed: Confirmed;
  readiness: Readiness | null;
  requirement: Requirement | null;
  gearRef: GearRef;
  rentalRequest: RentalRequest;
  rentalProfile: RentalProfile;
  gearSaved: boolean;
}) {
  const checklist = readiness ? buildDiverChecklist(requirement, readiness) : [];
  const nextStep = nextDiverStep(checklist);
  const readinessLink = readinessLinkPath(confirmed.booking.id);

  return (
    <section className="rise-in mt-10 rounded-lg border border-accent/40 bg-accent/10 p-6">
      <h2 className="text-xl font-semibold text-balance">
        You're on the boat, {confirmed.person.fullName.split(" ")[0]}! 🤿
      </h2>
      <p className="mt-2 text-muted">
        {formatShortDate(trip.startsAt, "en-US", shop.timezone)},{" "}
        {formatTimeRangeTz(trip.startsAt, trip.endsAt, "en-US", shop.timezone)} — be at the dock 30
        minutes early and we'll take it from there.
      </p>

      <div className="mt-4 rounded-lg border border-border bg-surface/70 p-4 text-left">
        {nextStep ? (
          <>
            <h3 className="font-semibold">Next: {nextStep.label.toLowerCase()}</h3>
            <p className="mt-1 text-sm text-muted">{nextStep.detail}</p>
          </>
        ) : readiness?.status === "ready" ? (
          <h3 className="font-semibold text-success">
            You're all set — nothing left but to show up.
          </h3>
        ) : (
          <>
            <h3 className="font-semibold">You're booked — the shop takes it from here</h3>
            <p className="mt-1 text-sm text-muted">
              We're finishing the last checks on our end. Nothing you need to do right now.
            </p>
          </>
        )}
        <Link
          href={readinessLink}
          className="mt-3 inline-block text-sm font-semibold text-primary hover:underline"
        >
          Track everything on your readiness page →
        </Link>
      </div>

      <RentalGearForm
        gearRef={gearRef}
        rentalRequest={rentalRequest}
        rentalProfile={rentalProfile}
        saved={gearSaved}
      />
      <Link
        href={`/shop/${shopSlug}/schedule`}
        className="mt-3 inline-block py-2 text-base font-medium text-primary hover:underline"
      >
        Back to the schedule
      </Link>
    </section>
  );
}
