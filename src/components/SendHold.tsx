"use client";

import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { heldSendSecondsLeft } from "@/lib/held-sends";

export type SendHoldCopy = {
  /** "Sending…" — said for the whole hold, beside Undo. */
  sendingNow: string;
  undo: string;
};

/**
 * What the hold action hands back. `runAt` is the server's instant, for the
 * cron sweep; `holdMs` is how long the client counts down **on its own clock**
 * — the two clocks are never compared, because a server whose clock is
 * frozen (the e2e fleet) or skewed would otherwise hold a send forever, or
 * release it at once.
 */
export type HeldTicket = { id: string; runAt: number; holdMs: number };

/** How often the hold's own clock advances. */
const TICK_MS = 250;

/**
 * A send you can take back (ADR 20260906-before-you-ask, decision 2).
 *
 * Wraps the form a send is submitted from. The tap does not send: it asks the
 * server to **hold** the send for eight seconds, shows a plain "Sending…" with
 * Undo in the row where the button stood, so the thumb that pressed it can
 * press it again, and asks the server to **release** it when the hold has run.
 * No countdown, ring or animation: the line is a standard undo affordance.
 * Undo deletes the held row; nothing was sent and the form is back as it was. The hold lives on the
 * server, so a closed tab does not stop the mail: the hourly sweep sends it.
 *
 * `hold` receives the form's own `FormData`, submitter included, so the four
 * sends keep their hidden inputs and channel buttons unchanged. `release`
 * resolves to the send's outcome once it has run, `pending` while the server
 * still counts the hold as draining (clock skew), or `gone` when it was undone
 * elsewhere; the outcome goes to `onOutcome` for the caller to show.
 */
export function SendHold<Outcome>({
  hold,
  undo,
  release,
  onOutcome,
  copy,
  note,
  className,
  children,
}: {
  hold: (formData: FormData) => Promise<HeldTicket>;
  undo: (id: string) => Promise<boolean>;
  release: (
    id: string,
  ) => Promise<{ status: "pending" | "gone" } | { status: "done"; outcome: Outcome }>;
  onOutcome: (outcome: Outcome) => void;
  copy: SendHoldCopy;
  /** The one clause a send keeps ("the old link stops working"), shown beside "Sending…". */
  note?: string;
  className?: string;
  children: ReactNode;
}) {
  const [ticket, setTicket] = useState<HeldTicket | null>(null);
  const [releasing, setReleasing] = useState(false);
  // How much of the hold has run, counted in ticks of the interval below —
  // never read off a clock. `Date.now()` is pinned in the e2e fleet (and may
  // be skewed anywhere), while timers keep running; a hold that read the
  // clock never released there.
  const [elapsedMs, setElapsedMs] = useState(0);
  const busy = useRef(false);
  // The tap is only a hold once React owns the form: before then it submits
  // natively, reloads the page and holds nothing. The form publishes the staff
  // surfaces' `data-hydrated` flag, which the e2e suite waits on.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (!ticket) return;
    const timer = setInterval(() => setElapsedMs((current) => current + TICK_MS), TICK_MS);
    return () => clearInterval(timer);
  }, [ticket]);

  const seconds = ticket ? heldSendSecondsLeft(ticket.holdMs, elapsedMs) : 0;

  // Release at zero. The server decides whether the hold has drained; a
  // `pending` answer is a skewed clock, and the next tick asks again — which
  // is why the tick (`elapsedMs`) is a dependency: at zero, `seconds` stops
  // changing, and an effect keyed on it alone never asked a second time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `elapsedMs` is the retry trigger, read through `seconds`.
  useEffect(() => {
    if (!ticket || seconds > 0 || busy.current) return;
    busy.current = true;
    setReleasing(true);
    release(ticket.id)
      .then((result) => {
        if (result.status === "pending") return;
        setTicket(null);
        setReleasing(false);
        if (result.status === "done") onOutcome(result.outcome);
      })
      .finally(() => {
        busy.current = false;
      });
  }, [ticket, seconds, elapsedMs, release, onOutcome]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ticket) return;
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const formData = new FormData(form, submitter ?? undefined);
    const next = await hold(formData);
    setElapsedMs(0);
    setTicket(next);
  }

  async function onUndo() {
    if (!ticket) return;
    const taken = await undo(ticket.id);
    // False means it already left; the release effect shows what it did.
    if (taken) {
      setTicket(null);
      setReleasing(false);
    }
  }

  if (ticket) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex flex-wrap items-center gap-3 ${className ?? ""}`.trim()}
      >
        <span className="text-sm">
          {copy.sendingNow}
          {note ? <span className="text-muted"> {note}</span> : null}
        </span>
        <button
          type="button"
          onClick={onUndo}
          disabled={releasing}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.undo}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={className} data-hydrated={hydrated ? "true" : undefined}>
      {children}
    </form>
  );
}
