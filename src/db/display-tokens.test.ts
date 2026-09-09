// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { displayTokens } from "@/db/schema";
import { listStaff } from "@/db/trips";
import { seededShopContext } from "@/test/db";
import {
  issueDisplayToken,
  listDisplayTokens,
  revokeDisplayToken,
  touchDisplayToken,
  verifyDisplayToken,
} from "./display-tokens";

async function staffWithRole(role: string) {
  const { db, shop } = await seededShopContext();
  const staff = await listStaff(db, shop.id);
  const member = staff.find((entry) => entry.roles.includes(role));
  if (!member) throw new Error(`seeded shop has no ${role}`);
  return { db, shop, personId: member.person.id, staff };
}

describe("issueDisplayToken", () => {
  it("mints a token whose hash, not the token, is what gets stored", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const outcome = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Lobby TV", purpose: "board",
      showNames: false,
    });
    if (!outcome.ok) throw new Error(outcome.reason);

    const [row] = await db
      .select({ tokenHash: displayTokens.tokenHash, label: displayTokens.label })
      .from(displayTokens)
      .where(eq(displayTokens.id, outcome.issued.id));
    expect(row?.tokenHash).not.toBe(outcome.issued.token);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.label).toBe("Lobby TV");
    expect(outcome.issued.token.length).toBeGreaterThanOrEqual(43);
  });

  it("lets a manager mint one and refuses every other role", async () => {
    const { db, shop, staff } = await staffWithRole("manager");
    const manager = staff.find((entry) => entry.roles.includes("manager"));
    const crew = staff.find(
      (entry) => !entry.roles.includes("owner") && !entry.roles.includes("manager"),
    );
    if (!manager || !crew) throw new Error("seeded shop is missing a manager or a crew member");

    const byManager = await issueDisplayToken(db, {
      shopId: shop.id,
      personId: manager.person.id,
      label: "Dock B", purpose: "board",
      showNames: true,
    });
    expect(byManager.ok).toBe(true);

    const byCrew = await issueDisplayToken(db, {
      shopId: shop.id,
      personId: crew.person.id,
      label: "Dock B", purpose: "board",
      showNames: true,
    });
    expect(byCrew).toEqual({ ok: false, reason: "not_authorized" });
  });

  it("refuses a blank label before touching the database", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    expect(
      await issueDisplayToken(db, { shopId: shop.id, personId, label: "   ", purpose: "board", showNames: false }),
    ).toEqual({ ok: false, reason: "invalid_label" });
    expect(await listDisplayTokens(db, { shopId: shop.id })).toEqual([]);
  });
});

describe("verifyDisplayToken", () => {
  it("resolves a live token to its shop and the names switch, and nothing else", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const outcome = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Lobby TV", purpose: "board",
      showNames: true,
    });
    if (!outcome.ok) throw new Error(outcome.reason);

    const context = await verifyDisplayToken(db, { token: outcome.issued.token , purpose: "board" });
    expect(context).toEqual({ id: outcome.issued.id, shopId: shop.id, showNames: true });
    expect(Object.keys(context ?? {}).sort()).toEqual(["id", "shopId", "showNames"]);
  });

  it("answers an unknown token with null", async () => {
    const { db } = await staffWithRole("owner");
    expect(await verifyDisplayToken(db, { token: "not-a-real-token" , purpose: "board" })).toBeNull();
  });
});

describe("revokeDisplayToken", () => {
  it("stops the token verifying, keeps the row, and is idempotent", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const outcome = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Lobby TV", purpose: "board",
      showNames: false,
    });
    if (!outcome.ok) throw new Error(outcome.reason);

    expect(await revokeDisplayToken(db, { shopId: shop.id, personId, id: outcome.issued.id })).toBe(
      true,
    );
    expect(await verifyDisplayToken(db, { token: outcome.issued.token , purpose: "board" })).toBeNull();
    expect(await listDisplayTokens(db, { shopId: shop.id })).toEqual([]);
    // Soft: the row is still there, stamped.
    const [row] = await db
      .select({ revokedAt: displayTokens.revokedAt })
      .from(displayTokens)
      .where(eq(displayTokens.id, outcome.issued.id));
    expect(row?.revokedAt).toBeInstanceOf(Date);
    expect(await revokeDisplayToken(db, { shopId: shop.id, personId, id: outcome.issued.id })).toBe(
      false,
    );
  });

  it("revokes nothing for an id that belongs to another shop", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const outcome = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Lobby TV", purpose: "board",
      showNames: false,
    });
    if (!outcome.ok) throw new Error(outcome.reason);

    expect(
      await revokeDisplayToken(db, {
        shopId: "00000000-0000-0000-0000-000000000000",
        personId,
        id: outcome.issued.id,
      }),
    ).toBe(false);
    expect(await verifyDisplayToken(db, { token: outcome.issued.token , purpose: "board" })).not.toBeNull();
  });

  it("refuses a crew member, who could otherwise darken the lobby screen", async () => {
    const { db, shop, personId, staff } = await staffWithRole("owner");
    const crew = staff.find(
      (entry) => !entry.roles.includes("owner") && !entry.roles.includes("manager"),
    );
    if (!crew) throw new Error("seeded shop is missing a crew member");
    const outcome = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Lobby TV", purpose: "board",
      showNames: false,
    });
    if (!outcome.ok) throw new Error(outcome.reason);

    // A server action is a POST endpoint whether or not the settings page ever
    // rendered the button, so the gate is re-derived at the writer.
    expect(
      await revokeDisplayToken(db, {
        shopId: shop.id,
        personId: crew.person.id,
        id: outcome.issued.id,
      }),
    ).toBe(false);
    expect(await verifyDisplayToken(db, { token: outcome.issued.token , purpose: "board" })).not.toBeNull();
  });
});

describe("listDisplayTokens and touchDisplayToken", () => {
  it("lists live links newest first, with the last time each screen showed", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const first = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Lobby TV", purpose: "board",
      showNames: false,
      now: new Date("2026-07-20T10:00:00.000Z"),
    });
    const second = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Dock B tablet", purpose: "board",
      showNames: true,
      now: new Date("2026-07-21T10:00:00.000Z"),
    });
    if (!first.ok || !second.ok) throw new Error("issue failed");

    const shownAt = new Date("2026-07-21T12:00:00.000Z");
    await touchDisplayToken(db, { id: second.issued.id, now: shownAt });

    const listed = await listDisplayTokens(db, { shopId: shop.id });
    expect(listed.map((row) => row.label)).toEqual(["Dock B tablet", "Lobby TV"]);
    expect(listed[0]?.lastShownAt).toEqual(shownAt);
    expect(listed[0]?.showNames).toBe(true);
    expect(listed[1]?.lastShownAt).toBeNull();
  });
});
