import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { createDiver, updateDiver } from "./divers";
import { activityEvents, courses, people, trips } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **What the diver record's date of birth says about age** (H-20261007-held-seat-split-into, issue
 * #2167). The guardian co-signature rule and the minimum-age gate read a
 * record with neither a date nor a staffer's "18 or older" as an adult, so
 * the contact-details save may not leave a known minor that way.
 */
const ctx = fileScopedShopContext();

/** The saved row, or a failure naming the refusal. */
function saved(result: Awaited<ReturnType<typeof updateDiver>>) {
  if (!result.ok) throw new Error(`updateDiver refused: ${result.reason}`);
  return result.person;
}

/** The diver-trail lines saying a stored date was cleared as 18 or older. */
async function clearedLines(db: AppDb, personId: string) {
  return db
    .select({ actorPersonId: activityEvents.actorPersonId, params: activityEvents.params })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.subjectPersonId, personId),
        eq(activityEvents.code, "date_of_birth_cleared_as_adult"),
      ),
    );
}

/** The seeded staffer who gives an 18-or-older answer. */
async function staffer(db: AppDb, shopId: string): Promise<string> {
  const [row] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shopId), eq(people.fullName, "Dana Reyes")));
  if (!row) throw new Error("expected the seeded staffer");
  return row.id;
}

describe("updateDiver and the date of birth", () => {
  /**
   * H-20261007-held-seat-split-into, dive-domain review: once a date answers the age question, a
   * staffer's earlier "18 or older" goes, so clearing the date later cannot
   * bring back an adult claim the date may have disproved.
   */
  it("drops an 18-or-older answer when a date of birth is typed, and keeps it when one is not", async () => {
    const { db, shop } = ctx;
    const diver = await createDiver(db, {
      shopId: shop.id,
      fullName: "Attested Ari",
      email: "attested-ari@example.com",
    });
    if (!diver) throw new Error("diver insert failed");
    const staffId = await staffer(db, shop.id);
    await db
      .update(people)
      .set({ adultAttestedAt: nowDate(), adultAttestedByPersonId: staffId })
      .where(eq(people.id, diver.id));

    const untouched = saved(
      await updateDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        fullName: "Attested Ari",
        dateOfBirth: "",
      }),
    );
    expect(untouched.adultAttestedAt).not.toBeNull();

    const dated = saved(
      await updateDiver(db, {
        shopId: shop.id,
        personId: diver.id,
        fullName: "Attested Ari",
        dateOfBirth: "2011-04-09",
      }),
    );
    expect(dated.adultAttestedAt).toBeNull();
    expect(dated.adultAttestedByPersonId).toBeNull();
  });

  /**
   * Issue #2167 (Aaron, 2026-10-13, option a): emptying a stored date of
   * birth used to leave the record with neither a date nor an answer, and the
   * guardian rule and the minimum-age gate then read a known minor as an
   * adult. Clearing a date now takes "They're 18 or older" in the same save,
   * filed with the staffer who gave it.
   */
  describe("clearing a stored date of birth", () => {
    async function minor() {
      const { db, shop } = ctx;
      const diver = await createDiver(db, { shopId: shop.id, fullName: "Cleared Cleo" });
      if (!diver) throw new Error("diver insert failed");
      saved(
        await updateDiver(db, {
          shopId: shop.id,
          personId: diver.id,
          fullName: "Cleared Cleo",
          dateOfBirth: "2013-05-02",
        }),
      );
      return { db, shop, personId: diver.id };
    }

    it("is refused without an 18-or-older answer, and the date stays", async () => {
      const { db, shop, personId } = await minor();

      const result = await updateDiver(db, {
        shopId: shop.id,
        personId,
        fullName: "Cleared Cleo",
        dateOfBirth: "",
      });

      expect(result).toEqual({ ok: false, reason: "age_unstated" });
      const [row] = await db.select().from(people).where(eq(people.id, personId));
      expect(row?.dateOfBirth).toBe("2013-05-02");
      expect(row?.adultAttestedAt).toBeNull();
    });

    it("refuses a whitespace date the same way", async () => {
      const { db, shop, personId } = await minor();

      const result = await updateDiver(db, {
        shopId: shop.id,
        personId,
        fullName: "Cleared Cleo",
        dateOfBirth: "   ",
      });

      expect(result).toEqual({ ok: false, reason: "age_unstated" });
    });

    it("refuses the whole save, so no other field lands either", async () => {
      const { db, shop, personId } = await minor();

      await updateDiver(db, {
        shopId: shop.id,
        personId,
        fullName: "Renamed Cleo",
        dateOfBirth: "",
      });

      const [row] = await db.select().from(people).where(eq(people.id, personId));
      expect(row?.fullName).toBe("Cleared Cleo");
    });

    it("clears the date with the answer, filed with the staffer who gave it", async () => {
      const { db, shop, personId } = await minor();
      const staffId = await staffer(db, shop.id);

      const person = saved(
        await updateDiver(db, {
          shopId: shop.id,
          personId,
          fullName: "Cleared Cleo",
          dateOfBirth: "",
          adultAttestedByPersonId: staffId,
        }),
      );

      expect(person.dateOfBirth).toBeNull();
      expect(person.adultAttestedAt).toBeInstanceOf(Date);
      expect(person.adultAttestedByPersonId).toBe(staffId);
      // The date said 13, so the answer overrides it: the diver's trail names
      // who said so, where a later correction cannot erase it.
      expect(await clearedLines(db, personId)).toEqual([
        {
          actorPersonId: staffId,
          params: { actor: "Dana Reyes", diver: "Cleared Cleo" },
        },
      ]);
    });

    it("keeps the trail line when a date typed later drops the answer", async () => {
      const { db, shop, personId } = await minor();
      const staffId = await staffer(db, shop.id);
      saved(
        await updateDiver(db, {
          shopId: shop.id,
          personId,
          fullName: "Cleared Cleo",
          dateOfBirth: "",
          adultAttestedByPersonId: staffId,
        }),
      );

      const corrected = saved(
        await updateDiver(db, {
          shopId: shop.id,
          personId,
          fullName: "Cleared Cleo",
          dateOfBirth: "2013-05-02",
        }),
      );

      expect(corrected.adultAttestedByPersonId).toBeNull();
      expect(await clearedLines(db, personId)).toHaveLength(1);
    });

    it("refuses the clear when the answering staffer is no longer on the record", async () => {
      const { db, shop, personId } = await minor();
      const gone = await createDiver(db, { shopId: shop.id, fullName: "Gone Gael" });
      if (!gone) throw new Error("staffer insert failed");
      await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, gone.id));

      const result = await updateDiver(db, {
        shopId: shop.id,
        personId,
        fullName: "Cleared Cleo",
        dateOfBirth: "",
        adultAttestedByPersonId: gone.id,
      });

      expect(result).toEqual({ ok: false, reason: "age_unstated" });
      const [row] = await db.select().from(people).where(eq(people.id, personId));
      expect(row?.dateOfBirth).toBe("2013-05-02");
      expect(await clearedLines(db, personId)).toEqual([]);
    });

    it("ignores the answer when a date is kept or typed", async () => {
      const { db, shop, personId } = await minor();
      const staffId = await staffer(db, shop.id);

      const kept = saved(
        await updateDiver(db, {
          shopId: shop.id,
          personId,
          fullName: "Cleared Cleo",
          dateOfBirth: "2013-05-02",
          adultAttestedByPersonId: staffId,
        }),
      );

      expect(kept.dateOfBirth).toBe("2013-05-02");
      expect(kept.adultAttestedAt).toBeNull();

      // Dropped, but not in silence: the save says the answer was not used.
      const typed = await updateDiver(db, {
        shopId: shop.id,
        personId,
        fullName: "Cleared Cleo",
        dateOfBirth: "2001-05-02",
        adultAttestedByPersonId: staffId,
      });
      expect(typed).toMatchObject({ ok: true, adultAnswerUnused: true });
      const unticked = await updateDiver(db, {
        shopId: shop.id,
        personId,
        fullName: "Cleared Cleo",
        dateOfBirth: "2001-05-02",
      });
      expect(unticked).toMatchObject({ ok: true, adultAnswerUnused: false });
    });

    /**
     * H-20261007-held-seat-split-into's split takes the tick anywhere but a course with a minimum age,
     * which measures the date itself; clearing one here is held to the same.
     */
    it("keeps the date while the diver holds a seat on a course with a minimum age", async () => {
      const { db, shop, personId } = await minor();
      const staffId = await staffer(db, shop.id);
      const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => !row.courseId);
      if (!trip) throw new Error("expected a seeded upcoming trip");
      const booked = await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        personId,
      });
      expect(booked.ok).toBe(true);
      const [course] = await db
        .insert(courses)
        .values({ shopId: shop.id, title: "Age gate", slug: "age-gate-2167", minimumAge: 15 })
        .returning();
      if (!course) throw new Error("course setup failed");
      await db.update(trips).set({ courseId: course.id }).where(eq(trips.id, trip.id));

      const result = await updateDiver(db, {
        shopId: shop.id,
        personId,
        fullName: "Cleared Cleo",
        dateOfBirth: "",
        adultAttestedByPersonId: staffId,
      });

      expect(result).toEqual({ ok: false, reason: "date_of_birth_required" });
      const [row] = await db.select().from(people).where(eq(people.id, personId));
      expect(row?.dateOfBirth).toBe("2013-05-02");
    });

    it("leaves a save that does not send the date alone", async () => {
      const { db, shop, personId } = await minor();

      const person = saved(
        await updateDiver(db, { shopId: shop.id, personId, fullName: "Cleared Cleo" }),
      );

      expect(person.dateOfBirth).toBe("2013-05-02");
    });
  });
});
