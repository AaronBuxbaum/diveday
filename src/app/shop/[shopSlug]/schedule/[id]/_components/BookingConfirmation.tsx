import Link from "next/link";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import type { GearRef } from "../actions";
import { RentalGearForm } from "./RentalGearForm";
import type { Confirmed, Readiness, RentalProfile, RentalRequest, Shop, Trip } from "./types";

export function BookingConfirmation({
  shop,
  shopSlug,
  trip,
  confirmed,
  readiness,
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
  gearRef: GearRef;
  rentalRequest: RentalRequest;
  rentalProfile: RentalProfile;
  gearSaved: boolean;
}) {
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
      {readiness?.status === "blocked" ? (
        <section className="mt-4 rounded-lg border border-border bg-surface/70 p-4 text-left">
          <h3 className="font-medium">Before your trip</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
            {readiness.blockers.map((blocker) => (
              <li key={blocker.message}>• {blocker.message}</li>
            ))}
          </ul>
        </section>
      ) : readiness?.status === "ready" ? (
        <p className="mt-4 text-sm font-medium text-success">
          Your pre-trip requirements are complete.
        </p>
      ) : null}
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
