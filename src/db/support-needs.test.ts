import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { people } from "./schema";
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
    await saveSupportNeeds(db, { shopId, personId, ...STATED });

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
    await saveSupportNeeds(db, { shopId, personId, ...STATED });
    // Next season, a different arrangement — including taking the free text
    // back, which an emptied box has to mean or a diver can never retract it.
    await saveSupportNeeds(db, {
      shopId,
      personId,
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
    await saveSupportNeeds(db, { shopId, personId, ...NONE, supportDiversNeeded: 0 });

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
      ...NONE,
      supportDiversNeeded: null,
      supportDiversProvidedBy: "shop",
    });

    expect(await getSupportNeeds(db, shopId, personId)).toMatchObject({
      supportDiversNeeded: null,
      supportDiversProvidedBy: null,
    });
  });

  it("never reads another shop's record as this shop's", async () => {
    const { db, shopId, personId } = await aDiver();
    await saveSupportNeeds(db, { shopId, personId, ...STATED });
    const stranger = "00000000-0000-0000-0000-000000000000";

    expect(await getSupportNeeds(db, stranger, personId)).toBeNull();
    expect((await supportNeedsByPerson(db, stranger, [personId])).size).toBe(0);
  });

  it("reads a roster's records in one go, and asks nothing for an empty roster", async () => {
    const { db, shopId, personId } = await aDiver();
    await saveSupportNeeds(db, { shopId, personId, ...STATED });

    const byPerson = await supportNeedsByPerson(db, shopId, [personId, personId]);
    expect(byPerson.get(personId)).toMatchObject({ supportDiversNeeded: 2 });
    expect((await supportNeedsByPerson(db, shopId, [])).size).toBe(0);
  });
});
