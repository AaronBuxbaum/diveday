import { readFileSync } from "node:fs";
import { and, eq, getTableName, isNull } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { passContentHash } from "@/features/wallet-pass";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { fileScopedShopContext } from "@/test/db";
import { schemaTableNameOf } from "@/test/schema-tables";
import { walletContentFixture } from "@/test/wallet-credentials";
import { anonymizeDiver } from "../features/anonymize/store";
import { ERASURE_KEEPS } from "../test/substrate-fixtures/db/erasure-coverage-keeps.test-support";
import { OUTSIDE_CLOSURE_REASONS } from "../test/substrate-fixtures/db/erasure-outside-closure-classification.test-support";
import { PROCESSOR_OBJECT_COLUMNS } from "../test/substrate-fixtures/db/erasure-processor-columns.test-support";
import {
  inRegistryDeleteFunction,
  REGISTRY_WRITE,
  registryDeletesRun,
  stripCommentsAndStrings,
} from "../test/substrate-fixtures/db/erasure-source.test-support";
import type { AppDb } from "./client";
import { EXPORT_TABLES, type ExportTableRead } from "./export-tables";
import { erasedPersonRowDeletes } from "./person-columns";
import * as schema from "./schema";
import {
  bookings,
  people,
  personRoles,
  processorErasureTarget,
  walletPasses,
  walletPassRegistrations,
} from "./schema";

const ctx = fileScopedShopContext({ history: true });

/**
 * The structural guard on the erasure path (`src/features/anonymize/store.ts`, ADR
 * 20260802-diver-data-erasure), in the shape of the one
 * `delete-path-coverage.test.ts` already puts over the two demo-reap orderings.
 *
 * Before this file, the only thing checking a promise made to a person who
 * asked to be forgotten was `anonymize.test.ts` — a set of per-table cases
 * somebody thought to write. A new table holding a diver's details was
 * invisible to it until a person thought of that table, and the record says how
 * that goes: `auth_provider_accounts` had no erasure delete from the day it was
 * added and was found by a `security-reviewer` pass on an unrelated change,
 * `auth_verifications` beside it by a second pass on the fix for the first, and
 * running this sweep by hand before writing it down found five more (issue
 * #1607). The asymmetry was the wrong way round: an incomplete demo reap
 * strands a shop behind a foreign-key violation, while an incomplete erasure
 * reports success.
 *
 * Every table a foreign key connects to `people` must therefore be **either**
 * written by the erasure **or** carry a written reason below for why it is
 * left standing. Adding a table without deciding fails, and the failure names
 * the table.
 *
 * ## Three limits, stated rather than papered over
 *
 * **1. It proves a table was *considered*, not that the statement is right.**
 * The write set is read from the source of `anonymize.ts`, not from a run. That
 * is a deliberate reversal of the delete-path guard's instrument, and it was
 * measured: running `anonymizeDiver` against a seeded diver through a recording
 * Proxy sees only ~30 of the tables the path writes, because the erasure's
 * conditional branches (`if (account)`, `if (owned)`) never fire for one
 * fixture. A guard built that way needs its unreachable tables keep-listed, and
 * a keep-list entry is exactly where a deleted statement hides. So the sweep is
 * static and complete, and `anonymize.test.ts` is where a *column* is asserted
 * to be gone. The last test below closes the gap the other way, by failing on a
 * write the static read cannot see.
 *
 * **2. "Written" is table-level, deliberately.** A table this file counts as
 * handled may still have a column nobody scrubbed — that is the per-table case
 * in `anonymize.test.ts`, and it is why both files exist. What this one
 * guarantees is that no table was *forgotten*.
 *
 * **3. It cannot *find* a table reached by text — so it asks about all of
 * them.** The closure follows declared foreign keys, so a table that names its
 * person as an address, an identifier or a polymorphic subject id is outside it
 * however many hops it runs, which is exactly how `auth_verifications` hid from
 * the delete-path guard for as long as it did. No pattern over column names
 * fixes that: this file tried one, and it missed both a bare `person_id` with
 * no foreign key and anything holding a person under a column named something
 * else. So the support file's `OUTSIDE_CLOSURE_REASONS` is the **whole**
 * complement — every outside table carries a written reason, and a new table
 * lands in one list or the other on the day it is added. What is left
 * outside is judgement, not coverage: this guard makes someone answer for every
 * table, and a `security-reviewer` pass is what checks the answer.
 */

type ForeignKeyFacts = { target: string; columns: string[]; onDelete: string };
type ColumnFacts = { name: string; columnType: string };
type TableFacts = { references: string[]; columns: ColumnFacts[]; foreignKeys: ForeignKeyFacts[] };

function schemaTables(): Map<string, TableFacts> {
  const tables = new Map<string, TableFacts>();
  for (const value of Object.values(schema)) {
    // `getTableConfig` throws on everything in the schema that is not a table —
    // the enums and the views — which is how they are skipped.
    let config: ReturnType<typeof getTableConfig>;
    try {
      config = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
    } catch {
      continue;
    }
    tables.set(getTableName(value as Parameters<typeof getTableName>[0]), {
      references: config.foreignKeys.map((key) => getTableName(key.reference().foreignTable)),
      columns: config.columns.map((column) => ({
        name: column.name,
        columnType: column.columnType,
      })),
      foreignKeys: config.foreignKeys.map((key) => ({
        target: getTableName(key.reference().foreignTable),
        columns: key.reference().columns.map((column) => column.name),
        onDelete: (key as unknown as { onDelete?: string }).onDelete ?? "no action",
      })),
    });
  }
  return tables;
}

/**
 * Every table a foreign key connects back to `people`, however many hops it
 * takes, run to a fixed point.
 *
 * Scope is the person, not the shop — an erasure follows one diver out of a
 * shop that carries on — so this starts at `people` rather than at the
 * `shop_id` carriers `delete-path-coverage.test.ts` starts from. It reaches 96
 * of the schema's tables.
 */
function personScopedTableNames(tables: Map<string, TableFacts>): string[] {
  const scoped = new Set<string>(["people"]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, table] of tables) {
      if (scoped.has(name)) continue;
      if (!table.references.some((target) => scoped.has(target))) continue;
      scoped.add(name);
      grew = true;
    }
  }
  return [...scoped];
}

/**
 * Every table `anonymizeDiver` writes, read from the source rather than from a
 * run — see limit 1 above.
 *
 * An identifier that does not resolve to a table in `./schema` is a failure
 * rather than a silent omission: a `tx.update(someLocalAlias)` would otherwise
 * shrink this set without shrinking the keep-list, and the guard would read
 * green over the table it stopped seeing.
 */
function erasureWriteSites(): { written: Set<string>; unresolved: string[] } {
  // Comments and string literals are stripped first. A write that is *commented
  // out* rather than deleted would otherwise still match, keeping its table in
  // this set and its absence out of the keep-list — which is the exact failure
  // the static instrument is here to prevent, so leaving it would have been a
  // guard that reads green over the statement it stopped running (issue #1607,
  // found by a `security-reviewer` pass on the first draft of this file).
  const source = stripCommentsAndStrings(readFileSync("src/features/anonymize/store.ts", "utf8"));
  const written = new Set<string>();
  const unresolved: string[] = [];
  for (const match of source.matchAll(/\.(?:update|delete)\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)/g)) {
    const identifier = match[1] as string;
    if (identifier === REGISTRY_WRITE && inRegistryDeleteFunction(source, match.index ?? 0))
      continue;
    const name = schemaTableNameOf(identifier);
    if (name) written.add(name);
    else unresolved.push(identifier);
  }
  if (registryDeletesRun(source)) {
    for (const { table } of erasedPersonRowDeletes()) written.add(table);
  }
  return { written, unresolved };
}

/**
 * The tables `anonymizeDiver` **hard-deletes** from, in the order its source
 * deletes them. Order matters here and nowhere else in this file: a foreign key
 * into a deleted table is harmless if the referencing rows go first.
 */
function erasureHardDeleteOrder(): string[] {
  const source = stripCommentsAndStrings(readFileSync("src/features/anonymize/store.ts", "utf8"));
  const order: string[] = [];
  const sites =
    /\.delete\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)|(?<!function )\bdeleteRegisteredPersonRows\(\s*tx\b/g;
  for (const match of source.matchAll(sites)) {
    // The registry's deletes run where a sweep calls them, not where they are written.
    const names = match[1]
      ? [schemaTableNameOf(match[1])]
      : erasedPersonRowDeletes().map(({ table }) => table);
    // An unresolved one is reported by `erasureWriteSites`; not this function's job.
    for (const name of names) if (name && !order.includes(name)) order.push(name);
  }
  return order;
}

/**
 * Tables the erasure writes through a helper module rather than in
 * `anonymize.ts` itself, which the static read above cannot see. Each is
 * named here so the recorder below has something to check against, and so the
 * indirection is visible rather than looking like a write nobody declared.
 */
const WRITTEN_VIA_HELPER: Record<string, string> = {
  wallet_passes:
    "`voidWalletPassesForPerson` (@/features/wallet-pass) voids/revokes owned snapshots, strips their name and clears crew identities across tenant snapshots, including expired passes",
  wallet_pass_registrations:
    "`voidWalletPassesForPerson` (@/features/wallet-pass) soft-deletes owned pass registrations so devices lose download/registration authority",
  trip_assignments:
    "`forgetTrainingPlanPeople` (./training-plan-privacy) clears personal instructor/author handles and timestamps while preserving the operational crew assignment; erasure refuses staff-role identities",
  claude_call_content:
    "`forgetClaudeCallContent` (./claude-call-content) — every erasure path deletes the shop's Claude call text through it, under the lock a call in flight writes under (ADR 20261023-claude-call-content)",
  claude_call_content_erasures:
    "`forgetClaudeCallContent` (./claude-call-content) — the shop's erasure stamp, which keeps a call that read before the erasure from writing after it",
  media_deletion_attempts:
    "`queueMediaDeletion` (./media-deletions) — every blob the erasure retires goes through the existing durable ledger rather than a second mechanism invented here (ADR 20260723-media-validation-and-deletion)",
  waiver_drafts:
    "`clearWaiverDrafts` (./waiver-drafts) — whatever any door typed into a release and never signed (names, medical answers and alert, a guardian's half) is deleted with the diver's records (issue #4130)",
  processor_erasure_obligations:
    "`recordProcessorErasureObligations` (./processor-erasure) — what Stripe still holds, written inside the transaction so a crash a millisecond later cannot lose it (ADR 20260803-processor-erasure-obligations)",
};

/**
 * Every ledger target `anonymize.ts` builds an obligation with, read from its
 * source.
 *
 * The targets are string literals, so the blanking pass cannot be run over the
 * source the way `erasureWriteSites` runs it — blanking is what would erase the
 * answer. It is used as a mask instead: blanking preserves offsets, so a
 * `target:` that still reads `target:` in the blanked copy was code, and one
 * that does not was prose quoting a target in a docblock.
 */
function erasureTargetLiterals(): Set<string> {
  const source = readFileSync("src/features/anonymize/store.ts", "utf8");
  const masked = stripCommentsAndStrings(source);
  const literals = new Set<string>();
  for (const match of source.matchAll(/target:\s*"([a-z_]+)"/g)) {
    const at = match.index;
    if (at === undefined || !masked.startsWith("target:", at)) continue;
    literals.add(match[1] as string);
  }
  return literals;
}

/**
 * The segments a column name carries when it names something an outside party
 * holds. Vendors are here as belt and braces; the role words are what make the
 * net survive a vendor nobody has heard of yet. See the census docblock.
 */
const OUTSIDE_PARTY_SEGMENTS = new Set([
  "stripe",
  "paypal",
  "braintree",
  "adyen",
  "square",
  "worldpay",
  "mollie",
  "razorpay",
  "klarna",
  "quickbooks",
  "shopify",
  "twilio",
  "external",
  "provider",
  "processor",
  "gateway",
  "psp",
  "merchant",
  "acquirer",
  "remote",
  "upstream",
  "customer",
  "checkout",
  "session",
  "invoice",
  "charge",
  "intent",
  "payout",
  "transfer",
  "refund",
  "subscription",
  "coupon",
  "promotion",
  "payer",
  "mandate",
  "dispute",
  "receipt",
  "reference",
  "ref",
  "payment",
  "transaction",
]);

/**
 * Free text is the only shape a handle minted elsewhere can arrive in: an enum
 * holds one of our own words, and a `uuid` or an integer is minted here.
 */
const FREE_TEXT_COLUMN_TYPES = new Set(["PgText", "PgVarchar", "PgChar"]);

function isOutsideHandleCandidate(column: ColumnFacts): boolean {
  if (!FREE_TEXT_COLUMN_TYPES.has(column.columnType)) return false;
  return column.name.split("_").some((segment) => OUTSIDE_PARTY_SEGMENTS.has(segment));
}

/** `table.column` for every column the census above has to answer for. */
function outsideHandleCandidates(tables: Map<string, TableFacts>): string[] {
  const found: string[] = [];
  for (const [name, facts] of tables) {
    for (const column of facts.columns) {
      if (isOutsideHandleCandidate(column)) found.push(`${name}.${column.name}`);
    }
  }
  return found.sort();
}

/**
 * Run `work` against a db that records every table written through it — inside
 * the transaction as well as outside, since the erasure does all of its work on
 * a `tx`. The writes still execute, so a path that would fail still fails.
 */
async function recordWrittenTables(
  db: AppDb,
  work: (recorder: AppDb) => Promise<unknown>,
): Promise<Set<string>> {
  const written = new Set<string>();
  const wrap = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(inner, property, receiver) {
        // `insert` is watched too, and that is not symmetry for its own sake:
        // both helpers in `WRITTEN_VIA_HELPER` write by insert, so a recorder
        // watching only updates and deletes could never observe either one and
        // the claim below would have been vacuous. A future helper that inserts
        // a row carrying the diver's data would have been invisible to the
        // static read *and* to this test (issue #1607, `security-reviewer`).
        if (property === "update" || property === "delete" || property === "insert") {
          return (table: Parameters<AppDb["delete"]>[0]) => {
            written.add(getTableName(table));
            // One call shape: the three signatures no longer unify (drizzle-kit rc.5).
            const write = (inner as unknown as Record<string, (t: unknown) => unknown>)[property];
            return write.call(inner, table);
          };
        }
        if (property === "transaction") {
          return (callback: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) =>
            (inner as unknown as AppDb).transaction(
              ((tx: object) => callback(wrap(tx))) as never,
              ...(rest as []),
            );
        }
        const value = Reflect.get(inner, property, receiver);
        return typeof value === "function" ? value.bind(inner) : value;
      },
    });
  await work(wrap(db) as AppDb);
  return written;
}

describe("erasure coverage", () => {
  const tables = schemaTables();

  it("enumerates enough tables to be worth asserting on", () => {
    expect(tables.size).toBeGreaterThan(100);
    expect(personScopedTableNames(tables).length).toBeGreaterThan(80);
  });

  it("resolves every write site in anonymize.ts to a table", () => {
    const { written, unresolved } = erasureWriteSites();
    expect(unresolved).toEqual([]);
    expect(written.size).toBeGreaterThan(30);
  });

  it("writes or deliberately keeps every table a foreign key connects to a diver", () => {
    const { written } = erasureWriteSites();
    const undecided = personScopedTableNames(tables)
      .filter(
        (name) => !written.has(name) && !(name in ERASURE_KEEPS) && !(name in WRITTEN_VIA_HELPER),
      )
      .sort();
    expect(undecided).toEqual([]);
  });

  /**
   * The export read list (`./export-tables`) names, per table, the column a
   * diver's own bundle reads it by. A table a diver can ask to *see* as theirs
   * is a table they can ask to have *forgotten*, so every one of them must be
   * decided by the erasure path above — and the scope column must really be a
   * foreign key to `people` or `bookings`, or the list is describing a table
   * the closure cannot see.
   */
  it("decides every table a diver's own export reads as theirs", () => {
    const { written } = erasureWriteSites();
    const diverScoped = Object.values(EXPORT_TABLES as Record<string, ExportTableRead>)
      .filter(({ scope }) => scope.personColumn || scope.bookingColumn)
      .map(({ table }) => getTableName(table));
    expect(diverScoped.length).toBeGreaterThan(15);
    expect(
      diverScoped.filter((name) => !written.has(name) && !(name in ERASURE_KEEPS)).sort(),
    ).toEqual([]);
  });

  it("scopes a diver's export reads only through a foreign key to people or bookings", () => {
    const misdeclared: string[] = [];
    for (const { table, scope } of Object.values(
      EXPORT_TABLES as Record<string, ExportTableRead>,
    )) {
      const name = getTableName(table);
      const facts = tables.get(name);
      for (const [column, target] of [
        [scope.personColumn, "people"],
        [scope.bookingColumn, "bookings"],
      ] as const) {
        if (!column) continue;
        const keyed = facts?.foreignKeys.some(
          (key) => key.target === target && key.columns.includes(column.name),
        );
        if (!keyed) misdeclared.push(`${name}.${column.name} references no ${target}`);
      }
      const ownColumn = getTableConfig(table).columns.includes(scope.shopColumn as never);
      if (!ownColumn || scope.shopColumn.name !== "shop_id") {
        misdeclared.push(`${name} is shop-scoped by ${scope.shopColumn.name}`);
      }
    }
    expect(misdeclared).toEqual([]);
  });

  it("has no keep-reason for a table the erasure does write", () => {
    const { written } = erasureWriteSites();
    expect(
      Object.keys(ERASURE_KEEPS)
        .filter((name) => written.has(name))
        .sort(),
    ).toEqual([]);
  });

  /**
   * The static sweep's blind spot, closed from the other side: a real erasure
   * is run through a recorder, and every table it actually wrote must be one
   * this file already knows about. A write that moved into a helper module
   * fails here until it is named in `WRITTEN_VIA_HELPER`, so the indirection
   * cannot quietly take a table out of the sweep's sight.
   *
   * It deliberately asserts nothing about what the run did *not* reach: one
   * fixture never fires every branch, which is why the sweep above is static.
   */
  it("writes no table the sweep above cannot see", async () => {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    // A seeded diver who actually holds a seat, not a bare `people` row. The
    // erasure's big conditional (`if (owned)`) covers most of the file, so a
    // diver with no booking exercises the unconditional statements only and the
    // recording below would be nearly vacuous.
    const [diver] = await db
      .select({ id: people.id, fullName: people.fullName, bookingId: bookings.id })
      .from(people)
      .innerJoin(bookings, eq(bookings.personId, people.id))
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(
        and(
          eq(people.shopId, shop.id),
          eq(personRoles.role, "diver"),
          isNull(people.deletedAt),
          isNull(people.anonymizedAt),
        ),
      )
      .orderBy(people.id)
      .limit(1);
    if (!diver) throw new Error("expected a seeded diver holding a booking");

    // Real related rows make the helper declaration observable, even while
    // native issuer credentials are absent. This is not an erasure keep-list.
    const content = walletContentFixture();
    content.auxiliaryFields = [{ key: "diver", label: "Name", value: diver.fullName }];
    const [pass] = await db
      .insert(walletPasses)
      .values({
        shopId: shop.id,
        bookingId: diver.bookingId,
        platform: "apple",
        locale: "en-US",
        authenticationTokenHash: hashBearerToken("erasure-guard-test-only"),
        contentJson: content,
        contentHash: passContentHash(content),
      })
      .returning();
    await db.insert(walletPassRegistrations).values({
      shopId: shop.id,
      passId: pass.id,
      deviceLibraryIdentifier: "erasure-guard-test-device",
      pushToken: "erasure-guard-test-push-token",
    });

    const recorded = await recordWrittenTables(db, (recorder) =>
      anonymizeDiver(recorder, {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: owner.id,
      }),
    );
    // The `owned` branch alone is worth more than this; the bound is a floor
    // that catches the recorder silently seeing nothing, not a target.
    expect(recorded.size).toBeGreaterThan(25);
    expect(recorded.has("wallet_passes")).toBe(true);
    expect(recorded.has("wallet_pass_registrations")).toBe(true);
    const [scrubbed] = await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id));
    expect(scrubbed.contentJson.voided).toBe(true);
    expect(scrubbed.deletedAt).not.toBeNull();
    expect(JSON.stringify(scrubbed.contentJson)).not.toContain(diver.fullName);
    const [registration] = await db
      .select()
      .from(walletPassRegistrations)
      .where(eq(walletPassRegistrations.passId, pass.id));
    expect(registration.deletedAt).not.toBeNull();

    const { written } = erasureWriteSites();
    const unaccounted = [...recorded]
      .filter((name) => !written.has(name) && !(name in WRITTEN_VIA_HELPER))
      .sort();
    expect(unaccounted).toEqual([]);
  });

  /**
   * **A foreign key pointing *at* a table the erasure deletes from can abort the
   * whole erasure**, and nothing guarded that until issue #1616.
   *
   * The scrub is one transaction. A referencing row makes a `delete` raise
   * 23503, and the rollback takes every other redaction with it — so the
   * failure is not a partial erasure, it is none, and neither `anonymizeDiver`
   * nor `eraseDiverAction` catches it. That is what
   * `trip_invitations.waitlist_entry_id` would have done: it referenced
   * `trip_waitlist_entries` with no `onDelete`, and only the fact that no row
   * ever populated it kept the erasure working.
   *
   * Dropping that column fixed the instance. This closes the class, which is
   * the half the row-level test below cannot reach: after the column is gone,
   * no arrangement of rows can construct the hazard, so only the schema can be
   * asked about it. A `security-reviewer` pass made exactly that point.
   *
   * A key is safe three ways, and the third is the interesting one:
   *
   *   1. it declares `onDelete: "cascade"` or `"set null"`, so Postgres clears
   *      the referencing rows itself;
   *   2. its target is not a table the erasure hard-deletes from at all;
   *   3. **its own table is hard-deleted earlier in the same scrub.** That is
   *      how `last_minute_list_unsubscribe_tokens` survives — the tokens go two
   *      statements before the entries they point at, an invariant that lived
   *      nowhere but the adjacency of those two lines until this assertion.
   *
   * The limit, stated rather than left implied: source order is not execution
   * order for a delete inside a conditional branch. This proves the statements
   * are written in a safe sequence, and `anonymize.test.ts` running the real
   * path against a real database is what proves they execute in one.
   */
  it("has no foreign key that could abort the erasure transaction", () => {
    const order = erasureHardDeleteOrder();
    expect(order.length).toBeGreaterThan(10);
    const deletedAt = new Map(order.map((name, index) => [name, index]));

    const hazards: string[] = [];
    for (const [name, facts] of tables) {
      for (const key of facts.foreignKeys) {
        const targetDeletedAt = deletedAt.get(key.target);
        if (targetDeletedAt === undefined) continue;
        if (key.onDelete === "cascade" || key.onDelete === "set null") continue;
        const ownDeletedAt = deletedAt.get(name);
        if (ownDeletedAt !== undefined && ownDeletedAt < targetDeletedAt) continue;
        hazards.push(`${name}.${key.columns.join(",")} -> ${key.target} (${key.onDelete})`);
      }
    }
    expect(hazards.sort()).toEqual([]);
  });

  /**
   * The sweeps run from `SCRUB_SECTIONS`, not from their position in the file,
   * so a sweep that is defined but left off the list would still satisfy the
   * write-set and order checks above while never running. The list must name
   * every `scrub*` function, in the order the file defines them, which is the
   * order the order check reads.
   */
  it("runs every scrub section, in the order the file defines them", () => {
    const source = readFileSync("src/features/anonymize/store.ts", "utf8");
    const defined = [...source.matchAll(/^async function (scrub\w+)\(/gm)].map((m) => m[1]);
    const list = source.match(/const SCRUB_SECTIONS = \[([^\]]*)\]/)?.[1] ?? "";
    const listed = [...list.matchAll(/\b(scrub\w+)\b/g)].map((m) => m[1]);
    expect(defined.length).toBeGreaterThan(10);
    expect(listed).toEqual(defined);
  });

  it("decides every table outside the closure, not only the ones a pattern asks about", () => {
    const scoped = new Set(personScopedTableNames(tables));
    expect([...tables.keys()].filter((name) => !scoped.has(name)).sort()).toEqual(
      Object.keys(OUTSIDE_CLOSURE_REASONS).sort(),
    );
  });

  /**
   * Issue #1621: the ledger's source list was `orders` alone while two other
   * tables held a Checkout Session for a person. Nothing failed — an erasure
   * simply reported success over objects Stripe still held, which is a promise
   * broken rather than a bug, and exactly the asymmetry this file exists for.
   */
  it("decides every outside handle the net can see, not only the ones somebody remembered", () => {
    expect(outsideHandleCandidates(tables)).toEqual(Object.keys(PROCESSOR_OBJECT_COLUMNS).sort());
  });

  /**
   * The net itself, since the test above can only ever be as wide as this
   * predicate is.
   *
   * It used to be `column.startsWith("stripe_")` under a docblock promising
   * every processor handle in the schema, so the guard's written promise was
   * wider than what it checked and two `provider_ref` columns were already
   * living in the gap (a `security-reviewer` pass). These cases are what "by
   * role, not by vendor" has to mean to have been worth changing, and the three
   * refusals are the stated limits rather than oversights: an enum holds one of
   * our own words, a `uuid` is minted here, and a name carrying none of the
   * segments is the hole `security-reviewer` still has to cover.
   */
  it("asks about a handle spelled without a vendor's name", () => {
    const asks = (name: string, columnType = "PgText") =>
      isOutsideHandleCandidate({ name, columnType });
    for (const name of [
      "paypal_payer_id",
      "provider_customer_id",
      "external_customer_id",
      "processor_charge_id",
      "psp_reference",
      "gateway_session_id",
      "provider_ref",
    ]) {
      expect(asks(name), name).toBe(true);
    }
    expect(asks("stripe_account_id", "PgEnumColumn")).toBe(false);
    expect(asks("stripe_customer_id", "PgUUID")).toBe(false);
    expect(asks("acquiring_bank_token")).toBe(false);
  });

  /**
   * The other half of that decision. Tagging a column `person` is a claim that
   * erasure owes something at Stripe for it, and the claim was checked by
   * nobody: the test above compares key sets, so a handle could be censused,
   * called a diver's, and never raise a row. This makes the tag name its target
   * and holds the target to the ledger's enum and to a target the erasure
   * really builds.
   *
   * The enum half is a runtime assertion of something the type above already
   * states, and deliberately so: `pnpm test` does not typecheck, so a target
   * retired from the enum while an entry still names it would otherwise be
   * caught only by a separate run.
   */
  it("names, for every processor handle held for a person, an obligation the erasure raises", () => {
    const declared = Object.entries(PROCESSOR_OBJECT_COLUMNS).flatMap(([column, entry]) =>
      entry.held === "person" ? [{ column, raises: entry.raises }] : [],
    );
    // A floor, not a target: it catches a census that stopped tagging anything
    // `person`, which would make every assertion below pass over an empty list.
    expect(declared.length).toBeGreaterThan(3);

    const enumValues = new Set<string>(processorErasureTarget.enumValues);
    const built = erasureTargetLiterals();
    expect(
      declared
        .filter(({ raises }) => !enumValues.has(raises) || !built.has(raises))
        .map(({ column, raises }) => `${column} -> ${raises}`)
        .sort(),
    ).toEqual([]);
  });
});
