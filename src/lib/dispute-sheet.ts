import { type RollCallCheckpoint, rollCallCheckpoints } from "./roll-call";

/**
 * **The per-seat dispute sheet** (issue #2390, opportunities B6): what a shop
 * shows a card network when a diver disputes a charge and says they never
 * came. One booking, one page — the order and its lines, the release the diver
 * signed, when they were checked in, and what the crew recorded at every roll
 * call.
 *
 * ## This file is the only place that decides what may appear
 *
 * The sheet leaves the shop, so the rule is a closed list, not a filter:
 *
 * - **Input is narrow.** The types below name the fields the sheet may know
 *   about. A waiver record has no `medicalAnswers`, no questionnaire, no
 *   physician, no clearance or referral state in {@link DisputeWaiverInput};
 *   the loader (`src/db/dispute-sheet.ts`) selects exactly those columns, so
 *   the answers never reach this function either.
 * - **Output is built field by field.** Nothing is spread, so an input object
 *   that carries extra properties (a whole waiver row passed by mistake) cannot
 *   smuggle one through; `dispute-sheet.test.ts` passes exactly that and reads
 *   the serialised sheet back.
 * - **Activity lines are an allowlist of codes** ({@link DISPUTE_ACTIVITY_CODES}),
 *   not a deny-list: a code added tomorrow stays off the sheet until someone
 *   decides it belongs. A line carries the names its sentence needs (`actor`,
 *   `diver`) and nothing else from its params.
 * - **A seat whose identity is held for review** (`identity_unconfirmed`)
 *   gets no waiver: the record on file would be the matched person's, which is
 *   the case the incident export withholds for too (issue #2128).
 *
 * Pure and dependency-free, like the rest of `src/lib`: no clock (the caller
 * hands over `generatedAt`), no database, no copy. Codes in, codes out; the
 * page turns them into words.
 */

/** How a release came to be on file, as the page words it. */
export type DisputeSignatureMethod = "online" | "counter" | "imported";

/** One roll-call checkpoint's standing result on this seat. */
export type DisputeRollCallResult = "boarded" | "not_boarded" | "not_recorded";

/**
 * The activity codes that may appear on the sheet: a seat's lifecycle (added,
 * moved, removed, checked in, written off) and its money. Deliberately absent:
 * notes (staff-only), identity decisions, anything that opened or exported a
 * diver's record, medical or certification overrides, and the demo's scripted
 * lines.
 */
export const DISPUTE_ACTIVITY_CODES = [
  "counter_check_in",
  "counter_check_in_undone",
  "booking_removed",
  "booking_restored",
  "booking_no_show",
  "booking_no_show_undone",
  "booking_no_show_boarded",
  "booking_no_show_missing_after_dive",
  "seat_added",
  "seat_added_walk_in",
  "seat_added_from_trip_link",
  "rider_added_at_dock",
  "seat_moved_away",
  "seat_moved_here",
  "seat_claimed",
  "seat_self_cancelled",
  "seat_self_refunded",
  "party_seat_self_cancelled",
  "party_seat_self_refunded",
  "seat_refunded",
  "payment_waived",
  "payment_marked_refunded",
  "payment_balance_written_off",
  "party_marked_paid",
] as const;

export type DisputeActivityCode = (typeof DISPUTE_ACTIVITY_CODES)[number];

export function isDisputeActivityCode(value: string): value is DisputeActivityCode {
  return (DISPUTE_ACTIVITY_CODES as readonly string[]).includes(value);
}

export type DisputeOrderInput = {
  description: string;
  status: string;
  currency: string;
  totalCents: number;
  taxCents: number;
  amountPaidCents: number;
  refundedCents: number;
  createdAt: Date;
  paidAt: Date | null;
  lines: readonly {
    description: string;
    kind: string;
    quantity: number;
    unitAmountCents: number;
  }[];
};

/** The signed release, by the fields the sheet may know about and no others. */
export type DisputeWaiverInput = {
  signedAt: Date | null;
  signedName: string | null;
  signatureMethod: string | null;
  templateTitle: string;
  templateVersion: number;
};

export type DisputeRollCallEventInput = {
  checkpoint: string;
  status: "boarded" | "not_boarded" | "cleared";
  occurredAt: Date;
  createdAt: Date;
  seq: number;
  recordedByName: string;
};

export type DisputeArrivalEventInput = {
  status: "arrived" | "cleared";
  occurredAt: Date;
  createdAt: Date;
  seq: number;
  recordedByName: string;
};

export type DisputeActivityInput = {
  code: string;
  params: unknown;
  occurredAt: Date;
  seq: number;
};

export type DisputeSheetInput = {
  shopName: string;
  timezone: string;
  generatedAt: Date;
  diverName: string;
  /** A held seat's waiver is not this diver's evidence (issue #2128). */
  identityHeld: boolean;
  trip: { title: string; startsAt: Date; plannedDives: number };
  order: DisputeOrderInput;
  /** The newest signed release at or before the departure, or none. */
  waiver: DisputeWaiverInput | null;
  arrivalEvents: readonly DisputeArrivalEventInput[];
  rollCallEvents: readonly DisputeRollCallEventInput[];
  activity: readonly DisputeActivityInput[];
};

export type DisputeSheet = {
  shopName: string;
  timezone: string;
  generatedAt: Date;
  diverName: string;
  trip: { title: string; startsAt: Date };
  order: {
    description: string;
    status: string;
    currency: string;
    totalCents: number;
    taxCents: number;
    amountPaidCents: number;
    refundedCents: number;
    createdAt: Date;
    paidAt: Date | null;
    lines: { description: string; kind: string; quantity: number; unitAmountCents: number }[];
  };
  /** Null is a stated absence: nothing signed before departure, or a held seat. */
  waiver: {
    signedAt: Date;
    signedName: string | null;
    method: DisputeSignatureMethod;
    templateTitle: string;
    templateVersion: number;
  } | null;
  /** Null when no arrival stands: never tapped in, or the tap was taken back. */
  checkIn: { at: Date; recordedByName: string } | null;
  /** One row per checkpoint of the departure, in sailing order, recorded or not. */
  rollCall: {
    checkpoint: RollCallCheckpoint;
    result: DisputeRollCallResult;
    at: Date | null;
    recordedByName: string | null;
  }[];
  activity: {
    code: DisputeActivityCode;
    params: { actor?: string; diver?: string };
    at: Date;
  }[];
};

/**
 * Newest first by the three columns every append-only roll-call read orders
 * on: when it happened, when it was written, and the sequence that settles
 * ties (ADR 20260815-roll-call-order-is-a-property-of-the-data).
 */
function newestFirst<T extends { occurredAt: Date; createdAt: Date; seq: number }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      b.occurredAt.getTime() - a.occurredAt.getTime() ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      b.seq - a.seq,
  );
}

function signatureMethodOf(method: string | null): DisputeSignatureMethod {
  if (method === "imported") return "imported";
  if (method?.startsWith("in_person")) return "counter";
  return "online";
}

/** The two names a trail sentence needs; any other param is dropped. */
function sentenceNames(raw: unknown): { actor?: string; diver?: string } {
  const names: { actor?: string; diver?: string } = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return names;
  const record = raw as Record<string, unknown>;
  if (typeof record.actor === "string") names.actor = record.actor;
  if (typeof record.diver === "string") names.diver = record.diver;
  return names;
}

export function assembleDisputeSheet(input: DisputeSheetInput): DisputeSheet {
  const { order, trip } = input;

  // The release counts only if it names a signing instant. A pending link has
  // none and is not evidence of anything.
  const waiver =
    !input.identityHeld && input.waiver?.signedAt
      ? {
          signedAt: input.waiver.signedAt,
          signedName: input.waiver.signedName,
          method: signatureMethodOf(input.waiver.signatureMethod),
          templateTitle: input.waiver.templateTitle,
          templateVersion: input.waiver.templateVersion,
        }
      : null;

  // The newest arrival event stands; a newest `cleared` is the desk taking the
  // tap back, which leaves no check-in to show.
  const [standingArrival] = newestFirst(input.arrivalEvents);
  const checkIn =
    standingArrival?.status === "arrived"
      ? { at: standingArrival.occurredAt, recordedByName: standingArrival.recordedByName }
      : null;

  // One row per checkpoint the departure plans. The newest event at each wins;
  // a newest `cleared` drops it back to not recorded. Nothing is carried
  // forward from an earlier checkpoint: this sheet states what a person wrote.
  const rollCall = rollCallCheckpoints(trip.plannedDives).map((checkpoint) => {
    const [standing] = newestFirst(
      input.rollCallEvents.filter((event) => event.checkpoint === checkpoint),
    );
    if (!standing || standing.status === "cleared") {
      return {
        checkpoint,
        result: "not_recorded" as const,
        at: null,
        recordedByName: null,
      };
    }
    return {
      checkpoint,
      result: standing.status,
      at: standing.occurredAt,
      recordedByName: standing.recordedByName,
    };
  });

  const activity = newestFirst(
    input.activity.map((line) => ({ ...line, createdAt: line.occurredAt })),
  ).flatMap((line) =>
    isDisputeActivityCode(line.code)
      ? [{ code: line.code, params: sentenceNames(line.params), at: line.occurredAt }]
      : [],
  );

  return {
    shopName: input.shopName,
    timezone: input.timezone,
    generatedAt: input.generatedAt,
    diverName: input.diverName,
    trip: { title: trip.title, startsAt: trip.startsAt },
    order: {
      description: order.description,
      status: order.status,
      currency: order.currency,
      totalCents: order.totalCents,
      taxCents: order.taxCents,
      amountPaidCents: order.amountPaidCents,
      refundedCents: order.refundedCents,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      lines: order.lines.map((line) => ({
        description: line.description,
        kind: line.kind,
        quantity: line.quantity,
        unitAmountCents: line.unitAmountCents,
      })),
    },
    waiver,
    checkIn,
    rollCall,
    // Oldest first on paper: a dispute reads as a story, not a feed.
    activity: activity.reverse(),
  };
}
