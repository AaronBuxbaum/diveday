import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { ROOM_HOTEL_MAX, ROOM_NUMBER_MAX } from "@/db/orders";
import type { OrderCollection } from "@/db/schema";
import { ORDER_COLLECTION_KEYS, paidAtCounterLine } from "@/i18n/order-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { recordPaymentAction, voidCounterAction } from "../counter-actions";

type CounterCollection = Exclude<OrderCollection, "stripe_invoice">;

/**
 * How and when money taken at the counter was taken: "Paid in cash Fri, Oct 9"
 * (ADR 20261009-counter-payments). It stands where a Stripe order's invoice
 * link would, and says what that link would have: where the money is.
 */
export function PaidAtCounterLine({
  collection,
  paidAt,
  room,
  locale,
  timezone,
  t,
}: {
  collection: CounterCollection;
  paidAt: Date;
  /** The room a room charge went to (`orders.room_number`, `room_hotel`). */
  room?: { roomNumber: string | null; roomHotel: string | null };
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  return (
    <p className="mt-2 text-sm text-muted">
      {paidAtCounterLine(t, {
        collection,
        date: formatShortDate(paidAt, locale, timezone),
        roomNumber: room?.roomNumber,
        roomHotel: room?.roomHotel,
      })}
    </p>
  );
}

/** An owner's or manager's one correction to a counter order: void it. */
export function VoidCounterOrderForm({ orderId, t }: { orderId: string; t: StaffTranslator }) {
  return (
    <form action={voidCounterAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <SubmitButton
        pendingLabel={t("orders.detail.voiding")}
        className={buttonClass({ variant: "danger" })}
      >
        {t("orders.detail.voidOrder")}
      </SubmitButton>
    </form>
  );
}

/**
 * **Record payment: cash / card machine / room** on an open invoice (fourth UX
 * review, item 19): one tap per way the money came, since the person at the
 * counter knows which and there is nothing else to say. A form per method, so
 * each button's in-flight state is its own. A room charge (fifth-loop ideas,
 * item 57) opens to ask which room, and which hotel where the shop serves more
 * than one.
 */
export function RecordPaymentForm({
  orderId,
  t,
  roomCharge = true,
}: {
  orderId: string;
  t: StaffTranslator;
  /** False on a demo shop: only cash and the card machine are recorded there. */
  roomCharge?: boolean;
}) {
  const labelId = `record-payment-${orderId}`;
  return (
    // One group, named once (visual review A16): the label and its two
    // machines read as a single row of work.
    <fieldset
      aria-labelledby={labelId}
      className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
    >
      <span id={labelId} className="w-full text-sm font-medium sm:w-auto">
        {t("orders.detail.recordPayment.label")}
      </span>
      {(["cash", "card_machine"] as const).map((collection) => (
        <form key={collection} action={recordPaymentAction}>
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="collection" value={collection} />
          <SubmitButton
            pendingLabel={t("orders.detail.recordPayment.recording")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t(ORDER_COLLECTION_KEYS[collection])}
          </SubmitButton>
        </form>
      ))}
      {roomCharge ? (
        <details className="w-full">
          <summary
            className={buttonClass({ variant: "secondary", className: "cursor-pointer list-none" })}
          >
            {t("orders.detail.recordPayment.roomCharge")}
          </summary>
          <FieldGrid
            as="form"
            action={recordPaymentAction}
            columns={1}
            className="mt-2 gap-y-3 sm:w-72"
          >
            <input type="hidden" name="orderId" value={orderId} />
            <input type="hidden" name="collection" value="room_charge" />
            <Field label={t("orders.detail.recordPayment.roomNumber")}>
              <input
                name="roomNumber"
                required
                maxLength={ROOM_NUMBER_MAX}
                autoComplete="off"
                className={controlClass}
              />
            </Field>
            <Field
              label={t("orders.detail.recordPayment.roomHotel")}
              description={t("orders.detail.recordPayment.roomHotelHint")}
            >
              <input
                name="roomHotel"
                maxLength={ROOM_HOTEL_MAX}
                autoComplete="off"
                className={controlClass}
              />
            </Field>
            <SubmitButton
              pendingLabel={t("orders.detail.recordPayment.recording")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("orders.detail.recordPayment.roomConfirm")}
            </SubmitButton>
          </FieldGrid>
        </details>
      ) : null}
    </fieldset>
  );
}
