import type { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { describe, expect, it, vi } from "vitest";
import { bookingConfirmationEmail, waitlistInviteEmail, waiverRequestEmail } from "./email";
import {
  APP_ORIGIN,
  checkPublicHost,
  notificationIdempotencyKey,
  notificationProviderFromEnvironment,
  notificationSchema,
  notify,
  publicAppUrl,
  recipientLocale,
  sesNotificationProvider,
} from "./index";

const sesConfig = {
  region: "us-east-1",
  from: "Blue Mantis <bookings@ses.dive.day>",
  accessKeyId: "AKIA_TEST",
  secretAccessKey: "test-secret",
};

const booking = {
  kind: "booking_confirmation" as const,
  bookingId: "00000000-0000-4000-8000-000000000001",
  shopId: "00000000-0000-4000-8000-000000000010",
  to: "delivered+booking@dive.day",
  locale: "en-US" as const,
  diverName: "Nora Quinn",
  shopName: "Blue Mantis",
  tripTitle: "Two-Tank Reef",
  startsAt: new Date("2026-08-01T12:00:00.000Z"),
  endsAt: new Date("2026-08-01T15:00:00.000Z"),
  timezone: "America/New_York",
};

describe("bookingConfirmationEmail", () => {
  it("folds the readiness link into the confirmation when one is supplied", () => {
    const email = bookingConfirmationEmail({
      ...booking,
      readinessUrl: "https://diveday.example/ready/abc.def",
    });
    expect(email.text).toContain("Track what's left before you sail");
    expect(email.text).toContain("https://diveday.example/ready/abc.def");
    expect(email.html).toContain('href="https://diveday.example/ready/abc.def"');
  });

  it("omits the readiness line entirely when there is no link (no dead 'coming soon')", () => {
    const email = bookingConfirmationEmail(booking);
    expect(email.text).not.toContain("Track what's left");
    expect(email.html).not.toContain("Track what's left");
  });
});

describe("notify", () => {
  it("sends a booking confirmation through SES and returns its message id", async () => {
    const client = { send: vi.fn().mockResolvedValue({ MessageId: "ses-email-id" }) };
    const provider = sesNotificationProvider(sesConfig, { client });

    await expect(notify(booking, provider)).resolves.toEqual({
      status: "sent",
      providerMessageId: "ses-email-id",
    });

    const command = client.send.mock.calls[0]?.[0] as SendEmailCommand;
    expect(command.input).toMatchObject({
      Destination: { ToAddresses: ["delivered+booking@dive.day"] },
      Content: {
        Simple: {
          Subject: { Data: "You're on the boat — Two-Tank Reef", Charset: "UTF-8" },
        },
      },
    });
  });

  it("rejects a reserved test domain locally without calling SES", async () => {
    const client = { send: vi.fn() };
    const provider = sesNotificationProvider(sesConfig, { client });

    await expect(notify({ ...booking, to: "nora@example.com" }, provider)).resolves.toEqual({
      status: "failed",
      retryable: false,
      errorCode: "invalid_test_recipient",
      detail: expect.stringContaining("example.com"),
    });
    expect(client.send).not.toHaveBeenCalled();
  });

  it("never sends seeded demo.com recipients to SES", async () => {
    const client = { send: vi.fn() };
    const provider = sesNotificationProvider(sesConfig, { client });

    await expect(notify({ ...booking, to: "marcus@demo.com" }, provider)).resolves.toMatchObject({
      status: "failed",
      retryable: false,
      errorCode: "invalid_test_recipient",
    });
    expect(client.send).not.toHaveBeenCalled();
  });

  it("does not attempt delivery when production email configuration is absent", async () => {
    const provider = notificationProviderFromEnvironment({});

    await expect(notify(booking, provider)).resolves.toEqual({ status: "not_configured" });
  });
});

describe("notificationIdempotencyKey", () => {
  it("keys a booking confirmation by bookingId alone by default", () => {
    expect(notificationIdempotencyKey(booking)).toBe(
      "booking-confirmation/00000000-0000-4000-8000-000000000001",
    );
  });

  it("keys a reschedule confirmation by confirmedAt, not just bookingId (Codex finding)", () => {
    // A reschedule can reactivate the same bookingId a much earlier
    // confirmation already used — without `confirmedAt` distinguishing the
    // two sends, a provider's own idempotency window would replay the first
    // (stale) response instead of delivering this one.
    expect(
      notificationIdempotencyKey({
        ...booking,
        confirmedAt: new Date("2026-08-02T09:00:00.000Z"),
      }),
    ).toBe("booking-confirmation/00000000-0000-4000-8000-000000000001/2026-08-02T09:00:00.000Z");
  });

  it("uses the waiver record as the idempotency boundary for a private link", () => {
    expect(
      notificationIdempotencyKey({
        kind: "waiver_request",
        waiverRecordId: "00000000-0000-4000-8000-000000000002",
        bookingId: "00000000-0000-4000-8000-000000000001",
        shopId: "00000000-0000-4000-8000-000000000010",
        to: "delivered+waiver@dive.day",
        locale: "en-US",
        diverName: "Nora Quinn",
        shopName: "Blue Mantis",
        tripTitle: "Two-Tank Reef",
        completionUrl: "https://diveday.example/waivers/private-token",
        expiresAt: new Date("2026-08-02T12:00:00.000Z"),
        timezone: "America/New_York",
      }),
    ).toBe("waiver-request/00000000-0000-4000-8000-000000000002");
  });

  it("keys a wait-list invite by its stamp so a genuine re-invite is a fresh send", () => {
    expect(
      notificationIdempotencyKey({
        kind: "waitlist_invite",
        waitlistEntryId: "00000000-0000-4000-8000-000000000003",
        shopId: "00000000-0000-4000-8000-000000000010",
        to: "delivered+waitlist@dive.day",
        locale: "en-US",
        diverName: "Nora Quinn",
        shopName: "Blue Mantis",
        tripTitle: "Two-Tank Reef",
        startsAt: new Date("2026-08-01T12:00:00.000Z"),
        endsAt: new Date("2026-08-01T15:00:00.000Z"),
        timezone: "America/New_York",
        bookingUrl: "https://diveday.example/s/blue-mantis/trips/trip-1",
        invitedAt: new Date("2026-07-21T10:00:00.000Z"),
        unsubscribeUrl: "https://diveday.example/unsubscribe/tok_abc123",
      }),
    ).toBe("waitlist-invite/00000000-0000-4000-8000-000000000003/2026-07-21T10:00:00.000Z");
  });

  it("keys a welcome email by the account, once ever", () => {
    expect(
      notificationIdempotencyKey({
        kind: "welcome",
        userAccountId: "00000000-0000-4000-8000-000000000020",
        shopId: "00000000-0000-4000-8000-000000000010",
        to: "delivered+welcome@dive.day",
        locale: "en-US",
        ownerName: "Pat Diver",
        shopName: "Blue Mantis",
        signInUrl: "https://diveday.example/sign-in",
      }),
    ).toBe("welcome/00000000-0000-4000-8000-000000000020");
  });

  it("keys email verification by the token row's id, not the raw token", () => {
    const key = notificationIdempotencyKey({
      kind: "email_verification",
      userAccountId: "00000000-0000-4000-8000-000000000020",
      tokenId: "00000000-0000-4000-8000-000000000030",
      shopId: "00000000-0000-4000-8000-000000000010",
      to: "delivered+verification@dive.day",
      locale: "en-US",
      ownerName: "Pat Diver",
      verifyUrl: "https://diveday.example/verify/raw-token-should-not-appear",
      expiresAt: new Date("2026-07-29T12:00:00.000Z"),
      timezone: "America/New_York",
    });
    expect(key).toBe("email-verification/00000000-0000-4000-8000-000000000030");
    expect(key).not.toContain("raw-token-should-not-appear");
  });

  it("keys a password-reset request by the token row's id", () => {
    expect(
      notificationIdempotencyKey({
        kind: "password_reset_request",
        userAccountId: "00000000-0000-4000-8000-000000000020",
        tokenId: "00000000-0000-4000-8000-000000000031",
        shopId: "00000000-0000-4000-8000-000000000010",
        to: "delivered+reset@dive.day",
        locale: "en-US",
        ownerName: "Pat Diver",
        resetUrl: "https://diveday.example/reset-password/raw-token-should-not-appear",
        expiresAt: new Date("2026-07-26T13:00:00.000Z"),
        timezone: "America/New_York",
      }),
    ).toBe("password-reset-request/00000000-0000-4000-8000-000000000031");
  });

  it("keys a password-changed notice by its own timestamp so a second reset is a fresh send", () => {
    expect(
      notificationIdempotencyKey({
        kind: "password_changed",
        userAccountId: "00000000-0000-4000-8000-000000000020",
        shopId: "00000000-0000-4000-8000-000000000010",
        to: "delivered+changed@dive.day",
        locale: "en-US",
        ownerName: "Pat Diver",
        changedAt: new Date("2026-07-26T13:00:00.000Z"),
      }),
    ).toBe("password-changed/00000000-0000-4000-8000-000000000020/2026-07-26T13:00:00.000Z");
  });

  it("keys a demo-try alert by the minted slug, which is the entry's identity", () => {
    // Every demo entry mints its own shop under a freshly generated identity,
    // so the slug already distinguishes one try from the next — no timestamp,
    // and a double-submitted CTA that reached the same shop converges on one
    // send instead of mailing the founder twice about one visitor.
    expect(
      notificationIdempotencyKey({
        kind: "demo_started_alert",
        shopId: "00000000-0000-4000-8000-000000000010",
        to: "alerts@dive.day",
        shopSlug: "coral-cove-divers-a1b2c3",
        role: "captain",
        source: "pricing",
      }),
    ).toBe("demo-started-alert/coral-cove-divers-a1b2c3");
  });
});

describe("the demo-try alert's schema (docs ADR 20260805-demo-try-alerts)", () => {
  const alert = {
    kind: "demo_started_alert" as const,
    shopId: "00000000-0000-4000-8000-000000000010",
    to: "alerts@dive.day",
    shopSlug: "coral-cove-divers-a1b2c3",
    role: "owner" as const,
    source: "home-hero",
  };

  it("accepts the five fields it is allowed to carry", () => {
    expect(notificationSchema.parse(alert)).toMatchObject(alert);
  });

  it("strips anything else a call site tries to attach", () => {
    // The point of parsing at the boundary on *this* kind: it is an outbound
    // message about somebody who never identified themselves, so a call site
    // that starts passing an IP or a user agent along must not have it reach
    // the provider. Zod objects are strip-by-default; this pins that.
    const parsed = notificationSchema.parse({
      ...alert,
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      ownerEmail: "dana@coral-cove-divers-a1b2c3.demo.invalid",
    });
    expect(parsed).not.toHaveProperty("ip");
    expect(parsed).not.toHaveProperty("userAgent");
    expect(parsed).not.toHaveProperty("ownerEmail");
  });

  it("refuses a role outside the demo roster", () => {
    expect(() => notificationSchema.parse({ ...alert, role: "regulator" })).toThrow();
  });
});

describe("sesNotificationProvider (ADR 20260802-ses-adapter-and-webhook)", () => {
  it("sends through the injected SES client and returns its message id", async () => {
    const client = { send: vi.fn().mockResolvedValue({ MessageId: "ses-message-id" }) };
    const provider = sesNotificationProvider(sesConfig, { client });

    await expect(notify(booking, provider)).resolves.toEqual({
      status: "sent",
      providerMessageId: "ses-message-id",
    });
    expect(client.send).toHaveBeenCalledTimes(1);
    const command = client.send.mock.calls[0]?.[0] as SendEmailCommand;
    expect(command.input).toMatchObject({
      FromEmailAddress: "Blue Mantis <bookings@ses.dive.day>",
      Destination: { ToAddresses: ["delivered+booking@dive.day"] },
      Content: {
        Simple: {
          Subject: { Data: "You're on the boat — Two-Tank Reef", Charset: "UTF-8" },
        },
      },
    });
  });

  it("never calls SES for a reserved test recipient", async () => {
    const client = { send: vi.fn() };
    const provider = sesNotificationProvider(sesConfig, { client });

    await expect(notify({ ...booking, to: "diver@example.com" }, provider)).resolves.toMatchObject({
      status: "failed",
      retryable: false,
      errorCode: "invalid_test_recipient",
    });
    expect(client.send).not.toHaveBeenCalled();
  });

  it("treats a response with no MessageId as a retryable failure", async () => {
    const client = { send: vi.fn().mockResolvedValue({}) };
    const provider = sesNotificationProvider(sesConfig, { client });

    await expect(notify(booking, provider)).resolves.toEqual({
      status: "failed",
      retryable: true,
      errorCode: "invalid_response",
    });
  });

  it("marks a thrown 4xx SES error as non-retryable and surfaces its code", async () => {
    const error = Object.assign(new Error("Email address is not verified"), {
      name: "MessageRejected",
      $metadata: { httpStatusCode: 400 },
    });
    const client = { send: vi.fn().mockRejectedValue(error) };
    const provider = sesNotificationProvider(sesConfig, { client });

    await expect(notify(booking, provider)).resolves.toEqual({
      status: "failed",
      retryable: false,
      httpStatus: 400,
      errorCode: "MessageRejected",
      detail: "Email address is not verified",
    });
  });

  // A 403 whose resource ARN names a personal mailbox is the SES *sandbox*, not a
  // misconfigured sender: a pre-verified recipient is an identity too, and a send is
  // authorized against every identity it touches. The sender user is granted
  // `ses.dive.day` and the configuration set alone, so the recipient's own identity is
  // what the denial names — reading it as a bad `SES_FROM_EMAIL` sends an operator after
  // the wrong thing, which is why docs/engineering/ses-email-runbook.md's troubleshooting
  // table gives the sender case and this one separate rows. Either way the address may
  // never reach the log line.
  it("keeps the refused identity in the failure detail but out of the log line", async () => {
    const error = Object.assign(
      new Error(
        "User `arn:aws:iam::417160702652:user/diveday-ses-sender' is not authorized to perform `ses:SendEmail' on resource `arn:aws:ses:us-east-1:417160702652:identity/diver@gmail.com'",
      ),
      { name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } },
    );
    const client = { send: vi.fn().mockRejectedValue(error) };
    const provider = sesNotificationProvider(sesConfig, { client });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const delivery = await notify(booking, provider);
    // The operator-facing failure row keeps the address — it is the whole diagnosis.
    expect(delivery).toMatchObject({
      status: "failed",
      retryable: false,
      httpStatus: 403,
      errorCode: "AccessDeniedException",
      detail: expect.stringContaining("identity/diver@gmail.com"),
    });

    const line = warn.mock.calls[0]?.[0] as string;
    expect(line).not.toContain("diver@gmail.com");
    expect(line).toContain("identity/<redacted>@gmail.com");
    expect(line).toContain("AccessDeniedException");
    warn.mockRestore();
  });

  it("marks a thrown throttling error as retryable", async () => {
    const error = Object.assign(new Error("Rate exceeded"), {
      name: "TooManyRequestsException",
      $metadata: { httpStatusCode: 429 },
    });
    const client = { send: vi.fn().mockRejectedValue(error) };
    const provider = sesNotificationProvider(sesConfig, { client });

    await expect(notify(booking, provider)).resolves.toMatchObject({
      status: "failed",
      retryable: true,
      httpStatus: 429,
    });
  });

  it("marks a thrown 5xx SES error as retryable", async () => {
    const error = Object.assign(new Error("Internal error"), {
      name: "InternalServiceErrorException",
      $metadata: { httpStatusCode: 500 },
    });
    const client = { send: vi.fn().mockRejectedValue(error) };
    const provider = sesNotificationProvider(sesConfig, { client });

    await expect(notify(booking, provider)).resolves.toMatchObject({
      status: "failed",
      retryable: true,
      httpStatus: 500,
    });
  });

  it("treats a network-level failure with no $metadata as retryable", async () => {
    const client = { send: vi.fn().mockRejectedValue(new Error("fetch failed")) };
    const provider = sesNotificationProvider(sesConfig, { client });

    await expect(notify(booking, provider)).resolves.toEqual({
      status: "failed",
      retryable: true,
      errorCode: "network_error",
      detail: "fetch failed",
    });
  });
});

describe("notificationProviderFromEnvironment (ADR 20260803-ses-sole-email-provider)", () => {
  it("builds an SES provider from SES_* env vars and sends", async () => {
    const sesClient = { send: vi.fn().mockResolvedValue({ MessageId: "ses-id" }) };
    const provider = notificationProviderFromEnvironment(
      {
        SES_AWS_REGION: "us-east-1",
        SES_AWS_ACCESS_KEY_ID: "AKIA_TEST",
        SES_AWS_SECRET_ACCESS_KEY: "test-secret",
        SES_FROM_EMAIL: "bookings@ses.dive.day",
      },
      { client: sesClient },
    );

    await expect(notify(booking, provider)).resolves.toEqual({
      status: "sent",
      providerMessageId: "ses-id",
    });
  });

  it("brands an unlabelled configured sender as DiveDay", async () => {
    const sesClient = { send: vi.fn().mockResolvedValue({ MessageId: "ses-id" }) };
    const provider = notificationProviderFromEnvironment(
      {
        SES_AWS_REGION: "us-east-1",
        SES_AWS_ACCESS_KEY_ID: "AKIA_TEST",
        SES_AWS_SECRET_ACCESS_KEY: "test-secret",
        SES_FROM_EMAIL: "notifications@demo.invalid",
      },
      { client: sesClient },
    );

    await notify(booking, provider);

    const command = sesClient.send.mock.calls[0]?.[0] as SendEmailCommand;
    expect(command.input.FromEmailAddress).toBe("DiveDay <notifications@demo.invalid>");
  });

  it("is disabled when SES config is incomplete", async () => {
    const provider = notificationProviderFromEnvironment({ SES_AWS_REGION: "us-east-1" });

    await expect(notify(booking, provider)).resolves.toEqual({ status: "not_configured" });
  });

  it("puts no operational alert on the wire with no credentials configured", async () => {
    // How "no mail in unit tests and the e2e fleet" is actually guaranteed for
    // the two founder alerts (docs ADR 20260805-demo-try-alerts): not a
    // test-only branch in the alerting code, but the provider seam every send
    // already goes through. `playwright.config.ts` blanks the SES_* keys
    // fleet-wide for exactly this, and a local run has never had them.
    const provider = notificationProviderFromEnvironment({});

    await expect(
      notify(
        {
          kind: "demo_started_alert",
          shopId: "00000000-0000-4000-8000-000000000010",
          to: "alerts@dive.day",
          shopSlug: "coral-cove-divers-a1b2c3",
          role: "owner",
          source: "home-hero",
        },
        provider,
      ),
    ).resolves.toEqual({ status: "not_configured" });
  });
});

describe("waitlistInviteEmail", () => {
  it("carries the booking link and escapes staff-entered text", () => {
    const email = waitlistInviteEmail({
      locale: "en-US",
      diverName: "Nora Quinn",
      shopName: "Blue Mantis & Co.",
      tripTitle: '<Reef "Special">',
      startsAt: new Date("2026-08-01T12:00:00.000Z"),
      endsAt: new Date("2026-08-01T15:00:00.000Z"),
      timezone: "America/New_York",
      bookingUrl: "https://diveday.example/s/blue-mantis/trips/trip-1",
      unsubscribeUrl: "https://diveday.example/unsubscribe/tok_abc123",
    });

    expect(email.subject).toContain('<Reef "Special">');
    expect(email.text).toContain("https://diveday.example/s/blue-mantis/trips/trip-1");
    expect(email.html).toContain('href="https://diveday.example/s/blue-mantis/trips/trip-1"');
    expect(email.html).toContain("&lt;Reef &quot;Special&quot;&gt;");
    expect(email.html).toContain("Blue Mantis &amp; Co.");
  });
});

describe("email rendering", () => {
  it("escapes staff-entered text before it is placed in waiver email HTML", () => {
    const email = waiverRequestEmail({
      locale: "en-US",
      diverName: "Nora Quinn",
      shopName: "Blue Mantis & Co.",
      tripTitle: '<Reef "Special">',
      completionUrl: "https://diveday.example/waivers/private-token",
      expiresAt: new Date("2026-08-02T12:00:00.000Z"),
      timezone: "America/New_York",
    });

    expect(email.html).toContain("&lt;Reef &quot;Special&quot;&gt;");
    expect(email.html).toContain("Blue Mantis &amp; Co.");
  });
});

describe("publicAppUrl", () => {
  it("accepts a configured canonical origin", () => {
    expect(publicAppUrl({ APP_HOST: "https://diveday.example/" })).toBe("https://diveday.example");
  });

  // The origin is compiled in now (issue #517 follow-up): an absent APP_HOST
  // means "nobody overrode DiveDay's own", where it used to leave every
  // bearer-token link relative. Only an explicit empty value still means off.
  it("falls back to DiveDay's own origin when nothing overrides it", () => {
    expect(publicAppUrl({})).toBe(APP_ORIGIN);
    expect(APP_ORIGIN).toBe("https://dive.day");
  });

  it("treats an explicitly empty APP_HOST as unconfigured", () => {
    expect(publicAppUrl({ APP_HOST: "" })).toBeNull();
    expect(publicAppUrl({ APP_HOST: "   " })).toBeNull();
  });

  it("returns null for a malformed value instead of throwing", () => {
    expect(publicAppUrl({ APP_HOST: "not a url", NODE_ENV: "production" })).toBeNull();
    expect(publicAppUrl({ APP_HOST: "http://diveday.example", NODE_ENV: "production" })).toBeNull();
  });
});

describe("checkPublicHost", () => {
  it("reports unset when APP_HOST is empty or missing", () => {
    expect(checkPublicHost(undefined, true)).toEqual({ status: "unset" });
    expect(checkPublicHost("  ", true)).toEqual({ status: "unset" });
  });

  it("accepts a bare HTTPS origin and strips a trailing slash", () => {
    expect(checkPublicHost("https://diveday.example/", true)).toEqual({
      status: "valid",
      origin: "https://diveday.example",
    });
  });

  it("rejects non-HTTPS origins in production", () => {
    const result = checkPublicHost("http://diveday.example", true);
    expect(result.status).toBe("invalid");
  });

  it("permits an explicit loopback exception outside production only", () => {
    expect(checkPublicHost("http://localhost:3000", false)).toEqual({
      status: "valid",
      origin: "http://localhost:3000",
    });
    expect(checkPublicHost("http://127.0.0.1:3000", false).status).toBe("valid");
    expect(checkPublicHost("http://localhost:3000", true).status).toBe("invalid");
  });

  it("rejects embedded credentials", () => {
    expect(checkPublicHost("https://user:pass@diveday.example", true).status).toBe("invalid");
  });

  it("rejects a path, query, or fragment", () => {
    expect(checkPublicHost("https://diveday.example/waivers", true).status).toBe("invalid");
    expect(checkPublicHost("https://diveday.example/?ref=1", true).status).toBe("invalid");
    expect(checkPublicHost("https://diveday.example/#frag", true).status).toBe("invalid");
  });

  it("rejects an unparseable value", () => {
    expect(checkPublicHost("not a url", true).status).toBe("invalid");
  });
});

describe("recipientLocale (docs ADR 20260731-per-person-notification-locale)", () => {
  it("writes to the diver in the language they told us they read", () => {
    // The case that motivated the ADR: a German-speaking diver at a Cozumel
    // shop, who had been getting Spanish mail because the shop's default was
    // the only signal. Only the languages DiveDay carries can be stored, so
    // the fix she actually gets is English rather than Spanish.
    expect(recipientLocale("en-US", "es-ES")).toBe("en-US");
    expect(recipientLocale("es-ES", "en-US")).toBe("es-ES");
  });

  it("falls back to the shop's default when DiveDay has never heard from them", () => {
    expect(recipientLocale(null, "es-ES")).toBe("es-ES");
    expect(recipientLocale(undefined, "es-ES")).toBe("es-ES");
  });

  it("falls back rather than trusting a stored value we no longer carry", () => {
    // A locale retired between the write and this send, or a value put there
    // by some future admin tool — never render blanks over it.
    expect(recipientLocale("de-DE", "es-ES")).toBe("es-ES");
    expect(recipientLocale("", "es-ES")).toBe("es-ES");
  });

  it("still ends at English when neither side is usable", () => {
    expect(recipientLocale(null, null)).toBe("en-US");
    expect(recipientLocale("kl-GL", "kl-GL")).toBe("en-US");
  });
});
