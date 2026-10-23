import { describe, expect, it } from "vitest";
import { founderDigestEmail } from "./email";

describe("founderDigestEmail (ADR 20261007-founder-metrics)", () => {
  const digest = {
    weekStart: "2026-10-05",
    weekEnd: "2026-10-11",
    diveDays: 3,
    diveDayShops: 2,
    demoEntries: [
      { source: "home-hero", count: 4 },
      { source: "pricing", count: 1 },
    ],
    setupRequests: [{ source: "pricing", count: 2 }],
    unnotifiedSetupRequests: 0,
    stalls: [
      {
        shopName: "Reef & Wreck",
        shopSlug: "reef-wreck",
        lastReached: "first_departure" as const,
        since: "2026-10-01",
        waitingFor: "first_public_booking" as const,
      },
    ],
    bounces: { total: 0, lines: [] },
  };

  it("leads with the north star and lists the funnel by source and every stall", () => {
    const email = founderDigestEmail(digest);
    expect(email.subject).toBe("DiveDay week of 2026-10-05: 3 dive days");
    expect(email.text).toContain("North star: 3 dive days run end to end");
    expect(email.text).toContain("across 2 shops");
    expect(email.text).toContain("Demo entries: 5");
    expect(email.text).toContain("home-hero: 4");
    expect(email.text).toContain("Set-up requests: 2");
    expect(email.text).toContain(
      "Reef & Wreck (/shop/reef-wreck): first departure on 2026-10-01, waiting for first public booking",
    );
    expect(email.html).toContain("Reef &amp; Wreck");
    expect(email.text.indexOf("North star")).toBeLessThan(email.text.indexOf("Demo entries"));
  });

  it("says a quiet week is quiet rather than dropping its sections", () => {
    const email = founderDigestEmail({
      ...digest,
      diveDays: 1,
      diveDayShops: 1,
      demoEntries: [],
      setupRequests: [],
      stalls: [],
    });
    expect(email.subject).toBe("DiveDay week of 2026-10-05: 1 dive day");
    expect(email.text).toContain("Demo entries: 0");
    expect(email.text).toContain("Set-up requests: 0");
    expect(email.text).toContain("Stalled shops: 0");
    expect(email.text).toContain("Bounced or complained email: 0");
  });

  it("lists each bounce with its address, reason, email, shop and sender", () => {
    const line = {
      occurredAt: new Date("2026-10-07T14:03:00.000Z"),
      event: "bounce" as const,
      recipient: "nora@example.com",
      bounceType: "Permanent",
      bounceSubType: "General",
      smtpStatus: "550 5.1.1",
      complaintType: null,
      kind: "waiver_request",
      purpose: null,
      shopName: "Reef & Wreck",
      shopSlug: "reef-wreck",
      sentByName: "Sam Rivera",
    };
    const email = founderDigestEmail({
      ...digest,
      bounces: {
        total: 3,
        lines: [
          line,
          {
            ...line,
            event: "complaint",
            recipient: "ida@example.com",
            bounceType: null,
            bounceSubType: null,
            smtpStatus: null,
            complaintType: "abuse",
            kind: "address_confirmation",
            purpose: "account",
            shopName: null,
            shopSlug: null,
            sentByName: null,
          },
        ],
      },
    });
    expect(email.text).toContain("Bounced or complained email: 3");
    expect(email.text).toContain(
      "2026-10-07 14:03 UTC: no***@example.com, Permanent / General, 550 5.1.1. waiver_request, Reef & Wreck (/shop/reef-wreck), sent by Sam Rivera",
    );
    expect(email.text).toContain(
      "id***@example.com, complaint (abuse). address_confirmation (account), no shop, sent automatically",
    );
    expect(email.text).toContain("and 1 more; read email_bounces");
    expect(email.text).not.toContain("nora@");
  });

  it("names set-up requests whose mail never reached the inbox", () => {
    expect(founderDigestEmail({ ...digest, unnotifiedSetupRequests: 2 }).text).toContain(
      "2 never reached the onboarding inbox",
    );
  });
});
