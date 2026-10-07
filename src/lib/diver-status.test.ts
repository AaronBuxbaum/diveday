import { describe, expect, it } from "vitest";
import type { DiverProfile } from "@/lib/diver-profile";
import type { ReadinessResult } from "@/lib/readiness";
import {
  bookingIsAhead,
  buildDiverStatus,
  nextBookingAhead,
  splitDiverStatus,
} from "./diver-status";

const NOW = new Date("2026-08-26T18:00:00.000Z");
const TOMORROW = new Date("2026-08-27T11:00:00.000Z");
const LAST_MONTH = new Date("2026-07-12T11:00:00.000Z");

type Overrides = {
  person?: Partial<DiverProfile["person"]>;
  waiver?: DiverProfile["waiver"];
  bookings?: unknown[];
  certifications?: unknown[];
  specialtyCertifications?: unknown[];
  nitroxCertifications?: unknown[];
  orders?: unknown[];
  bookingPayments?: unknown[];
};

/** A record with nothing outstanding — every row below is one thing added to this. */
function diver(overrides: Overrides = {}): DiverProfile {
  return {
    person: {
      id: "person-1",
      fullName: "Grace Mensah",
      emergencyContactName: "Kojo Mensah",
      emergencyContactPhone: "+13055550177",
      ...overrides.person,
    },
    waiver: overrides.waiver ?? { state: "current" },
    waiverRequest: "not_sent",
    bookings: overrides.bookings ?? [],
    certifications: overrides.certifications ?? [],
    specialtyCertifications: overrides.specialtyCertifications ?? [],
    nitroxCertifications: overrides.nitroxCertifications ?? [],
    orders: overrides.orders ?? [],
    bookingPayments: overrides.bookingPayments ?? [],
    priorVisits: [],
  } as unknown as DiverProfile;
}

type BookingEntry = DiverProfile["bookings"][number];

function booking(
  id: string,
  startsAt: Date,
  overrides: Record<string, unknown> = {},
): BookingEntry {
  return {
    booking: {
      id,
      status: "confirmed",
      tripId: `trip-${id}`,
      identityUnconfirmedAt: null,
      identityBookedAs: null,
      identityMatchedBy: null,
      ...overrides,
    },
    trip: {
      id: `trip-${id}`,
      title: "Two-Tank Reef",
      startsAt,
      endsAt: startsAt,
      status: "scheduled",
    },
    course: null,
  } as unknown as BookingEntry;
}

const blocked = (code: string): ReadinessResult =>
  ({ status: "blocked", blockers: [{ code }] }) as ReadinessResult;

describe("the status ledger's silence", () => {
  /**
   * **The pinned rule** (ADR 20260827-people-not-lists): a clear diver's
   * record shows no status section at all — not a heading, not an "all clear"
   * line. The empty array is what the surface renders nothing from, so it is
   * asserted here as hard as any row is.
   */
  it("returns nothing at all for a diver with nothing outstanding", () => {
    expect(buildDiverStatus(diver(), null, { now: NOW })).toEqual([]);
  });

  it("stays empty when the diver's next departure clears them", () => {
    const ahead = diver({ bookings: [booking("b1", TOMORROW)] });
    const ready: ReadinessResult = { status: "ready", blockers: [] };
    expect(buildDiverStatus(ahead, ready, { now: NOW })).toEqual([]);
  });
});

describe("what earns a row", () => {
  it("names a card nobody has looked at, as work rather than a blocker", () => {
    const rows = buildDiverStatus(
      diver({ certifications: [{ id: "c1", status: "pending" }] }),
      null,
      { now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "certification",
      tone: "warning",
      action: { target: "verify" },
    });
  });

  it("says an unsigned release is outstanding, and offers to send it", () => {
    const rows = buildDiverStatus(diver({ waiver: { state: "none" } as never }), null, {
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "waiver",
      tone: "warning",
      sentence: { key: "divers.status.waiverMissing" },
      action: { target: "send_waiver" },
    });
  });

  it("tells a lapsed signature from one that was never given", () => {
    const rows = buildDiverStatus(diver({ waiver: { state: "expired" } as never }), null, {
      now: NOW,
    });
    expect(rows[0]?.sentence).toEqual({ key: "divers.status.waiverExpired" });
  });

  /**
   * A medical hold has no act the shop can take from this page — the release
   * waits on a doctor. Offering "Send the waiver" beside it would point a
   * staffer at a send `issueWaiverRequest` refuses.
   */
  it("offers no fix for a medical hold, because the shop has none to offer", () => {
    const rows = buildDiverStatus(diver({ waiver: { state: "medical_review" } as never }), null, {
      now: NOW,
    });
    expect(rows[0]).toMatchObject({ kind: "waiver", tone: "danger" });
    expect(rows[0]?.action).toBeUndefined();
  });

  /**
   * A current release that *ended* a physician referral rather than answering
   * it (issue #1282). Nothing is blocked — the signature is real and today's —
   * so this is a warning, and there is no act because the fix is a
   * conversation and then a recorded clearance, not another link.
   */
  it("raises a referral a clean re-signature ended without answering", () => {
    const rows = buildDiverStatus(
      diver({
        waiver: {
          state: "current",
          medical: { overriddenReferralAt: new Date("2026-06-02T15:00:00.000Z") },
        } as never,
      }),
      null,
      { now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "waiver",
      tone: "warning",
      sentence: { key: "divers.status.waiverReferralOpen" },
    });
    expect(rows[0]?.action).toBeUndefined();
  });

  it("raises an earlier physician refusal a clean new release cleared past", () => {
    const rows = buildDiverStatus(
      diver({
        waiver: {
          state: "current",
          medical: {
            overriddenReferralAt: null,
            overriddenRefusal: { recordId: "w-refused", at: new Date("2026-06-02T15:00:00.000Z") },
          },
        } as never,
      }),
      null,
      { now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "waiver",
      tone: "warning",
      sentence: { key: "divers.status.waiverEarlierRefusal" },
    });
  });

  it("says nothing about a current release with no referral behind it", () => {
    const rows = buildDiverStatus(
      diver({ waiver: { state: "current", medical: { overriddenReferralAt: null } } as never }),
      null,
      { now: NOW },
    );
    expect(rows.filter((row) => row.kind === "waiver")).toHaveLength(0);
  });

  it("counts money owed and points at the invoice that owes it", () => {
    const rows = buildDiverStatus(
      diver({
        bookings: [booking("b1", LAST_MONTH)],
        orders: [{ order: { id: "order-9", bookingId: "b1", status: "open" } }],
      }),
      null,
      { now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "payment",
      tone: "warning",
      action: { target: "collect" },
      orderId: "order-9",
    });
  });

  it("asks for an emergency contact when either half of it is missing", () => {
    const rows = buildDiverStatus(diver({ person: { emergencyContactPhone: "" } }), null, {
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "contact", tone: "warning" });
  });
});

describe("a departure the diver is actually on", () => {
  /**
   * Trip-bound blockers come from the readiness engine and carry the blocker
   * itself, so the record can never word a gate differently from the boat.
   */
  it("escalates to danger and carries the blocker, not a sentence of its own", () => {
    const rows = buildDiverStatus(
      diver({
        bookings: [booking("b1", TOMORROW)],
        certifications: [{ id: "c1", status: "pending" }],
      }),
      blocked("certification_pending"),
      { now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "certification",
      tone: "danger",
      sentence: { blocker: { code: "certification_pending" } },
      tripContext: { tripId: "trip-b1" },
    });
  });

  it("puts the boat's blocker above the record's own housekeeping", () => {
    const rows = buildDiverStatus(
      diver({
        person: { emergencyContactName: "" },
        bookings: [booking("b1", TOMORROW)],
        waiver: { state: "none" } as never,
      }),
      blocked("waiver_not_sent"),
      { now: NOW },
    );
    expect(rows.map((row) => row.tone)).toEqual(["danger", "warning"]);
    expect(rows.map((row) => row.kind)).toEqual(["waiver", "contact"]);
  });

  it("keeps one row per kind — three pending cards are one job", () => {
    const rows = buildDiverStatus(
      diver({
        certifications: [
          { id: "c1", status: "pending" },
          { id: "c2", status: "pending" },
        ],
        specialtyCertifications: [{ id: "s1", status: "pending" }],
      }),
      null,
      { now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sentence).toEqual({
      key: "divers.status.cardsWaiting",
      values: { count: 3 },
    });
  });
});

describe("the late-arrival buffer", () => {
  /**
   * AGENTS.md's standing rule: a boat that left at 7:00 is not "in the past"
   * at 7:05. The record's old Upcoming/History split ignored it, which filed a
   * diver's own boat as history while they were still on the dock.
   */
  it("keeps a departure ahead of the diver for an hour past its start", () => {
    const entry = booking("b1", new Date("2026-08-26T17:30:00.000Z"));
    expect(bookingIsAhead(entry, NOW)).toBe(true);
    expect(bookingIsAhead(entry, new Date("2026-08-26T18:31:00.000Z"))).toBe(false);
  });

  it("measures status against the soonest departure still ahead", () => {
    const record = diver({
      bookings: [booking("later", new Date("2026-09-04T11:00:00.000Z")), booking("b1", TOMORROW)],
    });
    expect(nextBookingAhead(record, NOW)?.booking.id).toBe("b1");
  });

  it("ignores a canceled seat and a canceled departure", () => {
    const record = diver({
      bookings: [
        booking("cancelled-seat", TOMORROW, { status: "cancelled" }),
        {
          ...booking("blown-out", TOMORROW),
          trip: { ...booking("x", TOMORROW).trip, status: "cancelled" },
        } as BookingEntry,
      ],
    });
    expect(nextBookingAhead(record, NOW)).toBeNull();
  });
});

/**
 * **"Collect" is the one fix that can have nowhere to go** (issue #1926).
 *
 * With an order raised the act opens that order, and `orders/[id]` gates on
 * nothing beyond being staff. With none, the act is `#the-story`, whose only
 * act is the "New invoice" link — which `canRaiseInvoiceFor` removes for a
 * reader without `canPersonManageOrders` (#1920) or at a shop whose payments
 * are not connected. So on the record the act could scroll a staffer to a
 * section offering them nothing, and call that a fix.
 *
 * The row stays either way: that money is owed is crew-relevant, and this
 * ledger reads the diver's standing rather than the viewer's permissions.
 */
describe("the Collect act, and whether it has anywhere to go", () => {
  /** Money owed with nothing invoiced — the only shape where the act is a fragment. */
  function owesUninvoiced() {
    return diver({
      bookings: [booking("b1", LAST_MONTH)],
      bookingPayments: [{ booking: { id: "b1" }, payment: { status: "unpaid" } }],
    });
  }

  it("keeps the sentence and drops the fix when there is nowhere to go", () => {
    const rows = buildDiverStatus(owesUninvoiced(), null, {
      now: NOW,
      collectHasSomewhereToGo: false,
    });

    const money = rows.filter((row) => row.kind === "payment");
    expect(money, "the row itself is not the reader's to lose").toHaveLength(1);
    expect(money[0]?.sentence).toEqual({ key: "divers.status.openBalance", values: { count: 1 } });
    expect(money[0]?.action).toBeUndefined();
    expect(money[0]?.orderId).toBeUndefined();
  });

  it("keeps the fix for a reader who can raise the invoice it points at", () => {
    const rows = buildDiverStatus(owesUninvoiced(), null, {
      now: NOW,
      collectHasSomewhereToGo: true,
    });

    expect(rows.filter((row) => row.kind === "payment")[0]?.action).toMatchObject({
      target: "collect",
    });
  });

  /**
   * The distinction the gate turns on. An order is a page of its own, open to
   * any staffer, so the act is real even for a reader who could not have
   * raised it — and dropping it there would hide the invoice from the person
   * looking straight at the balance.
   */
  it("keeps the fix when an order exists, whatever the reader may raise", () => {
    const rows = buildDiverStatus(
      diver({
        bookings: [booking("b1", LAST_MONTH)],
        orders: [{ order: { id: "order-9", bookingId: "b1", status: "open" } }],
      }),
      null,
      { now: NOW, collectHasSomewhereToGo: false },
    );

    expect(rows[0]).toMatchObject({ action: { target: "collect" }, orderId: "order-9" });
  });

  /**
   * The default, and it is not laziness. Every surface but the record reaches
   * `#the-story` by *navigating* to the record — `fixHref` resolves the
   * fragment against `recordPath` — and arriving at the record is somewhere to
   * go whatever the reader may do once there. The diver sheet over the day is
   * the live case, and it deliberately never looks the reader up (#1920).
   */
  it("assumes somewhere to go when nobody says otherwise", () => {
    const rows = buildDiverStatus(owesUninvoiced(), null, { now: NOW });

    expect(rows.filter((row) => row.kind === "payment")[0]?.action).toMatchObject({
      target: "collect",
    });
  });
});

describe("the fix beside a card the boat will not take", () => {
  const NEXT_WEEK = new Date("2026-09-02T11:00:00.000Z");

  /**
   * The bug this pins: an Open Water diver on an Advanced trip was offered
   * "Verify it", which landed on their unrelated Deep card. No card on the
   * record fixes a level they do not hold; the booking is where it gets fixed.
   */
  it("sends a level the diver does not reach to the booking, as danger", () => {
    const rows = buildDiverStatus(
      diver({
        bookings: [booking("b1", TOMORROW)],
        specialtyCertifications: [{ id: "s1", status: "pending" }],
      }),
      {
        status: "blocked",
        blockers: [
          {
            code: "certification_insufficient",
            params: { requiredLevel: "advanced_open_water", heldLevel: "open_water" },
          },
        ],
      },
      { now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "certification",
      tone: "danger",
      action: { labelKey: "divers.status.acts.openBooking", target: "open_booking" },
      tripContext: { tripId: "trip-b1", bookingId: "b1" },
    });
  });

  it("offers the capture form when nothing is on file", () => {
    const rows = buildDiverStatus(
      diver({ bookings: [booking("b1", TOMORROW)] }),
      blocked("certification_missing"),
      { now: NOW },
    );
    expect(rows[0]).toMatchObject({ tone: "danger", action: { target: "add_card" } });
  });

  it("reads a diver booked on the course that gets them there as a plan, with no fix", () => {
    const rows = buildDiverStatus(
      diver({ bookings: [booking("b1", TOMORROW)] }),
      {
        status: "blocked",
        blockers: [{ code: "certification_in_training", params: { requiredLevel: "open_water" } }],
      },
      { now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "certification", tone: "warning" });
    expect(rows[0]?.action).toBeUndefined();
  });

  it("measures the card row against the departure the loader picked, not only the next one", () => {
    const later = booking("b2", NEXT_WEEK);
    const rows = buildDiverStatus(
      diver({ bookings: [booking("b1", TOMORROW), later] }),
      { status: "ready", blockers: [] },
      {
        now: NOW,
        certification: {
          entry: later,
          readiness: {
            status: "blocked",
            blockers: [
              {
                code: "certification_insufficient",
                params: { requiredLevel: "advanced_open_water", heldLevel: "open_water" },
              },
            ],
          },
        },
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tone: "danger",
      tripContext: { tripId: "trip-b2", bookingId: "b2", startsAt: NEXT_WEEK },
    });
  });
});

describe('which card "Verify it" is about', () => {
  it("sends a level blocker to the level card, a specialty blocker to that specialty", () => {
    const level = buildDiverStatus(
      diver({ bookings: [booking("b1", TOMORROW)] }),
      blocked("certification_pending"),
      { now: NOW },
    );
    expect(level[0]).toMatchObject({ action: { target: "verify" }, verifies: "level" });

    const deep = buildDiverStatus(
      diver({ bookings: [booking("b1", TOMORROW)] }),
      {
        status: "blocked",
        blockers: [{ code: "specialty_pending", params: { specialty: "deep" } }],
      },
      { now: NOW },
    );
    expect(deep[0]).toMatchObject({ action: { target: "verify" }, verifies: "deep" });
  });
});

/**
 * **One gap, said once** (Aaron, 2026-10-05: "No emergency contact on file"
 * sat above a Contact details row reading "No emergency contact"). A row
 * whose fix is in a file row's door belongs to that row; the ledger keeps
 * money and a fix that leaves the page.
 */
describe("splitting the status between the ledger and the file", () => {
  it("hands contact, waiver and a card to add to their file rows", () => {
    const rows = buildDiverStatus(
      diver({
        person: { emergencyContactName: null },
        waiver: { state: "none" } as DiverProfile["waiver"],
        bookings: [booking("b1", TOMORROW)],
      }),
      {
        status: "blocked",
        blockers: [{ code: "waiver_not_sent" }, { code: "certification_missing" }],
      } as ReadinessResult,
      { now: NOW },
    );
    const { ledger, file } = splitDiverStatus(rows);
    expect(ledger).toEqual([]);
    expect(file.contact).toMatchObject({ kind: "contact", tone: "warning" });
    expect(file.waiver).toMatchObject({ kind: "waiver", tone: "danger" });
    expect(file.certification).toMatchObject({
      kind: "certification",
      action: { target: "add_card" },
    });
  });

  it("keeps a seat to change on its departure in the ledger", () => {
    const rows = buildDiverStatus(
      diver({ bookings: [booking("b1", TOMORROW)] }),
      blocked("certification_insufficient"),
      { now: NOW },
    );
    const { ledger, file } = splitDiverStatus(rows);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ action: { target: "open_booking" } });
    expect(file.certification).toBeUndefined();
  });
});

/**
 * Issue #2073: the record showed a diver as clear while a departure would not
 * take them, for three blockers it never looked at.
 */
describe("the blockers the record used to miss", () => {
  const NEXT_WEEK = new Date("2026-09-02T11:00:00.000Z");

  it("names an age under the departure's minimum and sends the fix to the date of birth", () => {
    const rows = buildDiverStatus(
      diver({ bookings: [booking("b1", TOMORROW)] }),
      {
        status: "blocked",
        blockers: [{ code: "under_minimum_age", params: { age: 13, minimumAge: 15 } }],
      },
      { now: NOW },
    );
    expect(rows).toEqual([
      expect.objectContaining({
        kind: "contact",
        tone: "danger",
        sentence: { blocker: { code: "under_minimum_age", params: { age: 13, minimumAge: 15 } } },
        action: { labelKey: "divers.status.acts.editContact", target: "edit_contact" },
        tripContext: expect.objectContaining({ bookingId: "b1" }),
      }),
    ]);
  });

  it("lets the age, not a missing emergency contact, speak for the contact row", () => {
    const rows = buildDiverStatus(
      diver({
        person: { emergencyContactName: null },
        bookings: [booking("b1", TOMORROW)],
      }),
      {
        status: "blocked",
        blockers: [{ code: "under_minimum_age", params: { age: 13, minimumAge: 15 } }],
      },
      { now: NOW },
    );
    const { ledger, file } = splitDiverStatus(rows);
    expect(ledger).toEqual([]);
    expect(file.contact).toMatchObject({
      tone: "danger",
      sentence: { blocker: { code: "under_minimum_age" } },
    });
  });

  it("names a seat held over who the diver is, with both names, on the boat it is on", () => {
    const rows = buildDiverStatus(
      diver({
        bookings: [
          booking("b1", TOMORROW),
          booking("b2", NEXT_WEEK, {
            identityUnconfirmedAt: LAST_MONTH,
            identityBookedAs: "Ama Mensah",
            identityMatchedBy: "shared_email",
          }),
        ],
      }),
      { status: "ready", blockers: [] },
      { now: NOW },
    );
    expect(rows).toEqual([
      expect.objectContaining({
        kind: "identity",
        tone: "danger",
        sentence: {
          key: "shared.identityCheck.reasonSharedEmail",
          values: { bookedAs: "Ama Mensah", name: "Grace Mensah" },
        },
        action: { labelKey: "divers.status.acts.openBooking", target: "open_booking" },
        tripContext: expect.objectContaining({ bookingId: "b2", startsAt: NEXT_WEEK }),
      }),
    ]);
    // A question about one seat: it stays in the ledger, never a file row.
    expect(splitDiverStatus(rows).ledger).toHaveLength(1);
  });

  it("falls back to the shared blocker sentence when the booked-as name was never kept", () => {
    const rows = buildDiverStatus(
      diver({ bookings: [booking("b1", TOMORROW, { identityUnconfirmedAt: LAST_MONTH })] }),
      { status: "ready", blockers: [] },
      { now: NOW },
    );
    expect(rows[0]).toMatchObject({
      kind: "identity",
      sentence: { blocker: { code: "identity_unconfirmed" } },
    });
  });

  it("ignores a held seat on a departure that has already gone", () => {
    const rows = buildDiverStatus(
      diver({ bookings: [booking("b1", LAST_MONTH, { identityUnconfirmedAt: LAST_MONTH })] }),
      null,
      { now: NOW },
    );
    expect(rows).toEqual([]);
  });

  it("says a missing specialty alongside the level the departure needs", () => {
    const rows = buildDiverStatus(
      diver({ bookings: [booking("b1", TOMORROW)] }),
      {
        status: "blocked",
        blockers: [
          {
            code: "certification_insufficient",
            params: { requiredLevel: "advanced_open_water", heldLevel: "open_water" },
          },
          { code: "specialty_missing", params: { specialty: "deep" } },
        ],
      } as ReadinessResult,
      { now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sentence: { blocker: { code: "certification_insufficient" } },
      alsoBlockers: [{ code: "specialty_missing" }],
    });
  });
});
