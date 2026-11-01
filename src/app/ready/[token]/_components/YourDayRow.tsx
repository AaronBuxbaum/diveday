"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import type { YourDayLinkState } from "../your-days-actions";

export type YourDayRowWords = {
  send: string;
  sending: string;
  sent: string;
  rateLimited: string;
  failed: string;
  unavailable: string;
};

const INITIAL: YourDayLinkState = { bookingId: null, outcome: null };

/**
 * One of the diver's other days: its line, and a button that mails its link to
 * the address on file (H-20261014-other-days-send-fresh). The words arrive as props so the page needs no
 * client message namespace for it.
 */
export function YourDayRow({
  bookingId,
  label,
  words,
  action,
}: {
  bookingId: string;
  label: string;
  words: YourDayRowWords;
  action: (previous: YourDayLinkState, formData: FormData) => Promise<YourDayLinkState>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const outcome = state.bookingId === bookingId ? state.outcome : null;
  const message =
    outcome === "sent"
      ? words.sent
      : outcome === "rate_limited"
        ? words.rateLimited
        : outcome === "failed"
          ? words.failed
          : outcome === "unavailable"
            ? words.unavailable
            : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <span className="min-w-0 flex-1 text-base">{label}</span>
      <form action={formAction} className="flex flex-col items-end gap-1">
        <input type="hidden" name="bookingId" value={bookingId} />
        {outcome === "sent" ? null : (
          <button
            type="submit"
            disabled={pending}
            className={buttonClass({ variant: "secondary" })}
          >
            {pending ? words.sending : words.send}
          </button>
        )}
        <FormStatus tone={outcome === "sent" ? "success" : "danger"}>{message}</FormStatus>
      </form>
    </li>
  );
}
