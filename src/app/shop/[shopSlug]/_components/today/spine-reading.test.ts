import { describe, expect, it } from "vitest";
import type { TodayAction } from "@/lib/today";
import {
  rankBoatRows,
  rowLine,
  spineClearUnlessWindy,
  spineEntries,
  spineMoment,
} from "./spine-reading";

const at = (iso: string) => new Date(iso);

describe("spineEntries", () => {
  it("merges live and closing stations by time, a departure in one half only", () => {
    const spine = {
      stations: [
        { tripId: "noon", startsAt: at("2026-07-21T16:00:00Z") },
        { tripId: "dawn", startsAt: at("2026-07-21T11:00:00Z") },
      ],
    } as never;
    const close = {
      stations: [
        { tripId: "morning", startsAt: at("2026-07-21T13:00:00Z") },
        // Still live: the closing half never repeats it.
        { tripId: "noon", startsAt: at("2026-07-21T16:00:00Z") },
      ],
    } as never;
    const { liveTripIds, entries } = spineEntries(spine, close);
    expect([...liveTripIds].sort()).toEqual(["dawn", "noon"]);
    expect(
      entries.map((entry) =>
        entry.kind === "live" ? `live:${entry.station.tripId}` : `closing:${entry.close.tripId}`,
      ),
    ).toEqual(["live:dawn", "closing:morning", "live:noon"]);
  });

  it("reads the morning alone when there is no closing state", () => {
    const spine = { stations: [{ tripId: "dawn", startsAt: at("2026-07-21T11:00:00Z") }] } as never;
    expect(spineEntries(spine, undefined).entries).toHaveLength(1);
  });
});

describe("spineMoment", () => {
  it("lets the evening's all-home line outrank both morning moments", () => {
    expect(spineMoment({ allHome: true }, {}, {})).toEqual({
      allHomeLine: true,
      firstBookingMark: false,
      factOfScaleLine: false,
    });
  });

  it("puts the first booking ahead of the season's fact", () => {
    expect(spineMoment({ allHome: false }, {}, {})).toEqual({
      allHomeLine: false,
      firstBookingMark: true,
      factOfScaleLine: false,
    });
  });

  it("draws the season's fact when nothing above it holds", () => {
    expect(spineMoment(undefined, null, {})).toEqual({
      allHomeLine: false,
      firstBookingMark: false,
      factOfScaleLine: true,
    });
    expect(spineMoment(undefined, undefined, null).factOfScaleLine).toBe(false);
  });
});

describe("spineClearUnlessWindy", () => {
  const none = { allHomeLine: false, firstBookingMark: false, factOfScaleLine: false };
  const clearDay = { stations: [{ blocked: 0 }] };

  it("is never drawn under a coral moment", () => {
    for (const moment of [
      { ...none, allHomeLine: true },
      { ...none, firstBookingMark: true },
      { ...none, factOfScaleLine: true },
    ]) {
      expect(
        spineClearUnlessWindy(moment, { boatsClear: true, jobs: 0, blocked: 0 }, clearDay),
      ).toBe(false);
    }
  });

  it("follows the Needs you reading when it says the boats are clear", () => {
    expect(spineClearUnlessWindy(none, { boatsClear: true, jobs: 2, blocked: 0 }, clearDay)).toBe(
      true,
    );
  });

  it("with no job at all, stands only over stations with nobody blocked", () => {
    const idle = { boatsClear: false, jobs: 0, blocked: 0 };
    expect(spineClearUnlessWindy(none, idle, clearDay)).toBe(true);
    expect(spineClearUnlessWindy(none, idle, { stations: [] })).toBe(false);
    expect(spineClearUnlessWindy(none, idle, { stations: [{ blocked: 1 }] })).toBe(false);
    expect(spineClearUnlessWindy(none, { ...idle, blocked: 1 }, clearDay)).toBe(false);
    expect(spineClearUnlessWindy(none, { ...idle, jobs: 1 }, clearDay)).toBe(false);
  });
});

describe("rankBoatRows (A43)", () => {
  const row = (id: string, kind: TodayAction["kind"], tone?: TodayAction["tone"]) =>
    ({ id, kind, ...(tone ? { tone } : {}) }) as unknown as TodayAction;

  it("puts readiness and medical first, then contact, prep, money and the rest", () => {
    // The order `src/lib/today.ts` hands over: money and prep above contact.
    const rows = [
      row("payment", "payment"),
      row("help", "help_request"),
      row("prep", "dive_prep"),
      row("contact-a", "emergency_contact"),
      row("medical", "medical_review"),
      row("contact-b", "emergency_contact"),
      row("waiver", "waiver"),
      row("wanted", "seat_wanted"),
    ];
    expect(rankBoatRows(rows).map((action) => action.id)).toEqual([
      "medical",
      "waiver",
      "contact-a",
      "contact-b",
      "prep",
      "payment",
      "help",
      "wanted",
    ]);
  });

  it("keeps the incoming order inside a tier and drops nobody", () => {
    const rows = [row("c2", "emergency_contact"), row("c1", "emergency_contact")];
    expect(rankBoatRows(rows).map((action) => action.id)).toEqual(["c2", "c1"]);
    expect(rankBoatRows([])).toEqual([]);
  });

  it("lifts any danger row to the top, whatever its kind", () => {
    const rows = [row("contact", "emergency_contact"), row("loud-payment", "payment", "danger")];
    expect(rankBoatRows(rows).map((action) => action.id)).toEqual(["loud-payment", "contact"]);
  });

  it("ranks a diver's readiness blocker of a money kind with readiness", () => {
    // Today's order: the unpaid-seat blocker first, then contact and prep. A
    // shop that requires payment before boarding raises it as kind `payment`.
    const blocked = {
      id: "p1-payment",
      kind: "payment",
      diver: { personId: "p1", items: ["payment due"], readiness: true },
    } as unknown as TodayAction;
    const rows = [
      row("orders", "payment"),
      row("p2-contact", "emergency_contact"),
      row("p3-prep", "dive_prep"),
      blocked,
    ];
    expect(rankBoatRows(rows).map((action) => action.id)).toEqual([
      "p1-payment",
      "p2-contact",
      "p3-prep",
      "orders",
    ]);
  });

  it("ranks a kind it does not name with readiness, never under money", () => {
    const rows = [row("payment", "payment"), row("aboard", "blocked_aboard")];
    expect(rankBoatRows(rows)[0]?.id).toBe("aboard");
  });
});

describe("rowLine (A22)", () => {
  it("drops the one final period of a one-sentence line", () => {
    expect(rowLine("No emergency contact.")).toBe("No emergency contact");
    expect(rowLine("Sin contacto de emergencia.")).toBe("Sin contacto de emergencia");
    expect(rowLine("1 review is waiting on you.")).toBe("1 review is waiting on you");
  });

  it("leaves a line of two sentences, a line with no period, and an ellipsis alone", () => {
    expect(rowLine("$40 disputed. Answer it in Stripe.")).toBe(
      "$40 disputed. Answer it in Stripe.",
    );
    expect(rowLine("Waiver not signed, not sent yet")).toBe("Waiver not signed, not sent yet");
    expect(rowLine("Loading...")).toBe("Loading...");
    expect(rowLine("")).toBe("");
  });
});
