import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { calendarDateInTimezone, shiftCalendarDate } from "@/lib/calendar-date";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS } from "@/lib/fly-safe";
import { PLAN_CHANGE_NOTE_MAX, type PlanChangeReason } from "@/lib/plan-change";
import { standingArrivalIsArrived } from "./arrival-provenance";
import type { AppDb, DbExecutor } from "./client";
import { recordDeskEvent } from "./desk-events";
import { isMarineLifeSlug } from "./marine-life-catalog";
import { bookings, diveSites, executedDives, people, tripDives, trips } from "./schema";
import { liveTrip } from "./trips-live";

export type ExecutedDiveInput = {
  shopId: string;
  tripId: string;
  diveNumber: number;
  actualSiteId?: string | null;
  enteredAt?: Date | null;
  exitedAt?: Date | null;
  maxDepthMeters?: number | null;
  observedConditions?: Record<string, unknown> | null;
  notRecorded?: string[];
  /**
   * One species the crew saw, as a `MARINE_LIFE_CATALOG` slug (issue #1190).
   *
   * Absent or null clears it — like every other field here, this upsert
   * replaces the row rather than patching it, so the form always sends the
   * whole record and "unset" is a real answer a crew can give. A slug the
   * catalog does not carry is dropped rather than refused; see the note beside
   * the check for why an ornament may not cost the dive record.
   */
  observedSpeciesSlug?: string | null;
  /**
   * Why the actual site is not the planned one (issue #1184). Absent or null
   * clears it, like every other field on this replacing upsert.
   */
  planChangeReason?: PlanChangeReason | null;
  /**
   * A short staff-only note beside that reason. Blank trims to null; a note
   * with no reason is refused rather than stored, which is what keeps this
   * from becoming the second staff chat D27's boundary rules out.
   */
  planChangeNote?: string | null;
  recordedByPersonId: string;
};

export async function listExecutedDives(db: DbExecutor, shopId: string, tripId: string) {
  return db
    .select({
      executed: executedDives,
      actualSite: diveSites,
      recorder: { id: people.id, name: people.fullName },
    })
    .from(executedDives)
    .innerJoin(trips, eq(trips.id, executedDives.tripId))
    .leftJoin(diveSites, eq(diveSites.id, executedDives.actualSiteId))
    .leftJoin(people, eq(people.id, executedDives.recordedByPersonId))
    .where(
      and(
        eq(executedDives.shopId, shopId),
        eq(executedDives.tripId, tripId),
        eq(trips.shopId, shopId),
        liveTrip(),
        isNull(executedDives.deletedAt),
      ),
    )
    .orderBy(asc(executedDives.diveNumber));
}

/**
 * Which of these people already had a **dive day** at this shop in the local
 * days before a departure — the "multiple days of diving" half of DAN's
 * 18-hour preflight clause (issue #1439; the reading of it is in
 * `src/lib/fly-safe.ts`).
 *
 * A `Set` rather than a boolean because the recap run answers a whole boat at
 * once, and this must stay **one query per departure**, never one per booking.
 *
 * **Local calendar days, not a span of hours.** DAN's clause is about days,
 * and counting hours got all three of these wrong: two 8 AM departures on
 * consecutive days are exactly 24 hours apart, so a schedule that slips
 * fifteen minutes for the tide decides the answer; the same two are 25
 * absolute hours apart across a fall-back boundary, so every two-day diver at
 * a US shop would quietly drop to the shorter advice on one Sunday in
 * November; and a Monday-morning to Tuesday-afternoon pair is 30 hours and
 * unambiguously multiple days of diving. Asked as calendar days in the shop's
 * own zone, all three answer correctly and the question is DAN's own.
 *
 * **A booking on a departure that ran is the evidence, not a dive log row.**
 * Crews do not reliably log: `flySafeFrom` exists in its current shape
 * precisely because it has to answer from `planned_dives` when nothing was
 * recorded. Requiring a row here would have made today's boat speak from the
 * plan and yesterday's fall silent — which at a busy dock is the *normal*
 * case, and it fails toward the shorter advice. So the rule is the one
 * `src/db/recap.ts` already uses for the prior-visit count: a live booking,
 * on a live departure the shop still says ran.
 */
export async function peopleWhoDivedBefore(
  db: DbExecutor,
  shopId: string,
  personIds: readonly string[],
  departureStartsAt: Date,
  timeZone: string,
): Promise<Set<string>> {
  // Nobody to ask about: skip the round trip. Drizzle answers an empty
  // `inArray` with no rows rather than an error, so this is speed, not
  // correctness — the recap run reaches this for every departure whose roster
  // is entirely cancelled.
  if (personIds.length === 0) return new Set();

  const firstDay = shiftCalendarDate(
    calendarDateInTimezone(departureStartsAt, timeZone),
    -FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS,
  );
  // The SQL bound is a deliberate *superset*, and the calendar comparison
  // below is the answer. Two days of slack rather than one because a zone's
  // offset reaches ±14 hours and a local day can straddle two UTC ones, so one
  // day of margin is on the edge in the extreme zones rather than clear of it.
  // Doing it this way keeps the zone arithmetic in `calendar-date.ts`, where
  // it is tested, rather than reconstructing a local midnight inside a query.
  const slack = (FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS + 2) * 24 * HOUR_MS;
  const rows = await db
    .select({ personId: bookings.personId, startsAt: trips.startsAt })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    // Only to let a logged dive speak for a departure the shop later marked
    // something other than `scheduled` — see the status filter below.
    .leftJoin(
      executedDives,
      and(
        eq(executedDives.tripId, trips.id),
        eq(executedDives.shopId, shopId),
        isNull(executedDives.deletedAt),
      ),
    )
    .where(
      and(
        // Both tables scoped, not only the one this read starts from: a
        // diver-facing answer must not be reachable from another shop's row
        // by any path.
        eq(bookings.shopId, shopId),
        eq(trips.shopId, shopId),
        inArray(bookings.personId, [...personIds]),
        // A diver who cancelled was not aboard, whatever the crew recorded for
        // the boat. Crediting them would hand them the longer wait for a day
        // they spent ashore.
        ne(bookings.status, "cancelled"),
        // **A no-show still excludes — unless the desk saw them** (issue
        // #1558). Why the append-only trail outranks the status slot, and what
        // an undo does to it, is argued once on `standingArrivalIsArrived`
        // (`src/db/arrival-provenance.ts`); this is the reader that asks.
        //
        // What is local to here is *which* status gets the escape.
        // `cancelled` deliberately gets none. A cancellation is a
        // re-papering of the sale — it can land days later, on a seat somebody
        // really did check in before the card failed — and it says nothing
        // about the dock. Only `no_show` is a claim about who turned up, which
        // is why only `no_show` can be contradicted by who turned up.
        or(ne(bookings.status, "no_show"), standingArrivalIsArrived(shopId, bookings.id, trips.id)),
        // A blown-out departure is not a dive day — a cancellation leaves its
        // bookings active by design, so without this the answer counts days
        // nobody dived. **Unless the crew logged a dive on it**, which is
        // affirmative evidence that people went in the water and beats a
        // status column changed afterwards for a refund or a re-papered
        // charter.
        or(eq(trips.status, "scheduled"), isNotNull(executedDives.id)),
        // A deleted departure is off the board, and here that reads as a row
        // staff say should not exist rather than a day to count.
        liveTrip(),
        gte(trips.startsAt, new Date(departureStartsAt.getTime() - slack)),
        lt(trips.startsAt, new Date(departureStartsAt.getTime() + slack)),
      ),
    );

  const dived = new Set<string>();
  for (const row of rows) {
    // Any departure that already sailed, from the first day of the window
    // onward. Strictly earlier than this one, because this departure's own
    // dives are the caller's to count and counting them here would make every
    // second tank of a day look like a second day — but a *morning* boat
    // counts for the afternoon one, because `flySafeFrom` sees only its own
    // departure's dives and would otherwise read a two-boat day as a single.
    if (row.startsAt.getTime() >= departureStartsAt.getTime()) continue;
    if (calendarDateInTimezone(row.startsAt, timeZone) >= firstDay) dived.add(row.personId);
  }
  return dived;
}

/**
 * Why a dive log entry was refused.
 *
 * This used to be a bare `null` for all five conditions, and the surface above
 * it swallowed that too — so a divemaster who typed 14:35 in and 14:05 out (a
 * transposition, at the rail, one-handed) got no message, an empty form, and
 * every reason to believe it had saved. What is written here is what
 * `buildIncidentExport` later reads into a sealed document for an investigator
 * or a treating physician, and a dive that silently failed to save is a hole in
 * that document nobody knows is there (issue #1018).
 */
export type ExecutedDiveRefusal =
  | "unknown_trip"
  | "dive_number_out_of_range"
  | "unknown_recorder"
  | "unknown_site"
  | "times_transposed"
  | "depth_out_of_range"
  | "plan_change_note_without_reason"
  | "plan_change_note_too_long";

export type UpsertExecutedDiveResult =
  | { ok: true; dive: typeof executedDives.$inferSelect }
  | { ok: false; reason: ExecutedDiveRefusal };

export async function upsertExecutedDive(
  db: AppDb,
  input: ExecutedDiveInput,
): Promise<UpsertExecutedDiveResult> {
  return db.transaction(async (tx): Promise<UpsertExecutedDiveResult> => {
    const [trip] = await tx
      .select({ plannedDives: trips.plannedDives })
      .from(trips)
      .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId), liveTrip()))
      .limit(1);
    if (!trip) return { ok: false, reason: "unknown_trip" };
    if (input.diveNumber < 1 || input.diveNumber > trip.plannedDives) {
      return { ok: false, reason: "dive_number_out_of_range" };
    }
    const [recorder] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.id, input.recordedByPersonId),
          eq(people.shopId, input.shopId),
          isNull(people.deletedAt),
        ),
      )
      .limit(1);
    if (!recorder) return { ok: false, reason: "unknown_recorder" };
    let actualSiteId = input.actualSiteId;
    if (actualSiteId === undefined) {
      const [planned] = await tx
        .select({ diveSiteId: tripDives.diveSiteId })
        .from(tripDives)
        .where(and(eq(tripDives.tripId, input.tripId), eq(tripDives.diveNumber, input.diveNumber)))
        .limit(1);
      actualSiteId = planned?.diveSiteId ?? null;
    }
    if (actualSiteId) {
      const [site] = await tx
        .select({ id: diveSites.id })
        .from(diveSites)
        .where(
          and(
            eq(diveSites.id, actualSiteId),
            eq(diveSites.shopId, input.shopId),
            isNull(diveSites.deletedAt),
          ),
        )
        .limit(1);
      if (!site) return { ok: false, reason: "unknown_site" };
    }
    if (input.enteredAt && input.exitedAt && input.exitedAt <= input.enteredAt) {
      return { ok: false, reason: "times_transposed" };
    }
    if (
      input.maxDepthMeters != null &&
      (!Number.isFinite(input.maxDepthMeters) || input.maxDepthMeters < 0)
    ) {
      return { ok: false, reason: "depth_out_of_range" };
    }
    // **The note is refused, not dropped** — unlike the species slug below,
    // which degrades to null rather than costing the dive record. The reason is
    // the difference between a decoration and a claim: a note explaining why
    // the boat moved, saved with no reason above it, is exactly the free-text
    // staff chat #1187's boundary rules out, and silently discarding what a
    // divemaster typed is the failure issue #1018 was about. The database check
    // says the same thing; this says it in words the crew can act on.
    const planChangeNote = input.planChangeNote?.trim() || null;
    const planChangeReasonCode = input.planChangeReason ?? null;
    if (planChangeNote && !planChangeReasonCode) {
      return { ok: false, reason: "plan_change_note_without_reason" };
    }
    if (planChangeNote && planChangeNote.length > PLAN_CHANGE_NOTE_MAX) {
      return { ok: false, reason: "plan_change_note_too_long" };
    }
    // **The catalog, not the site's field guide** — a correction to the first
    // version of this, which had it backwards (dive-domain review, 2026-09-04).
    //
    // A site's guide is a *briefing selection*: at most eight faces
    // (`MAX_SITE_CREATURES`) a shop picks because that reef shows them
    // reliably, chosen to tell a diver what to expect. Molasses Reef's is
    // stoplight parrotfish, French angelfish, blue tang, southern stingray,
    // elkhorn coral, yellowtail snapper. The catalog also carries the spotted
    // eagle ray, the whale shark, the nurse shark, the goliath grouper — and
    // none of those are on anybody's eight, because no shop promises a whale
    // shark in a briefing.
    //
    // So constraining a *sighting* to the guide admitted the mundane and
    // refused the memorable: a divemaster could record "we saw blue tang" and
    // not "we saw an eagle ray". Nobody climbs the ladder talking about the
    // blue tang. The whole reason a sighting is worth writing down is that it
    // was not the usual, and the person who was in the water is a far better
    // witness than a marketing list of eight.
    //
    // D30's boundary is about *derivation* — never infer a sighting from a
    // site's usual life — and a catalog-wide domain satisfies it completely,
    // because the sighting still only exists when a crew member wrote it down.
    // A species DiveDay does not carry at all is still refused, and that ask
    // has its own home in `marine_life_requests`.
    //
    // **An unusable slug does not cost the dive record.** This is checked
    // *after* the row is assembled and degrades to null rather than returning,
    // because entry time, exit time and max depth are what `buildIncidentExport`
    // seals for an investigator or a treating physician. A decorative field
    // must never be able to open a hole in that document — which is what an
    // early return did, on a form a divemaster fills in at the rail.
    const observedSpeciesSlug =
      input.observedSpeciesSlug && isMarineLifeSlug(input.observedSpeciesSlug)
        ? input.observedSpeciesSlug
        : null;

    const values = {
      shopId: input.shopId,
      tripId: input.tripId,
      diveNumber: input.diveNumber,
      actualSiteId,
      enteredAt: input.enteredAt ?? null,
      exitedAt: input.exitedAt ?? null,
      maxDepthMeters: input.maxDepthMeters ?? null,
      observedConditions: input.observedConditions
        ? Object.fromEntries(
            Object.entries(input.observedConditions).filter(
              ([key, value]) =>
                (key === "visibility" || key === "current") &&
                typeof value === "string" &&
                value.length <= 120,
            ),
          )
        : null,
      notRecorded: [...new Set(input.notRecorded ?? [])].filter((value) => value === "depth"),
      observedSpeciesSlug: observedSpeciesSlug ?? null,
      planChangeReason: planChangeReasonCode,
      // A note cannot outlive the reason it explains: clearing the reason
      // clears it, which is the same rule the table's own check states.
      planChangeNote: planChangeReasonCode ? planChangeNote : null,
      recordedByPersonId: recorder.id,
      updatedAt: nowDate(),
    };
    // One statement, not select-then-insert. Two divemasters writing the same
    // dive number at the rail is a real sequence, and the select this replaced
    // was not a lock: the loser hit `executed_dives_trip_number_live_unique`
    // and escaped as a 500 on the manifest. `on conflict` targets that partial
    // index directly, so the second write lands on the first one's row instead
    // of racing it -- and needs no savepoint, which catching the violation
    // inside this transaction would have (see `rewindowTripGearReservations`).
    const [row] = await tx
      .insert(executedDives)
      .values(values)
      .onConflictDoUpdate({
        target: [executedDives.tripId, executedDives.diveNumber],
        targetWhere: isNull(executedDives.deletedAt),
        set: values,
      })
      .returning();
    // The upsert targets a partial unique index and always writes a row; a
    // missing one is not a refusal anyone can act on, so it stays the
    // unknown-trip answer rather than inventing a sixth reason.
    if (!row) return { ok: false, reason: "unknown_trip" };
    // The crew who were not on this dive read "The dive plan changed." on the
    // manifest's catch-up strip (issue #1202). Written inside this transaction
    // so a handoff line can never go missing from a save that succeeded, and
    // written on any save carrying a reason: a second save of the same dive
    // groups into the same one sentence, and the person who saved it never sees
    // their own act.
    if (planChangeReasonCode) {
      await recordDeskEvent(tx, {
        shopId: input.shopId,
        tripId: input.tripId,
        kind: "plan_changed",
        actorPersonId: recorder.id,
      });
    }
    return { ok: true, dive: row };
  });
}

export async function deleteExecutedDive(
  db: DbExecutor,
  input: { shopId: string; tripId: string; diveNumber: number; deletedByPersonId: string },
) {
  const [row] = await db
    .update(executedDives)
    .set({ deletedAt: nowDate(), deletedByPersonId: input.deletedByPersonId, updatedAt: nowDate() })
    .where(
      and(
        eq(executedDives.shopId, input.shopId),
        eq(executedDives.tripId, input.tripId),
        eq(executedDives.diveNumber, input.diveNumber),
        isNull(executedDives.deletedAt),
      ),
    )
    .returning({ id: executedDives.id });
  return Boolean(row);
}
