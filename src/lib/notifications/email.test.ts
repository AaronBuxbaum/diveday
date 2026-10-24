import { describe, expect, it } from "vitest";
import {
  bookingCancelledEmail,
  bookingConfirmationEmail,
  demoStartedAlertEmail,
  emailButton,
  emailPanel,
  guardianReleaseCopyEmail,
  interestReceivedEmail,
  lastMinuteDealEmail,
  newAccountAlertEmail,
  passwordChangedEmail,
  passwordResetEmail,
  setupRequestAlertEmail,
  tripBlowoutEmail,
  tripConditionsHoldEmail,
  tripInvitationEmail,
  tripMinimumNotMetEmail,
  tripRescheduledEmail,
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
    expect(email.text).toContain("Bring\n- Reef-safe sunscreen");
    expect(email.text).toContain("Reef-safe sunscreen");
    expect(email.text).toContain("digital certification record");
    expect(email.html).toContain("<strong>Bring</strong>");
    expect(email.html).toContain("Reef-safe sunscreen");
    // The one tinted panel in any template: without the class the wrapper's
    // dark rules cannot reach it, and its light fill stays put in a dark inbox.
    expect(email.html).toContain('class="dd-panel"');
  });

  it("omits the checklist entirely when the shop has no packing list (no empty box)", () => {
    const email = bookingConfirmationEmail(base);
    expect(email.text).not.toContain("Bring");
    expect(email.html).not.toContain("Bring");
  });
  /** UX review 2026-10-11, item 7: one booking, one email, the waiver its first step. */
  it("carries the waiver as its first step, above the dock call", () => {
    const email = bookingConfirmationEmail({
      ...base,
      readinessUrl: "https://dive.day/ready/abc",
      waiverUrl: "https://dive.day/waivers/xyz",
      waiverExpiresAt: new Date("2026-07-30T13:00:00.000Z"),
    });
    const lead = "First, sign your waiver. Blue Mantis needs it before you board.";
    expect(email.text).toContain(lead);
    expect(email.text).toContain("https://dive.day/waivers/xyz");
    expect(email.text).toContain("This private link expires");
    expect(email.text.indexOf(lead)).toBeLessThan(email.text.indexOf("be at the dock"));
    expect(email.text.indexOf("waivers/xyz")).toBeLessThan(email.text.indexOf("ready/abc"));
    expect(email.html).toContain('href="https://dive.day/waivers/xyz"');
    expect(email.html).toContain("Sign your waiver");
  });

  it("says nothing about a waiver when none is owed", () => {
    const email = bookingConfirmationEmail({ ...base, readinessUrl: "https://dive.day/ready/abc" });
    expect(email.text).toContain("ready/abc");
    expect(email.text.toLowerCase()).not.toContain("waiver");
    expect(email.html.toLowerCase()).not.toContain("waiver");
  });

  it("escapes the shop name inside the waiver step", () => {
    const email = bookingConfirmationEmail({
      ...base,
      shopName: "<b>Mantis</b>",
      waiverUrl: "https://dive.day/waivers/xyz",
    });
    expect(email.html).not.toContain("<b>Mantis</b>");
  });
});

describe("course learning materials (ADR 20261008-course-learning-materials)", () => {
  const materials = [
    {
      name: "PADI Open Water eLearning",
      url: "https://www.padi.com/",
      note: "Finish before day 1",
    },
    { name: "Logbook <yours>" },
  ];

  it("lists the materials on the booking confirmation, linked", () => {
    const email = bookingConfirmationEmail({ ...base, learningMaterials: materials });
    expect(email.text).toContain("Before your first day");
    expect(email.text).toContain("- PADI Open Water eLearning (Finish before day 1)");
    expect(email.text).toContain("https://www.padi.com/");
    expect(email.html).toContain('<a href="https://www.padi.com/"');
    // The shop's words are escaped, never markup.
    expect(email.html).toContain("Logbook &lt;yours&gt;");
    expect(email.html).not.toContain("<yours>");
  });

  it("never links a stored link that is not https", () => {
    const email = bookingConfirmationEmail({
      ...base,
      learningMaterials: [{ name: "Manual", url: "javascript:alert(1)" }],
    });
    expect(email.html).toContain("Manual");
    expect(email.html).not.toContain("javascript:");
    expect(email.text).not.toContain("javascript:");
  });

  it("says nothing about materials on a booking that has none", () => {
    for (const learningMaterials of [undefined, []]) {
      const email = bookingConfirmationEmail({ ...base, learningMaterials });
      expect(email.text).not.toContain("Before your first day");
      expect(email.html).not.toContain("Before your first day");
    }
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

describe("tripInvitationEmail", () => {
  it("includes the invitation details and escapes staff-entered text", () => {
    const email = tripInvitationEmail({
      ...base,
      shopName: "Blue Mantis & Co.",
      tripTitle: '<Reef "Special">',
      bookingUrl: "https://diveday.example/s/blue-mantis/trips/trip-1",
    });

    expect(email.subject).toContain('<Reef "Special">');
    expect(email.text).toContain("This is an invitation, not a booking");
    expect(email.text).toContain("https://diveday.example/s/blue-mantis/trips/trip-1");
    expect(email.html).toContain('href="https://diveday.example/s/blue-mantis/trips/trip-1"');
    expect(email.html).toContain("&lt;Reef &quot;Special&quot;&gt;");
    // The shop speaks in the first person (ux review 2026-10-11, item 9); its
    // name rides the subject and the From, never raw markup in the body.
    expect(email.html).toContain("We’ve planned");
    expect(email.html).not.toContain("Blue Mantis & Co.");
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

describe("bookingCancelledEmail", () => {
  const canceled = {
    ...base,
    cancelledBy: "diver" as const,
    scheduleUrl: "https://diveday.example/s/blue-mantis",
  };

  it("names the trip and the amount on its way back", () => {
    const email = bookingCancelledEmail({
      ...canceled,
      money: { story: "refunded", amountCents: 12_500, currency: "usd" },
    });
    expect(email.subject).toBe("Booking canceled: Two-Tank Reef");
    expect(email.text).toContain("Your booking for Two-Tank Reef");
    expect(email.text).toContain("$125.00 is on its way back");
    expect(email.html).toContain("<strong>Two-Tank Reef</strong>");
    expect(email.html).toContain('href="https://diveday.example/s/blue-mantis"');
  });

  it("says the shop’s policy keeps the money past the window", () => {
    const email = bookingCancelledEmail({ ...canceled, money: { story: "forfeit" } });
    expect(email.text).toContain("our free-cancellation window closed");
    expect(email.text).toContain("nothing is refunded");
  });

  it("says the shop will be in touch when the money is not settled here", () => {
    const email = bookingCancelledEmail({
      ...canceled,
      cancelledBy: "shop",
      money: { story: "shop_will_follow_up" },
    });
    expect(email.text).toContain("We’ve canceled your booking");
    expect(email.text).toContain("We’ll be in touch about what you paid");
  });

  it("says nothing about money to a diver who never paid", () => {
    const email = bookingCancelledEmail({ ...canceled, money: { story: "none" } });
    expect(email.text).not.toMatch(/refund|paid/i);
    expect(email.html).not.toMatch(/refund|paid/i);
  });

  it("escapes the shop's own words in the html body", () => {
    const email = bookingCancelledEmail({
      ...canceled,
      tripTitle: "<b>Reef</b>",
      shopName: "Fish & Co",
      money: { story: "forfeit" },
    });
    expect(email.html).toContain("&lt;b&gt;Reef&lt;/b&gt;");
    expect(email.html).not.toContain("Fish & Co");
  });

  it("writes the amount in the diver's own locale", () => {
    const email = bookingCancelledEmail({
      ...canceled,
      locale: "es-ES",
      money: { story: "refunded", amountCents: 12_500, currency: "eur" },
    });
    expect(email.subject).toBe("Reserva cancelada: Two-Tank Reef");
    expect(email.text).toContain("125,00");
    expect(email.text).toContain("€");
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
    expect(email.subject).toContain("Trip canceled");
    expect(email.text).toContain("because of the weather");
    expect(email.text).toContain("Your payment is safe");
    expect(email.text).toContain("Night Dive — City of Washington");
    expect(email.text).toContain("https://diveday.example/s/blue-mantis/trips/trip-2");
    expect(email.html).toContain('href="https://diveday.example/s/blue-mantis/trips/trip-2"');
  });

  it("says a run the shop stopped is a run that stopped, never the weather", () => {
    const email = tripBlowoutEmail({
      ...base,
      cause: "run_ended",
      paymentStory: "refunded",
      alternatives: [],
      scheduleUrl: "https://diveday.example/s/blue-mantis",
    });
    expect(email.text).toContain("We’ve stopped running Two-Tank Reef for now");
    expect(email.text).not.toContain("weather");
    expect(email.html).toContain("<strong>Two-Tank Reef</strong>");
    expect(email.text).toContain("You’ve been refunded in full");
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
    expect(email.text).toContain("we’ll be in touch");
  });

  it("degrades gracefully to the schedule when no alternative qualifies", () => {
    const email = tripBlowoutEmail({
      ...base,
      paymentStory: "none",
      alternatives: [],
      scheduleUrl: "https://diveday.example/s/blue-mantis",
    });
    expect(email.text).toContain("You haven’t been charged");
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
    expect(email.text).toContain("your password hasn’t changed");
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

  it("names a percent deal once, in the subject and both bodies", () => {
    const email = lastMinuteDealEmail(dealBase);
    expect(email.subject.startsWith("25% off ")).toBe(true);
    expect(email.text).toContain("just opened up 25% off ");
    // The HTML once read "25% off% off": the figure is bold, the words are not.
    expect(email.html).toContain("just opened up <strong>25%</strong> off ");
    expect(email.html).not.toContain("off%");
  });

  it("names a fixed-amount deal in the shop's currency, never as a percent", () => {
    const { discountPercent: _percent, ...rest } = dealBase;
    const email = lastMinuteDealEmail({ ...rest, discountAmountCents: 2000, currency: "usd" });
    expect(email.subject.startsWith("$20 off ")).toBe(true);
    expect(email.text).toContain("just opened up $20 off ");
    expect(email.text).not.toContain("%");
  });
});

describe("interestReceivedEmail", () => {
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
    const email = interestReceivedEmail(inquiry);
    expect(email.text).toContain("When: the week of 12 August");
    expect(email.text.indexOf("When:")).toBeLessThan(email.text.indexOf("How many divers:"));
    // No stray separator where the retired "date asked for" line used to sit.
    expect(email.html).not.toContain("<br><br>");
  });

  it("names the dates the diver asked for, ahead of their own words about timing", () => {
    const email = interestReceivedEmail({
      ...inquiry,
      preferredDate: "2026-08-06",
      alternateDate: "2026-08-13",
    });
    expect(email.text).toContain("Dates asked for: Aug\u00A06, 2026 or Aug\u00A013, 2026");
    // The structured answer leads; the free text qualifies it.
    expect(email.text.indexOf("Dates asked for:")).toBeLessThan(email.text.indexOf("When:"));
  });

  it("says so when the diver can move a few days", () => {
    const email = interestReceivedEmail({
      ...inquiry,
      preferredDate: "2026-08-06",
      dateFlexible: true,
    });
    expect(email.text).toContain("Dates asked for: Aug\u00A06, 2026 (can move a few days)");
    // One date named, so no disjunction to build.
    expect(email.text).not.toContain(" or ");
  });

  it("renders no date line at all when the diver named none", () => {
    const email = interestReceivedEmail(inquiry);
    expect(email.text).not.toContain("Dates asked for");
    // Never "Not said" here: the free-text "When:" line already answered.
    expect(email.text).toContain("When: the week of 12 August");
  });

  it("reads a calendar date through UTC, so the server's zone cannot shift the day", () => {
    // 2026-08-06 is a date, not an instant. A renderer that went through a
    // negative-offset zone would print Aug 5 for every shop west of Greenwich.
    const email = interestReceivedEmail({ ...inquiry, preferredDate: "2026-08-06" });
    expect(email.text).toContain("Aug\u00A06, 2026");
    expect(email.text).not.toContain("Aug\u00A05, 2026");
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

  it("renders the shop name as a text header, escaped, with no image when DiveDay is the voice", () => {
    const html = wrapEmailHtml("<p>Body</p>", {
      shopName: "Sal & Sons <Diving>",
      locale: "en-US",
    });
    expect(html).toContain("Sal &amp; Sons &lt;Diving&gt;");
    expect(html).not.toContain("<img");
  });

  // The invariant, not the palette: `color-scheme: light dark` tells a client
  // to stop inverting because the message handles both schemes, so a document
  // that declares it and ships no dark block is the dark-on-dark of issue #771.
  it("never claims both color schemes without supplying dark values", () => {
    const html = wrapEmailHtml("<p>Body</p>", { shopName: "Blue Mantis", locale: "en-US" });
    if (html.includes('name="color-scheme"')) {
      expect(html).toContain("@media (prefers-color-scheme:dark)");
    }
  });

  it("flips page, ink, and action colors in dark mode", () => {
    const html = wrapEmailHtml("<p>Body</p>", { shopName: "Blue Mantis", locale: "en-US" });
    const dark = html.slice(html.indexOf("@media (prefers-color-scheme:dark)"));
    // The Logbook dark theme: ground, ink, and teal (ADR 20261001-logbook).
    expect(dark).toContain("#0f171c");
    expect(dark).toContain("#e4ebef");
    expect(dark).toContain("#4fbcd8");
  });

  // Inline declarations outrank any stylesheet rule that is not `!important`,
  // so a dark rule without it renders as light in every client that reads it.
  it("marks every dark override important, since inline styles carry the light values", () => {
    const html = wrapEmailHtml("<p>Body</p>", { shopName: "Blue Mantis", locale: "en-US" });
    const dark = html.slice(
      html.indexOf("@media (prefers-color-scheme:dark)"),
      html.indexOf("</style>"),
    );
    for (const declaration of dark.matchAll(
      /(background-color|color|border-left-color)\s*:[^;}]+/g,
    ))
      expect(declaration[0]).toContain("!important");
  });

  // A client that strips <style> gets the light document it got before, which
  // is the whole reason the light half stays inline rather than moving too.
  it("keeps the light values inline, so a client that strips the stylesheet still reads", () => {
    const html = wrapEmailHtml("<p>Body</p>", { shopName: "Blue Mantis", locale: "en-US" });
    const body = html.slice(html.indexOf("<body"));
    // The Logbook light theme: ground, ink, teal
    expect(body).toContain("background-color: #f4f6f4");
    expect(body).toContain("color: #16232c");
    expect(body).toContain("#0b6e8a");
  });

  // ux review 2026-10-11, item 3: mail sent as the shop wears the shop.
  describe("sent as the shop", () => {
    const brand = {
      logoUrl: "https://media.dive.day/logos/blue-mantis.png",
      color: "#158462",
      credit: "Bookings by DiveDay",
    };

    it("leads with the shop's logo beside its name, never instead of it", () => {
      const html = wrapEmailHtml("<p>Body</p>", {
        shopName: "Sal & Sons",
        locale: "en-US",
        brand,
      });
      const header = html.slice(html.indexOf('class="dd-card"'), html.indexOf("<p>Body</p>"));
      // The image carries no words of its own: a client that blocks images
      // shows the name beside it and nothing broken.
      expect(header).toContain('<img src="https://media.dive.day/logos/blue-mantis.png" alt=""');
      expect(header).toContain("Sal &amp; Sons");
      // DiveDay's mark is not the headline any more.
      expect(header).not.toContain("#ff6b6b");
    });

    it("keeps the shop's name as the header when it has no logo", () => {
      const html = wrapEmailHtml("<p>Body</p>", {
        shopName: "Blue Mantis",
        locale: "en-US",
        brand: { credit: brand.credit },
      });
      expect(html).not.toContain("<img");
      expect(html).toContain("Blue Mantis");
    });

    it("puts DiveDay at the foot as a credit, after the shop's card", () => {
      const html = wrapEmailHtml("<p>Body</p>", {
        shopName: "Blue Mantis",
        locale: "en-US",
        brand,
      });
      const credit = html.indexOf("Bookings by DiveDay");
      expect(credit).toBeGreaterThan(html.indexOf("<p>Body</p>"));
      expect(html.slice(credit - 2_000, credit)).toContain("#ff6b6b");
    });

    it("wears the shop's colour, moved until it reads, on buttons, panels and links", () => {
      const body = `${emailButton("https://dive.day/ready/x", "Open")}${emailPanel("Bring", "<ul><li>Mask</li></ul>")}`;
      const html = wrapEmailHtml(body, { shopName: "Blue Mantis", locale: "en-US", brand });
      const card = html.slice(html.indexOf('class="dd-card"'), html.indexOf("Bookings by DiveDay"));
      const shopCard = card.slice(0, card.lastIndexOf("<table"));
      expect(shopCard).not.toContain("#0b6e8a");
      // The seeded green fails 4.5:1 on white as it stands, so it is darkened
      // exactly as the storefront darkens it.
      expect(card).toContain("background-color: #13795a");
      expect(html).toContain("a{color:#13795a;}");
    });

    it("recolours only what the template drew, never the shop's or a diver's words", () => {
      const html = wrapEmailHtml("<p>Ask for #0b6e8a at the desk</p>", {
        shopName: "Blue Mantis",
        locale: "en-US",
        brand,
      });
      expect(html).toContain("<p>Ask for #0b6e8a at the desk</p>");
    });
  });

  // Issue #770: an inline <svg> mark is stripped outright by Outlook's Word
  // rendering engine, so the mark is table cells — border-radius and
  // background-color, the same survival property emailButton() above already
  // leans on — rather than SVG or a remote <img> (which the "never a logo
  // image" test above already refuses for the same reason: a client that
  // blocks images by default shows a broken placeholder, not the mark).
  it("renders the bubble mark as table cells, not svg or an image", () => {
    const html = wrapEmailHtml("<p>Body</p>", { shopName: "Blue Mantis", locale: "en-US" });
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<img");
    expect(html).toContain("background-color: #0b6e8a");
    expect(html).toContain("background-color: #ff6b6b");
    expect(html).toContain("border-radius: 50%");
  });
});

/**
 * **The guardian's copy carries no door** (issue #1453).
 *
 * The whole shape of this message is what it refuses: the release is already
 * signed when it sends, so a second capability URL to a third party is a
 * security surface with nothing behind it, and the issue rules it out by name.
 * The renderer beside this one is built from a link and a button, so the
 * likeliest way this breaks is a copy-paste — which is why the assertion is on
 * the rendered bytes rather than on the input shape, and why it runs in both
 * locales: one bundle gaining a URL in a translated string would slip past a
 * check on the English alone.
 */
describe("the guardian's copy of a signed release", () => {
  const input = {
    guardianName: "Jordan Fischer",
    diverName: "Lena Fischer",
    shopName: "Blue Mantis & Co.",
    releaseTitle: '<Liability "Release">',
    releaseVersion: 3,
    signedAt: new Date("2026-08-01T13:00:00.000Z"),
    timezone: "America/New_York",
  };

  it.each(["en-US", "es-ES"] as const)("carries no link and no token (%s)", (locale) => {
    const email = guardianReleaseCopyEmail({ ...input, locale });

    expect(email.html).not.toContain("<a ");
    expect(email.html).not.toContain("http");
    expect(email.text).not.toContain("http");
    // Every fact the message is for, and nothing about the diver's health:
    // the questionnaire is the minor's own information and a courtesy copy to
    // a third party is not where it travels.
    expect(email.text).toContain("Lena Fischer");
    expect(email.text).toContain("Blue Mantis & Co.");
    expect(email.subject).toContain("Lena Fischer");
  });

  it("escapes the shop and release names it renders into HTML", () => {
    const email = guardianReleaseCopyEmail({ ...input, locale: "en-US" });

    expect(email.html).toContain("Blue Mantis &amp; Co.");
    expect(email.html).toContain("&lt;Liability &quot;Release&quot;&gt;");
  });
});

describe("setupRequestAlertEmail (ADR 20261007-setup-request-form)", () => {
  const request = {
    shopName: "Reef <Line> Divers",
    region: "Key Largo",
    runsBoat: true,
    currentSystem: "booking_system" as const,
    contactName: "Ana Ruiz",
    contactEmail: "ana@reefline.example",
    source: "pricing",
    requestLocale: "es-ES",
  };

  it("lays out what a first reply needs, and leaves out a phone nobody gave", () => {
    const email = setupRequestAlertEmail(request);
    expect(email.subject).toBe("Set-up request: Reef <Line> Divers (Key Largo)");
    expect(email.text).toContain("Runs a boat: yes");
    expect(email.text).toContain("Uses today: a booking system");
    expect(email.text).toContain("Email (unverified): ana@reefline.example");
    expect(email.text).toContain("From: pricing");
    expect(email.text).not.toContain("Phone:");
    expect(setupRequestAlertEmail({ ...request, contactPhone: "+1 305 555 0100" }).text).toContain(
      "Phone: +1 305 555 0100",
    );
  });

  it("carries the setup link with what it opens and who to send it to, when there is one", () => {
    const url = "https://dive.day/onboard?setup=AbC_123";
    const email = setupRequestAlertEmail({
      ...request,
      setupUrl: url,
      setupUrlExpiresAt: new Date("2026-10-23T12:00:00Z"),
    });
    expect(email.text).toContain(`Setup link: ${url}`);
    expect(email.text).toContain("for one shop, once, until 2026-10-23 (UTC)");
    expect(email.text).toContain("Send it only to someone you have spoken to.");
    expect(email.html).toContain(`href="${url}"`);
    expect(setupRequestAlertEmail(request).text).not.toContain("Setup link");
  });

  it("escapes everything the requester typed", () => {
    const email = setupRequestAlertEmail(request);
    expect(email.html).toContain("Reef &lt;Line&gt; Divers");
    expect(email.html).not.toContain("<Line>");
  });
});

/** Intl's narrow and non-breaking spaces, as plain ones, for reading a body as a person would. */
const flat = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

const meetingPoint = {
  label: "North Pier",
  address: "1 Dock St, Key Largo, FL",
  landmark: "Blue awning beside the fuel dock",
  parking: "Free lot behind the bait shop",
  mapQuery: "North Pier, 1 Dock St, Key Largo, FL",
};

describe("where to go (ux review 2026-10-11, items 4 and 27)", () => {
  it("puts the meeting point, its notes and a maps link on the confirmation", () => {
    const email = bookingConfirmationEmail({ ...base, meetingPoint });
    expect(email.text).toContain(
      "Where to go\nNorth Pier\n1 Dock St, Key Largo, FL\nLandmark: Blue awning beside the fuel dock\nParking: Free lot behind the bait shop\nOpen in maps: https://www.google.com/maps/search/?api=1&query=North%20Pier%2C%201%20Dock%20St%2C%20Key%20Largo%2C%20FL",
    );
    expect(email.html).toContain("<strong>Where to go</strong>");
    expect(email.html).toContain('class="dd-panel"');
    expect(email.html).toContain(">Open in maps</a>");
  });

  it("escapes the shop's words and draws no map link without an honest query", () => {
    const email = bookingConfirmationEmail({
      ...base,
      meetingPoint: { ...meetingPoint, label: "<b>Pier</b>", mapQuery: null },
    });
    expect(email.html).toContain("&lt;b&gt;Pier&lt;/b&gt;");
    expect(email.html).not.toContain("Open in maps");
  });

  it("says it in Spanish to a Spanish reader", () => {
    const email = bookingConfirmationEmail({ ...base, locale: "es-ES", meetingPoint });
    expect(email.text).toContain("Adónde ir");
    expect(email.text).toContain("Referencia: Blue awning");
    expect(email.text).toContain("Estacionamiento: Free lot");
    expect(email.text).toContain("Abrir en mapas");
  });
});

describe("the confirmation's terms (ux review 2026-10-11, item 5)", () => {
  it("names the seat's money, the free-cancellation window and the calendar link", () => {
    const email = bookingConfirmationEmail({
      ...base,
      money: { due: "deposit", depositCents: 5_000, balanceCents: 10_000, currency: "usd" },
      freeCancellationUntil: new Date("2026-07-30T13:00:00.000Z"),
      calendarUrl: "https://diveday.example/s/blue-mantis/trips/abc/calendar",
    });
    expect(flat(email.text)).toContain(
      "Your seat: $50.00 by card online, then $100.00 at the dock on Sat, Aug 1.",
    );
    expect(flat(email.text)).toContain("Free cancellation until Jul 30, 9:00 AM EDT");
    expect(email.text).toContain(
      "Add to calendar:\nhttps://diveday.example/s/blue-mantis/trips/abc/calendar",
    );
    expect(email.html).toContain(
      '<a href="https://diveday.example/s/blue-mantis/trips/abc/calendar">Add to calendar</a>',
    );
  });

  it("says what is owed at the shop, and what was taken online", () => {
    expect(
      bookingConfirmationEmail({
        ...base,
        money: { due: "at_shop", amountCents: 12_000, currency: "usd" },
      }).text,
    ).toContain("Your seat: $120.00, due at the shop.");
    expect(
      bookingConfirmationEmail({
        ...base,
        locale: "es-ES",
        money: { due: "online", amountCents: 12_000, currency: "usd" },
      }).text,
    ).toMatch(/Tu plaza: .*120.*, con tarjeta en línea\./);
  });

  it("says the party's figure once when the lead holds several seats (fourth UX review, item 5)", () => {
    expect(
      bookingConfirmationEmail({
        ...base,
        money: { due: "at_shop", amountCents: 28_500, currency: "usd", seats: 3 },
      }).text,
    ).toContain("3 seats: $285.00, due at the shop.");
    expect(
      bookingConfirmationEmail({
        ...base,
        locale: "es-ES",
        money: { due: "at_shop", amountCents: 28_500, currency: "usd", seats: 3 },
      }).text,
    ).toMatch(/3 plazas: .*285.*, a pagar en el centro\./);
  });

  it("states what the party paid by card, under the seat's own line (#2447)", () => {
    const email = bookingConfirmationEmail({
      ...base,
      money: { due: "online", amountCents: 12_000, currency: "usd" },
      partyPaid: { amountCents: 63_180, currency: "usd", seats: 4 },
    });
    expect(email.text).toContain(
      "Your seat: $120.00, by card online.\nPaid by card for 4 seats: $631.80.",
    );
    expect(
      bookingConfirmationEmail({
        ...base,
        partyPaid: { amountCents: 14_750, currency: "usd", seats: 1 },
      }).text,
    ).toContain("Paid by card: $147.50.");
    expect(
      bookingConfirmationEmail({
        ...base,
        locale: "es-ES",
        partyPaid: { amountCents: 63_180, currency: "usd", seats: 4 },
      }).text,
    ).toMatch(/Pagado con tarjeta por 4 plazas: .*631,80/);
  });

  it("says nothing of money, window or calendar when there is none", () => {
    const email = bookingConfirmationEmail(base);
    expect(email.text).not.toContain("Your seat:");
    expect(email.text).not.toContain("Free cancellation");
    expect(email.text).not.toContain("Add to calendar");
  });
});

describe("tripRescheduledEmail (ux review 2026-10-11, item 1)", () => {
  const moved = {
    ...base,
    previousStartsAt: new Date("2026-07-31T13:00:00.000Z"),
    dockCallMinutes: 30,
    readinessUrl: "https://diveday.example/ready/tok",
  };

  it("leads with the new time, says the old one, and links the diver's trip prep", () => {
    const email = tripRescheduledEmail(moved);
    expect(email.subject).toBe("New time for Two-Tank Reef");
    expect(email.text).toContain("We moved Two-Tank Reef. Here is the new time.");
    expect(flat(email.text)).toContain(
      "Sat, Aug 1\n9:00 AM – 1:00 PM EDT\nIt was Jul 31, 9:00 AM EDT.",
    );
    expect(email.text).toContain("Please be at the dock 30 minutes early.");
    expect(email.text).toContain("https://diveday.example/ready/tok");
    expect(email.text).not.toContain("Where to go");
    expect(email.html).toContain("<strong>Two-Tank Reef</strong>");
  });

  it("says where only when the meeting point moved too", () => {
    const email = tripRescheduledEmail({ ...moved, meetingPoint });
    expect(email.text).toContain("We meet somewhere new, too.");
    expect(email.text).toContain("Where to go\nNorth Pier");
  });

  it("escapes the title and speaks Spanish to a Spanish reader", () => {
    const email = tripRescheduledEmail({ ...moved, locale: "es-ES", tripTitle: "<i>Reef</i>" });
    expect(email.subject).toBe("Nuevo horario para <i>Reef</i>");
    expect(email.html).toContain("<strong>&lt;i&gt;Reef&lt;/i&gt;</strong>");
    expect(email.text).toContain("Antes era el");
    expect(email.text).toContain("¿No puedes a la nueva hora?");
  });

  it("names no dock on a course session", () => {
    const { dockCallMinutes: _omit, ...course } = moved;
    expect(tripRescheduledEmail(course).text).not.toContain("dock");
  });

  // #2443: only the meeting point moved, so there is no old time to give.
  it("leads with the place when only the meeting point moved", () => {
    const email = tripRescheduledEmail({ ...moved, previousStartsAt: base.startsAt, meetingPoint });
    expect(email.subject).toBe("New meeting point for Two-Tank Reef");
    expect(email.text).toContain("We moved where we meet for Two-Tank Reef. The time is the same.");
    expect(email.text).toContain("Where to go\nNorth Pier");
    expect(email.text).not.toContain("It was");
    expect(email.text).not.toContain("somewhere new, too");
    expect(email.text).not.toContain("new time");
    const spanish = tripRescheduledEmail({
      ...moved,
      previousStartsAt: base.startsAt,
      meetingPoint,
      locale: "es-ES",
    });
    expect(spanish.subject).toBe("Nuevo punto de encuentro para Two-Tank Reef");
    expect(spanish.text).not.toContain("Antes era");
  });
});
