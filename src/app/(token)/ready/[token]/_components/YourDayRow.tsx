"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import type { YourDayLinkState } from "../your-days-actions";

export type YourDayRowWords = {
  open: string;
  opening: string;
  rateLimited: string;
  unavailable: string;
};

const INITIAL: YourDayLinkState = { bookingId: null, outcome: null };

/**
 * One of the diver's other days: its line, and a button that opens that day's
 * own page (#4059). The words arrive as props so the page needs no client
 * message namespace for it.
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
    outcome === "rate_limited"
      ? words.rateLimited
      : outcome === "unavailable"
        ? words.unavailable
        : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <span className="min-w-0 flex-1 text-base">{label}</span>
      <form action={formAction} className="flex flex-col items-end gap-1">
        <input type="hidden" name="bookingId" value={bookingId} />
        <button type="submit" disabled={pending} className={buttonClass({ variant: "secondary" })}>
          {pending ? words.opening : words.open}
        </button>
        <FormStatus tone="danger">{message}</FormStatus>
      </form>
    </li>
  );
}
