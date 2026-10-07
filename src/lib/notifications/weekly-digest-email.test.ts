import { describe, expect, it } from "vitest";
import { type Notification, notificationIdempotencyKey, notificationSchema } from "./kinds";
import { messageFor } from "./render";
import { weeklyDigestQuietWeekEmail } from "./weekly-digest-email";

const BASE = {
  kind: "weekly_digest",
  shopId: "11111111-1111-4111-8111-111111111111",
  personId: "22222222-2222-4222-8222-222222222222",
  to: "owner@diveday.example",
  locale: "en-US",
  recipientName: "Dana Reyes",
  shopName: "Blue Mantis <Scuba>",
  timezone: "America/New_York",
  weekOf: "2026-10-05",
  lastWeekFrom: "2026-09-28",
  lastWeekTo: "2026-10-04",
  thisWeekFrom: "2026-10-05",
  thisWeekTo: "2026-10-11",
  sections: [
    {
      kind: "last_week",
      bookingsMade: 4,
      departures: 2,
      seatsFilled: 9,
      seats: 12,
      url: "https://diveday.example/shop/blue-mantis/reports",
    },
    {
      kind: "waivers",
      divers: 1,
      departures: 1,
      url: "https://diveday.example/shop/blue-mantis",
    },
  ],
  settingsUrl: "https://diveday.example/shop/blue-mantis/settings/email",
  turnOffUrl: "https://diveday.example/unsubscribe/abc",
} satisfies Notification;

describe("the weekly_digest notification", () => {
  it("validates, and keys one email per person per week", () => {
    const parsed = notificationSchema.parse(BASE);
    expect(notificationIdempotencyKey(parsed)).toBe(
      "weekly-digest/22222222-2222-4222-8222-222222222222/2026-10-05",
    );
  });

  it("refuses an email with nothing in it", () => {
    expect(notificationSchema.safeParse({ ...BASE, sections: [] }).success).toBe(false);
  });

  it("renders only the sections it was given, each with its link", () => {
    const { subject, text, html } = messageFor(BASE);
    expect(subject).toBe("Your week at Blue Mantis <Scuba>");
    expect(text).toContain("4 new bookings.");
    expect(text).toContain("2 departures sailed with 9 of 12 seats filled (75%).");
    expect(text).toContain("1 diver still needs a signed waiver, across 1 departure this week.");
    expect(text).toContain("Open Reports: https://diveday.example/shop/blue-mantis/reports");
    expect(text).not.toContain("Reviews");
    expect(html).toContain('href="https://diveday.example/shop/blue-mantis/reports"');
  });

  it("names the zone the weeks are cut in", () => {
    expect(messageFor(BASE).text).toContain("Weeks run Monday to Sunday, Eastern Daylight Time.");
  });

  it("carries the way out and the settings page, and no commercial postal footer", () => {
    const { text, html } = messageFor({
      ...BASE,
      sender: { postalAddress: "1 Ocean Dr, Key Largo, FL" },
    });
    expect(text).toContain("Stop these emails: https://diveday.example/unsubscribe/abc");
    expect(text).toContain(
      "Email settings: https://diveday.example/shop/blue-mantis/settings/email",
    );
    expect(html).not.toContain("Key Largo");
  });

  it("escapes the shop's own words in the html body", () => {
    const { html } = messageFor(BASE);
    expect(html).toContain("Blue Mantis &lt;Scuba&gt;");
    expect(html).not.toContain("Blue Mantis <Scuba>");
  });

  it("writes Spanish to a Spanish-speaking recipient", () => {
    const { subject, text } = messageFor({ ...BASE, locale: "es-ES" });
    expect(subject).toBe("Tu semana en Blue Mantis <Scuba>");
    expect(text).toContain("4 reservas nuevas.");
    expect(text).toContain("Las semanas van de lunes a domingo");
  });

  it("drops the sailing line from a week that only took bookings", () => {
    const { text } = messageFor({
      ...BASE,
      sections: [
        {
          kind: "last_week",
          bookingsMade: 1,
          departures: 0,
          seatsFilled: 0,
          seats: 0,
          url: "https://diveday.example/shop/blue-mantis/reports",
        },
      ],
    });
    expect(text).toContain("1 new booking.");
    expect(text).not.toContain("sailed");
  });
});

describe("weeklyDigestQuietWeekEmail", () => {
  it("says no email goes out", () => {
    expect(weeklyDigestQuietWeekEmail({ locale: "en-US", shopName: "Blue Mantis" }).text).toContain(
      "no email goes out this Monday",
    );
  });
});
