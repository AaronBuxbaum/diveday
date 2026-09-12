// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { displayTokens } from "@/db/schema";
import { listStaff } from "@/db/trips";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { CHECK_IN_LINK_TTL_DAYS } from "@/lib/display-tokens";
import { seededShopContext } from "@/test/db";
import {
  issueDisplayToken,
  listDisplayTokens,
  renewDisplayToken,
  revokeDisplayToken,
  touchDisplayToken,
  verifyDisplayToken,
} from "./display-tokens";

const DAY_MS = 24 * 60 * 60 * 1000;

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
      label: "Lobby TV",
      purpose: "board",
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
      label: "Dock B",
      purpose: "board",
      showNames: true,
    });
    expect(byManager.ok).toBe(true);

    const byCrew = await issueDisplayToken(db, {
      shopId: shop.id,
      personId: crew.person.id,
      label: "Dock B",
      purpose: "board",
      showNames: true,
    });
    expect(byCrew).toEqual({ ok: false, reason: "not_authorized" });
  });

  it("refuses a blank label before touching the database", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    expect(
      await issueDisplayToken(db, {
        shopId: shop.id,
        personId,
        label: "   ",
        purpose: "board",
        showNames: false,
      }),
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
      label: "Lobby TV",
      purpose: "board",
      showNames: true,
    });
    if (!outcome.ok) throw new Error(outcome.reason);

    const context = await verifyDisplayToken(db, { token: outcome.issued.token, purpose: "board" });
    expect(context).toEqual({ id: outcome.issued.id, shopId: shop.id, showNames: true });
    expect(Object.keys(context ?? {}).sort()).toEqual(["id", "shopId", "showNames"]);
  });

  it("answers an unknown token with null", async () => {
    const { db } = await staffWithRole("owner");
    expect(
      await verifyDisplayToken(db, { token: "not-a-real-token", purpose: "board" }),
    ).toBeNull();
  });

  /**
   * **A board link is not a kiosk link, and the refusal is the same one an
   * unknown token gets** (N-24).
   *
   * This is the whole reason `purpose` is a column rather than a convention. A
   * shop hands the board's URL to whoever mounts a TV; the kiosk's URL opens a
   * surface that *writes*, recording an arrival against a real booking. If one
   * opened the other, mounting a TV would be granting a write.
   *
   * Matched inside the predicate, so `null` comes back for a live token of the
   * wrong purpose exactly as it does for a token that was never ours — a holder
   * cannot use the difference to learn that their link is real.
   */
  it("refuses a live token minted for the other purpose, in both directions", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const board = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Lobby TV",
      purpose: "board",
      showNames: false,
    });
    const kiosk = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Counter tablet",
      purpose: "check_in",
      showNames: false,
    });
    if (!board.ok || !kiosk.ok) throw new Error("seeding the two links failed");

    expect(
      await verifyDisplayToken(db, { token: board.issued.token, purpose: "check_in" }),
    ).toBeNull();
    expect(
      await verifyDisplayToken(db, { token: kiosk.issued.token, purpose: "board" }),
    ).toBeNull();
    // Both are live; it is only the crossing that is refused.
    expect(
      await verifyDisplayToken(db, { token: board.issued.token, purpose: "board" }),
    ).not.toBeNull();
    expect(
      await verifyDisplayToken(db, { token: kiosk.issued.token, purpose: "check_in" }),
    ).not.toBeNull();
    // And the list reports which is which, so the settings page can say so.
    const listed = await listDisplayTokens(db, { shopId: shop.id });
    expect(listed.map((row) => row.purpose).sort()).toEqual(["board", "check_in"]);
  });
});

describe("revokeDisplayToken", () => {
  it("stops the token verifying, keeps the row, and is idempotent", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const outcome = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Lobby TV",
      purpose: "board",
      showNames: false,
    });
    if (!outcome.ok) throw new Error(outcome.reason);

    expect(await revokeDisplayToken(db, { shopId: shop.id, personId, id: outcome.issued.id })).toBe(
      true,
    );
    expect(
      await verifyDisplayToken(db, { token: outcome.issued.token, purpose: "board" }),
    ).toBeNull();
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
      label: "Lobby TV",
      purpose: "board",
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
    expect(
      await verifyDisplayToken(db, { token: outcome.issued.token, purpose: "board" }),
    ).not.toBeNull();
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
      label: "Lobby TV",
      purpose: "board",
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
    expect(
      await verifyDisplayToken(db, { token: outcome.issued.token, purpose: "board" }),
    ).not.toBeNull();
  });
});

describe("listDisplayTokens and touchDisplayToken", () => {
  it("lists live links newest first, with the last time each screen showed", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const first = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Lobby TV",
      purpose: "board",
      showNames: false,
      now: new Date("2026-07-20T10:00:00.000Z"),
    });
    const second = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Dock B tablet",
      purpose: "board",
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

/**
 * **A kiosk link expires; a board link does not** (issue #1609, security
 * review). The check-in URL lives on a tablet on a counter and it *writes* —
 * it records an arrival against a real booking — so it should not still open
 * that surface years after the tablet was put away. The board only reads, and
 * a screen on a wall going dark is noticed by nobody, so it keeps no expiry at
 * all. The second half of this is the regression that matters: the whole risk
 * of adding the column is that board links quietly acquire a lifetime too.
 */
describe("a check-in link's expiry", () => {
  it("is stamped for a kiosk link and left null for a board link", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const minted = new Date("2026-04-01T09:00:00.000Z");
    const kiosk = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Counter tablet",
      purpose: "check_in",
      showNames: false,
      now: minted,
    });
    const board = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Lobby TV",
      purpose: "board",
      showNames: false,
      now: minted,
    });
    if (!kiosk.ok || !board.ok) throw new Error("issue failed");

    const listed = await listDisplayTokens(db, { shopId: shop.id });
    const kioskRow = listed.find((row) => row.id === kiosk.issued.id);
    const boardRow = listed.find((row) => row.id === board.issued.id);
    expect(kioskRow?.expiresAt).toEqual(
      new Date(minted.getTime() + CHECK_IN_LINK_TTL_DAYS * DAY_MS),
    );
    expect(boardRow?.expiresAt).toBeNull();
  });

  it("stops a kiosk token verifying once it passes, and never touches a board token", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const minted = new Date("2026-04-01T09:00:00.000Z");
    const kiosk = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Counter tablet",
      purpose: "check_in",
      showNames: false,
      now: minted,
    });
    const board = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Lobby TV",
      purpose: "board",
      showNames: false,
      now: minted,
    });
    if (!kiosk.ok || !board.ok) throw new Error("issue failed");

    const justBefore = new Date(minted.getTime() + (CHECK_IN_LINK_TTL_DAYS - 1) * DAY_MS);
    const wellAfter = new Date(minted.getTime() + (CHECK_IN_LINK_TTL_DAYS + 1) * DAY_MS);
    expect(
      await verifyDisplayToken(db, {
        token: kiosk.issued.token,
        purpose: "check_in",
        now: justBefore,
      }),
    ).not.toBeNull();
    expect(
      await verifyDisplayToken(db, {
        token: kiosk.issued.token,
        purpose: "check_in",
        now: wellAfter,
      }),
    ).toBeNull();

    // Ten years on, the TV is still showing the day.
    expect(
      await verifyDisplayToken(db, {
        token: board.issued.token,
        purpose: "board",
        now: new Date(minted.getTime() + 3650 * DAY_MS),
      }),
    ).not.toBeNull();
  });

  /**
   * An expired row stays on the settings page. A manager whose counter tablet
   * stopped working has to be able to find the link and renew it, and a row
   * that vanished on expiry would read as one somebody else revoked.
   */
  it("keeps an expired link on the settings list, where it can be renewed", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const minted = new Date("2026-04-01T09:00:00.000Z");
    const kiosk = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Counter tablet",
      purpose: "check_in",
      showNames: false,
      now: minted,
    });
    if (!kiosk.ok) throw new Error("issue failed");

    expect((await listDisplayTokens(db, { shopId: shop.id })).map((row) => row.id)).toContain(
      kiosk.issued.id,
    );
  });

  /**
   * **A kiosk row with no expiry at all refuses** (security review,
   * 2026-09-12). The column arrived nullable and nothing backfilled it, so
   * every `check_in` link minted before it existed carries null — which the
   * expiry test alone reads as "never expires", i.e. as an unbounded write
   * capability against real bookings. The purpose is therefore part of the
   * liveness test, and only the board is allowed to live forever. The row is
   * written here the way those rows exist: straight into the table, since the
   * writer can no longer produce one.
   */
  it("refuses a kiosk link with no expiry, which renewal brings back", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const token = createBearerToken();
    const [row] = await db
      .insert(displayTokens)
      .values({
        shopId: shop.id,
        tokenHash: hashBearerToken(token),
        label: "Counter tablet",
        purpose: "check_in",
        showNames: false,
        createdByPersonId: personId,
        expiresAt: null,
      })
      .returning({ id: displayTokens.id });
    if (!row) throw new Error("insert failed");

    expect(await verifyDisplayToken(db, { token, purpose: "check_in" })).toBeNull();

    expect(await renewDisplayToken(db, { shopId: shop.id, personId, id: row.id })).toBe(true);
    expect(await verifyDisplayToken(db, { token, purpose: "check_in" })).not.toBeNull();
  });
});

/**
 * **Renewal is a full-lifetime reset on a credential that writes**, so the
 * live owner/manager gate is re-derived at the writer rather than trusted from
 * the page that drew the button — the same reasoning as `revokeDisplayToken`
 * (issue #1609).
 */
describe("renewDisplayToken", () => {
  async function expiredKiosk() {
    const context = await staffWithRole("owner");
    const minted = new Date("2026-04-01T09:00:00.000Z");
    const kiosk = await issueDisplayToken(context.db, {
      shopId: context.shop.id,
      personId: context.personId,
      label: "Counter tablet",
      purpose: "check_in",
      showNames: false,
      now: minted,
    });
    if (!kiosk.ok) throw new Error("issue failed");
    const afterExpiry = new Date(minted.getTime() + (CHECK_IN_LINK_TTL_DAYS + 1) * DAY_MS);
    return { ...context, issued: kiosk.issued, afterExpiry };
  }

  it("brings a dead kiosk link back for another full lifetime", async () => {
    const { db, shop, personId, issued, afterExpiry } = await expiredKiosk();
    expect(
      await verifyDisplayToken(db, { token: issued.token, purpose: "check_in", now: afterExpiry }),
    ).toBeNull();

    expect(
      await renewDisplayToken(db, { shopId: shop.id, personId, id: issued.id, now: afterExpiry }),
    ).toBe(true);

    expect(
      await verifyDisplayToken(db, { token: issued.token, purpose: "check_in", now: afterExpiry }),
    ).not.toBeNull();
    const [row] = await db
      .select({ expiresAt: displayTokens.expiresAt })
      .from(displayTokens)
      .where(eq(displayTokens.id, issued.id));
    // Measured from the renewal, not topped up onto what was left.
    expect(row?.expiresAt).toEqual(
      new Date(afterExpiry.getTime() + CHECK_IN_LINK_TTL_DAYS * DAY_MS),
    );
  });

  it("refuses a crew member, who could otherwise extend a link that records arrivals", async () => {
    const { db, shop, issued, afterExpiry, staff } = await expiredKiosk();
    const crew = staff.find(
      (entry) => !entry.roles.includes("owner") && !entry.roles.includes("manager"),
    );
    if (!crew) throw new Error("seeded shop is missing a crew member");

    expect(
      await renewDisplayToken(db, {
        shopId: shop.id,
        personId: crew.person.id,
        id: issued.id,
        now: afterExpiry,
      }),
    ).toBe(false);
    expect(
      await verifyDisplayToken(db, { token: issued.token, purpose: "check_in", now: afterExpiry }),
    ).toBeNull();
  });

  it("renews nothing for an id that belongs to another shop", async () => {
    const { db, personId, issued, afterExpiry } = await expiredKiosk();
    expect(
      await renewDisplayToken(db, {
        shopId: "00000000-0000-0000-0000-000000000000",
        personId,
        id: issued.id,
        now: afterExpiry,
      }),
    ).toBe(false);
    expect(
      await verifyDisplayToken(db, { token: issued.token, purpose: "check_in", now: afterExpiry }),
    ).toBeNull();
  });

  it("renews nothing for a board link, which has no expiry to move", async () => {
    const { db, shop, personId } = await staffWithRole("owner");
    const board = await issueDisplayToken(db, {
      shopId: shop.id,
      personId,
      label: "Lobby TV",
      purpose: "board",
      showNames: false,
    });
    if (!board.ok) throw new Error("issue failed");

    expect(await renewDisplayToken(db, { shopId: shop.id, personId, id: board.issued.id })).toBe(
      false,
    );
    const [row] = await db
      .select({ expiresAt: displayTokens.expiresAt })
      .from(displayTokens)
      .where(eq(displayTokens.id, board.issued.id));
    expect(row?.expiresAt).toBeNull();
  });

  /**
   * Renewing a revoked link would be un-revoking it through a door that says
   * nothing about revocation.
   */
  it("renews nothing for a revoked link", async () => {
    const { db, shop, personId, issued, afterExpiry } = await expiredKiosk();
    expect(await revokeDisplayToken(db, { shopId: shop.id, personId, id: issued.id })).toBe(true);

    expect(
      await renewDisplayToken(db, { shopId: shop.id, personId, id: issued.id, now: afterExpiry }),
    ).toBe(false);
    expect(
      await verifyDisplayToken(db, { token: issued.token, purpose: "check_in", now: afterExpiry }),
    ).toBeNull();
  });
});
