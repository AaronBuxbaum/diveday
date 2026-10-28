import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS } from "@/lib/fly-safe";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { countSpendableDives, createDivePackage, grantPackageEntitlements } from "./dive-packages";
import { peopleWhoDivedBefore } from "./executed-dives";
import { loadShopExportBundleInput, loadShopExportCounts } from "./export";
import { sendNotification } from "./notifications";
import { clearFinishedRehearsals, notificationHeldForRehearsal } from "./rehearsals";
import { getMonthlyReport } from "./reporting";
import {
  bookings,
  divePackageEntitlements,
  executedDives,
  gearItems,
  gearReservations,
  orders,
  people,
  personRoles,
  rollCallEvents,
  shops,
  trips,
} from "./schema";
import { upsertShopStripeAccount } from "./stripe-accounts";
import { createTrip, pagedUpcomingTripsWithCounts, updateTrip } from "./trips";
import { tripExistsForShop } from "./trips-record";

/**
 * **Every place that must honour a rehearsal, walked** (ADR
 * 20261012-rehearsal-departures). A rehearsal never sends a message, never
 * appears in public, never counts in reports, exports, availability or
 * integrations, and never charges money. This file is the ADR's list, kept
 * true in four ways:
 *
 * 1. **Outward reads.** Every read of `trips` in a module whose answer leaves
 *    the shop's staff screens — the reports, the public site's reads, the
 *    staff calendar feed — carries `notRehearsal()`, or says why not with
 *    `diveday:allow-rehearsal: <why>` inside the query.
 * 2. **Gates.** Each chokepoint still holds the line that makes it one.
 * 3. **Senders.** Every file that can hand a message to a provider is named
 *    here with the reason a rehearsal's message never leaves through it. A new
 *    sender fails this file until someone says which.
 * 4. **Behaviour.** A real rehearsal with a real seat, read back through the
 *    doors that matter.
 */

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** Modules whose answers leave the staff screens. */
const OUTWARD_MODULES = [
  // Reports and the numbers DiveDay itself reads.
  "src/db/reporting.ts",
  "src/db/report-lines.ts",
  "src/db/founder-metrics.ts",
  "src/db/weekly-digest.ts",
  "src/db/season-scale.ts",
  // The public site.
  "src/db/dive-sites.ts",
  "src/db/trip-sightings.ts",
  "src/db/month-sightings.ts",
  // The staff calendar feed, which leaves for someone's phone calendar.
  "src/features/calendar-sync/feed-trips.ts",
] as const;

const ANCHOR = /\.from\(trips\)|\.(?:inner|left)Join\(\s*trips\b/;
const ALLOW = "diveday:allow-rehearsal:";

/**
 * Named predicates that carry the filter for a whole function's reads, so each
 * query need not repeat it: the month report's `inWindow`. Every definition of
 * one in the file must itself contain `notRehearsal()`.
 */
const CARRIERS: Record<string, readonly string[]> = {
  "src/db/reporting.ts": ["inWindow"],
};

/** Definitions of `name` in `source` (`const name = and(` … `);`) that leave rehearsals in. */
function carriersWithoutFilter(source: string, name: string): number[] {
  const lines = source.split("\n");
  return lines.flatMap((line, index) => {
    if (!line.includes(`const ${name} = and(`)) return [];
    const end = lines.findIndex((next, at) => at > index && /^\s*\);/.test(next));
    return lines
      .slice(index, end + 1)
      .join("\n")
      .includes("notRehearsal()")
      ? []
      : [index + 1];
  });
}

/** Reads of `trips` in `source` that carry neither the filter nor a reason. */
function unguardedRehearsalReads(source: string, carriers: readonly string[] = []): number[] {
  const lines = source.split("\n");
  const anchors = lines.flatMap((line, index) => (ANCHOR.test(line) ? [index] : []));
  return anchors.flatMap((index, position) => {
    // From a few lines above (a reason written over the join) to the next
    // anchor, so one query is never covered by its neighbour's filter.
    const end = Math.min(index + 60, anchors[position + 1] ?? lines.length);
    const window = lines.slice(Math.max(0, index - 3), end).join("\n");
    const carried = carriers.some((name) => new RegExp(`\\b${name}\\b`).test(window));
    return window.includes("notRehearsal()") || window.includes(ALLOW) || carried
      ? []
      : [index + 1];
  });
}

/** Chokepoints, and the line in each that makes it one. */
const GATES: { file: string; holds: string; times?: number; why: string }[] = [
  {
    file: "src/db/schema/trips.ts",
    holds: "trips_rehearsal_is_private",
    why: "a rehearsal is private by constraint, so every public listing that hides private departures hides it",
  },
  {
    file: "src/db/trips-create.ts",
    holds: "input.isRehearsal",
    why: "created private, unpriced and outside any series",
  },
  {
    file: "src/db/trips-record.ts",
    holds: "unlessRehearsal(",
    why: "an edit can never price a rehearsal or make it public",
  },
  {
    file: "src/db/trips-record.ts",
    holds: "liveTrip(), notRehearsal()",
    why: "`tripExistsForShop`: the edge refuses a rehearsal's public URL",
  },
  {
    file: "src/app/s/[shopSlug]/trips/[id]/page.tsx",
    holds: "trip.isRehearsal",
    times: 2,
    why: "the public trip page and its metadata answer not-found",
  },
  {
    file: "src/app/s/[shopSlug]/trips/[id]/opengraph-image.tsx",
    holds: "trip.isRehearsal",
    why: "no link-preview card names it",
  },
  {
    file: "src/db/bookings.ts",
    holds: 'actor === "staff" || !trip.isRehearsal',
    why: "only staff seat anyone on a rehearsal",
  },
  {
    file: "src/db/bookings.ts",
    holds: "input.trip.isRehearsal",
    why: "`settlePackageCoverage`: a rehearsal seat spends no prepaid dive",
  },
  {
    file: "src/app/s/[shopSlug]/trips/[id]/calendar/route.ts",
    holds: "trip.isRehearsal",
    why: "no calendar file for a departure with no public URL",
  },
  {
    file: "src/app/s/[shopSlug]/trips/[id]/arrival-card/route.ts",
    holds: "trip.isRehearsal",
    why: "no arrival card, even under a live seat token",
  },
  {
    file: "src/db/interests.ts",
    holds: "liveTrip(), notRehearsal()",
    times: 3,
    why: "no wait list: a departure interest is only written for a departure that is not a rehearsal",
  },
  {
    file: "src/db/checkouts.ts",
    holds: "tripRow.trip.isRehearsal",
    why: "no card checkout",
  },
  {
    file: "src/db/orders.ts",
    holds: "notRehearsal()",
    why: "no invoice",
  },
  {
    file: "src/db/integration-events.ts",
    holds: "isRehearsal",
    why: "no order reaches Shopify, QuickBooks or Zapier",
  },
  {
    file: "src/db/interest-offers.ts",
    holds: "!tripRow.isRehearsal",
    times: 2,
    why: "no seat offer and no last-minute deal: `offerSeats` reads the departure when the held send fires and offers nobody on a rehearsal",
  },
  {
    file: "src/db/notifications.ts",
    holds: "notificationHeldForRehearsal(",
    times: 3,
    why: "every email — the single send, the batch, the retry drain — is held",
  },
  {
    file: "src/db/waiver-issue.ts",
    holds: 'trip.isRehearsal ? "link"',
    times: 2,
    why: "a release or course-forms link is issued for hand-over, never texted or emailed",
  },
  {
    file: "src/db/reminders.ts",
    holds: "notRehearsal()",
    why: "no reminder, by email or text",
  },
  {
    file: "src/db/recap.ts",
    holds: "notRehearsal()",
    why: "no recap, by email or text",
  },
  {
    file: "src/db/crew-notices.ts",
    holds: "eq(trips.isRehearsal, true)",
    why: "crew news about a rehearsal is never written down to be told",
  },
  {
    file: "src/db/push-subscriptions.ts",
    holds: "notRehearsal()",
    times: 2,
    why: "no push subscription and no push",
  },
  {
    file: "src/db/export.ts",
    holds: "withoutRehearsals(",
    times: 2,
    why: "the shop's bundle and a diver's bundle leave it out",
  },
  {
    file: "src/db/export.ts",
    holds: "shopRehearsalIds(db, shopId)",
    why: "the settings page's counts agree with the bundle",
  },
  {
    file: "src/app/api/cron/trip-series/route.ts",
    holds: "clearFinishedRehearsals(db)",
    why: "deleted once fly-safe's look-back has run out, unless it carries evidence",
  },
];

/**
 * Every file that hands a message to a provider, and why a rehearsal's
 * message never leaves through it.
 */
const HELD_AT_CHOKEPOINT =
  "email through `sendNotification`, held by `notificationHeldForRehearsal`";
const NOT_ABOUT_A_DEPARTURE = "never about a departure";
const SENDERS: Record<string, string> = {
  "src/lib/notifications/courtesy.ts": "the SMS/WhatsApp primitive; its callers are listed here",
  "src/lib/notifications/web-push.ts": "the push primitive; its one caller is push-subscriptions",
  "src/db/notifications.ts": "the chokepoint itself",
  "src/db/push-subscriptions.ts":
    "`pushManifestChanged` reads the departure with `notRehearsal()`; `pushTripAlert`'s one caller is roll-call-alerts",
  "src/db/roll-call-alerts.ts": "the candidate scan carries `notRehearsal()`, so no email or push",
  "src/db/manifest-events.ts": "calls `pushManifestChanged`, which reads with `notRehearsal()`",
  "src/db/reminders.ts": "the candidate scan carries `notRehearsal()`, so no email or text",
  "src/db/fly-safe-correction.ts":
    "correction email passes through sendNotification and notificationHeldForRehearsal",
  "src/db/recap.ts": "the candidate scan carries `notRehearsal()`, so no email or text",
  "src/db/waiver-issue.ts": "a rehearsal's link is hand-over only, never texted or emailed",
  "src/db/crew-notices.ts": "a rehearsal's crew news is never recorded",
  "src/db/interest-offers.ts":
    "`offerSeats` offers nobody on a rehearsal, deal or not; the email is also held at the chokepoint",
  "src/db/blowouts.ts": HELD_AT_CHOKEPOINT,
  "src/db/booking-cancelled-notice.ts": HELD_AT_CHOKEPOINT,
  "src/db/booking-handoff.ts": HELD_AT_CHOKEPOINT,
  "src/db/checkout-recovery.ts": HELD_AT_CHOKEPOINT,
  "src/db/find-my-booking.ts": HELD_AT_CHOKEPOINT,
  "src/db/your-days.ts": HELD_AT_CHOKEPOINT,
  "src/db/readiness-link-rescue.ts": HELD_AT_CHOKEPOINT,
  "src/db/trip-invitations.ts": HELD_AT_CHOKEPOINT,
  "src/db/waiver-guardian-copy.ts": HELD_AT_CHOKEPOINT,
  "src/db/party-payment-receipt.ts":
    "a rehearsal starts no card checkout, so nothing settles; the email is also held at the chokepoint",
  "src/db/seat-already-held.ts": HELD_AT_CHOKEPOINT,
  "src/db/missing-diver-alerts.ts":
    "refuses a rehearsal's report itself, before any email or push; the email is also held at the chokepoint",
  "src/app/s/[shopSlug]/trips/[id]/actions.ts":
    "the public trip page, which a rehearsal never reaches",
  "src/app/s/[shopSlug]/trips/[id]/send-join-mail.ts": HELD_AT_CHOKEPOINT,
  "src/app/shop/[shopSlug]/trips/[id]/conditions-actions.ts": HELD_AT_CHOKEPOINT,
  "src/db/departure-notes.ts": "its departure read carries `notRehearsal()`, so no note goes",
  "src/db/move-ask-alerts.ts":
    "its ask read carries `notRehearsal()`, so a practice run's ask emails nobody",
  "src/db/lost-items.ts": "its tell reads the departure with `notRehearsal()`, so nobody is told",
  "src/db/trip-rescheduled.ts":
    "its hold and its send read the departure with `notRehearsal()`, so no email or text",
  "src/db/course-certified.ts":
    "its departure read carries `notRehearsal()`, so a practice run certifies nobody and tells nobody",
  "src/db/desk-pings.ts": NOT_ABOUT_A_DEPARTURE,
  "src/db/stripe-restricted.ts": NOT_ABOUT_A_DEPARTURE,
  "src/db/shore-alert-tokens.ts": NOT_ABOUT_A_DEPARTURE,
  "src/db/staff-reply.ts": NOT_ABOUT_A_DEPARTURE,
  "src/db/weekly-digest.ts": "its counts carry `notRehearsal()`",
  "src/db/work-order-follow-up.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/actions/demo-instrumentation.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/actions/inquiry.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/forgot-password/actions.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/onboard/actions.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/reset-password/[token]/actions.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/shop/[shopSlug]/settings/boat-actions.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/shop/[shopSlug]/settings/shop-actions.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/shop/[shopSlug]/settings/team/actions.ts": NOT_ABOUT_A_DEPARTURE,
  // The bookkeeper's month-end files (fifth loop, r5-5): the owner's notices,
  // the address's confirmation and the month's files, all to the shop's own
  // people about a month. The files are Reports' own downloads.
  "src/db/bookkeeper.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/api/cron/bookkeeper/month-end-pass.ts": NOT_ABOUT_A_DEPARTURE,
  "src/app/shop/[shopSlug]/reports/bookkeeper-actions.ts": NOT_ABOUT_A_DEPARTURE,
};

const SENDER_CALL =
  /\b(?:sendNotification|sendNotificationBatch|sendAndRecordNotification|sendCourtesyMessage|sendWebPush|pushManifestChanged)\(/;

function sourceFiles(directory: string): string[] {
  return readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [relative] : [];
  });
}

describe("rehearsal coverage: the static walk", () => {
  it("finds a read that forgets the filter", () => {
    const forgot = ["db", "  .select()", "  .from(trips)", "  .where(liveTrip());"].join("\n");
    expect(unguardedRehearsalReads(forgot)).toEqual([3]);
    const remembered = forgot.replace("liveTrip()", "and(liveTrip(), notRehearsal())");
    expect(unguardedRehearsalReads(remembered)).toEqual([]);
  });

  it.each(OUTWARD_MODULES)("%s: every read of trips leaves rehearsals out", (file) => {
    const carriers = CARRIERS[file] ?? [];
    expect(unguardedRehearsalReads(read(file), carriers)).toEqual([]);
    for (const name of carriers) expect(carriersWithoutFilter(read(file), name)).toEqual([]);
  });

  it.each(GATES)("$file holds: $why", ({ file, holds, times = 1 }) => {
    expect(read(file).split(holds).length - 1).toBeGreaterThanOrEqual(times);
  });

  it("knows why every sender keeps a rehearsal's message in", () => {
    const senders = ["src/db", "src/app", "src/lib", "src/features"]
      .flatMap(sourceFiles)
      .filter((file) => SENDER_CALL.test(read(file)));
    const unclassified = senders.filter((file) => !(file in SENDERS));
    expect(unclassified, "classify each new sender in SENDERS, with its reason").toEqual([]);
  });
});

const ctx = fileScopedShopContext();
const NOW = new Date("2031-05-10T12:00:00Z");

async function rehearsalWithASeat(
  at: { startsAt?: Date; hours?: number; fullName?: string; email?: string } = {},
) {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const startsAt = at.startsAt ?? new Date(NOW.getTime() + 48 * HOUR_MS);
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Training day drill",
    startsAt,
    endsAt: new Date(startsAt.getTime() + (at.hours ?? 4) * HOUR_MS),
    capacity: 6,
    priceCents: 12_000,
    isRehearsal: true,
  });
  if (!trip || !owner) throw new Error("fixture failed");
  const party = await createBookingParty(db, [
    {
      actor: "staff" as const,
      shopId: shop.id,
      tripId: trip.id,
      fullName: at.fullName ?? "Test Diver",
      email: at.email ?? "test-diver@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`seat refused: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!seat) throw new Error("seat missing");
  return { db, shop, trip, ownerId: owner.id, bookingId, personId: seat.personId };
}

describe("rehearsal coverage: a real rehearsal", () => {
  it("is created private and unpriced, and an edit cannot change either", async () => {
    const { db, shop, trip } = await rehearsalWithASeat();
    expect(trip).toMatchObject({ isRehearsal: true, isPrivate: true, priceCents: null });
    const edited = await updateTrip(db, shop.id, trip.id, {
      title: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: trip.capacity,
      plannedDives: trip.plannedDives,
      isPrivate: false,
      priceCents: 9_000,
    });
    expect(edited.ok && edited.trip).toMatchObject({ isPrivate: true, priceCents: null });
  });

  it("refuses to exist in public at the database", async () => {
    const { db, trip } = await rehearsalWithASeat();
    await expect(
      db.update(trips).set({ isPrivate: false }).where(eq(trips.id, trip.id)),
    ).rejects.toThrow();
  });

  it("is on no public list, has no public URL, and takes no public booking", async () => {
    const { db, shop, trip } = await rehearsalWithASeat();
    const listed = await pagedUpcomingTripsWithCounts(db, shop.id, {
      now: NOW,
      publicOnly: true,
      limit: 200,
    });
    expect(listed.trips.map((row) => row.id)).not.toContain(trip.id);
    expect(await tripExistsForShop(db, shop.id, trip.id)).toBe(false);
    const publicSeat = await createBookingParty(db, [
      {
        actor: "public" as const,
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Walk Up",
        email: "walk-up@example.com",
      },
    ]);
    expect(publicSeat).toMatchObject({ ok: false, reason: "trip_unavailable" });
  });

  it("holds every message about it, whichever handle the message carries", async () => {
    const { db, shop, trip, bookingId } = await rehearsalWithASeat();
    const about = (handle: Record<string, string>) =>
      ({ kind: "trip_conditions_hold", shopId: shop.id, ...handle }) as never;
    expect(await notificationHeldForRehearsal(db, about({ tripId: trip.id }))).toBe(true);
    expect(await notificationHeldForRehearsal(db, about({ bookingId }))).toBe(true);
    expect(
      await notificationHeldForRehearsal(db, {
        kind: "fly_safe_correction",
        seatId: bookingId,
        shopId: shop.id,
        to: "walk-up@example.com",
        locale: "en-US",
        shopName: shop.name,
        tripTitle: trip.title,
        startsAt: trip.startsAt,
        timezone: shop.timezone,
      } as never),
    ).toBe(true);
    let providerCalled = false;
    await sendNotification(
      db,
      {
        kind: "fly_safe_correction",
        seatId: bookingId,
        shopId: shop.id,
        to: "walk-up@example.com",
        locale: "en-US",
        shopName: shop.name,
        tripTitle: trip.title,
        startsAt: trip.startsAt,
        timezone: shop.timezone,
      },
      {
        async send() {
          providerCalled = true;
          return { status: "sent", providerMessageId: "should-not-send" };
        },
      },
    );
    expect(providerCalled).toBe(false);
    // Another shop's id for the same row reaches nothing.
    expect(
      await notificationHeldForRehearsal(db, {
        kind: "trip_conditions_hold",
        shopId: "00000000-0000-0000-0000-000000000000",
        tripId: trip.id,
      } as never),
    ).toBe(false);
  });

  it("is in neither the export nor its counts", async () => {
    const { db, shop, trip, bookingId } = await rehearsalWithASeat();
    const bundle = await loadShopExportBundleInput(db, shop.id);
    const counts = await loadShopExportCounts(db, shop.id);
    if (!bundle || !counts) throw new Error("export failed");
    const cells = bundle.tables.flatMap((table) => table.rows.flat());
    // Substring, not equality: a cell that names the id inside a longer
    // value (a URL, a list) leaks it as surely.
    expect(cells.some((cell) => String(cell).includes(trip.id))).toBe(false);
    expect(cells.some((cell) => String(cell).includes(bookingId))).toBe(false);
    for (const [index, row] of counts.entries()) {
      expect(row.count).toBe(bundle.tables[index].rows.length);
    }
  });

  it("is not counted in the month's report", async () => {
    const { db, shop, trip } = await rehearsalWithASeat();
    const report = await getMonthlyReport(
      db,
      shop.id,
      new Date(trip.startsAt.getTime() - 24 * HOUR_MS),
      new Date(trip.endsAt.getTime() + 24 * HOUR_MS),
    );
    expect(report.trips.map((row) => row.tripId)).not.toContain(trip.id);
  });

  it("is deleted, seats and all, once its night and fly-safe's look-back have passed", async () => {
    const { db, shop, trip, bookingId } = await rehearsalWithASeat();
    const deletedOthers = async () =>
      (
        await db
          .select({ deletedAt: trips.deletedAt })
          .from(trips)
          .where(and(eq(trips.shopId, shop.id), eq(trips.isRehearsal, false)))
      ).filter((row) => row.deletedAt !== null).length;
    const before = await deletedOthers();
    const settled = new Date(
      trip.endsAt.getTime() + (FLY_SAFE_MULTI_DAY_LOOKBACK_DAYS + 1) * 24 * HOUR_MS,
    );
    expect(await clearFinishedRehearsals(db, trip.endsAt)).toBe(0);
    expect(await clearFinishedRehearsals(db, new Date(settled.getTime() - 1))).toBe(0);
    expect(await clearFinishedRehearsals(db, settled)).toBe(1);
    const [cleared] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(cleared?.deletedAt).not.toBeNull();
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(seat?.status).toBe("cancelled");
    expect(await deletedOthers()).toBe(before);
  });

  it("leaves Saturday's rehearsal for Sunday's fly-safe when the cron runs between", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ timezone: "America/New_York" }).where(eq(shops.id, shop.id));
    // 09:00-13:00 Saturday in New York; Sunday's real boat at 09:00.
    const saturday = new Date("2031-05-10T13:00:00Z");
    const sunday = new Date("2031-05-11T13:00:00Z");
    const { personId } = await rehearsalWithASeat({ startsAt: saturday });
    await clearFinishedRehearsals(db, new Date("2031-05-11T03:15:00Z"));
    const dived = await peopleWhoDivedBefore(db, shop.id, [personId], sunday, "America/New_York");
    expect(dived.has(personId)).toBe(true);
  });

  it("does not take an east-of-UTC shop's late rehearsal while it may still be out", async () => {
    const { db, shop } = ctx;
    await db.update(shops).set({ timezone: "Australia/Brisbane" }).where(eq(shops.id, shop.id));
    // 08:00-12:00 Brisbane is 22:00Z-02:00Z; the 03:15Z tick is 13:15 local.
    const { trip } = await rehearsalWithASeat({ startsAt: new Date("2031-05-09T22:00:00Z") });
    expect(await clearFinishedRehearsals(db, new Date("2031-05-10T03:15:00Z"))).toBe(0);
    const [live] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(live?.deletedAt).toBeNull();
  });

  it("never clears a rehearsal with a boarding, an after-dive count, or a logged dive", async () => {
    const late = (trip: { endsAt: Date }) => new Date(trip.endsAt.getTime() + 30 * 24 * HOUR_MS);
    const evidence = [
      { status: "boarded", checkpoint: "departure" },
      { status: "not_boarded", checkpoint: "after_dive_1" },
    ] as const;
    for (const event of evidence) {
      const { db, shop, trip, bookingId, ownerId } = await rehearsalWithASeat();
      await db.insert(rollCallEvents).values({
        shopId: shop.id,
        tripId: trip.id,
        bookingId,
        recordedByPersonId: ownerId,
        occurredAt: NOW,
        ...event,
      });
      await clearFinishedRehearsals(db, late(trip));
      const [kept] = await db.select().from(trips).where(eq(trips.id, trip.id));
      expect(kept?.deletedAt, `${event.status} at ${event.checkpoint}`).toBeNull();
      await db.update(trips).set({ deletedAt: NOW }).where(eq(trips.id, trip.id));
    }
    const { db, shop, trip } = await rehearsalWithASeat();
    await db.insert(executedDives).values({ shopId: shop.id, tripId: trip.id, diveNumber: 1 });
    expect(await clearFinishedRehearsals(db, late(trip))).toBe(0);
  });

  it("clears a rehearsal whose only roll call is a dockside not-boarded", async () => {
    const { db, shop, trip, bookingId, ownerId } = await rehearsalWithASeat();
    await db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      bookingId,
      recordedByPersonId: ownerId,
      occurredAt: NOW,
      status: "not_boarded",
    });
    expect(
      await clearFinishedRehearsals(db, new Date(trip.endsAt.getTime() + 30 * 24 * HOUR_MS)),
    ).toBe(1);
  });

  it("spends none of a seated diver's prepaid dives", async () => {
    const { db, shop } = ctx;
    const [holder] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Pack Holder", email: "pack-holder@example.com" })
      .returning();
    if (!holder) throw new Error("person insert failed");
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: holder.id,
        createdByPersonId: holder.id,
        description: "Five dives",
        status: "paid",
        totalCents: 45_000,
        amountPaidCents: 45_000,
        currency: "usd",
        stripeAccountId: "acct_test",
        stripeCustomerId: "cus_test",
        stripeInvoiceId: "in_test",
      })
      .returning();
    const pkg = await createDivePackage(db, {
      shopId: shop.id,
      name: "Five dives",
      diveCount: 5,
      priceCents: 45_000,
      scope: "all",
      validUntil: null,
    });
    if (!order || !pkg) throw new Error("package fixture failed");
    await grantPackageEntitlements(db, {
      shopId: shop.id,
      packageId: pkg.id,
      personId: holder.id,
      orderId: order.id,
      diveCount: 5,
      validUntil: null,
    });
    const seated = await rehearsalWithASeat({
      fullName: "Pack Holder",
      email: "pack-holder@example.com",
    });
    expect(seated.personId).toBe(holder.id);
    expect(await countSpendableDives(db, shop.id, holder.id)).toBe(5);
    const [entitled] = await db
      .select({ id: divePackageEntitlements.id })
      .from(divePackageEntitlements)
      .where(eq(divePackageEntitlements.bookingId, seated.bookingId));
    expect(entitled).toBeUndefined();
  });

  it("gives back the gear reserved for its seats when it is cleared", async () => {
    const { db, shop, trip, bookingId } = await rehearsalWithASeat();
    const [unit] = await db
      .select({ id: gearItems.id })
      .from(gearItems)
      .where(eq(gearItems.shopId, shop.id))
      .limit(1);
    if (!unit) throw new Error("seed has no gear");
    const [reservation] = await db
      .insert(gearReservations)
      .values({
        shopId: shop.id,
        gearItemId: unit.id,
        bookingId,
        reservedFrom: "2031-05-12",
        reservedUntil: "2031-05-12",
      })
      .returning();
    expect(
      await clearFinishedRehearsals(db, new Date(trip.endsAt.getTime() + 30 * 24 * HOUR_MS)),
    ).toBe(1);
    const [after] = await db
      .select()
      .from(gearReservations)
      .where(eq(gearReservations.id, reservation?.id ?? ""));
    expect(after?.releasedAt).not.toBeNull();
  });
});
