import { eq, getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededTestDb } from "@/test/db";
import type { AppDb, DbExecutor } from "./client";
import * as schema from "./schema";
import { accountSessions, mediaDeletionAttempts, people, shops, userAccounts } from "./schema";
import { createDemoShop, deleteDemoShopCascade, resetDemoSchedule } from "./seed";

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
 * Two limits, stated rather than papered over:
 *
 * - Tables with **no** `shop_id` (`trip_assignments`, `person_roles`,
 *   `user_accounts`, `account_tokens`, `course_path_steps`) are out of scope
 *   here. They are reached through a parent's id list, and there is no shop
 *   column to enumerate them by. `reap-demos.test.ts` keeps its hand-written
 *   cases for those.
 * - This proves a table is *named*, not that it is named in the right *order*.
 *   Ordering is what the FK violations in `reap-demos.test.ts` prove, and both
 *   guards are needed: this one says "you did not forget", that one says "you
 *   did not put it in the wrong place".
 */

/** Every table in the schema that carries a `shop_id` column. */
function shopScopedTableNames(): string[] {
  const names: string[] = [];
  for (const value of Object.values(schema)) {
    let name: string;
    try {
      name = getTableName(value as Parameters<typeof getTableName>[0]);
    } catch {
      continue;
    }
    // `getTableName` also succeeds on enums and views, which have no columns.
    let columns: Record<string, { name: string }>;
    try {
      columns = getTableColumns(value as Parameters<typeof getTableColumns>[0]);
    } catch {
      continue;
    }
    if (!columns) continue;
    if (Object.values(columns).some((column) => column.name === "shop_id")) names.push(name);
  }
  return names;
}

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
  const recorder = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "delete") {
        return (table: Parameters<AppDb["delete"]>[0]) => {
          deleted.add(getTableName(table));
          return target.delete(table);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as DbExecutor;
  await work(recorder);
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
  shops: "the shop itself survives a schedule reset — that is the whole point",
  // Operational and provider plumbing a reset has no seeded state to restore
  // and no visitor path that writes one.
  notification_rate_limit_state: "provider coordination state, not shop records",
  stripe_webhook_events: "provider delivery ledger, pruned by retention, not by a reset",
  shop_whatsapp_accounts: "shop settings, outside the resettable schedule",
  shop_contact_email_confirmation_tokens:
    "the front-desk address's own proof of ownership (issue #1288) — settings, not schedule",
  boats: "shop settings, outside the resettable schedule",
  trip_lenses:
    "the shop's own words for a kind of day — vocabulary is settings, not schedule, and the reset rebuilds the board rather than the words",
  dive_packages: "the shop's own price list of packages — settings, not schedule",
  pre_departure_checklist_items: "the shop's own checklist lines — settings, not schedule",
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
  trip_desk_events: "ON DELETE CASCADE from trips clears it",
  trip_read_marks: "ON DELETE CASCADE from trips clears it",
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
  staff_shifts: "seeded once with the permanent staff; a purged person's shifts go with them",
  calendar_feeds: "a stable staffer's subscription must survive a schedule reset",
  account_sessions:
    "a purged person's session goes with their login; stable staff sessions survive",
  processor_erasure_obligations: "names the erased person and whoever discharged it",
};

/**
 * Shop-scoped tables `deleteDemoShopCascade` deliberately leaves standing.
 * Almost nothing qualifies: this deletes the shop and everything it owns, so a
 * survivor here is a bug unless it is genuinely shared.
 */
const CASCADE_KEEPS: Record<string, string> = {
  booking_payment_events: "ON DELETE CASCADE from bookings clears it",
  push_subscriptions: "ON DELETE CASCADE from trips clears it",
  integration_sync_records: "ON DELETE CASCADE from shops clears it",
  trip_desk_events: "ON DELETE CASCADE from trips clears it",
  trip_read_marks: "ON DELETE CASCADE from trips clears it",
};

describe("shop-scoped delete-path coverage", () => {
  it("enumerates enough tables to be worth asserting on", () => {
    expect(shopScopedTableNames().length).toBeGreaterThan(30);
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
