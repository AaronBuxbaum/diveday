import { describe, expect, it } from "vitest";
import type { ReadinessBlocker } from "./readiness";
import {
  BOAT_ROWS_SHOWN,
  blockedDiverActions,
  filterActionsForRoles,
  foldBoatRows,
  oneRowPerDiver,
  type TodayAction,
  urgencyFor,
} from "./today";

/**
 * **Needs you names each diver once under each boat** (UX delight sheet
 * 2026-10-22, item 4, Aaron's call 4). Readiness is a safety surface, so these
 * are adversarial: a diver with five gaps, two boats, a diver on two boats,
 * divers with no gap, and a fold that may hide nobody's danger row.
 */

const NOW = new Date("2026-07-20T14:00:00Z");
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

function blocker(code: ReadinessBlocker["code"]): ReadinessBlocker {
  return { code };
}

function action(overrides: Partial<TodayAction> = {}): TodayAction {
  return {
    id: "a",
    kind: "waiver",
    urgency: "now",
    subject: "Diver",
    context: null,
    detail: "…",
    actionLabel: "Do it",
    href: "/",
    dueAt: hoursFromNow(2),
    ...overrides,
  };
}

describe("blockedDiverActions", () => {
  const diver = (fullName: string, codes: readonly ReadinessBlocker["code"][], tripId = "t1") => ({
    bookingId: `b-${fullName}-${tripId}`,
    personId: `p-${fullName}`,
    fullName,
    tripId,
    tripTitle: `${tripId === "t1" ? "Reef Drift" : "Wreck Run"} · 8:00 AM`,
    startsAt: hoursFromNow(3),
    blockers: codes.map(blocker),
  });

  it("names every diver on a boat of the same blocker, one row each", () => {
    const result = blockedDiverActions(
      ["Ana Ruiz", "Ben Cole", "Cara Diaz"].map((name) => diver(name, ["waiver_not_sent"])),
      "blue-reef",
      NOW,
    );
    expect(result.map((row) => row.subject)).toEqual(["Ana Ruiz", "Ben Cole", "Cara Diaz"]);
    // Each row sends its own diver's waiver, never a batch on someone else's behalf.
    expect(result.map((row) => row.waiver?.bookingIds)).toEqual([
      ["b-Ana Ruiz-t1"],
      ["b-Ben Cole-t1"],
      ["b-Cara Diaz-t1"],
    ]);
    expect(result.every((row) => row.detail === "Waiver not signed, not sent yet")).toBe(true);
  });

  it("gives a diver with five blockers one row that names all five, the headline first", () => {
    const [row, ...rest] = blockedDiverActions(
      [
        diver("Priya Sharma", [
          "payment_due",
          "waiver_not_sent",
          "certification_insufficient",
          "medical_review",
          "nitrox_pending",
        ]),
      ],
      "blue-reef",
      NOW,
    );
    expect(rest).toEqual([]);
    expect(row?.kind).toBe("medical_review");
    expect(row?.diver).toEqual({
      personId: "p-Priya Sharma",
      items: ["medical sign-off", "payment", "waiver", "certification", "nitrox certification"],
    });
  });

  it("drops nobody and invents nobody: exactly the divers with a blocker get a row", () => {
    const divers = [
      diver("Ana", ["waiver_not_sent"]),
      diver("Ben", []),
      diver("Cara", ["payment_due"]),
      { ...diver("Dev", ["waiver_pending"]), aboard: true },
      diver("Eli", ["medical_not_cleared", "identity_unconfirmed"], "t2"),
      diver("Fay", [], "t2"),
      diver("Ana", ["certification_missing"], "t2"),
    ];
    const result = blockedDiverActions(divers, "blue-reef", NOW);
    const named = result.map((row) => `${row.departure?.tripId}:${row.subject}`);
    expect(named.sort()).toEqual(["t1:Ana", "t1:Cara", "t1:Dev", "t2:Ana", "t2:Eli"]);
  });

  it("keeps an aboard diver's row aboard, beside ashore divers with the same blocker", () => {
    const result = blockedDiverActions(
      [diver("Ana", ["waiver_not_sent"]), { ...diver("Cara", ["waiver_not_sent"]), aboard: true }],
      "blue-reef",
      NOW,
    );
    expect(result.map((row) => [row.subject, row.kind])).toEqual([
      ["Ana", "waiver"],
      ["Cara", "blocked_aboard"],
    ]);
  });

  it("points a lone diver's card gap at their own record", () => {
    const [row] = blockedDiverActions(
      [diver("Ana Ruiz", ["certification_pending"])],
      "blue-reef",
      NOW,
    );
    expect(row?.href).toBe("/shop/blue-reef/divers/p-Ana Ruiz");
  });
});

describe("oneRowPerDiver", () => {
  const reef = { tripId: "t1", label: "Reef Drift · 8:00 AM" };
  const wreck = { tripId: "t2", label: "Wreck Run · 1:00 PM" };
  const blocked = (
    fullName: string,
    codes: readonly ReadinessBlocker["code"][],
    departure = reef,
  ) =>
    blockedDiverActions(
      [
        {
          bookingId: `b-${fullName}-${departure.tripId}`,
          personId: `p-${fullName}`,
          fullName,
          tripId: departure.tripId,
          tripTitle: departure.label,
          startsAt: hoursFromNow(3),
          blockers: codes.map(blocker),
        },
      ],
      "blue-reef",
      NOW,
    );
  /** A boat-work gap as `pushDepartureRows` raises it: one diver, one item. */
  const gap = (
    fullName: string,
    kind: "dive_prep" | "nitrox_gate" | "emergency_contact",
    item: string,
    departure = reef,
  ) =>
    action({
      id: `${kind}:${departure.tripId}:p-${fullName}`,
      kind,
      urgency: urgencyFor(hoursFromNow(3), NOW),
      subject: fullName,
      departure,
      detail: `${item} sentence`,
      href: `/shop/blue-reef/trips/${departure.tripId}`,
      diver: { personId: `p-${fullName}`, items: [item] },
      dueAt: hoursFromNow(3),
    });
  const orders = action({
    id: "orders:t1",
    kind: "payment",
    subject: "Reef Drift",
    departure: reef,
    aboutDeparture: true,
    detail: "1 order awaiting payment",
  });

  it("names a diver once with every open item, keeping the first fix's button", () => {
    const rows = oneRowPerDiver([
      ...blocked("Priya Sharma", ["waiver_not_sent"]),
      gap("Priya Sharma", "emergency_contact", "emergency contact"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject).toBe("Priya Sharma");
    expect(rows[0]?.detail).toBe("waiver, emergency contact");
    expect(rows[0]?.kind).toBe("waiver");
    expect(rows[0]?.waiver).toEqual({ bookingIds: ["b-Priya Sharma-t1"] });
  });

  it("folds a diver with five gaps into one row, worst first", () => {
    const rows = oneRowPerDiver([
      gap("Sam Lee", "dive_prep", "rental size"),
      gap("Sam Lee", "emergency_contact", "emergency contact"),
      ...blocked("Sam Lee", ["certification_insufficient", "waiver_pending"]),
      gap("Sam Lee", "nitrox_gate", "nitrox certification"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("certification");
    expect(rows[0]?.detail).toBe(
      "certification, waiver, rental size, emergency contact, nitrox certification",
    );
  });

  it("says an item once when two rows name it", () => {
    const rows = oneRowPerDiver([
      ...blocked("Sam Lee", ["nitrox_pending"]),
      gap("Sam Lee", "nitrox_gate", "nitrox certification"),
    ]);
    expect(rows).toHaveLength(1);
    // One item left, so the row keeps its own sentence.
    expect(rows[0]?.detail).toBe("Nitrox certification not verified yet");
  });

  it("names a diver on two boats under each boat, never folding one boat into the other", () => {
    const rows = oneRowPerDiver([
      ...blocked("Ana", ["waiver_not_sent"]),
      gap("Ana", "dive_prep", "rental size", wreck),
      gap("Ana", "emergency_contact", "emergency contact", reef),
    ]);
    expect(rows.map((row) => [row.departure?.tripId, row.subject, row.detail])).toEqual([
      ["t1", "Ana", "waiver, emergency contact"],
      ["t2", "Ana", "rental size sentence"],
    ]);
  });

  it("keeps every diver on two boats, and leaves rows that name nobody alone", () => {
    const input = [
      ...blocked("Ana", ["waiver_not_sent"]),
      ...blocked("Ben", ["medical_not_cleared"]),
      orders,
      gap("Ben", "dive_prep", "kit"),
      gap("Cara", "emergency_contact", "emergency contact"),
      ...blocked("Dev", ["certification_missing"], wreck),
      gap("Dev", "dive_prep", "rental size", wreck),
      gap("Eli", "nitrox_gate", "nitrox certification", wreck),
    ];
    const rows = oneRowPerDiver(input);
    expect(rows.map((row) => `${row.departure?.tripId}:${row.subject}`)).toEqual([
      "t1:Ana",
      "t1:Ben",
      "t1:Reef Drift",
      "t1:Cara",
      "t2:Dev",
      "t2:Eli",
    ]);
    // Every (boat, diver) the input named is still named.
    const before = new Set(input.map((row) => `${row.departure?.tripId}:${row.subject}`));
    const after = new Set(rows.map((row) => `${row.departure?.tripId}:${row.subject}`));
    expect(after).toEqual(before);
    expect(rows.find((row) => row.subject === "Ben")?.kind).toBe("medical_not_cleared");
  });

  it("names only what the reader may see, because the role filter runs first", () => {
    const rows = oneRowPerDiver(
      filterActionsForRoles(
        [
          ...blocked("Priya Sharma", ["waiver_not_sent"]),
          gap("Priya Sharma", "emergency_contact", "emergency contact"),
          gap("Priya Sharma", "dive_prep", "rental size"),
        ],
        ["captain"],
      ),
    );
    expect(rows.map((row) => [row.kind, row.detail])).toEqual([
      ["dive_prep", "rental size sentence"],
    ]);
  });

  it("adds nothing for divers with no gaps", () => {
    expect(oneRowPerDiver([...blocked("Ana", []), orders])).toEqual([orders]);
  });
});

describe("foldBoatRows", () => {
  const rows = (count: number, kind: TodayAction["kind"] = "waiver") =>
    Array.from({ length: count }, (_, index) => action({ id: `${kind}-${index}`, kind }));

  it("shows a short boat whole, including one row past the cap", () => {
    expect(foldBoatRows(rows(BOAT_ROWS_SHOWN + 1)).more).toEqual([]);
  });

  it("folds a long boat after the cap, dropping nobody and keeping the order", () => {
    const all = rows(9);
    const { shown, more } = foldBoatRows(all);
    expect(shown).toHaveLength(BOAT_ROWS_SHOWN);
    expect(more).toHaveLength(9 - BOAT_ROWS_SHOWN);
    expect([...shown, ...more]).toEqual(all);
  });

  it("never folds a danger row, however many there are or wherever they sit", () => {
    const all = [...rows(7, "medical_not_cleared"), ...rows(3, "dive_prep")];
    const { shown, more } = foldBoatRows(all);
    expect(shown.filter((row) => row.kind === "medical_not_cleared")).toHaveLength(7);
    expect(more.map((row) => row.kind)).toEqual(["dive_prep", "dive_prep", "dive_prep"]);

    const late = [...rows(8, "dive_prep"), ...rows(1, "roll_call_missing_diver")];
    const folded = foldBoatRows(late);
    expect(folded.shown.some((row) => row.kind === "roll_call_missing_diver")).toBe(true);
    expect(folded.more.every((row) => row.kind === "dive_prep")).toBe(true);
    expect(folded.shown.length + folded.more.length).toBe(9);
  });
});
