import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";
import { readinessLinkPath } from "@/lib/readiness-links";
import { buildDiverChecklist, nextDiverStep } from "@/lib/readiness-summary";
import { payForBooking, type RentalFitRef, saveRentalFitRequest } from "../actions";
import { RentalFitForm } from "./RentalFitForm";
import type {
  Confirmed,
  PaymentPanel,
  Readiness,
  RentalFit,
  Requirement,
  Shop,
  Trip,
} from "./types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function PaymentSection({
  payment,
  payCancelled,
  payRef,
}: {
  payment: PaymentPanel;
  payCancelled: boolean;
  payRef: Omit<RentalFitRef, "personId">;
}) {
  if (!payment) return null;

  if (payment.state === "paid") {
    return (
      <div className="mt-4 rounded-lg border border-success/40 bg-success/10 p-4 text-left">
        <h3 className="font-semibold text-success">
          Payment received
          {payment.amountCents !== null ? ` — ${usd.format(payment.amountCents / 100)}` : ""} ✓
        </h3>
        <p className="mt-1 text-sm text-muted">You're square with the shop for this trip.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface/70 p-4 text-left">
      <h3 className="font-semibold">
        {payCancelled ? "Your spot is safe — payment's still open" : "One thing left: payment"}
      </h3>
      <p className="mt-1 text-sm text-muted">
        Pay securely through the shop's own payment page. If you'd rather settle at the counter,
        that works too.
      </p>
      {payment.state === "pending" ? (
        <a
          href={payment.checkoutUrl}
          className={buttonClass({ className: "mt-3 px-5 py-2.5 text-base" })}
        >
          Finish paying
        </a>
      ) : (
        <form action={payForBooking.bind(null, payRef)} className="mt-3">
          <SubmitButton
            pendingLabel="Opening payment…"
            className={buttonClass({ className: "px-5 py-2.5 text-base disabled:opacity-70" })}
          >
            Pay now
          </SubmitButton>
        </form>
      )}
    </div>
  );
}

export function BookingConfirmation({
  shop,
  shopSlug,
  trip,
  confirmed,
  readiness,
  requirement,
  fitRef,
  rentalFit,
  nitroxCardVerified,
  fitSaved,
  payment,
  payCancelled,
}: {
  shop: Shop;
  shopSlug: string;
  trip: Trip;
  confirmed: Confirmed;
  readiness: Readiness | null;
  requirement: Requirement | null;
  fitRef: RentalFitRef;
  rentalFit: RentalFit;
  nitroxCardVerified: boolean;
  fitSaved: boolean;
  payment: PaymentPanel;
  payCancelled: boolean;
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

      <PaymentSection payment={payment} payCancelled={payCancelled} payRef={fitRef} />

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
              We're double-checking a couple of things on our side. Nothing you need to do right
              now.
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

      <RentalFitForm
        action={saveRentalFitRequest.bind(null, fitRef)}
        rentalFit={rentalFit}
        wantsNitrox={confirmed.booking.wantsNitrox}
        nitroxCardVerified={nitroxCardVerified}
        plannedDives={trip.plannedDives}
        saved={fitSaved}
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
