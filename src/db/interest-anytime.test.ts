import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  askAnytime,
  issueInterestUnsubscribeToken,
  listOpenAnytimeInterests,
  listOpenAnytimeWindows,
  resolveInterestUnsubscribeToken,
  unsubscribeAnytimeInterestByToken,
} from "./interests";
import { interests, interestUnsubscribeTokens, shops } from "./schema";
import { listCertificationSummaries } from "./self-declared-cards";
import { setShopFeature } from "./shops";

const visitor = { fullName: "Nora Quinn", email: "nora@example.com", phone: "+1-305-555-0199" };

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

describe("askAnytime (in-memory PGlite)", () => {
  it("adds a diver with no capacity check, regardless of any trip", async () => {
    const { db, shop } = ctx;
    const outcome = await askAnytime(db, { shopId: shop.id, ...visitor });
    expect(outcome.personName).toBe("Nora Quinn");
    const list = await listOpenAnytimeInterests(db, shop.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.interest.id).toBe(outcome.interestId);
    expect(list[0]?.interest.availableFrom).toBeNull();
    expect(list[0]?.interest.availableUntil).toBeNull();
  });

  it("lists nobody while the shop has the list switched off, and everyone again once it is back on", async () => {
    const { db, shop } = ctx;
    await askAnytime(db, { shopId: shop.id, ...visitor });
    await setShopFeature(db, shop.id, "lastMinuteList", false);
    expect(await listOpenAnytimeInterests(db, shop.id)).toEqual([]);
    expect(await listOpenAnytimeWindows(db, shop.id)).toEqual([]);
    await setShopFeature(db, shop.id, "lastMinuteList", true);
    expect(await listOpenAnytimeInterests(db, shop.id)).toHaveLength(1);
    expect(await listOpenAnytimeWindows(db, shop.id)).toHaveLength(1);
  });

  it("stores the stated date range", async () => {
    const { db, shop } = ctx;
    await askAnytime(db, {
      shopId: shop.id,
      ...visitor,
      availableFrom: "2026-08-01",
      availableUntil: "2026-08-10",
    });
    const [row] = await listOpenAnytimeInterests(db, shop.id);
    expect(row?.interest.availableFrom).toBe("2026-08-01");
    expect(row?.interest.availableUntil).toBe("2026-08-10");
  });

  it("reuses the same person and updates the range on a re-submission, keyed by email", async () => {
    const { db, shop } = ctx;
    const first = await askAnytime(db, {
      shopId: shop.id,
      ...visitor,
      availableFrom: "2026-08-01",
    });
    const again = await askAnytime(db, {
      shopId: shop.id,
      ...visitor,
      email: "NORA@example.com",
      availableFrom: "2026-09-01",
      availableUntil: "2026-09-10",
    });

    expect(again.interestId).toBe(first.interestId);
    const list = await listOpenAnytimeInterests(db, shop.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.interest.availableFrom).toBe("2026-09-01");
    expect(list[0]?.interest.availableUntil).toBe("2026-09-10");
  });

  it("reopens an unsubscribed interest on re-submission", async () => {
    const { db, shop } = ctx;
    const joined = await askAnytime(db, { shopId: shop.id, ...visitor });
    await db
      .update(interests)
      .set({ closedAt: nowDate(), closedAs: "unsubscribed" })
      .where(eq(interests.id, joined.interestId));
    expect(await listOpenAnytimeInterests(db, shop.id)).toEqual([]);

    const again = await askAnytime(db, { shopId: shop.id, ...visitor });
    expect(again.interestId).toBe(joined.interestId);
    const list = await listOpenAnytimeInterests(db, shop.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.interest.closedAt).toBeNull();
    expect(list[0]?.interest.closedAs).toBeNull();
  });

  /**
   * **H-20260724-one-person-per-email's borrowed-identity rule, applied to the one write here that is
   * evidence about a body.**
   *
   * This form is unauthenticated and resolves a person by email alone, so an
   * address that already belongs to a diver under a *different* name may be a
   * second human — a family sharing an inbox, or somebody typing an address
   * that is not theirs. Every other write on this fork already refuses on a
   * mismatch: a booking is flagged `identityUnconfirmed`, `seat-claims.ts` will
   * not record so much as a phone number, `people.ts` will not record a locale.
   * A certification is stronger than all three.
   */
  it("does not write a declaration onto a person whose name does not match", async () => {
    const { db, shop } = ctx;
    await askAnytime(db, {
      shopId: shop.id,
      ...visitor,
      declaration: { level: "open_water", noCertification: false, nitrox: false },
    });

    await askAnytime(db, {
      shopId: shop.id,
      email: visitor.email,
      fullName: "Someone Else Entirely",
      declaration: { level: "instructor", noCertification: false, nitrox: true },
    });

    const profiles = await listCertificationSummaries(db, shop.id, [
      (await listOpenAnytimeInterests(db, shop.id))[0]?.person.id ?? "",
    ]);
    const profile = [...profiles.values()][0];
    // The first joiner's own statement, untouched — and no nitrox claim at all,
    // since the mismatched submission was the only thing that ticked it.
    expect(profile?.level).toBe("open_water");
    expect(profile?.nitrox).toBe(false);
  });

  it("still creates the list entry on a name mismatch — only the evidence is withheld", async () => {
    const { db, shop } = ctx;
    const first = await askAnytime(db, { shopId: shop.id, ...visitor });

    const again = await askAnytime(db, {
      shopId: shop.id,
      email: visitor.email,
      fullName: "Someone Else Entirely",
      availableFrom: "2026-09-01",
      declaration: { level: "instructor", noCertification: false, nitrox: true },
    });

    // Joining a marketing list under a borrowed address is behaviour that
    // predates this change; refusing the opt-in would be a new regression.
    expect(again.interestId).toBe(first.interestId);
    const list = await listOpenAnytimeInterests(db, shop.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.interest.availableFrom).toBe("2026-09-01");
    expect(await listCertificationSummaries(db, shop.id, [list[0]?.person.id ?? ""])).toEqual(
      new Map(),
    );
  });
});

describe("listOpenAnytimeInterests cross-tenant isolation", () => {
  it("a shop never sees another shop's last-minute-list interests", async () => {
    const { db, shop } = ctx;
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-last-minute-list", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    await askAnytime(db, { shopId: shop.id, ...visitor });
    expect(await listOpenAnytimeInterests(db, otherShop.id)).toEqual([]);
  });
});

// Leo (persona 15) — self-serve email unsubscribe (docs/product/features/story-backlog.md).
describe("self-serve unsubscribe token", () => {
  it("resolves a fresh token to the interest's shop, name, and not-yet-unsubscribed state", async () => {
    const { db, shop } = ctx;
    const joined = await askAnytime(db, { shopId: shop.id, ...visitor });
    const token = await issueInterestUnsubscribeToken(db, {
      shopId: shop.id,
      interestId: joined.interestId,
    });

    const context = await resolveInterestUnsubscribeToken(db, token);
    expect(context).toEqual({
      shopId: shop.id,
      shopName: shop.name,
      interestId: joined.interestId,
      alreadyUnsubscribed: false,
    });
  });

  it("reads an unknown token as unavailable, not a crash", async () => {
    const { db } = ctx;
    expect(await resolveInterestUnsubscribeToken(db, "not-a-real-token")).toBeNull();
  });

  it("unsubscribes the interest the token names, closing it as unsubscribed and removing it from the open list", async () => {
    const { db, shop } = ctx;
    const joined = await askAnytime(db, { shopId: shop.id, ...visitor });
    const token = await issueInterestUnsubscribeToken(db, {
      shopId: shop.id,
      interestId: joined.interestId,
    });

    const context = await unsubscribeAnytimeInterestByToken(db, { token });
    expect(context?.alreadyUnsubscribed).toBe(false);
    expect(await listOpenAnytimeInterests(db, shop.id)).toEqual([]);
    const [closed] = await db.select().from(interests).where(eq(interests.id, joined.interestId));
    expect(closed?.closedAs).toBe("unsubscribed");
  });

  it("is idempotent — the same link clicked twice reads as already unsubscribed, never errors", async () => {
    const { db, shop } = ctx;
    const joined = await askAnytime(db, { shopId: shop.id, ...visitor });
    const token = await issueInterestUnsubscribeToken(db, {
      shopId: shop.id,
      interestId: joined.interestId,
    });

    const first = await unsubscribeAnytimeInterestByToken(db, { token });
    expect(first?.alreadyUnsubscribed).toBe(false);
    // The second call's own write is a no-op, and its returned context
    // correctly reports the entry was already unsubscribed — never an error.
    const second = await unsubscribeAnytimeInterestByToken(db, { token });
    expect(second?.alreadyUnsubscribed).toBe(true);
  });

  it("mints an independent token per blast — an earlier email's link keeps working after a later one is issued", async () => {
    const { db, shop } = ctx;
    const joined = await askAnytime(db, { shopId: shop.id, ...visitor });
    const first = await issueInterestUnsubscribeToken(db, {
      shopId: shop.id,
      interestId: joined.interestId,
    });
    const second = await issueInterestUnsubscribeToken(db, {
      shopId: shop.id,
      interestId: joined.interestId,
    });
    expect(first).not.toBe(second);

    await unsubscribeAnytimeInterestByToken(db, { token: first });
    // The second (later-issued, still-unused) token still resolves — clicking
    // whichever email a diver happens to open must always work.
    const context = await resolveInterestUnsubscribeToken(db, second);
    expect(context?.alreadyUnsubscribed).toBe(true);
  });

  it("never trusts a token whose stored shopId drifts from its interest's", async () => {
    const { db, shop } = ctx;
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-unsubscribe-token", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    const joined = await askAnytime(db, { shopId: shop.id, ...visitor });
    const token = await issueInterestUnsubscribeToken(db, {
      shopId: shop.id,
      interestId: joined.interestId,
    });
    await db
      .update(interestUnsubscribeTokens)
      .set({ shopId: otherShop.id })
      .where(eq(interestUnsubscribeTokens.interestId, joined.interestId));

    expect(await resolveInterestUnsubscribeToken(db, token)).toBeNull();
  });
});
