import type { ReactNode } from "react";
import type { SameNameHeldSeat } from "@/db/bookings";
import type { CourseMaterialsDone } from "@/db/course-materials";
import type { listBookingNotes } from "@/db/operations";
import { depthWarningText } from "@/i18n/depth-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import type { CalendarDate } from "@/lib/calendar-date";
import type { CertificationLevel } from "@/lib/certification-levels";
import { diveRecencyIsNotable } from "@/lib/dive-recency";
import type { ElearningQuery } from "@/lib/elearning-check";
import type { PaperWaiverAction } from "@/lib/paper-waiver-form";
import { isDiver } from "@/lib/participant-types";
import { rosterRowIsBlocked } from "@/lib/roster-filters";
import { waiverState } from "@/lib/waivers";
import type { ElearningCheckResult } from "../elearning-actions";
import type { PaymentStatus, PaymentStatusControlCopy } from "./PaymentStatusControl";
import { SHARED_FACT_MIN } from "./shared-facts";
import type {
  NitroxByBooking,
  ReadinessByBooking,
  RentalFitByBooking,
  RosterEntry,
  WaiverByBooking,
} from "./types";

/**
 * **The guests ledger's four inputs** (`RosterSection`), named for what they
 * are rather than passed as forty-odd loose props: the departure's facts, the
 * seats and everything read per seat, the server actions the rows post to,
 * and the groups the page slots in beneath the seats.
 */

/** The departure, and what this staffer may do on it. */
export type RosterTrip = {
  shopSlug: string;
  shopTimezone: string;
  locale: string;
  tripId: string;
  booked: number;
  capacity: number;
  /** The trip's own shop-local calendar date — when age and birthdays are measured. */
  tripDate: CalendarDate;
  requiresPayment: boolean;
  /**
   * Whether the shop has a Stripe account that can actually take money.
   * `orders/new` refuses without one, so the per-seat "Create order" link
   * is withheld rather than a click that bounces straight back.
   */
  paymentsConnected: boolean;
  /** When free cancellation closes, so staff see a refund cue on paid seats; null = no stated window. */
  cancellationDeadline: Date | null;
  /**
   * Whether this staffer may set `waived` or `refunded` — a decision about
   * money rather than a record of it, gated by `canRefund` everywhere else
   * (issue #714). Recording counter cash stays open to the whole crew.
   */
  mayWriteOffPayment: boolean;
  /**
   * Whether this staffer may raise an invoice (`canPersonManageOrders`). The
   * per-seat "Create order" needs this *and* `paymentsConnected`: without it
   * `orders/new` bounces the reader to the Orders index (issue #1925). Hiding
   * the link is a courtesy; the route and its action refuse on their own.
   */
  canManageOrders: boolean;
  /**
   * The shop's own rental catalog (`shops.rental_items`), so this ledger reads
   * a diver's fit the way the packing list does.
   *
   * A stored `rents_*` flag outlives the shop dropping that item, deliberately
   * (issue #1755), and the fit line marks such a piece as no longer rented.
   * Omitted, every piece reads as offered. The drysuit consequences (weight
   * check, fin sizing, the card advisory) do not read it: they follow
   * `dives_dry`, what the diver wears (H-78).
   */
  shopRentalItems?: readonly string[];
  /** This seat's departure is a course with a minimum age, so a split must take a date of birth. */
  splitAsksDateOfBirth?: boolean;
  /**
   * The rung this course issues (`courses.certifies_level`, issue #2059) —
   * where the "Certify diver" select opens, so the instructor confirms rather
   * than hunts. Still a choice per diver: a student who finished a different
   * rung, or a specialty, is one change of the select away.
   */
  certifyDefaultLevel?: CertificationLevel | null;
  /**
   * This departure teaches a course with learning materials on it, so each
   * seat says whether a staffer has marked them done (ADR
   * 20261008-course-learning-materials).
   */
  courseHasMaterials?: boolean;
  /**
   * The session has not yet ended, so a student with materials still to do
   * wears the "Materials not done" capsule. After the last day it is history.
   */
  courseMaterialsOpen?: boolean;
  /** The Trip surface already leads with its masthead capacity read. */
  compact?: boolean;
  /** Keep the old standalone Guests heading for the compatibility route. */
  showSummaryHeading?: boolean;
};

export type RosterPrivateNote = Awaited<ReturnType<typeof listBookingNotes>>[number] & {
  /** Diver-record notes are visible here but remain editable on their canonical page. */
  deletable?: boolean;
};

/** The seats, and everything the page read about each one. */
export type RosterRows = {
  roster: RosterEntry[];
  readinessByBooking: ReadinessByBooking;
  waiverByBooking: WaiverByBooking;
  rentalFitByBooking: RentalFitByBooking;
  nitroxByBooking: NitroxByBooking;
  notesByBooking: Map<string, RosterPrivateNote[]>;
  /** What each student's next step already says, so an instructor edits rather than retypes. */
  courseNextStepByBooking?: Map<string, string>;
  /** What the browser extension searches PADI's eLearning for, per seat (H-106). */
  elearningQueryByBooking?: Map<string, ElearningQuery>;
  /**
   * Who finished the course's materials, by person, across every departure of
   * the course (`courseMaterialsDoneByPerson`): the roster's "done" reads here.
   */
  courseMaterialsDoneByPerson?: ReadonlyMap<string, CourseMaterialsDone>;
  /** Per held seat, the other held seats a split may move with it (`sameNameHeldSeats`). */
  sameNameHeldSeats?: ReadonlyMap<string, ReadonlyArray<SameNameHeldSeat>>;
  /**
   * Per held seat, the matched diver's last dive day at this shop, or null for
   * none (issue #1789): the evidence line in the armed "Same person" confirm.
   */
  heldSeatLastDiveDay?: ReadonlyMap<string, Date | null>;
  /** Per seat, the unspent package dives its diver could put toward this trip (issue #1697). */
  packageDivesByBooking?: ReadonlyMap<string, number>;
  /**
   * The booking a staffer just acted on (`?bid=`), if any — a saved contact,
   * an updated payment. Acting on a row can move what they touched into the
   * reference panel or settle the row into the Ready group, and a control
   * must never leave from under the finger that used it: this row renders
   * with its panel open on the way back.
   */
  keepOpenBookingId?: string;
  /**
   * The seat whose paper release was just refused for a co-signer sharing the
   * diver's name (issue #1573). That one row's form offers the staffer's
   * namesake confirmation; every other minor's does not.
   */
  namesakeRefusedBookingId?: string;
  /**
   * The seat whose change into diving the card check just refused (ADR
   * 20261007-participant-types). That one row's "Coming as" opens and offers
   * "Change anyway"; no other row does. The page passes it only to an owner,
   * manager or instructor (`canOverrideCertBlock`).
   */
  participantTypeCertBookingId?: string;
};

/** The server actions a row posts to. */
export type RosterActions = {
  /** A reducer, not a plain form action: a refusal hands the typed values
   * back to the control rather than redirecting (`PaperWaiverAction`). */
  markWaiverInPersonAction: PaperWaiverAction;
  markPaymentAction: (formData: FormData) => void;
  removeBookingAction: (formData: FormData) => void;
  /**
   * "Coming as": change what this seat is for (ADR
   * 20261007-participant-types). Absent where the staffer may not change a
   * booking, and then the row only shows the type.
   */
  setParticipantTypeAction?: (formData: FormData) => void;
  confirmIdentityAction: (formData: FormData) => void;
  /** "Different person": the held seat becomes a new diver (`splitBookingIdentity`). */
  splitIdentityAction: (formData: FormData) => void;
  /**
   * "Send a new waiver" on a seat a physician refused: retires the refusal from
   * the seat and emails a fresh release. Absent for staff who may not
   * (`canRetireMedicalRefusal`), and then the row offers no such door.
   */
  sendNewWaiverAction?: (formData: FormData) => void;
  addNoteAction: (formData: FormData) => void;
  deleteNoteAction: (formData: FormData) => void;
  /** Staff record or correct a diver's emergency contact from their row (task 144). */
  saveEmergencyContactAction: (formData: FormData) => void;
  /**
   * The one path from "this shop taught and ran this course" to a
   * certifications row (issue #717). Present only on a course session's own
   * roster — a fun dive has no completion to certify.
   */
  certifyDiverAction?: (formData: FormData) => void;
  /** Record a course form signed on paper (ADR 20261008-course-forms). */
  recordPaperCourseFormAction?: (formData: FormData) => void;
  /**
   * What this student does next, in the instructor's own words (issues #1196,
   * #1205) — present under exactly the same condition as `certifyDiverAction`,
   * because both are acts of teaching a course session and a roster that
   * offered one without the other would be a roster that half-taught.
   */
  saveCourseNextStepAction?: (formData: FormData) => void;
  /**
   * Tick a student's learning materials done, or take the tick back (ADR
   * 20261008-course-learning-materials). Present only on a course session
   * whose course carries materials.
   */
  setCourseMaterialsDoneAction?: (formData: FormData) => void;
  /** Tick the materials from PADI's own eLearning page (H-106); beside the tick above. */
  elearningCheckAction?: (
    previous: ElearningCheckResult,
    formData: FormData,
  ) => Promise<ElearningCheckResult>;
  updatePickupAction?: (bookingId: string, formData: FormData) => void;
};

/**
 * What the desk adds to the roster once arrivals open, already drawn by the
 * page (`buildArrivalDesk`): the count above the list, each seat's tap at the
 * end of its name line, what stands under the row (the "Not here" door, a
 * released seat's next step), and which seats the crew has boarded.
 *
 * The count is drawn here rather than by the page because whether the desk is
 * *finished* is this list's question: "Everyone's checked in" must never show
 * over a row still in "Still to clear" (dive-domain review 2026-10-05).
 */
export type RosterArrival = {
  instrument?: (deskWorkOpen: boolean) => ReactNode;
  controls: ReadonlyMap<string, ReactNode>;
  below: ReadonlyMap<string, ReactNode>;
  boarded: ReadonlySet<string>;
};

/** What the page slots into the ledger beneath the seats. */
export type RosterSlots = {
  /**
   * The wait list, rendered as this ledger's "Waiting for a seat" group —
   * band plus rows, no card of its own (`WaitlistGroup`).
   */
  waitingGroup?: ReactNode;
  /** Recorded invitations, as the "Invited" group (`TripInvitationGroup`). */
  invitedGroup?: ReactNode;
  /** The one terminal action group in the guests ledger, supplied by the page. */
  addDiverGroup?: ReactNode;
  /**
   * **The desk, once arrivals open** (`_arrivals/arrival-desk.tsx`). The
   * Divers tab and the old Check-in tab were one list drawn twice, with the
   * same blockers and the same fixes on both (owner, 2026-10-05), so arrival is
   * now a state of this list rather than a tab of its own: a cleared seat's row
   * ends in its check-in tap, an arrived seat sinks into "Checked in", and a
   * released one into "Not here". Absent outside the arrivals window, and the
   * roster is exactly what it was.
   */
  arrival?: RosterArrival;
};

/** Everything the enum holds — for a staffer who may write money off. */
export const PAYMENT_STATUSES_ALL: readonly PaymentStatus[] = [
  "unpaid",
  "deposit_paid",
  "paid",
  "waived",
  "refunded",
];

/**
 * Recording money received or not yet received. Counter cash at the dock is
 * front-desk work and stays open to the whole crew; `waived` (a free seat) and
 * `refunded` (which reduces reported revenue without moving any money) are not
 * here (issue #714).
 */
export const PAYMENT_STATUSES_RECORDING_ONLY: readonly PaymentStatus[] = [
  "unpaid",
  "deposit_paid",
  "paid",
];

// The whole waiver collapses to a single control per diver. Its face is the
// status; its click is the only sensible next action. `action: null` means
// there is nothing left to send — the waiver is signed, or a medical answer
// decides it — and the row has no control at all.
type WaiverControlKeys = {
  labelKey: StaffMessageKey;
  hintKey?: StaffMessageKey;
  confirm: boolean;
} & (
  | {
      action: "send" | "resend";
      /**
       * The button the send wears: the app's own `sm` button, as the diver
       * record draws the same act (`WaiverDeliveryActions`), never a
       * hand-rolled pill beside it (K-174). `danger` for a link that expired.
       */
      variant: "secondary" | "danger";
    }
  | { action: null }
);

export type WaiverControl = WaiverControlKeys & { label: string; hint?: string };

const WAIVER_CONTROL_KEYS: Record<ReturnType<typeof waiverState>, WaiverControlKeys> = {
  not_sent: {
    labelKey: "trips.roster.waiverSend",
    variant: "secondary",
    action: "send",
    confirm: false,
  },
  awaiting_signature: {
    labelKey: "trips.roster.waiverSent",
    hintKey: "trips.roster.waiverResendHint",
    variant: "secondary",
    action: "resend",
    confirm: true,
  },
  expired: {
    labelKey: "trips.roster.waiverLinkExpired",
    variant: "danger",
    action: "resend",
    confirm: false,
  },
  complete: {
    labelKey: "trips.roster.waiverSigned",
    action: null,
    confirm: false,
  },
  medical_review: {
    labelKey: "trips.roster.waiverMedicalReview",
    action: null,
    confirm: false,
  },
  // Danger where the review above it is warning: a hold might still clear, and
  // this one will not. `action: null` for the same reason as `complete` —
  // there is no next tap here, and a refusal is the one waiver state where
  // sending another link would be the wrong thing to offer (issue #1283).
  medical_not_cleared: {
    labelKey: "trips.roster.waiverMedicalNotCleared",
    action: null,
    confirm: false,
  },
};

export type WaiverControls = Record<ReturnType<typeof waiverState>, WaiverControl>;

/** Every waiver state's control, worded. */
export function waiverControls(t: StaffTranslator): WaiverControls {
  return Object.fromEntries(
    Object.entries(WAIVER_CONTROL_KEYS).map(([status, entry]) => [
      status,
      {
        ...entry,
        label: t(entry.labelKey),
        hint: entry.hintKey ? t(entry.hintKey) : undefined,
      } satisfies WaiverControl,
    ]),
  ) as WaiverControls;
}

/** The payment control's words. */
export function rosterPaymentStatusCopy(t: StaffTranslator): PaymentStatusControlCopy {
  return {
    prefix: t("trips.roster.paymentPrefix"),
    statuses: {
      unpaid: t("trips.roster.paymentUnpaid"),
      deposit_paid: t("trips.roster.paymentDepositPaid"),
      paid: t("trips.roster.paymentPaid"),
      waived: t("trips.roster.paymentWaived"),
      // Between `waived` and `refunded` because this object's key order is the
      // select's option order (`PaymentStatusControl`), and the money states
      // read low-to-high. It is never *selectable* — no entry in
      // `PAYMENT_STATUSES_ALL` — only shown when the seat is already in it.
      partly_refunded: t("trips.roster.paymentPartlyRefunded"),
      refunded: t("trips.roster.paymentRefunded"),
    },
    update: t("trips.roster.paymentUpdate"),
    updating: t("trips.roster.paymentUpdating"),
  };
}

/**
 * **Which group every seat files under**, and the facts the bands say once.
 * Pure: the ledger's rules for "Still to clear", "Ready", "Checked in" and
 * "Not here", read off the same per-seat maps the rows draw from.
 */
export function groupRoster({
  t,
  rows,
  requiresPayment,
  arrival,
  controls,
}: {
  t: StaffTranslator;
  rows: Pick<RosterRows, "roster" | "readinessByBooking" | "waiverByBooking">;
  requiresPayment: boolean;
  arrival: RosterArrival | undefined;
  controls: WaiverControls;
}) {
  const { roster, readinessByBooking, waiverByBooking } = rows;
  const WAIVER_CONTROLS = controls;
  // A depth advisory whose sentence renders identically for much of the boat
  // is one fact about the dive plan, not N facts about N divers (principle 9):
  // it renders once, under the group band, and each affected row wears a
  // capsule. **Blockers never group this way** (Aaron, 2026-10-05): "1 blocker
  // shared with other divers, listed above" told a staffer neither what was
  // wrong nor what to do, and a blocker is fixed diver by diver, so there is
  // no batched action a shared line could stand for. Each row says its own.
  //
  // The advisory is measured against the record the seat is attached to, so
  // on a held seat it is a fact about the matched person — `junior_age` says
  // they are a minor, `no_card` or a ceiling says what card they hold — and is
  // withheld wherever it would show or count (security re-review, issue #1690).
  const seatDepthAdvisory = (booking: RosterEntry["booking"]) => {
    const row = readinessByBooking.get(booking.id);
    const held =
      Boolean(booking.identityUnconfirmedAt) ||
      Boolean(row?.readiness?.blockers.some((blocker) => blocker.code === "identity_unconfirmed"));
    return held ? undefined : row?.depthAdvisory;
  };
  const advisorySentenceCounts = new Map<string, number>();
  for (const { booking } of roster) {
    const depthAdvisory = seatDepthAdvisory(booking);
    if (depthAdvisory?.status === "exceeds") {
      const text = depthWarningText(t, depthAdvisory);
      advisorySentenceCounts.set(text, (advisorySentenceCounts.get(text) ?? 0) + 1);
    }
  }
  const sharedAdvisoryTexts = new Set(
    [...advisorySentenceCounts]
      .filter(([, count]) => count >= SHARED_FACT_MIN)
      .map(([sentence]) => sentence),
  );
  const sharedFacts = [...advisorySentenceCounts]
    .filter(([sentence]) => sharedAdvisoryTexts.has(sentence))
    .map(([sentence, count]) => ({ sentence, count }));

  /**
   * **What the desk still owes this seat**: readiness clear, waiver signed
   * with no medical hold, identity confirmed, an emergency contact on file
   * (name and number), and the money recorded. A checked-in seat files under
   * "Checked in" only once these are done, because the moment the diver is in
   * front of a staffer is the one moment to get a number or a payment.
   */
  const deskTasksClear = ({ booking, person }: RosterEntry): boolean => {
    const readiness = readinessByBooking.get(booking.id)?.readiness;
    const paymentStatus = readinessByBooking.get(booking.id)?.paymentStatus;
    const currentWaiver = waiverByBooking.get(booking.id)?.waiver ?? null;
    const status = waiverState(currentWaiver);
    const control = WAIVER_CONTROLS[status];
    const identityUnconfirmed =
      Boolean(booking.identityUnconfirmedAt) ||
      Boolean(readiness?.blockers.some((blocker) => blocker.code === "identity_unconfirmed"));
    // A name with no number reads as "on file" but is unreachable in an
    // incident — same both-fields rule Today's nudge uses (src/db/today.ts).
    const hasEmergencyContact = Boolean(
      person.emergencyContactName && person.emergencyContactPhone,
    );
    // `partly_refunded` settles the row: a seat that paid in full and had part
    // handed back owes nothing (CodeRabbit review on PR #949).
    const paymentSettled =
      !requiresPayment ||
      paymentStatus === "paid" ||
      paymentStatus === "waived" ||
      paymentStatus === "partly_refunded";
    return (
      readiness?.status === "ready" &&
      control.action === null &&
      status !== "medical_review" &&
      !identityUnconfirmed &&
      hasEmergencyContact &&
      paymentSettled
    );
  };
  /**
   * The desk tasks above, plus what the crew reads before the dive: an
   * unanswered re-entry ask, a depth advisory particular to this diver, a long
   * gap since their last dive. Those are talked through with the diver at the
   * desk, so once they have checked in they no longer hold the row in "Still
   * to clear" — a band that never empties trains a crew to stop reading it
   * (dive-domain review 2026-10-05). Before arrival they still do.
   */
  const isSettled = (entry: RosterEntry): boolean => {
    const { booking } = entry;
    const depth = seatDepthAdvisory(booking);
    const depthText = depth?.status === "exceeds" ? depthWarningText(t, depth) : null;
    const depthShared = depthText !== null && sharedAdvisoryTexts.has(depthText);
    return (
      deskTasksClear(entry) &&
      // A diver who asked for something the crew has not answered is still to
      // clear — the same rule the free-text preference note carried before D12
      // replaced it (ADR 20260904-reef-all-the-way-down, D18).
      !booking.reEntryAsk &&
      (depthText === null || depthShared) &&
      // Currency informs, never gates (ADR 20260821-currency-is-what-catches-
      // people) — but a warning filed under "Ready" is a warning nobody reads
      // (dive-domain review 2026-08-21).
      !(isDiver(booking.participantType) && diveRecencyIsNotable(booking.lastDivedBand))
    );
  };

  // With the desk open, two more groups: the seats it is finished with. A
  // released seat is never "Ready" and never work, and a checked-in seat that
  // has gone blocked since, or still owes the desk something, stays in "Still
  // to clear" wearing its reasons — the counter's most dangerous silence was
  // folding that row away.
  const notHere = arrival ? roster.filter(({ booking }) => booking.status === "no_show") : [];
  const working = arrival ? roster.filter(({ booking }) => booking.status !== "no_show") : roster;
  const arrived = (entry: RosterEntry) => Boolean(arrival) && entry.booking.status === "checked_in";
  const here = working.filter((entry) => arrived(entry) && deskTasksClear(entry));
  const stillToClear = working.filter((entry) =>
    arrived(entry) ? !deskTasksClear(entry) : !isSettled(entry),
  );
  const ready = working.filter((entry) => !arrived(entry) && isSettled(entry));
  // The desk is finished only when nobody who has arrived still owes it
  // something; the count's cleared line waits on this.
  const deskWorkOpen = working.some((entry) => arrived(entry) && !deskTasksClear(entry));
  const hereBoarded = here.filter(({ booking }) => arrival?.boarded.has(booking.id)).length;
  const hereMeta =
    hereBoarded === 0
      ? undefined
      : hereBoarded === here.length
        ? t("checkIn.settledAllBoarded")
        : t("checkIn.settledSomeBoarded", { count: hereBoarded });
  // The queue's own rule, stated once (src/lib/roster-filters.ts): an absent
  // readiness row is not a blocked diver.
  //
  // Deliberately narrower than the "Still to clear" group above it: the
  // earned moment says "Everyone's cleared to dive", which is readiness and
  // only readiness — a missing emergency contact or an unpaid balance is
  // desk work, not dive clearance (principle 3 rations the moment to "the
  // last blocker of the morning clearing"). Driving it from the group's own
  // `isSettled` would also let a diver's buddy-group note — which keeps a
  // row open forever by design — suppress the moment on any boat carrying
  // one.
  const blockedCount = roster.filter(({ booking }) =>
    rosterRowIsBlocked(readinessByBooking.get(booking.id)?.readiness),
  ).length;

  return {
    stillToClear,
    ready,
    here,
    notHere,
    deskWorkOpen,
    hereMeta,
    blockedCount,
    sharedFacts,
    sharedAdvisoryTexts,
  };
}

export type RosterGroups = ReturnType<typeof groupRoster>;
