import { eq } from "drizzle-orm";
import { unseededTestDb } from "@/test/db";
import type { AppDb } from "./client";
import { createGearItem } from "./gear";
import { createCounterRental } from "./gear-counter-rentals";
import {
  certifications,
  type GearItemKindValue,
  gearReservations,
  people,
  personRoles,
  shops,
  userAccounts,
} from "./schema";

/** Shared by `gear-counter-rentals.test.ts` and `gear-counter-rentals.screens.test.ts`. */

/** A setup reservation: a hand pick whose staffer already said "Assign anyway". */
export const SETUP_PICK = { proposed: false, assignAnyway: true } as const;

export const TODAY = "2026-10-08";

/**
 * Every test gets a fresh database rather than the per-file rolled-back
 * transaction: a counter rental is identified by the stamp Postgres gives its
 * transaction, and inside one long test transaction every `now()` is the same
 * instant, which would fold two rentals into one.
 */
export async function rentalShop(slug = "counter-test") {
  const db = await unseededTestDb();
  const shop = await insertShop(db, slug);
  return { db, shop };
}

export async function insertShop(db: AppDb, slug: string) {
  const [shop] = await db
    .insert(shops)
    .values({ name: `Shop ${slug}`, slug, timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("shop insert failed");
  return shop;
}

/**
 * A person on file. Each carries a verified Open Water card unless told
 * otherwise, because most of these tests lend life support and are about
 * something other than the card rule (that has its own block below).
 */
export async function person(
  db: AppDb,
  shopId: string,
  fullName: string,
  email?: string,
  options: { card?: boolean } = {},
) {
  const [row] = await db
    .insert(people)
    .values({ shopId, fullName, email: email ?? null })
    .returning();
  if (!row) throw new Error("person insert failed");
  await db.insert(personRoles).values({ personId: row.id, role: "diver" });
  if (options.card ?? true) {
    await db.insert(certifications).values({
      shopId,
      personId: row.id,
      agency: "padi",
      level: "open_water",
      identifier: `OW-${row.id.slice(0, 8)}`,
      status: "verified",
    });
  }
  return row;
}

export async function unit(
  db: AppDb,
  shopId: string,
  label: string,
  kind: GearItemKindValue = "bcd",
) {
  const created = await createGearItem(db, { shopId, kind, label, size: "M" });
  if (!created.ok) throw new Error(`unit refused: ${created.reason}`);
  return created.item;
}

export function rented(outcome: Awaited<ReturnType<typeof createCounterRental>>) {
  if (!outcome.ok) throw new Error(`rental refused: ${outcome.reason}`);
  return outcome;
}

/** Lend these units to this person for today alone. */
export function lend(
  db: AppDb,
  shopId: string,
  personId: string,
  gearItemIds: string[],
  extra: {
    reservedUntil?: string;
    confirmedFlaggedIds?: string[];
    tankFills?: Record<string, number>;
    fillRecordedByPersonId?: string;
  } = {},
) {
  return createCounterRental(db, {
    shopId,
    personId,
    gearItemIds,
    reservedFrom: TODAY,
    reservedUntil: extra.reservedUntil ?? TODAY,
    todayLocal: TODAY,
    confirmedFlaggedIds: extra.confirmedFlaggedIds,
    tankFills: extra.tankFills,
    fillRecordedByPersonId: extra.fillRecordedByPersonId,
  });
}

export async function heldBy(db: AppDb, personId: string) {
  return db.select().from(gearReservations).where(eq(gearReservations.personId, personId));
}

export async function staffer(db: AppDb, shopId: string) {
  const [row] = await db.insert(people).values({ shopId, fullName: "Dana Desk" }).returning();
  if (!row) throw new Error("staff insert failed");
  await db.insert(personRoles).values({ personId: row.id, role: "owner" });
  await db.insert(userAccounts).values({
    personId: row.id,
    email: `dana.${row.id.slice(0, 8)}@example.com`,
    hashedPassword: "x",
    status: "active",
  });
  return row;
}
