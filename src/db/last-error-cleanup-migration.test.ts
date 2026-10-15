// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ERASURE_FAILURE_DETAIL } from "@/lib/payments/erasure-failure";
import { fileScopedShopContext } from "@/test/db";
import {
  notificationKind,
  notificationSendQueue,
  people,
  processorErasureObligations,
} from "./schema";

/**
 * The data migration that cleans provider free text out of `last_error` rows
 * written before #2334 (issue #2532). `createTestDb()` has already applied it
 * to an empty database, so the test writes rows in the old shape and runs the
 * migration's own SQL over them.
 */
const ctx = fileScopedShopContext();

const MIGRATIONS = path.join(process.cwd(), "drizzle");
const FOLDER = readdirSync(MIGRATIONS).find((name) =>
  name.endsWith("_clean-provider-text-from-last-error"),
);

async function runCleanup() {
  if (!FOLDER) throw new Error("the clean-provider-text-from-last-error migration is missing");
  const text = readFileSync(path.join(MIGRATIONS, FOLDER, "migration.sql"), "utf8");
  for (const statement of text.split("--> statement-breakpoint")) {
    if (statement.trim()) await ctx.db.execute(sql.raw(statement));
  }
}

async function seedObligations(lastErrors: Array<string | null>) {
  const { db, shop } = ctx;
  const [person] = await db.select({ id: people.id }).from(people).limit(1);
  if (!person) throw new Error("seed person missing");
  const rows = await db
    .insert(processorErasureObligations)
    .values(
      lastErrors.map((lastError, index) => ({
        shopId: shop.id,
        personId: person.id,
        target: "stripe_customer" as const,
        externalId: `cus_cleanup_${index}`,
        stripeAccountId: "acct_test",
        lastError,
      })),
    )
    .returning();
  return rows;
}

describe("the last_error cleanup migration", () => {
  it("keeps what a writer emits today and cuts the rest down to its HTTP status", async () => {
    const kept = [
      "HTTP 404",
      "HTTP 400: resource_missing",
      "HTTP 429: rate_limit",
      ...Object.values(ERASURE_FAILURE_DETAIL),
    ];
    const rows = await seedObligations([
      ...kept,
      // Stripe's own English, which can quote the customer or the input it refused.
      "HTTP 400: No such customer: 'cus_123' for jane@example.com",
      "HTTP 402 Your card was declined for Jane Diver",
      "HTTP 400: Resource_Missing",
      // No status to keep: a thrown message, a stray body.
      "connect ECONNREFUSED 10.0.0.1:443 while deleting jane@example.com",
      null,
    ]);

    await runCleanup();

    const after = new Map(
      (await ctx.db.select().from(processorErasureObligations)).map((row) => [
        row.externalId,
        row.lastError,
      ]),
    );
    const at = (index: number) => after.get(rows[index]?.externalId ?? "");
    kept.forEach((value, index) => {
      expect(at(index)).toBe(value);
    });
    expect(at(kept.length)).toBe("HTTP 400");
    expect(at(kept.length + 1)).toBe("HTTP 402");
    expect(at(kept.length + 2)).toBe("HTTP 400");
    expect(at(kept.length + 3)).toBeNull();
    expect(at(kept.length + 4)).toBeNull();
  });

  it("nulls a queue row's free text where an error code is set, and leaves the rest", async () => {
    const { db, shop } = ctx;
    const kind = notificationKind.enumValues[0];
    const nextAttemptAt = new Date("2026-10-15T12:00:00Z");
    await db.insert(notificationSendQueue).values([
      {
        shopId: shop.id,
        idempotencyKey: "cleanup-coded",
        kind,
        nextAttemptAt,
        errorCode: "provider_rejected",
        lastError: "550 mailbox jane@example.com unavailable",
      },
      {
        shopId: shop.id,
        idempotencyKey: "cleanup-uncoded",
        kind,
        nextAttemptAt,
        errorCode: null,
        lastError: "TypeError",
      },
      {
        shopId: shop.id,
        idempotencyKey: "cleanup-clean",
        kind,
        nextAttemptAt,
        errorCode: "provider_rejected",
        lastError: null,
      },
    ]);

    await runCleanup();

    const lastErrorOf = async (key: string) =>
      (
        await db
          .select({ lastError: notificationSendQueue.lastError })
          .from(notificationSendQueue)
          .where(eq(notificationSendQueue.idempotencyKey, key))
      )[0]?.lastError;
    expect(await lastErrorOf("cleanup-coded")).toBeNull();
    expect(await lastErrorOf("cleanup-uncoded")).toBe("TypeError");
    expect(await lastErrorOf("cleanup-clean")).toBeNull();
  });
});
