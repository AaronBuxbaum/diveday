import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  issueLastMinuteListUnsubscribeToken,
  joinLastMinuteList,
  listLastMinuteList,
  resolveLastMinuteListUnsubscribeToken,
  unsubscribeLastMinuteListEntry,
  unsubscribeLastMinuteListEntryByToken,
} from "./last-minute-list";
import { lastMinuteListUnsubscribeTokens, shops } from "./schema";
import { listCertificationSummaries } from "./self-declared-cards";

const visitor = { fullName: "Nora Quinn", email: "nora@example.com", phone: "+1-305-555-0199" };

describe("joinLastMinuteList (in-memory PGlite)", () => {
  it("adds a diver with no capacity check, regardless of any trip", async () => {
    const { db, shop } = await seededShopContext();
    const outcome = await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    expect(outcome.personName).toBe("Nora Quinn");
    const list = await listLastMinuteList(db, shop.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.entry.id).toBe(outcome.entryId);
    expect(list[0]?.entry.availableFrom).toBeNull();
    expect(list[0]?.entry.availableUntil).toBeNull();
  });

  it("stores the stated date range", async () => {
    const { db, shop } = await seededShopContext();
    await joinLastMinuteList(db, {
      shopId: shop.id,
      ...visitor,
      availableFrom: "2026-08-01",
      availableUntil: "2026-08-10",
    });
    const [row] = await listLastMinuteList(db, shop.id);
    expect(row?.entry.availableFrom).toBe("2026-08-01");
    expect(row?.entry.availableUntil).toBe("2026-08-10");
  });

  it("reuses the same person and updates the range on a re-submission, keyed by email", async () => {
    const { db, shop } = await seededShopContext();
    const first = await joinLastMinuteList(db, {
      shopId: shop.id,
      ...visitor,
      availableFrom: "2026-08-01",
    });
    const again = await joinLastMinuteList(db, {
      shopId: shop.id,
      ...visitor,
      email: "NORA@example.com",
      availableFrom: "2026-09-01",
      availableUntil: "2026-09-10",
    });

    expect(again.entryId).toBe(first.entryId);
    const list = await listLastMinuteList(db, shop.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.entry.availableFrom).toBe("2026-09-01");
    expect(list[0]?.entry.availableUntil).toBe("2026-09-10");
  });

  it("reactivates an unsubscribed entry on re-submission", async () => {
    const { db, shop } = await seededShopContext();
    const joined = await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    await unsubscribeLastMinuteListEntry(db, { shopId: shop.id, entryId: joined.entryId });
    expect(await listLastMinuteList(db, shop.id)).toEqual([]);

    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    const list = await listLastMinuteList(db, shop.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.entry.unsubscribedAt).toBeNull();
  });

  /**
   * **H-13's borrowed-identity rule, applied to the one write here that is
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
    const { db, shop } = await seededShopContext();
    await joinLastMinuteList(db, {
      shopId: shop.id,
      ...visitor,
      declaration: { level: "open_water", noCertification: false, nitrox: false },
    });

    await joinLastMinuteList(db, {
      shopId: shop.id,
      email: visitor.email,
      fullName: "Someone Else Entirely",
      declaration: { level: "instructor", noCertification: false, nitrox: true },
    });

    const profiles = await listCertificationSummaries(db, shop.id, [
      (await listLastMinuteList(db, shop.id))[0]?.person.id ?? "",
    ]);
    const profile = [...profiles.values()][0];
    // The first joiner's own statement, untouched — and no nitrox claim at all,
    // since the mismatched submission was the only thing that ticked it.
    expect(profile?.level).toBe("open_water");
    expect(profile?.nitrox).toBe(false);
  });

  it("still creates the list entry on a name mismatch — only the evidence is withheld", async () => {
    const { db, shop } = await seededShopContext();
    const first = await joinLastMinuteList(db, { shopId: shop.id, ...visitor });

    const again = await joinLastMinuteList(db, {
      shopId: shop.id,
      email: visitor.email,
      fullName: "Someone Else Entirely",
      availableFrom: "2026-09-01",
      declaration: { level: "instructor", noCertification: false, nitrox: true },
    });

    // Joining a marketing list under a borrowed address is behaviour that
    // predates this change; refusing the opt-in would be a new regression.
    expect(again.entryId).toBe(first.entryId);
    const list = await listLastMinuteList(db, shop.id);
    expect(list).toHaveLength(1);
    expect(list[0]?.entry.availableFrom).toBe("2026-09-01");
    expect(await listCertificationSummaries(db, shop.id, [list[0]?.person.id ?? ""])).toEqual(
      new Map(),
    );
  });
});

describe("unsubscribeLastMinuteListEntry", () => {
  it("refuses to unsubscribe an entry from another shop", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-last-minute-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    const joined = await joinLastMinuteList(db, { shopId: shop.id, ...visitor });

    await expect(
      unsubscribeLastMinuteListEntry(db, { shopId: otherShop.id, entryId: joined.entryId }),
    ).resolves.toBe(false);
    expect(await listLastMinuteList(db, shop.id)).toHaveLength(1);
  });
});

describe("listLastMinuteList cross-tenant isolation", () => {
  it("a shop never sees another shop's last-minute-list entries", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-last-minute-list", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    expect(await listLastMinuteList(db, otherShop.id)).toEqual([]);
  });
});

// Leo (persona 15) — self-serve email unsubscribe (docs/product/features/story-backlog.md).
describe("self-serve unsubscribe token", () => {
  it("resolves a fresh token to the entry's shop, name, and not-yet-unsubscribed state", async () => {
    const { db, shop } = await seededShopContext();
    const joined = await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    const token = await issueLastMinuteListUnsubscribeToken(db, {
      shopId: shop.id,
      entryId: joined.entryId,
    });

    const context = await resolveLastMinuteListUnsubscribeToken(db, token);
    expect(context).toEqual({
      shopId: shop.id,
      shopName: shop.name,
      entryId: joined.entryId,
      alreadyUnsubscribed: false,
    });
  });

  it("reads an unknown token as unavailable, not a crash", async () => {
    const { db } = await seededShopContext();
    expect(await resolveLastMinuteListUnsubscribeToken(db, "not-a-real-token")).toBeNull();
  });

  it("unsubscribes the entry the token names, removing it from the active list", async () => {
    const { db, shop } = await seededShopContext();
    const joined = await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    const token = await issueLastMinuteListUnsubscribeToken(db, {
      shopId: shop.id,
      entryId: joined.entryId,
    });

    const context = await unsubscribeLastMinuteListEntryByToken(db, { token });
    expect(context?.alreadyUnsubscribed).toBe(false);
    expect(await listLastMinuteList(db, shop.id)).toEqual([]);
  });

  it("is idempotent — the same link clicked twice reads as already unsubscribed, never errors", async () => {
    const { db, shop } = await seededShopContext();
    const joined = await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    const token = await issueLastMinuteListUnsubscribeToken(db, {
      shopId: shop.id,
      entryId: joined.entryId,
    });

    const first = await unsubscribeLastMinuteListEntryByToken(db, { token });
    expect(first?.alreadyUnsubscribed).toBe(false);
    // The second call's own write is a no-op, and its returned context
    // correctly reports the entry was already unsubscribed — never an error.
    const second = await unsubscribeLastMinuteListEntryByToken(db, { token });
    expect(second?.alreadyUnsubscribed).toBe(true);
  });

  it("mints an independent token per blast — an earlier email's link keeps working after a later one is issued", async () => {
    const { db, shop } = await seededShopContext();
    const joined = await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    const first = await issueLastMinuteListUnsubscribeToken(db, {
      shopId: shop.id,
      entryId: joined.entryId,
    });
    const second = await issueLastMinuteListUnsubscribeToken(db, {
      shopId: shop.id,
      entryId: joined.entryId,
    });
    expect(first).not.toBe(second);

    await unsubscribeLastMinuteListEntryByToken(db, { token: first });
    // The second (later-issued, still-unused) token still resolves — clicking
    // whichever email a diver happens to open must always work.
    const context = await resolveLastMinuteListUnsubscribeToken(db, second);
    expect(context?.alreadyUnsubscribed).toBe(true);
  });

  it("never trusts a token whose stored shopId drifts from its entry's", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-unsubscribe-token", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    const joined = await joinLastMinuteList(db, { shopId: shop.id, ...visitor });
    const token = await issueLastMinuteListUnsubscribeToken(db, {
      shopId: shop.id,
      entryId: joined.entryId,
    });
    await db
      .update(lastMinuteListUnsubscribeTokens)
      .set({ shopId: otherShop.id })
      .where(eq(lastMinuteListUnsubscribeTokens.entryId, joined.entryId));

    expect(await resolveLastMinuteListUnsubscribeToken(db, token)).toBeNull();
  });
});
