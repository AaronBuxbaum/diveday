import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import {
  listAgencyCheckableCards,
  listedCardForAgencyCheck,
  undoAgencyCheck,
} from "./agency-check";
import type { AppDb } from "./client";
import { reviewNitroxCertification, unreviewNitroxCertification } from "./nitrox";
import { reviewSpecialtyCertification, unreviewSpecialtyCertification } from "./readiness";
import {
  certifications,
  nitroxCertifications,
  people,
  shops,
  specialtyCertifications,
} from "./schema";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

/**
 * **Pending nitrox and specialty cards, checked on the agency's page** (issue
 * #2592). A nitrox card authorizes a gas fill and a specialty opens a depth
 * gate, so every case here is about what must NOT be offered, certified or
 * undone by a path that was not meant for it.
 */

async function diver(db: AppDb, shopId: string, fullName: string) {
  const [person] = await db
    .insert(people)
    .values({ shopId, fullName, dateOfBirth: "1990-04-12" })
    .returning();
  if (!person) throw new Error("failed to insert a diver");
  return person.id;
}

async function nitrox(
  db: AppDb,
  shopId: string,
  personId: string,
  values: Partial<typeof nitroxCertifications.$inferInsert> = {},
) {
  const [row] = await db
    .insert(nitroxCertifications)
    .values({ shopId, personId, agency: "ssi", identifier: "N-4471", ...values })
    .returning();
  if (!row) throw new Error("failed to insert a nitrox card");
  return row;
}

async function specialty(
  db: AppDb,
  shopId: string,
  personId: string,
  values: Partial<typeof specialtyCertifications.$inferInsert> = {},
) {
  const [row] = await db
    .insert(specialtyCertifications)
    .values({ shopId, personId, agency: "ssi", specialty: "deep", identifier: "N-4471", ...values })
    .returning();
  if (!row) throw new Error("failed to insert a specialty card");
  return row;
}

const checked = (shopId: string, personId: string, certificationId: string) => ({
  shopId,
  personId,
  certificationId,
});

describe("listAgencyCheckableCards with the other card tables", () => {
  it("offers a pending nitrox and a pending specialty card after the level ladder, only when asked", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Lena Ortiz");
    const [level] = await db
      .insert(certifications)
      .values({
        shopId: shop.id,
        personId,
        agency: "ssi",
        level: "open_water",
        identifier: "N-4471",
      })
      .returning();
    const gas = await nitrox(db, shop.id, personId);
    const deep = await specialty(db, shop.id, personId);

    const plain = await listAgencyCheckableCards(db, { shopId: shop.id, personIds: [personId] });
    expect(plain.get(personId)?.map((card) => card.certificationId)).toEqual([level?.id]);

    const all = await listAgencyCheckableCards(db, {
      shopId: shop.id,
      personIds: [personId],
      includeListedCards: true,
    });
    expect(
      all.get(personId)?.map((card) => [card.certificationId, card.cardType, card.kind]),
    ).toEqual([
      [level?.id, undefined, undefined],
      [gas.id, "nitrox", "nitrox"],
      [deep.id, "specialty", "deep"],
    ]);
    expect(all.get(personId)?.[1]?.query).toEqual({
      agency: "ssi",
      firstName: "Lena",
      lastName: "Ortiz",
      birthDate: "1990-04-12",
      cardNumber: "N-4471",
    });
  });

  it("offers nothing a card sighting should confirm, and nothing already settled", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Mara Quinn");
    const [level] = await db
      .insert(certifications)
      .values({
        shopId: shop.id,
        personId,
        agency: "ssi",
        level: "open_water",
        identifier: "L-9",
        status: "verified",
        reviewedAt: new Date("2026-10-01T00:00:00Z"),
      })
      .returning();
    const refused = [
      // The diver's own tick: a claim, not a card.
      await nitrox(db, shop.id, personId, { selfDeclaredAt: new Date("2026-10-01T00:00:00Z") }),
      // This shop's own instructor issued it: attested, not sighted.
      await specialty(db, shop.id, personId, {
        specialty: "wreck",
        issuedByShopAt: new Date("2026-10-01T00:00:00Z"),
        identifier: null,
      }),
      // An earlier check listed it with no number of its own.
      await specialty(db, shop.id, personId, {
        specialty: "night",
        identifier: null,
        listedFromCertificationId: level?.id,
      }),
      // Already certified, and deleted.
      await nitrox(db, shop.id, personId, {
        identifier: "N-1",
        status: "verified",
        reviewedAt: new Date("2026-10-01T00:00:00Z"),
      }),
      await specialty(db, shop.id, personId, {
        specialty: "drysuit",
        deletedAt: new Date("2026-10-01T00:00:00Z"),
      }),
      // An agency the extension does not check.
      await specialty(db, shop.id, personId, { specialty: "cavern", agency: "tdi" }),
    ];

    const all = await listAgencyCheckableCards(db, {
      shopId: shop.id,
      personIds: [personId],
      includeListedCards: true,
    });
    expect(all.get(personId)).toBeUndefined();
    // The list and the action agree: each is refused by the action's own read.
    for (const row of refused) {
      const cardType = "specialty" in row ? "specialty" : "nitrox";
      expect(
        await listedCardForAgencyCheck(db, { ...checked(shop.id, personId, row.id), cardType }),
        row.id,
      ).toBeNull();
    }
  });

  it("offers an imported card still waiting for its confirm", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Ines Vega");
    const imported = await nitrox(db, shop.id, personId, {
      status: "verified",
      importedAt: new Date("2026-09-01T00:00:00Z"),
    });
    const all = await listAgencyCheckableCards(db, {
      shopId: shop.id,
      personIds: [personId],
      includeListedCards: true,
    });
    expect(all.get(personId)?.map((card) => card.certificationId)).toEqual([imported.id]);
  });

  it("offers no PADI card at a shop that has not turned PADI checks on", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Lena Ortiz");
    await nitrox(db, shop.id, personId, { agency: "padi", identifier: "778899" });
    await db.update(shops).set({ padiChecksEnabled: false }).where(eq(shops.id, shop.id));
    const all = await listAgencyCheckableCards(db, {
      shopId: shop.id,
      personIds: [personId],
      includeListedCards: true,
    });
    expect(all.get(personId)).toBeUndefined();
  });
});

describe("listedCardForAgencyCheck", () => {
  it("reads the card and the diver again, by this shop, this diver and this table", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Lena Ortiz");
    const otherDiver = await diver(db, shop.id, "Mark Lee");
    const gas = await nitrox(db, shop.id, personId);
    const deep = await specialty(db, shop.id, personId);

    const found = await listedCardForAgencyCheck(db, {
      ...checked(shop.id, personId, gas.id),
      cardType: "nitrox",
    });
    expect(found?.kind).toBe("nitrox");
    expect(found?.identity).toEqual({ birthDate: "1990-04-12", cardNumber: "N-4471" });
    expect(
      (
        await listedCardForAgencyCheck(db, {
          ...checked(shop.id, personId, deep.id),
          cardType: "specialty",
        })
      )?.kind,
    ).toBe("deep");

    // Another diver's card, another table's id, and a made-up shop.
    expect(
      await listedCardForAgencyCheck(db, {
        ...checked(shop.id, otherDiver, gas.id),
        cardType: "nitrox",
      }),
    ).toBeNull();
    expect(
      await listedCardForAgencyCheck(db, {
        ...checked(shop.id, personId, gas.id),
        cardType: "specialty",
      }),
    ).toBeNull();
    expect(
      await listedCardForAgencyCheck(db, {
        ...checked("00000000-0000-4000-8000-000000000000", personId, gas.id),
        cardType: "nitrox",
      }),
    ).toBeNull();
  });
});

describe("an agency check's review of a nitrox or specialty card", () => {
  const agencyReview = {
    status: "verified",
    reviewNote: "Lena Ortiz · Enriched Air Nitrox",
    agencyChecked: true,
  } as const;

  it("certifies it, stamps agencyCheckedAt, and the card's own Undo restores pending", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Lena Ortiz");
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const gas = await nitrox(db, shop.id, personId);
    const deep = await specialty(db, shop.id, personId);

    const gasReview = await reviewNitroxCertification(db, {
      ...agencyReview,
      shopId: shop.id,
      certificationId: gas.id,
      reviewedByPersonId: owner,
    });
    const deepReview = await reviewSpecialtyCertification(db, {
      ...agencyReview,
      shopId: shop.id,
      certificationId: deep.id,
      reviewedByPersonId: owner,
    });
    if (!gasReview.ok || !deepReview.ok) throw new Error("the review was refused");
    expect(gasReview.certification.agencyCheckedAt).toBeInstanceOf(Date);
    expect(deepReview.certification.agencyCheckedAt).toBeInstanceOf(Date);

    for (const cardType of ["nitrox", "specialty"] as const) {
      const id = cardType === "nitrox" ? gas.id : deep.id;
      expect(
        await undoAgencyCheck(db, {
          ...checked(shop.id, personId, id),
          undoneByPersonId: owner,
          cardType,
        }),
      ).toEqual({ ok: true, archived: 0 });
    }
    const [gasAfter] = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.id, gas.id));
    const [deepAfter] = await db
      .select()
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.id, deep.id));
    for (const after of [gasAfter, deepAfter]) {
      expect(after).toMatchObject({
        status: "pending",
        reviewNote: null,
        reviewedAt: null,
        reviewedByPersonId: null,
        agencyCheckedAt: null,
      });
    }
  });

  it("never certifies a card that needs a sighting, and writes nothing", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Mara Quinn");
    const claim = await nitrox(db, shop.id, personId, {
      selfDeclaredAt: new Date("2026-10-01T00:00:00Z"),
    });
    const issued = await specialty(db, shop.id, personId, {
      issuedByShopAt: new Date("2026-10-01T00:00:00Z"),
      identifier: null,
    });
    expect(
      await reviewNitroxCertification(db, {
        ...agencyReview,
        shopId: shop.id,
        certificationId: claim.id,
      }),
    ).toEqual({ ok: false, reason: "card_sighting_required" });
    expect(
      await reviewSpecialtyCertification(db, {
        ...agencyReview,
        shopId: shop.id,
        certificationId: issued.id,
      }),
    ).toEqual({ ok: false, reason: "card_sighting_required" });
    const [after] = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.id, claim.id));
    expect(after).toMatchObject({ status: "pending", reviewedAt: null, agencyCheckedAt: null });
  });

  it("is not undone by a one-tap Undo, which belongs to a one-tap review", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Lena Ortiz");
    const gas = await nitrox(db, shop.id, personId);
    const deep = await specialty(db, shop.id, personId);
    const gasReview = await reviewNitroxCertification(db, {
      ...agencyReview,
      shopId: shop.id,
      certificationId: gas.id,
    });
    const deepReview = await reviewSpecialtyCertification(db, {
      ...agencyReview,
      shopId: shop.id,
      certificationId: deep.id,
    });
    if (!gasReview.ok || !deepReview.ok) throw new Error("the review was refused");
    const gasAt = gasReview.certification.reviewedAt as Date;
    const deepAt = deepReview.certification.reviewedAt as Date;

    expect(
      await unreviewNitroxCertification(db, {
        shopId: shop.id,
        certificationId: gas.id,
        reviewedAt: gasAt,
      }),
    ).toEqual({ ok: false, reason: "agency_checked" });
    expect(
      await unreviewSpecialtyCertification(db, {
        shopId: shop.id,
        certificationId: deep.id,
        reviewedAt: deepAt,
      }),
    ).toEqual({ ok: false, reason: "agency_checked" });
    const [still] = await db
      .select({ status: nitroxCertifications.status })
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.id, gas.id));
    expect(still?.status).toBe("verified");
  });

  it("is undone only by the agency check's own Undo, on the table it was made in", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Lena Ortiz");
    const otherDiver = await diver(db, shop.id, "Mark Lee");
    const gas = await nitrox(db, shop.id, personId);
    const oneTap = await specialty(db, shop.id, personId);
    await reviewNitroxCertification(db, {
      ...agencyReview,
      shopId: shop.id,
      certificationId: gas.id,
    });
    // A one-tap review: no agency stamp, so the check's Undo has nothing of its own to take back.
    await reviewSpecialtyCertification(db, {
      shopId: shop.id,
      certificationId: oneTap.id,
      status: "verified",
    });

    const undo = (personId: string, certificationId: string, cardType?: "nitrox" | "specialty") =>
      undoAgencyCheck(db, {
        shopId: shop.id,
        personId,
        certificationId,
        undoneByPersonId: personId,
        cardType,
      });
    // Another diver's, the level table's, and a one-tap review.
    expect(await undo(otherDiver, gas.id, "nitrox")).toEqual({ ok: false });
    expect(await undo(personId, gas.id)).toEqual({ ok: false });
    expect(await undo(personId, gas.id, "specialty")).toEqual({ ok: false });
    expect(await undo(personId, oneTap.id, "specialty")).toEqual({ ok: false });
    const [kept] = await db
      .select({ status: specialtyCertifications.status })
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.id, oneTap.id));
    expect(kept?.status).toBe("verified");
    expect(await undo(personId, gas.id, "nitrox")).toEqual({ ok: true, archived: 0 });
  });

  it("puts an imported card back to waiting for its confirm, and keeps a listed card's agency words", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Ines Vega");
    const [level] = await db
      .insert(certifications)
      .values({ shopId: shop.id, personId, agency: "ssi", level: "open_water", identifier: "L-1" })
      .returning();
    const imported = await nitrox(db, shop.id, personId, {
      status: "verified",
      importedAt: new Date("2026-09-01T00:00:00Z"),
    });
    const listed = await specialty(db, shop.id, personId, {
      specialty: "wreck",
      reviewNote: "Lena Ortiz · Wreck Diving",
      listedFromCertificationId: level?.id,
    });
    await reviewNitroxCertification(db, {
      ...agencyReview,
      shopId: shop.id,
      certificationId: imported.id,
    });
    await reviewSpecialtyCertification(db, {
      ...agencyReview,
      reviewNote: "Lena Ortiz · Wreck Diving 2021",
      shopId: shop.id,
      certificationId: listed.id,
    });

    await undoAgencyCheck(db, {
      ...checked(shop.id, personId, imported.id),
      undoneByPersonId: personId,
      cardType: "nitrox",
    });
    await undoAgencyCheck(db, {
      ...checked(shop.id, personId, listed.id),
      undoneByPersonId: personId,
      cardType: "specialty",
    });
    const [importedAfter] = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.id, imported.id));
    const [listedAfter] = await db
      .select()
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.id, listed.id));
    // Imported: verified and unreviewed, which is "awaiting a staff confirm".
    expect(importedAfter).toMatchObject({
      status: "verified",
      reviewedAt: null,
      agencyCheckedAt: null,
    });
    // Listed: pending again, with the agency's words kept as they were stamped.
    expect(listedAfter).toMatchObject({
      status: "pending",
      reviewedAt: null,
      agencyCheckedAt: null,
      reviewNote: "Lena Ortiz · Wreck Diving 2021",
    });
  });

  it("is not undone once a later review has landed on the card", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Lena Ortiz");
    const gas = await nitrox(db, shop.id, personId);
    await reviewNitroxCertification(db, {
      ...agencyReview,
      shopId: shop.id,
      certificationId: gas.id,
    });
    // A staffer's own review afterwards replaces the check's: no agency stamp remains.
    await db
      .update(nitroxCertifications)
      .set({ agencyCheckedAt: null })
      .where(eq(nitroxCertifications.id, gas.id));
    expect(
      await undoAgencyCheck(db, {
        ...checked(shop.id, personId, gas.id),
        undoneByPersonId: personId,
        cardType: "nitrox",
      }),
    ).toEqual({ ok: false });
  });
});
