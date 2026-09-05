import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEFAULT_DOCK_DAY_RHYTHM } from "@/lib/diver-planning";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { seededShopContext } from "@/test/db";
import { fakeEmail, fakeSms, fakeCourtesy as fakeWhatsApp } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import {
  createCertification,
  deleteCertification,
  getBookingReadiness,
  reviewCertification,
} from "./readiness";
import { sendDueReminders } from "./reminders";
import { notificationDeliveries, people, shops, waiverRecords } from "./schema";
import { setShopDockDayRhythm } from "./shops";
import { upcomingTripsWithCounts, updateTripConditions } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

// The seeded shop already has bookings on several future trips, so
// sendDueReminders (a global cron) touches more than the one under test. Every
// assertion here filters to this test's booking, phone, or delivery rows.

const PHONE = "+13055559999";
const ORIGIN = "https://diveday.example";

async function reminderContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Pat Party",
      email: "reminders-pat@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  const [person] = await db
    .select()
    .from(people)
    .where(eq(people.email, "reminders-pat@example.com"));
  // **This shop sends around the clock**, so the cases below are about the
  // cadence buckets and nothing else. A reminder is also held outside the
  // shop's own civil hours (`src/lib/send-window.ts`, issue #697), which has
  // its own cases at the bottom of this file; mixing the two would test the
  // bucket arithmetic and the clock at the same time and prove neither.
  await db
    .update(shops)
    .set({ sendWindowStartHour: 0, sendWindowEndHour: 24 })
    .where(eq(shops.id, shop.id));
  // 100h out lands in the 7-day bucket (T-168h .. T-24h).
  const inWeekBucket = new Date(reef.startsAt.getTime() - 100 * 60 * 60 * 1000);
  return { db, shop, reef, bookingId, personId: person.id, inWeekBucket };
}

function rowsFor(db: Awaited<ReturnType<typeof reminderContext>>["db"], bookingId: string) {
  return db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.bookingId, bookingId));
}

const emailsFor = (email: ReturnType<typeof fakeEmail>, bookingId: string) =>
  email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId);

describe("sendDueReminders", () => {
  it("emails the due 7-day reminder, records it, and is a no-op on a second run", async () => {
    const { db, bookingId, inWeekBucket } = await reminderContext();
    const email = fakeEmail();
    const sms = fakeSms();
    const opts = {
      now: inWeekBucket,
      emailProvider: email.provider,
      smsProvider: sms.provider,
      appOrigin: null,
    };

    await sendDueReminders(db, opts);
    expect(emailsFor(email, bookingId)).toHaveLength(1);
    expect(emailsFor(email, bookingId)[0].kind).toBe("trip_reminder_7d");
    const rows = await rowsFor(db, bookingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "trip_reminder_7d", status: "sent" });

    // Dedup: the delivery row already exists, so this booking never re-sends.
    await sendDueReminders(db, opts);
    expect(emailsFor(email, bookingId)).toHaveLength(1);
    expect(await rowsFor(db, bookingId)).toHaveLength(1);
  });

  it("sends nothing for a booking before any cadence opens", async () => {
    const { db, bookingId, reef } = await reminderContext();
    const email = fakeEmail();
    await sendDueReminders(db, {
      now: new Date(reef.startsAt.getTime() - 300 * 60 * 60 * 1000),
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: null,
    });
    expect(emailsFor(email, bookingId)).toHaveLength(0);
    expect(await rowsFor(db, bookingId)).toHaveLength(0);
  });

  it("adds a courtesy SMS when the diver has a textable phone and email sent", async () => {
    const { db, personId, inWeekBucket } = await reminderContext();
    await db.update(people).set({ phone: PHONE }).where(eq(people.id, personId));
    const sms = fakeSms();
    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: fakeEmail().provider,
      smsProvider: sms.provider,
      appOrigin: null,
    });
    const mine = sms.sent.filter((m) => m.to === PHONE);
    expect(mine).toHaveLength(1);
  });

  it("sends the courtesy text over the shop's WhatsApp when it has connected one", async () => {
    const { db, shop, personId, inWeekBucket } = await reminderContext();
    await db.update(people).set({ phone: PHONE }).where(eq(people.id, personId));
    const sms = fakeSms();
    const whatsapp = fakeWhatsApp();

    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: fakeEmail().provider,
      smsProvider: sms.provider,
      whatsAppProviders: new Map([[shop.id, whatsapp.provider]]),
      appOrigin: null,
    });

    const viaWhatsApp = whatsapp.sent.filter((m) => m.to === PHONE);
    expect(viaWhatsApp).toHaveLength(1);
    // The shop name rides along because WhatsApp needs it as a template variable.
    expect(viaWhatsApp[0].shopName).toBeTruthy();
    // Never both — one courtesy message per diver, per reminder.
    expect(sms.sent.filter((m) => m.to === PHONE)).toHaveLength(0);
  });

  it("falls back to SMS when the shop's WhatsApp rejects the diver's number", async () => {
    const { db, shop, personId, inWeekBucket } = await reminderContext();
    await db.update(people).set({ phone: PHONE }).where(eq(people.id, personId));
    const sms = fakeSms();
    // 131026: the diver simply is not on WhatsApp — the common real-world case.
    const whatsapp = fakeWhatsApp({ status: "failed", retryable: false, errorCode: "131026" });

    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: fakeEmail().provider,
      smsProvider: sms.provider,
      whatsAppProviders: new Map([[shop.id, whatsapp.provider]]),
      appOrigin: null,
    });

    expect(sms.sent.filter((m) => m.to === PHONE)).toHaveLength(1);
  });

  it("tracks a phone-only diver from a WhatsApp send when that is the channel used", async () => {
    const { db, shop, bookingId, personId, inWeekBucket } = await reminderContext();
    await db.update(people).set({ email: null, phone: PHONE }).where(eq(people.id, personId));
    const whatsapp = fakeWhatsApp({ status: "sent", providerMessageId: "wamid.only" });

    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: fakeEmail().provider,
      smsProvider: fakeSms({ status: "not_configured" }).provider,
      whatsAppProviders: new Map([[shop.id, whatsapp.provider]]),
      appOrigin: null,
    });

    const [row] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.bookingId, bookingId));
    expect(row.status).toBe("sent");
    expect(row.providerMessageId).toBe("wamid.only");
  });

  it("tracks a phone-only diver from the SMS result, not email", async () => {
    const { db, bookingId, personId, inWeekBucket } = await reminderContext();
    await db.update(people).set({ email: null, phone: PHONE }).where(eq(people.id, personId));
    const email = fakeEmail();
    const sms = fakeSms({ status: "sent", providerMessageId: "SM_only" });

    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: email.provider,
      smsProvider: sms.provider,
      appOrigin: null,
    });
    expect(emailsFor(email, bookingId)).toHaveLength(0);
    const rows = await rowsFor(db, bookingId);
    expect(rows[0]).toMatchObject({ status: "sent", providerMessageId: "SM_only" });
  });

  it("carries the shop's dock call time and readiness fields into the reminder", async () => {
    const { db, shop, bookingId, inWeekBucket } = await reminderContext();
    await setShopDockDayRhythm(db, shop.id, { ...DEFAULT_DOCK_DAY_RHYTHM, dockCallMinutes: 45 });
    const email = fakeEmail();
    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: null,
    });
    const [reminder] = emailsFor(email, bookingId);
    expect(reminder.kind).toBe("trip_reminder_7d");
    if (reminder.kind !== "trip_reminder_7d") return;
    expect(reminder.dockCallMinutes).toBe(45);
    expect(Array.isArray(reminder.outstanding)).toBe(true);
    expect(typeof reminder.medicalReview).toBe("boolean");
  });

  it("nudges an expired waiver link, and never sends the dead link back", async () => {
    const { db, shop, bookingId, personId, inWeekBucket } = await reminderContext();
    await db.update(people).set({ phone: PHONE }).where(eq(people.id, personId));
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId,
      now: inWeekBucket,
    });
    if (!issued.ok) throw new Error(`waiver issue failed: ${issued.reason}`);
    // Age the signing link out. This is the ordinary case, not an edge one: a
    // link lives a week, and a booking is often made months ahead.
    await db
      .update(waiverRecords)
      .set({ expiresAt: new Date(inWeekBucket.getTime() - 1000) })
      .where(eq(waiverRecords.id, issued.recordId));

    const email = fakeEmail();
    const sms = fakeSms();
    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: email.provider,
      smsProvider: sms.provider,
      appOrigin: ORIGIN,
    });

    const [reminder] = emailsFor(email, bookingId);
    expect(reminder.kind).toBe("trip_reminder_7d");
    if (reminder.kind !== "trip_reminder_7d") return;
    // Enrolled in the cadence: an aged-out link leaves the diver as unsigned as
    // one that never arrived, so it earns the same nudge (2026-08-03).
    // (This diver also has no cert card on file, so the list is not a
    // singleton — the point is that the expired waiver is now *in* it.)
    expect(reminder.outstanding).toContain("waiver_expired");
    // Never a dead link: the only URL either channel carries is a `readiness`
    // capability minted on this run, whose page mints a replacement signing
    // link on tap. The expired waiver token must appear in neither.
    expect(reminder.readinessUrl).toMatch(new RegExp(`^${ORIGIN}/ready/`));
    expect(reminder.readinessUrl).not.toContain(issued.token);
    const [text] = sms.sent.filter((m) => m.to === PHONE);
    expect(text.body).toContain("Your waiver link expired");
    expect(text.body).not.toContain(issued.token);
    expect(text.body).not.toContain("/waivers/");
  });

  it("enriches the night-before brief with conditions, packing, contact, and first-timer voice", async () => {
    const { db, shop, reef, bookingId, inWeekBucket } = await reminderContext();
    await updateTripConditions(db, shop.id, reef.id, {
      conditionsSummary: "Warm and glassy — a perfect first-dive day",
      waterTemperatureC: 27,
      visibilityMeters: 20,
      surfaceConditions: "calm",
    });
    await db.update(shops).set({ contactPhone: "+13055551234" }).where(eq(shops.id, shop.id));
    const email = fakeEmail();
    // 10h out lands in the 24-hour bucket, so the reminder is the full brief.
    const dayNow = new Date(reef.startsAt.getTime() - 10 * 60 * 60 * 1000);
    expect(dayNow.getTime()).toBeGreaterThan(inWeekBucket.getTime());

    await sendDueReminders(db, {
      now: dayNow,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: null,
    });

    const [reminder] = emailsFor(email, bookingId);
    expect(reminder.kind).toBe("trip_reminder_24h");
    if (reminder.kind !== "trip_reminder_24h") return;
    expect(reminder.brief?.forecast).toContain("Warm and glassy");
    expect(reminder.brief?.forecast).toContain("27°C");
    expect(reminder.brief?.bring?.length).toBeGreaterThan(0);
    expect(reminder.brief?.whoToText).toBe("+13055551234");
    // Pat has never dived with the shop before — the softer voice applies.
    expect(reminder.brief?.firstTimerNote).toContain("First boat dive");
  });

  it("writes the brief's conditions in the shop's own units", async () => {
    // Same stored row as the test above (Celsius and metres on disk); only the
    // shop's two display settings differ, and the diver's brief must follow
    // them or it will disagree with the trip page it links to.
    const { db, shop, reef, bookingId } = await reminderContext();
    await updateTripConditions(db, shop.id, reef.id, {
      waterTemperatureC: 27,
      visibilityMeters: 20,
    });
    await db
      .update(shops)
      .set({ temperatureUnit: "fahrenheit", depthUnit: "feet" })
      .where(eq(shops.id, shop.id));
    const email = fakeEmail();

    await sendDueReminders(db, {
      now: new Date(reef.startsAt.getTime() - 10 * 60 * 60 * 1000),
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: null,
    });

    const [reminder] = emailsFor(email, bookingId);
    if (reminder.kind !== "trip_reminder_24h") throw new Error("expected the night-before brief");
    expect(reminder.brief?.forecast).toContain("81°F");
    expect(reminder.brief?.forecast).toContain("66 ft");
    expect(reminder.brief?.forecast).not.toContain("27°C");
  });

  it("keeps the 7-day reminder a light nudge with no brief", async () => {
    const { db, bookingId, inWeekBucket } = await reminderContext();
    const email = fakeEmail();
    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: null,
    });
    const [reminder] = emailsFor(email, bookingId);
    expect(reminder.kind).toBe("trip_reminder_7d");
    if (reminder.kind !== "trip_reminder_7d") return;
    expect("brief" in reminder).toBe(false);
  });

  it("records not_configured for a booking with no reachable channel", async () => {
    const { db, bookingId, inWeekBucket } = await reminderContext();
    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: fakeEmail({ status: "not_configured" }).provider,
      smsProvider: fakeSms({ status: "not_configured" }).provider,
      appOrigin: null,
    });
    const rows = await rowsFor(db, bookingId);
    expect(rows[0].status).toBe("not_configured");
  });
});

describe("sendDueReminders locale (docs ADR 20260731-per-person-notification-locale)", () => {
  it("uses the shop's locale when the diver has never told us what they read", async () => {
    const { db, shop, bookingId, personId, inWeekBucket } = await reminderContext();
    await db.update(shops).set({ defaultLocale: "es-ES" }).where(eq(shops.id, shop.id));
    await db.update(people).set({ phone: PHONE, locale: null }).where(eq(people.id, personId));
    const email = fakeEmail();
    const sms = fakeSms();
    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: email.provider,
      smsProvider: sms.provider,
      appOrigin: null,
    });
    expect(emailsFor(email, bookingId)[0]).toMatchObject({ locale: "es-ES" });
  });

  it("prefers the diver's own recorded language over the shop's default", async () => {
    // Ingrid at a Cozumel shop: the shop speaks Spanish, she does not, and a
    // booking she made herself recorded that. The reminder follows her, not
    // the shop.
    const { db, shop, bookingId, personId, inWeekBucket } = await reminderContext();
    await db.update(shops).set({ defaultLocale: "es-ES" }).where(eq(shops.id, shop.id));
    await db.update(people).set({ phone: PHONE, locale: "en-US" }).where(eq(people.id, personId));
    const email = fakeEmail();
    const sms = fakeSms();
    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: email.provider,
      smsProvider: sms.provider,
      appOrigin: null,
    });
    expect(emailsFor(email, bookingId)[0]).toMatchObject({ locale: "en-US" });
  });

  it("keeps both channels in one language — the SMS never diverges from the email", async () => {
    const { db, shop, personId, inWeekBucket } = await reminderContext();
    await db.update(shops).set({ defaultLocale: "en-US" }).where(eq(shops.id, shop.id));
    await db.update(people).set({ phone: PHONE, locale: "es-ES" }).where(eq(people.id, personId));
    const sms = fakeSms();
    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: fakeEmail().provider,
      smsProvider: sms.provider,
      appOrigin: null,
    });
    const mine = sms.sent.filter((m) => m.to === PHONE);
    expect(mine).toHaveLength(1);
    // Spanish body, from an English shop, because Spanish is what she reads.
    expect(mine[0].body).toContain("Preséntate en el muelle");
    expect(mine[0].body).not.toContain("Please be at the dock");
  });

  it("ignores a stored value DiveDay carries no bundle for", async () => {
    const { db, shop, bookingId, personId, inWeekBucket } = await reminderContext();
    await db.update(shops).set({ defaultLocale: "es-ES" }).where(eq(shops.id, shop.id));
    await db.update(people).set({ locale: "de-DE" }).where(eq(people.id, personId));
    const email = fakeEmail();
    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: null,
    });
    expect(emailsFor(email, bookingId)[0]).toMatchObject({ locale: "es-ES" });
  });
});

/**
 * **A fixed 14:00 UTC batch cannot serve more than one longitude.**
 *
 * It is 10am in Florida, 22:00 in Singapore, midnight in Sydney and 03:00 in
 * Fiji — so a shop in the picker's own Asia-Pacific group texted every diver
 * sailing tomorrow in the middle of the night, every day (issue #697).
 *
 * Held, not dropped, and safely so: a cadence bucket is hours wide — the
 * 24-hour reminder is due from T-24h right up to departure — and any 24-hour
 * span contains a whole daytime window, so skipping the quiet passes cannot
 * close the bucket.
 */
describe("reminders against the shop's civil hours", () => {
  async function quietHoursContext() {
    const ctx = await reminderContext();
    await ctx.db
      .update(shops)
      .set({ sendWindowStartHour: 8, sendWindowEndHour: 20 })
      .where(eq(shops.id, ctx.shop.id));
    return ctx;
  }

  /** The same instant in the run-up, moved to a given shop-local hour. */
  function atLocalHour(reference: Date, hour: number) {
    const local = new Date(reference);
    // The seeded shop is America/New_York; in July that is UTC-4.
    local.setUTCHours(hour + 4, 0, 0, 0);
    return local;
  }

  it("holds a reminder that comes due at two in the morning", async () => {
    const { db, bookingId, inWeekBucket } = await quietHoursContext();

    const summary = await sendDueReminders(db, {
      now: atLocalHour(inWeekBucket, 2),
      emailProvider: fakeEmail().provider,
      smsProvider: fakeSms().provider,
      whatsAppProviders: new Map(),
      appOrigin: "https://dive.day",
    });

    expect(summary.held).toBeGreaterThan(0);
    expect(await rowsFor(db, bookingId)).toHaveLength(0);
  });

  it("sends it that morning instead, exactly once", async () => {
    const { db, bookingId, inWeekBucket } = await quietHoursContext();
    const email = fakeEmail();
    const send = (now: Date) =>
      sendDueReminders(db, {
        now,
        emailProvider: email.provider,
        smsProvider: fakeSms().provider,
        whatsAppProviders: new Map(),
        appOrigin: "https://dive.day",
      });

    // Three quiet passes, then the first one after the window opens. The
    // hourly cadence is what makes this the real sequence rather than a
    // contrivance.
    await send(atLocalHour(inWeekBucket, 2));
    await send(atLocalHour(inWeekBucket, 3));
    await send(atLocalHour(inWeekBucket, 7));
    expect(await rowsFor(db, bookingId)).toHaveLength(0);

    const morning = await send(atLocalHour(inWeekBucket, 9));

    expect(morning.held).toBe(0);
    // One row, not four: the held passes must not have queued anything.
    expect(await rowsFor(db, bookingId)).toHaveLength(1);
  });
});

/**
 * **The state-aware rhythm** (issue #1177, delight report D17).
 *
 * This is a suppression, so its regression is silence: a diver who hears
 * nothing and misses a boat, with no error and no red test. The first case
 * below is therefore the anti-silence one, and it is the one that matters —
 * the seeded booking has no signed waiver and no cert card, so the 7-day email
 * must go out exactly as it always did.
 */
describe("sendDueReminders and the reminder rhythm", () => {
  /** Everything the seeded reef trip gates on, cleared for this one diver. */
  async function makeReady(ctx: Awaited<ReturnType<typeof reminderContext>>) {
    const { db, shop, bookingId, personId } = ctx;
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok) throw new Error(`waiver issue failed: ${issued.reason}`);
    const signed = await completeWaiver(db, issued.token, {
      signerName: "Pat Party",
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    if (!signed.ok) throw new Error(`waiver signing failed: ${signed.reason}`);

    const card = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "open_water",
      identifier: "PADI-OW-RHYTHM-1",
    });
    if (!card) throw new Error("certification not created");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
    });

    // Proven ready rather than assumed: if the seed's gates ever grow, this
    // throws here instead of quietly turning every case below into a tautology.
    const readiness = await getBookingReadiness(db, shop.id, bookingId);
    expect(readiness).toEqual({ status: "ready", blockers: [] });
    return card;
  }

  const pass = (
    db: Awaited<ReturnType<typeof reminderContext>>["db"],
    now: Date,
    email = fakeEmail(),
  ) =>
    sendDueReminders(db, {
      now,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      whatsAppProviders: new Map(),
      appOrigin: null,
    });

  it("still sends the 7-day email when the diver has a waiver and a card outstanding", async () => {
    const { db, shop, bookingId, inWeekBucket } = await reminderContext();
    // The state this whole feature must never suppress.
    expect((await getBookingReadiness(db, shop.id, bookingId))?.status).not.toBe("ready");
    const email = fakeEmail();

    await pass(db, inWeekBucket, email);

    expect(emailsFor(email, bookingId)).toHaveLength(1);
    expect(await rowsFor(db, bookingId)).toHaveLength(1);
  });

  it("holds the 7-day nudge for a diver with nothing left to do, and records nothing", async () => {
    // The `settled` count is compared against an identical run whose diver was
    // left un-ready, because the seeded shop has other bookings on the same
    // board and a bare count would be about all of them.
    const control = await reminderContext();
    const controlSummary = await pass(control.db, control.inWeekBucket);

    const ctx = await reminderContext();
    await makeReady(ctx);
    const email = fakeEmail();
    const summary = await pass(ctx.db, ctx.inWeekBucket, email);

    expect(emailsFor(email, ctx.bookingId)).toHaveLength(0);
    // No delivery row at all: a falsified one would stop the nudge re-arming.
    expect(await rowsFor(ctx.db, ctx.bookingId)).toHaveLength(0);
    expect(summary.settled).toBe(controlSummary.settled + 1);
    expect(summary.sent).toBe(controlSummary.sent - 1);
    expect(summary.failed).toBe(controlSummary.failed);
  });

  it("re-arms inside the same week when the diver stops being ready", async () => {
    const ctx = await reminderContext();
    const card = await makeReady(ctx);
    const email = fakeEmail();

    await pass(ctx.db, ctx.inWeekBucket, email);
    expect(emailsFor(email, ctx.bookingId)).toHaveLength(0);

    // The card comes off the record an hour later, still inside the week-wide
    // bucket. Nothing was written by the suppressed pass, so the cadence is
    // still un-sent and the next hourly pass picks it up.
    await deleteCertification(ctx.db, { shopId: ctx.shop.id, certificationId: card.id });
    await pass(ctx.db, new Date(ctx.inWeekBucket.getTime() + 60 * 60 * 1000), email);

    expect(emailsFor(email, ctx.bookingId)).toHaveLength(1);
    expect(await rowsFor(ctx.db, ctx.bookingId)).toHaveLength(1);
  });

  it("sends the 24-hour reminder to a fully ready diver anyway", async () => {
    // Its utility is the dock call and the conditions, not the to-do list.
    const ctx = await reminderContext();
    await makeReady(ctx);
    const email = fakeEmail();
    const dockDay = new Date(ctx.reef.startsAt.getTime() - 6 * 60 * 60 * 1000);

    await pass(ctx.db, dockDay, email);

    expect(emailsFor(email, ctx.bookingId)).toHaveLength(1);
    expect(emailsFor(email, ctx.bookingId)[0].kind).toBe("trip_reminder_24h");
  });

  it("counts a settled diver with no reachable channel as settled, never as failed", async () => {
    // Pins the order of the two checks: the suppression runs before the
    // no-email-no-phone branch, so a diver who needed no message is not
    // reported to the shop as an unreachable one.
    const control = await reminderContext();
    const controlSummary = await pass(control.db, control.inWeekBucket);

    const ctx = await reminderContext();
    await makeReady(ctx);
    await ctx.db
      .update(people)
      .set({ email: null, phone: null })
      .where(eq(people.id, ctx.personId));

    const summary = await pass(ctx.db, ctx.inWeekBucket);

    expect(await rowsFor(ctx.db, ctx.bookingId)).toHaveLength(0);
    expect(summary.settled).toBe(controlSummary.settled + 1);
    expect(summary.failed).toBe(controlSummary.failed);
  });
});
