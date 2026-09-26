import { BoatMarkRow } from "./BoatMarkRow";

/**
 * **The boat's own line on the diver's link** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 4.
 *
 * What the crew said, and when. Deliberately not an earned moment: the thread
 * spends coral exactly three times (booked, waiver complete, welcome home; ADR
 * 20260827-the-divers-thread), and a boat being out is none of them. Plain
 * ink, one drawing, no second claim about status — `ThreadStatus` says the
 * status, once, and this says where the boat is.
 *
 * Drawn by `BoatMarkRow`, the row the share row under it draws too (K-155).
 */
export function BoatStageLine({ sentence, said }: { sentence: string; said: string }) {
  return <BoatMarkRow line={sentence} detail={said} />;
}
