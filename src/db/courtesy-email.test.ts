import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  issuePersonCourtesyEmailUnsubscribeToken,
  optOutAddressAfterComplaint,
  optOutPersonFromCourtesyEmailByToken,
  resolveCourtesyEmailUnsubscribeToken,
} from "./courtesy-email";
import { joinLastMinuteList } from "./last-minute-list";
import { findOrCreatePerson } from "./people";
import {
  lastMinuteListEntries,
  people,
  personCourtesyEmailUnsubscribeTokens,
  shops,
} from "./schema";

async function seededPerson() {
  const { db, shop } = await seededShopContext();
  const { person } = await findOrCreatePerson(db, {
    shopId: shop.id,
    fullName: "Nora Quinn",
    email: "nora-courtesy@example.com",
  });
  return { db, shop, person };
}

// Leo (persona 15) — self-serve email unsubscribe (docs/product/features/story-backlog.md):
// the general, cross-kind counterpart to the last-minute-list entry's own
// token, governing `waitlist_invite` and `trip_recap` instead.
describe("self-serve courtesy-email unsubscribe token", () => {
  it("resolves a fresh token to the person's shop, name, and not-yet-opted-out state", async () => {
    const { db, shop, person } = await seededPerson();
    const token = await issuePersonCourtesyEmailUnsubscribeToken(db, {
      shopId: shop.id,
      personId: person.id,
    });

    const context = await resolveCourtesyEmailUnsubscribeToken(db, token);
    expect(context).toEqual({
      shopId: shop.id,
      shopName: shop.name,
      personId: person.id,
      alreadyOptedOut: false,
    });
  });

  it("reads an unknown token as unavailable, not a crash", async () => {
    const { db } = await seededShopContext();
    expect(await resolveCourtesyEmailUnsubscribeToken(db, "not-a-real-token")).toBeNull();
  });

  it("opts the person the token names out, without touching other people", async () => {
    const { db, shop, person } = await seededPerson();
    const token = await issuePersonCourtesyEmailUnsubscribeToken(db, {
      shopId: shop.id,
      personId: person.id,
    });

    const context = await optOutPersonFromCourtesyEmailByToken(db, { token });
    expect(context?.alreadyOptedOut).toBe(false);
    const [row] = await db.select().from(people).where(eq(people.id, person.id));
    expect(row?.courtesyEmailOptOutAt).not.toBeNull();
  });

  it("is idempotent — the same link clicked twice reads as already opted out, never errors", async () => {
    const { db, shop, person } = await seededPerson();
    const token = await issuePersonCourtesyEmailUnsubscribeToken(db, {
      shopId: shop.id,
      personId: person.id,
    });

    const first = await optOutPersonFromCourtesyEmailByToken(db, { token });
    expect(first?.alreadyOptedOut).toBe(false);
    const second = await optOutPersonFromCourtesyEmailByToken(db, { token });
    expect(second?.alreadyOptedOut).toBe(true);
  });

  it("mints an independent token per send — an earlier email's link keeps working after a later one is issued", async () => {
    const { db, shop, person } = await seededPerson();
    const first = await issuePersonCourtesyEmailUnsubscribeToken(db, {
      shopId: shop.id,
      personId: person.id,
    });
    const second = await issuePersonCourtesyEmailUnsubscribeToken(db, {
      shopId: shop.id,
      personId: person.id,
    });
    expect(first).not.toBe(second);

    await optOutPersonFromCourtesyEmailByToken(db, { token: first });
    const context = await resolveCourtesyEmailUnsubscribeToken(db, second);
    expect(context?.alreadyOptedOut).toBe(true);
  });

  it("never trusts a token whose stored shopId drifts from its person's", async () => {
    const { db, shop, person } = await seededPerson();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-courtesy-unsubscribe", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    const token = await issuePersonCourtesyEmailUnsubscribeToken(db, {
      shopId: shop.id,
      personId: person.id,
    });
    await db
      .update(personCourtesyEmailUnsubscribeTokens)
      .set({ shopId: otherShop.id })
      .where(eq(personCourtesyEmailUnsubscribeTokens.personId, person.id));

    expect(await resolveCourtesyEmailUnsubscribeToken(db, token)).toBeNull();
  });
});

// ADR 20260902-sender-standards-for-ses: a spam complaint is an unsubscribe.
describe("a complaint opts the address out", () => {
  it("stops courtesy mail and every live last-minute entry for that address, in that shop only", async () => {
    const { db, shop, person } = await seededPerson();
    await joinLastMinuteList(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora-courtesy@example.com",
    });
    const { person: neighbour } = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Sam Reyes",
      email: "sam@example.com",
    });
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef", timezone: "America/New_York" })
      .returning({ id: shops.id });
    if (!otherShop) throw new Error("second shop insert failed");
    const { person: sameAddressElsewhere } = await findOrCreatePerson(db, {
      shopId: otherShop.id,
      fullName: "Nora Quinn",
      email: "nora-courtesy@example.com",
    });
    const at = new Date("2026-09-02T12:00:00.000Z");

    const outcome = await optOutAddressAfterComplaint(db, {
      shopId: shop.id,
      email: "NORA-Courtesy@example.com",
      now: at,
    });

    expect(outcome).toEqual({ people: 1, listEntries: 1 });
    const [row] = await db.select().from(people).where(eq(people.id, person.id));
    expect(row?.courtesyEmailOptOutAt).toEqual(at);
    const [entry] = await db
      .select()
      .from(lastMinuteListEntries)
      .where(eq(lastMinuteListEntries.personId, person.id));
    expect(entry?.unsubscribedAt).toEqual(at);
    const [other] = await db.select().from(people).where(eq(people.id, neighbour.id));
    expect(other?.courtesyEmailOptOutAt).toBeNull();
    const [elsewhere] = await db
      .select()
      .from(people)
      .where(eq(people.id, sameAddressElsewhere.id));
    expect(elsewhere?.courtesyEmailOptOutAt).toBeNull();
  });

  it("is idempotent, and does nothing for an address the shop does not know", async () => {
    const { db, shop } = await seededPerson();
    expect(
      await optOutAddressAfterComplaint(db, {
        shopId: shop.id,
        email: "nora-courtesy@example.com",
      }),
    ).toEqual({ people: 1, listEntries: 0 });
    expect(
      await optOutAddressAfterComplaint(db, {
        shopId: shop.id,
        email: "nora-courtesy@example.com",
      }),
    ).toEqual({ people: 0, listEntries: 0 });
    expect(
      await optOutAddressAfterComplaint(db, { shopId: shop.id, email: "stranger@example.com" }),
    ).toEqual({ people: 0, listEntries: 0 });
  });
});
