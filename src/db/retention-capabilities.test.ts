import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { RETENTION_DAYS } from "../features/retention/rules";
import { pruneExpiredRecords } from "../features/retention/store";
import { findOrCreatePerson } from "./people";
import { capabilities } from "./schema";

/**
 * Issue #3721: a stop link mailed to a shop's own address (the shore
 * contact's) holds that address, so it keeps the shore table's year; the
 * Monday email's link ages out with the send claims (`weekly_digest_sends`);
 * a courtesy-email link never ages out, it goes with its person.
 */
const ctx = fileScopedShopContext();
const NOW = new Date("2026-08-03T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("the capabilities retention arm", () => {
  it("prunes old stop links on the year and digest links on the claims' window, never a courtesy link", async () => {
    const { db, shop } = ctx;
    const { person } = await findOrCreatePerson(db, {
      shopId: shop.id,
      fullName: "Nora Quinn",
      email: "nora-retention-capability@example.com",
      origin: "counter",
    });
    const old = new Date(NOW.getTime() - (RETENTION_DAYS.capabilities + 1) * DAY_MS);
    const recent = new Date(NOW.getTime() - (RETENTION_DAYS.capabilities - 1) * DAY_MS);
    const rows = await db
      .insert(capabilities)
      .values([
        {
          shopId: shop.id,
          purpose: "shore_alert_stop",
          sentTo: "old-shore@example.com",
          tokenHash: "retention-capability-old-stop",
          issuedAt: old,
        },
        {
          shopId: shop.id,
          purpose: "shore_alert_stop",
          sentTo: "recent-shore@example.com",
          tokenHash: "retention-capability-recent-stop",
          issuedAt: recent,
        },
        {
          shopId: shop.id,
          purpose: "weekly_digest_unsubscribe",
          personId: person.id,
          tokenHash: "retention-capability-digest-past-claims",
          issuedAt: new Date(NOW.getTime() - (RETENTION_DAYS.weekly_digest_sends + 1) * DAY_MS),
        },
        {
          shopId: shop.id,
          purpose: "weekly_digest_unsubscribe",
          personId: person.id,
          tokenHash: "retention-capability-digest-inside-claims",
          issuedAt: old,
        },
        {
          shopId: shop.id,
          purpose: "courtesy_email_unsubscribe",
          personId: person.id,
          tokenHash: "retention-capability-old-unsubscribe",
          issuedAt: old,
        },
      ])
      .returning({ id: capabilities.id, tokenHash: capabilities.tokenHash });

    await pruneExpiredRecords(db, { now: NOW });

    const remaining = await db
      .select({ tokenHash: capabilities.tokenHash })
      .from(capabilities)
      .where(
        inArray(
          capabilities.id,
          rows.map((row) => row.id),
        ),
      );
    expect(remaining.map((row) => row.tokenHash).sort()).toEqual([
      // Older than a shop-address window, inside the send claims' (review D1).
      "retention-capability-digest-inside-claims",
      "retention-capability-old-unsubscribe",
      "retention-capability-recent-stop",
    ]);
  });
});
