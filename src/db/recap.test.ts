import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { toDiverLocale } from "@/i18n/settings";
import { nowDate, nowMs } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { fakeCheckout, fakeCourtesy, fakeEmail, fakeSms } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { recordDiverOwnLocale } from "./people";
import {
  addCrewRecapPhoto,
  addRecapPhoto,
  canAddCrewRecapPhoto,
  canAddRecapPhoto,
  deleteCrewRecapPhoto,
  deleteRecapPhoto,
  getRecapPageData,
  listCrewRecapPhotosForTrip,
  listRecapPhotosForTrip,
  MAX_RECAP_CAPTION_LENGTH,
  MAX_RECAP_PHOTOS_PER_BOOKING,
  pauseTripRecapAutoSend,
  sendDueRecaps,
  sendTripRecaps,
  setTripRecapShoutout,
  unpauseTripRecapAutoSend,
} from "./recap";
import {
  bookings,
  notificationDeliveries,
  people,
  priorVisits,
  recapPhotos,
  shops,
  trips,
} from "./schema";
import { setShopCurrency, setShopReviewUrl } from "./shops";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { startTipCheckout } from "./tips";
import { createTrip, listStaff, upcomingTripsWithCounts } from "./trips";

const ORIGIN = "https://diveday.test";

async function recapContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Rae Recap",
      email: "recap-rae@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  // **This shop sends around the clock**, so the cases below are about the
  // four-hour pause and nothing else. A recap is also held outside the shop's
  // own civil hours (`src/lib/send-window.ts`, issue #697) — the reef boat ties
  // up at 6 PM, so its recap comes due at 11 PM and a default shop would hold
  // it until morning. That rule has its own cases at the bottom of this file;
  // mixing it into every delay assertion would test two things at once.
  await db
    .update(shops)
    .set({ sendWindowStartHour: 0, sendWindowEndHour: 24 })
    .where(eq(shops.id, shop.id));
  // Five hours after the reef trip ends clears the mandatory four-hour pause.
  const afterTrip = new Date(reef.endsAt.getTime() + 5 * 60 * 60 * 1000);
  return { db, shop, reef, bookingId, afterTrip };
}

const rowsFor = (db: Awaited<ReturnType<typeof recapContext>>["db"], bookingId: string) =>
  db.select().from(notificationDeliveries).where(eq(notificationDeliveries.bookingId, bookingId));

describe("getRecapPageData", () => {
  it("returns the diver, the sites dived, and the trip for a live booking", async () => {
    const { db, bookingId } = await recapContext();
    const data = await getRecapPageData(db, bookingId);
    expect(data).not.toBeNull();
    if (!data) return;
    expect(data.diverName).toBe("Rae Recap");
    expect(data.trip.title).toContain("Two-Tank Reef");
    expect(data.sites.length).toBeGreaterThan(0);
    // Sites are de-duplicated by name — a two-tank day on one site reads once.
    expect(new Set(data.sites.map((s) => s.name)).size).toBe(data.sites.length);
  });

  it("returns null for a cancelled booking — a cancelled diver never dived", async () => {
    const { db, bookingId } = await recapContext();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
    expect(await getRecapPageData(db, bookingId)).toBeNull();
  });

  it("returns null for an unknown booking", async () => {
    const { db } = await recapContext();
    expect(await getRecapPageData(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("returns null for a no-show — a no-show never dived, same as a cancelled booking (Codex finding)", async () => {
    // The narrower fix (hide canTip/reviewUrl only) still let the page show
    // "here's what you dived" content and a diver-facing recap email to
    // someone staff marked as not having shown up. Gating the whole loader
    // the same way a cancelled booking is gated closes that — and takes
    // canTip/reviewUrl down with it, since there's no data at all now.
    const { db, shop, bookingId } = await recapContext();
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    await setShopStripeAccountStatus(db, "acct_test", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    await setShopReviewUrl(db, shop.id, "https://g.page/r/blue-mantis/review");
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, bookingId));

    expect(await getRecapPageData(db, bookingId)).toBeNull();
  });

  it("returns null for a cancelled departure, whose bookings stay active by design (review, 2026-08-28)", async () => {
    // The third way there is no day, and the one nothing downstream caught.
    // `callTripBlowout` sets `trips.status = 'cancelled'` and deliberately
    // leaves every booking `booked` — refunds are a per-booking staff decision
    // — and `getTripWithBooked` filters `liveTrip()` (the soft-delete
    // predicate) rather than the status. So an hour after a blown-out
    // departure's scheduled return, every stranded diver's own link greeted
    // them "Welcome back" with a dive record, a review ask and a tip ask for a
    // dive that never left the dock. The recap *email* never had this bug —
    // `sendRecaps` filters `eq(trips.status, "scheduled")` — so the fix is that
    // same filter, one layer down, where both reading paths share it.
    const { db, reef, bookingId } = await recapContext();
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, reef.id));

    // The booking itself is untouched: this is the shape a blow-out leaves.
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(booking?.status).toBe("booked");
    expect(await getRecapPageData(db, bookingId)).toBeNull();
  });

  it("counts a blown-out departure as no dive day at all", async () => {
    const { db, shop, reef, bookingId } = await recapContext();
    const dayBefore = new Date(reef.startsAt.getTime() - 24 * 60 * 60 * 1000);
    const earlier = await createTrip(db, {
      shopId: shop.id,
      title: "First-Timer Two-Tank",
      startsAt: dayBefore,
      endsAt: new Date(dayBefore.getTime() + 3 * 60 * 60 * 1000),
      capacity: 12,
      plannedDives: 2,
    });
    if (!earlier) throw new Error("test setup: the earlier departure could not be created");

    // The same diver on that earlier departure — `createBookingParty` resolves
    // a person by (shop, email), so this is one diver holding two seats.
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: earlier.id,
        fullName: "Rae Recap",
        email: "recap-rae@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);

    // Two seats, two live departures, two days.
    expect((await getRecapPageData(db, bookingId))?.visitCount).toBe(2);

    // The captain calls the earlier one off. Nothing about the booking changes
    // — that is the whole point of the cascade — and until this fix the count
    // kept the day anyway, while the *imported* half of the same merge already
    // refused one (`priorVisitStanding(...) !== "did_not_happen"`).
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, earlier.id));

    // Their real first dive day, and the one the "First dive day" stamp exists
    // for: `visitMilestone` is exact equality on {1, 10, 25, 50, 100}, so a
    // phantom day does not blur a milestone — it skips it permanently.
    expect((await getRecapPageData(db, bookingId))?.visitCount).toBe(1);
  });

  it("hides tipping for a phone-only diver — startTipCheckout has no email to hand Stripe (Codex finding)", async () => {
    const { db, shop, bookingId } = await recapContext();
    await upsertShopStripeAccount(db, shop.id, "acct_test");
    await setShopStripeAccountStatus(db, "acct_test", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    if (!booking) throw new Error("test setup: booking missing");
    await db.update(people).set({ email: null }).where(eq(people.id, booking.personId));

    const data = await getRecapPageData(db, bookingId);
    expect(data?.canTip).toBe(false);
  });

  it("reads the shop's own currency, not the connected account's (task 35, superseding task 60)", async () => {
    const { db, shop, bookingId } = await recapContext();
    // No Stripe account at all: the shop's column default still answers, so
    // the tip presets have a currency before any money is connected.
    expect((await getRecapPageData(db, bookingId))?.currency).toBe("usd");

    await setShopCurrency(db, shop.id, "eur");
    expect((await getRecapPageData(db, bookingId))?.currency).toBe("eur");

    // Stripe reporting something else for the connected account is advisory
    // (`stripeCurrencyMismatch` surfaces it in settings) and never overrides
    // what the shop declared — task 60 read `default_currency` here, which
    // let one booking be quoted in two currencies across its own pages.
    await upsertShopStripeAccount(db, shop.id, "acct_usd");
    await setShopStripeAccountStatus(db, "acct_usd", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      defaultCurrency: "usd",
    });
    expect((await getRecapPageData(db, bookingId))?.currency).toBe("eur");

    // A zero-decimal currency reaches the page as itself, undivided.
    await setShopCurrency(db, shop.id, "jpy");
    expect((await getRecapPageData(db, bookingId))?.currency).toBe("jpy");
  });

  it("includes keepsake dive record details: boat, crew, depths, and visitCount", async () => {
    const { db, shop, bookingId } = await recapContext();
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    if (!booking) throw new Error("test setup: booking missing");

    // Add a prior visit from before DiveDay
    await db.insert(priorVisits).values({
      shopId: shop.id,
      personId: booking.personId,
      visitedOn: "2024-05-10",
      title: "Earlier Dive",
      statusLabel: "completed",
      dedupeKey: "test-dedupe-1",
      importedAt: nowDate(),
    });

    const data = await getRecapPageData(db, bookingId);
    expect(data).not.toBeNull();
    if (!data) return;

    expect(data.visitCount).toBe(2);
    expect(Array.isArray(data.trip.crew)).toBe(true);
    expect(data.sites.length).toBeGreaterThan(0);
  });
});

async function pendingTipContext() {
  const ctx = await recapContext();
  await upsertShopStripeAccount(ctx.db, ctx.shop.id, "acct_test");
  await setShopStripeAccountStatus(ctx.db, "acct_test", {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
  const started = await startTipCheckout(
    ctx.db,
    {
      bookingId: ctx.bookingId,
      amountCents: 1000,
      successUrl: "https://diveday.example/recap/tok?tip=paid",
      cancelUrl: "https://diveday.example/recap/tok?tip=cancelled",
      lineDescription: "CALLER_TIP_LABEL",
    },
    fakeCheckout(),
  );
  if (!started.ok) throw new Error(`tip start failed: ${started.reason}`);
  return { ...ctx, checkoutUrl: started.checkoutUrl };
}

describe("getRecapPageData tip reconciliation", () => {
  it("never shows a tip as paid on a bare return-URL alone — only once Stripe confirms it", async () => {
    const { db, bookingId } = await pendingTipContext();
    // Stripe itself now confirms this session actually paid.
    const data = await getRecapPageData(
      db,
      bookingId,
      fakeCheckout({
        async retrieveCheckoutSession() {
          return {
            status: "ok",
            session: {
              stripeSessionId: "cs_1",
              stripeStatus: "complete",
              paymentStatus: "paid",
              checkoutUrl: null,
              amountTotalCents: 1000,
              taxAmountCents: null,
              expiresAt: null,
            },
          };
        },
      }),
    );
    expect(data?.tip?.status).toBe("paid");
  });

  it("expires a stale pending tip once Stripe reports the session gone, instead of offering a dead link forever", async () => {
    const { db, bookingId } = await pendingTipContext();
    const data = await getRecapPageData(
      db,
      bookingId,
      fakeCheckout({
        async retrieveCheckoutSession() {
          return {
            status: "ok",
            session: {
              stripeSessionId: "cs_1",
              stripeStatus: "expired",
              paymentStatus: "unpaid",
              checkoutUrl: null,
              amountTotalCents: 1000,
              taxAmountCents: null,
              expiresAt: null,
            },
          };
        },
      }),
    );
    expect(data?.tip?.status).toBe("expired");
  });

  it("leaves a tip pending, checkout link intact, when Stripe can't be reached to reconcile it", async () => {
    const { db, bookingId, checkoutUrl } = await pendingTipContext();
    const data = await getRecapPageData(db, bookingId, fakeCheckout()); // default retrieveCheckoutSession fails
    expect(data?.tip?.status).toBe("pending");
    // The link the diver was handed when the tip started, still intact.
    expect(data?.tip?.checkoutUrl).toBe(checkoutUrl);
  });
});

describe("recap photos and crew shout-out", () => {
  it("attaches a diver photo and surfaces it on the recap, newest first", async () => {
    const { db, bookingId } = await recapContext();
    const first = await addRecapPhoto(db, {
      bookingId,
      imageUrl: "https://img/one.jpg",
      caption: "  Turtle!  ",
    });
    const second = await addRecapPhoto(db, { bookingId, imageUrl: "https://img/two.jpg" });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok) {
      expect(first.photo.caption).toBe("Turtle!"); // trimmed
      await db
        .update(recapPhotos)
        .set({ createdAt: new Date(nowMs() + 1000) })
        .where(eq(recapPhotos.id, first.photo.id));
    }
    if (second.ok) {
      await db
        .update(recapPhotos)
        .set({ createdAt: new Date(nowMs() + 2000) })
        .where(eq(recapPhotos.id, second.photo.id));
    }
    const data = await getRecapPageData(db, bookingId);
    expect(data?.photos.map((p) => p.imageUrl)).toEqual([
      "https://img/two.jpg",
      "https://img/one.jpg",
    ]);
  });

  it("refuses a photo on a cancelled booking and past the per-booking cap", async () => {
    const { db, bookingId } = await recapContext();
    for (let i = 0; i < MAX_RECAP_PHOTOS_PER_BOOKING; i++) {
      expect((await addRecapPhoto(db, { bookingId, imageUrl: `https://img/${i}.jpg` })).ok).toBe(
        true,
      );
    }
    expect(await addRecapPhoto(db, { bookingId, imageUrl: "https://img/over.jpg" })).toEqual({
      ok: false,
      reason: "limit",
    });

    const cancelled = await recapContext();
    await cancelled.db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.id, cancelled.bookingId));
    expect(
      await addRecapPhoto(cancelled.db, {
        bookingId: cancelled.bookingId,
        imageUrl: "https://img/x.jpg",
      }),
    ).toEqual({ ok: false, reason: "cancelled" });
  });

  it("refuses a no-show upload the same as a cancelled one, at the locked insert-time gate (Codex finding)", async () => {
    // A recap link can be bookmarked/reloaded from before a staff
    // correction — a form loaded while the booking still read "booked"
    // could otherwise still write photos into a no-show's gallery.
    const { db, bookingId } = await recapContext();
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, bookingId));
    expect(await addRecapPhoto(db, { bookingId, imageUrl: "https://img/x.jpg" })).toEqual({
      ok: false,
      reason: "cancelled",
    });
  });

  it("pre-checks eligibility read-only, matching the add gate before any upload", async () => {
    const { db, bookingId } = await recapContext();
    expect(await canAddRecapPhoto(db, bookingId)).toEqual({ ok: true });
    expect(await canAddRecapPhoto(db, "00000000-0000-0000-0000-000000000000")).toEqual({
      ok: false,
      reason: "not_found",
    });

    for (let i = 0; i < MAX_RECAP_PHOTOS_PER_BOOKING; i++) {
      await addRecapPhoto(db, { bookingId, imageUrl: `https://img/${i}.jpg` });
    }
    // At the cap, the pre-check refuses before bytes would ever be stored.
    expect(await canAddRecapPhoto(db, bookingId)).toEqual({ ok: false, reason: "limit" });

    const cancelled = await recapContext();
    await cancelled.db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.id, cancelled.bookingId));
    expect(await canAddRecapPhoto(cancelled.db, cancelled.bookingId)).toEqual({
      ok: false,
      reason: "cancelled",
    });

    const noShow = await recapContext();
    await noShow.db
      .update(bookings)
      .set({ status: "no_show" })
      .where(eq(bookings.id, noShow.bookingId));
    expect(await canAddRecapPhoto(noShow.db, noShow.bookingId)).toEqual({
      ok: false,
      reason: "cancelled",
    });
  });

  it("truncates an over-long caption to the server bound", async () => {
    const { db, bookingId } = await recapContext();
    const long = "x".repeat(MAX_RECAP_CAPTION_LENGTH + 50);
    const added = await addRecapPhoto(db, {
      bookingId,
      imageUrl: "https://img/cap.jpg",
      caption: long,
    });
    if (!added.ok) throw new Error("photo not added");
    expect(added.photo.caption).toHaveLength(MAX_RECAP_CAPTION_LENGTH);
  });

  it("shows staff every photo on a trip and lets them take one down, shop-scoped", async () => {
    const { db, shop, reef, bookingId } = await recapContext();
    const before = await listRecapPhotosForTrip(db, shop.id, reef.id);
    const keep = await addRecapPhoto(db, { bookingId, imageUrl: "https://img/keep.jpg" });
    const doomed = await addRecapPhoto(db, { bookingId, imageUrl: "https://img/bad.jpg" });
    if (!keep.ok || !doomed.ok) throw new Error("photos not added");

    const after = await listRecapPhotosForTrip(db, shop.id, reef.id);
    expect(after.length).toBe(before.length + 2);
    expect(after.find((p) => p.id === doomed.photo.id)?.diverName).toBe("Rae Recap");

    // A different shop can't moderate this photo.
    expect(
      await deleteRecapPhoto(db, "00000000-0000-0000-0000-000000000000", doomed.photo.id),
    ).toEqual({ deleted: false });
    expect(await deleteRecapPhoto(db, shop.id, doomed.photo.id)).toEqual({
      deleted: true,
      imageUrl: "https://img/bad.jpg",
    });
    const afterDelete = await listRecapPhotosForTrip(db, shop.id, reef.id);
    expect(afterDelete.length).toBe(before.length + 1);
    expect(afterDelete.some((p) => p.id === doomed.photo.id)).toBe(false);
  });

  it("shares crew photos into every diver recap and records only a live staff upload", async () => {
    const { db, shop, reef, bookingId, afterTrip } = await recapContext();
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("staff fixture missing");
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    if (!booking) throw new Error("booking fixture missing");

    expect(
      await canAddCrewRecapPhoto(db, {
        shopId: shop.id,
        tripId: reef.id,
        uploadedByPersonId: staff.person.id,
        now: new Date(reef.endsAt.getTime() - 1),
      }),
    ).toEqual({ ok: false, reason: "not_ended" });
    expect(
      await canAddCrewRecapPhoto(db, {
        shopId: shop.id,
        tripId: reef.id,
        uploadedByPersonId: booking.personId,
        now: afterTrip,
      }),
    ).toEqual({ ok: false, reason: "not_staff" });

    const added = await addCrewRecapPhoto(db, {
      shopId: shop.id,
      tripId: reef.id,
      uploadedByPersonId: staff.person.id,
      imageUrl: "https://img/crew.jpg",
      now: afterTrip,
    });
    expect(added).toMatchObject({ ok: true, photo: { imageUrl: "https://img/crew.jpg" } });
    if (!added.ok) throw new Error("crew photo not added");

    expect(await listCrewRecapPhotosForTrip(db, shop.id, reef.id)).toContainEqual(added.photo);
    expect((await getRecapPageData(db, bookingId))?.photos).toContainEqual({
      id: added.photo.id,
      imageUrl: "https://img/crew.jpg",
      caption: null,
    });

    expect(
      await deleteCrewRecapPhoto(db, "00000000-0000-0000-0000-000000000000", added.photo.id),
    ).toEqual({ deleted: false });
    expect(await deleteCrewRecapPhoto(db, shop.id, added.photo.id)).toEqual({
      deleted: true,
      imageUrl: "https://img/crew.jpg",
    });
  });

  it("carries the crew shout-out onto the recap and clears it on empty", async () => {
    const { db, shop, reef, bookingId } = await recapContext();
    await setTripRecapShoutout(db, shop.id, reef.id, "  Killer vis today!  ");
    expect((await getRecapPageData(db, bookingId))?.shoutout).toBe("Killer vis today!");
    await setTripRecapShoutout(db, shop.id, reef.id, "   ");
    expect((await getRecapPageData(db, bookingId))?.shoutout).toBeNull();
  });
});

describe("sendDueRecaps", () => {
  /**
   * The cron has no request to negotiate from, but the diver may have told us
   * first-hand on a request of their own — and their language outranks the
   * shop's default (docs ADR 20260731-per-person-notification-locale). This is
   * Ingrid's case exactly: a German diver at a Spanish-speaking shop.
   */
  it("sends the recap in the diver's own recorded language, not the shop's", async () => {
    const { db, shop, bookingId, afterTrip } = await recapContext();
    const opts = () => ({
      now: afterTrip,
      emailProvider: fakeEmail().provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });

    // With nothing recorded, the shop's locale answers exactly as before.
    const shopOnly = fakeEmail();
    await sendDueRecaps(db, { ...opts(), emailProvider: shopOnly.provider });
    const beforeMine = shopOnly.sent.filter(
      (n) => n.kind === "trip_recap" && n.bookingId === bookingId,
    );
    expect(beforeMine).toHaveLength(1);
    expect(beforeMine[0]).toMatchObject({ locale: toDiverLocale(shop.defaultLocale) });

    // Now the diver has told us, first-hand, that they read Spanish.
    await db.delete(notificationDeliveries).where(eq(notificationDeliveries.bookingId, bookingId));
    const [person] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);
    if (!person) throw new Error("booking has no person");
    await recordDiverOwnLocale(db, {
      shopId: shop.id,
      personId: person.personId,
      locale: "es-ES",
    });

    const own = fakeEmail();
    await sendDueRecaps(db, { ...opts(), emailProvider: own.provider });
    const mine = own.sent.filter((n) => n.kind === "trip_recap" && n.bookingId === bookingId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ locale: "es-ES" });
  });

  it("sends the recap after the minimum delay, records it, and is a no-op on a second run", async () => {
    const { db, bookingId, afterTrip } = await recapContext();
    const email = fakeEmail();
    const opts = {
      now: afterTrip,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    };

    await sendDueRecaps(db, opts);
    const mine = email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId);
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe("trip_recap");
    if (mine[0].kind === "trip_recap") {
      expect(mine[0].recapUrl).toContain(`${ORIGIN}/recap/`);
    }
    const rows = await rowsFor(db, bookingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "trip_recap", status: "sent" });

    await sendDueRecaps(db, opts);
    expect(email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId)).toHaveLength(1);
    expect(await rowsFor(db, bookingId)).toHaveLength(1);
  });

  it("sends nothing before the trip departs", async () => {
    const { db, reef, bookingId } = await recapContext();
    const email = fakeEmail();
    await sendDueRecaps(db, {
      now: new Date(reef.endsAt.getTime() - 60 * 60 * 1000),
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });
    expect(email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId)).toHaveLength(0);
    expect(await rowsFor(db, bookingId)).toHaveLength(0);
  });

  it("holds the recap for four hours after the trip ends", async () => {
    const { db, reef, bookingId } = await recapContext();
    const email = fakeEmail();
    await sendDueRecaps(db, {
      now: new Date(reef.endsAt.getTime() + 3 * 60 * 60 * 1000 + 59 * 60 * 1000),
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });
    expect(email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId)).toHaveLength(0);
    expect(await rowsFor(db, bookingId)).toHaveLength(0);
  });

  it("lets staff send only the selected eligible departure's outstanding recaps", async () => {
    const { db, shop, reef, bookingId, afterTrip } = await recapContext();
    const email = fakeEmail();
    const result = await sendTripRecaps(db, {
      shopId: shop.id,
      tripId: reef.id,
      options: {
        now: afterTrip,
        emailProvider: email.provider,
        smsProvider: fakeSms().provider,
        appOrigin: ORIGIN,
      },
    });
    const selectedBookingIds = (
      await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.shopId, shop.id),
            eq(bookings.tripId, reef.id),
            ne(bookings.status, "cancelled"),
            ne(bookings.status, "no_show"),
          ),
        )
    )
      .map((row) => row.id)
      .sort();
    const sentBookingIds = email.sent
      .flatMap((notification) => ("bookingId" in notification ? [notification.bookingId] : []))
      .sort();

    expect(result).toMatchObject({ ok: true, summary: { sent: selectedBookingIds.length } });
    expect(sentBookingIds).toEqual(selectedBookingIds);
    expect(sentBookingIds).toContain(bookingId);
  });

  it("allows staff to send recaps immediately without waiting for the four-hour delay", async () => {
    const { db, shop, reef, bookingId } = await recapContext();
    const email = fakeEmail();
    const result = await sendTripRecaps(db, {
      shopId: shop.id,
      tripId: reef.id,
      options: {
        now: new Date(reef.endsAt.getTime() + 10 * 60 * 1000), // 10 minutes after endsAt
        emailProvider: email.provider,
        smsProvider: fakeSms().provider,
        appOrigin: ORIGIN,
      },
    });
    expect(result.ok).toBe(true);
    expect(email.sent.some((n) => "bookingId" in n && n.bookingId === bookingId)).toBe(true);
  });

  it("skips automatic sending when paused", async () => {
    const { db, shop, reef, bookingId, afterTrip } = await recapContext();
    await pauseTripRecapAutoSend(db, shop.id, reef.id);
    const email = fakeEmail();
    await sendDueRecaps(db, {
      now: afterTrip,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });
    expect(email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId)).toHaveLength(0);
  });

  it("unpauses automatic sending setting autoSendAt to the later of original time and 1 hour after unpause", async () => {
    const { db, shop, reef, bookingId } = await recapContext();
    await pauseTripRecapAutoSend(db, shop.id, reef.id);

    // Unpause early (1 hour after trip ends, so original 4-hour mark is later)
    const earlyUnpause = new Date(reef.endsAt.getTime() + 1 * 60 * 60 * 1000);
    const unpauseResult = await unpauseTripRecapAutoSend(db, shop.id, reef.id, earlyUnpause);
    expect(unpauseResult.ok).toBe(true);
    expect(unpauseResult.autoSendAt?.getTime()).toBe(reef.endsAt.getTime() + 4 * 60 * 60 * 1000);

    // Unpause late (5 hours after trip ends, so unpause + 1h = 6h is later)
    const lateUnpause = new Date(reef.endsAt.getTime() + 5 * 60 * 60 * 1000);
    const lateResult = await unpauseTripRecapAutoSend(db, shop.id, reef.id, lateUnpause);
    expect(lateResult.ok).toBe(true);
    expect(lateResult.autoSendAt?.getTime()).toBe(lateUnpause.getTime() + 1 * 60 * 60 * 1000);

    // At 5h30m (before unpause + 1h), auto send should not trigger
    const emailBefore = fakeEmail();
    await sendDueRecaps(db, {
      now: new Date(reef.endsAt.getTime() + 5.5 * 60 * 60 * 1000),
      emailProvider: emailBefore.provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });
    expect(
      emailBefore.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId),
    ).toHaveLength(0);

    // At 6h05m (after unpause + 1h), auto send triggers
    const emailAfter = fakeEmail();
    await sendDueRecaps(db, {
      now: new Date(reef.endsAt.getTime() + 6.1 * 60 * 60 * 1000),
      emailProvider: emailAfter.provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });
    expect(
      emailAfter.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId),
    ).toHaveLength(1);
  });

  it("never sends a recap to a no-show — they never dived (Codex finding)", async () => {
    const { db, bookingId, afterTrip } = await recapContext();
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, bookingId));
    const email = fakeEmail();
    await sendDueRecaps(db, {
      now: afterTrip,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });
    expect(email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId)).toHaveLength(0);
    expect(await rowsFor(db, bookingId)).toHaveLength(0);
  });

  it("records not_configured when there is no app origin to build the link", async () => {
    const { db, bookingId, afterTrip } = await recapContext();
    await sendDueRecaps(db, {
      now: afterTrip,
      emailProvider: fakeEmail().provider,
      smsProvider: fakeSms().provider,
      appOrigin: null,
    });
    const rows = await rowsFor(db, bookingId);
    expect(rows[0]?.status).toBe("not_configured");
  });

  it("carries a working per-send unsubscribe link (Leo — self-serve email unsubscribe)", async () => {
    const { db, bookingId, afterTrip } = await recapContext();
    const email = fakeEmail();
    await sendDueRecaps(db, {
      now: afterTrip,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });
    const mine = email.sent.find((n) => n.kind === "trip_recap" && n.bookingId === bookingId);
    if (mine?.kind !== "trip_recap") throw new Error("recap notification missing");
    expect(mine.unsubscribeUrl).toContain(`${ORIGIN}/unsubscribe/`);
  });

  it("skips the email (falling back to SMS) for a diver who opted out of courtesy email", async () => {
    const { db, bookingId, afterTrip } = await recapContext();
    const [person] = await db
      .select()
      .from(people)
      .where(eq(people.email, "recap-rae@example.com"));
    await db
      .update(people)
      .set({ courtesyEmailOptOutAt: new Date("2026-07-20T00:00:00.000Z"), phone: "+13055557777" })
      .where(eq(people.id, person.id));
    const email = fakeEmail();
    const sms = fakeSms({ status: "sent", providerMessageId: "SM_recap_optout" });
    const summary = await sendDueRecaps(db, {
      now: afterTrip,
      emailProvider: email.provider,
      smsProvider: sms.provider,
      appOrigin: ORIGIN,
    });
    expect(email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId)).toHaveLength(0);
    expect(sms.sent.filter((m) => m.to === "+13055557777")).toHaveLength(1);
    expect(summary.optedOut).toBe(0);
  });

  it("counts, but does not record a failure, for an opted-out diver with no phone to fall back to", async () => {
    const { db, bookingId, afterTrip } = await recapContext();
    const [person] = await db
      .select()
      .from(people)
      .where(eq(people.email, "recap-rae@example.com"));
    await db
      .update(people)
      .set({ courtesyEmailOptOutAt: new Date("2026-07-20T00:00:00.000Z") })
      .where(eq(people.id, person.id));
    const email = fakeEmail();
    const summary = await sendDueRecaps(db, {
      now: afterTrip,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });
    expect(email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId)).toHaveLength(0);
    expect(summary.optedOut).toBe(1);
    expect(summary.failed).toBe(0);
    expect(await rowsFor(db, bookingId)).toHaveLength(0);
  });

  it("texts a phone-only diver the recap link", async () => {
    const { db, bookingId, afterTrip } = await recapContext();
    const [person] = await db
      .select()
      .from(people)
      .where(eq(people.email, "recap-rae@example.com"));
    await db
      .update(people)
      .set({ email: null, phone: "+13055557777" })
      .where(eq(people.id, person.id));
    const sms = fakeSms({ status: "sent", providerMessageId: "SM_recap" });
    await sendDueRecaps(db, {
      now: afterTrip,
      emailProvider: fakeEmail().provider,
      smsProvider: sms.provider,
      appOrigin: ORIGIN,
    });
    const mine = sms.sent.filter((m) => m.to === "+13055557777");
    expect(mine).toHaveLength(1);
    expect(mine[0].body).toContain(`${ORIGIN}/recap/`);
    const rows = await rowsFor(db, bookingId);
    expect(rows[0]).toMatchObject({ status: "sent", providerMessageId: "SM_recap" });
  });

  it("sends the recap over the shop's own WhatsApp when it has connected one", async () => {
    const { db, shop, bookingId, afterTrip } = await recapContext();
    const [person] = await db
      .select()
      .from(people)
      .where(eq(people.email, "recap-rae@example.com"));
    await db
      .update(people)
      .set({ email: null, phone: "+13055557777" })
      .where(eq(people.id, person.id));

    const sms = fakeSms();
    const { sent, provider: whatsapp } = fakeCourtesy({
      status: "sent",
      providerMessageId: "wamid.recap",
    });

    await sendDueRecaps(db, {
      now: afterTrip,
      emailProvider: fakeEmail().provider,
      smsProvider: sms.provider,
      whatsAppProviders: new Map([[shop.id, whatsapp]]),
      appOrigin: ORIGIN,
    });

    const mine = sent.filter((m) => m.to === "+13055557777");
    expect(mine).toHaveLength(1);
    expect(mine[0].body).toContain(`${ORIGIN}/recap/`);
    expect(sms.sent.filter((m) => m.to === "+13055557777")).toHaveLength(0);
    const rows = await rowsFor(db, bookingId);
    expect(rows[0]).toMatchObject({ status: "sent", providerMessageId: "wamid.recap" });
  });
});

/**
 * **A recap four hours after a night dive lands at 3 AM, in every zone.**
 *
 * The demo shop's own board carries a 7:30–11:00 PM night dive, so this is not
 * an edge case some market avoids — it is any shop that dives after dark. And
 * the daily reminder batch was worse: a fixed 14:00 UTC pass reached Singapore
 * at 22:00, Sydney at midnight, and Fiji at 03:00, every day (issue #697).
 *
 * Held, never dropped. A recap is due from `endsAt + 4h` onwards with no upper
 * bound, so the condition stays true until the hourly pass next runs inside the
 * shop's own hours.
 */
describe("recaps against the shop's civil hours", () => {
  /** The reef boat ties up at 6 PM local, so its recap comes due at 11 PM. */
  async function nightContext() {
    const ctx = await recapContext();
    await ctx.db
      .update(shops)
      .set({ sendWindowStartHour: 8, sendWindowEndHour: 20 })
      .where(eq(shops.id, ctx.shop.id));
    return ctx;
  }

  it("holds a recap that comes due in the middle of the night", async () => {
    const { db, bookingId, afterTrip } = await nightContext();

    const summary = await sendDueRecaps(db, {
      now: afterTrip,
      emailProvider: fakeEmail().provider,
      smsProvider: fakeSms().provider,
      appOrigin: "https://dive.day",
    });

    expect(summary.sent).toBe(0);
    // Held, not skipped: the two mean opposite things to whoever reads the log.
    expect(summary.held).toBeGreaterThan(0);
    // And nothing was recorded, so the diver has not silently lost their recap.
    expect(await rowsFor(db, bookingId)).toHaveLength(0);
  });

  it("sends the same recap once the window opens, without a second cadence firing", async () => {
    const { db, bookingId, afterTrip } = await nightContext();
    const email = fakeEmail();

    // The overnight pass holds it...
    await sendDueRecaps(db, {
      now: afterTrip,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: "https://dive.day",
    });
    // ...and the pass after breakfast sends it. Nine hours on from 11 PM local.
    const morning = new Date(afterTrip.getTime() + 9 * 60 * 60 * 1000);
    const summary = await sendDueRecaps(db, {
      now: morning,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: "https://dive.day",
    });

    // Counted on the booking, not on the run: the morning pass sweeps every
    // shop, and by then the rest of the seeded board is due too.
    expect(summary.sent).toBeGreaterThan(0);
    expect(summary.held).toBe(0);
    // Exactly one delivery row: holding must not have queued a second copy.
    expect(await rowsFor(db, bookingId)).toHaveLength(1);
  });
});
