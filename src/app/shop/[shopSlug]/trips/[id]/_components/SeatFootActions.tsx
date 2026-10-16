import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import type { AboardHold } from "@/db/aboard-at-sea";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { SeatMove } from "./roster-model";
import type { RosterEntry } from "./types";

/** The seat's own actions: the orders door, the move, and Remove. */
export function SeatFootActions({
  booking,
  person,
  t,
  shopSlug,
  offersCreateOrder,
  removeBookingAction,
  aboardAtSea = null,
  moveSeat,
}: {
  booking: RosterEntry["booking"];
  person: RosterEntry["person"];
  t: StaffTranslator;
  shopSlug: string;
  offersCreateOrder: boolean;
  removeBookingAction: (formData: FormData) => void;
  /**
   * The boat carried this seat or may be carrying it (H-126), and why: Remove
   * opens on why it will not, and there is nothing to confirm. `cancelBooking`
   * refuses the same seat under its locks, so a stale page is refused there too.
   */
  aboardAtSea?: AboardHold | null;
  /** Absent when the seat cannot move, or there is no other departure. */
  moveSeat?: SeatMove;
}) {
  return (
    <div className="mt-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* One orders door per row, and only when the shop can take money
            at all (principle 9 — Settings and the Orders index own the
            "Connect payments" door). */}
        {offersCreateOrder ? (
          <Link
            href={`/shop/${shopSlug}/orders/new?personId=${person.id}&bookingId=${booking.id}`}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {t("trips.roster.createOrder")}
          </Link>
        ) : null}
        {/* A cancel inside the shop's refund window fires an automatic
            Stripe refund that the Undo banner can't claw back — a real
            send of money — so this gets a blocking confirm
            (docs/design/principles.md §7). */}
        {moveSeat && moveSeat.targets.length > 0 ? (
          <MoveSeatControl booking={booking} t={t} moveSeat={moveSeat} />
        ) : null}
        {aboardAtSea ? (
          <RemoveRefusedAboard
            t={t}
            name={person.fullName}
            hold={aboardAtSea}
            flush={!offersCreateOrder}
          />
        ) : (
          <form action={removeBookingAction}>
            <input type="hidden" name="bookingId" value={booking.id} />
            <InlineConfirm
              triggerLabel={t("trips.roster.removeBooking")}
              message={t("trips.roster.confirmRemoveBooking", { name: person.fullName })}
              confirmLabel={t("trips.roster.removeBookingConfirmButton")}
              cancelLabel={t("trips.roster.neverMind")}
              pendingLabel={t("trips.roster.removing")}
              // `danger-ghost`, which is this variant's own stated case: a
              // destructive choice among quiet siblings. On `ghost` the
              // trigger rendered as muted body text at the foot of the
              // panel, indistinguishable from the sentences above it, so
              // the one irreversible act on the row was the only thing
              // there that did not read as a control.
              triggerClassName={buttonClass({
                variant: "danger-ghost",
                size: "sm",
                flush: !offersCreateOrder,
              })}
              confirmClassName={buttonClass({ variant: "danger", size: "sm" })}
            />
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Remove on a diver marked aboard a boat that has left: the same trigger, and
 * what it opens is the reason and the way through, never a confirm. A native
 * disclosure, so it needs no script on a deck with poor signal.
 */
function RemoveRefusedAboard({
  t,
  name,
  hold,
  flush,
}: {
  t: StaffTranslator;
  name: string;
  hold: AboardHold;
  flush: boolean;
}) {
  return (
    <details className="group/remove-aboard basis-full">
      <summary
        className={buttonClass({
          variant: "danger-ghost",
          size: "sm",
          flush,
          className: "list-none [&::-webkit-details-marker]:hidden",
        })}
      >
        {t("trips.roster.removeBooking")}
      </summary>
      <p role="status" className="mt-2 text-sm font-medium text-danger">
        {t(hold === "uncounted" ? "trips.roster.removeUncounted" : "trips.roster.removeAboard", {
          name,
        })}
      </p>
    </details>
  );
}

/**
 * **"Move to another departure"** (ADR 20261013-staff-move-a-seat): a quiet
 * disclosure, because it is rarer than Remove and should not compete with it.
 * Opened, it is one select of the departures this seat may move to, each
 * worded with its zone, and one button. No confirm: nothing is charged or
 * refunded, and moving back is the same two taps.
 */
function MoveSeatControl({
  booking,
  t,
  moveSeat,
}: {
  booking: RosterEntry["booking"];
  t: StaffTranslator;
  moveSeat: SeatMove;
}) {
  const selectId = `move-seat-${booking.id}`;
  return (
    <details className="group/move-seat basis-full">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-medium text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
        {t("trips.roster.moveSeat")}
      </summary>
      <form action={moveSeat.action} className="mt-2 flex flex-col gap-3">
        <input type="hidden" name="bookingId" value={booking.id} />
        <FieldGrid columns={1}>
          <Field
            label={t("trips.roster.moveSeatTo")}
            description={t("trips.roster.moveSeatNote")}
            htmlFor={selectId}
          >
            <select id={selectId} name="toTripId" required className={controlClass}>
              {moveSeat.targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.label}
                </option>
              ))}
            </select>
          </Field>
        </FieldGrid>
        <div>
          <SubmitButton
            pendingLabel={t("trips.roster.moveSeatPending")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("trips.roster.moveSeatSubmit")}
          </SubmitButton>
        </div>
      </form>
    </details>
  );
}
