"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
  /** "Recording $340.00 cash", said for the whole hold, beside Undo. */
  heldCash: string;
  heldCardMachine: string;
  undo: string;
};

/** Carries a refused hold out of `hold` without a thrown error reaching the page. */
class HoldRefused extends Error {}

/**
 * Tell the server the screen is going while a hold drains, so it records the
 * payment now (`orders/[id]/leave`). `keepalive` lets the request outlive the
 * page; a request that never lands leaves the hold to the hourly sweep.
 */
function sendLeave(url: string, heldId: string): void {
  void fetch(url, {
    method: "POST",
    keepalive: true,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ heldId }),
  }).catch(() => undefined);
}

/**
 * **Cash / Card machine: one tap with an eight-second Undo hold** (issue
 * #3030, decided 2026-10-25; H-20260906-diveday-fill-already-knows). The shared `SendHold`: the tap holds the
 * payment on the server and the row reads "Recording $340.00 cash" with Undo
 * where the buttons stood; the hold running out records it and the page
 * shows the outcome; Undo leaves the order untouched. While the hold drains,
 * the room charge steps aside, so the order cannot be settled twice.
 *
 * Review of #3061 (dde-a F1, F2):
 * - **Leaving commits.** Closing the tab, hiding it, or navigating inside the
 *   app while the hold drains sends `leaveUrl`, and the server records the
 *   payment then, at the tap's time; the hourly sweep is only the fallback.
 * - **Too late is said.** An Undo the server refuses (the hold already ran
 *   out there) or a release that finds the hold gone (another screen, the
 *   sweep, or this screen's own leave recorded it) never redraws the buttons
 *   as if it were undone: the page reloads on "Too late to undo".
 */
export function CounterPaymentHold({
  orderId,
  hold,
  copy,
  roomCharge,
  initialHold,
  leaveUrl,
  tooLateHref,
}: {
  orderId: string;
  hold: (formData: FormData) => Promise<HoldCounterPaymentResult>;
  copy: CounterPaymentHoldCopy;
  /** The room-charge form, drawn by the server; hidden while a hold drains. */
  roomCharge?: ReactNode;
  /** A hold already draining on this order when the page rendered (a reload). */
  initialHold?: { ticket: HeldTicket; collection: HeldCollection } | null;
  /** Where the page says it is going inside a hold (`orders/[id]/leave`). */
  leaveUrl: string;
  /** The order page with the "Too late to undo" notice. */
  tooLateHref: string;
}) {
  const router = useRouter();
  const [held, setHeld] = useState<HeldCollection | null>(initialHold?.collection ?? null);
  // The hold this screen still owns: set by the tap (or the reload), cleared
  // by Undo, an outcome, or a hold found gone. What a leave commits.
  const pending = useRef<string | null>(initialHold?.ticket.id ?? null);
  const labelId = `record-payment-${orderId}`;

  useEffect(() => {
    const leave = () => {
      const id = pending.current;
      if (!id) return;
      pending.current = null;
      sendLeave(leaveUrl, id);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") leave();
    };
    let mounted = true;
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      mounted = false;
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
      // A navigation inside the app unmounts this row without a pagehide.
      // Deferred a tick so React's development double-mount, which runs
      // this cleanup and mounts again at once, never commits anything.
      setTimeout(() => {
        if (!mounted) leave();
      }, 0);
    };
  }, [leaveUrl]);

  const tooLate = () => {
    pending.current = null;
    setHeld(null);
    router.push(tooLateHref);
  };
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
          pending.current = result.ticket.id;
          return result.ticket;
        }}
        onHoldError={() => setHeld(null)}
        undo={async (id) => {
          const taken = await undoHeldSendAction(id);
          if (taken) {
            pending.current = null;
            setHeld(null);
          } else {
            tooLate();
          }
          return taken;
        }}
        release={async (id) => {
          const released = await releaseHeldSendAction(id);
          if (released.status === "gone") tooLate();
          return released;
        }}
        onOutcome={(outcome) => {
          pending.current = null;
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
