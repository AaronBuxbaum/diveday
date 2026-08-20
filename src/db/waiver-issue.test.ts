import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";
import { cancelBooking, createBooking } from "./bookings";
import type { MedicalAnswers } from "./schema";
import { bookings, notificationDeliveries, people, waiverRecords } from "./schema";
import { upcomingTripsWithCounts } from "./trips";
import {
  emailFreshWaiverLink,
  issueAndDeliverPersonWaiver,
  issueAndDeliverWaiver,
  issueWaiverOnJoin,
} from "./waiver-issue";
import { completeWaiver, getWaiverForToken, issueWaiverRequest, saveWaiverDraft } from "./waivers";

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
  const { db, shop } = await seededShopContext();
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

    const { db, shop } = await seededShopContext();
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
        medicalAnswers: { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} },
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

  it("does not reissue over a signed waiver", async () => {
    const { db, shop, bookingId } = await seededBooking();
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
    await completeWaiver(db, issued.token, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} },
    });

    const result = await issueAndDeliverWaiver(db, shop.id, bookingId);
    expect(result).toMatchObject({ ok: false, reason: "already_completed" });
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
    // Issuing supersedes the record the diver tapped from, so the ordinary
    // token lookup gives up on it — a second tap (or a refresh) must still
    // reach the rescue rather than a dead end.
    expect(await getWaiverForToken(db, token, after)).toEqual({ state: "unavailable" });
    // While the replacement is still signable, a second tap reports that rather
    // than issuing over it and killing the link the diver is using.
    const whileLive = new Date(after.getTime() - 1);
    await expect(emailFreshWaiverLink(db, token, whileLive)).resolves.toBe("current_link_live");
    // Once the replacement has aged out too, the same dead URL rescues again —
    // the whole point of it staying resolvable.
    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("sent");
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

  it("refuses a cancelled booking", async () => {
    configureEmail();
    const { db, shop, bookingId, token, after } = await expiredLink();
    await cancelBooking(db, shop.id, bookingId);

    await expect(emailFreshWaiverLink(db, token, after)).resolves.toBe("unavailable");
  });

  it("reports a signature already on file instead of mailing a pointless link", async () => {
    configureEmail();
    const { db, shop, bookingId, token, after } = await expiredLink();
    const fresh = await issueWaiverRequest(db, { shopId: shop.id, bookingId });
    if (!fresh.ok) throw new Error(`issue failed: ${fresh.reason}`);
    await completeWaiver(db, fresh.token, {
      signerName: "Nora Quinn",
      agreed: true,
      medicalAnswers: { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} },
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
      medicalAnswers: { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} },
    });
    const result = await issueWaiverOnJoin(db, shop.id, bookingId);
    expect(result).toBeNull();
  });
});
