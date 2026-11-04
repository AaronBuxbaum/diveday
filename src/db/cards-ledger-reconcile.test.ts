// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { cards, people } from "./schema";

/**
 * **The late copy's reconcile statements** (issue #3732): a card both the old
 * table and the ledger hold may have been reviewed or Deleted in the old table
 * by the release still serving, and the copy's id test alone would leave the
 * ledger stale. The migration runs here against temporary tables of the same
 * names, as `cards-ledger.test.ts` does for the inserts.
 */
const ctx = fileScopedShopContext();
const MIGRATIONS = path.join(process.cwd(), "drizzle");
const COPY_LATE = readdirSync(MIGRATIONS).find((name) => name.endsWith("_copy-late-cards"));
const OLD_TABLES = ["certifications", "specialty_certifications", "nitrox_certifications"];

async function diver(name: string) {
  const [row] = await ctx.db
    .insert(people)
    .values({ shopId: ctx.shop.id, fullName: name, email: `${randomUUID()}@example.com` })
    .returning({ id: people.id });
  if (!row) throw new Error("person insert failed");
  return row.id;
}

async function card(personId: string, identifier: string) {
  const [row] = await ctx.db
    .insert(cards)
    .values({ shopId: ctx.shop.id, personId, kind: "nitrox", agency: "padi", identifier })
    .returning({ id: cards.id });
  if (!row) throw new Error("card insert failed");
  return row.id;
}

async function runMigration() {
  if (!COPY_LATE) throw new Error("the copy-late-cards migration is missing");
  const text = readFileSync(path.join(MIGRATIONS, COPY_LATE, "migration.sql"), "utf8");
  for (const statement of text.split("--> statement-breakpoint")) {
    await ctx.db.execute(sql.raw(statement));
  }
}

describe("the late copy's reconcile of cards both tables hold", () => {
  it("carries a newer review and a Delete over, leaves a newer ledger alone, and re-scrubs an erased diver", async () => {
    const kept = await diver("Reconcile Diver");
    const staff = await diver("Reconcile Staff");
    const erased = await diver("Reconcile Erased");
    const earlier = new Date("2026-11-01T10:00:00Z");
    const later = new Date("2026-11-03T10:00:00Z");

    const reviewed = await card(kept, "REV-1");
    const ledgerNewer = await card(kept, "REV-2");
    const deletedOld = await card(kept, "DEL-1");
    const erasedCard = await card(erased, "ERA-1");
    await ctx.db
      .update(cards)
      .set({ status: "pending", reviewedAt: earlier })
      .where(eq(cards.id, reviewed));
    await ctx.db
      .update(cards)
      .set({ status: "verified", reviewNote: "ledger review", reviewedAt: later })
      .where(eq(cards.id, ledgerNewer));
    // The diver is erased after the ledger row was written, with a note still on it.
    await ctx.db
      .update(cards)
      .set({ reviewNote: "private", importedFromLabel: "Old Shop" })
      .where(eq(cards.id, erasedCard));
    await ctx.db
      .update(people)
      .set({ anonymizedAt: nowDate(), deletedAt: nowDate() })
      .where(eq(people.id, erased));

    for (const table of OLD_TABLES) {
      await ctx.db.execute(
        sql.raw(`create temp table "${table}" as select * from cards with no data`),
      );
      await ctx.db.execute(
        sql.raw(`alter table pg_temp."${table}" alter column created_at set default now()`),
      );
    }
    await ctx.db.execute(sql`
      insert into nitrox_certifications (id, shop_id, person_id, kind, agency, status, identifier,
        review_note, reviewed_at, reviewed_by_person_id, deleted_at, deleted_by_person_id)
      values
        (${reviewed}, ${ctx.shop.id}, ${kept}, 'nitrox', 'padi', 'verified', 'REV-1',
          'seen at desk', ${later}, ${staff}, null, null),
        (${ledgerNewer}, ${ctx.shop.id}, ${kept}, 'nitrox', 'padi', 'pending', 'REV-2',
          'older old-table review', ${earlier}, ${staff}, null, null),
        (${deletedOld}, ${ctx.shop.id}, ${kept}, 'nitrox', 'padi', 'verified', 'DEL-1',
          null, null, null, ${later}, ${staff}),
        (${erasedCard}, ${ctx.shop.id}, ${erased}, 'nitrox', 'padi', 'verified', 'ERA-1',
          'private again', ${later}, ${staff}, null, null)`);

    await runMigration();
    // Run twice: every statement matches only what is still different.
    await runMigration();
    for (const table of OLD_TABLES) {
      await ctx.db.execute(sql.raw(`drop table pg_temp."${table}"`));
    }

    const byId = new Map(
      (await ctx.db.select().from(cards).where(eq(cards.shopId, ctx.shop.id))).map((row) => [
        row.id,
        row,
      ]),
    );
    expect(byId.get(reviewed)).toMatchObject({
      status: "verified",
      reviewNote: "seen at desk",
      reviewedAt: later,
      reviewedByPersonId: staff,
    });
    // The ledger's own newer review stands.
    expect(byId.get(ledgerNewer)).toMatchObject({
      status: "verified",
      reviewNote: "ledger review",
      reviewedAt: later,
    });
    expect(byId.get(deletedOld)).toMatchObject({
      deletedAt: later,
      deletedByPersonId: staff,
      deletionKind: "staff",
    });
    // The erased diver's card is redacted though a newer review tried to copy a note back.
    const scrubbed = byId.get(erasedCard);
    expect(scrubbed?.identifier).toMatch(/^redacted-/);
    expect(scrubbed).toMatchObject({
      reviewNote: null,
      importedFromLabel: null,
      deletionKind: "system",
    });
    expect(scrubbed?.deletedAt).not.toBeNull();
  });
});
