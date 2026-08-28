import { and, asc, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { activityEvents, people } from "./schema";
import { getSupportNeeds, saveSupportNeeds, supportNeedsByPerson } from "./support-needs";

/** Every field a caller may state, so a test can override one and mean it. */
const NONE = {
  supportDiversNeeded: null,
  supportDiversProvidedBy: null,
  needsBoardingAssistance: false,
  needsWaterLift: false,
  briefingInSign: false,
  briefingInWriting: false,
  briefingAloud: false,
  briefingBySignals: false,
  equipmentAdaptation: null,
  divesWithName: null,
} as const;

const STATED = {
  ...NONE,
  supportDiversNeeded: 2,
  supportDiversProvidedBy: "shop",
  needsBoardingAssistance: true,
  briefingInWriting: true,
  equipmentAdaptation: "  webbed gloves  ",
  divesWithName: "  Marisol Vega  ",
} as const;

/** The diver writing on their own `/ready` page — the ordinary author. */
const DIVER = { kind: "diver" } as const;

async function aDiver() {
  const { db, shop } = await seededShopContext();
  const [diver] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shop.id))
    .limit(1);
  if (!diver) throw new Error("seed has no people");
  return { db, shopId: shop.id, personId: diver.id };
}

describe("the support-needs record", () => {
  it("stores what the diver said, trimmed, and reads it back", async () => {
    const { db, shopId, personId } = await aDiver();
    await saveSupportNeeds(db, { shopId, personId, actor: DIVER, ...STATED });

    expect(await getSupportNeeds(db, shopId, personId)).toMatchObject({
      supportDiversNeeded: 2,
      supportDiversProvidedBy: "shop",
      needsBoardingAssistance: true,
      needsWaterLift: false,
      briefingInSign: false,
      briefingInWriting: true,
      briefingAloud: false,
      briefingBySignals: false,
      // Trimmed by the writer, so a reader never prints a bullet made of spaces.
      equipmentAdaptation: "webbed gloves",
      divesWithName: "Marisol Vega",
    });
  });

  it("is one living record per diver, restated rather than versioned", async () => {
    const { db, shopId, personId } = await aDiver();
    await saveSupportNeeds(db, { shopId, personId, actor: DIVER, ...STATED });
    // Next season, a different arrangement — including taking the free text
    // back, which an emptied box has to mean or a diver can never retract it.
    await saveSupportNeeds(db, {
      shopId,
      personId,
      actor: DIVER,
      ...NONE,
      supportDiversNeeded: 1,
      supportDiversProvidedBy: "diver",
      needsWaterLift: true,
      briefingInSign: true,
      equipmentAdaptation: "",
    });

    expect(await getSupportNeeds(db, shopId, personId)).toMatchObject({
      supportDiversNeeded: 1,
      supportDiversProvidedBy: "diver",
      needsBoardingAssistance: false,
      needsWaterLift: true,
      briefingInSign: true,
      equipmentAdaptation: null,
      divesWithName: null,
    });
  });

  it("keeps a stated zero, which is not the same as never being asked", async () => {
    const { db, shopId, personId } = await aDiver();
    await saveSupportNeeds(db, { shopId, personId, actor: DIVER, ...NONE, supportDiversNeeded: 0 });

    // A row exists, says zero, and carries a `stated_at`. `null` here would be
    // the record claiming nobody ever asked, which is a different thing.
    const row = await getSupportNeeds(db, shopId, personId);
    expect(row).toMatchObject({ supportDiversNeeded: 0, supportDiversProvidedBy: null });
    expect(row?.statedAt).toBeInstanceOf(Date);
  });

  /**
   * The tenant proof, and the reason every function in this module takes a
   * `shopId`. `/ready/[token]` is a bearer URL and `people` is shop-scoped, so
   * "a record on the person" must never become a profile that follows a diver
   * between businesses — that would be a cross-tenant leak of health-adjacent
   * data. `saveSupportNeeds` mirrors `saveRentalFit`: prove the person is this
   * shop's before writing anything.
   */
  it("refuses to write a record for a person who is not this shop's", async () => {
    const { db, personId } = await aDiver();
    const stranger = "00000000-0000-0000-0000-000000000000";

    expect(
      await saveSupportNeeds(db, {
        shopId: stranger,
        personId,
        actor: DIVER,
        ...NONE,
        supportDiversNeeded: 3,
        supportDiversProvidedBy: "shop",
      }),
    ).toBeNull();
  });

  it("drops the supplier when there is nobody to supply", async () => {
    // The `dive_support_needs_provider_pairs_with_count` check constraint refuses
    // a supplier with no count, so a form that clears the number but leaves the
    // radio would fail the write. The writer normalises instead.
    const { db, shopId, personId } = await aDiver();
    await saveSupportNeeds(db, {
      shopId,
      personId,
      actor: DIVER,
      ...NONE,
      supportDiversNeeded: null,
      supportDiversProvidedBy: "shop",
    });

    expect(await getSupportNeeds(db, shopId, personId)).toMatchObject({
      supportDiversNeeded: null,
      supportDiversProvidedBy: null,
    });
  });

  it("leaves a trail on every write, and says when one emptied the record", async () => {
    const { db, shopId, personId } = await aDiver();
    const trail = async () =>
      await db
        .select({ message: activityEvents.message, actor: activityEvents.actorPersonId })
        .from(activityEvents)
        .where(and(eq(activityEvents.shopId, shopId), eq(activityEvents.subjectPersonId, personId)))
        .orderBy(asc(activityEvents.seq));

    await saveSupportNeeds(db, { shopId, personId, actor: DIVER, ...STATED });
    expect(await trail()).toEqual([
      {
        message: expect.stringContaining("updated what to set up for their dives"),
        actor: personId,
      },
    ]);

    // The failure the trail exists for: a forwarded readiness link, a form
    // reset and submitted, and every arrangement gone. It stays allowed — a
    // diver retracts as easily as they arranged — but it stops being silent.
    await saveSupportNeeds(db, { shopId, personId, actor: DIVER, ...NONE });
    const afterClear = await trail();
    expect(afterClear).toHaveLength(2);
    expect(afterClear[1]?.message).toContain("cleared what to set up for their dives");

    // Emptying an already-empty record is not a clearing: there was nothing to
    // lose, so the line must not claim something went.
    await saveSupportNeeds(db, { shopId, personId, actor: DIVER, ...NONE });
    expect((await trail())[2]?.message).toContain("updated what to set up for their dives");

    // Staff taking it over the phone are named as the author, and the diver
    // stays the subject — which is what makes the two distinguishable later.
    const [staff] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shopId), ne(people.id, personId)))
      .limit(1);
    if (!staff) throw new Error("seed has only one person");
    await saveSupportNeeds(db, {
      shopId,
      personId,
      actor: { kind: "staff", personId: staff.id },
      ...STATED,
    });
    const afterStaff = await trail();
    expect(afterStaff).toHaveLength(4);
    expect(afterStaff[3]?.actor).toBe(staff.id);

    // And nothing the diver arranged is copied onto the trail.
    for (const { message } of afterStaff) {
      expect(message).not.toMatch(/webbed gloves|Marisol|hoist|lift|briefing/i);
    }
  });

  it("never reads another shop's record as this shop's", async () => {
    const { db, shopId, personId } = await aDiver();
    await saveSupportNeeds(db, { shopId, personId, actor: DIVER, ...STATED });
    const stranger = "00000000-0000-0000-0000-000000000000";

    expect(await getSupportNeeds(db, stranger, personId)).toBeNull();
    expect((await supportNeedsByPerson(db, stranger, [personId])).size).toBe(0);
  });

  it("reads a roster's records in one go, and asks nothing for an empty roster", async () => {
    const { db, shopId, personId } = await aDiver();
    await saveSupportNeeds(db, { shopId, personId, actor: DIVER, ...STATED });

    const byPerson = await supportNeedsByPerson(db, shopId, [personId, personId]);
    expect(byPerson.get(personId)).toMatchObject({ supportDiversNeeded: 2 });
    expect((await supportNeedsByPerson(db, shopId, [])).size).toBe(0);
  });
});
