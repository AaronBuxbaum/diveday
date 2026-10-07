import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  groupRoster,
  PAYMENT_STATUSES_ALL,
  PAYMENT_STATUSES_RECORDING_ONLY,
  type RosterArrival,
  rosterPaymentStatusCopy,
  waiverControls,
} from "./roster-model";
import type { ReadinessByBooking, RosterEntry, WaiverByBooking } from "./types";

const t = staffTranslator("en-US");

type ReadinessRow = ReadinessByBooking extends Map<string, infer V> ? V : never;
type WaiverRow = WaiverByBooking extends Map<string, infer V> ? V : never;

function seat(
  id: string,
  over: { status?: string; emergencyContactPhone?: string | null } = {},
): RosterEntry {
  return {
    booking: {
      id,
      status: over.status ?? "booked",
      reEntryAsk: null,
      lastDivedBand: null,
      identityUnconfirmedAt: null,
    } as unknown as RosterEntry["booking"],
    person: {
      id: `p-${id}`,
      fullName: id,
      emergencyContactName: "Ada Contact",
      emergencyContactPhone:
        over.emergencyContactPhone === undefined ? "+1 555 0100" : over.emergencyContactPhone,
    } as unknown as RosterEntry["person"],
  };
}

function readiness(status: "ready" | "blocked", depthAdvisory: unknown = null): ReadinessRow {
  return {
    readiness: {
      status,
      blockers: status === "blocked" ? [{ code: "certification_missing", params: undefined }] : [],
    },
    paymentStatus: "paid",
    paymentProvider: null,
    depthAdvisory,
  } as unknown as ReadinessRow;
}

const signed = {
  waiver: {
    id: "w",
    status: "completed",
    completedAt: new Date("2026-08-20T15:00:00Z"),
    signatureMethod: "digital",
    expiresAt: new Date("2027-08-20T15:00:00Z"),
    medicalAnswers: null,
  },
} as unknown as WaiverRow;

const deep = {
  status: "exceeds",
  limitDepth: 18,
  siteDepth: 30,
  unit: "meters",
  basis: "certification",
  level: "open_water",
};

function rowsFor(roster: RosterEntry[], readinessById: Record<string, ReadinessRow>) {
  return {
    roster,
    readinessByBooking: new Map(Object.entries(readinessById)) as ReadinessByBooking,
    waiverByBooking: new Map(roster.map(({ booking }) => [booking.id, signed])) as WaiverByBooking,
  };
}

const ids = (entries: RosterEntry[]) => entries.map(({ booking }) => booking.id);

describe("groupRoster", () => {
  it("files a blocked seat under Still to clear and a cleared one under Ready", () => {
    const rows = rowsFor([seat("a"), seat("b")], {
      a: readiness("blocked"),
      b: readiness("ready"),
    });
    const groups = groupRoster({
      t,
      rows,
      requiresPayment: false,
      arrival: undefined,
      controls: waiverControls(t),
    });
    expect(ids(groups.stillToClear)).toEqual(["a"]);
    expect(ids(groups.ready)).toEqual(["b"]);
    expect(groups.here).toEqual([]);
    expect(groups.notHere).toEqual([]);
    expect(groups.blockedCount).toBe(1);
    expect(groups.deskWorkOpen).toBe(false);
  });

  it("keeps a seat with no emergency number in Still to clear, though it is cleared to dive", () => {
    const rows = rowsFor([seat("a", { emergencyContactPhone: null })], { a: readiness("ready") });
    const groups = groupRoster({
      t,
      rows,
      requiresPayment: false,
      arrival: undefined,
      controls: waiverControls(t),
    });
    expect(ids(groups.stillToClear)).toEqual(["a"]);
    // Desk work, not dive clearance: the all-clear count does not wait on it.
    expect(groups.blockedCount).toBe(0);
  });

  it("with the desk open, sinks a cleared arrival into Checked in and a released seat into Not here", () => {
    const rows = rowsFor(
      [
        seat("here", { status: "checked_in" }),
        seat("owes", { status: "checked_in", emergencyContactPhone: null }),
        seat("gone", { status: "no_show" }),
      ],
      { here: readiness("ready"), owes: readiness("ready"), gone: readiness("ready") },
    );
    const arrival: RosterArrival = {
      controls: new Map(),
      below: new Map(),
      boarded: new Set(["here"]),
    };
    const groups = groupRoster({
      t,
      rows,
      requiresPayment: false,
      arrival,
      controls: waiverControls(t),
    });
    expect(ids(groups.here)).toEqual(["here"]);
    expect(ids(groups.stillToClear)).toEqual(["owes"]);
    expect(ids(groups.notHere)).toEqual(["gone"]);
    expect(groups.ready).toEqual([]);
    // An arrival still owing the desk keeps the desk open.
    expect(groups.deskWorkOpen).toBe(true);
    expect(groups.hereMeta).toBe(t("checkIn.settledAllBoarded"));
  });

  it("files a released seat as an ordinary seat when the desk is not open", () => {
    const rows = rowsFor([seat("gone", { status: "no_show" })], { gone: readiness("ready") });
    const groups = groupRoster({
      t,
      rows,
      requiresPayment: false,
      arrival: undefined,
      controls: waiverControls(t),
    });
    expect(groups.notHere).toEqual([]);
    expect(ids(groups.ready)).toEqual(["gone"]);
  });

  it("says a depth sentence much of the boat shares once, and counts it", () => {
    const roster = [seat("a"), seat("b"), seat("c")];
    const rows = rowsFor(roster, {
      a: readiness("ready", deep),
      b: readiness("ready", deep),
      c: readiness("ready", deep),
    });
    const groups = groupRoster({
      t,
      rows,
      requiresPayment: false,
      arrival: undefined,
      controls: waiverControls(t),
    });
    expect(groups.sharedFacts).toHaveLength(1);
    expect(groups.sharedFacts[0]?.count).toBe(3);
    expect(groups.sharedAdvisoryTexts.has(groups.sharedFacts[0]?.sentence ?? "")).toBe(true);
    // A shared advisory no longer holds each row open.
    expect(ids(groups.ready)).toEqual(["a", "b", "c"]);
  });

  it("holds an unpaid seat open only when the departure takes payment", () => {
    const unpaid = { ...readiness("ready"), paymentStatus: "unpaid" } as ReadinessRow;
    const rows = rowsFor([seat("a")], { a: unpaid });
    const free = groupRoster({
      t,
      rows,
      requiresPayment: false,
      arrival: undefined,
      controls: waiverControls(t),
    });
    const paid = groupRoster({
      t,
      rows,
      requiresPayment: true,
      arrival: undefined,
      controls: waiverControls(t),
    });
    expect(ids(free.ready)).toEqual(["a"]);
    expect(ids(paid.stillToClear)).toEqual(["a"]);
  });
});

describe("the roster's worded controls", () => {
  it("words every waiver state, and offers no tap on a settled one", () => {
    const controls = waiverControls(t);
    expect(controls.not_sent.action).toBe("send");
    expect(controls.complete.action).toBeNull();
    expect(controls.medical_not_cleared.action).toBeNull();
    for (const control of Object.values(controls)) expect(control.label).not.toBe("");
  });

  it("keeps the payment select's order and withholds the write-offs from recording", () => {
    expect(Object.keys(rosterPaymentStatusCopy(t).statuses)).toEqual([
      "unpaid",
      "deposit_paid",
      "paid",
      "waived",
      "partly_refunded",
      "refunded",
    ]);
    expect(PAYMENT_STATUSES_RECORDING_ONLY).not.toContain("waived");
    expect(PAYMENT_STATUSES_RECORDING_ONLY).not.toContain("refunded");
    expect(PAYMENT_STATUSES_ALL).not.toContain("partly_refunded");
  });
});
