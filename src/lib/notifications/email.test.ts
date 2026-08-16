import { describe, expect, it } from "vitest";
import {
  bookingConfirmationEmail,
  courseInquiryEmail,
  demoStartedAlertEmail,
  lastMinuteDealEmail,
  newAccountAlertEmail,
  passwordChangedEmail,
  passwordResetEmail,
  tripBlowoutEmail,
  tripConditionsHoldEmail,
  tripMinimumNotMetEmail,
  tripRecapEmail,
  tripReminderEmail,
  usageCeilingAlertEmail,
  verifyAccountEmail,
  welcomeEmail,
  wrapEmailHtml,
} from "./email";

const base = {
  locale: "en-US" as const,
  diverName: "Pat Diver",
  shopName: "Blue Mantis",
  tripTitle: "Two-Tank Reef",
  startsAt: new Date("2026-08-01T13:00:00.000Z"),
  endsAt: new Date("2026-08-01T17:00:00.000Z"),
  timezone: "America/New_York",
};

describe("bookingConfirmationEmail", () => {
  it("defaults the dock call to 30 minutes", () => {
    const email = bookingConfirmationEmail(base);
    expect(email.text).toContain("be at the dock 30 minutes early");
    expect(email.html).toContain("be at the dock 30 minutes early");
  });

  it("uses the shop's configured dock call time", () => {
    const email = bookingConfirmationEmail({ ...base, dockCallMinutes: 45 });
    expect(email.text).toContain("be at the dock 45 minutes early");
    expect(email.text).not.toContain("30 minutes");
  });

  it("includes the shop's configured packing list as a pre-trip checklist", () => {
    const email = bookingConfirmationEmail({
      ...base,
      packingList: ["Reef-safe sunscreen", "Your digital certification record or other evidence"],
    });
    expect(email.text).toContain("Pre-Trip Checklist Reminder:");
    expect(email.text).toContain("Reef-safe sunscreen");
    expect(email.text).toContain("digital certification record");
    expect(email.html).toContain("Pre-Trip Checklist Reminder:");
    expect(email.html).toContain("Reef-safe sunscreen");
  });

  it("omits the checklist entirely when the shop has no packing list (no empty box)", () => {
    const email = bookingConfirmationEmail(base);
    expect(email.text).not.toContain("Pre-Trip Checklist Reminder:");
    expect(email.html).not.toContain("Pre-Trip Checklist Reminder:");
  });
});

describe("tripConditionsHoldEmail", () => {
  it("reassures the diver that their seat remains held and includes the crew note", () => {
    const email = tripConditionsHoldEmail({
      ...base,
      conditionsSummary: "The captain is watching a passing squall.",
      tripUrl: "https://diveday.example/s/blue-mantis/trips/trip-1",
    });
    expect(email.subject).toContain("Conditions hold");
    expect(email.text).toContain("Your seat is still held");
    expect(email.text).toContain("passing squall");
    expect(email.html).toContain("See the live trip update");
  });
});

describe("tripMinimumNotMetEmail", () => {
  const swept = {
    ...base,
    minimumBookings: 4,
    bookedCount: 2,
    scheduleUrl: "https://diveday.example/s/blue-mantis",
  };

  it("says the numbers, and says the money came back", () => {
    const email = tripMinimumNotMetEmail({ ...swept, paymentStory: "refunded" });
    expect(email.text).toContain("at least 4 divers");
    expect(email.text).toContain("refunded in full");
  });

  it("says a refund is owed when the card could not be reversed", () => {
    const email = tripMinimumNotMetEmail({ ...swept, paymentStory: "refund_owed" });
    expect(email.text).toContain("owed a full refund");
  });

  it("says nothing about money to a diver who never paid", () => {
    const email = tripMinimumNotMetEmail({ ...swept, paymentStory: "none" });
    expect(email.text).not.toContain("refund");
    expect(email.html).not.toContain("refund");
  });

  it("stays sendable for a message queued before refunds existed", () => {
    const email = tripMinimumNotMetEmail(swept);
    expect(email.text).toContain("at least 4 divers");
    expect(email.text).not.toContain("refund");
  });
});

describe("tripBlowoutEmail", () => {
  it("carries the cancellation, the money story, and each alternative as a link", () => {
    const email = tripBlowoutEmail({
      ...base,
      paymentStory: "paid",
      alternatives: [
        {
          title: "Night Dive — City of Washington",
          startsAt: new Date("2026-08-03T23:30:00.000Z"),
          bookingUrl: "https://diveday.example/s/blue-mantis/trips/trip-2",
        },
      ],
      scheduleUrl: "https://diveday.example/s/blue-mantis",
    });
    expect(email.subject).toContain("Trip cancelled");
    expect(email.text).toContain("because of the weather");
    expect(email.text).toContain("Your payment is safe");
    expect(email.text).toContain("Night Dive — City of Washington");
    expect(email.text).toContain("https://diveday.example/s/blue-mantis/trips/trip-2");
    expect(email.html).toContain('href="https://diveday.example/s/blue-mantis/trips/trip-2"');
  });

  it("tells a refunded diver the money is already on its way back", () => {
    const email = tripBlowoutEmail({
      ...base,
      paymentStory: "refunded",
      alternatives: [],
      scheduleUrl: "https://diveday.example/s/blue-mantis",
    });
    expect(email.text).toContain("refunded in full");
    expect(email.text).not.toContain("will be in touch");
  });

  it("tells a diver whose card could not be reversed that a refund is owed", () => {
    const email = tripBlowoutEmail({
      ...base,
      paymentStory: "refund_owed",
      alternatives: [],
      scheduleUrl: "https://diveday.example/s/blue-mantis",
    });
    expect(email.text).toContain("owed a full refund");
    expect(email.text).toContain("Blue Mantis");
  });

  it("degrades gracefully to the schedule when no alternative qualifies", () => {
    const email = tripBlowoutEmail({
      ...base,
      paymentStory: "none",
      alternatives: [],
      scheduleUrl: "https://diveday.example/s/blue-mantis",
    });
    expect(email.text).toContain("You haven't been charged");
    expect(email.text).toContain("new trips are added all the time");
    expect(email.text).toContain("https://diveday.example/s/blue-mantis");
    expect(email.html).toContain('href="https://diveday.example/s/blue-mantis"');
    // No stray list markup when there is nothing to list.
    expect(email.html).not.toContain("<ul>");
  });

  it("escapes hostile trip titles in the html body", () => {
    const email = tripBlowoutEmail({
      ...base,
      tripTitle: "<img src=x onerror=alert(1)> Reef",
      paymentStory: "deposit",
      alternatives: [
        {
          title: "<script>alert(2)</script> Wall",
          startsAt: new Date("2026-08-03T23:30:00.000Z"),
          bookingUrl: "https://diveday.example/s/blue-mantis/trips/trip-2",
        },
      ],
      scheduleUrl: "https://diveday.example/s/blue-mantis",
    });
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).not.toContain("<script>");
    expect(email.text).toContain("Your deposit is safe");
  });
});

describe("tripReminderEmail", () => {
  it("names the diver's outstanding items as a checklist", () => {
    const email = tripReminderEmail({
      ...base,
      lead: "day",
      outstanding: ["waiver_pending", "payment_due"],
    });
    expect(email.text).toContain("Still to sort before you board:");
    expect(email.text).toContain("- Sign your waiver");
    expect(email.text).toContain("- Settle your balance");
    expect(email.html).toContain("<li>Sign your waiver</li>");
  });

  it("names an expired waiver link as expired, and promises the fresh one", () => {
    const email = tripReminderEmail({
      ...base,
      lead: "week",
      outstanding: ["waiver_expired"],
      readinessUrl: "https://diveday.example/ready/fresh-readiness-token",
    });
    // Not "Sign your waiver": the diver may already have tapped the dead link,
    // and a reminder that repeats it reads as the shop not having noticed.
    expect(email.text).toContain("Still to sort before you board:");
    expect(email.text).toContain("- Your waiver link expired — grab a fresh one");
    expect(email.html).toContain("<li>Your waiver link expired");
    expect(email.text).not.toContain("Sign your waiver");
    // …and the fresh link is genuinely reachable from the message.
    expect(email.text).toContain("https://diveday.example/ready/fresh-readiness-token");
    expect(email.html).toContain("https://diveday.example/ready/fresh-readiness-token");
  });

  it("never carries a waiver link on a reminder about an expired waiver link", () => {
    // The property, not the phrasing: a reminder's only link is the readiness
    // capability, minted at send time (src/db/reminders.ts). Embedding a
    // `/waivers/<token>` link here would mail the diver the very link the same
    // message calls dead. If a future change adds one, it must reissue first.
    for (const lead of ["week", "day"] as const) {
      const email = tripReminderEmail({
        ...base,
        lead,
        outstanding: ["waiver_expired"],
        readinessUrl: "https://diveday.example/ready/fresh-readiness-token",
      });
      expect(email.text).not.toContain("/waivers/");
      expect(email.html).not.toContain("/waivers/");
    }
  });

  it("adds a medical heads-up when a medical answer needs review", () => {
    const email = tripReminderEmail({ ...base, lead: "day", medicalReview: true });
    expect(email.text).toContain("doctor's sign-off");
  });

  it("stays a warm nudge with no checklist when nothing is outstanding", () => {
    const email = tripReminderEmail({
      ...base,
      lead: "day",
      outstanding: [],
      medicalReview: false,
    });
    expect(email.text).not.toContain("Still to sort");
  });

  it("honors the shop's dock call time", () => {
    const email = tripReminderEmail({ ...base, lead: "week", dockCallMinutes: 60 });
    expect(email.text).toContain("be at the dock 60 minutes early");
  });

  it("renders the full night-before brief on the day lead", () => {
    const email = tripReminderEmail({
      ...base,
      lead: "day",
      dockCallMinutes: 30,
      brief: {
        forecast: "Warm and glassy. Expect water around 27°C.",
        bring: ["Swimsuit and towel", "Logbook"],
        whoToText: "+13055551234",
        firstTimerNote: "First boat dive? The crew walks everyone through the gear.",
      },
    });
    expect(email.text).toContain("Conditions: Warm and glassy");
    expect(email.text).toContain("- Swimsuit and towel");
    expect(email.text).toContain("Aim to be at the dock by");
    expect(email.text).toContain("Text the shop at +13055551234");
    expect(email.text).toContain("First boat dive?");
    expect(email.html).toContain("<li>Logbook</li>");
  });

  it("keeps the 7-day reminder light with no brief sections", () => {
    const email = tripReminderEmail({
      ...base,
      lead: "week",
      brief: { forecast: "Warm and glassy", bring: ["Logbook"] },
    });
    expect(email.text).not.toContain("Conditions:");
    expect(email.text).not.toContain("Aim to be at the dock by");
  });
});

describe("tripRecapEmail", () => {
  const recapBase = {
    locale: "en-US" as const,
    diverName: "Rae Recap",
    shopName: "Blue Mantis",
    tripTitle: "Two-Tank Reef",
    startsAt: new Date("2026-08-01T13:00:00.000Z"),
    timezone: "America/New_York",
    recapUrl: "https://diveday.test/recap/abc.def",
    unsubscribeUrl: "https://diveday.test/unsubscribe/xyz",
  };

  it("names the sites dived and links the recap", () => {
    const email = tripRecapEmail({ ...recapBase, sites: ["French Reef", "Molasses Reef"] });
    expect(email.text).toContain("You dived French Reef and Molasses Reef.");
    expect(email.text).toContain("https://diveday.test/recap/abc.def");
    expect(email.html).toContain('href="https://diveday.test/recap/abc.def"');
    expect(email.text).toContain("bring a buddy");
    expect(email.text).toContain("https://diveday.test/unsubscribe/xyz");
    expect(email.html).toContain('href="https://diveday.test/unsubscribe/xyz"');
  });

  it("still reads well when the sites are unknown", () => {
    const email = tripRecapEmail(recapBase);
    expect(email.text).toContain("Thanks for diving Two-Tank Reef");
    expect(email.text).not.toContain("You dived .");
  });
});

describe("welcomeEmail", () => {
  it("names the shop and links to sign-in", () => {
    const email = welcomeEmail({
      locale: "en-US",
      ownerName: "Pat Diver",
      shopName: "Blue Mantis",
      signInUrl: "https://diveday.example/sign-in",
    });
    expect(email.subject).toContain("Blue Mantis");
    expect(email.text).toContain("https://diveday.example/sign-in");
    expect(email.html).toContain('href="https://diveday.example/sign-in"');
  });
});

describe("newAccountAlertEmail", () => {
  it("names the owner, their email, and the new shop", () => {
    const email = newAccountAlertEmail({
      ownerName: "Pat Diver",
      ownerEmail: "pat@example.com",
      shopName: "Blue Mantis",
      shopSlug: "blue-mantis",
    });
    expect(email.subject).toContain("Blue Mantis");
    expect(email.text).toContain("Pat Diver");
    expect(email.text).toContain("pat@example.com");
    expect(email.text).toContain("/shop/blue-mantis");
    expect(email.html).toContain("Blue Mantis");
  });

  it("escapes HTML in shop and owner names", () => {
    const email = newAccountAlertEmail({
      ownerName: '<script>alert("x")</script>',
      ownerEmail: "pat@example.com",
      shopName: "Blue Mantis",
      shopSlug: "blue-mantis",
    });
    expect(email.html).not.toContain("<script>");
  });
});

describe("demoStartedAlertEmail (docs ADR 20260805-demo-try-alerts)", () => {
  it("names the role, the funnel source, and the throwaway shop", () => {
    const email = demoStartedAlertEmail({
      shopSlug: "coral-cove-divers-a1b2c3",
      role: "captain",
      source: "pricing",
    });
    expect(email.subject).toContain("captain");
    expect(email.subject).toContain("pricing");
    expect(email.text).toContain("/shop/coral-cove-divers-a1b2c3");
    expect(email.html).toContain("captain");
  });

  it("carries nothing about the visitor — they never identified themselves", () => {
    // The guard that matters on this kind: it is an outbound message about an
    // anonymous person, so the body must be assemblable from the three fields
    // and nothing else. A future field carrying an IP, a user agent, or the
    // generated demo-owner email fails here first.
    const email = demoStartedAlertEmail({
      shopSlug: "coral-cove-divers-a1b2c3",
      role: "owner",
      source: "home-hero",
    });
    const body = `${email.subject}\n${email.text}\n${email.html}`;
    expect(body).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(body).not.toContain("@");
  });

  it("escapes a slug or source that somehow arrived with markup in it", () => {
    const email = demoStartedAlertEmail({
      shopSlug: '<script>alert("x")</script>',
      role: "diver",
      source: '<img src=x onerror="1">',
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
  });
});

describe("usageCeilingAlertEmail (docs ADR 20260806-provider-usage-guardrails)", () => {
  const warning = {
    ceilingId: "vercel_spend",
    provider: "vercel",
    metric: "billed_cost",
    unit: "usd",
    level: "warn" as const,
    periodKey: "2026-08",
    value: 38.5,
    ceiling: 60,
    percent: 64,
    overflow: "bills_overage" as const,
  };

  it("says which ceiling, how far along, and for which period", () => {
    const email = usageCeilingAlertEmail(warning);
    expect(email.subject).toContain("vercel_spend");
    expect(email.subject).toContain("64%");
    expect(email.subject).toContain("2026-08");
    expect(email.text).toContain("38.5 of 60 usd");
    expect(email.html).toContain("vercel_spend");
  });

  it("distinguishes a warning from being over the line in the subject", () => {
    const over = usageCeilingAlertEmail({ ...warning, level: "over", value: 61, percent: 102 });
    expect(over.subject).not.toBe(usageCeilingAlertEmail(warning).subject);
    expect(over.subject).toContain("over ceiling");
  });

  it("says what the provider does at the ceiling, in the provider's own terms", () => {
    // A ceiling that suspends the database and one that adds to an invoice are
    // not the same 7am email, and the code alone would not tell the reader that.
    const suspends = usageCeilingAlertEmail({
      ...warning,
      ceilingId: "neon_compute",
      provider: "neon",
      metric: "compute_unit_hours",
      unit: "compute_unit_hour",
      overflow: "suspends",
    });
    expect(suspends.text).toContain("suspends");
    const drops = usageCeilingAlertEmail({ ...warning, overflow: "drops" });
    expect(drops.text).toContain("discards");
  });

  it("states that nothing was turned off, because nothing ever is", () => {
    // The alert-only posture, inherited from ADR 20260802-aws-cost-guardrails.
    // Somebody reading this at 7am must not have to wonder whether the site is
    // already down.
    const email = usageCeilingAlertEmail(warning);
    expect(email.text).toContain("Alert-only");
    expect(email.html).toContain("Alert-only");
  });

  it("carries no personal data — every field is a machine key or a number", () => {
    const email = usageCeilingAlertEmail(warning);
    const body = `${email.subject}\n${email.text}\n${email.html}`;
    expect(body).not.toContain("@");
    expect(body).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it("escapes a ceiling id or provider that somehow arrived with markup in it", () => {
    const email = usageCeilingAlertEmail({
      ...warning,
      ceilingId: '<script>alert("x")</script>',
      provider: '<img src=x onerror="1">',
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
  });

  it("renders a figure without locale separators, so no host setting can change it", () => {
    const email = usageCeilingAlertEmail({ ...warning, value: 1234.567, ceiling: 2000 });
    expect(email.text).toContain("1234.57 of 2000");
  });
});

describe("verifyAccountEmail", () => {
  const base = {
    locale: "en-US" as const,
    ownerName: "Pat Diver",
    verifyUrl: "https://diveday.example/verify/abc.def",
    expiresAt: new Date("2026-08-04T13:00:00.000Z"),
    timezone: "America/New_York",
  };

  it("links the confirmation and names when it expires", () => {
    const email = verifyAccountEmail(base);
    expect(email.text).toContain("https://diveday.example/verify/abc.def");
    expect(email.html).toContain('href="https://diveday.example/verify/abc.def"');
    expect(email.text).toContain("This link expires");
  });

  it("reassures a visitor who never signed up that they can ignore it", () => {
    const email = verifyAccountEmail(base);
    expect(email.text).toContain("you can ignore this");
  });
});

describe("passwordResetEmail", () => {
  const base = {
    locale: "en-US" as const,
    ownerName: "Pat Diver",
    resetUrl: "https://diveday.example/reset-password/abc.def",
    expiresAt: new Date("2026-08-01T14:00:00.000Z"),
    timezone: "America/New_York",
  };

  it("links the reset and notes it works once", () => {
    const email = passwordResetEmail(base);
    expect(email.text).toContain("https://diveday.example/reset-password/abc.def");
    expect(email.html).toContain('href="https://diveday.example/reset-password/abc.def"');
    expect(email.text).toContain("works once");
  });

  it("reassures someone who didn't request it that nothing changed", () => {
    const email = passwordResetEmail(base);
    expect(email.text).toContain("your password hasn't changed");
  });
});

describe("passwordChangedEmail", () => {
  it("points a compromised recipient at requesting a new reset, not signing in — the old password no longer works for them", () => {
    const email = passwordChangedEmail({
      locale: "en-US",
      ownerName: "Pat Diver",
      forgotPasswordUrl: "https://diveday.example/forgot-password",
    });
    expect(email.text).toContain("https://diveday.example/forgot-password");
    expect(email.html).toContain('href="https://diveday.example/forgot-password"');
    expect(email.text).not.toContain("sign in and set a new password");
  });

  it("still reads well without a link when APP_HOST is unset", () => {
    const email = passwordChangedEmail({ locale: "en-US", ownerName: "Pat Diver" });
    expect(email.text).not.toContain("http");
    expect(email.text).toContain("request a new password");
  });
});

describe("lastMinuteDealEmail", () => {
  const dealBase = {
    ...base,
    discountPercent: 25,
    code: "LASTMINUTE25",
    bookingUrl: "https://diveday.example/s/blue-mantis/trips/trip-1",
    expiresAt: new Date("2026-08-01T13:00:00.000Z"),
    unsubscribeUrl: "https://diveday.example/unsubscribe/tok_abc123",
  };

  it("carries the recipient's own unsubscribe link in both bodies (Leo — self-serve email unsubscribe)", () => {
    const email = lastMinuteDealEmail(dealBase);
    expect(email.text).toContain(dealBase.unsubscribeUrl);
    expect(email.html).toContain(`href="${dealBase.unsubscribeUrl}"`);
    expect(email.html).toContain("Stop last-minute deal emails from Blue Mantis");
  });
});

describe("courseInquiryEmail", () => {
  const inquiry = {
    locale: "en-US" as const,
    shopName: "Blue Mantis",
    courseTitle: "Open Water Diver",
    inquirerName: "Mira Delgado",
    inquirerEmail: "mira@example.com",
    experience: "never" as const,
    timing: "the week of 12 August",
  };

  it("puts the facts the desk reads in a fixed order, with no blank lines", () => {
    const email = courseInquiryEmail(inquiry);
    expect(email.text).toContain("When: the week of 12 August");
    expect(email.text.indexOf("When:")).toBeLessThan(email.text.indexOf("How many divers:"));
    // No stray separator where the retired "date asked for" line used to sit.
    expect(email.html).not.toContain("<br><br>");
  });

  it("names the dates the diver asked for, ahead of their own words about timing", () => {
    const email = courseInquiryEmail({
      ...inquiry,
      preferredDate: "2026-08-06",
      alternateDate: "2026-08-13",
    });
    expect(email.text).toContain("Dates asked for: Aug 6, 2026 or Aug 13, 2026");
    // The structured answer leads; the free text qualifies it.
    expect(email.text.indexOf("Dates asked for:")).toBeLessThan(email.text.indexOf("When:"));
  });

  it("says so when the diver can move a few days", () => {
    const email = courseInquiryEmail({
      ...inquiry,
      preferredDate: "2026-08-06",
      dateFlexible: true,
    });
    expect(email.text).toContain("Dates asked for: Aug 6, 2026 — can move a few days");
    // One date named, so no disjunction to build.
    expect(email.text).not.toContain(" or ");
  });

  it("renders no date line at all when the diver named none", () => {
    const email = courseInquiryEmail(inquiry);
    expect(email.text).not.toContain("Dates asked for");
    // Never "Not said" here: the free-text "When:" line already answered.
    expect(email.text).toContain("When: the week of 12 August");
  });

  it("reads a calendar date through UTC, so the server's zone cannot shift the day", () => {
    // 2026-08-06 is a date, not an instant. A renderer that went through a
    // negative-offset zone would print Aug 5 for every shop west of Greenwich.
    const email = courseInquiryEmail({ ...inquiry, preferredDate: "2026-08-06" });
    expect(email.text).toContain("Aug 6, 2026");
    expect(email.text).not.toContain("Aug 5, 2026");
  });
});

describe("wrapEmailHtml", () => {
  it("produces a real document — doctype, negotiated lang, viewport meta", () => {
    const html = wrapEmailHtml("<p>Hello</p>", { shopName: "Blue Mantis", locale: "es-ES" });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<html lang="es-ES">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain("<p>Hello</p>");
  });

  it("renders the shop name as a text header, escaped, never a logo image", () => {
    const html = wrapEmailHtml("<p>Body</p>", {
      shopName: "Sal & Sons <Diving>",
      locale: "en-US",
    });
    expect(html).toContain("Sal &amp; Sons &lt;Diving&gt;");
    expect(html).not.toContain("<img");
  });
});
