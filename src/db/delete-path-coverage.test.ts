import { eq, getTableName, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { seededTestDb } from "@/test/db";
import type { AppDb, DbExecutor } from "./client";
import { capturedDemoResetPlan, resetDemoFromSnapshot } from "./demo-reset-snapshot";
import * as schema from "./schema";
import { accountSessions, mediaDeletionAttempts, people, shops, userAccounts } from "./schema";
import {
  clearDemoSchedule,
  createDemoShop,
  deleteDemoShopCascade,
  resetDemoSchedule,
} from "./seed";

/**
 * The structural guard on the two hand-maintained delete orderings —
 * `resetDemoSchedule` (src/db/seed.ts) and `deleteDemoShopCascade`
 * (src/db/seed-demo-lifecycle.ts).
 *
 * Both are topological sorts of the foreign-key graph, written by hand because
 * the shop-scoped FKs carry no `ON DELETE CASCADE`. Their existing guard is
 * `reap-demos.test.ts`, and its own docs admit the shape of the problem: it is
 * a set of **per-table cases somebody remembered to write**, not a sweep. A new
 * table is therefore invisible to it until someone thinks of it — which is
 * exactly how `last_minute_list_unsubscribe_tokens` started aborting every
 * `/api/test/reset` mid-run, and how the blow-out cascade's two tables went
 * missing from *both* orderings and turned 66 e2e specs red at once with
 * nothing in common.
 *
 * This closes the class rather than patching instances. Every table carrying a
 * `shop_id` must either be deleted by a path, or carry a written reason here
 * for why that path leaves it standing — the same "decide it or fail" ratchet
 * `src/db/export.test.ts` applies to the export bundle. Adding a table without
 * deciding its fate fails, and the failure names the table.
 *
 * **It records what the code actually did**, not what a grep found: each path
 * runs against a real seeded shop through a recorder that notes every
 * `db.delete(table)`. A delete moved into a helper still counts; a delete
 * inside a branch that never runs does not, which is the honest answer.
 *
 * **Scope is the foreign-key graph, not the `shop_id` column.** It used to be
 * the column, and that left the tables reached through a parent's id list —
 * `user_accounts`, `account_tokens`, `person_roles`, `trip_assignments` —
 * invisible to the guard whose whole job is finding tables nobody deletes.
 * `auth_provider_accounts` is what made the cost visible: it reaches a shop
 * only as `user_account_id` -> `person_id` -> `shop_id`, so it sat with no
 * delete path in either ordering from the day it was added, and neither guard
 * could say so (issue #1594). The sweep now starts at the `shop_id` carriers
 * and follows foreign keys outward, which catches that table and any sibling
 * added the same way.
 *
 * **What the closure cannot reach is written down rather than left silent.**
 * It follows declared foreign keys, so a table that names a tenant as *text* —
 * a denormalized slug, a polymorphic subject id, an email — is outside it no
 * matter how many hops it runs. `UNSCOPED_REASONS` below is the complement,
 * asserted exactly: every table the closure does not reach must carry a
 * written reason, so the next table of that shape is a failure here rather
 * than a silence. `auth_verifications` is the live example — better-auth's
 * `verification` model has no foreign key at all, and both paths sweep it by
 * `identifier` instead.
 *
 * One limit, stated rather than papered over: this proves a table is *named*,
 * not that it is named in the right *order*. Ordering is what the FK violations
 * in `reap-demos.test.ts` prove, and both guards are needed: this one says "you
 * did not forget", that one says "you did not put it in the wrong place".
 */

/**
 * Every table that belongs to a shop: the ones carrying a `shop_id` column,
 * plus every table that reaches one of those through a foreign key, however
 * many hops it takes. `auth_provider_accounts` -> `user_accounts` -> `people`
 * is three tables and one shop.
 *
 * The closure is run to a fixed point rather than one hop deep, because the
 * chain length is an accident of how a table was modelled and a guard that
 * stopped at one hop would be a guard with a boundary nobody can remember. It
 * adds nine tables to the eleven-dozen the column alone finds, and leaves
 * standing only what genuinely belongs to nobody: better-auth's
 * `auth_verifications`, the two `global_dive_site*` catalogue tables, and the
 * two provider ledgers (`notification_rate_limit_state`,
 * `stripe_webhook_events`) that `RESET_KEEPS` already names in prose.
 */
function shopScopedTableNames(): string[] {
  const tables = new Map<string, { hasShopId: boolean; references: string[] }>();
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
      hasShopId: config.columns.some((column) => column.name === "shop_id"),
      references: config.foreignKeys.map((key) => getTableName(key.reference().foreignTable)),
    });
  }
  // `shops` is a root beside the `shop_id` carriers: it has no such column of
  // its own, and leaving it out made both paths' answers about the shop row
  // unassertable — `RESET_KEEPS`'s "the shop itself survives" entry was inert
  // prose rather than a claim this file checks.
  const scoped = new Set(
    [...tables]
      .filter(([name, table]) => table.hasShopId || name === "shops")
      .map(([name]) => name),
  );

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

/** Every table in the schema, by name. */
function allTableNames(): string[] {
  const names: string[] = [];
  for (const value of Object.values(schema)) {
    try {
      getTableConfig(value as Parameters<typeof getTableConfig>[0]);
    } catch {
      continue;
    }
    names.push(getTableName(value as Parameters<typeof getTableName>[0]));
  }
  return names;
}

/**
 * The complement of the closure: every table no foreign key connects to a
 * shop, and why that is the right answer for it. Adding a table that belongs
 * to a person or a shop but names them as *text* fails here, which is the only
 * place it can fail — see the note above.
 */
const UNSCOPED_REASONS: Record<string, string> = {
  retention_prune_state:
    "global scheduler cursor holding only a table code, with no shop or person key",
  auth_verifications:
    "better-auth's `verification` model: no foreign key, names its person as text in `identifier`. Both paths sweep it by that column, and so does the erasure (src/db/anonymize.ts) — a pending row holds an address and a live token",
  global_dive_sites: "DiveDay’s own catalog of sites, shared by every shop and owned by none",
  global_dive_site_versions: "the catalog's own history, beside the table above",
  notification_rate_limit_state:
    "provider coordination keyed by ceiling and period, holding no person",
  stripe_webhook_events:
    "the platform's delivery ledger, pruned by retention; it carries no payload",
  claude_demo_spend:
    "what every minted demo together spent on Claude, one row a month; it must outlive a deleted demo or the shared allowance refills",
  setup_requests:
    "a shop asking DiveDay to be set up, before any shop exists — the platform's lead list, not a tenant's (ADR 20261007-setup-request-form)",
  demo_entries:
    "a count of demo entries by funnel tag, deliberately unkeyed from the minted shop so the reaper does not erase the count; pruned by retention",
  sms_opt_outs:
    "the texting number's STOP list, one for the platform because every shop texts from one number; a shop's delete must not resume texting a diver who said stop",
};

/**
 * Run `work` with a db that records every table it deletes from, and otherwise
 * behaves exactly like the real one — the deletes still execute, so a path that
 * would FK-violate still does.
 */
async function recordDeletedTables(
  db: AppDb,
  work: (recorder: DbExecutor) => Promise<void>,
): Promise<Set<string>> {
  const deleted = new Set<string>();
  const wrap = <T extends object>(target: T): T =>
    new Proxy(target, {
      get(inner, property, receiver) {
        if (property === "delete") {
          return (table: Parameters<AppDb["delete"]>[0]) => {
            deleted.add(getTableName(table));
            return (inner as AppDb).delete(table);
          };
        }
        if (property === "transaction") {
          return (callback: (tx: object) => Promise<unknown>, ...rest: unknown[]) =>
            (inner as AppDb).transaction(
              ((tx: object) => callback(wrap(tx))) as never,
              ...(rest as []),
            );
        }
        const value = Reflect.get(inner, property, receiver);
        return typeof value === "function" ? value.bind(inner) : value;
      },
    });
  await work(wrap(db) as DbExecutor);
  return deleted;
}

/**
 * Shop-scoped tables `resetDemoSchedule` deliberately leaves standing. This is
 * a *schedule* reset, not a shop delete: the shop and the things that make it
 * itself survive, so a demo session stays signed in and a re-seed lands on the
 * same shop.
 *
 * **This list is also the e2e suite's leak set**, and adding to it says so out
 * loud. Every Playwright spec shares one `blue-mantis` fixture restored by this
 * reset before each test, so a table named here is a table whose writes survive
 * into whatever spec Playwright's sharding runs next in that worker. A spec
 * that writes one takes a shop of its own — the `privateShop` fixture in
 * `e2e/fixtures.ts` (ADR 20260815-per-test-private-shops). The `shops` entry
 * below carries the same warning for its columns: the reset restores three of
 * them, and a spec writing any other one needs a private shop too.
 */
const RESET_KEEPS: Record<string, string> = {
  certification_junior_reviews: "ON DELETE CASCADE from certifications clears it",
  staff_credential_history: "ON DELETE CASCADE from staff credentials clears it",
  account_sign_in_challenges:
    "stable staff pending sign-ins survive a schedule reset; purged accounts cascade them",
  shops: "the shop itself survives a schedule reset — that is the whole point",
  // Operational and provider plumbing a reset has no seeded state to restore
  // and no visitor path that writes one.
  notification_rate_limit_state: "provider coordination state, not shop records",
  stripe_webhook_events: "provider delivery ledger, pruned by retention, not by a reset",
  email_bounces:
    "DiveDay's record of mail SES bounced, pruned by retention, not by a reset; a demo mails only the simulator's success address",
  shop_setup_links:
    "the platform's record of which set-up request opened the shop; a demo is never opened by one, and a reset keeps the shop",
  shop_whatsapp_accounts: "shop settings, outside the resettable schedule",
  shop_subscriptions:
    "what the shop pays DiveDay, set by a person or Stripe's webhook — never by a demo visitor, so nothing for a reset to restore",
  pricing_volume_statements:
    "the percent plan's monthly fee basis, written by the pricing cron for real shops only — a demo is never billed, so a reset has nothing to restore",
  shop_contact_email_confirmation_tokens:
    "the front-desk address's own proof of ownership (issue #1288) — settings, not schedule",
  boats: "shop settings, outside the resettable schedule",
  trip_lenses:
    "the shop’s own words for a kind of day — vocabulary is settings, not schedule, and the reset rebuilds the board rather than the words",
  dive_packages: "the shop’s own price list of packages — settings, not schedule",
  pre_departure_checklist_items: "the shop’s own checklist lines — settings, not schedule",
  shop_backup_destinations: "seeded by the stable half (seedBackup); a reset would not restore it",
  shop_backup_deliveries: "delivery history for those bundles, seeded alongside the destination",
  shop_integrations: "provider credentials and linkage, outside the resettable schedule",
  // Kept for the same reason the connection above is: this is the map from a
  // DiveDay record to the provider's own, and it is what stops a second
  // QuickBooks Customer being created for a diver already synced (issue #1015).
  // Clearing it on a schedule reset would recreate the duplicate the table
  // exists to prevent -- and it is shop-and-provider scoped now, so it outlives
  // any one connection rather than any one schedule.
  integration_sync_records: "the provider idempotency map, which belongs to the connection above",
  // The one table here that needs no delete at all: both its foreign keys carry
  // `ON DELETE CASCADE`, so Postgres clears it when the booking goes. Naming it
  // in the ordering would be dead code that reads like a safety measure.
  booking_payment_events: "ON DELETE CASCADE from bookings clears it",
  push_subscriptions: "ON DELETE CASCADE from trips clears it",
  // The Monday email's claims. Nothing seeds one and a demo shop never sends
  // one; a purged person's rows go by ON DELETE CASCADE from people.
  weekly_digest_sends: "ON DELETE CASCADE from people clears a purged person's claims",
  // Claude's cost ledger for the shop: kept across a schedule reset, because
  // the month's cap is the shop's spend and a reset must not refill it.
  claude_usage:
    "the shop's Claude spend this month, which the cap reads; a reset must not refill it",
  // What the shop's assists answered (review chips, themes, the Monday read):
  // configuration-shaped, nothing seeds it.
  assist_results: "derived answers about the shop's reviews and week; a reset must not re-ask",
  // What the shop's Claude calls said, kept 30 days to debug them: it hangs
  // off `claude_usage`, which a reset keeps, and nothing seeds it.
  claude_call_content: "the shop's Claude debugging text, kept with the usage rows it hangs off",
  // When the shop last erased anyone: must outlive a reset, or a call in
  // flight across it could keep an erased diver's words.
  claude_call_content_erasures: "the shop's erasure stamp, which a reset must not forget",
  // The website setup's proposals: the shop's own site read once, not schedule.
  website_setup_drafts: "the shop's website reading, which a schedule reset does not touch",
  // Crew news waiting to be told (ADR 20261009-crew-hear-about-their-boats):
  // it hangs off a departure, so the reset's trip delete clears it.
  crew_notices: "ON DELETE CASCADE from trips clears it",
  // "Working it anyway" (issue #2678) hangs off a departure's crew.
  crew_away_acknowledgements: "ON DELETE CASCADE from trips clears it",
  trip_desk_events: "ON DELETE CASCADE from trips clears it",
  trip_read_marks: "ON DELETE CASCADE from trips clears it",
  offline_manifest_snapshot_revisions: "ON DELETE CASCADE from trips clears it",
  today_read_mark_events: "ON DELETE CASCADE from marks or desk events clears it",
  date_request_offer_bookings: "ON DELETE CASCADE from its interest or booking clears it",
  trip_schedule_days: "ON DELETE CASCADE from trips clears it",
  // What the bench said to customers and the orders it raised (ADR
  // 20261008-work-order-follow-up). All three hang off a ticket or a customer's
  // piece by ON DELETE CASCADE, and the reset clears those before orders.
  customer_gear_notices: "ON DELETE CASCADE from work orders and customer gear clears it",
  customer_gear_reminder_settings: "ON DELETE CASCADE from customer gear clears it",
  work_order_bills: "ON DELETE CASCADE from work orders clears it",
  // People in an incident report hang off incident_reports by ON DELETE CASCADE.
  // A raised report points at its subject's row, so incidentReports is deleted first.
  incident_report_people: "ON DELETE CASCADE from incident_reports clears it",
  shop_milestones:
    "DiveDay's own activation bookkeeping, written only for real shops (never a demo), so a schedule reset has none to clear",
};

/**
 * Tables the reset clears **by person id**, not shop-wide, because the stable
 * half seeded rows for the permanent staff and never re-seeds them — emptying
 * the table outright would take the seeded rows out for good. Only a person the
 * purge is about to delete needs their rows to go with them.
 *
 * Listed separately from `RESET_KEEPS` because the recorder below sees only
 * *which* table was deleted from, never the `where` clause: calling these
 * "kept" would be a lie, and calling them "cleared" would suggest the table is
 * emptied. Each must still appear in the path, so removing the person-scoped
 * delete fails here too.
 */
const RESET_PERSON_SCOPED: Record<string, string> = {
  staff_shifts: "seeded once with the permanent staff; a purged person’s shifts go with them",
  calendar_feeds: "a stable staffer's subscription must survive a schedule reset",
  account_sessions:
    "a purged person’s session goes with their login; stable staff sessions survive",
  processor_erasure_obligations: "names the erased person and whoever discharged it",
};

/**
 * Shop-scoped tables `deleteDemoShopCascade` deliberately leaves standing.
 * Almost nothing qualifies: this deletes the shop and everything it owns, so a
 * survivor here is a bug unless it is genuinely shared.
 */
const CASCADE_KEEPS: Record<string, string> = {
  certification_junior_reviews: "ON DELETE CASCADE from certifications clears it",
  staff_credential_history: "ON DELETE CASCADE from staff credentials clears it",
  platform_backup_progress: "ON DELETE CASCADE from shops clears its scheduler checkpoint",
  booking_payment_events: "ON DELETE CASCADE from bookings clears it",
  push_subscriptions: "ON DELETE CASCADE from trips clears it",
  integration_sync_records: "ON DELETE CASCADE from shops clears it",
  weekly_digest_sends: "ON DELETE CASCADE from shops and people clears it",
  claude_usage: "ON DELETE CASCADE from shops clears it",
  claude_call_content: "ON DELETE CASCADE from shops and claude_usage clears it",
  claude_call_content_erasures: "ON DELETE CASCADE from shops clears it",
  date_request_offer_bookings: "ON DELETE CASCADE from its interest or booking clears it",
  email_bounces: "ON DELETE CASCADE from shops clears it",
  assist_results: "ON DELETE CASCADE from shops clears it",
  website_setup_drafts: "ON DELETE CASCADE from shops clears it",
  crew_notices: "ON DELETE CASCADE from shops, people and trips clears it",
  crew_away_acknowledgements: "ON DELETE CASCADE from shops, people and trips clears it",
  trip_desk_events: "ON DELETE CASCADE from trips clears it",
  trip_read_marks: "ON DELETE CASCADE from trips clears it",
  offline_manifest_snapshot_revisions: "ON DELETE CASCADE from trips clears it",
  today_read_marks: "ON DELETE CASCADE from shops or staff clears it",
  today_read_mark_events: "ON DELETE CASCADE from marks or desk events clears it",
  trip_schedule_days: "ON DELETE CASCADE from trips clears it",
  incident_report_people: "ON DELETE CASCADE from incident_reports clears it",
  shop_milestones: "ON DELETE CASCADE from shops clears it",
  customer_gear_notices: "ON DELETE CASCADE from work orders and customer gear clears it",
  customer_gear_reminder_settings: "ON DELETE CASCADE from customer gear clears it",
  shop_setup_links:
    "ON DELETE SET NULL from shops clears its spent_by_shop_id; the row is the set-up request's, and goes with it",
};

describe("shop-scoped delete-path coverage", () => {
  it("enumerates enough tables to be worth asserting on", () => {
    expect(shopScopedTableNames().length).toBeGreaterThan(30);
  });

  it("has a written reason for every table the foreign-key closure cannot reach", () => {
    const scoped = new Set(shopScopedTableNames());
    expect(
      allTableNames()
        .filter((name) => !scoped.has(name))
        .sort(),
    ).toEqual(Object.keys(UNSCOPED_REASONS).sort());
  });

  it("deletes or deliberately keeps every shop-scoped table in resetDemoSchedule", async () => {
    const db = await seededTestDb();
    const [shop] = await db.select().from(shops).where(eq(shops.slug, "blue-mantis")).limit(1);
    if (!shop) throw new Error("test setup: the canonical demo shop is missing");
    const [purgedPerson] = await db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Delete Path Session",
        email: "delete-path-session@example.com",
      })
      .returning({ id: people.id });
    if (!purgedPerson) throw new Error("test setup: expected a non-staff demo person");
    const [purgedAccount] = await db
      .insert(userAccounts)
      .values({
        personId: purgedPerson.id,
        email: "delete-path-session@example.com",
        hashedPassword: "x",
        status: "active",
      })
      .returning({ id: userAccounts.id });
    if (!purgedAccount) throw new Error("test setup: expected a purged account");
    await db.insert(accountSessions).values({
      userAccountId: purgedAccount.id,
      personId: purgedPerson.id,
      shopId: shop.id,
      shopSlug: shop.slug,
      roles: [],
      name: "Delete path session",
      token: "delete-path-session",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });
    const deleted = await recordDeletedTables(db, (recorder) =>
      resetDemoSchedule(recorder, shop.id),
    );
    const undecided = shopScopedTableNames().filter(
      (name) => !deleted.has(name) && !(name in RESET_KEEPS),
    );
    expect(undecided).toEqual([]);
    // A keep-reason that names a table the path *does* delete is a stale claim
    // about the code, so it fails too…
    expect(Object.keys(RESET_KEEPS).filter((name) => deleted.has(name))).toEqual([]);
    // …and so is a person-scoped claim about a delete that is no longer there.
    expect(Object.keys(RESET_PERSON_SCOPED).filter((name) => !deleted.has(name))).toEqual([]);
  });

  it("deletes or deliberately keeps every shop-scoped table in deleteDemoShopCascade", async () => {
    const db = await seededTestDb();
    const { slug } = await createDemoShop(db);
    const [shop] = await db.select().from(shops).where(eq(shops.slug, slug)).limit(1);
    if (!shop) throw new Error("test setup: the minted demo shop is missing");
    const deleted = await recordDeletedTables(db, (recorder) =>
      deleteDemoShopCascade(recorder, shop.id),
    );
    const undecided = shopScopedTableNames().filter(
      (name) => !deleted.has(name) && !(name in CASCADE_KEEPS),
    );
    expect(undecided).toEqual([]);
    expect(Object.keys(CASCADE_KEEPS).filter((name) => deleted.has(name))).toEqual([]);
  });
});

/** Tables `RESET_KEEPS` names because a cascade from a reset-owned parent clears them. */
const RESET_CASCADES = Object.entries(RESET_KEEPS)
  .filter(([, why]) => why.startsWith("ON DELETE CASCADE"))
  .map(([name]) => name);

/** Rolls the probe's transaction back. */
const PROBE = Symbol("delete-path-coverage:probe");

/**
 * **The e2e reset replays a copy, and the copy is held to the same list.**
 *
 * The fleet's `/api/test/reset` runs `clearDemoSchedule` and then writes the
 * rows the re-seed would from a shadow taken on the server's first reset
 * (`src/db/demo-reset-snapshot.ts`). The shadow is found by difference rather
 * than listed, so these hold it to the delete path above from both sides: it
 * writes only tables the reset deletes from (or that a cascade from one
 * clears), and every table the clear half empties of seeded rows is in it. A
 * table the shadow missed would be a table every replay leaves empty; one it
 * wrote outside the list would be a table no reset owns.
 */
describe("the e2e reset's snapshot covers what the reset deletes", () => {
  it("replays every table the clear half empties, and nothing it keeps", async () => {
    const db = await seededTestDb({ history: true });
    const [shop] = await db.select().from(shops).where(eq(shops.slug, "blue-mantis")).limit(1);
    if (!shop) throw new Error("test setup: the canonical demo shop is missing");
    expect((await resetDemoFromSnapshot(db, shop.id)).mode).toBe("captured");
    const plan = capturedDemoResetPlan(db);
    if (!plan) throw new Error("expected the capture to have produced a plan");
    const replayed = plan.inserts.map((step) => step.table).sort();

    // Which tables the clear half takes seeded rows out of, read off a clear
    // that is rolled back, and which tables it deletes from at all.
    const names = shopScopedTableNames();
    const emptied: string[] = [];
    let deleted = new Set<string>();
    await db
      .transaction(async (tx) => {
        const before = await rowCounts(tx, names);
        deleted = await recordDeletedTables(tx as unknown as AppDb, (recorder) =>
          clearDemoSchedule(recorder, shop.id).then(() => undefined),
        );
        const after = await rowCounts(tx, names);
        for (const name of names) {
          if ((after.get(name) ?? 0) < (before.get(name) ?? 0)) emptied.push(name);
        }
        throw PROBE;
      })
      .catch((error: unknown) => {
        if (error !== PROBE) throw error;
      });

    expect(replayed.length).toBeGreaterThan(30);
    expect(replayed).toEqual(emptied.sort());
    expect(replayed.filter((name) => !deleted.has(name) && !RESET_CASCADES.includes(name))).toEqual(
      [],
    );
    // A kept row the re-seed changes is written back column by column; it must
    // be a table the reset keeps or deletes from, never one outside the shop.
    expect(plan.updates.map((step) => step.table).filter((name) => !names.includes(name))).toEqual(
      [],
    );
  }, 60_000);
});

async function rowCounts(db: DbExecutor, tables: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of tables) {
    const result = (await db.execute(
      sql`select count(*)::int as n from ${sql.identifier(table)}`,
    )) as unknown as { rows: { n: number }[] };
    counts.set(table, Number(result.rows[0]?.n ?? 0));
  }
  return counts;
}

/**
 * **The reset has to restore what Today reads, not only the schedule.**
 *
 * `media_deletion_attempts` used to be a deliberate `RESET_KEEPS` entry —
 * "internal reconciliation ledger, not schedule data", which is true and was
 * not the whole story. `listPendingMediaDeletions` feeds Today an
 * `urgency: "now"` row, so a stale attempt written by one test (which is what
 * `/api/test/seed-trouble-states` exists to do) left a "Recap photo" cleanup
 * card on Today for whichever spec Playwright's sharding ran next in that
 * worker. It surfaced as three visual captures — `close-out`,
 * `nav-more-menu`, `nav-more-sheet` — reporting as changed on a pull request
 * that had touched none of them, with the leaked row visible in the diff.
 *
 * The seed writes none of these, so clearing them restores exactly the seeded
 * state and loses nothing.
 */
describe("the reset and the trouble states", () => {
  it("clears a stale media deletion, so it cannot leak into the next spec", async () => {
    const db = await seededTestDb();
    const [shop] = await db.select().from(shops).limit(1);
    if (!shop) throw new Error("expected the seeded shop");
    await db.insert(mediaDeletionAttempts).values({
      shopId: shop.id,
      kind: "recap_photo",
      url: "https://example.invalid/recap/leaked.jpg",
    });
    expect(
      await db
        .select()
        .from(mediaDeletionAttempts)
        .where(eq(mediaDeletionAttempts.shopId, shop.id)),
    ).toHaveLength(1);

    await resetDemoSchedule(db, shop.id);

    expect(
      await db
        .select()
        .from(mediaDeletionAttempts)
        .where(eq(mediaDeletionAttempts.shopId, shop.id)),
    ).toHaveLength(0);
  });
});
