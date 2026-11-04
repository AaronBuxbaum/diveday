import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { mergeDiverRecords } from "./diver-merge";
import { addDiverNote, listDiverRecordNotes } from "./operations";
import { writeTargetPersonId } from "./people";
import { getRentalFit, recordRentalFit, recordRentalFitNote } from "./rental-fit";
import { internalNotes, people, personRoles, rentalFitProfiles } from "./schema";
import { setShopRentalItems } from "./shops";

/**
 * A staffer with a diver's record open in another tab keeps saving after the
 * desk merges it away (issue #3808). The note or fit must land on the kept
 * record, where the shop reads it, never on the shell.
 */
const ctx = fileScopedShopContext();

async function mergedAway() {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("expected the seeded owner");
  const [gone, kept] = await db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: "Iris Lund", phone: "+1 305 555 0177" },
      { shopId: shop.id, fullName: "Iris Lund", phone: "+1 305 555 0177" },
    ])
    .returning();
  if (!gone || !kept) throw new Error("insert failed");
  await db.insert(personRoles).values([
    { personId: gone.id, role: "diver" },
    { personId: kept.id, role: "diver" },
  ]);
  const merged = await mergeDiverRecords({
    db,
    shopId: shop.id,
    personId: gone.id,
    survivorId: kept.id,
    actorPersonId: owner.id,
  });
  expect(merged.ok).toBe(true);
  return { db, shop, owner: owner.id, goneId: gone.id, keptId: kept.id };
}

describe("writeTargetPersonId", () => {
  it("is the person themselves, the survivor of a merge, and nothing for another shop", async () => {
    const { db, shop, goneId, keptId } = await mergedAway();
    expect(await writeTargetPersonId(db, shop.id, keptId)).toBe(keptId);
    expect(await writeTargetPersonId(db, shop.id, goneId)).toBe(keptId);
    expect(
      await writeTargetPersonId(db, "00000000-0000-4000-8000-000000000099", goneId),
    ).toBeNull();
  });

  it("is nothing when the record it ends on is erased or removed", async () => {
    const { db, shop, goneId, keptId } = await mergedAway();
    await db
      .update(people)
      .set({ anonymizedAt: nowDate(), deletedAt: nowDate() })
      .where(eq(people.id, keptId));
    expect(await writeTargetPersonId(db, shop.id, goneId)).toBeNull();
    expect(await writeTargetPersonId(db, shop.id, keptId)).toBeNull();
    await db
      .update(people)
      .set({ anonymizedAt: null, deletedAt: nowDate() })
      .where(eq(people.id, keptId));
    expect(await writeTargetPersonId(db, shop.id, goneId)).toBeNull();
  });

  it("refuses a note for a shell whose survivor was erased, and writes none", async () => {
    const { db, shop, owner, goneId, keptId } = await mergedAway();
    await db
      .update(people)
      .set({ anonymizedAt: nowDate(), deletedAt: nowDate() })
      .where(eq(people.id, keptId));
    const note = await addDiverNote(db, {
      shopId: shop.id,
      personId: goneId,
      actorPersonId: owner,
      body: "Titanium hip, runs heavy",
    });
    expect(note).toBeNull();
    expect(
      await db.select().from(internalNotes).where(eq(internalNotes.personId, keptId)),
    ).toHaveLength(0);
  });
});

describe("a diver note written to a merged-away record", () => {
  it("lands on the survivor and leaves the shell empty", async () => {
    const { db, shop, owner, goneId, keptId } = await mergedAway();
    const note = await addDiverNote(db, {
      shopId: shop.id,
      personId: goneId,
      actorPersonId: owner,
      body: "Titanium hip, runs heavy",
    });
    expect(note?.personId).toBe(keptId);
    expect((await listDiverRecordNotes(db, shop.id, keptId)).map((row) => row.note.body)).toEqual([
      "Titanium hip, runs heavy",
    ]);
    expect(
      await db.select().from(internalNotes).where(eq(internalNotes.personId, goneId)),
    ).toHaveLength(0);
  });

  it("is still refused for an id that is not this shop's", async () => {
    const { db, shop, owner } = await mergedAway();
    expect(
      await addDiverNote(db, {
        shopId: shop.id,
        personId: "00000000-0000-4000-8000-000000000099",
        actorPersonId: owner,
        body: "Nope",
      }),
    ).toBeNull();
  });
});

describe("a rental fit written to a merged-away record", () => {
  it("lands on the survivor, for the fit and for the note alone", async () => {
    const { db, shop, goneId, keptId } = await mergedAway();
    await setShopRentalItems(db, shop.id, ["wetsuit"]);

    const note = await recordRentalFitNote(db, {
      shopId: shop.id,
      personId: goneId,
      note: "Titanium hip, runs heavy",
    });
    expect(note?.personId).toBe(keptId);

    const fit = await recordRentalFit(db, {
      shopId: shop.id,
      personId: goneId,
      rentsWetsuit: true,
    });
    expect(fit?.personId).toBe(keptId);

    expect((await getRentalFit(db, shop.id, keptId))?.note).toBe("Titanium hip, runs heavy");
    expect(
      await db.select().from(rentalFitProfiles).where(eq(rentalFitProfiles.personId, goneId)),
    ).toHaveLength(0);
  });
});
