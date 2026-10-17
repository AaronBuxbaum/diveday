import { describe, expect, it } from "vitest";
import { tripInvitationEmail } from "./email";

/**
 * A ladder invite to Rescue or Divemaster carries the course's prerequisite
 * note, so the mail never implies the diver already qualifies (dive-domain
 * review N3). A plain invite says nothing of it.
 */
const invite = {
  locale: "en-US" as const,
  diverName: "Pat Diver",
  shopName: "Blue Mantis",
  tripTitle: "Rescue Diver",
  startsAt: new Date("2026-08-01T13:00:00.000Z"),
  endsAt: new Date("2026-08-01T17:00:00.000Z"),
  timezone: "America/New_York",
  bookingUrl: "https://diveday.example/s/blue-mantis/trips/trip-1",
};

describe("tripInvitationEmail's prerequisite note", () => {
  it("is absent from an invite without one", () => {
    const email = tripInvitationEmail(invite);
    expect(email.text).not.toContain("Before you book");
    expect(email.html).not.toContain("Before you book");
  });

  it("is carried, escaped, when the course has one", () => {
    const email = tripInvitationEmail({
      ...invite,
      prerequisiteNote: "EFR within 24 months <required>",
    });
    expect(email.text).toContain("Before you book: EFR within 24 months <required>");
    expect(email.html).toContain("Before you book: EFR within 24 months &lt;required&gt;");
    expect(email.html).not.toContain("<required>");
  });
});
