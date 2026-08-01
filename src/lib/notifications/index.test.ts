import { describe, expect, it, vi } from "vitest";
import { bookingConfirmationEmail, waitlistInviteEmail, waiverRequestEmail } from "./email";
import {
  checkPublicHost,
  notificationProviderFromEnvironment,
  notify,
  publicAppUrl,
  recipientLocale,
  resendNotificationProvider,
} from "./index";

const booking = {
  kind: "booking_confirmation" as const,
  bookingId: "00000000-0000-4000-8000-000000000001",
  shopId: "00000000-0000-4000-8000-000000000010",
  to: "delivered+booking@resend.dev",
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
  it("brands an unlabelled configured sender as DiveDay", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "resend-email-id" }), { status: 200 }));
    const provider = notificationProviderFromEnvironment(
      { RESEND_API_KEY: "re_test", RESEND_FROM_EMAIL: "notifications@demo.invalid" },
      fetchImpl,
    );

    await notify(booking, provider);

    const request = fetchImpl.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      from: "DiveDay <notifications@demo.invalid>",
    });
  });

  it("sends a booking confirmation through Resend with an idempotency key", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "resend-email-id" }), { status: 200 }));
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      fetchImpl,
    );

    await expect(notify(booking, provider)).resolves.toEqual({
      status: "sent",
      providerMessageId: "resend-email-id",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test",
          "Idempotency-Key": "booking-confirmation/00000000-0000-4000-8000-000000000001",
        }),
      }),
    );
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      to: ["delivered+booking@resend.dev"],
      subject: "You're on the boat — Two-Tank Reef",
    });
  });

  it("keys a reschedule confirmation's idempotency by confirmedAt, not just bookingId (Codex finding)", async () => {
    // A reschedule can reactivate the same bookingId a much earlier
    // confirmation already used — without `confirmedAt` distinguishing the
    // two sends, the provider's own idempotency window would replay the
    // first (stale) response instead of delivering this one.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "resend-email-id" }), { status: 200 }));
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      fetchImpl,
    );

    await notify({ ...booking, confirmedAt: new Date("2026-08-02T09:00:00.000Z") }, provider);

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key":
            "booking-confirmation/00000000-0000-4000-8000-000000000001/2026-08-02T09:00:00.000Z",
        }),
      }),
    );
  });

  it("fails closed when Resend rejects a delivery without exposing provider details", async () => {
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      vi.fn().mockResolvedValue(new Response("bad sender", { status: 422 })),
    );

    await expect(notify(booking, provider)).resolves.toMatchObject({
      status: "failed",
      retryable: false,
      httpStatus: 422,
    });
  });

  it("retries a 429 using Retry-After and keeps the idempotency key", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }), {
          status: 429,
          headers: { "Retry-After": "2" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "resend-after-429" }), { status: 200 }),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      fetchImpl,
      { beforeRequest: vi.fn().mockResolvedValue(undefined), sleep, maxAttempts: 2 },
    );

    await expect(notify(booking, provider)).resolves.toEqual({
      status: "sent",
      providerMessageId: "resend-after-429",
    });
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": "booking-confirmation/00000000-0000-4000-8000-000000000001",
    });
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": "booking-confirmation/00000000-0000-4000-8000-000000000001",
    });
  });

  it("sends a batch and maps Resend ids back to the input order", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "batch-1" }, { id: "batch-2" }] }), {
        status: 200,
      }),
    );
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      fetchImpl,
      { beforeRequest: vi.fn().mockResolvedValue(undefined) },
    );
    const second = { ...booking, to: "delivered+second@resend.dev" };

    await expect(provider.sendBatch?.([booking, second])).resolves.toEqual([
      { status: "sent", providerMessageId: "batch-1" },
      { status: "sent", providerMessageId: "batch-2" },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails/batch",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toHaveLength(2);
  });

  it("rejects reserved test domains locally without calling Resend", async () => {
    const fetchImpl = vi.fn();
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      fetchImpl,
    );

    await expect(notify({ ...booking, to: "nora@example.com" }, provider)).resolves.toEqual({
      status: "failed",
      retryable: false,
      errorCode: "invalid_test_recipient",
      detail: expect.stringContaining("example.com"),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never sends seeded demo.com recipients to Resend", async () => {
    const fetchImpl = vi.fn();
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      fetchImpl,
    );

    await expect(notify({ ...booking, to: "marcus@demo.com" }, provider)).resolves.toMatchObject({
      status: "failed",
      retryable: false,
      errorCode: "invalid_test_recipient",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps reserved test recipients out of a mixed batch", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: "batch-valid" }] }), { status: 200 }),
      );
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      fetchImpl,
      { beforeRequest: vi.fn().mockResolvedValue(undefined) },
    );

    await expect(
      provider.sendBatch?.([
        { ...booking, to: "nora@example.com" },
        { ...booking, to: "delivered@resend.dev" },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ errorCode: "invalid_test_recipient", retryable: false }),
      { status: "sent", providerMessageId: "batch-valid" },
    ]);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toHaveLength(1);
  });

  it("uses the waiver record as the idempotency boundary for a private link", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "resend-waiver-id" }), { status: 200 }));
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      fetchImpl,
    );

    await expect(
      notify(
        {
          kind: "waiver_request",
          waiverRecordId: "00000000-0000-4000-8000-000000000002",
          bookingId: "00000000-0000-4000-8000-000000000001",
          shopId: "00000000-0000-4000-8000-000000000010",
          to: "delivered+waiver@resend.dev",
          locale: "en-US",
          diverName: "Nora Quinn",
          shopName: "Blue Mantis",
          tripTitle: "Two-Tank Reef",
          completionUrl: "https://diveday.example/waivers/private-token",
          expiresAt: new Date("2026-08-02T12:00:00.000Z"),
          timezone: "America/New_York",
        },
        provider,
      ),
    ).resolves.toEqual({ status: "sent", providerMessageId: "resend-waiver-id" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "waiver-request/00000000-0000-4000-8000-000000000002",
        }),
      }),
    );
  });

  it("keys a wait-list invite by its stamp so a genuine re-invite is a fresh send", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "resend-waitlist-id" }), { status: 200 }),
      );
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      fetchImpl,
    );

    await expect(
      notify(
        {
          kind: "waitlist_invite",
          waitlistEntryId: "00000000-0000-4000-8000-000000000003",
          shopId: "00000000-0000-4000-8000-000000000010",
          to: "delivered+waitlist@resend.dev",
          locale: "en-US",
          diverName: "Nora Quinn",
          shopName: "Blue Mantis",
          tripTitle: "Two-Tank Reef",
          startsAt: new Date("2026-08-01T12:00:00.000Z"),
          endsAt: new Date("2026-08-01T15:00:00.000Z"),
          timezone: "America/New_York",
          bookingUrl: "https://diveday.example/shop/blue-mantis/schedule/trip-1",
          invitedAt: new Date("2026-07-21T10:00:00.000Z"),
          unsubscribeUrl: "https://diveday.example/unsubscribe/tok_abc123",
        },
        provider,
      ),
    ).resolves.toEqual({ status: "sent", providerMessageId: "resend-waitlist-id" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key":
            "waitlist-invite/00000000-0000-4000-8000-000000000003/2026-07-21T10:00:00.000Z",
        }),
      }),
    );
  });

  it("does not attempt delivery when production email configuration is absent", async () => {
    const fetchImpl = vi.fn();
    const provider = notificationProviderFromEnvironment({}, fetchImpl);

    await expect(notify(booking, provider)).resolves.toEqual({ status: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends a welcome email keyed by the account, once ever", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "resend-welcome-id" }), { status: 200 }),
      );
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      fetchImpl,
    );

    await expect(
      notify(
        {
          kind: "welcome",
          userAccountId: "00000000-0000-4000-8000-000000000020",
          shopId: "00000000-0000-4000-8000-000000000010",
          to: "delivered+welcome@resend.dev",
          locale: "en-US",
          ownerName: "Pat Diver",
          shopName: "Blue Mantis",
          signInUrl: "https://diveday.example/sign-in",
        },
        provider,
      ),
    ).resolves.toEqual({ status: "sent", providerMessageId: "resend-welcome-id" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "welcome/00000000-0000-4000-8000-000000000020",
        }),
      }),
    );
  });

  it("keys email verification by the token row's id, not the raw token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "resend-verify-id" }), { status: 200 }));
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      fetchImpl,
    );

    await expect(
      notify(
        {
          kind: "email_verification",
          userAccountId: "00000000-0000-4000-8000-000000000020",
          tokenId: "00000000-0000-4000-8000-000000000030",
          shopId: "00000000-0000-4000-8000-000000000010",
          to: "delivered+verification@resend.dev",
          locale: "en-US",
          ownerName: "Pat Diver",
          verifyUrl: "https://diveday.example/verify/raw-token-should-not-appear",
          expiresAt: new Date("2026-07-29T12:00:00.000Z"),
          timezone: "America/New_York",
        },
        provider,
      ),
    ).resolves.toEqual({ status: "sent", providerMessageId: "resend-verify-id" });

    const headers = fetchImpl.mock.calls[0]?.[1]?.headers;
    expect(headers["Idempotency-Key"]).toBe(
      "email-verification/00000000-0000-4000-8000-000000000030",
    );
    expect(headers["Idempotency-Key"]).not.toContain("raw-token-should-not-appear");
  });

  it("keys a password-reset request by the token row's id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "resend-reset-id" }), { status: 200 }));
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      fetchImpl,
    );

    await expect(
      notify(
        {
          kind: "password_reset_request",
          userAccountId: "00000000-0000-4000-8000-000000000020",
          tokenId: "00000000-0000-4000-8000-000000000031",
          shopId: "00000000-0000-4000-8000-000000000010",
          to: "delivered+reset@resend.dev",
          locale: "en-US",
          ownerName: "Pat Diver",
          resetUrl: "https://diveday.example/reset-password/raw-token-should-not-appear",
          expiresAt: new Date("2026-07-26T13:00:00.000Z"),
          timezone: "America/New_York",
        },
        provider,
      ),
    ).resolves.toEqual({ status: "sent", providerMessageId: "resend-reset-id" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "password-reset-request/00000000-0000-4000-8000-000000000031",
        }),
      }),
    );
  });

  it("keys a password-changed notice by its own timestamp so a second reset is a fresh send", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "resend-changed-id" }), { status: 200 }),
      );
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      fetchImpl,
    );

    await expect(
      notify(
        {
          kind: "password_changed",
          userAccountId: "00000000-0000-4000-8000-000000000020",
          shopId: "00000000-0000-4000-8000-000000000010",
          to: "delivered+changed@resend.dev",
          locale: "en-US",
          ownerName: "Pat Diver",
          changedAt: new Date("2026-07-26T13:00:00.000Z"),
        },
        provider,
      ),
    ).resolves.toEqual({ status: "sent", providerMessageId: "resend-changed-id" });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key":
            "password-changed/00000000-0000-4000-8000-000000000020/2026-07-26T13:00:00.000Z",
        }),
      }),
    );
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
      bookingUrl: "https://diveday.example/shop/blue-mantis/schedule/trip-1",
      unsubscribeUrl: "https://diveday.example/unsubscribe/tok_abc123",
    });

    expect(email.subject).toContain('<Reef "Special">');
    expect(email.text).toContain("https://diveday.example/shop/blue-mantis/schedule/trip-1");
    expect(email.html).toContain('href="https://diveday.example/shop/blue-mantis/schedule/trip-1"');
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
  it("accepts a configured canonical origin and rejects an unconfigured one", () => {
    expect(publicAppUrl({ APP_HOST: "https://diveday.example/" })).toBe("https://diveday.example");
    expect(publicAppUrl({})).toBeNull();
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
