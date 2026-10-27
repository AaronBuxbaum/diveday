import type { FormNotice } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { type SeatMove, seatMoveForRow } from "./roster-model";
import type { RosterEntry } from "./types";

/** A URL identifies the form only after the live roster proves that form will render. */
export function moveSeatRefusalFor(input: {
  origin: string | undefined;
  notice: FormNotice | undefined;
  roster: readonly RosterEntry[];
  moveSeat: SeatMove | undefined;
  record: boolean;
  aboardAtSea?: ReadonlyMap<string, unknown>;
}): SeatMove["refusal"] {
  if (
    !input.origin ||
    !uuidParam(input.origin) ||
    !input.notice ||
    input.notice.tone !== "danger" ||
    input.record
  )
    return undefined;
  const entry = input.roster.find(({ booking }) => booking.id === input.origin);
  if (!entry || entry.booking.identityUnconfirmedAt || input.aboardAtSea?.has(entry.booking.id))
    return undefined;
  const move = seatMoveForRow(entry.booking, input.moveSeat);
  if (!move || move.targets.length === 0) return undefined;
  return { bookingId: entry.booking.id, text: input.notice.text };
}
