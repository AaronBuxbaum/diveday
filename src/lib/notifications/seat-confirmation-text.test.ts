import { describe, expect, it } from "vitest";
import { seatConfirmationText } from "./seat-confirmation-text";

const INPUT = {
  shopName: "Blue Mantis Divers",
  startsAt: new Date("2026-11-28T13:00:00Z"),
  timezone: "America/New_York",
  readinessUrl: "https://diveday.example/ready/c1.abc.def",
};

describe("seatConfirmationText", () => {
  it("names the shop, the day and the one link, in the diver's language", () => {
    expect(seatConfirmationText({ ...INPUT, locale: "en-US" })).toBe(
      "Blue Mantis Divers: your seat on Sat, Nov 28 is booked. Get ready here: https://diveday.example/ready/c1.abc.def",
    );
    expect(seatConfirmationText({ ...INPUT, locale: "es-ES" })).toContain(
      "Blue Mantis Divers: tu plaza del",
    );
  });

  it("joins the date with a plain space, so the text stays GSM-7", () => {
    expect(seatConfirmationText({ ...INPUT, locale: "en-US" })).not.toMatch(/[  ]/);
  });

  it("reads the day in the shop's zone, not the server's", () => {
    const lateNight = { ...INPUT, startsAt: new Date("2026-11-29T03:30:00Z") };
    expect(seatConfirmationText({ ...lateNight, locale: "en-US" })).toContain("Sat, Nov 28");
  });
});
