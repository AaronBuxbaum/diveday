import { beforeEach, describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { listMarineLifeRequests, recordMarineLifeRequest } from "./marine-life-requests";
import { people } from "./schema";

/**
 * The field guide only shows species DiveDay carries, so a shop outside the
 * catalog's water meets a refusal (ADR 20260813-marine-life-is-diveday-copy).
 * This table is the other half of that refusal, and the property worth testing
 * is that it *keeps* what was asked for — a request the picker swallows is the
 * dead end the feature exists to remove.
 */
describe("marine-life requests", () => {
  let db: Awaited<ReturnType<typeof seededShopContext>>["db"];
  let shopId: string;
  let personId: string;

  beforeEach(async () => {
    const context = await seededShopContext();
    db = context.db;
    shopId = context.shop.id;
    const [person] = await db.select({ id: people.id }).from(people).limit(1);
    if (!person) throw new Error("seeded shop has no people");
    personId = person.id;
  });

  it("keeps what a shop asked for, and who asked", async () => {
    await recordMarineLifeRequest(db, {
      shopId,
      requestedByPersonId: personId,
      query: "Pygmy seahorse",
    });

    const [row] = await listMarineLifeRequests(db);
    expect(row).toMatchObject({ shopId, requestedByPersonId: personId, query: "Pygmy seahorse" });
  });

  it("records the same species twice rather than deduping it", async () => {
    // Two shops asking for one animal is the signal, not a conflict — the
    // count is how a region earns its place in the catalog ahead of a guess.
    for (const query of ["Frogfish", "Frogfish"]) {
      await recordMarineLifeRequest(db, { shopId, requestedByPersonId: personId, query });
    }

    expect(await listMarineLifeRequests(db)).toHaveLength(2);
  });

  it("refuses a blank ask without writing a row", async () => {
    // Guarded in the writer rather than only at the form, so a hand-rolled
    // post cannot fill the table with empty rows either.
    await recordMarineLifeRequest(db, { shopId, requestedByPersonId: personId, query: "   " });

    expect(await listMarineLifeRequests(db)).toEqual([]);
  });

  it("trims and bounds what it stores", async () => {
    await recordMarineLifeRequest(db, {
      shopId,
      requestedByPersonId: personId,
      query: `  ${"a".repeat(400)}  `,
    });

    const [row] = await listMarineLifeRequests(db);
    expect(row?.query).toHaveLength(120);
  });
});
