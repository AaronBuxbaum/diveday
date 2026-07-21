"use client";

import Link from "next/link";
import { useActionState } from "react";
import { BookingPartyFields } from "@/components/BookingPartyFields";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { capacityLabel } from "@/lib/trips";
import { type BookingFormState, bookSpot, joinWaitlist, type TripRef } from "../actions";
import type { Trip } from "./types";

function ErrorNotice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

export function WaitlistConfirmation({
  firstName,
  shopSlug,
}: {
  firstName: string;
  shopSlug: string;
}) {
  return (
    <section className="rise-in mt-10 rounded-lg border border-accent/40 bg-accent/10 p-6">
      <h2 className="text-xl font-semibold text-balance">
        You&apos;re on the wait list, {firstName}.
      </h2>
      <p className="mt-2 text-muted">
        A spot is not held yet. The shop can see your place in line and will contact you if one
        opens up.
      </p>
      <Link
        href={`/shop/${shopSlug}/schedule`}
        className="mt-3 inline-block py-2 text-base font-medium text-primary hover:underline"
      >
        Back to the schedule
      </Link>
    </section>
  );
}

export function TripSailedNotice({ shopSlug }: { shopSlug: string }) {
  return (
    <section className="mt-10 rounded-lg border border-border bg-surface p-6">
      <h2 className="font-medium">This one's already sailed</h2>
      <p className="mt-1 text-sm text-muted">
        <Link
          href={`/shop/${shopSlug}/schedule`}
          className="font-medium text-primary hover:underline"
        >
          Check the schedule
        </Link>{" "}
        for the next departure.
      </p>
    </section>
  );
}

export function TripFullSection({
  shopSlug,
  trip,
  tripRef,
  remaining,
  errorMessage,
}: {
  shopSlug: string;
  trip: Trip;
  tripRef: TripRef;
  remaining: number;
  errorMessage?: string;
}) {
  return (
    <section className="mt-10 rounded-lg border border-border bg-surface p-6">
      <h2 className="font-medium">This boat's full</h2>
      <p className="mt-1 text-sm text-muted">
        All {trip.capacity} spots are taken.{" "}
        <Link
          href={`/shop/${shopSlug}/schedule`}
          className="font-medium text-primary hover:underline"
        >
          Find another trip
        </Link>{" "}
        — the reef isn't going anywhere.
      </p>
      <ErrorNotice message={errorMessage} />
      <form
        action={joinWaitlist.bind(null, tripRef)}
        className="mt-6 flex flex-col gap-4 border-t border-border pt-6"
      >
        <div>
          <h3 className="font-semibold">Join the wait list</h3>
          <p className="mt-1 text-sm text-muted">
            If a spot opens, the shop will have your details ready.
          </p>
        </div>
        <BookingPartyFields maxPartySize={remaining} leadPhone />
        <div>
          <SubmitButton
            pendingLabel="Joining…"
            className={buttonClass({ className: "px-6 py-3 text-base disabled:opacity-70" })}
          >
            Join the wait list
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}

const INITIAL_BOOKING_STATE: BookingFormState = {};

export function BookSpotSection({
  trip,
  tripRef,
  remaining,
  errorMessage,
  payAtBooking,
  perDiverPriceCents,
}: {
  trip: Trip;
  tripRef: TripRef;
  remaining: number;
  errorMessage?: string;
  payAtBooking: boolean;
  perDiverPriceCents: number | null;
}) {
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const [state, formAction] = useActionState(bookSpot.bind(null, tripRef), INITIAL_BOOKING_STATE);
  return (
    <section id="book" className="mt-10">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Grab a spot</h2>
        <span className="text-sm font-medium text-primary tabular-nums">{capacityLabel(trip)}</span>
      </div>
      {payAtBooking && perDiverPriceCents ? (
        <p className="mt-1 text-sm text-muted">
          {usd.format(perDiverPriceCents / 100)} per diver — paid securely when you book.
        </p>
      ) : null}
      <ErrorNotice message={state.error ?? errorMessage} />
      <form action={formAction} className="mt-4 flex flex-col gap-4">
        <BookingPartyFields maxPartySize={remaining} leadPhone fieldErrors={state.fieldErrors} />
        <div className="mt-1">
          <SubmitButton
            pendingLabel={payAtBooking ? "Heading to payment…" : "Booking…"}
            className={buttonClass({ className: "px-6 py-3 text-base disabled:opacity-70" })}
          >
            {payAtBooking
              ? `Book and pay${remaining === 1 ? " — last spot" : ""}`
              : `Book ${remaining === 1 ? "the last spot" : "these spots"}`}
          </SubmitButton>
        </div>
        <p className="text-sm text-muted">
          No account needed. The shop will confirm your certification and rental fit when you
          arrive.
        </p>
      </form>
    </section>
  );
}
