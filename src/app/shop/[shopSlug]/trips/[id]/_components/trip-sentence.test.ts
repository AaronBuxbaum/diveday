import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { type TripSentenceInput, tripSentence } from "./trip-sentence";

const t = staffTranslator("en-US");
const ZONE = "America/New_York";
// Mon Nov 16 2026, 09:00 to 12:30 local (EST).
const startsAt = new Date("2026-11-16T14:00:00.000Z");
const endsAt = new Date("2026-11-16T17:30:00.000Z");

function say(over: Partial<TripSentenceInput>) {
  const sentence = tripSentence(
    {
      phase: "checkin",
      cancelled: false,
      now: new Date("2026-11-16T13:10:00.000Z"),
      startsAt,
      endsAt,
      nextStartsAt: startsAt,
      dockCallAt: new Date("2026-11-16T13:30:00.000Z"),
      booked: 11,
      capacity: 14,
      soldElsewhere: false,
      guests: 11,
      here: 2,
      notReady: 0,
      notBack: 0,
      stage: null,
      homeSaidAt: null,
      locale: "en-US",
      timeZone: ZONE,
      ...over,
    },
    t,
  );
  // Times keep their units whole with a no-break space.
  const plain = (text: string | null) => text?.replace(/\s/gu, " ") ?? null;
  return {
    headline: plain(sentence.headline),
    emphasis: sentence.emphasis,
    sub: plain(sentence.sub),
  };
}

describe("tripSentence", () => {
  it("Filling: seats to fill and days to go", () => {
    expect(say({ phase: "filling", now: new Date("2026-11-11T15:00:00.000Z") })).toEqual({
      headline: "3 seats to fill. The boat leaves in 5 days.",
      emphasis: null,
      sub: "11 of 14 booked",
    });
  });

  it("Filling, sold elsewhere: how many are ready, not seats to sell", () => {
    const filling = {
      phase: "filling" as const,
      now: new Date("2026-11-11T15:00:00.000Z"),
      soldElsewhere: true,
    };
    expect(say({ ...filling, booked: 10, guests: 10, notReady: 2 })).toEqual({
      headline: "8 of 10 guests ready. The boat leaves in 5 days.",
      emphasis: null,
      sub: "10 of 14 booked",
    });
    expect(say({ ...filling, booked: 0, guests: 0, notReady: 0 })).toEqual({
      headline: "No guests booked. The boat leaves in 5 days.",
      emphasis: null,
      sub: null,
    });
  });

  it("Getting ready: who is not ready, and when they meet", () => {
    expect(say({ phase: "ready", now: new Date("2026-11-15T15:00:00.000Z"), notReady: 2 })).toEqual(
      {
        headline: "2 guests aren’t ready yet. The boat leaves tomorrow at 9:00 AM.",
        emphasis: "2 guests",
        sub: "11 guests · at the dock by 8:30 AM",
      },
    );
  });

  it("Check-in: who can't board, minutes to leave, and who is here", () => {
    expect(say({ notReady: 2 })).toEqual({
      headline: "2 guests can’t board yet. The boat leaves in 50 minutes.",
      emphasis: "2 guests",
      sub: "2 of 11 here · at the dock by 8:30 AM",
    });
    expect(say({}).headline).toBe("Every guest can board. The boat leaves in 50 minutes.");
  });

  it("On the water: the recorded count first, never the clock", () => {
    const water = { phase: "water" as const, now: new Date("2026-11-16T15:40:00.000Z") };
    expect(say({ ...water, notBack: 2 })).toEqual({
      headline: "2 guests are recorded not back aboard.",
      emphasis: "2 guests",
      sub: "Scheduled back at 12:30 PM.",
    });
    expect(
      say({
        ...water,
        stage: { stage: "underway", recordedAt: new Date("2026-11-16T14:02:00.000Z") },
      }).headline,
    ).toBe("The crew said Underway at 9:02 AM.");
    // No evidence: what the schedule says, nothing about where anyone is.
    // Nothing recorded: say so, and what the schedule says, never "the boat is out".
    expect(say(water)).toMatchObject({ headline: "No roll call yet.", emphasis: null });
    expect(say(water).sub).toMatch(/^Scheduled back at /);
  });

  it("Wrapped up: the crew's Home is their word, never proof everyone is back", () => {
    const wrapped = { phase: "wrapped" as const, now: new Date("2026-11-16T19:00:00.000Z") };
    const home = new Date("2026-11-16T17:20:00.000Z");
    expect(say({ ...wrapped, homeSaidAt: home }).headline).toBe("The crew said Home at 12:20 PM.");
    expect(say(wrapped).headline).toBe("Scheduled back at 12:30 PM.");
    expect(say({ ...wrapped, homeSaidAt: home, notBack: 1 }).headline).toBe(
      "1 guest is recorded not back aboard.",
    );
    expect(say({ ...wrapped, cancelled: true })).toEqual({
      headline: "This trip is canceled.",
      emphasis: null,
      sub: "Was scheduled for Mon, Nov 16, 9:00 AM",
    });
  });

  it("says nothing about leaving once the hour has passed", () => {
    expect(say({ phase: "filling", now: new Date("2026-11-16T15:00:00.000Z") }).headline).toBe(
      "3 seats to fill.",
    );
  });
});
