import { and, eq, inArray, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { type AboardBlockerKind, aboardBlockerKind } from "@/lib/readiness";
import { inHorizonReadiness } from "./blockers";
import type { AppDb } from "./client";
import { bookings, orders, priorVisits, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **The four facts a roster row carries beside a name** — ADR
 * 20260827-people-not-lists, decision 2: the roster is one ledger whose rows
 * are "name (the row is the door) + only exceptional badges + quiet last-visit
 * fact".
 *
 * Nothing existing supplied them. `listDiverSummaries` counted certification
 * cards, which is what the retired Level and Needs-attention columns were made
 * of; the row now says when this diver was last on a boat, when they are next
 * on one, and — exceptionally — that they cannot board it or that an invoice
 * is standing open.
 *
 * **No second detector.** `blocker` comes out of the same
 * `inHorizonReadiness` pass the Today queue and the nav badge read, reduced
 * per person by `aboardBlockerKind` — the same worst-first reduction the day
 * spine's station rows use. A roster that computed "blocked" its own way would
 * be a third answer to a question two surfaces already agree on.
 */
export type RosterFacts = {
  /** The latest departure this diver actually sailed on, or null. */
  lastAboardAt: Date | null;
  /** The soonest departure still ahead of them, or null. */
  nextBookingAt: Date | null;
  /**
   * Their whole history came across from another system: prior visits on file
   * and not one booking here. The row says so rather than reading as a diver
   * who has never been out (ADR 20260725-import-prior-visits).
   */
  importedOnly: boolean;
  /** An invoice raised against this diver is still `open`. */
  openBalance: boolean;
  /** Why they cannot board the departure they are on, worst-first — or null. */
  blocker: AboardBlockerKind | null;
};

const EMPTY: RosterFacts = {
  lastAboardAt: null,
  nextBookingAt: null,
  importedOnly: false,
  openBalance: false,
  blocker: null,
};

/**
 * The standing late-arrival buffer (AGENTS.md): a boat that left at 7:00 is
 * not "in the past" at 7:05. The same hour the diver record's own story split
 * uses (`[personId]/_lib/status.ts`), so a departure cannot read as ahead on
 * one surface and behind on the other.
 */
const DEPARTURE_BUFFER_MS = 60 * 60 * 1000;

/**
 * Every roster fact for one page of divers, in four batched reads plus the
 * shared readiness pass.
 *
 * `personIds` is a page, never the roster: the caller hands in the ~25 ids
 * `listDiverSummaries` just returned, and the four queries are all
 * `inArray`-bounded by it. The readiness pass is the exception and is
 * deliberately shop-wide — it is keyed by departure rather than by person, and
 * it is the *same* call the staff shell's blocked-diver badge already makes,
 * so narrowing it here would mean a second, differently-scoped answer to
 * "who is blocked".
 *
 * `now` rather than a timezone: nothing decided here is calendar-day
 * granular. Which side of the buffer a departure falls on is an instant
 * comparison, and the words a row is set in — "last aboard Wed, Aug 26" — are
 * formatted by the surface in the shop's own zone.
 */
export async function rosterFacts(
  db: AppDb,
  shopId: string,
  personIds: readonly string[],
  options: { now?: Date } = {},
): Promise<Map<string, RosterFacts>> {
  const facts = new Map<string, RosterFacts>();
  if (personIds.length === 0) return facts;
  const now = options.now ?? nowDate();
  const ids = [...personIds];

  const [seats, visits, openOrders, evidence] = await Promise.all([
    db
      .select({ personId: bookings.personId, startsAt: trips.startsAt })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(bookings.shopId, shopId),
          inArray(bookings.personId, ids),
          ne(bookings.status, "cancelled"),
          // A cancelled departure is not a visit and not a booking ahead —
          // it is the thing that stopped being either.
          eq(trips.status, "scheduled"),
          liveTrip(),
        ),
      ),
    db
      .select({ personId: priorVisits.personId })
      .from(priorVisits)
      .where(and(eq(priorVisits.shopId, shopId), inArray(priorVisits.personId, ids))),
    // "Open balance" is a *raised* invoice still standing open — the narrower
    // half of the record's own money reading (`unpaidBookingCount`, which also
    // counts an un-invoiced counter seat sitting at `unpaid`). Deliberately the
    // narrow one: this badge is read in a scan of a hundred names, and the
    // fact it has to be true about is "somebody was billed and has not paid".
    db
      .select({ personId: orders.personId })
      .from(orders)
      .where(
        and(eq(orders.shopId, shopId), inArray(orders.personId, ids), eq(orders.status, "open")),
      ),
    inHorizonReadiness(db, shopId, now),
  ]);

  const importedIds = new Set(visits.map((row) => row.personId));
  const owingIds = new Set(openOrders.map((row) => row.personId));

  // Every seat in the horizon that cannot board. A diver is pooled across all
  // of them before being reduced — so a person blocked on Thursday for a card
  // and on Friday for a medical hold reads as the medical hold. Pooling and
  // then calling `aboardBlockerKind` once keeps the worst-first ordering in the
  // one place that owns it (`ABOARD_KIND_ORDER`, src/lib/readiness.ts) rather
  // than re-spelling it as a comparator here.
  const blockedSeats = evidence.trips.flatMap((trip) =>
    (evidence.readinessByTrip.get(trip.id) ?? []).filter(
      (row) => row.readiness.status === "blocked",
    ),
  );

  for (const id of ids) facts.set(id, { ...EMPTY });
  for (const seat of seats) {
    const entry = facts.get(seat.personId);
    if (!entry) continue;
    const ahead = seat.startsAt.getTime() + DEPARTURE_BUFFER_MS >= now.getTime();
    if (ahead) {
      if (!entry.nextBookingAt || seat.startsAt < entry.nextBookingAt) {
        entry.nextBookingAt = seat.startsAt;
      }
    } else if (!entry.lastAboardAt || seat.startsAt > entry.lastAboardAt) {
      entry.lastAboardAt = seat.startsAt;
    }
  }
  const seated = new Set(seats.map((seat) => seat.personId));
  for (const id of ids) {
    const entry = facts.get(id);
    if (!entry) continue;
    entry.importedOnly = importedIds.has(id) && !seated.has(id);
    entry.openBalance = owingIds.has(id);
    entry.blocker = aboardBlockerKind(
      blockedSeats.filter((row) => row.person.id === id).flatMap((row) => row.readiness.blockers),
    );
  }
  return facts;
}
