import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { SHOP_MILESTONES } from "@/lib/founder-metrics";
import type { SetupReceiptError, SetupReceiptStatus } from "@/lib/setup-request-receipts";
import { pricingPlan } from "./billing";
import { appNowTimestamp } from "./columns";
import { shops } from "./core";

/**
 * DiveDay's own funnel and activation bookkeeping (ADR
 * 20261007-setup-request-form, ADR 20261007-founder-metrics): set-up requests
 * from shops that do not exist yet, demo entries, and when each real shop
 * first reached each activation step. Nothing a shop reads.
 */

/**
 * **A shop asking DiveDay to set it up** — one row per submission of the
 * public form at `/get-set-up` (ADR 20261007-setup-request-form).
 *
 * Platform-level, not a tenant's: the shop it is about does not exist yet, so
 * there is no `shop_id`, and nothing a shop can open reads this table. The
 * founder reads it through the onboarding mail each row sends and the weekly
 * founder digest's count by source.
 *
 * **It holds a person's contact details** — a name, an email, maybe a phone —
 * so it follows the standing decision at the top of `src/features/records/retention/rules.ts`:
 * pruned after 365 days or deleted sooner when the requester asks. Receipt
 * metadata is co-located, so the same erasure and retention removes it.
 *
 * `source` is the funnel tag of the page whose door the reader came through,
 * already clamped to the registry by `eventSource` (`src/lib/funnel.ts`), or
 * `unknown`. `notified_at` is set when the onboarding mail left, so a row the
 * mail never reached is visible in the digest rather than silently lost.
 */
export const setupRequests = pgTable(
  "setup_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopName: text("shop_name").notNull(),
    /** Town or region, as typed. */
    region: text("region").notNull(),
    /**
     * What the shop runs, as the form's three boxes (issue #4319): boat dives,
     * shore dives, pool sessions. Any mix, none included: a training shop with
     * no boat is as welcome as a liveaboard.
     */
    runsBoat: boolean("runs_boat").notNull(),
    runsShore: boolean("runs_shore").notNull().default(false),
    runsPool: boolean("runs_pool").notNull().default(false),
    /** A `SetupCurrentSystem` code (`src/lib/setup-requests.ts`). */
    currentSystem: text("current_system").notNull(),
    /**
     * Which booking system or shop software, as a switching guide's slug
     * (`MIGRATION_GUIDE_SLUGS`), when the reader named one. Null for every
     * other answer, and for a system with no guide.
     */
    currentSystemGuide: text("current_system_guide"),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    source: text("source").notNull(),
    /** The language the reader filled the form in, so the first reply can match it. */
    locale: text("locale").notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    /** Null on historical/non-public inserts: only the public action opts in. */
    receiptStatus: text("receipt_status").$type<SetupReceiptStatus>(),
    receiptClaimedAt: timestamp("receipt_claimed_at", { withTimezone: true }),
    receiptProviderMessageId: varchar("receipt_provider_message_id", { length: 256 }),
    receiptErrorCode: text("receipt_error_code").$type<SetupReceiptError>(),
    /**
     * The pricing arm this reader was shown (ADR 20261022-pricing-ab-test),
     * read from their `dd_pricing` cookie when the request was sent. Null
     * while the test is off. The shop this request becomes is assigned it.
     */
    pricingPlan: pricingPlan("pricing_plan"),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    index("setup_requests_created_idx").on(table.createdAt),
    index("setup_requests_receipt_claimed_idx").on(table.receiptClaimedAt),
    check(
      "setup_requests_receipt_status_check",
      sql`${table.receiptStatus} in ('pending', 'claimed', 'accepted', 'failed', 'unknown', 'suppressed')`,
    ),
    check(
      "setup_requests_receipt_error_check",
      sql`${table.receiptErrorCode} in ('address_cooldown', 'global_limit', 'not_configured', 'invalid_test_recipient', 'throttled', 'rejected', 'provider_rejected', 'provider_unavailable', 'network_error', 'invalid_response', 'send_exception')`,
    ),
  ],
);

export type SetupRequest = typeof setupRequests.$inferSelect;

/**
 * **One entry into the live demo**, recorded beside the `demo_entered`
 * analytics event so the founder digest can count demo entries by source from
 * DiveDay's own database (ADR 20261007-founder-metrics).
 *
 * Deliberately not keyed to the minted demo shop: the 7-day reaper deletes
 * that shop and everything it owns, and a count that vanished with it would
 * under-read every week the reaper ran before the digest did. No personal data
 * exists to record — a demo visitor typed nothing — so a row is a funnel tag,
 * a role and an instant. Pruned on `RETENTION_DAYS.demo_entries`.
 */
export const demoEntries = pgTable(
  "demo_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** A `FunnelSource` clamped by `eventSource`, or "unknown". */
    source: text("source").notNull(),
    /** A `DemoRoleId`. */
    role: text("role").notNull(),
    enteredAt: appNowTimestamp("entered_at").notNull(),
  },
  (table) => [index("demo_entries_entered_idx").on(table.enteredAt)],
);

/**
 * **A demo shop built ahead of time for one prospect**, and what happened to
 * the link that opens it (ADR 20261116-demo-previews). The founder dresses a
 * minted demo in a shop's own name, colour and town, sends `/preview/<id>`,
 * and reads here whether anybody came.
 *
 * Three separate signals, because a mail scanner fetches every link in a
 * message and must never read as interest: `fetched_*` counts any request for
 * the page, `opened_*` a browser that ran the page and entered the shop, and
 * `active_*` real input inside the shop (the same touch that keeps a staff
 * session alive, `touchStaffSession`). Only the last one is a person.
 *
 * Keyed to the minted shop by its id with no foreign key, for
 * `demo_entries`' reason above: the demo reaper deletes that shop and
 * everything it owns, and the record of who looked must outlive it. A preview
 * whose shop is gone reads as ended.
 *
 * It holds a business's name and public website, and no person. The row id is
 * the link's capability: it opens a demo shop of seeded divers and nothing
 * else. Pruned on `RETENTION_DAYS.demo_previews`.
 */
export const demoPreviews = pgTable(
  "demo_previews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The minted demo shop this preview opens, by its row id. Not a foreign key
     * (above), and the id rather than the slug is what every check compares: a
     * generated slug can be drawn again by a later visitor's demo once the
     * reaper has taken this one, and a link must never open that stranger's shop.
     */
    demoShopId: uuid("demo_shop_id").notNull(),
    /** That shop's slug when the preview was built, for the founder's list. */
    shopSlug: text("shop_slug").notNull(),
    /** The prospect's own name, as the preview wears it. */
    prospectName: text("prospect_name").notNull(),
    /** The public site the name and colour were read from, when there was one. */
    prospectSite: text("prospect_site"),
    createdAt: appNowTimestamp("created_at").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    fetchCount: integer("fetch_count").notNull().default(0),
    firstFetchedAt: timestamp("first_fetched_at", { withTimezone: true }),
    openCount: integer("open_count").notNull().default(0),
    firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    activeCount: integer("active_count").notNull().default(0),
    firstActiveAt: timestamp("first_active_at", { withTimezone: true }),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("demo_previews_demo_shop_key").on(table.demoShopId),
    index("demo_previews_created_idx").on(table.createdAt),
    check(
      "demo_previews_counts_check",
      sql`${table.fetchCount} >= 0 and ${table.openCount} >= 0 and ${table.activeCount} >= 0`,
    ),
  ],
);

export type DemoPreview = typeof demoPreviews.$inferSelect;

export const shopMilestone = pgEnum("shop_milestone", SHOP_MILESTONES);

/**
 * **When a shop first reached each step of its activation path**
 * (`src/lib/founder-metrics.ts`, ADR 20261007-founder-metrics). One row per
 * shop per milestone, written once and never moved: the nightly founder-metrics
 * run fills the ones it can read off the shop's own rows (created, first
 * departure, first signed waiver, first roll call), and the public booking
 * action writes `first_public_booking`, the one step nothing else on file
 * distinguishes from a staff-seated booking.
 *
 * `stall_alerted_at` records that the founder was told the shop stopped after
 * this step, so each stall is reported once.
 *
 * DiveDay's own bookkeeping about a shop rather than a shop record: no person,
 * no diver, nothing a shop reads.
 */
export const shopMilestones = pgTable(
  "shop_milestones",
  {
    // Cascades: DiveDay's bookkeeping about a shop has no reason to outlive it.
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    milestone: shopMilestone("milestone").notNull(),
    reachedAt: timestamp("reached_at", { withTimezone: true }).notNull(),
    stallAlertedAt: timestamp("stall_alerted_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.shopId, table.milestone] })],
);
