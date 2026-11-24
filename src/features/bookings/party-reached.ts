/**
 * **Who a just-seated party's links reached** ("Try it Saturday", item 5): the
 * channels each seat's confirmation and ready link went out on, carried from
 * the party add to its landing ("Party waivers") in one query parameter, so
 * the landing can say who got a link and by what, and offer the counter's QR
 * code to the rest.
 *
 * The parameter holds booking ids and channel letters only, never a name, an
 * address or a number: `<bookingId>.<letters>` per reached seat, joined by
 * `,`. Its presence says "just added"; a seat it leaves out was reached by
 * nothing. A landing opened any other way has no parameter and says nothing
 * about delivery.
 */
import type { SeatDiverChannel } from "./seat-diver";

export type PartyChannel = SeatDiverChannel;

const LETTER: Readonly<Record<PartyChannel, string>> = { email: "e", sms: "s", whatsapp: "w" };
const ORDER: readonly PartyChannel[] = ["email", "sms", "whatsapp"];
const ENTRY = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([esw]{1,3})$/u;

/** The parameter's value for a party's seats; seats reached by nothing are left out. */
export function partyReachedParam(
  seats: readonly { bookingId: string; reached: readonly PartyChannel[] }[],
): string {
  return seats
    .filter((seat) => seat.reached.length > 0)
    .map(
      (seat) =>
        `${seat.bookingId}.${ORDER.filter((channel) => seat.reached.includes(channel))
          .map((channel) => LETTER[channel])
          .join("")}`,
    )
    .join(",");
}

/**
 * The parameter read back: each reached seat's channels, email first. Null
 * when there is no parameter (the landing was not reached from an add). An
 * entry that is not a booking id and channel letters is skipped.
 */
export function readPartyReached(
  param: string | undefined,
): ReadonlyMap<string, PartyChannel[]> | null {
  if (param === undefined) return null;
  const reached = new Map<string, PartyChannel[]>();
  for (const entry of param.split(",")) {
    const match = ENTRY.exec(entry.trim().toLowerCase());
    if (!match?.[1] || !match[2]) continue;
    const letters = match[2];
    reached.set(
      match[1],
      ORDER.filter((channel) => letters.includes(LETTER[channel])),
    );
  }
  return reached;
}
