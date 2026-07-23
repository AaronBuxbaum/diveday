// @vitest-environment node

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  listPendingMediaDeletions,
  queueAndAttemptMediaDeletion,
  queueMediaDeletion,
  resolveMediaDeletion,
  retryMediaDeletion,
  retryPendingMediaDeletions,
} from "./media-deletions";
import { mediaDeletionAttempts, shops } from "./schema";

const ok = async () => ({ ok: true as const });
const failing = async () => ({ ok: false as const, error: "blob delete failed: 500" });

describe("queueMediaDeletion / resolveMediaDeletion", () => {
  it("is durable before the delete call, then records how it resolved", async () => {
    const { db, shop } = await seededShopContext();
    const attempt = await queueMediaDeletion(db, {
      shopId: shop.id,
      kind: "recap_photo",
      url: "https://blob.example/recap/a.jpg",
    });
    expect(attempt.status).toBe("pending");
    expect(attempt.resolvedAt).toBeNull();

    await resolveMediaDeletion(db, attempt.id, { status: "succeeded" });
    const [row] = await db
      .select()
      .from(mediaDeletionAttempts)
      .where(eq(mediaDeletionAttempts.id, attempt.id));
    expect(row?.status).toBe("succeeded");
    expect(row?.resolvedAt).not.toBeNull();
  });

  it("leaves a failed attempt unresolved (retryable), with the error recorded", async () => {
    const { db, shop } = await seededShopContext();
    const attempt = await queueMediaDeletion(db, {
      shopId: shop.id,
      kind: "course_photo",
      url: "https://blob.example/courses/a.jpg",
    });
    await resolveMediaDeletion(db, attempt.id, { status: "failed", error: "network error" });
    const [row] = await db
      .select()
      .from(mediaDeletionAttempts)
      .where(eq(mediaDeletionAttempts.id, attempt.id));
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toBe("network error");
    expect(row?.resolvedAt).toBeNull();
    expect(row?.attempts).toBe(1);
  });
});

describe("queueAndAttemptMediaDeletion", () => {
  it("resolves succeeded on the common path", async () => {
    const { db, shop } = await seededShopContext();
    await queueAndAttemptMediaDeletion(
      db,
      { shopId: shop.id, kind: "recap_photo", url: "https://blob.example/recap/b.jpg" },
      ok,
    );
    const pending = await listPendingMediaDeletions(db, shop.id, new Date(Date.now() + 1000));
    expect(pending).toEqual([]);
  });

  it("leaves a failed delete pending and owner-visible rather than swallowing it", async () => {
    const { db, shop } = await seededShopContext();
    await queueAndAttemptMediaDeletion(
      db,
      { shopId: shop.id, kind: "recap_photo", url: "https://blob.example/recap/c.jpg" },
      failing,
    );
    const pending = await listPendingMediaDeletions(db, shop.id, new Date(Date.now() + 1000));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe("failed");
    expect(pending[0]?.lastError).toContain("blob delete failed");
  });
});

describe("listPendingMediaDeletions", () => {
  it("surfaces a pending row that has sat unresolved past the staleness window", async () => {
    const { db, shop } = await seededShopContext();
    await queueMediaDeletion(db, {
      shopId: shop.id,
      kind: "course_photo",
      url: "https://blob.example/courses/stuck.jpg",
    });
    // Not yet old enough to count as stuck — the process could still be mid-attempt.
    expect(await listPendingMediaDeletions(db, shop.id, new Date(0))).toEqual([]);
    const pending = await listPendingMediaDeletions(db, shop.id, new Date(Date.now() + 1000));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe("pending");
  });

  it("does not surface a succeeded deletion", async () => {
    const { db, shop } = await seededShopContext();
    await queueAndAttemptMediaDeletion(
      db,
      { shopId: shop.id, kind: "recap_photo", url: "https://blob.example/recap/d.jpg" },
      ok,
    );
    expect(await listPendingMediaDeletions(db, shop.id, new Date(Date.now() + 1000))).toEqual([]);
  });

  it("scopes to the requesting shop", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-media-deletions-test", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    await queueMediaDeletion(db, {
      shopId: otherShop.id,
      kind: "recap_photo",
      url: "https://blob.example/recap/e.jpg",
    });
    expect(await listPendingMediaDeletions(db, shop.id, new Date(Date.now() + 1000))).toEqual([]);
  });
});

describe("retryMediaDeletion", () => {
  it("retries a failed attempt and resolves it on success", async () => {
    const { db, shop } = await seededShopContext();
    await queueAndAttemptMediaDeletion(
      db,
      { shopId: shop.id, kind: "recap_photo", url: "https://blob.example/recap/f.jpg" },
      failing,
    );
    const [stuck] = await listPendingMediaDeletions(db, shop.id, new Date(Date.now() + 1000));
    if (!stuck) throw new Error("setup: expected a stuck attempt");

    expect(await retryMediaDeletion(db, shop.id, stuck.id, ok)).toBe(true);
    expect(await listPendingMediaDeletions(db, shop.id, new Date(Date.now() + 1000))).toEqual([]);
  });

  it("does not retry another shop's attempt", async () => {
    const { db, shop } = await seededShopContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop 2", slug: "other-shop-media-deletions-test-2", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    const attempt = await queueMediaDeletion(db, {
      shopId: otherShop.id,
      kind: "recap_photo",
      url: "https://blob.example/recap/g.jpg",
    });
    expect(await retryMediaDeletion(db, shop.id, attempt.id, ok)).toBe(false);
  });

  it("returns false for an already-succeeded attempt rather than re-deleting", async () => {
    const { db, shop } = await seededShopContext();
    const attempt = await queueMediaDeletion(db, {
      shopId: shop.id,
      kind: "recap_photo",
      url: "https://blob.example/recap/h.jpg",
    });
    await resolveMediaDeletion(db, attempt.id, { status: "succeeded" });
    let called = false;
    expect(
      await retryMediaDeletion(db, shop.id, attempt.id, async () => {
        called = true;
        return { ok: true };
      }),
    ).toBe(false);
    expect(called).toBe(false);
  });
});

describe("retryPendingMediaDeletions (bounded orphan cleanup)", () => {
  it("retries every stuck attempt across shops, up to the bound", async () => {
    const { db, shop } = await seededShopContext();
    await queueAndAttemptMediaDeletion(
      db,
      { shopId: shop.id, kind: "recap_photo", url: "https://blob.example/recap/i.jpg" },
      failing,
    );
    await queueAndAttemptMediaDeletion(
      db,
      { shopId: shop.id, kind: "course_photo", url: "https://blob.example/courses/j.jpg" },
      failing,
    );
    const result = await retryPendingMediaDeletions(db, 50, new Date(Date.now() + 1000), ok);
    expect(result).toEqual({ attempted: 2, succeeded: 2 });
    expect(await listPendingMediaDeletions(db, shop.id, new Date(Date.now() + 1000))).toEqual([]);
  });

  it("respects the bound instead of retrying an unbounded batch", async () => {
    const { db, shop } = await seededShopContext();
    for (let i = 0; i < 3; i++) {
      await queueAndAttemptMediaDeletion(
        db,
        { shopId: shop.id, kind: "recap_photo", url: `https://blob.example/recap/bound-${i}.jpg` },
        failing,
      );
    }
    const result = await retryPendingMediaDeletions(db, 2, new Date(Date.now() + 1000), ok);
    expect(result.attempted).toBe(2);
    // One attempt was left untouched by the bounded run.
    expect(await listPendingMediaDeletions(db, shop.id, new Date(Date.now() + 1000))).toHaveLength(
      1,
    );
  });

  it("leaves a still-failing attempt failed rather than losing track of it", async () => {
    const { db, shop } = await seededShopContext();
    await queueAndAttemptMediaDeletion(
      db,
      { shopId: shop.id, kind: "recap_photo", url: "https://blob.example/recap/k.jpg" },
      failing,
    );
    const result = await retryPendingMediaDeletions(db, 50, new Date(Date.now() + 1000), failing);
    expect(result).toEqual({ attempted: 1, succeeded: 0 });
    expect(await listPendingMediaDeletions(db, shop.id, new Date(Date.now() + 1000))).toHaveLength(
      1,
    );
  });
});
