"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { releaseHeldSendAction, undoHeldSendAction } from "@/app/actions/held-sends";
import { type HeldTicket, SendHold } from "@/components/SendHold";
import { buttonClass } from "@/components/ui/button";
import type { HoldCounterPaymentResult } from "../counter-actions";

type HeldCollection = "cash" | "card_machine";

export type CounterPaymentHoldCopy = {
  /** "Record payment", the group's one label. */
  label: string;
  cash: string;
  cardMachine: string;
  /** "Recorded $340 cash", said for the whole hold, beside Undo. */
  heldCash: string;
  heldCardMachine: string;
  undo: string;
};

/** Carries a refused hold out of `hold` without a thrown error reaching the page. */
class HoldRefused extends Error {}

/**
 * **Cash / Card machine: one tap with an eight-second Undo hold** (issue
 * #3030, decided 2026-10-25; H-68). The shared `SendHold`: the tap holds the
 * payment on the server and the row reads "Recorded $340 cash" with Undo
 * where the buttons stood; the hold running out records it and the page
 * shows the outcome; Undo leaves the order untouched. A screen that goes
 * elsewhere inside the hold leaves it to the sweep, which records it, as a
 * held send is sent. While the hold drains, the room charge steps aside, so
 * the order cannot be settled twice from this row.
 */
export function CounterPaymentHold({
  orderId,
  hold,
  copy,
  roomCharge,
  initialHold,
}: {
  orderId: string;
  hold: (formData: FormData) => Promise<HoldCounterPaymentResult>;
  copy: CounterPaymentHoldCopy;
  /** The room-charge form, drawn by the server; hidden while a hold drains. */
  roomCharge?: ReactNode;
  /** A hold already draining on this order when the page rendered (a reload). */
  initialHold?: { ticket: HeldTicket; collection: HeldCollection } | null;
}) {
  const router = useRouter();
  const [held, setHeld] = useState<HeldCollection | null>(initialHold?.collection ?? null);
  const labelId = `record-payment-${orderId}`;
  return (
    // One group, named once (visual review A16): the label and its two
    // machines read as a single row of work.
    <fieldset
      aria-labelledby={labelId}
      className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
    >
      <span id={labelId} className={held ? "sr-only" : "w-full text-sm font-medium sm:w-auto"}>
        {copy.label}
      </span>
      <SendHold
        hold={async (formData) => {
          const result = await hold(formData);
          if (!result.ok) {
            router.push(result.redirectTo);
            throw new HoldRefused();
          }
          setHeld(result.collection);
          return result.ticket;
        }}
        onHoldError={() => setHeld(null)}
        undo={async (id) => {
          const taken = await undoHeldSendAction(id);
          if (taken) setHeld(null);
          return taken;
        }}
        release={releaseHeldSendAction}
        onOutcome={(outcome) => {
          setHeld(null);
          if (outcome.redirectTo) router.push(outcome.redirectTo);
          else router.refresh();
        }}
        copy={{
          sendingNow: held === "card_machine" ? copy.heldCardMachine : copy.heldCash,
          undo: copy.undo,
        }}
        initialTicket={initialHold?.ticket ?? null}
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="orderId" value={orderId} />
        <button
          type="submit"
          name="collection"
          value="cash"
          className={buttonClass({ variant: "secondary" })}
        >
          {copy.cash}
        </button>
        <button
          type="submit"
          name="collection"
          value="card_machine"
          className={buttonClass({ variant: "secondary" })}
        >
          {copy.cardMachine}
        </button>
      </SendHold>
      {held ? null : roomCharge}
    </fieldset>
  );
}
