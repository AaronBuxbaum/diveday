import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
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
  moveSeat,
  carriedChartersNote,
}: {
  booking: RosterEntry["booking"];
  person: RosterEntry["person"];
  t: StaffTranslator;
  shopSlug: string;
  offersCreateOrder: boolean;
  removeBookingAction: (formData: FormData) => void;
  /** Absent when the seat cannot move, or there is no other departure. */
  moveSeat?: SeatMove;
  /**
   * On a course seat, the charter seats sold only on this course (issue
   * #2058), said before Remove and in the move. Absent when there are none.
   */
  carriedChartersNote?: string;
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
          <MoveSeatControl
            booking={booking}
            t={t}
            moveSeat={moveSeat}
            carriedChartersNote={carriedChartersNote}
          />
        ) : null}
        <form action={removeBookingAction}>
          <input type="hidden" name="bookingId" value={booking.id} />
          <InlineConfirm
            triggerLabel={t("trips.roster.removeBooking")}
            message={t("trips.roster.confirmRemoveBooking", { name: person.fullName })}
            confirmLabel={t("trips.roster.removeBookingConfirmButton")}
            cancelLabel={t("trips.roster.neverMind")}
            evidence={carriedChartersNote}
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
      </div>
    </div>
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
  carriedChartersNote,
}: {
  booking: RosterEntry["booking"];
  t: StaffTranslator;
  moveSeat: SeatMove;
  carriedChartersNote?: string;
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
        {carriedChartersNote ? (
          <p className="text-sm text-warning-strong">{carriedChartersNote}</p>
        ) : null}
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
