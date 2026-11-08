import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { ACCOUNT_TOKEN_RETENTION_DAYS, RETENTION_DAYS } from "../features/retention/rules";
import { pruneExpiredRecords } from "../features/retention/store";
import * as schema from "./schema";
import { userAccounts } from "./schema";

/**
 * The account tokens' window inside the `capabilities` arm (ADR
 * 20261105-capabilities-shop-id-nullable): measured from each token's own
 * expiry, so a live one is never eligible however old its row.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-03T00:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

const ctx = fileScopedShopContext();

describe("pruneExpiredRecords: account tokens", () => {
  // The account tokens are measured from a column that is not "when it
  // happened". A live credential is never eligible at any age; the window runs
  // from expiry.
  it("prunes only long-expired account tokens, never a live one", async () => {
    const { db } = ctx;
    const [owner] = await db.select().from(userAccounts).limit(1);
    if (!owner) throw new Error("seeded user account missing");
    const window = ACCOUNT_TOKEN_RETENTION_DAYS;
    await db.insert(schema.capabilities).values([
      {
        userAccountId: owner.id,
        purpose: "password_reset",
        tokenHash: "hash-long-dead",
        issuedAt: daysAgo(window + 2),
        expiresAt: daysAgo(window + 1),
        // Revoked by a newer mint: still ages out on its own expiry.
        revokedAt: daysAgo(window + 1),
      },
      {
        userAccountId: owner.id,
        purpose: "invite",
        tokenHash: "hash-recently-dead",
        issuedAt: daysAgo(window),
        expiresAt: daysAgo(window - 1),
      },
      {
        // Issued years ago is impossible, but "very old row, still live" is
        // the shape that must survive: eligibility is expiry, not age.
        userAccountId: owner.id,
        purpose: "email_verification",
        tokenHash: "hash-still-live",
        issuedAt: daysAgo(RETENTION_DAYS.capabilities * 3),
        expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
      },
    ]);

    await pruneExpiredRecords(db, { now: NOW });
    const remaining = await db
      .select({ tokenHash: schema.capabilities.tokenHash })
      .from(schema.capabilities)
      .where(
        inArray(schema.capabilities.purpose, ["password_reset", "invite", "email_verification"]),
      );
    expect(remaining.map((row) => row.tokenHash).sort()).toEqual([
      "hash-recently-dead",
      "hash-still-live",
    ]);
  });
});
