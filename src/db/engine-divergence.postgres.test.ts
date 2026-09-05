import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { AppDb, DbExecutor } from "@/db/client";
import { unseededTestDb } from "@/test/db";
import { describePostgres, postgresTestDb } from "@/test/postgres";

/**
 * **Where the database the suite runs on stops behaving like the database
 * production runs on** — written down, and held to it from both sides.
 *
 * 559 of this repository's ~565 test files run against PGlite. Six subjects run
 * against a real server (`*.postgres.test.ts`), and `src/test/postgres.ts`
 * explains what that job exists to prove: the `FOR UPDATE` guards and the
 * committed migrations. What nothing stated until this file is the *residual*
 * — for everything else, "it passed" means "it passed on an engine that is not
 * the one shipping", and nobody could say by how much.
 *
 * That is not an argument for distrusting PGlite. It is an argument for the
 * difference being a **maintained list** rather than an unexamined assumption,
 * which is the same reasoning `src/db/diver-merge.test.ts` applies to
 * `person_id` columns: enumerate them, classify each, and fail on one nobody
 * has classified.
 *
 * ## How a row fails
 *
 * Deliberately in **both directions**. A row marked `agree` fails when the
 * engines start disagreeing — the ordinary regression. A row marked `differ`
 * fails when they start *agreeing*, which is not a regression at all: it means
 * a PGlite release or a server upgrade closed a gap, and the news is worth
 * having, because gaps closing is how a `.postgres.test.ts` earns the right to
 * come home to the fast suite. Neither direction is a failure to paper over;
 * both are "come and update this list".
 *
 * ## Where it runs
 *
 * Both halves. {@link EXPECTED_ON_PGLITE} runs in every ordinary `pnpm test`,
 * so a PGlite upgrade that moves an answer is caught on the shard that upgrade
 * lands in. The comparison against a real server needs one, so it rides the
 * `real-postgres` CI job with its siblings — the job globs
 * `src/db/*.postgres.test.ts`, which is why this file is named as it is.
 *
 * ## What is deliberately *not* here
 *
 * The headline difference is not a query answer and cannot be probed by one:
 * **PGlite is a single connection**, so two transactions can never contend, and
 * every lock-ordering and oversell guard is structurally unexercisable there.
 * That is what the six real-Postgres suites exist for, and `src/test/postgres.ts`
 * is where it is written down.
 */

/** One question asked of both engines, and what each is expected to answer. */
type Probe = {
  id: string;
  /** What the probe asks, in words. */
  asks: string;
  /** Why this repository cares — a row nobody depends on does not belong here. */
  matters: string;
  /** Must return a single column aliased `v`, rendered as text. */
  query: ReturnType<typeof sql>;
  /** The answer measured on PGlite. */
  pglite: string;
  /** Whether the real server is expected to answer the same. */
  verdict: "agree" | "differ";
};

const PROBES: readonly Probe[] = [
  {
    id: "transaction_isolation",
    asks: "which isolation level a transaction actually gets",
    matters:
      "every `FOR UPDATE` guard in `src/db/bookings.ts` is designed against read committed. " +
      "If either engine silently granted something else, the oversell race tests would be " +
      "proving a different theorem than the one production runs.",
    query: sql`select current_setting('transaction_isolation') as v`,
    pglite: "read committed",
    verdict: "agree",
  },
  {
    id: "now_frozen_in_transaction",
    asks: "whether now() is frozen for the life of a transaction",
    matters:
      "`dbNow()` and `fileScopedShopContext` (src/test/db.ts) both rest on this: the second " +
      "rolls every test back inside one transaction, and a `now()` that ticked would make " +
      "`defaultNow()` columns written in one test disagree with reads in the same test.",
    query: sql`select (now() = now())::text as v`,
    pglite: "true",
    verdict: "agree",
  },
  {
    id: "numeric_round_half",
    asks: "which way numeric rounding breaks a tie",
    matters:
      "money. Stripe owns the arithmetic, but reporting sums and the monthly report round " +
      "in the database, and half-up versus half-even differ by a cent on exactly the values " +
      "a price list is full of.",
    query: sql`select round(2.5)::text || '/' || round(3.5)::text || '/' || round(-2.5)::text as v`,
    pglite: "3/4/-3",
    verdict: "agree",
  },
  {
    id: "nulls_order_default",
    asks: "where NULLs sort in a default ascending order",
    matters:
      "every paged staff list orders by a column that can be null, and `offsetPage` pages " +
      "over that order. A flip would silently reshuffle which rows land on page one.",
    query: sql`select string_agg(coalesce(x::text, 'N'), ',' order by x) as v from (values (2), (null), (1)) t(x)`,
    pglite: "1,2,N",
    verdict: "agree",
  },
  {
    id: "timestamp_precision",
    asks: "how many fractional-second digits a timestamp keeps",
    matters:
      "the append-only trails order by their timestamps, and ties are broken by a second " +
      "column precisely because they happen. Coarser precision on one engine would make " +
      "ties more common there than in production — a test passing for the wrong reason.",
    query: sql`select length(split_part('2026-01-01 00:00:00.123456'::timestamp::text, '.', 2))::text as v`,
    pglite: "6",
    verdict: "agree",
  },
  {
    id: "advisory_lock",
    asks: "whether transaction-scoped advisory locks work",
    matters:
      "`seedProductionDb` serializes concurrent cold starts with `pg_advisory_xact_lock`. " +
      "It is skipped on PGlite for a different reason (each opener has its own database), " +
      "but the call still has to exist.",
    query: sql`select pg_try_advisory_lock(42)::text as v`,
    pglite: "true",
    verdict: "agree",
  },
  {
    id: "trigram_similarity",
    asks: "what pg_trgm scores a near-miss name at",
    matters:
      "the diver search is trigram-backed (`src/db/search-indexes.ts`). A different score " +
      "means a different cut-off, so a staffer typing a misspelt name finds a different set " +
      "in production than the tests say they will.",
    query: sql`select similarity('adaeze', 'adeaze')::text as v`,
    pglite: "0.27272728",
    verdict: "agree",
  },
  {
    id: "ilike_does_not_fold_accents",
    asks: "whether ILIKE treats 'Angel' and 'ángel' as the same word",
    matters:
      "it does not, on either engine, and that is a product fact rather than a curiosity: a " +
      "shop with Spanish-speaking divers searching `angel` will not find `Ángel`. Pinned " +
      "here so the day someone adds `unaccent` it is a decision, not a surprise.",
    query: sql`select ('Angel' ilike 'ángel')::text as v`,
    pglite: "false",
    verdict: "agree",
  },
  {
    id: "dst_gap_resolution",
    asks: "what a wall-clock time that does not exist resolves to",
    matters:
      "02:30 on 2026-03-08 never happens in America/New_York. `src/lib/zoned-hostile.test.ts` " +
      "pins the application's answer; this pins the database's, because a shop day boundary " +
      "computed in SQL has to land in the same place as one computed in TypeScript.",
    query: sql`select ('2026-03-08 02:30:00'::timestamp at time zone 'America/New_York')::text as v`,
    pglite: "2026-03-08 07:30:00+00",
    verdict: "agree",
  },
  {
    id: "session_timezone_is_utc",
    asks: "whether the session's zone is UTC",
    matters:
      "AGENTS.md's timezone rule rests on the claim that every DiveDay server and CI box is " +
      "UTC — which is why omitting a `timeZone` renders a 07:30 departure as 11:30. The " +
      "claim was asserted in prose and tested nowhere. Note this compares the *offset*, not " +
      "the zone's name: PGlite says `Etc/GMT0` and a real server `Etc/UTC`, which are the " +
      "same instant under two spellings.",
    query: sql`select (now() at time zone 'UTC' = now() at time zone current_setting('TimeZone'))::text as v`,
    pglite: "true",
    verdict: "agree",
  },
  {
    id: "major_version",
    asks: "which major version of Postgres this actually is",
    matters:
      "**the ledger's headline.** PGlite tracks Postgres far ahead of what this app deploys " +
      "on, so the fast suite runs on a *newer major* than production — every planner change, " +
      "every behavioural fix and every deprecation between the two is untested in one " +
      "direction and unavailable in the other. Nothing else in the tree said so.",
    query: sql`select split_part(current_setting('server_version'), '.', 1) as v`,
    pglite: "18",
    verdict: "differ",
  },
];

async function ask(db: DbExecutor, probe: Probe): Promise<string> {
  const result = await db.execute(probe.query);
  const rows = (Array.isArray(result) ? result : (result.rows ?? [])) as { v: unknown }[];
  const value = rows[0]?.v;
  if (value === undefined || value === null) {
    throw new Error(`probe "${probe.id}" returned no value`);
  }
  return String(value);
}

/**
 * The PGlite half, which runs everywhere. A failure here means a PGlite
 * upgrade moved an answer — read the probe's `matters` before re-banking the
 * expectation, because that field is the whole argument for the row existing.
 */
describe("what PGlite answers", () => {
  it.each(PROBES.map((probe) => [probe.id, probe] as const))("%s", async (_id, probe) => {
    const db = await unseededTestDb();
    expect(await ask(db, probe), probe.matters).toBe(probe.pglite);
  });

  /**
   * Kept out of the table because its consequence, not its value, is the
   * finding — and because the *server's* side of it is chosen at `initdb` time
   * by whoever provisioned the database, so there is no one right answer to
   * pin. PGlite is always `C`: byte ordering.
   *
   * What that costs: a name list ordered by the database default sorts `Ángel`
   * and `Ñuria` after `Zoe` here, and a server initialised with a UTF-8
   * language locale sorts them where a Spanish reader expects. This app ships
   * Spanish (`src/i18n/locales/es-ES`) and pages staff lists by name, so the
   * order a test proves is not the order a shop sees — unless the query names
   * a collation, which none of them do today.
   */
  it("orders text by bytes, which is not how any reader reads a name", async () => {
    const db = await unseededTestDb();
    const collation = await ask(db, {
      ...PROBES[0],
      query: sql`select datcollate as v from pg_database where datname = current_database()`,
    });
    expect(collation).toBe("C");

    expect(await orderedNames(db, sql`x`)).toBe("Ana|Bea|Zoe|Ángel|Ñuria");
    expect(await orderedNames(db, sql`x collate "und-x-icu"`)).toBe("Ana|Ángel|Bea|Ñuria|Zoe");
  });
});

/** The five names, ordered by whatever expression the caller hands in. */
async function orderedNames(db: DbExecutor, by: ReturnType<typeof sql>): Promise<string> {
  const result = await db.execute(
    sql`select string_agg(x, '|' order by ${by}) as v from (values ('Zoe'), ('Ángel'), ('Ana'), ('Ñuria'), ('Bea')) t(x)`,
  );
  const rows = (Array.isArray(result) ? result : (result.rows ?? [])) as { v: string }[];
  return rows[0]?.v ?? "";
}

/**
 * The half that needs a server, and the half that makes this a ledger rather
 * than a second copy of the PGlite expectations.
 */
describePostgres("and where a real server answers differently", () => {
  it.each(PROBES.map((probe) => [probe.id, probe] as const))("%s", async (_id, probe) => {
    const { db } = await postgresTestDb();
    const answer = await ask(db as AppDb, probe);

    if (probe.verdict === "agree") {
      expect(
        answer,
        `${probe.id}: the engines have started disagreeing about ${probe.asks}. ${probe.matters}`,
      ).toBe(probe.pglite);
      return;
    }

    expect(
      answer,
      `${probe.id}: the engines now agree about ${probe.asks}, which this ledger records as a ` +
        `difference. That is good news and a stale row — update the verdict, and check whether ` +
        `a suite pinned to a real server can come back to the fast one.`,
    ).not.toBe(probe.pglite);
  });

  /**
   * The server's collation is deployment-chosen, so there is nothing portable
   * to assert about *which* one it is. What is portable, and what the risk
   * actually rests on, is that the two orderings are genuinely different — so
   * a query that names no collation is answering a question about the
   * deployment rather than about the data.
   */
  it("can order the same names two different ways, so the default is a deployment choice", async () => {
    const { db } = await postgresTestDb();
    const byBytes = await orderedNames(db, sql`x collate "C"`);
    const byLanguage = await orderedNames(db, sql`x collate "und-x-icu"`);
    expect(byBytes).toBe("Ana|Bea|Zoe|Ángel|Ñuria");
    expect(byLanguage).toBe("Ana|Ángel|Bea|Ñuria|Zoe");
    expect(byBytes).not.toBe(byLanguage);
  });
});
