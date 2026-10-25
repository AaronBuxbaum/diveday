import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { ReadinessBlocker } from "./readiness";
import {
  BOAT_ROWS_SHOWN,
  blockedDiverActions,
  filterActionsForRoles,
  foldBoatRows,
  oneRowPerDiver,
  rowTone,
  sortStationRows,
  type TodayAction,
  urgencyFor,
  waiverBatchActions,
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
      items: [
        "medical sign-off",
        "not certified for this trip",
        "nitrox certification",
        "waiver",
        "payment",
      ],
      readiness: true,
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
    // The blocker's own sentence leads, "not sent yet" and all (review N2).
    expect(rows[0]?.detail).toBe("Waiver not signed, not sent yet; also emergency contact");
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
    // The emergency contact before the rental size: contact gaps rank above
    // prep (visual review 2026-10-24, A43).
    expect(rows[0]?.detail).toBe(
      "Not certified for this trip; also waiver, nitrox certification, emergency contact, rental size",
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
      ["t1", "Ana", "Waiver not signed, not sent yet; also emergency contact"],
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
  const rows = (count: number, kind: TodayAction["kind"] = "dive_prep") =>
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

  it("never folds a diver's own help request, so Arrange help stays in reach", () => {
    // A request is the diver's ask, waiting on a staffer to name a helper: a
    // neutral row, ranked last, that a fold would hide behind "and N more".
    const all = [...rows(7, "dive_prep"), ...rows(2, "help_request")];
    const { shown, more } = foldBoatRows(all);
    expect(shown.filter((row) => row.kind === "help_request")).toHaveLength(2);
    expect(more.every((row) => row.kind === "dive_prep")).toBe(true);
    expect([...shown, ...more]).toHaveLength(all.length);
  });

  it("shows five, counting the rows that never fold among them (A43)", () => {
    // Two help requests ranked last still show, and take two of the five
    // seats: three prep rows above them, four folded, not five prep plus two.
    const all = [...rows(7, "dive_prep"), ...rows(2, "help_request")];
    const { shown, more } = foldBoatRows(all);
    expect(shown).toHaveLength(BOAT_ROWS_SHOWN);
    expect(shown.map((row) => row.kind)).toEqual([
      "dive_prep",
      "dive_prep",
      "dive_prep",
      "help_request",
      "help_request",
    ]);
    expect(more).toHaveLength(4);
  });
});

describe("waiverBatchActions", () => {
  const diver = (fullName: string, code: ReadinessBlocker["code"], tripId = "t1") => ({
    bookingId: `b-${fullName}`,
    personId: `p-${fullName}`,
    fullName,
    tripId,
    tripTitle: "Reef Drift · 8:00 AM",
    startsAt: hoursFromNow(3),
    blockers: [blocker(code)],
  });

  it("keeps one tap for a boat's unsent waivers, beside the named rows", () => {
    const divers = ["Ana", "Ben", "Cara"].map((name) => diver(name, "waiver_not_sent"));
    const [batch, ...rest] = waiverBatchActions(divers, "blue-reef", NOW);
    expect(rest).toEqual([]);
    // The sentence is the detail, as on the open-orders row: an `aboutDeparture`
    // row renders its detail and never its subject (review B1).
    expect(batch?.detail).toBe("3 waivers not signed, not sent yet");
    expect(batch?.batch).toBe(true);
    expect(batch?.actionLabel).toBe("Send waivers");
    expect(batch?.waiver).toEqual({ bookingIds: ["b-Ana", "b-Ben", "b-Cara"] });
    expect(batch?.aboutDeparture).toBe(true);
    // No diver, so the per-diver fold leaves it standing beside them.
    const rows = oneRowPerDiver([
      ...(batch ? [batch] : []),
      ...blockedDiverActions(divers, "blue-reef", NOW),
    ]);
    expect(rows).toHaveLength(4);
  });

  it("offers no batch for one diver, another boat, an aboard diver, a non-waiver gap or a held seat", () => {
    const rows = waiverBatchActions(
      [
        diver("Ana", "waiver_not_sent"),
        diver("Ben", "waiver_not_sent", "t2"),
        { ...diver("Cara", "waiver_not_sent"), aboard: true },
        diver("Dev", "payment_due"),
        diver("Eli", "payment_due"),
        {
          ...diver("Fay", "waiver_not_sent"),
          blockers: [blocker("identity_unconfirmed"), blocker("waiver_not_sent")],
        },
      ],
      "blue-reef",
      NOW,
    );
    expect(rows).toEqual([]);
  });

  it("splits waivers by what the tap does: send, nudge", () => {
    const rows = waiverBatchActions(
      [
        diver("Ana", "waiver_not_sent"),
        diver("Ben", "waiver_not_sent"),
        diver("Cara", "waiver_pending"),
        diver("Dev", "waiver_pending"),
      ],
      "blue-reef",
      NOW,
    );
    expect(rows.map((row) => row.actionLabel)).toEqual(["Send waivers", "Nudge waivers"]);
  });
});

/** The two dive-domain reviews of layer 3 (desk and auditor framings). */
describe("a merged row keeps what the blocker says and does", () => {
  const reef = { tripId: "t1", label: "Reef Drift · 8:00 AM" };
  const input = (fullName: string, codes: readonly ReadinessBlocker["code"][], aboard = false) => ({
    bookingId: `b-${fullName}`,
    personId: `p-${fullName}`,
    fullName,
    tripId: "t1",
    tripTitle: reef.label,
    startsAt: hoursFromNow(3),
    blockers: codes.map(blocker),
    aboard,
  });
  const gap = (fullName: string, kind: "dive_prep" | "emergency_contact", item: string) =>
    action({
      id: `${kind}:t1:p-${fullName}`,
      kind,
      subject: fullName,
      departure: reef,
      detail: `${item} sentence`,
      diver: { personId: `p-${fullName}`, items: [item] },
      dueAt: hoursFromNow(3),
    });

  it("lets a payment blocker lead over a rental size, keeping its invoice control (desk B1)", () => {
    const [row, ...rest] = oneRowPerDiver([
      ...blockedDiverActions([input("Cara", ["payment_due"])], "blue-reef", NOW),
      gap("Cara", "dive_prep", "rental size"),
    ]);
    expect(rest).toEqual([]);
    expect(row?.kind).toBe("payment");
    expect(row?.payment).toEqual({ bookingId: "b-Cara" });
    expect(row?.href).toBe("/shop/blue-reef/trips/t1#booking-b-Cara");
    expect(row?.detail).toBe("Payment due; also rental size");
  });

  it("says a physician's no in full on an aboard row, the other gaps after it (auditor B2)", () => {
    const [row] = oneRowPerDiver([
      ...blockedDiverActions(
        [input("Ben", ["waiver_not_sent", "medical_not_cleared"], true)],
        "blue-reef",
        NOW,
      ),
      gap("Ben", "emergency_contact", "emergency contact"),
    ]);
    expect(row?.kind).toBe("blocked_aboard");
    expect(row?.detail).toBe("Not cleared to dive by a physician; also waiver, emergency contact");
  });

  it("never words a card that does not reach the site like one waiting to be verified", () => {
    const detail = (code: ReadinessBlocker["code"]) =>
      oneRowPerDiver([
        ...blockedDiverActions([input("Cara", [code])], "blue-reef", NOW),
        gap("Cara", "emergency_contact", "emergency contact"),
      ])[0]?.detail;
    expect(detail("certification_insufficient")).toBe(
      "Not certified for this trip; also emergency contact",
    );
    expect(detail("certification_pending")).not.toBe(detail("certification_insufficient"));
  });

  it("names a stop-level blocker by its state among the other items too", () => {
    const [row] = blockedDiverActions(
      [input("Eli", ["identity_unconfirmed", "certification_insufficient", "medical_not_cleared"])],
      "blue-reef",
      NOW,
    );
    // The physician's no heads the row; the identity hold and the card follow it.
    expect(row?.diver?.items).toEqual([
      "not cleared by a physician",
      "identity",
      "not certified for this trip",
    ]);
  });

  it("says it in Spanish too", () => {
    const es = staffTranslator("es-ES");
    const [row] = oneRowPerDiver(
      [
        ...blockedDiverActions(
          [input("Ben", ["waiver_not_sent", "medical_not_cleared"], true)],
          "blue-reef",
          NOW,
          es,
        ),
        gap("Ben", "emergency_contact", "contacto de emergencia"),
      ],
      es,
    );
    expect(row?.detail).toBe(
      "Un médico no lo autorizó a bucear; también exención, contacto de emergencia",
    );
  });

  // Auditor re-review N1: nitrox asked for with no verified card is a warning
  // (#2549); folded under a neutral payment lead it went grey.
  it("keeps the worst tone of the rows it folds together, and ranks and folds by it", () => {
    const nitrox = action({
      id: "nitrox_gate:t1:p-Cara",
      kind: "nitrox_gate",
      subject: "Cara",
      departure: reef,
      detail: "nitrox sentence",
      diver: { personId: "p-Cara", items: ["nitrox certification"] },
      dueAt: hoursFromNow(3),
    });
    const [row] = oneRowPerDiver([
      ...blockedDiverActions([input("Cara", ["payment_due"])], "blue-reef", NOW),
      nitrox,
    ]);
    expect(row?.kind).toBe("payment");
    expect(row?.payment).toEqual({ bookingId: "b-Cara" });
    expect(row?.detail).toBe("Payment due; also nitrox certification");
    if (!row) throw new Error("expected a row");
    expect(rowTone(row)).toBe("warning");
    // A neutral prep row ranks below it, as it ranked below the nitrox row on main.
    const prep = gap("Dev", "dive_prep", "rental size");
    expect(sortStationRows([prep, row])[0]).toBe(row);
  });

  it("never folds a readiness blocker of any tone behind and N more (auditor note 1)", () => {
    const named = (kind: TodayAction["kind"], count: number) =>
      Array.from({ length: count }, (_, index) => action({ id: `${kind}-${index}`, kind }));
    const { more } = foldBoatRows([
      ...named("certification", 5),
      ...named("waiver", 2),
      // A diver's unpaid seat, raised from their blocker as every one is; the
      // boat's own orders row is also `payment` and does fold (A43).
      action({
        id: "payment-0",
        kind: "payment",
        diver: { personId: "p", items: ["payment"], readiness: true },
      }),
      ...named("identity", 1),
      ...named("dive_prep", 3),
    ]);
    expect(more.map((row) => row.kind)).toEqual(["dive_prep", "dive_prep", "dive_prep"]);
  });
});
