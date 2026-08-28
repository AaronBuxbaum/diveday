import type { AppDb } from "@/db/client";
import { getDiverProfile } from "@/db/divers";
import { getBookingReadiness } from "@/db/readiness";
import { nowDate } from "@/lib/clock";
import type { DiverProfile } from "../_components/shared";
import { buildDiverStatus, type DiverStatusRow, nextBookingAhead } from "./status";

/**
 * The database half of the status ledger: read the readiness of the departure
 * this diver is next on, and hand it to the pure {@link buildDiverStatus}.
 *
 * `getBookingReadiness` is the existing entry the Today queue and the manifest
 * read — `listTripReadiness` composed with `getTripSiteRequirement` — so this
 * page can never disagree with the boat about who is cleared. There is
 * deliberately no second detector here (ADR 20260827-people-not-lists).
 */
export async function diverStatusRows(
  db: AppDb,
  shopId: string,
  diver: DiverProfile,
  now: Date = nowDate(),
): Promise<DiverStatusRow[]> {
  const next = nextBookingAhead(diver, now);
  const readiness = next ? await getBookingReadiness(db, shopId, next.booking.id) : null;
  return buildDiverStatus(diver, readiness, { now });
}

/**
 * **Whether that was the last thing** — asked *after* a mutation, by the
 * actions that can resolve the final open item (ADR
 * 20260827-clearwater-surface-language, decision 11: every coral moment is
 * condition-derived and transient, never stored).
 *
 * Re-reads the record rather than reasoning from what the action just wrote,
 * because "nothing is waiting" is a claim about the whole record and a card
 * verified two tabs ago is exactly the fact a local guess would miss. Costs one
 * profile read on the success path of four actions.
 *
 * Fails closed to `false`: a record we could not read is not a record we say is
 * clear.
 */
export async function diverRecordIsClear(
  db: AppDb,
  shopId: string,
  personId: string,
  now: Date = nowDate(),
): Promise<boolean> {
  const diver = await getDiverProfile(db, shopId, personId, { includeRemoved: true });
  if (!diver) return false;
  return (await diverStatusRows(db, shopId, diver, now)).length === 0;
}
