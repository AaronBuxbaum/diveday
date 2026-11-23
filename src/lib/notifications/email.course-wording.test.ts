import { describe, expect, it } from "vitest";
import { readinessLinkEmail, waitlistInviteEmail } from "./email";

// Issue #4912: a course student's wait-list and trip-link emails say first day and started, never boat or sailed.
const shared = {
  diverName: "Pat Diver",
  shopName: "Blue Mantis",
  tripTitle: "Open Water Diver, day 1",
  startsAt: new Date("2026-08-08T13:00:00.000Z"),
  endsAt: new Date("2026-08-08T17:00:00.000Z"),
  timezone: "America/New_York",
  courseSession: true,
};
const boatWords = {
  "en-US": /\b(boat|dock|sail|sails|sailed|sailing|board)\b/i,
  "es-ES": /\b(barco|bordo|muelle|zarpar|zarpa|zarpó|salir)\b/i,
} as const;
const everything = (email: { subject: string; text: string; html: string }) =>
  `${email.subject}\n${email.text}\n${email.html}`;

describe("a course student's wait-list email", () => {
  for (const locale of ["en-US", "es-ES"] as const) {
    for (const rolled of [false, true]) {
      it(`names no boat or sailing in ${locale}${rolled ? " when the date rolled" : ""}`, () => {
        const email = waitlistInviteEmail({
          ...shared,
          locale,
          bookingUrl: "https://example.test/s/blue-mantis/trips/abc",
          ...(rolled ? { sailedStartsAt: new Date("2026-08-01T13:00:00.000Z") } : {}),
        });
        expect(everything(email)).not.toMatch(boatWords[locale]);
      });
    }
  }

  it("says see you on your first day, and that the earlier date has started", () => {
    const base = { ...shared, locale: "en-US" as const, bookingUrl: "https://example.test/t" };
    expect(waitlistInviteEmail(base).text).toContain("See you on your first day.");
    const rolled = waitlistInviteEmail({
      ...base,
      sailedStartsAt: new Date("2026-08-01T13:00:00.000Z"),
    });
    expect(rolled.text).toContain("has already started.");
  });

  it("leaves a boat day alone", () => {
    const email = waitlistInviteEmail({
      ...shared,
      courseSession: false,
      locale: "en-US",
      bookingUrl: "https://example.test/t",
    });
    expect(email.text).toContain("See you on the boat.");
  });
});

describe("a course student's replacement trip link", () => {
  const link = {
    ...shared,
    readinessUrl: "https://example.test/ready/abc",
    expiresAt: new Date("2026-08-10T13:00:00.000Z"),
  };
  for (const locale of ["en-US", "es-ES"] as const) {
    it(`names no boat or sailing in ${locale}`, () => {
      expect(everything(readinessLinkEmail({ ...link, locale }))).not.toMatch(boatWords[locale]);
    });
  }

  it("says before your first day, and keeps a boat day's wording", () => {
    expect(readinessLinkEmail({ ...link, locale: "en-US" }).text).toContain(
      "before your first day of Open Water Diver, day 1",
    );
    expect(readinessLinkEmail({ ...link, locale: "en-US", courseSession: false }).text).toContain(
      "before you sail with us",
    );
  });

  it("keeps the course-forms words when that is why the link went out", () => {
    const email = readinessLinkEmail({ ...link, locale: "en-US", purpose: "course_forms" });
    expect(email.text).toContain("sign the course forms");
  });
});
