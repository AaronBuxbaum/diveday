import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { checkDrysuitCard } from "@/lib/drysuit-card";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { createDiver, getDiverProfile } from "./divers";
import { clearDrysuitExperienceSeen, recordDrysuitExperienceSeen } from "./drysuit-experience";
import { people, specialtyCertifications } from "./schema";

const ctx = fileScopedShopContext();

async function staffId() {
  const { db, shop } = ctx;
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")))
    .limit(1);
  if (!staff) throw new Error("seed staff missing");
  return staff.id;
}

async function newDiver(name: string) {
  const { db, shop } = ctx;
  const diver = await createDiver(db, {
    shopId: shop.id,
    fullName: name,
    email: `${name.toLowerCase().replace(/\s+/g, "-")}@example.com`,
  });
  if (!diver) throw new Error("diver insert failed");
  return diver;
}

describe("drysuit experience seen (#2136)", () => {
  it("records who and when, and the profile names the staffer", async () => {
    const { db, shop } = ctx;
    const diver = await newDiver("Dry Dana");
    const by = await staffId();
    const now = new Date("2026-10-01T09:00:00.000Z");

    expect(
      await recordDrysuitExperienceSeen(db, {
        shopId: shop.id,
        personId: diver.id,
        byPersonId: by,
        now,
      }),
    ).toBe(true);

    const profile = await getDiverProfile(db, shop.id, diver.id);
    expect(profile?.person.drysuitExperienceSeenAt).toEqual(now);
    expect(profile?.person.drysuitExperienceSeenByPersonId).toBe(by);
    expect(profile?.drysuitExperienceSeenByName).toBe("Dana Reyes");
    expect(
      checkDrysuitCard(
        true,
        profile?.specialtyCertifications ?? [],
        profile?.person.drysuitExperienceSeenAt ?? null,
      ),
    ).toEqual({ status: "ok" });
  });

  it("never creates a card", async () => {
    const { db, shop } = ctx;
    const diver = await newDiver("Cardless Cal");
    await recordDrysuitExperienceSeen(db, {
      shopId: shop.id,
      personId: diver.id,
      byPersonId: await staffId(),
    });

    const cards = await db
      .select({ id: specialtyCertifications.id })
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.personId, diver.id));
    expect(cards).toEqual([]);
    const profile = await getDiverProfile(db, shop.id, diver.id);
    expect(profile?.specialtyCertifications).toEqual([]);
  });

  it("is idempotent: a replay keeps the first date and author", async () => {
    const { db, shop } = ctx;
    const diver = await newDiver("Replay Rae");
    const by = await staffId();
    const first = new Date("2026-10-01T09:00:00.000Z");
    await recordDrysuitExperienceSeen(db, {
      shopId: shop.id,
      personId: diver.id,
      byPersonId: by,
      now: first,
    });
    expect(
      await recordDrysuitExperienceSeen(db, {
        shopId: shop.id,
        personId: diver.id,
        byPersonId: diver.id,
        now: new Date("2026-10-05T09:00:00.000Z"),
      }),
    ).toBe(false);
    const profile = await getDiverProfile(db, shop.id, diver.id);
    expect(profile?.person.drysuitExperienceSeenAt).toEqual(first);
    expect(profile?.person.drysuitExperienceSeenByPersonId).toBe(by);
  });

  it("clears both halves, and the advisory fires again", async () => {
    const { db, shop } = ctx;
    const diver = await newDiver("Undo Uma");
    await recordDrysuitExperienceSeen(db, {
      shopId: shop.id,
      personId: diver.id,
      byPersonId: await staffId(),
    });
    expect(await clearDrysuitExperienceSeen(db, { shopId: shop.id, personId: diver.id })).toBe(
      true,
    );
    expect(await clearDrysuitExperienceSeen(db, { shopId: shop.id, personId: diver.id })).toBe(
      false,
    );
    const profile = await getDiverProfile(db, shop.id, diver.id);
    expect(profile?.person.drysuitExperienceSeenAt).toBeNull();
    expect(profile?.person.drysuitExperienceSeenByPersonId).toBeNull();
    expect(checkDrysuitCard(true, [], profile?.person.drysuitExperienceSeenAt ?? null)).toEqual({
      status: "no_card",
    });
  });

  it("refuses another shop's diver", async () => {
    const { db } = ctx;
    const diver = await newDiver("Elsewhere Eve");
    expect(
      await recordDrysuitExperienceSeen(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        personId: diver.id,
        byPersonId: await staffId(),
      }),
    ).toBe(false);
  });

  it("is erased with the diver", async () => {
    const { db, shop } = ctx;
    const diver = await newDiver("Erased Ezra");
    const by = await staffId();
    await recordDrysuitExperienceSeen(db, { shopId: shop.id, personId: diver.id, byPersonId: by });
    await anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: by });
    const [row] = await db
      .select({
        at: people.drysuitExperienceSeenAt,
        by: people.drysuitExperienceSeenByPersonId,
      })
      .from(people)
      .where(eq(people.id, diver.id));
    expect(row).toEqual({ at: null, by: null });
  });
});
