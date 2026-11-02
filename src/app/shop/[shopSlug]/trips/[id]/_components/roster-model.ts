import type { ReactNode } from "react";
import type {
  AgencyCheckHostAction,
  AgencyListedHostAction,
} from "@/app/shop/[shopSlug]/_components/agency-check/AgencyCheckHost";
import { forgivingCopy } from "@/components/ui/forgiving-copy";
import type { AboardHold } from "@/db/aboard-at-sea";
import type { IssuedCard } from "@/db/agency-processing";
import type { SameNameHeldSeat } from "@/db/bookings";
import type { CourseMaterialsDone } from "@/db/course-materials";
import type { SameNamePerson } from "@/db/identity-repoint";
import type { listBookingNotes } from "@/db/operations";
import type { PaymentMarkFacts } from "@/db/payment-marks";
import type { TrainingMarkRosterSeat } from "@/db/training-marks";
import { depthWarningText } from "@/i18n/depth-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import type { AgencyCheckableCard } from "@/lib/agency-check-queue";
import type { CalendarDate } from "@/lib/calendar-date";
import type { CertificationLevel } from "@/lib/certification-levels";
import { seatSailed } from "@/lib/closeout";
import { diveRecencyIsNotable } from "@/lib/dive-recency";
import type { ElearningQuery } from "@/lib/elearning-check";
import type { PaperWaiverAction } from "@/lib/paper-waiver-form";
import { isDiver } from "@/lib/participant-types";
import type { ManualPaymentMethodCode, MarkRetry } from "@/lib/payment-marks";
import type { CountedAboardBlocked } from "@/lib/roll-call-readiness";
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
  /** A rehearsal departure: nothing about it is sent (ADR 20261012-rehearsal-departures). */
  rehearsal?: boolean;
  /** Marked as past no-decompression limits: the roster reminds crew to check technical cards. */
  exceedsNoDecoLimits?: boolean;
  /** A guide in the water is rostered: they need the decompression card check too. */
  divingCrew?: boolean;
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
   * `dives_dry`, what the diver wears (H-20260916-rental-fit-describe-shop).
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
  /**
   * On a departure that is not a course session, each seat's training mark
   * and the course seats a mark may name (`trainingMarksForRoster`, #2275).
   */
  trainingMarks?: {
    bySeat: ReadonlyMap<string, TrainingMarkRosterSeat>;
  };
  /** What the browser extension searches PADI's eLearning for, per seat (H-20261008-padi-elearning-check). */
  elearningQueryByBooking?: Map<string, ElearningQuery>;
  /** A PADI course with materials at a shop whose PADI checks are off (H-20261014-padi-divechek). */
  elearningChecksOff?: boolean;
  /** Per diver, the cards the browser extension could check with their agencies (H-20261008-cert-check-extension). */
  agencyCheckCardsByPerson?: ReadonlyMap<string, readonly AgencyCheckableCard[]>;
  /** Per student, the card this session issued and whether the agency has it yet (ideas item 46). */
  issuedCardByPerson?: ReadonlyMap<string, IssuedCard>;
  /**
   * Who finished the course's materials, by person, across every departure of
   * the course (`courseMaterialsDoneByPerson`): the roster's "done" reads here.
   */
  courseMaterialsDoneByPerson?: ReadonlyMap<string, CourseMaterialsDone>;
  /** Per held seat, the other held seats a split may move with it (`sameNameHeldSeats`). */
  sameNameHeldSeats?: ReadonlyMap<string, ReadonlyArray<SameNameHeldSeat>>;
  /** Seats the boat carried or may be carrying: Remove refuses them (H-20261015-aboard-diver-removal-at). */
  aboardAtSea?: ReadonlyMap<string, AboardHold>;
  /**
   * Per held seat held for the same-name reason, the shop's other live people
   * with that name, by name only (`otherSameNamePeople`, issue #2129).
   */
  sameNamePeople?: ReadonlyMap<string, ReadonlyArray<SameNamePerson>>;
  /**
   * Per course seat, the charter seats its student was sold only on this
   * course (`chartersRelyingOnCourseSeats`, issue #2058): named in the seat's
   * Remove confirm and its move.
   */
  dependentCharters?: ReadonlyMap<string, ReadonlyArray<{ title: string; startsAt: Date }>>;
  /**
   * Per held seat, the matched diver's last dive day at this shop, or null for
   * none (issue #1789): the evidence line in the armed "Same person" confirm.
   */
  heldSeatLastDiveDay?: ReadonlyMap<string, Date | null>;
  /** Per seat, the unspent package dives its diver could put toward this trip (issue #1697). */
  packageDivesByBooking?: ReadonlyMap<string, number>;
  /** Per seat, the Paid mark's money and the seat's balance (`paymentMarkFactsForTrip`). */
  paymentMarksByBooking?: ReadonlyMap<string, PaymentMarkFacts>;
  /**
   * The booking a staffer just acted on (`?bid=`), if any — a saved contact,
   * an updated payment. Acting on a row can move what they touched into the
   * reference panel or settle the row into the Ready group, and a control
   * must never leave from under the finger that used it: this row renders
   * with its panel open on the way back.
   */
  keepOpenBookingId?: string;
  /** The Paid mark that just bounced (issue #2607): reopens that seat's sheet holding what was typed. */
  paymentMarkRetry?: { bookingId: string } & MarkRetry;
  /** A party payment waiting on its confirm (issue #2605). */
  partyPreview?: PartyPreview;
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
/**
 * The server's own split of a party payment, shown before it is taken
 * (issue #2605). `amountCents` and `method` ride the confirm form; the
 * shares are for reading, and the confirm works them out again.
 */
export type PartyPreview = {
  leadBookingId: string;
  amountCents: number;
  method: ManualPaymentMethodCode;
  shares: { bookingId: string; personName: string; amountCents: number; settles: boolean }[];
  unspentCents: number;
  /** The party's total owed when the split was read; the confirm form returns it so a changed party is not paid blind. */
  owedCents: number;
};

export type RosterActions = {
  /** A reducer, not a plain form action: a refusal hands the typed values
   * back to the control rather than redirecting (`PaperWaiverAction`). */
  markRosterWaiverInPersonAction: PaperWaiverAction;
  markPaymentAction: (formData: FormData) => void;
  /** "Mark the party paid", step one: the server works the split out and sends the page back to show it. */
  previewPartyPaymentAction: (formData: FormData) => void;
  /** Step two: take the payment (issue #2605). */
  markPartyPaidAction: (formData: FormData) => void;
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
  /** "Another diver on file": the held seat moves to that namesake, still held (`repointHeldBooking`). */
  repointIdentityAction: (formData: FormData) => void;
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
  /** Mark a charter seat as a training dive, and clear it (issue #2275). */
  markTrainingDiveAction?: (formData: FormData) => void;
  clearTrainingDiveAction?: (formData: FormData) => void;
  /**
   * What this student does next, in the instructor's own words (issues #1196,
   * #1205) — present under exactly the same condition as `certifyDiverAction`,
   * because both are acts of teaching a course session and a roster that
   * offered one without the other would be a roster that half-taught.
   */
  saveCourseNextStepAction?: (formData: FormData) => void;
  /** Tick a card this session issued processed with its agency, or take it back (ideas item 46). */
  markCardProcessedAction?: (formData: FormData) => void;
  /**
   * Tick a student's learning materials done, or take the tick back (ADR
   * 20261008-course-learning-materials). Present only on a course session
   * whose course carries materials.
   */
  setCourseMaterialsDoneAction?: (formData: FormData) => void;
  /** Tick the materials from PADI's own eLearning page (H-20261008-padi-elearning-check); beside the tick above. */
  elearningCheckAction?: (
    previous: ElearningCheckResult,
    formData: FormData,
  ) => Promise<ElearningCheckResult>;
  /**
   * `agencyCheckAction` bound to the shop (H-20261008-cert-check-extension): each row's "Check with SSI"
   * and the departure's "Check all", one card at a time. The same action, gate
   * and stamp as the diver record's.
   */
  agencyCheckAction?: AgencyCheckHostAction;
  /** Files the other cards a match's page listed, ticked under the diver's row (layer 3). */
  agencyListedAction?: AgencyListedHostAction;
  updatePickupAction?: (bookingId: string, formData: FormData) => void;
  /** The desk's lunch note for a seat (item 56, review F8); only on a lunch-aboard departure. */
  updateDietaryNoteAction?: (bookingId: string, formData: FormData) => void;
  /**
   * "Move to another departure" (ADR 20261013-staff-move-a-seat): the action
   * and the departures it may move to. Absent once the departure has left, or
   * when there is nowhere to go.
   */
  moveSeat?: SeatMove;
};

/** The departures a seat may move to, already worded with their zone. */
export type SeatMove = {
  action: (formData: FormData) => void;
  /** Validated against the current roster before its global fallback is suppressed. */
  refusal?: { bookingId: string; text: string };
  /** Each with the seats it still sells (`listSeatMoveTargets`). */
  targets: readonly {
    id: string;
    label: string;
    seatsLeft: number;
    startsAt: string;
    localDay: string;
    dayLabel: string;
    timeLabel: string;
  }[];
  /** The departure has left (`hasSailed`): a booked seat no longer moves. */
  departed: boolean;
  /** The departure's scheduled start has passed: a turned-away seat no longer moves. */
  started: boolean;
};

/**
 * Whether this row offers "Move to another departure". A booked seat, while
 * the boat is in; checked in or absent is the day's own record. A seat the
 * desk turned away moves until the boat's scheduled start (layer 3 review,
 * dde-2 #3; re-review dde-3 #4+#5): the desk's money line sends staff here,
 * and `moveBooking` books it on the new departure. From the start its door
 * is Remove.
 */
export function seatMoveForRow(
  booking: { status: string; turnedAwayAt: Date | null },
  moveSeat: SeatMove | undefined,
): SeatMove | undefined {
  if (!moveSeat) return undefined;
  if (booking.status === "no_show" && booking.turnedAwayAt !== null) {
    return moveSeat.started ? undefined : moveSeat;
  }
  return booking.status === "booked" && !moveSeat.departed ? moveSeat : undefined;
}

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
  /** Routine exception actions behind the existing person disclosure. */
  details?: ReadonlyMap<string, ReactNode>;
  boarded: ReadonlySet<string>;
};

/**
 * **A finished departure's Divers tab is its record** (UX review 2026-10-10,
 * item 10): once the boat is home there is nothing to clear, check in or sell,
 * so the list says who sailed and who did not, seat by seat, by the evening
 * count's own rule (`seatSailed`, src/lib/closeout.ts).
 */
export type RosterRecord = {
  /** Each seat's standing result at the dock (`listDepartureRollCallByTrip`). */
  dock: ReadonlyMap<string, "boarded" | "not_boarded">;
  /** Seats with a standing after-dive result (`listAfterDiveRollCallByTrip`). */
  afterDive: ReadonlySet<string>;
  /**
   * Whether the crew took the departure roll call at all: any dock event
   * recording a result, whatever has happened to its booking since
   * (`departureRollCallTakenTripIds`). Never inferred from a boarded seat, so
   * a boat whose whole roster stayed ashore, or whose boarded seats were
   * later cancelled, never reads "No roll call taken".
   */
  rollCallTaken: boolean;
  /**
   * Seats the crew said did not come back aboard at an after-dive checkpoint
   * and nobody has counted since (`listUnaccountedForByTrip`). They sailed,
   * and a record that filed them under "Sailed" beside a diver still in the
   * water would be the lie this group exists to refuse (issue #2404).
   */
  unaccounted: ReadonlySet<string>;
  /**
   * Seats counted aboard while blocked, off the snapshot the count kept
   * (`listCountedAboardBlockedByTrip`, issue #2414). A fact about the past in
   * danger text, never a control: nothing here asks for action.
   */
  countedAboardBlocked: ReadonlyMap<string, CountedAboardBlocked>;
  /**
   * Under a seat, what that diver could do next ("Booked Sat 11:30 AM", or an
   * open day with Add them and Email them this date), keyed by booking id
   * (fifth-loop ideas, item 4). Absent says nothing.
   */
  below?: ReadonlyMap<string, ReactNode>;
};

/** What the page slots into the ledger beneath the seats. */
export type RosterSlots = {
  /**
   * **Who wants in** (`WhoWantsInPanel`, `#who-wants-in`): everyone who asked
   * for a seat here, as one group of the ledger.
   */
  whoWantsInGroup?: ReactNode;
  /** Past divers of the site worth asking (`InviteSuggestionsGroup`). */
  suggestionsGroup?: ReactNode;
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
  /** The departure is finished: the ledger is its record, never the desk. */
  record?: RosterRecord;
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

/**
 * Every waiver state's control, worded. On a rehearsal an open link was never
 * sent — every message about one is held, and its links are handed over in
 * person (ADR 20261012-rehearsal-departures) — so it says held (#2395).
 */
export function waiverControls(
  t: StaffTranslator,
  { rehearsal = false }: { rehearsal?: boolean } = {},
): WaiverControls {
  const keys: typeof WAIVER_CONTROL_KEYS = rehearsal
    ? {
        ...WAIVER_CONTROL_KEYS,
        awaiting_signature: {
          ...WAIVER_CONTROL_KEYS.awaiting_signature,
          labelKey: "trips.roster.waiverHeldRehearsal",
        },
      }
    : WAIVER_CONTROL_KEYS;
  return Object.fromEntries(
    Object.entries(keys).map(([status, entry]) => [
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
    label: t("trips.roster.paymentStatusLabel"),
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
    amountLabel: t("trips.roster.paymentAmountLabel"),
    methodLabel: t("trips.roster.paymentMethodLabel"),
    methods: {
      cash: t("trips.roster.paymentMethodCash"),
      card: t("trips.roster.paymentMethodCard"),
      other: t("trips.roster.paymentMethodOther"),
    },
    forgiving: forgivingCopy(t),
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
  record,
}: {
  t: StaffTranslator;
  rows: Pick<RosterRows, "roster" | "readinessByBooking" | "waiverByBooking">;
  requiresPayment: boolean;
  arrival: RosterArrival | undefined;
  controls: WaiverControls;
  record?: RosterRecord;
}) {
  const { roster, readinessByBooking, waiverByBooking } = rows;
  if (record) return recordGroups(t, roster, record);
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
    if (depthAdvisory?.status === "exceeds" || depthAdvisory?.status === "verification_required") {
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
    const depthText =
      depth?.status === "exceeds" || depth?.status === "verification_required"
        ? depthWarningText(t, depth)
        : null;
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
  // A released seat the desk turned away (H-20261015-who-may-turn-someone) is its own group: seen and
  // refused is not "not here", and the two must never share a heading.
  const released = arrival ? roster.filter(({ booking }) => booking.status === "no_show") : [];
  const notHere = released.filter(({ booking }) => !booking.turnedAwayAt);
  const turnedAway = released.filter(({ booking }) => Boolean(booking.turnedAwayAt));
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
    turnedAway,
    deskWorkOpen,
    hereMeta,
    blockedCount,
    sharedFacts,
    sharedAdvisoryTexts,
    sailed: [] as RosterEntry[],
    didNotSail: [] as RosterEntry[],
    uncounted: [] as RosterEntry[],
    unrecorded: [] as RosterEntry[],
    unaccounted: [] as RosterEntry[],
    sailedMeta: undefined as string | undefined,
  };
}

/**
 * **The record's groups**, one seat at a time by `seatSailed`, the rule the
 * evening close-out counts by (dive-domain review of UX batch 1):
 *
 * - **Sailed**: boarded at the dock, or counted at an after-dive checkpoint
 *   (a diver picked up at the second site sailed, and that count outranks a
 *   desk's `no_show`).
 * - **Didn't sail**: only what somebody said: the crew's `not_boarded` at the
 *   dock, or a released seat (`no_show`) nobody counted aboard.
 * - **Not counted at the dock**: a seat nobody said anything about on a
 *   departure whose roll call was taken. Silence is not "didn't sail".
 * - **No roll call taken**: the same silence on a departure with no dock roll
 *   call at all, under a band that says so rather than a guess.
 * - **Not back aboard**: said missing at an after-dive checkpoint and not
 *   counted since. Ahead of every other group, and the departure stays open
 *   while one is here (`departureStage`, issue #2404).
 *
 * Nothing is still to clear, nothing is blocked, and no shared advisory is
 * said: the dive is over (dive-domain rule: a record never asks for action).
 */
function recordGroups(t: StaffTranslator, roster: RosterEntry[], record: RosterRecord) {
  const sailed: RosterEntry[] = [];
  const didNotSail: RosterEntry[] = [];
  const uncounted: RosterEntry[] = [];
  const unrecorded: RosterEntry[] = [];
  const turnedAway: RosterEntry[] = [];
  const unaccounted: RosterEntry[] = [];
  for (const entry of roster) {
    const id = entry.booking.id;
    // First: the one group that is still a question, whatever else is on file.
    if (record.unaccounted.has(id)) {
      unaccounted.push(entry);
      continue;
    }
    const dockResult = record.dock.get(id) ?? null;
    const afterDiveResultStands = record.afterDive.has(id);
    const noShow = entry.booking.status === "no_show";
    if (dockResult === null && !afterDiveResultStands && !noShow) {
      (record.rollCallTaken ? uncounted : unrecorded).push(entry);
    } else if (seatSailed({ noShow, dockResult, afterDiveResultStands })) {
      sailed.push(entry);
    } else if (noShow && entry.booking.turnedAwayAt) {
      // Did not sail because the desk refused them (H-20261015-who-may-turn-someone), said apart from
      // the divers who never came.
      turnedAway.push(entry);
    } else {
      didNotSail.push(entry);
    }
  }
  return {
    stillToClear: [] as RosterEntry[],
    ready: [] as RosterEntry[],
    here: [] as RosterEntry[],
    notHere: [] as RosterEntry[],
    turnedAway,
    deskWorkOpen: false,
    hereMeta: undefined as string | undefined,
    blockedCount: 0,
    sharedFacts: [] as { sentence: string; count: number }[],
    sharedAdvisoryTexts: new Set<string>(),
    sailed,
    didNotSail,
    uncounted,
    unrecorded,
    unaccounted,
    // The group's fact, said once (principle 9): how many of those who sailed
    // were counted aboard while blocked. Nothing at all when none were.
    sailedMeta: countedBlockedMeta(t, sailed, record),
  };
}

function countedBlockedMeta(
  t: StaffTranslator,
  sailed: readonly RosterEntry[],
  record: RosterRecord,
): string | undefined {
  const count = sailed.filter(({ booking }) => record.countedAboardBlocked.has(booking.id)).length;
  return count === 0 ? undefined : t("trips.roster.sailedBlockedMeta", { count });
}

export type RosterGroups = ReturnType<typeof groupRoster>;
