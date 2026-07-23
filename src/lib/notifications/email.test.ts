import { describe, expect, it } from "vitest";
import { bookingConfirmationEmail, tripRecapEmail, tripReminderEmail } from "./email";

const base = {
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
});

describe("tripReminderEmail", () => {
  it("names the diver's outstanding items as a checklist", () => {
    const email = tripReminderEmail({
      ...base,
      lead: "day",
      outstanding: ["sign your waiver", "settle your balance"],
    });
    expect(email.text).toContain("Still to sort before you board:");
    expect(email.text).toContain("- Sign your waiver");
    expect(email.text).toContain("- Settle your balance");
    expect(email.html).toContain("<li>Sign your waiver</li>");
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
    diverName: "Rae Recap",
    shopName: "Blue Mantis",
    tripTitle: "Two-Tank Reef",
    startsAt: new Date("2026-08-01T13:00:00.000Z"),
    timezone: "America/New_York",
    recapUrl: "https://diveday.test/recap/abc.def",
  };

  it("names the sites dived and links the recap", () => {
    const email = tripRecapEmail({ ...recapBase, sites: ["French Reef", "Molasses Reef"] });
    expect(email.text).toContain("You dived French Reef and Molasses Reef.");
    expect(email.text).toContain("https://diveday.test/recap/abc.def");
    expect(email.html).toContain('href="https://diveday.test/recap/abc.def"');
    expect(email.text).toContain("bring a buddy");
  });

  it("still reads well when the sites are unknown", () => {
    const email = tripRecapEmail(recapBase);
    expect(email.text).toContain("Thanks for diving Two-Tank Reef");
    expect(email.text).not.toContain("You dived .");
  });
});
