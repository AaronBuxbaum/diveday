// @vitest-environment node
import { and, eq, gt, isNotNull, isNull, lt, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  bookings,
  certifications,
  nitroxCertifications,
  people,
  specialtyCertifications,
  trips,
} from "./schema";

/**
 * **A verified card names who checked it, and when** — across the whole seeded
 * shop, in all three card tables.
 *
 * The columns have always existed and the app has always written them: a
 * staffer tapping "Mark certified" reaches `reviewCertification`, which takes
 * `reviewedByPersonId` from their own session, and `activity_events.actor_person_id`
 * is `NOT NULL` besides. The *seed* never did — so every carded diver in the
 * demo read back as "Certified — reviewer not recorded" on the departure log,
 * which is the page a shop opens when something has gone wrong and the one
 * place the question is actually asked (issue #625).
 *
 * That made the product look as though it did not capture the answer. It
 * captured it everywhere except in the data anybody ever looks at, which is
 * indistinguishable from not capturing it.
 *
 * This is the guard rather than a per-file assertion because the failure is
 * additive: the next seeded card is written in whichever `seed-*.ts` its
 * scenario belongs to, and nothing about writing it would prompt anyone to
 * think about a reviewer.
 */
const CARD_TABLES = [
  { name: "certifications", table: certifications },
  { name: "specialty certifications", table: specialtyCertifications },
  { name: "nitrox certifications", table: nitroxCertifications },
] as const;

/** Verified cards that are nobody's review to claim — see `seed-review.ts`. */
function notAReview(table: (typeof CARD_TABLES)[number]["table"]) {
  return and(eq(table.status, "verified"), isNull(table.importedAt), isNull(table.selfDeclaredAt));
}

async function unreviewed(db: AppDb, shopId: string, table: (typeof CARD_TABLES)[number]["table"]) {
  return db
    .select({ id: table.id, identifier: table.identifier })
    .from(table)
    .where(and(eq(table.shopId, shopId), notAReview(table), isNull(table.reviewedByPersonId)));
}

describe("the seeded shop's verified cards", () => {
  it("each name the staffer who checked them", async () => {
    const { db, shop } = await seededShopContext();
    for (const { name, table } of CARD_TABLES) {
      const rows = await unreviewed(db, shop.id, table);
      expect(
        rows.map((row) => row.identifier),
        `${name} with no reviewer`,
      ).toEqual([]);
    }
  });

  it("were checked before any boat a diver holding one has sailed on", async () => {
    // UX review 2026-10-13, item 40: the dawn boat's departure log, the page a
    // shop hands an insurer, read "reviewed by Marcus Webb" fourteen hours
    // after the boat sailed, because every seeded review was stamped at the
    // moment the seed ran.
    const { db, shop } = await seededShopContext({ history: true });
    for (const { name, table } of CARD_TABLES) {
      const late = await db
        .select({ diver: people.fullName, trip: trips.title })
        .from(table)
        .innerJoin(people, eq(people.id, table.personId))
        .innerJoin(bookings, eq(bookings.personId, table.personId))
        .innerJoin(trips, eq(trips.id, bookings.tripId))
        .where(
          and(
            eq(table.shopId, shop.id),
            notAReview(table),
            ne(bookings.status, "cancelled"),
            lt(trips.startsAt, nowDate()),
            gt(table.reviewedAt, trips.startsAt),
          ),
        );
      expect(late, `${name} reviewed after the diver sailed`).toEqual([]);
    }
  });

  it("each carry the date they were checked, so the log can state it", async () => {
    // `reviewedAt` and `reviewedByPersonId` are read as a pair by the departure
    // log: with no date it falls to "Certified" and never reaches the name.
    const { db, shop } = await seededShopContext();
    for (const { name, table } of CARD_TABLES) {
      const rows = await db
        .select({ identifier: table.identifier })
        .from(table)
        .where(and(eq(table.shopId, shop.id), notAReview(table), isNull(table.reviewedAt)));
      expect(
        rows.map((row) => row.identifier),
        `${name} with no review date`,
      ).toEqual([]);
    }
  });

  it("leaves an imported card unreviewed, because an import is not a review", async () => {
    // The other half, and the reason this is a helper rather than a column
    // default. `importedAt IS NOT NULL AND reviewedAt IS NULL` is exactly what
    // raises the "certified · confirm to clear" nudge (ADR
    // 20260725-import-specialty-cards); stamping a reviewer would silence it.
    const { db, shop } = await seededShopContext();
    const imported = await db
      .select({ reviewedAt: specialtyCertifications.reviewedAt })
      .from(specialtyCertifications)
      .where(
        and(
          eq(specialtyCertifications.shopId, shop.id),
          isNotNull(specialtyCertifications.importedAt),
        ),
      );
    expect(imported.length).toBeGreaterThan(0);
    expect(imported.every((row) => row.reviewedAt === null)).toBe(true);
  });

  it("leaves a pending card unreviewed, because that is what pending means", async () => {
    const { db, shop } = await seededShopContext();
    const pending = await db
      .select({ reviewedByPersonId: certifications.reviewedByPersonId })
      .from(certifications)
      .where(and(eq(certifications.shopId, shop.id), eq(certifications.status, "pending")));
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((row) => row.reviewedByPersonId === null)).toBe(true);
  });
});
