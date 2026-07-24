import { describe, expect, it, vi } from "vitest";
import { bookingConfirmationEmail, waitlistInviteEmail, waiverRequestEmail } from "./email";
import {
  checkPublicHost,
  notificationProviderFromEnvironment,
  notify,
  publicAppUrl,
  resendNotificationProvider,
} from "./index";

const booking = {
  kind: "booking_confirmation" as const,
  bookingId: "00000000-0000-4000-8000-000000000001",
  shopId: "00000000-0000-4000-8000-000000000010",
  to: "nora@example.com",
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
      to: ["nora@example.com"],
      subject: "You're on the boat — Two-Tank Reef",
    });
  });

  it("fails closed when Resend rejects a delivery without exposing provider details", async () => {
    const provider = resendNotificationProvider(
      { apiKey: "re_test", from: "Blue Mantis <bookings@example.com>" },
      vi.fn().mockResolvedValue(new Response("bad sender", { status: 422 })),
    );

    await expect(notify(booking, provider)).resolves.toEqual({ status: "failed" });
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
          to: "nora@example.com",
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
          to: "nora@example.com",
          diverName: "Nora Quinn",
          shopName: "Blue Mantis",
          tripTitle: "Two-Tank Reef",
          startsAt: new Date("2026-08-01T12:00:00.000Z"),
          endsAt: new Date("2026-08-01T15:00:00.000Z"),
          timezone: "America/New_York",
          bookingUrl: "https://diveday.example/shop/blue-mantis/schedule/trip-1",
          invitedAt: new Date("2026-07-21T10:00:00.000Z"),
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
});

describe("waitlistInviteEmail", () => {
  it("carries the booking link and escapes staff-entered text", () => {
    const email = waitlistInviteEmail({
      diverName: "Nora Quinn",
      shopName: "Blue Mantis & Co.",
      tripTitle: '<Reef "Special">',
      startsAt: new Date("2026-08-01T12:00:00.000Z"),
      endsAt: new Date("2026-08-01T15:00:00.000Z"),
      timezone: "America/New_York",
      bookingUrl: "https://diveday.example/shop/blue-mantis/schedule/trip-1",
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
