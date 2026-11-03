// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { readCertificationEvidence } from "./certification-evidence";
import { cards, certificationJuniorReviews, people } from "./schema";
import {
  premergeCertifications,
  premergeNitroxCertifications,
  premergeSpecialtyCertifications,
} from "./schema-retired/premerge-cards";

/**
 * **The card ledger's own rules** (issue #2722): one table holds level,
 * specialty and nitrox cards, so what kept them apart is now the `kind` column
 * and the checks and indexes keyed on it. Each test here is a way one kind of
 * card could pass for another, or a card could clear a gate it should not, and
 * the database refusing it.
 */
const ctx = fileScopedShopContext();

async function diver(name = "Ledger Diver") {
  const [row] = await ctx.db
    .insert(people)
    .values({ shopId: ctx.shop.id, fullName: name, email: `${randomUUID()}@example.com` })
    .returning({ id: people.id });
  if (!row) throw new Error("person insert failed");
  return row.id;
}

/** The SQLSTATE of the error a statement raised, or null when it succeeded. */
async function refusal(statement: () => Promise<unknown>): Promise<string | null> {
  try {
    // A savepoint on the test's own connection, so a refusal rolls back only
    // this statement and the test goes on.
    await ctx.db.transaction(async () => {
      await statement();
    });
    return null;
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause ?? error;
    return (cause as { code?: string }).code ?? "unknown";
  }
}

describe("what the database refuses", () => {
  it("a card whose kind and rung or specialty disagree", async () => {
    const personId = await diver();
    const base = { shopId: ctx.shop.id, personId, agency: "padi" as const, identifier: "K-1" };
    // A level card with no rung, or carrying a specialty, is no level card.
    expect(await refusal(() => ctx.db.insert(cards).values({ ...base, kind: "level" }))).toBe(
      "23514",
    );
    expect(
      await refusal(() =>
        ctx.db
          .insert(cards)
          .values({ ...base, kind: "level", level: "open_water", specialty: "deep" }),
      ),
    ).toBe("23514");
    // A nitrox card that names a rung would read as a ladder card to a reader
    // that forgot its kind filter.
    expect(
      await refusal(() =>
        ctx.db.insert(cards).values({ ...base, kind: "nitrox", level: "divemaster" }),
      ),
    ).toBe("23514");
    expect(await refusal(() => ctx.db.insert(cards).values({ ...base, kind: "specialty" }))).toBe(
      "23514",
    );
    expect(
      await refusal(() =>
        ctx.db
          .insert(cards)
          .values({ ...base, kind: "specialty", specialty: "deep", level: "open_water" }),
      ),
    ).toBe("23514");
  });

  it("level-only columns on another kind of card", async () => {
    const personId = await diver();
    const base = {
      shopId: ctx.shop.id,
      personId,
      agency: "padi" as const,
      identifier: "LV-1",
      kind: "nitrox" as const,
    };
    expect(
      await refusal(() => ctx.db.insert(cards).values({ ...base, declaredIdentifier: "LV-9" })),
    ).toBe("23514");
    expect(
      await refusal(() =>
        ctx.db.insert(cards).values({
          ...base,
          juniorStatus: "junior",
          juniorStatusVerifiedAt: nowDate(),
          juniorStatusVerifiedByPersonId: personId,
        }),
      ),
    ).toBe("23514");
  });

  it("a level card marked as listed by another card's agency check", async () => {
    const personId = await diver();
    const [level] = await ctx.db
      .insert(cards)
      .values({
        shopId: ctx.shop.id,
        personId,
        kind: "level",
        agency: "padi",
        level: "open_water",
        identifier: "LIST-1",
      })
      .returning({ id: cards.id });
    expect(
      await refusal(() =>
        ctx.db.insert(cards).values({
          shopId: ctx.shop.id,
          personId,
          kind: "level",
          agency: "padi",
          level: "advanced_open_water",
          identifier: "LIST-2",
          listedFromCertificationId: level?.id,
        }),
      ),
    ).toBe("23514");
  });

  it("a verified specialty or nitrox card with no number, even one this shop issued", async () => {
    const personId = await diver();
    const issued = { issuedByShopAt: nowDate(), status: "verified" as const };
    // The fill and the deep gate wait for somebody to look at a card.
    for (const card of [
      { kind: "nitrox" as const },
      { kind: "specialty" as const, specialty: "deep" as const },
    ]) {
      expect(
        await refusal(() =>
          ctx.db
            .insert(cards)
            .values({ shopId: ctx.shop.id, personId, agency: "padi", ...card, ...issued }),
        ),
      ).toBe("23514");
    }
    // A level card the shop issued is the instructor's own evidence, and the
    // number is the agency's processing lag.
    expect(
      await refusal(() =>
        ctx.db.insert(cards).values({
          shopId: ctx.shop.id,
          personId,
          kind: "level",
          agency: "padi",
          level: "open_water",
          ...issued,
        }),
      ),
    ).toBeNull();
  });

  it("a verified self-declaration with no number, of any kind", async () => {
    const personId = await diver();
    for (const card of [
      { kind: "level" as const, level: "open_water" as const },
      { kind: "nitrox" as const },
      { kind: "specialty" as const, specialty: "night" as const },
    ]) {
      expect(
        await refusal(() =>
          ctx.db.insert(cards).values({
            shopId: ctx.shop.id,
            personId,
            agency: "other",
            ...card,
            selfDeclaredAt: nowDate(),
            status: "verified",
          }),
        ),
      ).toBe("23514");
    }
  });
});

describe("one card number, more than one kind", () => {
  it("lets a RAID diver's nitrox card carry the level card's number", async () => {
    const personId = await diver();
    const base = { shopId: ctx.shop.id, personId, agency: "raid" as const, identifier: "RAID-77" };
    await ctx.db.insert(cards).values({ ...base, kind: "level", level: "open_water" });
    expect(
      await refusal(() => ctx.db.insert(cards).values({ ...base, kind: "nitrox" })),
    ).toBeNull();
  });

  it("lets one agency number carry a diver's Deep and Wreck cards", async () => {
    const personId = await diver();
    const base = { shopId: ctx.shop.id, personId, agency: "padi" as const, identifier: "P-55" };
    await ctx.db.insert(cards).values({ ...base, kind: "specialty", specialty: "deep" });
    expect(
      await refusal(() =>
        ctx.db.insert(cards).values({ ...base, kind: "specialty", specialty: "wreck" }),
      ),
    ).toBeNull();
    expect(
      await refusal(() =>
        ctx.db
          .insert(cards)
          .values({ ...base, kind: "specialty", specialty: "deep", identifier: "p-55" }),
      ),
    ).toBe("23505");
  });

  it("still refuses a second live card of the same kind under one number", async () => {
    const personId = await diver();
    const base = { shopId: ctx.shop.id, personId, agency: "ssi" as const, identifier: "S-12" };
    await ctx.db.insert(cards).values({ ...base, kind: "level", level: "open_water" });
    expect(
      await refusal(() =>
        ctx.db
          .insert(cards)
          .values({ ...base, kind: "level", level: "rescue", identifier: "s-12" }),
      ),
    ).toBe("23505");
    await ctx.db.insert(cards).values({ ...base, kind: "nitrox" });
    expect(await refusal(() => ctx.db.insert(cards).values({ ...base, kind: "nitrox" }))).toBe(
      "23505",
    );
  });
});

describe("the evidence a gate reads", () => {
  it("sorts a diver's cards by kind, so no gate reads another kind's card", async () => {
    const personId = await diver();
    const verified = { shopId: ctx.shop.id, personId, status: "verified" as const };
    await ctx.db.insert(cards).values([
      { ...verified, kind: "nitrox", agency: "padi", identifier: "N-1" },
      { ...verified, kind: "specialty", agency: "padi", specialty: "deep", identifier: "D-1" },
    ]);
    const evidence = await readCertificationEvidence(ctx.db, ctx.shop.id, personId);
    // A verified nitrox card and a verified Deep card say nothing about the
    // diver's rung: the ladder sees no card at all.
    expect(evidence.certifications).toEqual([]);
    expect(evidence.nitroxCertifications.map((card) => card.identifier)).toEqual(["N-1"]);
    expect(evidence.specialtyCertifications.map((card) => card.specialty)).toEqual(["deep"]);
  });
});

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const COPY = readdirSync(MIGRATIONS).find((name) => name.endsWith("_copy-cards-from-three-tables"));

describe("the migration that copied the three tables into the ledger", () => {
  it("keeps every card's id, kind and provenance", async () => {
    if (!COPY) throw new Error("the copy-cards migration is missing");
    const personId = await diver();
    const staff = await diver("Ledger Staff");
    const now = nowDate();
    const [level] = await ctx.db
      .insert(premergeCertifications)
      .values({
        shopId: ctx.shop.id,
        personId,
        agency: "padi",
        level: "advanced_open_water",
        declaredIdentifier: "AOW-TYPED",
        selfDeclaredAt: now,
        juniorStatus: "junior",
        juniorStatusVerifiedAt: now,
        juniorStatusVerifiedByPersonId: staff,
      })
      .returning();
    const [specialty] = await ctx.db
      .insert(premergeSpecialtyCertifications)
      .values({
        shopId: ctx.shop.id,
        personId,
        agency: "padi",
        specialty: "deep",
        status: "pending",
        listedFromCertificationId: level?.id,
      })
      .returning();
    const [nitrox] = await ctx.db
      .insert(premergeNitroxCertifications)
      .values({
        shopId: ctx.shop.id,
        personId,
        agency: "padi",
        identifier: "EANX-1",
        status: "verified",
        importedAt: now,
        importedFromLabel: "Coral Coast Divers",
      })
      .returning();
    if (!level || !specialty || !nitrox) throw new Error("premerge insert failed");

    // The ledger is empty for this person until the copy runs; the other rows
    // this file wrote are cleared so the copy cannot collide with its own ids.
    await ctx.db.delete(certificationJuniorReviews);
    await ctx.db.delete(cards);
    const text = readFileSync(path.join(MIGRATIONS, COPY, "migration.sql"), "utf8");
    for (const statement of text.split("--> statement-breakpoint")) {
      await ctx.db.execute(sql.raw(statement));
    }

    const copied = await ctx.db
      .select()
      .from(cards)
      .where(and(eq(cards.personId, personId)));
    const byId = new Map(copied.map((card) => [card.id, card]));
    expect(byId.get(level.id)).toMatchObject({
      kind: "level",
      level: "advanced_open_water",
      specialty: null,
      identifier: null,
      declaredIdentifier: "AOW-TYPED",
      status: "pending",
      selfDeclaredAt: now,
      juniorStatus: "junior",
    });
    expect(byId.get(specialty.id)).toMatchObject({
      kind: "specialty",
      level: null,
      specialty: "deep",
      status: "pending",
      listedFromCertificationId: level.id,
    });
    expect(byId.get(nitrox.id)).toMatchObject({
      kind: "nitrox",
      level: null,
      specialty: null,
      identifier: "EANX-1",
      status: "verified",
      importedAt: now,
      importedFromLabel: "Coral Coast Divers",
      reviewedAt: null,
    });
  });
});
