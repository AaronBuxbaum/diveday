import { describe, expect, it } from "vitest";
import { partyNotBookedEmail, seatAlreadyHeldEmail } from "./seat-already-held";

const trip = {
  shopName: "Blue Mantis",
  tripTitle: "Two-Tank Reef",
  startsAt: new Date("2026-10-31T13:00:00.000Z"),
  timezone: "America/New_York",
};

describe("seatAlreadyHeldEmail", () => {
  it("says which door the address was tried at", () => {
    const claim = seatAlreadyHeldEmail({
      ...trip,
      locale: "en-US",
      diverName: "Nora Diaz",
      attempt: "claim",
    });
    const booking = seatAlreadyHeldEmail({
      ...trip,
      locale: "en-US",
      diverName: "Nora Diaz",
      attempt: "booking",
    });
    expect(claim.text).toContain("seat-claim link");
    expect(booking.text).toContain("tried to book Two-Tank Reef");
    expect(booking.text).toContain("so nothing changed");
  });
});

/**
 * The lead of a rolled-back party (#2691) learns that the party did not book
 * and why, and is never told which member holds the seat: the function is not
 * even handed that member.
 */
describe("partyNotBookedEmail", () => {
  it("tells the lead nothing was booked, in either language", () => {
    const en = partyNotBookedEmail({ ...trip, locale: "en-US", leadName: "Lena Lead" });
    expect(en.subject).toBe("Your party for Two-Tank Reef wasn’t booked");
    expect(en.text).toContain("Hi Lena");
    expect(en.text).toContain("couldn’t be booked together");
    const es = partyNotBookedEmail({ ...trip, locale: "es-ES", leadName: "Lena Lead" });
    expect(es.subject).toBe("No se reservó tu grupo para Two-Tank Reef");
  });

  it("does not say why, so a lead cannot learn that a member holds a seat", () => {
    // The lead's address is whatever the submitter typed: their own, in a probe.
    for (const locale of ["en-US", "es-ES"] as const) {
      const email = partyNotBookedEmail({ ...trip, locale, leadName: "Lena Lead" });
      expect(`${email.subject} ${email.text}`).not.toMatch(/already|seat|plaza|ya tiene/i);
    }
  });

  it("escapes what it quotes into the html", () => {
    const email = partyNotBookedEmail({
      ...trip,
      tripTitle: "<b>Reef</b>",
      locale: "en-US",
      leadName: "Lena",
    });
    expect(email.html).not.toContain("<b>Reef</b>");
    expect(email.html).toContain("&lt;b&gt;Reef&lt;/b&gt;");
  });
});
