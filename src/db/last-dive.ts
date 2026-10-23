import { and, eq, isNull, lt, max, ne } from "drizzle-orm";
import { type CalendarDate, calendarDateInTimezone } from "@/lib/calendar-date";
import { priorVisitStanding } from "@/lib/prior-visits";
import type { AppDb, DbExecutor } from "./client";
import { numberedDiveDay } from "./dive-days";
import { queryAll } from "./query-helpers";
import { bookings, people, priorVisits, shops, trips } from "./schema";
import { livePerson } from "./trips-live";

/**
 * **When this diver last dived, as far as the shop knows** (Aaron,
 * 2026-10-23; ADR 20261023-last-known-dive).
 *
 * Three sources, and the record shows the latest of them:
 *
 * - `recorded`: the day a staff member wrote on the record
 *   (`people.last_dive_on`) — a dive anywhere, off a logbook or a computer;
 * - `withShop`: the diver's own last dive day with the shop, by the one rule
 *   every reader of dive days uses (`numberedDiveDay`), on a departure that
 *   has already left;
 * - `imported`: the latest visit the importer brought across.
 *
 * Taking the latest is what makes a trip with the shop move the date forward
 * without anybody typing it, and what keeps an older note from moving it
 * back. Nothing gates on any of it.
 */
export type LastKnownDive = {
  /** The latest of the three, or null when the shop knows of no dive at all. */
  on: CalendarDate | null;
  source: "recorded" | "with_shop" | "imported" | null;
  recorded: CalendarDate | null;
  withShop: CalendarDate | null;
  imported: CalendarDate | null;
};

/** The latest of the three, a recorded day first on a tie (it is the one staff can change). */
export function latestKnownDive(
  input: Pick<LastKnownDive, "recorded" | "withShop" | "imported">,
): Pick<LastKnownDive, "on" | "source"> {
  const candidates: [CalendarDate | null, LastKnownDive["source"]][] = [
    [input.recorded, "recorded"],
    [input.withShop, "with_shop"],
    [input.imported, "imported"],
  ];
  let best: Pick<LastKnownDive, "on" | "source"> = { on: null, source: null };
  for (const [on, source] of candidates) {
    if (on && (!best.on || on > best.on)) best = { on, source };
  }
  return best;
}

/**
 * The shop's own evidence: the last dive day with it, and the last imported
 * visit that happened.
 *
 * A departure counts once it is back (`ends_at` has passed), on the day it
 * came back, so a seat nobody has checked in is not "today" at the dock and a
 * liveaboard counts its last day, not its first (dive-domain review, F5). A
 * pool session is not open water, so it never stands in for a last dive (F4).
 * An imported visit whose status says it never happened is no dive either:
 * the importer's own reading, `priorVisitStanding` (F2).
 */
async function shopEvidence(
  db: DbExecutor,
  input: { shopId: string; personId: string; timezone: string; now: Date },
): Promise<Pick<LastKnownDive, "withShop" | "imported">> {
  const [[dived], visits] = await queryAll(db, [
    () =>
      db
        .select({ endsAt: max(trips.endsAt) })
        .from(bookings)
        .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
        .where(
          and(
            eq(bookings.shopId, input.shopId),
            eq(bookings.personId, input.personId),
            lt(trips.endsAt, input.now),
            ne(trips.diveMode, "pool"),
            numberedDiveDay(),
          ),
        ),
    () =>
      db
        .select({ visitedOn: priorVisits.visitedOn, statusLabel: priorVisits.statusLabel })
        .from(priorVisits)
        .where(and(eq(priorVisits.shopId, input.shopId), eq(priorVisits.personId, input.personId))),
  ]);
  const imported = visits
    .filter((visit) => priorVisitStanding(visit.statusLabel) === "recorded")
    .map((visit) => visit.visitedOn)
    .sort()
    .at(-1);
  return {
    withShop: dived?.endsAt ? calendarDateInTimezone(new Date(dived.endsAt), input.timezone) : null,
    imported: imported ?? null,
  };
}

/**
 * The record's "Last dive". `recorded` is the person row the page already
 * holds (`people.last_dive_on`), so this reads only the shop's evidence.
 */
export async function lastKnownDive(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    timezone: string;
    now: Date;
    recorded: CalendarDate | null;
  },
): Promise<LastKnownDive> {
  const known = { recorded: input.recorded, ...(await shopEvidence(db, input)) };
  return { ...known, ...latestKnownDive(known) };
}

export type RecordLastDiveOutcome =
  | {
      ok: true;
      /** The shop's own later day, which the record goes on showing over the one saved. */
      laterWithShop?: CalendarDate;
    }
  | { ok: false; reason: "not_found" | "invalid" | "future" };

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The earliest day the box takes, enforced here too: the browser's `min` is a
 * hint, and Postgres refuses year 0 with a 500 (security review, 2026-10-23).
 */
export const EARLIEST_LAST_DIVE: CalendarDate = "1950-01-01";

/** A real calendar day, not "2026-02-30" — which Postgres would refuse with a 500. */
function isRealCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * **Write a diver's last dive anywhere**, or clear it with `on: null`.
 *
 * Refuses a day in the future (in the shop's zone). A day before the shop's
 * own evidence is still stored — it is a true fact, and if that evidence is
 * later withdrawn (a late no-show mark) the record falls back to it rather
 * than to nothing (dive-domain review, F3) — and the answer says so, because
 * the row goes on showing the later trip.
 */
export async function recordLastDive(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    on: string | null;
    now: Date;
  },
): Promise<RecordLastDiveOutcome> {
  if (input.on !== null && (!isRealCalendarDate(input.on) || input.on < EARLIEST_LAST_DIVE)) {
    return { ok: false, reason: "invalid" };
  }
  return db.transaction(async (tx) => {
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.id, input.personId),
          eq(people.shopId, input.shopId),
          livePerson(),
          isNull(people.anonymizedAt),
        ),
      )
      .limit(1)
      .for("no key update");
    if (!person) return { ok: false, reason: "not_found" } as const;
    if (input.on !== null) {
      const [shop] = await tx
        .select({ timezone: shops.timezone })
        .from(shops)
        .where(eq(shops.id, input.shopId))
        .limit(1);
      if (!shop) return { ok: false, reason: "not_found" } as const;
      if (input.on > calendarDateInTimezone(input.now, shop.timezone)) {
        return { ok: false, reason: "future" } as const;
      }
      const evidence = await shopEvidence(tx, { ...input, timezone: shop.timezone });
      const known = latestKnownDive({ recorded: null, ...evidence }).on;
      await tx.update(people).set({ lastDiveOn: input.on }).where(eq(people.id, person.id));
      return known && input.on < known ? { ok: true, laterWithShop: known } : { ok: true };
    }
    await tx.update(people).set({ lastDiveOn: null }).where(eq(people.id, person.id));
    return { ok: true } as const;
  });
}
