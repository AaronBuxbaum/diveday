import { describe, expect, it } from "vitest";

import { auditMigration, foldersToAudit, gitBaseFolders, maskSql } from "./check-migrations.mjs";

/**
 * The destructive-DDL guard, exercised statement by statement.
 *
 * Two failure modes matter equally and they pull in opposite directions. A
 * guard that misses a `DROP COLUMN` lets a migration break the deployment that
 * is still live while the new one builds — the whole reason this exists. A
 * guard that refuses `ALTER TYPE ... ADD VALUE`, a `CREATE INDEX`, or an
 * `ADD COLUMN` is worse than useless: it teaches its users to reach for the
 * acknowledgement reflexively, and an acknowledgement everybody writes without
 * thinking is not one. So every rule is proven to fire, and every additive
 * statement the runbook calls safe is proven not to.
 */

/** Just the messages, which is what a session reads off the failure. */
const problems = (sql) => auditMigration(sql).map((problem) => problem.message);
const ruleIdsFor = (sql) => problems(sql).map((message) => message.split(":")[0]);

describe("statements the expand/contract rule forbids", () => {
  it("refuses each destructive form", () => {
    const cases = [
      ['DROP TABLE "course_paths";', "drop-table"],
      ['DROP TABLE IF EXISTS "course_paths" CASCADE;', "drop-table"],
      ['DROP SCHEMA "public" CASCADE;', "drop-schema"],
      ['DROP TYPE "public"."trip_status";', "drop-type"],
      ["DROP EXTENSION pg_trgm;", "drop-extension"],
      ['TRUNCATE TABLE "bookings";', "truncate"],
      ['DELETE FROM "bookings";', "delete-without-where"],
      ['ALTER TABLE "people" DROP COLUMN "full_name";', "drop-column"],
      ['ALTER TABLE "people" DROP COLUMN IF EXISTS "full_name";', "drop-column"],
      [
        'ALTER TABLE "course_path_steps" DROP CONSTRAINT "course_path_steps_path_id_fkey";',
        "drop-constraint",
      ],
      ['ALTER TABLE "people" RENAME TO "divers";', "rename-table"],
      ['ALTER TABLE "people" RENAME COLUMN "full_name" TO "display_name";', "rename-column"],
      ['ALTER TABLE "people" RENAME "full_name" TO "display_name";', "rename-column"],
      [
        'ALTER TABLE "orders" ALTER COLUMN "total_cents" SET DATA TYPE bigint;',
        "alter-column-type",
      ],
      ['ALTER TABLE "orders" ALTER COLUMN "total_cents" TYPE bigint;', "alter-column-type"],
      ['ALTER TABLE "people" ALTER COLUMN "email" SET NOT NULL;', "set-not-null"],
      ['ALTER TABLE "orders" ALTER COLUMN "currency" DROP DEFAULT;', "drop-default"],
      ["ALTER TYPE \"public\".\"trip_status\" RENAME VALUE 'draft' TO 'planned';", "rename-type"],
      ['ALTER TYPE "public"."trip_status" RENAME TO "departure_status";', "rename-type"],
    ];
    for (const [sql, expected] of cases) {
      expect(ruleIdsFor(sql), sql).toEqual([expected]);
    }
  });

  it("charges one statement for every rule it breaks", () => {
    // A single ALTER TABLE can carry several actions, and consenting to one is
    // not consenting to the others.
    const sql = 'ALTER TABLE "people" DROP CONSTRAINT "people_email_unique", DROP COLUMN "email";';
    expect(ruleIdsFor(sql).sort()).toEqual(["drop-column", "drop-constraint"]);
  });

  it("names the live-code consequence, not just the keyword", () => {
    expect(problems('ALTER TABLE "people" DROP COLUMN "full_name";')[0]).toContain(
      "the live deployment still selects and writes this column",
    );
  });
});

describe("statements the expand/contract rule calls safe", () => {
  it("accepts every additive form, including the enum value that ships in this PR", () => {
    const safe = [
      // The one this guard must never refuse: adding an enum value is expand.
      'ALTER TYPE "public"."trip_status" ADD VALUE \'blown_out\';',
      "ALTER TYPE \"public\".\"trip_status\" ADD VALUE IF NOT EXISTS 'blown_out' BEFORE 'cancelled';",
      "CREATE TYPE \"public\".\"refund_reason\" AS ENUM('weather', 'no_show');",
      'CREATE TABLE "push_subscriptions" ("id" uuid PRIMARY KEY, "endpoint" text NOT NULL);',
      'ALTER TABLE "course_inquiries" ADD COLUMN "preferred_date" date;',
      'ALTER TABLE "shops" ADD COLUMN "temperature_unit" text DEFAULT \'c\' NOT NULL;',
      'CREATE INDEX "trips_shop_start_idx" ON "trips" USING btree ("shop_id","starts_at");',
      'CREATE INDEX CONCURRENTLY "orders_email_trgm" ON "orders" USING gin ("email" gin_trgm_ops);',
      'CREATE UNIQUE INDEX "shops_slug_unique" ON "shops" USING btree ("slug");',
      // Dropping an index cannot break the previously-live code, only its
      // latency — a deliberate non-rule, asserted so nobody "fixes" it in.
      'DROP INDEX "trips_shop_start_idx";',
      // Expand-shaped constraint work.
      'ALTER TABLE "orders" ADD CONSTRAINT "orders_total_nonnegative" CHECK ("total_cents" >= 0) NOT VALID;',
      'ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_total_nonnegative";',
      'ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE cascade;',
      // Loosening, not tightening.
      'ALTER TABLE "people" ALTER COLUMN "email" DROP NOT NULL;',
      'ALTER TABLE "orders" ALTER COLUMN "currency" SET DEFAULT \'usd\';',
      // A bounded backfill.
      'UPDATE "people" SET "display_name" = "full_name" WHERE "display_name" IS NULL;',
      "CREATE EXTENSION IF NOT EXISTS pg_trgm;",
    ];
    for (const sql of safe) {
      expect(problems(sql), sql).toEqual([]);
    }
  });

  it("reads a whole drizzle-shaped migration without a false positive", () => {
    const sql = [
      "-- Adds the blown-out departure state. Nothing is dropped here; the old",
      "-- statuses keep their meaning and the live deployment never sees the new",
      "-- value until the build that introduces it goes green.",
      'ALTER TYPE "public"."trip_status" ADD VALUE \'blown_out\';--> statement-breakpoint',
      'ALTER TABLE "trips" ADD COLUMN "blown_out_at" timestamp with time zone;--> statement-breakpoint',
      'CREATE INDEX "trips_blown_out_idx" ON "trips" USING btree ("blown_out_at");',
    ].join("\n");
    expect(problems(sql)).toEqual([]);
  });
});

describe("masking", () => {
  it("never reads a keyword out of a comment", () => {
    expect(problems("-- This migration does not DROP TABLE anything.\nSELECT 1;")).toEqual([]);
    expect(problems("/* we considered DROP COLUMN here; we did not */ SELECT 1;")).toEqual([]);
    // Nesting block comments, which Postgres supports and a naive scan does not.
    expect(problems("/* outer /* TRUNCATE bookings */ still comment */ SELECT 1;")).toEqual([]);
  });

  it("never reads a keyword out of a string literal", () => {
    expect(
      problems(`INSERT INTO "audit" ("note") VALUES ('DROP TABLE bookings was rejected');`),
    ).toEqual([]);
    // Doubled quotes are an escaped quote, not the end of the literal.
    expect(problems(`SELECT 'it''s fine to DROP TABLE in prose';`)).toEqual([]);
  });

  it("still sees DDL inside a DO block, wherever in the body it sits", () => {
    // `drizzle/` really does contain `DO $$ ... $$` blocks (the CR-017 preflight
    // migration). A dollar-quoted body is treated as code, not as a literal, so
    // DDL cannot hide in one — including as the block's very first statement,
    // which is what an anchored rule would have missed.
    const afterANotice = [
      "DO $$",
      "BEGIN",
      "  RAISE NOTICE 'about to adjust people';",
      '  ALTER TABLE "people" DROP COLUMN "full_name";',
      "END $$;",
    ].join("\n");
    expect(ruleIdsFor(afterANotice)).toEqual(["drop-column"]);

    const first = ['DO $$ BEGIN ALTER TABLE "people" DROP COLUMN "full_name"; END $$;'].join("\n");
    expect(ruleIdsFor(first)).toEqual(["drop-column"]);
  });

  it("quotes the statement, not the paragraph of comment above it", () => {
    // The excerpt and the acknowledgement's target both read the statement's
    // own code. Letting a leading comment count as part of the statement is how
    // a marker ends up excusing itself.
    const sql = [
      "-- Housekeeping ahead of the nickname cleanup.",
      'ALTER TABLE "people" DROP COLUMN "full_name";',
    ].join("\n");
    expect(problems(sql)[0]).toContain('ALTER TABLE "people" DROP COLUMN "full_name"');
    expect(problems(sql)[0]).not.toContain("Housekeeping");
  });

  it("cannot be spoofed by an identifier that looks like a keyword", () => {
    expect(problems('ALTER TABLE "drop table" ADD COLUMN "truncate" text;')).toEqual([]);
  });

  it("preserves length and line breaks so reported lines are the real ones", () => {
    const sql = 'SELECT 1;\n-- comment\nDROP TABLE "x";\n';
    const { masked } = maskSql(sql);
    expect(masked).toHaveLength(sql.length);
    expect(masked.split("\n")).toHaveLength(sql.split("\n").length);
    expect(auditMigration(sql)[0].line).toBe(3);
  });
});

describe("the acknowledgement", () => {
  const drop = 'ALTER TABLE "people" DROP COLUMN "full_name";';
  const reason = "release 4 of the rename; nothing has read it since #391";

  it("excuses the statement it names", () => {
    const sql = `-- diveday:allow-destructive drop-column people.full_name: ${reason}\n${drop}`;
    expect(problems(sql)).toEqual([]);
  });

  it("does not excuse a different column, table, or rule", () => {
    const other = `-- diveday:allow-destructive drop-column people.nickname: ${reason}\n${drop}`;
    expect(ruleIdsFor(other)).toContain("drop-column");

    const wrongTable = `-- diveday:allow-destructive drop-column crew.full_name: ${reason}\n${drop}`;
    expect(ruleIdsFor(wrongTable)).toContain("drop-column");

    const wrongRule = `-- diveday:allow-destructive drop-table people.full_name: ${reason}\n${drop}`;
    expect(ruleIdsFor(wrongRule)).toContain("drop-column");
  });

  it("cannot blanket a file: two drops need two markers", () => {
    const sql = [
      `-- diveday:allow-destructive drop-column people.full_name: ${reason}`,
      drop,
      'ALTER TABLE "people" DROP COLUMN "nickname";',
    ].join("\n");
    expect(problems(sql)).toHaveLength(1);
    expect(problems(sql)[0]).toContain("nickname");
  });

  it("is not trippable by prose that merely mentions it", () => {
    const prose = [
      "-- We considered writing a diveday:allow-destructive marker for this and",
      "-- decided the column has to go through the four-release rename instead.",
      "-- diveday allow destructive drop-column people.full_name: not the sentinel",
      drop,
    ].join("\n");
    expect(ruleIdsFor(prose)).toEqual(["drop-column"]);
  });

  it("is not trippable from inside a string literal", () => {
    const sql = [
      `INSERT INTO "audit" ("note") VALUES ('`,
      `-- diveday:allow-destructive drop-column people.full_name: ${reason}`,
      `');`,
      drop,
    ].join("\n");
    expect(ruleIdsFor(sql)).toContain("drop-column");
  });

  it("refuses a shrug in place of a reason", () => {
    const sql = `-- diveday:allow-destructive drop-column people.full_name: safe\n${drop}`;
    expect(problems(sql).some((message) => message.includes("at least 20 characters"))).toBe(true);
  });

  it("reports a typo'd marker instead of silently ignoring it", () => {
    // A malformed marker that did nothing would read, to its author, exactly
    // like one that worked — which is how a hole gets shipped believing it was
    // plugged.
    const sql = `-- diveday:allow-destructive drop-column people.full_name ${reason}\n${drop}`;
    expect(problems(sql).some((message) => message.includes("malformed"))).toBe(true);
  });

  it("refuses a rule id it does not know", () => {
    const sql = `-- diveday:allow-destructive drop-everything people.full_name: ${reason}\n${drop}`;
    expect(problems(sql).some((message) => message.includes("unknown rule"))).toBe(true);
  });

  it("refuses a marker that excuses nothing", () => {
    const sql = `-- diveday:allow-destructive drop-column people.full_name: ${reason}\nSELECT 1;`;
    expect(problems(sql).some((message) => message.includes("excuses no statement"))).toBe(true);
  });
});

describe("which migrations get audited", () => {
  const watermark = "20260805033500_pre-guard";

  it("audits what the previous release did not carry", () => {
    const onDisk = ["20260805033500_pre-guard", "20260806010101_new", "20260806020202_newer"];
    expect(
      foldersToAudit(onDisk, {
        gitBaseFolders: ["20260805033500_pre-guard", "20260806010101_new"],
        watermark,
      }),
    ).toEqual(["20260806020202_newer"]);
  });

  it("falls back to the watermark when git answers nothing, and audits more rather than less", () => {
    // CI's repo-safeguards job checks out at depth 1 and the Vercel build
    // container is shallow too. A hard failure there would make the guard the
    // thing people turn off; auditing every post-watermark migration instead
    // costs nothing, because each destructive one carries its own marker.
    const onDisk = ["20260805033500_pre-guard", "20260806010101_new", "20260806020202_newer"];
    expect(foldersToAudit(onDisk, { gitBaseFolders: null, watermark })).toEqual([
      "20260806010101_new",
      "20260806020202_newer",
    ]);
  });

  it("never audits a migration that predates the guard", () => {
    expect(foldersToAudit(["20260101000000_ancient"], { gitBaseFolders: null, watermark })).toEqual(
      [],
    );
  });

  it("reports rather than throws when there is no history to read", () => {
    // The stub answers nothing, which is what a shallow clone looks like.
    expect(gitBaseFolders(() => ({ ok: false, out: "fatal: stub miss" }))).toEqual({
      folders: null,
      how: "no reachable git history",
    });
  });

  it("reads the previous release's folders through previous-release-migrations.mjs", () => {
    const head = "a".repeat(40);
    const fork = "b".repeat(40);
    const run = (args) =>
      ({
        "rev-parse HEAD": { ok: true, out: `${head}\n` },
        "merge-base origin/main HEAD": { ok: true, out: `${fork}\n` },
        [`ls-tree -r --name-only ${fork} -- drizzle`]: {
          ok: true,
          out: "drizzle/20260805033500_pre-guard/migration.sql\ndrizzle/20260805033500_pre-guard/snapshot.json\n",
        },
      })[args.join(" ")] ?? { ok: false, out: "fatal: stub miss" };
    expect(gitBaseFolders(run)).toEqual({
      folders: ["20260805033500_pre-guard"],
      how: "merge-base origin/main HEAD",
    });
  });
});
