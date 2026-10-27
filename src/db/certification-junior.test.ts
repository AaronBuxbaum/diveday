import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { recordJuniorCardStatus } from "./certification-junior";
import { createDiver } from "./divers";
import { loadDiverExportBundleInput } from "./export";
import { createCertification, reviewCertification } from "./readiness";
import { certificationJuniorReviews, certifications, people } from "./schema";

const ctx = fileScopedShopContext();

async function setup() {
  const { db, shop } = ctx;
  const diver = await createDiver(db, { shopId: shop.id, fullName: "Junior Evidence" });
  if (!diver) throw new Error("diver missing");
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")));
  if (!staff) throw new Error("staff missing");
  const card = await createCertification(db, {
    shopId: shop.id,
    personId: diver.id,
    agency: "naui",
    level: "open_water",
    identifier: `J-${diver.id}`,
  });
  if (!card) throw new Error("card missing");
  return { db, shop, diver, staff, card };
}

describe("junior card sighting", () => {
  it("requires a verified card and records each correction with the staff member", async () => {
    const { db, shop, diver, staff, card } = await setup();
    const input = {
      shopId: shop.id,
      personId: diver.id,
      certificationId: card.id,
      byPersonId: staff.id,
    };
    expect(await recordJuniorCardStatus(db, { ...input, juniorStatus: "junior" })).toMatchObject({
      ok: false,
    });
    expect(
      (
        await reviewCertification(db, {
          shopId: shop.id,
          certificationId: card.id,
          status: "verified",
          reviewedByPersonId: staff.id,
        })
      ).ok,
    ).toBe(true);
    expect(await recordJuniorCardStatus(db, { ...input, juniorStatus: "junior" })).toMatchObject({
      ok: true,
    });
    expect(await recordJuniorCardStatus(db, { ...input, juniorStatus: "full" })).toMatchObject({
      ok: true,
    });
    const [current] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    expect(current).toMatchObject({
      juniorStatus: "full",
      juniorStatusVerifiedByPersonId: staff.id,
      juniorStatusVerifiedAt: expect.any(Date),
    });
    const history = await db
      .select()
      .from(certificationJuniorReviews)
      .where(eq(certificationJuniorReviews.certificationId, card.id));
    expect(history.map((entry) => entry.juniorStatus).sort()).toEqual(["full", "junior"]);
    expect(
      history.every(
        (entry) => entry.recordedByPersonId === staff.id && entry.personId === diver.id,
      ),
    ).toBe(true);
  });

  it("rejects a mismatched shop or person and never lets the post turn a claim into a verified card", async () => {
    const { db, shop, diver, staff, card } = await setup();
    const input = {
      shopId: shop.id,
      personId: diver.id,
      certificationId: card.id,
      byPersonId: staff.id,
      juniorStatus: "full" as const,
    };
    expect(
      await recordJuniorCardStatus(db, {
        ...input,
        shopId: "00000000-0000-4000-8000-000000000001",
      }),
    ).toMatchObject({ ok: false });
    expect(await recordJuniorCardStatus(db, { ...input, personId: staff.id })).toMatchObject({
      ok: false,
    });
    expect(await recordJuniorCardStatus(db, input)).toMatchObject({ ok: false });
    const [current] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    expect(current).toMatchObject({ status: "pending", juniorStatus: null });
  });

  it("erases the diver's card-status history with their data", async () => {
    const { db, shop, diver, staff, card } = await setup();
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
      reviewedByPersonId: staff.id,
    });
    await recordJuniorCardStatus(db, {
      shopId: shop.id,
      personId: diver.id,
      certificationId: card.id,
      byPersonId: staff.id,
      juniorStatus: "junior",
    });
    expect(
      (await anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: staff.id }))
        .ok,
    ).toBe(true);
    expect(
      await db
        .select()
        .from(certificationJuniorReviews)
        .where(eq(certificationJuniorReviews.personId, diver.id)),
    ).toEqual([]);
    const [current] = await db.select().from(certifications).where(eq(certifications.id, card.id));
    expect(current?.juniorStatus).toBeNull();
  });

  it("exports a diver's own review history without another diver's", async () => {
    const { db, shop, diver, staff, card } = await setup();
    const other = await createDiver(db, { shopId: shop.id, fullName: "Another Junior" });
    if (!other) throw new Error("other diver missing");
    const otherCard = await createCertification(db, {
      shopId: shop.id,
      personId: other.id,
      agency: "sdi",
      level: "open_water",
      identifier: `K-${other.id}`,
    });
    if (!otherCard) throw new Error("other card missing");
    for (const cert of [card, otherCard]) {
      await reviewCertification(db, {
        shopId: shop.id,
        certificationId: cert.id,
        status: "verified",
        reviewedByPersonId: staff.id,
      });
      await recordJuniorCardStatus(db, {
        shopId: shop.id,
        personId: cert.personId,
        certificationId: cert.id,
        byPersonId: staff.id,
        juniorStatus: "junior",
      });
    }
    const bundle = await loadDiverExportBundleInput(db, shop.id, diver.id);
    const history = bundle?.tables.find(
      (table) => table.file === "certification_junior_reviews.csv",
    );
    expect(history?.rows).toHaveLength(1);
    expect(JSON.stringify(history)).toContain(card.id);
    expect(JSON.stringify(history)).not.toContain(otherCard.id);
  });
});
