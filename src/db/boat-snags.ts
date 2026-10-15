import { and, asc, eq, gt, inArray, isNull, lte, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { SNAG_NOTE_MAX } from "@/lib/pre-departure-check";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { publishManifestEvent } from "./manifest-events";
import { boatSnags, boats, people, preDepartureChecklistItems, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **Snags: what one crew tells the next about a boat** (fifth-loop ideas,
 * item 1; glossary "Snag").
 *
 * A captain at 5:15 finds the VHF crackling on 16 and writes it against the
 * checklist line it belongs to. The afternoon crew on the same hull read it
 * above their own checklist before they sail, and say "Fixed" or "Still
 * there". The owner's Today carries one row per snag still open.
 *
 * Informs, never gates (ADR 20260824-pre-departure-safety-check): nothing here
 * refuses a departure, a check or a roll call.
 */

export type SnagWriteOutcome =
  | { ok: true; snagId: string }
  | {
      ok: false;
      reason:
        | "staff_not_found"
        | "trip_unavailable"
        | "no_boat"
        | "item_unavailable"
        | "note_invalid"
        | "snag_unavailable";
    };

async function activeStaff(tx: DbExecutor, shopId: string, personId: string): Promise<boolean> {
  const roles = await loadActiveStaffRoles(tx, shopId, personId);
  return Boolean(roles && isStaff(roles));
}

/** The live departure and its boat, or why there is nothing to hang a snag on. */
async function tripBoat(
  tx: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<{ boatId: string; startsAt: Date } | "trip_unavailable" | "no_boat"> {
  const [trip] = await tx
    .select({ boatId: trips.boatId, startsAt: trips.startsAt })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!trip) return "trip_unavailable";
  return trip.boatId ? { boatId: trip.boatId, startsAt: trip.startsAt } : "no_boat";
}

/**
 * Write one snag against one checklist line on this departure's boat. A
 * departure with no boat has nobody to hand the note to, so it is refused
 * (`no_boat`) rather than kept where no next crew would read it.
 */
export async function noteSnag(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    checklistItemId: string;
    personId: string;
    note: string;
  },
): Promise<SnagWriteOutcome> {
  const note = input.note.trim();
  if (note.length === 0 || note.length > SNAG_NOTE_MAX)
    return { ok: false, reason: "note_invalid" };
  const outcome = await db.transaction(async (tx): Promise<SnagWriteOutcome> => {
    if (!(await activeStaff(tx, input.shopId, input.personId))) {
      return { ok: false, reason: "staff_not_found" };
    }
    const boat = await tripBoat(tx, input.shopId, input.tripId);
    if (typeof boat === "string") return { ok: false, reason: boat };
    const [item] = await tx
      .select({ id: preDepartureChecklistItems.id })
      .from(preDepartureChecklistItems)
      .where(
        and(
          eq(preDepartureChecklistItems.id, input.checklistItemId),
          eq(preDepartureChecklistItems.shopId, input.shopId),
          isNull(preDepartureChecklistItems.deletedAt),
        ),
      )
      .limit(1);
    if (!item) return { ok: false, reason: "item_unavailable" };
    const [row] = await tx
      .insert(boatSnags)
      .values({
        shopId: input.shopId,
        boatId: boat.boatId,
        checklistItemId: item.id,
        notedOnTripId: input.tripId,
        note,
        notedByPersonId: input.personId,
        notedAt: nowDate(),
      })
      .returning({ id: boatSnags.id });
    if (!row) throw new Error("noteSnag: insert returned no row");
    return { ok: true, snagId: row.id };
  });
  if (outcome.ok) await publishManifestEvent(db, input.shopId, input.tripId);
  return outcome;
}

/**
 * The next crew's answer: **Fixed** closes the snag for good, **Still there**
 * keeps it open and says who looked last. Only an open snag on this
 * departure's own boat can be answered from it, so a stale page or a forged id
 * cannot close another hull's problem.
 */
export async function answerSnag(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    snagId: string;
    personId: string;
    answer: "fixed" | "still_there";
  },
): Promise<SnagWriteOutcome> {
  const outcome = await db.transaction(async (tx): Promise<SnagWriteOutcome> => {
    if (!(await activeStaff(tx, input.shopId, input.personId))) {
      return { ok: false, reason: "staff_not_found" };
    }
    const boat = await tripBoat(tx, input.shopId, input.tripId);
    if (typeof boat === "string") return { ok: false, reason: boat };
    const now = nowDate();
    const [row] = await tx
      .update(boatSnags)
      .set(
        input.answer === "fixed"
          ? {
              fixedAt: now,
              fixedByPersonId: input.personId,
              fixedOnTripId: input.tripId,
              updatedAt: now,
            }
          : {
              stillThereAt: now,
              stillThereByPersonId: input.personId,
              stillThereOnTripId: input.tripId,
              updatedAt: now,
            },
      )
      .where(
        and(
          eq(boatSnags.id, input.snagId),
          eq(boatSnags.shopId, input.shopId),
          eq(boatSnags.boatId, boat.boatId),
          isNull(boatSnags.fixedAt),
        ),
      )
      .returning({ id: boatSnags.id });
    return row ? { ok: true, snagId: row.id } : { ok: false, reason: "snag_unavailable" };
  });
  if (outcome.ok) await publishManifestEvent(db, input.shopId, input.tripId);
  return outcome;
}

export type OpenSnag = {
  id: string;
  checklistItemId: string;
  itemLabel: string;
  note: string;
  notedByName: string;
  notedAt: Date;
  /** Written on the departure being read, rather than carried to it. */
  notedHere: boolean;
  /** The newest crew who looked and found it still there. */
  stillThere: { byName: string; at: Date } | null;
};

const stillThereBy = alias(people, "still_there_by");
const notedOn = alias(trips, "noted_on");

/**
 * The snags still open on this departure's boat, oldest first: the ones its
 * own crew wrote, and the ones an earlier departure of the same boat handed
 * on. A departure that sailed before a snag was written does not wear it.
 * Empty for a departure with no boat.
 */
export async function openSnagsForTrip(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<OpenSnag[]> {
  const boat = await tripBoat(db, shopId, tripId);
  if (typeof boat === "string") return [];
  const rows = await db
    .select({
      id: boatSnags.id,
      checklistItemId: boatSnags.checklistItemId,
      itemLabel: preDepartureChecklistItems.label,
      note: boatSnags.note,
      notedByName: people.fullName,
      notedAt: boatSnags.notedAt,
      notedOnTripId: boatSnags.notedOnTripId,
      stillThereByName: stillThereBy.fullName,
      stillThereAt: boatSnags.stillThereAt,
    })
    .from(boatSnags)
    .innerJoin(
      preDepartureChecklistItems,
      eq(preDepartureChecklistItems.id, boatSnags.checklistItemId),
    )
    .innerJoin(people, eq(people.id, boatSnags.notedByPersonId))
    .leftJoin(stillThereBy, eq(stillThereBy.id, boatSnags.stillThereByPersonId))
    // diveday:allow-deleted-trips: the departure a snag was written on dates it; the boat's problem outlives a deleted departure.
    .innerJoin(notedOn, eq(notedOn.id, boatSnags.notedOnTripId))
    .where(
      and(
        eq(boatSnags.shopId, shopId),
        eq(boatSnags.boatId, boat.boatId),
        isNull(boatSnags.fixedAt),
        lte(notedOn.startsAt, boat.startsAt),
      ),
    )
    .orderBy(asc(boatSnags.notedAt), asc(boatSnags.id));
  return rows.map((row) => ({
    id: row.id,
    checklistItemId: row.checklistItemId,
    itemLabel: row.itemLabel,
    note: row.note,
    notedByName: row.notedByName,
    notedAt: row.notedAt,
    notedHere: row.notedOnTripId === tripId,
    stillThere:
      row.stillThereAt && row.stillThereByName
        ? { byName: row.stillThereByName, at: row.stillThereAt }
        : null,
  }));
}

export type ShopOpenSnag = {
  id: string;
  boatName: string;
  itemLabel: string;
  note: string;
  notedByName: string;
  notedAt: Date;
  /** Departures of this boat that have sailed since the one it was written on. */
  departuresSince: number;
  /** The boat's next departure still to sail, where the crew will read it. */
  next: { tripId: string; startsAt: Date } | null;
  /** Where the snag was written, the door when the boat has nothing ahead. */
  notedOnTripId: string;
};

/**
 * Every open snag in the shop, for the owner's Today: one row each, naming
 * the boat, the line and who wrote it, how many departures have sailed with
 * it since, and the boat's next departure. Bounded: a shop with a hundred open
 * snags has a different problem, and Today shows the oldest fifty.
 */
export async function openSnagsForShop(
  db: DbExecutor,
  shopId: string,
  now: Date,
): Promise<ShopOpenSnag[]> {
  const rows = await db
    .select({
      id: boatSnags.id,
      boatId: boatSnags.boatId,
      boatName: boats.name,
      itemLabel: preDepartureChecklistItems.label,
      note: boatSnags.note,
      notedByName: people.fullName,
      notedAt: boatSnags.notedAt,
      notedOnTripId: boatSnags.notedOnTripId,
      notedOnStartsAt: notedOn.startsAt,
    })
    .from(boatSnags)
    .innerJoin(boats, and(eq(boats.id, boatSnags.boatId), isNull(boats.deletedAt)))
    .innerJoin(
      preDepartureChecklistItems,
      eq(preDepartureChecklistItems.id, boatSnags.checklistItemId),
    )
    .innerJoin(people, eq(people.id, boatSnags.notedByPersonId))
    // diveday:allow-deleted-trips: the departure a snag was written on dates it; the boat's problem outlives a deleted departure.
    .innerJoin(notedOn, eq(notedOn.id, boatSnags.notedOnTripId))
    .where(and(eq(boatSnags.shopId, shopId), isNull(boatSnags.fixedAt)))
    .orderBy(asc(boatSnags.notedAt), asc(boatSnags.id))
    .limit(50);
  if (rows.length === 0) return [];
  const boatIds = [...new Set(rows.map((row) => row.boatId))];
  // The boats' departures since the oldest snag, once for every snag: a
  // count and a next departure each are a walk of this one short list.
  const oldest = rows.reduce(
    (min, row) => (row.notedOnStartsAt < min ? row.notedOnStartsAt : min),
    rows[0]?.notedOnStartsAt ?? now,
  );
  const departures = await db
    .select({ id: trips.id, boatId: trips.boatId, startsAt: trips.startsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        inArray(trips.boatId, boatIds),
        gt(trips.startsAt, oldest),
        ne(trips.status, "cancelled"),
        liveTrip(),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(trips.id));
  return rows.map((row) => {
    const own = departures.filter(
      (trip) => trip.boatId === row.boatId && trip.startsAt > row.notedOnStartsAt,
    );
    const next = own.find((trip) => trip.startsAt > now) ?? null;
    return {
      id: row.id,
      boatName: row.boatName,
      itemLabel: row.itemLabel,
      note: row.note,
      notedByName: row.notedByName,
      notedAt: row.notedAt,
      departuresSince: own.filter((trip) => trip.startsAt <= now).length,
      next: next ? { tripId: next.id, startsAt: next.startsAt } : null,
      notedOnTripId: row.notedOnTripId,
    };
  });
}
