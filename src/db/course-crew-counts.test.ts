import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { courseCrewCountsByTrip, NO_SUPERVISION } from "./course-crew-counts";
import { people, personRoles, shops, staffCredentials, tripAssignments, trips } from "./schema";
import { createTrip } from "./trips";

/**
 * The supervision claim's reader. Its lapse rules are
 * `supervision-lapse.test.ts`'s, across every surface that shows them; this
 * file pins the reader's own edges: the shop it is asked about, a departure
 * nobody is on, a per-trip role that counts for nothing, and the order it
 * names lapsed people in.
 */

const ctx = fileScopedShopContext();
const OFFSET_MS = 200 * 24 * HOUR_MS;
let seq = 0;

async function staffer(
  db: AppDb,
  shopId: string,
  name: string,
  role: "instructor" | "divemaster",
  renewsAt?: string,
) {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName: name, email: `crew-counts-${seq}@example.com` })
    .returning({ id: people.id });
  if (!person) throw new Error("staffer insert failed");
  await db.insert(personRoles).values({ personId: person.id, role });
  if (renewsAt) {
    await db.insert(staffCredentials).values({
      shopId,
      personId: person.id,
      kind: role === "instructor" ? "instructor_rating" : "divemaster_rating",
      name: "Rating",
      identifier: `CREW-COUNTS-${seq}`,
      renewsAt,
    });
  }
  return person.id;
}

async function trip(
  db: AppDb,
  shopId: string,
  crew: { personId: string; tripRole?: "instructor" | "divemaster" | "captain" }[],
) {
  seq += 1;
  const startsAt = new Date(nowMs() + OFFSET_MS + seq * HOUR_MS * 24);
  const created = await createTrip(db, {
    shopId,
    title: `Crew counts ${seq}`,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 10,
  });
  if (!created) throw new Error("trip not created");
  for (const member of crew) {
    await db.insert(tripAssignments).values({ tripId: created.id, ...member });
  }
  return created.id;
}

describe("courseCrewCountsByTrip", () => {
  it("counts instructors and assistants, and a rostered captain for nothing", async () => {
    const { db, shop } = ctx;
    const ana = await staffer(db, shop.id, "Ana", "instructor");
    const ben = await staffer(db, shop.id, "Ben", "divemaster");
    const cal = await staffer(db, shop.id, "Cal", "instructor");
    const id = await trip(db, shop.id, [
      { personId: ana },
      { personId: ben },
      { personId: cal, tripRole: "captain" },
    ]);
    const counts = (await courseCrewCountsByTrip(db, shop.id, [id])).get(id);
    expect(counts).toMatchObject({ instructorCount: 1, assistantCount: 1, lapsed: [] });
  });

  it("counts a person who holds several roles once, at their highest rung", async () => {
    // One person, three role rows: the join to `person_roles` must not turn
    // them into an instructor *and* an assistant, or into two instructors.
    const { db, shop } = ctx;
    const fay = await staffer(db, shop.id, "Fay", "instructor");
    await db.insert(personRoles).values([
      { personId: fay, role: "divemaster" },
      { personId: fay, role: "diver" },
    ]);
    const id = await trip(db, shop.id, [{ personId: fay }]);
    const counts = (await courseCrewCountsByTrip(db, shop.id, [id])).get(id);
    expect(counts).toMatchObject({ instructorCount: 1, assistantCount: 0, lapsed: [] });
    expect(counts?.roster).toMatchObject({ instructorCount: 1, assistantCount: 0 });
  });

  it("answers every departure asked about, a departure nobody is on included", async () => {
    const { db, shop } = ctx;
    const id = await trip(db, shop.id, []);
    expect((await courseCrewCountsByTrip(db, shop.id, [id])).get(id)).toEqual(NO_SUPERVISION);
    expect((await courseCrewCountsByTrip(db, shop.id, [])).size).toBe(0);
  });

  it("reads nothing across shops and nothing from a deleted departure", async () => {
    const { db, shop } = ctx;
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-crew-counts", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    const theirs = await trip(db, other.id, [
      { personId: await staffer(db, other.id, "Dee", "instructor") },
    ]);
    const ours = await trip(db, shop.id, [
      { personId: await staffer(db, shop.id, "Eve", "instructor") },
    ]);
    await db
      .update(trips)
      .set({ deletedAt: new Date(nowMs()) })
      .where(eq(trips.id, ours));
    const counts = await courseCrewCountsByTrip(db, shop.id, [theirs, ours]);
    expect(counts.get(theirs)).toEqual(NO_SUPERVISION);
    expect(counts.get(ours)).toEqual(NO_SUPERVISION);
  });

  it("names who a lapse took down a rung, by name", async () => {
    const { db, shop } = ctx;
    const zed = await staffer(db, shop.id, "Zed", "instructor", "2001-01-01");
    const amy = await staffer(db, shop.id, "Amy", "instructor", "2001-01-01");
    const id = await trip(db, shop.id, [{ personId: zed }, { personId: amy }]);
    const counts = (await courseCrewCountsByTrip(db, shop.id, [id])).get(id);
    expect(counts?.instructorCount).toBe(0);
    expect(counts?.roster.instructorCount).toBe(2);
    expect(counts?.lapsed.map((member) => member.fullName)).toEqual(["Amy", "Zed"]);
  });
});
