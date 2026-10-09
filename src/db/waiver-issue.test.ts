import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { and, eq, gt, isNotNull, isNull, ne } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { WAIVER_LINK_TTL_MS } from "@/lib/waivers";
import { fileScopedShopContext } from "@/test/db";
import { revokeBookingCapabilities, verifyBookingCapability } from "./booking-capabilities";
import { cancelBooking, createBooking } from "./bookings";
import {
  createCourseForm,
  getCourseFormsForBooking,
  setCourseFormRequirements,
  signCourseForm,
} from "./course-forms";
import { applyProviderEmailEvent } from "./notifications";
import type { MedicalAnswers } from "./schema";
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
  sendReleasesOnceIdentityKnown,
} from "./waiver-issue";
import {
  completeWaiver,
  getDiverWaiverChannelStates,
  getDiverWaiverRequestStatus,
  getWaiverForToken,
  issueWaiverRequest,
  saveWaiverDraft,
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
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

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

    await expect(
      completeWaiver(db, result.token, {
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

  it("surfaces the private link when email is not configured", async () => {
    vi.stubEnv("APP_HOST", "https://diveday.example");
    vi.stubEnv("SES_AWS_REGION", "");
    vi.stubEnv("SES_FROM_EMAIL", "");

    const { db, shop, bookingId } = await seededBooking();
    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);

    expect(result).toMatchObject({ ok: true, delivery: "unconfigured" });
    if (result.ok) expect(result.token).toBeTruthy();
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

    expect(result).toMatchObject({ ok: true, delivery: "no_app_origin" });
    // Nothing was attempted: there is no link to put in the mail.
    expect(sesSend).not.toHaveBeenCalled();
    if (result.ok) expect(result.token).toBeTruthy();
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

    expect(result).toMatchObject({ ok: true, delivery: "failed" });
    if (result.ok) expect(result.token).toBeTruthy();
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
      channel: "text",
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
    expect(body).toContain(`https://diveday.example/waivers/${result.ok ? result.token : ""}`);
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
      channel: "text",
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
      channel: "text",
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

    const result = await issueAndDeliverPersonWaiver(db, shop.id, person.id, { channel: "link" });

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
    await completeWaiver(db, issued.token, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);
    expect(result).toMatchObject({ ok: false, reason: "already_completed" });
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
        const completed = await completeWaiver(db, issued.token, {
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
        await verifyBookingCapability(db, { token: result.token, purpose: "course_forms" }),
      ).toMatchObject({ bookingId, shopId: shop.id });
      expect(
        await verifyBookingCapability(db, { token: result.token, purpose: "readiness" }),
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

    it("mints a fresh forms link once the live one is revoked, and keeps no copy of the dead one", async () => {
      vi.stubEnv("APP_HOST", "https://diveday.test");
      vi.stubEnv("SECRET_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
      const { db, shop, bookingId } = await courseSeat();
      const first = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "link" });
      await revokeBookingCapabilities(db, { shopId: shop.id, bookingId, purpose: "course_forms" });

      const second = await issueAndDeliverWaiver(db, shop.id, bookingId, { channel: "link" });

      if (!first.ok || !second.ok) throw new Error("expected two forms links");
      expect(second.token).not.toBe(first.token);
      const dead = await db
        .select({ tokenSealed: bookingCapabilities.tokenSealed })
        .from(bookingCapabilities)
        .where(
          and(
            eq(bookingCapabilities.bookingId, bookingId),
            eq(bookingCapabilities.purpose, "course_forms"),
            isNotNull(bookingCapabilities.revokedAt),
          ),
        );
      expect(dead).toEqual([{ tokenSealed: null }]);
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
  /** An issued link, and the instant it is already dead. */
  async function expiredLink(email: string | null = "delivered@dive.day") {
    const context = await seededBooking(email);
    const issued = await issueWaiverRequest(context.db, {
      shopId: context.shop.id,
      bookingId: context.bookingId,
    });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    return { ...context, token: issued.token, after: issued.expiresAt };
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
    const html = command.input.Content?.Simple?.Body?.Html?.Data;
    expect(String(html)).toContain("/waivers/");
    expect(String(html)).not.toContain(token);
  });

  it("stays usable from the same dead URL after the first send", async () => {
    configureEmail();
    const { db, token, after } = await expiredLink();

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("sent");
    // The dead link could not be reused (it had already expired), so a fresh one
    // was minted and this record superseded — the ordinary token lookup gives up
    // on it, and a second tap (or a refresh) must still reach the rescue rather
    // than a dead end.
    expect(await getWaiverForToken(db, token, after)).toEqual({ state: "unavailable" });
    // While the replacement is still signable, a second tap reports that rather
    // than issuing over it and killing the link the diver is using.
    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("current_link_live");
    // Once the replacement has aged out too, the same dead URL rescues again —
    // the whole point of it staying resolvable.
    const afterReplacement = new Date(after.getTime() + WAIVER_LINK_TTL_MS + 1);
    await expect(emailFreshWaiverLink(db, token, afterReplacement)).resolves.toBe("sent");
  });

  it("refuses when a fresher link is still live, and leaves that link and its draft alone", async () => {
    // The attack: a stale waiver URL is its own capability, and issuing
    // supersedes every non-superseded record for the booking. Without a guard,
    // whoever holds the dead link could reissue at will — killing the link the
    // diver is actually working in and taking their half-filled medical
    // answers with it. A remote wipe button, triggerable by a forwarded email.
    const send = configureEmail();
    const { db, shop, bookingId, token, after } = await expiredLink();
    // Issued at the instant the first link dies, so at `after` the diver's own
    // link is comfortably live while the one in the attacker's hands is not.
    const live = await issueWaiverRequest(db, { shopId: shop.id, bookingId, now: after });
    if (!live.ok) throw new Error(`issue failed: ${live.reason}`);
    const draft: MedicalAnswers = {
      questionnaireId: "rstc",
      questionnaireVersion: 1,
      responses: { heart: false },
    };
    expect(
      await saveWaiverDraft(db, live.token, {
        signerName: "Nora Quinn",
        acknowledged: true,
        medicalAnswers: draft,
      }),
    ).toBe(true);

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("current_link_live");

    // Nothing was issued and nothing was mailed…
    expect(send).not.toHaveBeenCalled();
    const records = await db
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, bookingId));
    expect(records).toHaveLength(2);
    // …and the diver's live link and saved work are exactly as they left them.
    const state = await getWaiverForToken(db, live.token, after);
    expect(state.state).toBe("available");
    expect(state.state === "available" ? state.record.draftMedicalAnswers : null).toEqual(draft);
    expect(state.state === "available" ? state.record.draftSignerName : null).toBe("Nora Quinn");
  });

  it("refuses a canceled booking", async () => {
    configureEmail();
    const { db, shop, bookingId, token, after } = await expiredLink();
    await cancelBooking(db, shop.id, bookingId);

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("unavailable");
  });

  it("reports a signature already on file instead of mailing a pointless link", async () => {
    configureEmail();
    const { db, shop, bookingId, token, after } = await expiredLink();
    // Issued at the instant the first died, so this is a genuinely new link
    // rather than the same one handed back — the diver signs something the
    // stale URL no longer points at.
    const fresh = await issueWaiverRequest(db, { shopId: shop.id, bookingId, now: after });
    if (!fresh.ok) throw new Error(`issue failed: ${fresh.reason}`);
    await completeWaiver(db, fresh.token, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
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

  it("refuses a link that is still live, so this is never a second way to sign", async () => {
    configureEmail();
    const { db, token } = await expiredLink();
    // `after` deliberately not used: the link has not aged out yet.
    await expect(emailFreshWaiverLink(db, token)).resolves.toBe("unavailable");
  });

  it("refuses a token that matches nothing", async () => {
    const { db, token, after } = await expiredLink();
    await expect(emailFreshWaiverLink(db, `${token}tampered`, after)).resolves.toBe("unavailable");
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
    await completeWaiver(db, issued.token, {
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
      text: "unknown",
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
      text: "unknown",
    });

    // Taking the link is a different act on the same record, and it must not
    // erase what we already knew about the mail.
    await issueAndDeliverPersonWaiver(db, shop.id, personId, { channel: "link" });
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
    await issueAndDeliverPersonWaiver(db, shop.id, personId, { channel: "link" });
    await expect(getDiverWaiverChannelStates(db, shop.id, personId)).resolves.toEqual({
      email: "unknown",
      text: "unknown",
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
    await issueAndDeliverPersonWaiver(db, shop.id, personId, { channel: "link" });
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
    await issueAndDeliverPersonWaiver(db, shop.id, personId, { channel: "link" });
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
