import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { judgeAgencyPage } from "@/lib/agency-check";
import { fileScopedShopContext } from "@/test/db";
import { certificationForAgencyCheck, listAgencyCheckableCards } from "./agency-check";
import type { AppDb } from "./client";
import { certifications, people, shops } from "./schema";
import { recordSelfDeclaredCards } from "./self-declared-cards";
import { withAgencyChecks } from "./today";

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

async function diver(db: AppDb, shopId: string, fullName: string, dateOfBirth = "1990-04-12") {
  const [person] = await db.insert(people).values({ shopId, fullName, dateOfBirth }).returning();
  if (!person) throw new Error("failed to insert a diver");
  return person.id;
}

async function card(
  db: AppDb,
  shopId: string,
  personId: string,
  values: Partial<typeof certifications.$inferInsert> = {},
) {
  const [row] = await db
    .insert(certifications)
    .values({
      shopId,
      personId,
      agency: "ssi",
      level: "open_water",
      identifier: `SSI-${personId.slice(0, 8)}`,
      status: "pending",
      ...values,
    })
    .returning();
  if (!row) throw new Error("failed to insert a card");
  return row;
}

/**
 * **The cards a departure or the Today list offers to check** (H-105). The
 * The list and action share a read, but an SSI row can offer the manual
 * handoff with incomplete identity even though the judge cannot certify it.
 */
describe("listAgencyCheckableCards", () => {
  it("offers a pending level card the extension can look up, with its lookup", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Lena Ortiz");
    const pending = await card(db, shop.id, personId, { identifier: "SSI-4471" });

    const byPerson = await listAgencyCheckableCards(db, { shopId: shop.id, personIds: [personId] });

    expect(byPerson.get(personId)).toEqual([
      {
        certificationId: pending.id,
        personId,
        fullName: "Lena Ortiz",
        agency: "ssi",
        query: {
          agency: "ssi",
          firstName: "Lena",
          lastName: "Ortiz",
          birthDate: "1990-04-12",
          cardNumber: "SSI-4471",
        },
      },
    ]);
  });

  it("omits ineligible cards while allowing SSI's manual lookup for a one-word name", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Mara Quinn");
    const refused = [
      // Already certified.
      await card(db, shop.id, personId, {
        status: "verified",
        reviewedAt: new Date("2026-10-01T00:00:00Z"),
      }),
      // An agency the extension does not check (TDI's recreational cards are SDI's).
      await card(db, shop.id, personId, { agency: "tdi", identifier: "T-1" }),
      // Deleted.
      await card(db, shop.id, personId, { deletedAt: new Date("2026-10-01T00:00:00Z") }),
      // A professional rating, at any agency: checked on the agency's pro tool.
      await card(db, shop.id, personId, { level: "divemaster", identifier: "SSI-DM-1" }),
      await card(db, shop.id, personId, { agency: "padi", level: "instructor", identifier: "P-1" }),
    ];
    await recordSelfDeclaredCards(db, { shopId: shop.id, personId, level: "advanced_open_water" });
    const [claim] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.personId, personId));

    // SSI can open a manual lookup with just a first name, but that incomplete
    // identity must never turn a returned page into a verified card.
    const oneName = await diver(db, shop.id, "Cher");
    const oneNameCard = await card(db, shop.id, oneName);

    const byPerson = await listAgencyCheckableCards(db, {
      shopId: shop.id,
      personIds: [personId, oneName],
    });

    expect(byPerson.has(personId)).toBe(false);
    expect(byPerson.get(oneName)).toEqual([
      expect.objectContaining({
        certificationId: oneNameCard.id,
        query: expect.objectContaining({
          firstName: "Cher",
          lastName: "",
          birthDate: "1990-04-12",
        }),
      }),
    ]);
    const manual = await certificationForAgencyCheck(db, {
      shopId: shop.id,
      personId: oneName,
      certificationId: oneNameCard.id,
    });
    expect(manual).not.toBeNull();
    if (!manual) throw new Error("manual SSI lookup missing");
    expect(
      judgeAgencyPage({
        ...manual.query,
        ...manual.identity,
        level: manual.level,
        today: "2026-10-26",
        pageText: `Cher\n${oneNameCard.identifier}\nOpen Water Diver`,
      }).verdict,
    ).toBe("unreadable");
    for (const [owner, row] of [...[...refused, claim].map((row) => [personId, row] as const)]) {
      if (!row) continue;
      expect(
        await certificationForAgencyCheck(db, {
          shopId: shop.id,
          personId: owner,
          certificationId: row.id,
        }),
      ).toBeNull();
    }
  });

  it("offers a pending PADI card for DiveChek only when the diver's birth date is on file", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ padiChecksEnabled: true }).where(eq(shops.id, shop.id));
    const dated = await diver(db, shop.id, "Lena Ortiz");
    const padi = await card(db, shop.id, dated, { agency: "padi", identifier: "1506AB1234" });
    const [undated] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Iris Dale" })
      .returning();
    if (!undated) throw new Error("failed to insert a diver");
    const undatedCard = await card(db, shop.id, undated.id, {
      agency: "padi",
      identifier: "1506AB9999",
    });

    const byPerson = await listAgencyCheckableCards(db, {
      shopId: shop.id,
      personIds: [dated, undated.id],
    });

    expect(byPerson.get(dated)?.map((c) => c.certificationId)).toEqual([padi.id]);
    expect(byPerson.get(dated)?.[0]?.query).toMatchObject({
      agency: "padi",
      firstName: "Lena",
      lastName: "Ortiz",
      birthDate: "1990-04-12",
    });
    expect(byPerson.has(undated.id)).toBe(false);
    expect(
      await certificationForAgencyCheck(db, {
        shopId: shop.id,
        personId: undated.id,
        certificationId: undatedCard.id,
      }),
    ).toBeNull();
  });

  it("offers no PADI card at a shop that has not turned PADI checks on, and keeps the rest", async () => {
    const { db, shop } = ctx;
    // The seeded demo runs them; a new shop does not.
    await db.update(shops).set({ padiChecksEnabled: false }).where(eq(shops.id, shop.id));
    const personId = await diver(db, shop.id, "Lena Ortiz");
    const padi = await card(db, shop.id, personId, { agency: "padi", identifier: "1506AB1234" });
    const ssi = await card(db, shop.id, personId, { level: "advanced_open_water" });

    const byPerson = await listAgencyCheckableCards(db, { shopId: shop.id, personIds: [personId] });

    expect(byPerson.get(personId)?.map((c) => c.certificationId)).toEqual([ssi.id]);
    expect(
      await certificationForAgencyCheck(db, {
        shopId: shop.id,
        personId,
        certificationId: padi.id,
      }),
    ).toBeNull();
  });

  it("offers an imported card still waiting for its confirm", async () => {
    const { db, shop } = ctx;
    const personId = await diver(db, shop.id, "Iris Kahale");
    const imported = await card(db, shop.id, personId, {
      status: "verified",
      importedAt: new Date("2026-10-01T00:00:00Z"),
    });

    const byPerson = await listAgencyCheckableCards(db, { shopId: shop.id, personIds: [personId] });

    expect(byPerson.get(personId)?.map((row) => row.certificationId)).toEqual([imported.id]);
  });

  it("keeps to the divers it was asked about, at this shop", async () => {
    const { db, shop } = ctx;
    const asked = await diver(db, shop.id, "Asked About");
    const other = await diver(db, shop.id, "Not Asked");
    await card(db, shop.id, asked);
    await card(db, shop.id, other);

    const byPerson = await listAgencyCheckableCards(db, { shopId: shop.id, personIds: [asked] });
    expect([...byPerson.keys()]).toEqual([asked]);

    const elsewhere = await listAgencyCheckableCards(db, {
      shopId: "00000000-0000-4000-8000-000000000000",
      personIds: [asked],
    });
    expect(elsewhere.size).toBe(0);
  });

  it("answers an empty list without a read", async () => {
    const { db, shop } = ctx;
    expect((await listAgencyCheckableCards(db, { shopId: shop.id, personIds: [] })).size).toBe(0);
  });
});

/**
 * **Today's "certification pending" row and its check** (H-105): the queue
 * names the diver, the read fills in the cards, and a row with nothing the
 * extension can check carries no offer at all.
 */
describe("withAgencyChecks", () => {
  function row(personId: string | null, id: string) {
    return {
      id,
      kind: "certification" as const,
      urgency: "soon" as const,
      subject: "Somebody",
      context: null,
      detail: "Certification pending",
      actionLabel: "Open their record",
      href: "/shop/blue-mantis/divers/x",
      dueAt: null,
      ...(personId ? { agencyCheck: { personId, cards: [] } } : {}),
    };
  }

  it("fills in the cards, drops the offer where there are none, and leaves other rows alone", async () => {
    const { db, shop } = ctx;
    const checkable = await diver(db, shop.id, "Noa Peleke");
    const pending = await card(db, shop.id, checkable);
    const tdiOnly = await diver(db, shop.id, "Tomas Reyes");
    await card(db, shop.id, tdiOnly, { agency: "tdi", identifier: "T-9" });

    const [withCards, withNone, untouched] = await withAgencyChecks(db, shop.id, [
      row(checkable, "a"),
      row(tdiOnly, "b"),
      row(null, "c"),
    ]);

    expect(withCards?.agencyCheck?.cards.map((c) => c.certificationId)).toEqual([pending.id]);
    expect(withNone).not.toHaveProperty("agencyCheck");
    expect(untouched).toEqual(row(null, "c"));
  });
});
