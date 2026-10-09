import {
  boolean,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { SHOP_MILESTONES } from "@/lib/founder-metrics";
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
 * so it follows the standing decision at the top of `src/lib/retention.ts`:
 * kept until somebody asks for it gone, never aged out on a clock. A prospect
 * asking to be forgotten is answered by deleting their row.
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
    runsBoat: boolean("runs_boat").notNull(),
    /** A `SetupCurrentSystem` code (`src/lib/setup-requests.ts`). */
    currentSystem: text("current_system").notNull(),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    source: text("source").notNull(),
    /** The language the reader filled the form in, so the first reply can match it. */
    locale: text("locale").notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("setup_requests_created_idx").on(table.createdAt)],
);

export type SetupRequest = typeof setupRequests.$inferSelect;

/**
 * **A link that opens `/onboard` for one shop, once** (ADR
 * 20261009-single-use-setup-links, replacing the standing `ONBOARD_SETUP_KEY`).
 *
 * Minted for each set-up request and sent to the founder in that request's
 * onboarding mail, so the founder can fill the form in or forward the link to
 * the shop. Hashed at rest like `account_tokens`: the raw token exists only in
 * that mail and the URL it opens. It expires (`SETUP_LINK_TTL_MS`) and is spent
 * in the same transaction that creates the shop, so a forwarded or leaked copy
 * opens nothing after the first shop.
 *
 * Platform-level like the request it hangs off: no `shop_id`, because the shop
 * does not exist when the link is minted, and the link does not need to
 * remember which shop it made. Deleted with its request, which is how a
 * requester's erasure reaches it.
 */
export const shopSetupLinks = pgTable(
  "shop_setup_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    /** The request it was minted for; its answers prefill the form. */
    setupRequestId: uuid("setup_request_id")
      .notNull()
      .references(() => setupRequests.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set in the transaction that created the shop. A spent link opens nothing. */
    spentAt: timestamp("spent_at", { withTimezone: true }),
    /**
     * The shop it opened, set in the same transaction: which request became
     * which shop. Cleared if that shop is deleted; the spend stands.
     */
    spentByShopId: uuid("spent_by_shop_id").references(() => shops.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("shop_setup_links_token_hash_unique").on(table.tokenHash),
    index("shop_setup_links_request_idx").on(table.setupRequestId),
    index("shop_setup_links_spent_by_shop_idx").on(table.spentByShopId),
  ],
);

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
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("demo_entries_entered_idx").on(table.enteredAt)],
);

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
