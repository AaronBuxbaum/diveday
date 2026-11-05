import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";

vi.mock("./bookkeeper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./bookkeeper")>();
  return { ...actual, tellOwnersAboutBookkeeper: vi.fn(async () => 1) };
});

const { anonymizeDiver } = await import("./anonymize");
const {
  claimBookkeeperMonth,
  consumeBookkeeperConfirmation,
  issueBookkeeperConfirmation,
  readBookkeeper,
  setBookkeeper,
  tellOwnersAboutBookkeeper,
} = await import("./bookkeeper");
const { capabilities, people, personRoles, shops } = await import("./schema");

beforeEach(() => {
  vi.mocked(tellOwnersAboutBookkeeper).mockClear();
});

/**
 * Erasure reaches the bookkeeper's address (fifth loop, item 35), as it does
 * the shore contact's: a diver whose address a shop also set as its month-end
 * recipient asks to be forgotten, and the month stops leaving for it, and
 * the owners are told why without the address (second-pass N3). An address
 * that is not theirs is left alone.
 */
describe("anonymizeDiver — the bookkeeper's address", () => {
  async function setup(bookkeeper: string) {
    const { db, shop } = await seededShopContext();
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Bea Books", email: "Bea@Example.com" })
      .returning();
    if (!diver) throw new Error("diver insert failed");
    const now = new Date("2026-10-15T12:00:00Z");
    await setBookkeeper(db, {
      shopId: shop.id,
      timeZone: shop.timezone,
      email: bookkeeper,
      personId: owner.id,
      now,
    });
    const issued = await issueBookkeeperConfirmation(db, {
      shopId: shop.id,
      email: bookkeeper,
      now,
    });
    await consumeBookkeeperConfirmation(db, { token: issued?.token ?? "", now, origin: null });
    vi.mocked(tellOwnersAboutBookkeeper).mockClear();
    const erase = () =>
      anonymizeDiver(db, { shopId: shop.id, personId: diver.id, actorPersonId: owner.id });
    // The month-end email's stop link, a capability bound to the address (issue #3721).
    const claimed = await claimBookkeeperMonth(db, {
      shopId: shop.id,
      email: bookkeeper,
      setByPersonId: owner.id,
      month: "2099-01",
    });
    if (!claimed) throw new Error("expected a month-end claim");
    const row = async () => (await db.select().from(shops).where(eq(shops.id, shop.id)))[0];
    const stopLinks = async () =>
      (
        await db
          .select({ id: capabilities.id })
          .from(capabilities)
          .where(and(eq(capabilities.shopId, shop.id), eq(capabilities.purpose, "bookkeeper_stop")))
      ).length;
    return { erase, read: () => readBookkeeper(db, shop.id), row, stopLinks };
  }

  it("clears the address, its confirmation and its links when it is the erased diver's", async () => {
    const { erase, read, row, stopLinks } = await setup("bea@example.com");
    expect(await stopLinks()).toBe(1);
    expect((await row())?.bookkeeperConfirmTokenHash).not.toBeNull();
    expect((await erase()).ok).toBe(true);
    expect(await read()).toBeNull();
    expect(await row()).toMatchObject({
      bookkeeperSentMonth: null,
      bookkeeperConfirmedAt: null,
      bookkeeperConfirmTokenHash: null,
      bookkeeperConfirmExpiresAt: null,
    });
    expect(await stopLinks()).toBe(0);
    expect(tellOwnersAboutBookkeeper).toHaveBeenCalledTimes(1);
    expect(vi.mocked(tellOwnersAboutBookkeeper).mock.calls[0]?.[1]).toMatchObject({
      what: { event: "cleared", by: "erasure" },
    });
  });

  it("leaves somebody else's address alone", async () => {
    const { erase, read, stopLinks } = await setup("books@ledger.example");
    expect((await erase()).ok).toBe(true);
    expect((await read())?.email).toBe("books@ledger.example");
    expect(await stopLinks()).toBe(1);
    expect(tellOwnersAboutBookkeeper).not.toHaveBeenCalled();
  });
});
