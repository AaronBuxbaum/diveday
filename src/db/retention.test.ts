import { readFileSync } from "node:fs";
import { eq, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { RETENTION_DAYS, UNBOUNDED_BY_DECISION } from "@/lib/retention";
import { seededShopContext } from "@/test/db";
import { createGiftBooking } from "./bookings";
import { setBookingPayment } from "./payments";
import { pruneExpiredRecords } from "./retention";
import * as schema from "./schema";
import {
  accountTokens,
  activityEvents,
  bookingGifts,
  bookingPaymentEvents,
  notificationDeliveries,
  notificationDeliveryAttempts,
  people,
  personShelfTokens,
  stripeWebhookEvents,
  tripDeskEvents,
  tripReadMarks,
  userAccounts,
} from "./schema";
import { getTripRoster, upcomingTripsWithCounts, updateTrip } from "./trips";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-03T00:00:00.000Z");

/** `days` before {@link NOW}. */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

async function retentionContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [entry] = await getTripRoster(db, shop.id, reef.id);
  if (!entry) throw new Error("demo booking missing");
  const [owner] = await db.select().from(userAccounts).limit(1);
  return { db, shop, reef, entry, owner };
}

function outcomeFor(summary: Awaited<ReturnType<typeof pruneExpiredRecords>>, table: string) {
  const outcome = summary.outcomes.find((row) => row.table === table);
  if (!outcome) throw new Error(`no prune outcome for ${table}`);
  return outcome;
}

describe("pruneExpiredRecords", () => {
  it("deletes stripe webhook events past the window and keeps everything inside it", async () => {
    const { db } = await retentionContext();
    const window = RETENTION_DAYS.stripe_webhook_events;
    await db.insert(stripeWebhookEvents).values([
      {
        id: "evt_ancient",
        type: "account.updated",
        account: "acct_1",
        occurredAt: daysAgo(window + 1),
      },
      // One day inside the window: kept. This is the row whose `occurred_at`
      // `hasNewerAccountUpdate` still needs as chronological evidence.
      {
        id: "evt_recent",
        type: "account.updated",
        account: "acct_1",
        occurredAt: daysAgo(window - 1),
      },
    ]);

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "stripe_webhook_events").deleted).toBe(1);

    const remaining = await db.select({ id: stripeWebhookEvents.id }).from(stripeWebhookEvents);
    expect(remaining.map((row) => row.id)).toEqual(["evt_recent"]);
  });

  it("never prunes a webhook event inside Stripe's own retry window", async () => {
    const { db } = await retentionContext();
    // A failed delivery from three days ago whose claim was released: Stripe is
    // still retrying it, and its row is the evidence a *newer* account.updated
    // is compared against. Pruning it is the fail-open the review named.
    await db.insert(stripeWebhookEvents).values({
      id: "evt_retrying",
      type: "account.updated",
      account: "acct_1",
      occurredAt: daysAgo(3),
      claimedAt: null,
    });
    await pruneExpiredRecords(db, { now: NOW });
    const [row] = await db
      .select()
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.id, "evt_retrying"));
    expect(row).toBeDefined();
  });

  it("prunes notification attempts and activity events on their own windows", async () => {
    const { db, shop, reef, entry } = await retentionContext();
    const attemptsWindow = RETENTION_DAYS.notification_delivery_attempts;
    const seededAttempts = await db
      .select({ id: notificationDeliveryAttempts.id })
      .from(notificationDeliveryAttempts);
    await db.insert(notificationDeliveryAttempts).values([
      {
        shopId: shop.id,
        bookingId: entry.booking.id,
        kind: "booking_confirmation",
        status: "sent",
        attemptedAt: daysAgo(attemptsWindow + 1),
      },
      {
        shopId: shop.id,
        bookingId: entry.booking.id,
        kind: "booking_confirmation",
        status: "sent",
        attemptedAt: daysAgo(attemptsWindow - 1),
      },
    ]);

    const deliveryWindow = RETENTION_DAYS.notification_deliveries;
    const insertedDeliveries = await db
      .insert(notificationDeliveries)
      .values([
        {
          shopId: shop.id,
          bookingId: entry.booking.id,
          kind: "booking_confirmation",
          status: "sent",
          attemptedAt: daysAgo(deliveryWindow + 1),
        },
        {
          shopId: shop.id,
          bookingId: entry.booking.id,
          kind: "waiver_request",
          status: "sent",
          attemptedAt: daysAgo(deliveryWindow - 1),
        },
      ])
      .returning({ id: notificationDeliveries.id });
    const ancientDelivery = insertedDeliveries[0];
    const recentDelivery = insertedDeliveries[1];
    if (!ancientDelivery || !recentDelivery) throw new Error("delivery insert failed");

    const activityWindow = RETENTION_DAYS.activity_events;
    const seededActivity = await db
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(eq(activityEvents.shopId, shop.id));
    await db.insert(activityEvents).values([
      {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: entry.booking.id,
        actorPersonId: entry.person.id,
        code: "counter_check_in",
        params: { diver: "Ancient" },
        occurredAt: daysAgo(activityWindow + 1),
      },
      {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: entry.booking.id,
        actorPersonId: entry.person.id,
        code: "counter_check_in",
        params: { diver: "Recent" },
        occurredAt: daysAgo(activityWindow - 1),
      },
    ]);

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "notification_delivery_attempts").deleted).toBe(1);
    expect(outcomeFor(summary, "notification_deliveries").deleted).toBe(1);
    expect(outcomeFor(summary, "activity_events").deleted).toBe(1);

    // The seeded attempts (all recent) plus the one recent insert; only the
    // ancient row is gone.
    const attempts = await db
      .select({ id: notificationDeliveryAttempts.id })
      .from(notificationDeliveryAttempts);
    expect(attempts).toHaveLength(seededAttempts.length + 1);
    const deliveries = await db
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries);
    expect(deliveries.map((row) => row.id)).toContain(recentDelivery.id);
    expect(deliveries.map((row) => row.id)).not.toContain(ancientDelivery.id);

    const activity = await db
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(eq(activityEvents.shopId, shop.id));
    // The seeded rows plus the one recent insert; the ancient one is gone.
    expect(activity).toHaveLength(seededActivity.length + 1);
  });

  // The one arm measured from a column that is not "when it happened". A live
  // credential is never eligible at any age; the window runs from expiry.
  it("prunes only long-expired account tokens, never a live one", async () => {
    const { db, owner } = await retentionContext();
    if (!owner) throw new Error("seeded user account missing");
    const window = RETENTION_DAYS.account_tokens;
    await db.insert(accountTokens).values([
      {
        userAccountId: owner.id,
        purpose: "password_reset",
        tokenHash: "hash-long-dead",
        expiresAt: daysAgo(window + 1),
      },
      {
        userAccountId: owner.id,
        purpose: "password_reset",
        tokenHash: "hash-recently-dead",
        expiresAt: daysAgo(window - 1),
      },
      {
        // Issued a decade ago is impossible, but "very old row, still live" is
        // the shape that must survive: eligibility is expiry, not age.
        userAccountId: owner.id,
        purpose: "email_verification",
        tokenHash: "hash-still-live",
        expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
      },
    ]);

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "account_tokens").deleted).toBe(1);
    const remaining = await db.select({ tokenHash: accountTokens.tokenHash }).from(accountTokens);
    expect(remaining.map((row) => row.tokenHash).sort()).toEqual([
      "hash-recently-dead",
      "hash-still-live",
    ]);
  });

  /**
   * The one arm measured from the **later** of two deaths, because a shelf link
   * can die twice: it runs out, or the shop revokes it (erasure does). Either
   * column alone gets one of the three rows below wrong.
   */
  it("prunes a shelf link only once both its deaths are long past", async () => {
    const { db, shop } = await retentionContext();
    const window = RETENTION_DAYS.person_shelf_tokens;
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Shelf Retention Diver" })
      .returning({ id: people.id });
    if (!diver) throw new Error("diver fixture insert failed");
    const row = (tokenHash: string, expiresAt: Date, revokedAt?: Date) => ({
      shopId: shop.id,
      personId: diver.id,
      tokenHash,
      expiresAt,
      revokedAt,
    });
    await db.insert(personShelfTokens).values([
      // Ran out long ago and was never revoked: the ordinary end of a link.
      row("shelf-long-dead", daysAgo(window + 1)),
      // Ran out, but not long enough ago — its counters are still the shop's
      // answer to "how many phones held this".
      row("shelf-recently-dead", daysAgo(window - 1)),
      // **Revoked today, but minted with a year to run.** Measuring from
      // `expires_at` alone would keep it a year past the revocation; measuring
      // from `revoked_at` alone would prune the row above, whose column is
      // null. The later of the two is the only clock that gets both right.
      row("shelf-revoked-today", daysAgo(window + 400), NOW),
      // Live: unrevoked and unexpired, however old the row is.
      row("shelf-still-live", new Date(NOW.getTime() + 60 * 60 * 1000)),
    ]);

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "person_shelf_tokens").deleted).toBe(1);
    const remaining = await db
      .select({ tokenHash: personShelfTokens.tokenHash })
      .from(personShelfTokens);
    expect(remaining.map((entry) => entry.tokenHash).sort()).toEqual([
      "shelf-recently-dead",
      "shelf-revoked-today",
      "shelf-still-live",
    ]);
  });

  it("leaves a freshly written money trail entirely alone", async () => {
    const { db, shop, entry } = await retentionContext();
    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId: entry.booking.id,
      status: "paid",
      currency: "usd",
      amountCents: 18_000,
      operation: "checkout_settled",
    });
    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "booking_payment_events").deleted).toBe(0);
    expect(await db.select().from(bookingPaymentEvents)).toHaveLength(1);
  });

  /**
   * **The giver is retired, the gift is not** (security review of the gift
   * slice, finding 5). A giver has no `people` row and never signed up for
   * anything, so their name and address age out on their own window — while
   * the row stays, because it is what explains the seat and its money on the
   * till and in an export.
   */
  it("redacts a gift's giver ninety days after the boat came home, and keeps the row", async () => {
    const { db, shop } = await retentionContext();
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const old = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
    if (!old) throw new Error("demo reef trip missing");
    const gift = await createGiftBooking(
      db,
      { actor: "public", shopId: shop.id, tripId: old.id, fullName: "Ben Carter" },
      {
        giverName: "Hannah Liu",
        giverEmail: "hannah.liu@example.com",
        receiverName: "Ben Carter",
        message: "From Hannah, for your birthday",
      },
    );
    if (!gift.ok) throw new Error(`gift booking failed: ${gift.reason}`);

    // Inside the window: the departure came home yesterday.
    await updateTrip(db, shop.id, old.id, {
      title: old.title,
      startsAt: daysAgo(2),
      endsAt: daysAgo(1),
      capacity: old.capacity,
      plannedDives: old.plannedDives,
    });
    await pruneExpiredRecords(db, { now: NOW });
    const [fresh] = await db
      .select()
      .from(bookingGifts)
      .where(eq(bookingGifts.bookingId, gift.bookingId));
    expect(fresh?.giverName).toBe("Hannah Liu");

    // Past it.
    const past = RETENTION_DAYS.booking_gifts + 1;
    await updateTrip(db, shop.id, old.id, {
      title: old.title,
      startsAt: daysAgo(past + 1),
      endsAt: daysAgo(past),
      capacity: old.capacity,
      plannedDives: old.plannedDives,
    });
    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "booking_gifts").deleted).toBe(1);

    const [retired] = await db
      .select()
      .from(bookingGifts)
      .where(eq(bookingGifts.bookingId, gift.bookingId));
    // The row survives; the identity does not, and the receiver's name — the
    // giver's own words about somebody who *is* a diver here — is left to the
    // erasure path that owns it.
    expect(retired).toBeTruthy();
    expect(retired?.giverName).not.toBe("Hannah Liu");
    expect(retired?.giverEmail).toMatch(/@invalid$/);
    expect(retired?.message).toBeNull();

    // Idempotent: a second pass finds nothing, rather than re-counting a row
    // it has already retired.
    const again = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(again, "booking_gifts").deleted).toBe(0);
  });

  it("is idempotent: a second pass with nothing eligible deletes nothing", async () => {
    const { db } = await retentionContext();
    await db.insert(stripeWebhookEvents).values({
      id: "evt_ancient",
      type: "invoice.paid",
      account: null,
      occurredAt: daysAgo(RETENTION_DAYS.stripe_webhook_events + 5),
    });
    const first = await pruneExpiredRecords(db, { now: NOW });
    const second = await pruneExpiredRecords(db, { now: NOW });
    expect(first.totalDeleted).toBe(1);
    expect(second.totalDeleted).toBe(0);
    expect(second.failedTables).toEqual([]);
  });

  it("prunes a stale shift handoff and leaves this morning's alone", async () => {
    // The catch-up strip's own window (issues #1202, #1187). Thirty days is the
    // difference between a same-day handoff and the replayable surveillance
    // feed the boundary refuses, so the prune is what enforces the boundary.
    const { db, shop, reef, entry } = await retentionContext();
    const window = RETENTION_DAYS.trip_desk_events;
    await db.insert(tripDeskEvents).values([
      {
        shopId: shop.id,
        tripId: reef.id,
        kind: "arrival",
        bookingId: entry.booking.id,
        subjectPersonId: entry.person.id,
        occurredAt: daysAgo(window + 1),
      },
      {
        shopId: shop.id,
        tripId: reef.id,
        kind: "gear_changed",
        bookingId: entry.booking.id,
        subjectPersonId: entry.person.id,
        occurredAt: daysAgo(1),
      },
    ]);
    await db.insert(tripReadMarks).values({
      shopId: shop.id,
      tripId: reef.id,
      personId: entry.person.id,
      lastSeenSeq: 0,
      lastSeenAt: daysAgo(RETENTION_DAYS.trip_read_marks + 1),
    });

    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(outcomeFor(summary, "trip_desk_events").deleted).toBe(1);
    expect(outcomeFor(summary, "trip_read_marks").deleted).toBe(1);
    const left = await db.select({ kind: tripDeskEvents.kind }).from(tripDeskEvents);
    expect(left).toEqual([{ kind: "gear_changed" }]);
    expect(await db.select().from(tripReadMarks)).toHaveLength(0);
  });

  it("reports a per-table outcome for every retained table, with the window applied", async () => {
    const { db } = await retentionContext();
    const summary = await pruneExpiredRecords(db, { now: NOW });
    expect(summary.outcomes.map((row) => row.table).sort()).toEqual(
      Object.keys(RETENTION_DAYS).sort(),
    );
    for (const outcome of summary.outcomes) {
      expect(outcome.retentionDays).toBe(RETENTION_DAYS[outcome.table]);
      expect(outcome.failed).toBe(false);
      expect(outcome.capped).toBe(false);
    }
  });
});

/**
 * Every table in the schema, by its database name.
 *
 * `getTableName` throws on everything the schema module exports that is not a
 * table — the enums and the views — which is how they are skipped, the same
 * way `export.test.ts` and `erasure-coverage.test.ts` skip them.
 */
function schemaTableNames(): string[] {
  return Object.values(schema)
    .map((value) => {
      try {
        return getTableName(value as Parameters<typeof getTableName>[0]);
      } catch {
        return null;
      }
    })
    .filter((name): name is string => typeof name === "string");
}

/**
 * Tables retention does not govern — and a list that has to be edited by hand
 * for every table added to the schema, which is the price of the guard below.
 *
 * Retention's subject is the operational trail: rows DiveDay writes about its
 * own working, whose count follows the calendar and the traffic rather than
 * anything a shop would recognise as its own records. Everything named here is
 * outside that subject. A name here is **not** a claim that the table is
 * small; it is a claim that a clock is the wrong instrument for it, because
 * what removes a row is a delete, an erasure request, or the work the row
 * exists to track finishing.
 *
 * So a new append-only trail does not belong here. It belongs in
 * `RETENTION_DAYS` with a window, or in `UNBOUNDED_BY_DECISION` with a
 * paragraph saying who decided and when — and if which of those two is right
 * is not yet known, that is the question this guard exists to raise rather
 * than a reason to add a name below.
 */
const OUTSIDE_RETENTION: readonly string[] = [
  // The shop's own catalogue and configuration: what a shop sets up, edits,
  // and deletes when it stops being true. Nothing here ages.
  "shops",
  "boats",
  "trip_lenses",
  "courses",
  "dive_sites",
  "dive_site_creatures",
  "dive_site_moments",
  "waiver_templates",
  "shop_promo_codes",
  "dive_packages",
  "pre_departure_checklist_items",
  "trip_requirements",
  "gear_items",
  "trip_series",
  "trip_series_skips",
  "trip_schedule_days",
  // DiveDay's own shared catalogue, and a shop asking for an addition to it.
  // Vendor-side content rather than a shop's records, and pruning a species
  // would break the shops whose copies point at it.
  "global_dive_sites",
  "global_dive_site_versions",
  "marine_life_requests",
  // People, and what a shop knows about one. The standing decision at the top
  // of src/lib/retention.ts is that this data is kept until somebody asks for
  // it gone: the erasure path is the requested one (`src/db/anonymize.ts`),
  // never a dormancy timer.
  "people",
  "person_roles",
  "certifications",
  "specialty_certifications",
  "nitrox_certifications",
  "rental_fit_profiles",
  "dive_support_needs",
  "prior_visits",
  "prior_gear_assignments",
  "imported_payment_history",
  "last_minute_list_entries",
  "course_inquiries",
  "internal_notes",
  "staff_credentials",
  "staff_shifts",
  "crew_availability_blocks",
  "crew_assignment_requests",
  // Departures and what happened on one. Several of these are append-only —
  // a departure's change history, a close-out's per-leftover choices, a
  // review's publish/hide trail — and they are still outside retention's
  // subject, because each is read as part of a record the shop still has. A
  // window would leave that record with a hole rather than free anything, and
  // the count follows the shop's own departures rather than the calendar.
  "trips",
  "trip_dives",
  "trip_change_events",
  "executed_dives",
  "trip_sightings",
  "season_events",
  "trip_assignments",
  "trip_help_requests",
  "trip_waitlist_entries",
  "trip_invitations",
  "trip_last_minute_promos",
  "trip_last_minute_promo_recipients",
  "trip_blowouts",
  "trip_blowout_divers",
  "buddy_pair_members",
  "pre_departure_check_events",
  "gear_reservations",
  "recap_photos",
  "trip_recap_photos",
  "trip_reviews",
  "review_moderation_events",
  "recap_pulses",
  // A row per close, normally one per shop per day, plus the choices made
  // while reviewing it: growth is bounded by the ritual, which is the argument
  // `day_closeouts`' own docblock makes. Adding a window anyway is HD-11's
  // call, not an agent's.
  "day_closeouts",
  "closeout_leftover_decisions",
  // Waivers. H-02's question about these is whether signed evidence may be
  // erased at all — the opposite end of the same question from a window, and
  // never an argument for expiring one on a clock.
  "waiver_records",
  "waiver_materiality_decisions",
  "waiver_deliveries",
  // Seats and money: the shop's own books. `booking_payment_events` is the one
  // trail among these and it has a window (7 years); the rows here are the
  // seats, orders and tips that trail is about.
  "bookings",
  "booking_payments",
  "booking_referrals",
  "booking_checkouts",
  "booking_checkout_bookings",
  "orders",
  "order_line_items",
  "tips",
  "dive_package_entitlements",
  "shop_promo_redemptions",
  // Credentials that live and die with the thing they open: revoked, spent, or
  // deleted with their parent. The token tables that are *not* here
  // (`account_tokens`, `person_shelf_tokens`,
  // `shop_contact_email_confirmation_tokens`, `integration_oauth_states`) are
  // the ones whose already-dead rows are kept on purpose for an incident
  // review — which is what a window is for, and why they have one.
  "user_accounts",
  "account_sessions",
  "account_security",
  "account_step_ups",
  "auth_provider_accounts",
  "auth_verifications",
  "booking_capabilities",
  "calendar_feeds",
  "display_tokens",
  "last_minute_list_unsubscribe_tokens",
  "person_courtesy_email_unsubscribe_tokens",
  // Current state about DiveDay's own machinery: one row per object, replaced
  // in place rather than appended, so there is no history here to age out.
  // `shop_print_runs`' docblock makes the point in the other direction — a
  // print register that answered "when did we last print this" from a trail
  // would be a table wanting a window.
  "notification_rate_limit_state",
  "integration_sync_records",
  "shop_integrations",
  "shop_stripe_accounts",
  "shop_whatsapp_accounts",
  "shop_backup_destinations",
  "shop_backup_deliveries",
  "shop_print_runs",
  // Queues that empty themselves. Both are argued in src/lib/retention.ts or
  // in their own docblock: a finished send clears its payload and every
  // handle, and a held send is deleted by whichever claimant reaches it first.
  "notification_send_queue",
  "held_sends",
  // An obligation, deleted when it is discharged. A window here would delete
  // exactly the rows that still owe something — the local blob whose provider
  // delete never landed, the Stripe side effect whose response was lost, the
  // erased diver a processor still holds — which is the opposite of what it
  // would be for.
  "media_deletion_attempts",
  "payment_operation_intents",
  "processor_erasure_obligations",
  // Bounded by a table that *is* pruned: an integration delivery is a child of
  // `integration_events` with ON DELETE CASCADE, so its rows leave when that
  // 400-day window takes the event they belong to.
  "integration_deliveries",
];

/** What the guard's failure says, so a session reads the rule and not the list. */
const UNCLASSIFIED_HELP =
  "a table in src/db/schema.ts that retention classifies as nothing. Give it a window " +
  "in RETENTION_DAYS if it is a trail that should be pruned; add it to " +
  "UNBOUNDED_BY_DECISION *and write the paragraph in src/lib/retention.ts saying who " +
  "decided it is kept forever and when*, the way gear_service_events and " +
  "trip_stage_events do; or add it to OUTSIDE_RETENTION if a clock is the wrong " +
  "instrument for it at all. Adding a bare name to whichever list makes this test go " +
  "green is the one wrong answer";

/**
 * The three classifications, checked against the names a schema actually has.
 *
 * Takes the table names rather than reading the schema, so the failure paths
 * below can hand it a schema that has grown a table or lost one.
 */
function classifyTables(tableNames: readonly string[]) {
  const declared = [...Object.keys(RETENTION_DAYS), ...UNBOUNDED_BY_DECISION, ...OUTSIDE_RETENTION];
  const declaredSet = new Set(declared);
  const present = new Set(tableNames);
  return {
    /** Tables no list classifies: the new-table case this guard exists for. */
    unclassified: tableNames.filter((name) => !declaredSet.has(name)),
    /** Names the schema no longer has: the rename that orphans a window. */
    orphaned: declared.filter((name) => !present.has(name)),
    /** A name in two lists at once, which is two answers to one question. */
    contradictory: declared.filter((name, index) => declared.indexOf(name) !== index),
  };
}

/**
 * Names in `UNBOUNDED_BY_DECISION` that the retention docblock does not argue.
 *
 * "Deliberate" is the whole value of that list, so the cheapest half of it is
 * checked mechanically: the file's leading docblock must carry a paragraph
 * naming the table, and that paragraph must cite the decision — a date, an ADR
 * id, or an issue number. Whether the argument is any good is a reviewer's
 * call; that somebody wrote one is a test's.
 */
function unarguedUnboundedTables(source: string, names: readonly string[]): string[] {
  const docblock = source.slice(0, source.indexOf("*/"));
  // Unwrapped before matching: a paragraph that says "ADR\n * 20260804-…"
  // cites its decision exactly as well as one that fits the id on a line, and
  // a guard that disagreed would be a guard against re-wrapping a comment.
  const paragraphs = docblock
    .split(/\n \*\n/)
    .map((text) => text.replace(/^\s*\*[ \t]?/gm, "").replace(/\s+/g, " "));
  const cites = /\d{4}-\d{2}-\d{2}|ADR \d{8}-|#\d+/;
  return names.filter(
    (name) => !paragraphs.some((text) => text.includes(name) && cites.test(text)),
  );
}

describe("retention classification", () => {
  it("forces every schema table to be pruned, unbounded on purpose, or out of scope", () => {
    const tableNames = schemaTableNames();
    // A floor, not a census: an enumeration that silently stopped finding
    // tables would leave `unclassified` empty and read green. The same reason
    // export.test.ts carries this line, and the same reason it is a low number
    // — the reverse assertion below is what actually notices a table leaving.
    expect(tableNames.length).toBeGreaterThan(20);

    const { unclassified, orphaned, contradictory } = classifyTables(tableNames);
    expect(unclassified, UNCLASSIFIED_HELP).toEqual([]);
    // The half most likely to be skipped, and the one that catches a rename
    // leaving a window pointed at a table that no longer exists.
    expect(orphaned, "a retention list names a table the schema does not have").toEqual([]);
    expect(contradictory, "a table is classified twice, which is two answers").toEqual([]);
  });

  it("refuses a new table that nobody classified", () => {
    const { unclassified, orphaned } = classifyTables([...schemaTableNames(), "diver_mood_events"]);
    expect(unclassified).toEqual(["diver_mood_events"]);
    expect(orphaned).toEqual([]);
  });

  it("refuses a rename that orphans a window", () => {
    const renamed = schemaTableNames().filter((name) => name !== "activity_events");
    expect(classifyTables(renamed).orphaned).toEqual(["activity_events"]);
  });

  it("holds every deliberately unbounded trail to a paragraph that cites its decision", () => {
    const source = readFileSync("src/lib/retention.ts", "utf8");
    expect(
      unarguedUnboundedTables(source, UNBOUNDED_BY_DECISION),
      "a table is unbounded by decision with no paragraph in src/lib/retention.ts saying " +
        "who decided and when",
    ).toEqual([]);
  });

  it("refuses an unbounded trail whose paragraph is missing or cites nothing", () => {
    const source = [
      "/**",
      " * **`argued_events` is deliberately unbounded.** Chosen by the product owner,",
      " * 2026-09-10, over a 30-day window.",
      " *",
      " * **`asserted_events` is deliberately unbounded.** Because it is.",
      " */",
      "export const UNBOUNDED_BY_DECISION = [];",
    ].join("\n");
    expect(
      unarguedUnboundedTables(source, ["argued_events", "asserted_events", "absent_events"]),
    ).toEqual(["asserted_events", "absent_events"]);
  });
});
