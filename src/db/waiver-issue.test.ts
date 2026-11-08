import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { and, eq, gt, isNotNull, isNull, ne } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { DEFAULT_WAIVER_BODY, WAIVER_SIGNATURE_VALIDITY_MS } from "@/lib/waivers";
import { fileScopedShopContext } from "@/test/db";
import { getDiverProfile } from "../features/divers/store";
import { shopStaffer } from "../test/substrate-fixtures/db/waivers-test-fixtures";
import { revokeBookingCapabilities, verifyBookingCapability } from "./booking-capabilities";
import { createBooking } from "./bookings";
import {
  createCourseForm,
  getCourseFormsForBooking,
  setCourseFormRequirements,
  signCourseForm,
} from "./course-forms";
import {
  applyProviderEmailEvent,
  bookingConfirmationMailState,
  recordNotificationDelivery,
} from "./notifications";
import { getBookingReadiness } from "./readiness";
import {
  bookingCapabilities,
  bookings,
  notificationDeliveries,
  people,
  trips,
  waiverRecords,
} from "./schema";
import { listStaff, upcomingTripsWithCounts } from "./trips";
import {
  emailFreshWaiverLink,
  issueAndDeliverPersonWaiver,
  issueAndDeliverWaiver,
  issueWaiverOnJoin,
  openJoinSignStep,
  sendReleasesOnceIdentityKnown,
  settleJoinWaiverDelivery,
} from "./waiver-issue";
import {
  completeWaiver,
  getDiverWaiverChannelStates,
  getDiverWaiverRequestStatus,
  issueWaiverRequest,
  recordWaiverTemplate,
  waiverLinkDoor,
} from "./waivers";

const { sesSend } = vi.hoisted(() => ({ sesSend: vi.fn() }));
vi.mock("@aws-sdk/client-sesv2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-sesv2")>();
  return {
    ...actual,
    SESv2Client: vi.fn().mockImplementation(function SESv2Client() {
      return { send: sesSend };
    }),
  };
});

async function seededBooking(email: string | null = "delivered@dive.day") {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email: email ?? "delivered@dive.day",
  });
  if (!outcome.ok) throw new Error(`booking failed: ${outcome.reason}`);
  if (email === null) {
    const [row] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, outcome.bookingId))
      .limit(1);
    if (row) await db.update(people).set({ email: null }).where(eq(people.id, row.personId));
  }
  return { db, shop, trip, bookingId: outcome.bookingId };
}

// One seeded database for the file and a rolled-back transaction per test
// (`fileScopedShopContext` in src/test/db.ts); tests roll back; demo shops send no mail.
const ctx = fileScopedShopContext({ realShop: true });

afterEach(() => {
  vi.unstubAllEnvs();
  sesSend.mockReset();
});

describe("issueAndDeliverWaiver", () => {
  it("issues and completes a person-scoped waiver without a booking", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "us-east-1");
    vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
    sesSend.mockResolvedValue({ MessageId: "person-waiver-message" });

    const { db, shop } = ctx;
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Unscheduled Diver", email: "unscheduled@dive.day" })
      .returning();
    if (!person) throw new Error("person insert failed");

    const result = await issueAndDeliverPersonWaiver(db, shop.id, person.id);
    expect(result).toMatchObject({
      ok: true,
      bookingId: null,
      delivery: "sent",
      diverName: "Unscheduled Diver",
    });
    if (!result.ok) throw new Error("person waiver issue failed");

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.shopId, shop.id),
          eq(waiverRecords.personId, person.id),
          eq(waiverRecords.status, "pending"),
          isNull(waiverRecords.supersededAt),
        ),
      );
    expect(record).toMatchObject({
      bookingId: null,
      personId: person.id,
      deliveryStatus: "sent",
    });

    // The week-long release link went to the diver's address and nowhere else.
    expect(result.token).toBeNull();
    const command = sesSend.mock.calls[0]?.[0] as SendEmailCommand;
    const token = String(command.input.Content?.Simple?.Body?.Html?.Data).match(
      /\/waivers\/([A-Za-z0-9_-]+)/,
    )?.[1];
    if (!token) throw new Error("no release link in the mail");
    const door = await waiverLinkDoor(db, token);
    if (door?.door !== "release") throw new Error(`release door expected, got ${door?.door}`);
    await expect(
      completeWaiver(db, door.key, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      }),
    ).resolves.toMatchObject({ ok: true, status: "completed" });
  });

  it("emails the link and reports it sent when delivery is configured", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "us-east-1");
    vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
    sesSend.mockResolvedValue({ MessageId: "ses-id" });

    const { db, shop, bookingId } = await seededBooking();
    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "sent", diverName: "Nora Quinn" });
    expect(sesSend).toHaveBeenCalledOnce();
    const [delivery] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.bookingId, bookingId));
    expect(delivery?.status).toBe("sent");
  });

  it("names an unconfigured provider, and hands a seat's link to nobody", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "");
    vi.stubEnv("SES_FROM_EMAIL", "");

    const { db, shop, bookingId } = await seededBooking();
    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "unconfigured", token: null });
  });

  it("names a missing APP_HOST as its own gap, not as an unconfigured provider", async () => {
    // Both end with staff handing the link over, but they point at different
    // settings. Reporting "no email provider configured" to a deployment whose
    // SES credentials are fine and whose APP_HOST is empty sends whoever is
    // debugging it to the wrong file.
    vi.stubEnv("APP_HOST", "");
    vi.stubEnv("SES_AWS_REGION", "us-east-1");
    vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");

    const { db, shop, bookingId } = await seededBooking();
    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "no_app_origin", token: null });
    // Nothing was attempted: there is no link to put in the mail.
    expect(sesSend).not.toHaveBeenCalled();
  });

  it("surfaces reserved test recipients without calling SES", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "us-east-1");
    vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");

    const { db, shop, bookingId } = await seededBooking("nora@example.com");
    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "test_recipient" });
    expect(sesSend).not.toHaveBeenCalled();
    const [delivery] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.bookingId, bookingId));
    expect(delivery?.status).toBe("failed");
    expect(delivery?.sendErrorCode).toBe("invalid_test_recipient");
    expect(delivery?.sendHttpStatus).toBeNull();
  });

  it("surfaces a provider failure distinctly from missing configuration", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "us-east-1");
    vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
    sesSend.mockRejectedValue(
      Object.assign(new Error("invalid sender"), {
        name: "MessageRejected",
        $metadata: { httpStatusCode: 403 },
      }),
    );

    const { db, shop, bookingId } = await seededBooking();
    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "failed", token: null });
    const [delivery] = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.bookingId, bookingId));
    expect(delivery?.status).toBe("failed");
    expect(delivery?.sendHttpStatus).toBe(403);
  });

  it("reports no_email when the diver has no address on file", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop, bookingId } = await seededBooking(null);
    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "no_email" });
  });

  it("texts the link over the shop's own WhatsApp when it has connected one", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop, trip, bookingId } = await seededBooking();
    const [row] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);
    if (!row) throw new Error("booking row missing");
    await db.update(people).set({ phone: "+13055550142" }).where(eq(people.id, row.personId));

    const whatsapp = {
      send: vi.fn().mockResolvedValue({ status: "sent", providerMessageId: "wa" }),
    };
    const sms = { send: vi.fn() };
    const result = await issueAndDeliverWaiver(db, shop.id, bookingId, {
      channel: "sms",
      textProviders: { whatsapp, sms },
    });

    expect(result).toMatchObject({ ok: true, delivery: "sent" });
    // One message, never both — the courtesy rule, exercised through the send
    // rather than trusted.
    expect(sms.send).not.toHaveBeenCalled();
    expect(whatsapp.send).toHaveBeenCalledOnce();
    // Nothing left the building by email: a "Text waiver" tap must not also mail
    // a copy the shop did not ask to send.
    expect(sesSend).not.toHaveBeenCalled();
    const body = whatsapp.send.mock.calls[0]?.[0]?.body ?? "";
    // The holder's own thread link, never a waiver link (issue #2743).
    expect(body).toMatch(/https:\/\/diveday\.example\/ready\/[^/\s]+\/waiver/);
    expect(body).not.toContain("/waivers/");
    // The departure is named: a diver with two boats this week needs to know
    // which release this is.
    expect(body).toContain(trip.title);
  });

  it("falls back to SMS, and reports no_phone when there is no dialable number", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop } = ctx;
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Textable Diver", phone: "+13055550143" })
      .returning();
    if (!person) throw new Error("person insert failed");

    const sms = { send: vi.fn().mockResolvedValue({ status: "sent", providerMessageId: "sns" }) };
    const texted = await issueAndDeliverPersonWaiver(db, shop.id, person.id, {
      channel: "sms",
      textProviders: { whatsapp: null, sms },
    });
    expect(texted).toMatchObject({ ok: true, delivery: "sent" });
    expect(sms.send).toHaveBeenCalledOnce();
    expect(sms.send.mock.calls[0]?.[0]?.body).toMatch(/ Reply STOP to opt out\.$/);

    // A local number has no unambiguous country code, so nothing is attempted
    // rather than texting whoever holds it in the wrong country.
    await db.update(people).set({ phone: "555-0143" }).where(eq(people.id, person.id));
    sms.send.mockClear();
    const refused = await issueAndDeliverPersonWaiver(db, shop.id, person.id, {
      channel: "sms",
      textProviders: { whatsapp: null, sms },
    });
    expect(refused).toMatchObject({ ok: true, delivery: "no_phone" });
    expect(sms.send).not.toHaveBeenCalled();
  });

  it("issues a link with nothing sent on the link channel, and records it as handed over", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "us-east-1");
    vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
    sesSend.mockResolvedValue({ MessageId: "ses-id" });

    const { db, shop } = ctx;
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Counter Diver", email: "counter@dive.day" })
      .returning();
    if (!person) throw new Error("person insert failed");

    const result = await issueAndDeliverPersonWaiver(db, shop.id, person.id, {
      channel: "link",
      actorPersonId: await shopStaffer(db, shop.id),
    });

    expect(result).toMatchObject({ ok: true, delivery: "link_only" });
    // A staffer asking for the URL is not asking for an email as well.
    expect(sesSend).not.toHaveBeenCalled();
    // Recorded as handed over, so the diver's record reads "awaiting signature"
    // rather than claiming a delivery failed that nobody attempted.
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.personId, person.id),
          eq(waiverRecords.status, "pending"),
          isNull(waiverRecords.supersededAt),
        ),
      );
    expect(record).toMatchObject({ deliveryStatus: "sent", deliveryProviderMessageId: null });
  });

  it("does not reissue over a signed waiver", async () => {
    const { db, shop, bookingId } = await seededBooking();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    await completeWaiver(db, issued.key, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);
    expect(result).toMatchObject({ ok: false, reason: "already_completed" });
  });

  /**
   * **A release that lapsed is one the diver signs again** (dive-domain review
   * of the test-suite layer 1). The seat reads `waiver_lapsed`, not "not sent",
   * and the send mints a fresh link instead of calling the lapsed signature
   * standing; once it is out, the seat reads as awaiting it.
   */
  it("reissues over a signature on this booking that has lapsed", async () => {
    const { db, shop, bookingId } = await seededBooking();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    await completeWaiver(db, issued.key, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    const longAgo = new Date(nowDate().getTime() - WAIVER_SIGNATURE_VALIDITY_MS - 60_000);
    await db
      .update(waiverRecords)
      .set({ signedAt: longAgo, completedAt: longAgo })
      .where(eq(waiverRecords.id, issued.recordId));

    const lapsed = await getBookingReadiness(db, shop.id, bookingId);
    const codes = lapsed?.blockers.map((blocker) => blocker.code) ?? [];
    expect(codes).toContain("waiver_lapsed");
    expect(codes).not.toContain("waiver_not_sent");

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);
    expect(result).toMatchObject({ ok: true });
    const after = await getBookingReadiness(db, shop.id, bookingId);
    expect(after?.status).toBe("blocked");
    expect(after?.blockers.map((blocker) => blocker.code)).toContain("waiver_pending");
    // The diver record still says they signed once and it lapsed, not that
    // nothing is on file, while the fresh link is out.
    const [seat] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    if (!seat) throw new Error("seat missing");
    const profile = await getDiverProfile(db, shop.id, seat.personId);
    expect(profile?.waiver).toEqual({ state: "lapsed", signedAt: longAgo });
  });

  /**
   * **A send on one seat never turns another seat's lapse into "not sent"**
   * (dive-domain-expert run 4, D2). The terms changed, so the diver's clean
   * release lapsed on every seat; staff sending a fresh link on one seat
   * supersedes it there, and the diver's other seat still reads
   * `waiver_lapsed` (glossary: Sign once) — the diver signed once, it lapsed.
   */
  it("keeps a second seat on waiver_lapsed after a send on the first supersedes the release", async () => {
    const { db, shop, trip, bookingId } = await seededBooking();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    await completeWaiver(db, issued.key, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    const [other] = (await upcomingTripsWithCounts(db, shop.id)).filter((t) => t.id !== trip.id);
    if (!other) throw new Error("second demo trip missing");
    const second = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: other.id,
      fullName: "Nora Quinn",
      email: "delivered@dive.day",
    });
    if (!second.ok) throw new Error(`booking failed: ${second.reason}`);
    const terms = await recordWaiverTemplate(db, {
      shopId: shop.id,
      body: `${DEFAULT_WAIVER_BODY}\n\nRevised terms.`,
      material: true,
    });
    expect(terms.versioned).toBe(true);

    const sent = await issueAndDeliverWaiver(db, shop.id, bookingId);
    expect(sent).toMatchObject({ ok: true });
    const [signed] = await db
      .select({ supersededAt: waiverRecords.supersededAt })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, issued.recordId));
    expect(signed?.supersededAt).not.toBeNull();

    const codes =
      (await getBookingReadiness(db, shop.id, second.bookingId))?.blockers.map(
        (blocker) => blocker.code,
      ) ?? [];
    expect(codes).toContain("waiver_lapsed");
    expect(codes).not.toContain("waiver_not_sent");
  });

  it("sends a fresh link on joining when the diver's only release has lapsed", async () => {
    const { db, shop, trip, bookingId } = await seededBooking();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    await completeWaiver(db, issued.key, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    const longAgo = new Date(nowDate().getTime() - WAIVER_SIGNATURE_VALIDITY_MS - 60_000);
    await db
      .update(waiverRecords)
      .set({ signedAt: longAgo, completedAt: longAgo })
      .where(eq(waiverRecords.id, issued.recordId));
    const [other] = (await upcomingTripsWithCounts(db, shop.id)).filter((t) => t.id !== trip.id);
    if (!other) throw new Error("second demo trip missing");
    const joined = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: other.id,
      fullName: "Nora Quinn",
      email: "delivered@dive.day",
    });
    if (!joined.ok) throw new Error(`booking failed: ${joined.reason}`);

    const sent = await issueWaiverOnJoin(db, shop.id, joined.bookingId);
    expect(sent).toMatchObject({ ok: true });
  });

  /**
   * **One "send the waiver" covers the course's forms** (ADR
   * 20261008-course-forms). A student whose release is signed but whose
   * course still asks for a form must not read as "nothing to send": the same
   * act hands over their forms page, on the same channel, by the same rules.
   */
  describe("with course forms owed", () => {
    async function courseSeat() {
      const { db, shop } = ctx;
      // A seat the seed already holds on a course session: booking one fresh
      // would meet the course's prerequisite gate, which is not this test's.
      const [seat] = await db
        .select({ bookingId: bookings.id, personId: bookings.personId, courseId: trips.courseId })
        .from(bookings)
        .innerJoin(trips, eq(trips.id, bookings.tripId))
        .where(
          and(
            eq(bookings.shopId, shop.id),
            isNotNull(trips.courseId),
            ne(bookings.status, "cancelled"),
            ne(trips.status, "cancelled"),
            gt(trips.startsAt, nowDate()),
          ),
        )
        .limit(1);
      if (!seat?.courseId) throw new Error("demo course seat missing");
      await db
        .update(people)
        .set({ fullName: "Nora Quinn", email: "delivered@dive.day", dateOfBirth: "1990-04-02" })
        .where(eq(people.id, seat.personId));
      await db
        .update(bookings)
        .set({ identityUnconfirmedAt: null })
        .where(eq(bookings.id, seat.bookingId));
      const trip = { courseId: seat.courseId };
      const outcome = { bookingId: seat.bookingId };
      const [staff] = await listStaff(db, shop.id);
      if (!staff) throw new Error("demo staff missing");
      const form = await createCourseForm(db, {
        shopId: shop.id,
        title: "Course release",
        body: "I will follow the instructor's plan for every in-water session of this course.",
        actorPersonId: staff.person.id,
      });
      await setCourseFormRequirements(db, {
        mayNarrow: true,
        shopId: shop.id,
        courseId: trip.courseId,
        formIds: [form.id],
      });
      const issued = await issueWaiverRequest(db, {
        shopId: shop.id,
        bookingId: outcome.bookingId,
      });
      // The seed may already hold this diver's signed release; either way the
      // release is signed before the send under test.
      if (issued.ok) {
        const completed = await completeWaiver(db, issued.key, {
          signerName: "Nora Quinn",
          agreed: true,
          medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
        });
        expect(completed).toMatchObject({ ok: true });
      } else {
        expect(issued.reason).toBe("already_completed");
      }
      return { db, shop, bookingId: outcome.bookingId };
    }

    it("hands over the forms page when the release is already signed", async () => {
      vi.stubEnv("APP_HOST", "https://diveday.test");
      const { db, shop, bookingId } = await courseSeat();

      const result = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "link" });

      expect(result).toMatchObject({ ok: true, bookingId, delivery: "link_only" });
      if (!result.ok) throw new Error("unreachable");
      expect(result.path).toBe(`/ready/${result.token}/forms`);
      // A forms-only link for this very booking: it is not a readiness link,
      // so whoever it is handed to cannot open the diver's trip prep with it.
      expect(
        await verifyBookingCapability(db, { token: result.token ?? "", purpose: "course_forms" }),
      ).toMatchObject({ bookingId, shopId: shop.id });
      expect(
        await verifyBookingCapability(db, { token: result.token ?? "", purpose: "readiness" }),
      ).toBeNull();
    });

    it("hands back the same forms link on a second send while it is live", async () => {
      vi.stubEnv("APP_HOST", "https://diveday.test");
      vi.stubEnv("SECRET_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
      const { db, shop, bookingId } = await courseSeat();

      const first = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "link" });
      const second = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "link" });

      if (!first.ok || !second.ok) throw new Error("expected two forms links");
      expect(second.token).toBe(first.token);
      const live = await db
        .select({ id: bookingCapabilities.id })
        .from(bookingCapabilities)
        .where(
          and(
            eq(bookingCapabilities.bookingId, bookingId),
            eq(bookingCapabilities.purpose, "course_forms"),
            isNull(bookingCapabilities.revokedAt),
          ),
        );
      expect(live).toHaveLength(1);
    });

    it("mints a fresh forms link once the live one is revoked", async () => {
      vi.stubEnv("APP_HOST", "https://diveday.test");
      vi.stubEnv("SECRET_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
      const { db, shop, bookingId } = await courseSeat();
      const first = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "link" });
      await revokeBookingCapabilities(db, { shopId: shop.id, bookingId, purpose: "course_forms" });

      const second = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "link" });

      if (!first.ok || !second.ok) throw new Error("expected two forms links");
      expect(second.token).not.toBe(first.token);
      const dead = await db
        .select({ revoked: isNotNull(bookingCapabilities.revokedAt) })
        .from(bookingCapabilities)
        .where(
          and(
            eq(bookingCapabilities.bookingId, bookingId),
            eq(bookingCapabilities.purpose, "course_forms"),
            isNotNull(bookingCapabilities.revokedAt),
          ),
        );
      expect(dead).toEqual([{ revoked: true }]);
    });

    it("emails the forms link with its own words, never 'your link expired'", async () => {
      vi.stubEnv("APP_HOST", "https://diveday.example");
      vi.stubEnv("SES_AWS_REGION", "us-east-1");
      vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
      vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
      vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
      sesSend.mockResolvedValue({ MessageId: "ses-course-forms" });
      const { db, shop, bookingId } = await courseSeat();

      const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

      expect(result).toMatchObject({ ok: true, delivery: "sent" });
      const command = sesSend.mock.calls.at(-1)?.[0] as SendEmailCommand | undefined;
      const subject = command?.input.Content?.Simple?.Subject?.Data ?? "";
      const text = command?.input.Content?.Simple?.Body?.Text?.Data ?? "";
      expect(subject).toContain("Course forms to sign");
      expect(text).toContain("/forms");
      expect(text).not.toContain("expired");
    });

    it("reports the release as signed once the forms are signed too", async () => {
      const { db, shop, bookingId } = await courseSeat();
      const forms = await getCourseFormsForBooking(db, shop.id, bookingId);
      const [form] = forms?.outstanding ?? [];
      const signed = await signCourseForm(db, {
        shopId: shop.id,
        bookingId,
        formVersionId: form?.versionId ?? "",
        signerName: "Nora Quinn",
        agreed: true,
      });
      expect(signed).toMatchObject({ ok: true });

      expect(await issueAndDeliverWaiver(db, shop.id, bookingId)).toMatchObject({
        ok: false,
        reason: "already_completed",
      });
    });
  });
});

describe("emailFreshWaiverLink", () => {
  /** A diver with no seat, a release link to their release, and the instant it is dead. */
  async function expiredLink(email: string | null = "delivered@dive.day") {
    const { db, shop } = ctx;
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Nora Quinn", email })
      .returning();
    if (!person) throw new Error("person insert failed");
    const issued = await issueWaiverRequest(db, { shopId: shop.id, personId: person.id });
    if (!issued.ok || issued.key.kind !== "release") throw new Error("expected a release link");
    const after = new Date(issued.key.expiresAt.getTime() + 1);
    return { db, shop, person, recordId: issued.recordId, token: issued.key.token, after };
  }

  function configureEmail() {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "us-east-1");
    vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
    sesSend.mockResolvedValue({ MessageId: "ses-id" });
    return sesSend;
  }

  it("mails a replacement to the address on file and never hands one back", async () => {
    const send = configureEmail();
    const { db, token, after } = await expiredLink();

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("sent");
    expect(send).toHaveBeenCalledOnce();
    // The whole point of the flow: a stale bearer URL triggers a delivery to
    // its owner and nothing more. Anything token-shaped in the return value
    // would hand fresh access to whoever is holding the dead link.
    const command = send.mock.calls[0]?.[0] as SendEmailCommand;
    expect(command.input.Destination?.ToAddresses).toEqual(["delivered@dive.day"]);
    const html = String(command.input.Content?.Simple?.Body?.Html?.Data);
    expect(html).toMatch(/\/waivers\/[A-Za-z0-9_-]+/);
    expect(html).not.toContain(token);
  });

  it("stays usable from the same dead URL after the first send", async () => {
    configureEmail();
    const { db, token, after } = await expiredLink();

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("sent");
    expect(await waiverLinkDoor(db, token, { now: after })).toBeNull();
    // While the replacement is live, a second tap reports that rather than
    // issuing over it and killing the link the diver is using.
    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("current_link_live");
    // Once the replacement has died too, the same dead URL sends another.
    const afterReplacement = new Date(after.getTime() + 7 * 24 * 60 * 60 * 1000 + 1);
    await expect(emailFreshWaiverLink(db, token, afterReplacement)).resolves.toBe("sent");
  });

  it("refuses for a person the shop removed", async () => {
    configureEmail();
    const { db, person, token, after } = await expiredLink();
    await db.update(people).set({ deletedAt: after }).where(eq(people.id, person.id));

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("unavailable");
  });

  it("reports a signature already on file instead of mailing a pointless link", async () => {
    configureEmail();
    const { db, shop, person, recordId, token, after } = await expiredLink();
    // The stale link's release was replaced and the replacement signed: the
    // diver signed something the stale URL no longer points at.
    await db
      .update(waiverRecords)
      .set({ supersededAt: after })
      .where(eq(waiverRecords.id, recordId));
    const fresh = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: person.id,
      now: after,
    });
    if (!fresh.ok) throw new Error(`issue failed: ${fresh.reason}`);
    await completeWaiver(db, fresh.key, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      now: after,
    });

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("already_signed");
  });

  it("says so plainly when there is no address to send to", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, token, after } = await expiredLink(null);

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("no_email");
  });

  it("never claims mail is on its way when nothing left the building", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "");
    vi.stubEnv("SES_FROM_EMAIL", "");
    const { db, token, after } = await expiredLink();

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("failed");
  });

  it("refuses a live link, a counter link and a token that matches nothing", async () => {
    const send = configureEmail();
    const { db, shop, person, token, after } = await expiredLink();
    await expect(emailFreshWaiverLink(db, token)).resolves.toBe("unavailable");
    await expect(emailFreshWaiverLink(db, `${token}tampered`, after)).resolves.toBe("unavailable");
    const copied = await issueAndDeliverPersonWaiver(db, shop.id, person.id, {
      channel: "link",
      actorPersonId: await shopStaffer(db, shop.id),
    });
    if (!copied.ok || !copied.token) throw new Error("copy link refused");
    const dead = new Date(nowDate().getTime() + 31 * 60 * 1000);
    await expect(emailFreshWaiverLink(db, copied.token, dead)).resolves.toBe("unavailable");
    expect(send).not.toHaveBeenCalled();
  });
});

describe("issueWaiverOnJoin", () => {
  async function pendingWaiverCount(
    db: Awaited<ReturnType<typeof seededBooking>>["db"],
    bookingId: string,
  ) {
    const rows = await db
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, bookingId));
    return rows.length;
  }

  it("issues a waiver the moment a diver joins a waiver-required trip", async () => {
    const { db, shop, bookingId } = await seededBooking();
    const result = await issueWaiverOnJoin(db, shop.id, bookingId);
    expect(result).toMatchObject({ ok: true });
    expect(await pendingWaiverCount(db, bookingId)).toBe(1);
  });

  it("is idempotent — a second join does not stack a second link", async () => {
    const { db, shop, bookingId } = await seededBooking();
    await issueWaiverOnJoin(db, shop.id, bookingId);
    const second = await issueWaiverOnJoin(db, shop.id, bookingId);
    expect(second).toBeNull();
    expect(await pendingWaiverCount(db, bookingId)).toBe(1);
  });

  it("skips a diver already covered by a current signature (sign-once)", async () => {
    const { db, shop, bookingId } = await seededBooking();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    await completeWaiver(db, issued.key, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    const result = await issueWaiverOnJoin(db, shop.id, bookingId);
    expect(result).toBeNull();
  });

  it("sends nothing on a held seat, and owes nothing until the desk confirms (issue #2125)", async () => {
    // The link would open on a record that may be somebody else's. Once the
    // desk confirms, the same call sends it.
    const { db, shop, bookingId } = await seededBooking();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Tom Quinn" })
      .where(eq(bookings.id, bookingId));
    expect(await issueWaiverOnJoin(db, shop.id, bookingId)).toBeNull();
    expect(await pendingWaiverCount(db, bookingId)).toBe(0);

    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null, identityBookedAs: null })
      .where(eq(bookings.id, bookingId));
    expect(await issueWaiverOnJoin(db, shop.id, bookingId)).toMatchObject({ ok: true });
  });
});

describe("bookingConfirmationMailState", () => {
  async function confirmationSent(
    db: Awaited<ReturnType<typeof seededBooking>>["db"],
    shopId: string,
    bookingId: string,
  ) {
    await recordNotificationDelivery(db, {
      shopId,
      bookingId,
      kind: "booking_confirmation",
      delivery: { status: "sent", providerMessageId: "ses-confirmation" },
    });
  }

  it("promises nothing until the confirmation actually left", async () => {
    const { db, shop, bookingId } = await seededBooking();
    expect(await bookingConfirmationMailState(db, shop.id, bookingId)).toBe("none");
  });

  it("names the waiver only when the confirmation carried an unsigned link", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop, bookingId } = await seededBooking();
    await confirmationSent(db, shop.id, bookingId);
    expect(await bookingConfirmationMailState(db, shop.id, bookingId)).toBe("confirmation");
    const step = await openJoinSignStep(db, shop.id, bookingId);
    if (!step) throw new Error("no sign step");
    await settleJoinWaiverDelivery(db, {
      shopId: shop.id,
      bookingId,
      step,
      confirmationSent: true,
    });
    expect(await bookingConfirmationMailState(db, shop.id, bookingId)).toBe(
      "confirmationWithWaiver",
    );
  });
});

/**
 * What the diver record's three delivery buttons wear.
 *
 * The point of the per-channel record, and the thing the single
 * `waiver_records.delivery_status` column could never do: a shop that emails a
 * diver and then texts them has two facts to show, not one, and neither may
 * quietly overwrite the other.
 */
describe("getDiverWaiverChannelStates", () => {
  async function personWithNoWaiver() {
    const { db, shop, bookingId } = await seededBooking();
    const [row] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);
    if (!row) throw new Error("test setup: booking has no person");
    return { db, shop, personId: row.personId };
  }

  it("knows nothing about a diver with no outstanding link", async () => {
    const { db, shop, personId } = await personWithNoWaiver();
    await expect(getDiverWaiverChannelStates(db, shop.id, personId)).resolves.toEqual({
      email: "unknown",
      sms: "unknown",
      link: "unknown",
    });
  });

  it("keeps each channel's outcome when a second channel is tried", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "");
    vi.stubEnv("SES_FROM_EMAIL", "");
    const { db, shop, personId } = await personWithNoWaiver();

    // No provider wired up, so the email cannot go out.
    await issueAndDeliverPersonWaiver(db, shop.id, personId, { channel: "email" });
    await expect(getDiverWaiverChannelStates(db, shop.id, personId)).resolves.toMatchObject({
      email: "not_configured",
      sms: "unknown",
    });

    // Taking the link is a different act on the same record, and it must not
    // erase what we already knew about the mail.
    await issueAndDeliverPersonWaiver(db, shop.id, personId, {
      channel: "link",
      actorPersonId: await shopStaffer(db, shop.id),
    });
    await expect(getDiverWaiverChannelStates(db, shop.id, personId)).resolves.toMatchObject({
      email: "not_configured",
      link: "copied",
    });
  });

  /**
   * The link channel stores `sent` — the columns answer "is there a live
   * link", and there is — and must never read as sent. A staffer taking the
   * URL means *they* have it; where it went next happened outside DiveDay.
   */
  it("calls a taken link copied, never sent", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop, personId } = await personWithNoWaiver();
    await issueAndDeliverPersonWaiver(db, shop.id, personId, {
      channel: "link",
      actorPersonId: await shopStaffer(db, shop.id),
    });
    await expect(getDiverWaiverChannelStates(db, shop.id, personId)).resolves.toEqual({
      email: "unknown",
      sms: "unknown",
      link: "copied",
    });
  });
});

/**
 * The one status the diver record's waiver card reads. Copying a link used to
 * land here as `not_signed`, which the card words as "Link sent" — a delivery
 * we never made and cannot see.
 */
describe("getDiverWaiverRequestStatus", () => {
  async function personWithNoWaiver() {
    const { db, shop, bookingId } = await seededBooking();
    const [row] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);
    if (!row) throw new Error("test setup: booking has no person");
    return { db, shop, personId: row.personId };
  }

  it("says nothing has been sent before anything is issued", async () => {
    const { db, shop, personId } = await personWithNoWaiver();
    await expect(getDiverWaiverRequestStatus(db, shop.id, personId)).resolves.toBe("not_sent");
  });

  it("separates a copied link from a delivered one", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    const { db, shop, personId } = await personWithNoWaiver();
    await issueAndDeliverPersonWaiver(db, shop.id, personId, {
      channel: "link",
      actorPersonId: await shopStaffer(db, shop.id),
    });
    await expect(getDiverWaiverRequestStatus(db, shop.id, personId)).resolves.toBe("link_copied");
  });

  it("reports a real send even when a link was taken afterwards", async () => {
    // The record's own delivery columns are the *latest* attempt whichever way
    // it went, so the copy overwrites them — and an email that genuinely left
    // DiveDay must still be what the card reports.
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "us-east-1");
    vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
    sesSend.mockResolvedValue({ MessageId: "ses-delivered" });

    const { db, shop, personId } = await personWithNoWaiver();
    await issueAndDeliverPersonWaiver(db, shop.id, personId, { channel: "email" });
    await issueAndDeliverPersonWaiver(db, shop.id, personId, {
      channel: "link",
      actorPersonId: await shopStaffer(db, shop.id),
    });
    await expect(getDiverWaiverRequestStatus(db, shop.id, personId)).resolves.toBe("not_signed");
  });

  it("lets a provider's verdict outrank our own send result", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "us-east-1");
    vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
    sesSend.mockResolvedValue({ MessageId: "ses-bounced" });

    const { db, shop, personId } = await personWithNoWaiver();
    await issueAndDeliverPersonWaiver(db, shop.id, personId, { channel: "email" });
    await expect(getDiverWaiverChannelStates(db, shop.id, personId)).resolves.toMatchObject({
      email: "sent",
    });

    // "We handed it to SES" and "SES says it bounced" are both true; only the
    // second one helps a staffer decide to try another way.
    await applyProviderEmailEvent(db, {
      providerMessageId: "ses-bounced",
      status: "bounced",
      detail: "mailbox does not exist",
      occurredAt: nowDate(),
    });
    await expect(getDiverWaiverChannelStates(db, shop.id, personId)).resolves.toMatchObject({
      email: "failed",
    });
  });
});

/**
 * **Confirm and split say what happened to the release** (dive-domain review
 * of issue #2125). A held seat was sent nothing; once the desk knows who it
 * is the release goes out, and the notice says whether it reached anyone, so
 * a diver nobody could reach is handed a device or paper at the counter
 * rather than assumed to be signing at home. Every seat a split moved is sent
 * one too (security review).
 */
describe("sendReleasesOnceIdentityKnown", () => {
  function stubSes() {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "us-east-1");
    vi.stubEnv("SES_AWS_ACCESS_KEY_ID", "AKIA_TEST");
    vi.stubEnv("SES_AWS_SECRET_ACCESS_KEY", "test-secret");
    vi.stubEnv("SES_FROM_EMAIL", "shop@diveday.example");
    sesSend.mockResolvedValue({ MessageId: "identity-release" });
  }

  it("says sent when every seat's release went out", async () => {
    stubSes();
    const { db, shop, bookingId } = await seededBooking();
    expect(await sendReleasesOnceIdentityKnown(db, shop.id, [bookingId])).toBe("sent");
  });

  it("says ready when a seat has nowhere to send it, so the counter hands it over", async () => {
    stubSes();
    const { db, shop, bookingId } = await seededBooking(null);
    expect(await sendReleasesOnceIdentityKnown(db, shop.id, [bookingId])).toBe("ready");
  });

  it("says not_needed when no seat owes a release", async () => {
    const { db, shop, bookingId } = await seededBooking();
    await issueWaiverOnJoin(db, shop.id, bookingId);
    expect(await sendReleasesOnceIdentityKnown(db, shop.id, [bookingId])).toBe("not_needed");
  });
});
