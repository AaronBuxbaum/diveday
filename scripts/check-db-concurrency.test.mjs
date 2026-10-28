import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  findMisplacedRealServerSuites,
  findParentUpdateLocks,
  findTransactionFanOut,
} from "./check-db-concurrency.mjs";

const lines = (findings) => findings.map((finding) => finding.line);

describe("a function that can receive a transaction", () => {
  it("is refused a Promise.all", () => {
    const findings = findTransactionFanOut(`
      export async function readEvidence(tx: DbExecutor, tripId: string) {
        const [a, b] = await Promise.all([count(tx, tripId), other(tx, tripId)]);
        return a + b;
      }
    `);

    expect(lines(findings)).toEqual([3]);
  });

  it("is refused an allSettled too", () => {
    const findings = findTransactionFanOut(`
      async function f(tx: AppTransaction) {
        await Promise.allSettled([one(tx), two(tx)]);
      }
    `);

    expect(lines(findings)).toEqual([3]);
  });

  it("is refused one written by a closure it hands out", () => {
    // Closing over `tx` is how this came back the second time: the fan-out
    // moved into a callback, but it is still one checked-out client.
    const findings = findTransactionFanOut(`
      export async function walk(tx: DbExecutor, ids: string[]) {
        return ids.map(async (id) => {
          return Promise.all([one(tx, id), two(tx, id)]);
        });
      }
    `);

    expect(lines(findings)).toEqual([4]);
  });

  it("is refused one the formatter wrapped across two lines", () => {
    const findings = findTransactionFanOut(`
      async function f(tx: DbExecutor) {
        return Promise
          .all([one(tx), two(tx)]);
      }
    `);

    expect(lines(findings)).toEqual([3]);
  });

  it("may say on the line why this particular one is not over queries", () => {
    const findings = findTransactionFanOut(`
      async function f(tx: DbExecutor, urls: string[]) {
        await Promise.all(urls.map(fetch)); // diveday:allow-db-concurrency: HTTP, not queries
      }
    `);

    expect(findings).toEqual([]);
  });

  it("is not let off by an empty reason", () => {
    const findings = findTransactionFanOut(`
      async function f(tx: DbExecutor) {
        await Promise.all([one(tx)]); // diveday:allow-db-concurrency:
      }
    `);

    expect(lines(findings)).toEqual([3]);
  });
});

describe("a function that only ever sees the pool", () => {
  it("keeps its Promise.all -- the fan-out there is real and worth having", () => {
    // The whole reason this check is narrow. Serializing a hot roster,
    // manifest or Today read would be a regression, not a fix.
    const findings = findTransactionFanOut(`
      export async function listRoster(db: AppDb, tripId: string) {
        const [divers, crew] = await Promise.all([divers(db, tripId), crew(db, tripId)]);
        return { divers, crew };
      }
    `);

    expect(findings).toEqual([]);
  });

  it("keeps it even when a transaction-taking function sits above it in the file", () => {
    const findings = findTransactionFanOut(`
      async function inTx(tx: DbExecutor) {
        await one(tx);
      }

      export async function onPool(db: AppDb) {
        return Promise.all([a(db), b(db)]);
      }
    `);

    expect(findings).toEqual([]);
  });
});

describe("what the token scan buys over a regex", () => {
  it("ignores a Promise.all inside a comment or a string", () => {
    const findings = findTransactionFanOut(`
      async function f(tx: DbExecutor) {
        // Deliberately not Promise.all([one(tx), two(tx)]) -- see issue #517.
        const note = "was Promise.all([...])";
        const template = \`still Promise.all([...])\`;
        return note + template;
      }
    `);

    expect(findings).toEqual([]);
  });

  it("does not follow an overload signature into the next declaration's body", () => {
    // `export function f(tx: DbExecutor): Promise<void>;` has no body of its
    // own; the `;` has to end the claim, or the next unrelated block inherits it.
    const findings = findTransactionFanOut(`
      export function declared(tx: DbExecutor): Promise<void>;

      export async function unrelated(db: AppDb) {
        return Promise.all([a(db), b(db)]);
      }
    `);

    expect(findings).toEqual([]);
  });

  it("does not leak out of a type that merely mentions the executor", () => {
    const findings = findTransactionFanOut(`
      type Reader = { read(tx: DbExecutor): Promise<void> };

      export async function onPool(db: AppDb) {
        return Promise.all([a(db), b(db)]);
      }
    `);

    expect(findings).toEqual([]);
  });

  it("still catches the body after a generic return type full of commas", () => {
    const findings = findTransactionFanOut(`
      async function f(tx: DbExecutor): Promise<[number, number]> {
        return Promise.all([one(tx), two(tx)]);
      }
    `);

    expect(lines(findings)).toEqual([3]);
  });
});

describe("the scanner's own blind spots", () => {
  it("does not match a Promise.all named inside a comment", () => {
    // The guard's docblock has always promised this, and it was false. A
    // template literal with a substitution left the scanner mid-template, so
    // the closing backtick opened a phantom template that ran to the next
    // backtick anywhere in the file — and `src/db/seed-trip-legs.ts` had one in
    // a comment reading "Sequential, never `Promise.all`". The guard reported a
    // violation against a comment saying the opposite of a violation.
    const findings = findTransactionFanOut(`
      async function f(tx: DbExecutor): Promise<void> {
        if (missing.length > 0) throw new Error(\`nope: \${missing.join(", ")}\`);
        // Sequential, never \`Promise.all\`: this can be handed a transaction.
        for (const row of rows) await tx.insert(row);
      }
    `);

    expect(findings).toEqual([]);
  });

  it("still sees a real fan-out after a template literal with a substitution", () => {
    // The visible half of that bug was the false positive; the dangerous half
    // was that every brace after such a template was misattributed, so
    // `inTransaction()` could be wrong in either direction.
    const findings = findTransactionFanOut(`
      async function f(tx: DbExecutor): Promise<void> {
        log(\`seeding \${rows.length} rows\`);
        await Promise.all(rows.map((row) => tx.insert(row)));
      }
    `);

    expect(lines(findings)).toEqual([4]);
  });

  it("checks the body of a function whose return type is an object literal", () => {
    // `Promise<{ … }>` is what every async reader returning an object looks
    // like, and its `{` used to spend the "takes a transaction" flag before the
    // body ever opened — exempting the whole function. The sibling returning
    // `Promise<void>` was caught, which made the hole look like intent.
    const findings = findTransactionFanOut(`
      async function f(tx: DbExecutor): Promise<{ slug: string; count: number }> {
        return { slug: "s", count: (await Promise.all([one(tx), two(tx)])).length };
      }
    `);

    expect(lines(findings)).toEqual([3]);
  });

  it("leaves a pool-only reader alone even with an object return type", () => {
    const findings = findTransactionFanOut(`
      async function f(db: AppDb): Promise<{ slug: string }> {
        await Promise.all([one(db), two(db)]);
        return { slug: "s" };
      }
    `);

    expect(findings).toEqual([]);
  });
});

describe("a real-Postgres suite", () => {
  const suite = `
    import { describePostgres, postgresTestDb } from "@/test/postgres";
    describePostgres("races", () => {
      it("serializes", async () => {
        const pg = await postgresTestDb();
      });
    });
  `;

  it("is refused in a file the real-postgres job never selects", () => {
    // The 2026-10-13 shape: seat-locks.test.ts held two describePostgres races
    // that skipped in every unit shard and were never picked up by the job.
    expect(lines(findMisplacedRealServerSuites("src/db/seat-locks.test.ts", suite))).toEqual([
      2, 3, 5,
    ]);
  });

  it("is refused outside src/db even with the right suffix", () => {
    expect(
      lines(findMisplacedRealServerSuites("src/lib/thing.postgres.test.ts", suite)),
    ).toHaveLength(3);
  });

  it("runs feature-layer PostgreSQL suites through the real-server job", () => {
    expect(
      findMisplacedRealServerSuites(
        "src/features/setup-request-receipts/setup-request-receipts.postgres.test.ts",
        suite,
      ),
    ).toEqual([]);
  });

  it("allows the explicitly selected real-Postgres action race", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain(
      "'src/app/shop/[shopSlug]/divers/[personId]/erasure-race.postgres.test.ts'",
    );
    expect(
      findMisplacedRealServerSuites(
        "src/app/shop/[shopSlug]/divers/[personId]/erasure-race.postgres.test.ts",
        suite,
      ),
    ).toEqual([]);
    expect(findMisplacedRealServerSuites("src/app/other.postgres.test.ts", suite)).toHaveLength(3);
  });

  it("leaves alone a *.postgres.test.ts in src/db, and the harness that defines it", () => {
    expect(findMisplacedRealServerSuites("src/db/seat-locks.postgres.test.ts", suite)).toEqual([]);
    expect(findMisplacedRealServerSuites("src/test/postgres.ts", suite)).toEqual([]);
  });

  it("leaves alone a comment that names it", () => {
    const comment = `
      // describePostgres lives in seat-locks.postgres.test.ts
      /**
       * See postgresTestDb.
       */
    `;
    expect(findMisplacedRealServerSuites("src/db/seat-locks.test.ts", comment)).toEqual([]);
  });
});

describe("a lock on a shops or people row", () => {
  it("is refused for update, on one line or across a chain", () => {
    const findings = findParentUpdateLocks(`
      await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, id)).for("update");
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(eq(people.id, personId))
        .limit(1)
        .for("update");
    `);
    expect(lines(findings)).toEqual([2, 8]);
  });

  it("leaves alone no key update, and a lock on any other table", () => {
    const findings = findParentUpdateLocks(`
      await tx.select().from(shops).where(eq(shops.id, id)).for("no key update");
      await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
    `);
    expect(findings).toEqual([]);
  });

  it("does not reach past the statement's end into the next one", () => {
    const findings = findParentUpdateLocks(`
      const shop = await tx.select().from(shops).where(eq(shops.id, id));
      await tx.select().from(trips).where(eq(trips.id, tripId)).for("update");
    `);
    expect(findings).toEqual([]);
  });

  it("accepts a stated reason inside the statement, and only a stated one", () => {
    const reasoned = findParentUpdateLocks(`
      const locked = await tx
        .select()
        .from(people)
        // diveday:allow-update-lock: the merge repoints every key at the survivor.
        .for("update");
    `);
    expect(reasoned).toEqual([]);
    const bare = findParentUpdateLocks(`
      const locked = await tx
        .select()
        .from(people)
        // diveday:allow-update-lock:
        .for("update");
    `);
    expect(lines(bare)).toEqual([6]);
  });
});
