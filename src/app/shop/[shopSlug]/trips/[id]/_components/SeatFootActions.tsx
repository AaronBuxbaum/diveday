import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { RosterEntry } from "./types";

/** The seat's own actions: the orders door and Remove. */
export function SeatFootActions({
  booking,
  person,
  t,
  shopSlug,
  offersCreateOrder,
  removeBookingAction,
}: {
  booking: RosterEntry["booking"];
  person: RosterEntry["person"];
  t: StaffTranslator;
  shopSlug: string;
  offersCreateOrder: boolean;
  removeBookingAction: (formData: FormData) => void;
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
      </div>
    </div>
  );
}
