import { describe, expect, it } from "vitest";
import { bookingCancelledEmail } from "./email";

const canceled = {
  locale: "en-US" as const,
  diverName: "Pat Diver",
  shopName: "Blue Mantis",
  tripTitle: "Two-Tank Reef",
  startsAt: new Date("2026-08-01T13:00:00.000Z"),
  endsAt: new Date("2026-08-01T17:00:00.000Z"),
  timezone: "America/New_York",
  cancelledBy: "diver" as const,
  scheduleUrl: "https://diveday.example/s/blue-mantis",
};

describe("bookingCancelledEmail for a party lead", () => {
  // Issue #2604: a lead's email says what their cancel did to the party.
  it("names the party seats canceled and, apart, the ones that stay", () => {
    const email = bookingCancelledEmail({
      ...canceled,
      money: { story: "none" },
      party: { cancelled: 2, stayed: 1 },
    });
    expect(email.text).toContain("The 2 party seats you booked are canceled with yours.");
    expect(email.text).toContain("1 party seat stays booked");
    expect(email.html).toContain("<p>The 2 party seats you booked are canceled with yours.</p>");
  });

  it("says only what happened: seats canceled, or seats staying, not both lines", () => {
    const gone = bookingCancelledEmail({
      ...canceled,
      money: { story: "none" },
      party: { cancelled: 1, stayed: 0 },
    });
    expect(gone.text).toContain("The 1 party seat you booked is canceled with yours.");
    expect(gone.text).not.toContain("stays booked");
    const stays = bookingCancelledEmail({
      ...canceled,
      money: { story: "none" },
      party: { cancelled: 0, stayed: 2 },
    });
    expect(stays.text).toContain("2 party seats stay booked");
    expect(stays.text).not.toContain("canceled with yours");
  });

  it("reads exactly as before for a lead with no party", () => {
    const without = bookingCancelledEmail({ ...canceled, money: { story: "none" } });
    expect(without.text).not.toContain("party seat");
    expect(without).toEqual(
      bookingCancelledEmail({ ...canceled, money: { story: "none" }, party: undefined }),
    );
  });

  it("says the party in the diver's own language", () => {
    const email = bookingCancelledEmail({
      ...canceled,
      locale: "es-ES",
      money: { story: "none" },
      party: { cancelled: 2, stayed: 1 },
    });
    expect(email.text).toContain(
      "Las 2 plazas de tu grupo que reservaste se cancelan con la tuya.",
    );
    expect(email.text).toContain("1 plaza de tu grupo sigue reservada");
  });
});
