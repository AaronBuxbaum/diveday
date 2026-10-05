import Link from "next/link";
import { Children, type ReactNode } from "react";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { IdentityCheck } from "@/components/IdentityCheck";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { PrivateNoteForm } from "@/components/PrivateNoteForm";
import { paperWaiverCopy } from "@/components/paper-waiver-copy";
import { ScrollToHash } from "@/components/ScrollToHash";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { INSET_NOTE_BOX, INSET_NOTE_CLASS, sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { controlClass, Field, FieldGrid, textareaClassFor } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { GroupLabel } from "@/components/ui/ledger";
import { StatusMark, StatusMarkColumn } from "@/components/ui/StatusMark";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { listBookingNotes } from "@/db/operations";
import { birthdayCalloutText } from "@/i18n/birthday-labels";
import { depthWarningText } from "@/i18n/depth-labels";
import { STAFF_RE_ENTRY_KEYS } from "@/i18n/dive-intent-labels";
import { guardianCoSignedText } from "@/i18n/guardian-labels";
import { identityCheckWords, identityReasonText } from "@/i18n/identity-check-labels";
import {
  CERTIFICATION_LEVEL_KEYS,
  diveRecencyText,
  readinessBlockerText,
  readinessStatusText,
  readinessStatusTone,
  SPECIALTY_KEYS,
} from "@/i18n/readiness-labels";
import { drysuitCardWarningText, rentalFitLineText } from "@/i18n/rental-labels";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { ageOnDate, birthdayCallout, isMinorOnDate } from "@/lib/age";
import type { CalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { DepthUnit } from "@/lib/depth-units";
import { rentalFitLine } from "@/lib/dive-prep";
import { diveRecencyIsNotable } from "@/lib/dive-recency";
import { checkDrysuitCard } from "@/lib/drysuit-card";
import { formatDateTimeTz } from "@/lib/format";
import { guardianSignatureOf, guardianSignatureRequired, signingDate } from "@/lib/guardian";
import { heldSeatBlockers } from "@/lib/identity-match";
import { flaggedMedicalPrompts } from "@/lib/medical";
import type { PaperWaiverAction } from "@/lib/paper-waiver-form";
import { paymentSourceLine } from "@/lib/payment-source";
import { BLOCKER_CATEGORY } from "@/lib/readiness";
import { rosterRowIsBlocked } from "@/lib/roster-filters";
import { waiverState } from "@/lib/waivers";
import {
  type PaymentStatus,
  PaymentStatusControl,
  type PaymentStatusControlCopy,
} from "./PaymentStatusControl";
import { RosterAllClear } from "./RosterAllClear";
import { RosterGroup, RosterGroupBand } from "./RosterGroupBand";
import { SHARED_FACT_MIN } from "./shared-facts";
import type {
  NitroxByBooking,
  ReadinessByBooking,
  RentalFitByBooking,
  RosterEntry,
  WaiverByBooking,
} from "./types";

/** Everything the enum holds — for a staffer who may write money off. */
const PAYMENT_STATUSES_ALL: readonly PaymentStatus[] = [
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
const PAYMENT_STATUSES_RECORDING_ONLY: readonly PaymentStatus[] = [
  "unpaid",
  "deposit_paid",
  "paid",
];

/**
 * What the desk adds to the roster once arrivals open, already drawn by the
 * page (`buildArrivalDesk`): the count above the list, each seat's tap at the
 * end of its name line, what stands under the row (the "Not here?" door, a
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

type RosterPrivateNote = Awaited<ReturnType<typeof listBookingNotes>>[number] & {
  /** Diver-record notes are visible here but remain editable on their canonical page. */
  deletable?: boolean;
};

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

type WaiverControl = WaiverControlKeys & { label: string; hint?: string };

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

/**
 * The drawn mark a cleared seat wears — the same circle-and-check geometry as
 * `SettledCheck`, so one hand drew every settled mark in the app. Decorative:
 * the group band above the row already says "Ready" in words, which is what
 * lets seven rows stop repeating it (ADR
 * 20260827-the-departure-is-two-working-surfaces; emoji never — decision 5).
 */
function ReadyMark({ className = "" }: { className?: string }) {
  return <StatusMark variant="success" size="md" className={className} />;
}

/**
 * **The guests ledger** — ADR 20260827-the-departure-is-two-working-surfaces,
 * slice 5d: the roster is one grouped ledger, not a stack of per-diver cards.
 *
 * Groups carry the state word and the count once — **Still to clear**, then
 * **Ready**, with the wait list, recorded invitations, and add-diver action
 * folding in beneath as groups of the same card instead of sibling cards
 * restating the same grammar. A settled seat is a name, at most
 * an exception capsule, and a drawn mark; a seat with open work keeps that
 * work in the open, each item beside its one fix. The filter chips are gone —
 * the groups are the filter — and so is the per-row state word the old rows
 * repeated down the whole list (principle 9: the group owns what the rows
 * share).
 *
 * What did not move: every control keeps its identity and its home. Payment,
 * the waiver send, notes, the emergency contact and the remove action are the
 * same controls in the same order, so the redesign changes what the page
 * *looks* like, never what a staffer's finger knows.
 */
export function RosterSection({
  shopSlug,
  shopTimezone,
  locale,
  tripId,
  booked,
  capacity,
  roster,
  readinessByBooking,
  waiverByBooking,
  rentalFitByBooking,
  shopRentalItems,
  nitroxByBooking,
  requiresPayment,
  paymentsConnected,
  cancellationDeadline,
  markWaiverInPersonAction,
  markPaymentAction,
  mayWriteOffPayment,
  removeBookingAction,
  confirmIdentityAction,
  splitIdentityAction,
  notesByBooking,
  addNoteAction,
  deleteNoteAction,
  saveEmergencyContactAction,
  certifyDiverAction,
  saveCourseNextStepAction,
  courseNextStepByBooking,
  updatePickupAction,
  // Accepted for interface parity with callers/DepthUnit plumbing elsewhere
  // on this page, but `depthWarningText` already embeds its own unit
  // formatting — nothing in this component needs it directly.
  depthUnit: _depthUnit,
  tripDate,
  keepOpenBookingId,
  namesakeRefusedBookingId,
  waitingGroup,
  invitedGroup,
  addDiverGroup,
  arrival,
  compact = false,
  showSummaryHeading = true,
}: {
  shopSlug: string;
  shopTimezone: string;
  locale: string;
  tripId: string;
  booked: number;
  capacity: number;
  roster: RosterEntry[];
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
  readinessByBooking: ReadinessByBooking;
  waiverByBooking: WaiverByBooking;
  rentalFitByBooking: RentalFitByBooking;
  /**
   * The shop's own rental catalog (`shops.rental_items`), so this ledger reads
   * a diver's fit the way the packing list does.
   *
   * A stored `rents_*` flag outlives the shop dropping that item, deliberately
   * (issue #1755) — but the two things this row derives *from* the drysuit flag
   * are conditioned on a suit actually coming off the wall: the card advisory,
   * and "size up over the boot" on the fit line. Omitted, both are raised as
   * before; over-warning is the safe direction for something that gates
   * nothing (`checkDrysuitCard`, `src/lib/dive-prep.ts`'s `inShopDrysuit`).
   */
  shopRentalItems?: readonly string[];
  nitroxByBooking: NitroxByBooking;
  requiresPayment: boolean;
  /**
   * Whether the shop has a Stripe account that can actually take money.
   * `orders/new` refuses without one, so the per-seat "Create order" link
   * is withheld rather than a click that bounces straight back.
   */
  paymentsConnected: boolean;
  /** When free cancellation closes, so staff see a refund cue on paid seats; null = no stated window. */
  cancellationDeadline: Date | null;
  /** A reducer, not a plain form action: a refusal hands the typed values
   * back to the control rather than redirecting (`PaperWaiverAction`). */
  markWaiverInPersonAction: PaperWaiverAction;
  markPaymentAction: (formData: FormData) => void;
  /**
   * Whether this staffer may set `waived` or `refunded` — a decision about
   * money rather than a record of it, gated by `canRefund` everywhere else
   * (issue #714). Recording counter cash stays open to the whole crew.
   */
  mayWriteOffPayment: boolean;
  removeBookingAction: (formData: FormData) => void;
  confirmIdentityAction: (formData: FormData) => void;
  /** "Different person": the held seat becomes a new diver (`splitBookingIdentity`). */
  splitIdentityAction: (formData: FormData) => void;
  notesByBooking: Map<string, RosterPrivateNote[]>;
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
  /**
   * What this student does next, in the instructor's own words (issues #1196,
   * #1205) — present under exactly the same condition as `certifyDiverAction`,
   * because both are acts of teaching a course session and a roster that
   * offered one without the other would be a roster that half-taught.
   */
  saveCourseNextStepAction?: (formData: FormData) => void;
  /** What each student's next step already says, so an instructor edits rather than retypes. */
  courseNextStepByBooking?: Map<string, string>;
  updatePickupAction?: (bookingId: string, formData: FormData) => void;
  /** How this shop reads depth; the stored figure is always metres. */
  depthUnit: DepthUnit;
  /** The trip's own shop-local calendar date — when age and birthdays are measured. */
  tripDate: CalendarDate;
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
  /** The Trip surface already leads with its masthead capacity read. */
  compact?: boolean;
  /** Keep the old standalone Guests heading for the compatibility route. */
  showSummaryHeading?: boolean;
}) {
  const t = staffTranslator(locale);
  const WAIVER_CONTROLS = Object.fromEntries(
    Object.entries(WAIVER_CONTROL_KEYS).map(([status, entry]) => [
      status,
      {
        ...entry,
        label: t(entry.labelKey),
        hint: entry.hintKey ? t(entry.hintKey) : undefined,
      } satisfies WaiverControl,
    ]),
  ) as Record<ReturnType<typeof waiverState>, WaiverControl>;
  const paymentStatusCopy: PaymentStatusControlCopy = {
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
  const refundEligible = cancellationDeadline !== null && cancellationDeadline > nowDate();

  // A depth advisory whose sentence renders identically for much of the boat
  // is one fact about the dive plan, not N facts about N divers (principle 9):
  // it renders once, under the group band, and each affected row wears a
  // capsule. **Blockers never group this way** (Aaron, 2026-10-05): "1 blocker
  // shared with other divers, listed above" told a staffer neither what was
  // wrong nor what to do, and a blocker is fixed diver by diver, so there is
  // no batched action a shared line could stand for. Each row says its own.
  const advisorySentenceCounts = new Map<string, number>();
  for (const { booking } of roster) {
    const row = readinessByBooking.get(booking.id);
    if (row?.depthAdvisory?.status === "exceeds") {
      const text = depthWarningText(t, row.depthAdvisory);
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
    const identityUnconfirmed = Boolean(
      readiness?.blockers.some((blocker) => blocker.code === "identity_unconfirmed"),
    );
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
    const depth = readinessByBooking.get(booking.id)?.depthAdvisory;
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
      !diveRecencyIsNotable(booking.lastDivedBand)
    );
  };

  // Today, in the shop's own zone: the guardian rule measures the diver's age
  // on the day the release is *signed*, which for a paper release recorded
  // here is now — never the departure's date (ADR 20260907-guardian-co-signature).
  const signedToday = signingDate(nowDate(), shopTimezone);

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

  const renderRow = ({ booking, person }: RosterEntry, settledRow: boolean) => {
    const readiness = readinessByBooking.get(booking.id)?.readiness;
    const paymentStatus = readinessByBooking.get(booking.id)?.paymentStatus;
    const paymentSourceCode = paymentSourceLine(
      paymentStatus,
      readinessByBooking.get(booking.id)?.paymentProvider,
    );
    const paymentSource =
      paymentSourceCode === "online"
        ? t("trips.roster.paymentSourceOnline")
        : paymentSourceCode === "package"
          ? t("trips.roster.paymentSourcePackage")
          : paymentSourceCode === "counter"
            ? t("trips.roster.paymentSourceCounter")
            : paymentSourceCode === "waived"
              ? t("trips.roster.paymentSourceWaived")
              : null;
    const currentWaiver = waiverByBooking.get(booking.id)?.waiver ?? null;
    const waiverStatus = waiverState(currentWaiver);
    const waiverControl = WAIVER_CONTROLS[waiverStatus];
    const nitrox = nitroxByBooking.get(booking.id);
    const identityUnconfirmed = Boolean(
      readiness?.blockers.some((blocker) => blocker.code === "identity_unconfirmed"),
    );
    /**
     * **The flag gates disclosure as well as boarding** (security review
     * 2026-09-11). This seat attached itself to an existing person on a guess
     * — a reused email under a different name (H-13), or a name tapped off the
     * counter's trigram prompt (issue #1556) — and everything the roster knows
     * about that person is then a fact about *somebody*, not provably about
     * whoever is standing at the counter. Until a staffer confirms it, one
     * mis-tap would otherwise print a real diver's flagged medical answers,
     * date of birth, emergency contact and rental sizes under a stranger's
     * name, to whoever reads the roster.
     *
     * What stays is the **state of the seat** — its blockers, its readiness
     * word, its payment, the confirm control — because a seat nobody can board
     * still has to say so. What waits is the **particulars of the person**.
     * Confirming reveals all of it in the same render.
     *
     * Deliberately *not* gated: `requiresGuardian` below. That one is a gate,
     * not a line of text — suppressing it would let a staffer record a paper
     * waiver for a minor with no guardian co-signature (ADR
     * 20260907-guardian-co-signature), which is the wrong direction entirely.
     */
    const showsPersonDetail = !identityUnconfirmed;
    const guardian = showsPersonDetail && currentWaiver ? guardianSignatureOf(currentWaiver) : null;
    const flaggedPrompts =
      showsPersonDetail &&
      (waiverStatus === "medical_review" || waiverStatus === "medical_not_cleared") &&
      currentWaiver?.medicalAnswers
        ? flaggedMedicalPrompts(currentWaiver.medicalAnswers)
        : [];
    // Age is shown only when the shop actually holds a date of birth — no
    // date, no line, rather than an "unknown" that reads as a gap to fill on
    // every diver who has never been asked (H-21).
    const dateOfBirth = person.dateOfBirth;
    const age = showsPersonDetail && dateOfBirth ? ageOnDate(dateOfBirth, tripDate) : null;
    const minor = showsPersonDetail && dateOfBirth ? isMinorOnDate(dateOfBirth, tripDate) : false;
    const requiresGuardian = guardianSignatureRequired(dateOfBirth, signedToday);
    const birthday = showsPersonDetail ? birthdayCallout(dateOfBirth, tripDate) : null;
    const hasEmergencyContact = Boolean(
      person.emergencyContactName && person.emergencyContactPhone,
    );
    // A warning, never a gate: the site goes deeper than this diver's
    // training, which an instructor may well have already planned around
    // (H-08). It sits apart from the blocker list for that reason.
    const depth = readinessByBooking.get(booking.id)?.depthAdvisory;
    const notes = notesByBooking.get(booking.id) ?? [];
    // This row's blockers, each in its own sentence. The held-identity one
    // names both people the guess was between (`identityReasonText`), so the
    // two answers under the reason lines need no words of their own. A held
    // seat says nothing measured against the matched person
    // (`heldSeatBlockers`), the same rule as its particulars above.
    const blockerTexts =
      readiness && readiness.status !== "ready"
        ? heldSeatBlockers(readiness.blockers).map((blocker) => ({
            blocker,
            text:
              blocker.code === "identity_unconfirmed"
                ? identityReasonText(
                    t,
                    { bookedAs: booking.identityBookedAs, matchedBy: booking.identityMatchedBy },
                    person.fullName,
                    readinessBlockerText(t, blocker),
                  )
                : readinessBlockerText(t, blocker),
          }))
        : [];
    const depthText = depth?.status === "exceeds" ? depthWarningText(t, depth) : null;
    const depthShared = depthText !== null && sharedAdvisoryTexts.has(depthText);
    // The suit goes out to a diver the shop has no drysuit card for. Behind
    // the same confirmation as the sizes and the nitrox word below, because
    // both halves of the question are the matched person's own record.
    const drysuitCard = showsPersonDetail
      ? checkDrysuitCard(
          rentalFitByBooking.get(booking.id)?.rentsDrysuit ?? false,
          readinessByBooking.get(booking.id)?.specialtyCertifications ?? [],
          shopRentalItems,
        )
      : ({ status: "ok" } as const);
    // The namesake refusal (issue #1573) holds its row open for the same
    // reason a saved contact does: the way through is a control inside the
    // row, and a staffer sent back to a collapsed list has been told what
    // happened and not where to act on it.
    const namesakeRefused = namesakeRefusedBookingId === booking.id;
    const arrivalControl = arrival?.controls.get(booking.id);
    const arrivalBelow = arrival?.below.get(booking.id);
    const holdOpen = keepOpenBookingId === booking.id || namesakeRefused;

    const headerLeft = (
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {/* A real target, not a 21px text line: this link shares its row with
            the disclosure mark, so it needs its own clear hit area (WCAG
            2.5.8's 24px floor; the dock test asks for 44). Foreground ink,
            not `text-primary` — a column of teal names made the identity
            column the loudest thing on the ledger (principle 10: hierarchy by
            type before colour), and the board's own trip-title doors already
            read this way. Hover restores the link cue. */}
        <Link
          href={`/shop/${shopSlug}/divers/${person.id}`}
          className="inline-flex min-h-11 items-center font-semibold leading-tight text-base text-foreground hover:text-primary hover:underline"
        >
          {person.fullName}
        </Link>
        {/* Text, never colour alone — this is read in sunlight on a moving
            boat (design/principles.md #2). A minor is the exception the crew
            is being told about, and how old the minor is changes what the
            crew does about it — the manifest's own "Minor · age N" capsule,
            the same fact in the same words on both surfaces (H-21). No tone
            mark: the word is the fact, and this surface draws its marks
            rather than typing them (slice 5d / decision 5). */}
        {minor && age !== null ? (
          <Badge tone="warning" size="sm" tabularNums toneMark={false}>
            {t("manifest.minorAge", { age })}
          </Badge>
        ) : null}
        {/* The one warm capsule on the ledger — drawn from the same words the
            manifest uses, subject included, since no cake glyph rides along
            to say what the timing is about (`birthdayCalloutText`). It also
            replaces the Celebrations panel that used to restate this fact
            above the roster (principle 9: say it once, on the person). */}
        {birthday ? (
          <Badge tone="primary" size="sm">
            {birthdayCalloutText(t, birthday)}
          </Badge>
        ) : null}
      </div>
    );
    // The name line's trailing capsules, as a list rather than a fragment so
    // the slot can tell when it has nothing to hold. `Children.toArray` drops
    // every `null` below, the same question `FormStatus` asks of its children.
    // A cleared seat with no notes and no arrival is the common row, and it
    // used to render the slot's wrapper empty: the pixel probe found that
    // `div` taking the line's 12px gap on every such row of ten trip
    // captures, and on a phone wrapping to a line of its own whose 4px row gap
    // put the name 2px above the row's centre.
    //
    // **The verdict leads a phone's line and ends a wide one** (K-364). It is
    // first here, so where the capsules wrap under the name on a phone and
    // start on its column (K-278) the verdict stands on that column, and a
    // screen reader hears it before the chips; from `sm` the capsules sit at
    // the line's end and `sm:order-last` puts it against the mark, so
    // "Blocked" keeps one x whether a "Depth advisory" chip rides with it or
    // not (it moved 136px with the chip).
    const headerBadges = Children.toArray([
      // The group band already says what the rows beneath it share, so a
      // capsule here marks only this diver's own exceptional state — the
      // word, never an emoji mark (readiness vocabulary:
      // src/i18n/readiness-labels.ts; "blocked is always danger").
      //
      // `lg`: the readiness word is the one fact on this row a staffer reads
      // to decide, which principle 2's own definition makes critical text —
      // 16px, not the pill default.
      readiness && readiness.status !== "ready" ? (
        <Badge
          key="readiness"
          tone={readinessStatusTone(readiness.status)}
          toneMark={false}
          size="lg"
          className="sm:order-last"
        >
          {readinessStatusText(t, readiness.status)}
        </Badge>
      ) : null,
      // A note nobody knows exists was never written: the one-line row still
      // says there are notes to read (dive-domain review, 2026-08-21).
      !holdOpen && notes.length > 0 ? (
        <span key="notes" className="text-sm text-muted">
          {t("trips.roster.noteCount", { count: notes.length })}
        </span>
      ) : null,
      // Arrived at the counter — display only, the same capsule the manifest
      // shows. It reads existing booking state and gates nothing.
      // Not where the row's own tap already says it: with the desk open, an
      // arrived diver's row ends in "Checked in", the control that undoes it.
      booking.status === "checked_in" && !arrivalControl ? (
        <Badge key="checked-in" tone="neutral">
          {t("trips.roster.checkedInPill")}
        </Badge>
      ) : null,
      // The boat-wide advisory's mark on this diver — the group's shared
      // line above carries the sentence once.
      depthShared ? (
        <Badge key="depth" tone="warning" size="sm">
          {t("trips.roster.depthChip")}
        </Badge>
      ) : null,
    ]);
    // Staff record or correct a contact from the same form wherever it is
    // rendered — in the open when the seat has none (that is work), behind
    // the disclosure when it does (that is reference).
    const contactForm = (
      <form
        action={saveEmergencyContactAction}
        className="mt-2 flex max-w-md flex-col gap-3 rounded-lg border border-border bg-surface-sunken/50 p-3"
      >
        <input type="hidden" name="bookingId" value={booking.id} />
        <FieldGrid columns={2}>
          <Field label={t("trips.roster.emergencyContactNameLabel")}>
            <input
              name="emergencyContactName"
              autoComplete="name"
              maxLength={120}
              defaultValue={person.emergencyContactName ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label={t("trips.roster.emergencyContactPhoneLabel")}>
            <input
              name="emergencyContactPhone"
              type="tel"
              autoComplete="tel"
              maxLength={40}
              defaultValue={person.emergencyContactPhone ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <div>
          <SubmitButton
            pendingLabel={t("trips.roster.savingContact")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("trips.roster.saveEmergencyContact")}
          </SubmitButton>
        </div>
      </form>
    );
    const emergencyContactForm = (
      <CompactDisclosureRow
        className="mt-1"
        bodyClassName="mt-0"
        label={
          hasEmergencyContact
            ? t("trips.roster.emergencyContactEdit")
            : t("trips.roster.emergencyContactAddFull")
        }
        // A refused save comes back to the form, not to its closed label.
        holdOpen={holdOpen && !hasEmergencyContact}
      >
        {contactForm}
      </CompactDisclosureRow>
    );
    // One fact, on file or not, with its form under it: a missing contact is
    // also a reason line under the name, so the fact says only "Not on file".
    const emergencyContactBlock = (
      <div>
        <GroupLabel as="p">{t("trips.roster.emergencyContactHeading")}</GroupLabel>
        {hasEmergencyContact ? (
          <p className="mt-1 text-sm text-muted">
            {t("trips.roster.emergencyContactOnFile", {
              name: person.emergencyContactName ?? "",
              phone: person.emergencyContactPhone ?? "",
            })}
          </p>
        ) : (
          <p className="mt-1 text-sm font-medium text-warning-strong">
            {t("trips.roster.emergencyContactMissing")}
          </p>
        )}
        {emergencyContactForm}
      </div>
    );

    /**
     * **The flagged medical answer**, the one piece of a row's work that never
     * folds away: it must be read before the diver boards, so it stands under
     * the name on every visit while everything else waits behind the row.
     */
    // **With the desk open, the screen faces the queue** (issue #716;
    // dive-domain review 2026-10-05). The hold's status word and instruction
    // stay in the open, because they are what a crew must read before the
    // diver boards; *which* questions were answered yes — health data about
    // the person at the desk — waits behind the row's mark, with the money
    // owed, a long gap since the last dive, and a returning diver's own ask.
    const openPrompts = arrival ? [] : flaggedPrompts;
    const medicalHold = (
      <>
        {/* What this diver asked for when they said they were easing back, in
            the open. A fact beside a name in a muted tone — no warning
            colour, no mark that means careful:
            a diver getting comfortable again is a diver the shop is ready for.
            What this seat *came for* is deliberately not here; the crew reads
            that as the departure's count on the team builder, never as a row
            per person (#1183's boundary). */}
        {booking.reEntryAsk && !arrival ? (
          <p className={`mt-3 ${INSET_NOTE_CLASS}`}>{t(STAFF_RE_ENTRY_KEYS[booking.reEntryAsk])}</p>
        ) : null}
        {/* Safety-critical and never disclosed: a flagged medical answer is
            the one thing on this row that must be read before the diver
            boards. It carries the **status word** as well as the instruction
            (caught by waivers.spec.ts). */}
        {waiverStatus === "medical_review" || waiverStatus === "medical_not_cleared" ? (
          <div
            className={`mt-3 rounded-lg px-3 py-2 text-sm ${
              waiverStatus === "medical_not_cleared"
                ? "bg-danger-tint text-danger-strong"
                : "bg-warning-tint text-warning-strong"
            }`}
          >
            <p className="font-semibold">{waiverControl.label}</p>
            <p className="mt-0.5 font-medium">
              {/* The hold reads "follow up before boarding" because somebody
                  still can. A refusal has nobody left to follow up with, and
                  saying so is the whole of issue #1283 at the rail. */}
              {t(
                waiverStatus === "medical_not_cleared"
                  ? "trips.roster.notClearedBeforeBoarding"
                  : "trips.roster.followUpBeforeBoarding",
              )}
            </p>
            {openPrompts.length > 0 ? (
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
                {openPrompts.map((prompt) => (
                  <li key={prompt}>{prompt}</li>
                ))}
              </ul>
            ) : waiverStatus === "medical_review" ? (
              // Only while the answer is still outstanding. This sentence ends
              // "confirm physician clearance before boarding", which under a
              // recorded refusal contradicts the line directly above it and
              // tells a crew member to go looking for a clearance that has
              // already been refused (caught by looking at the row).
              <p className="mt-1">{t("trips.roster.medicalFollowUpDescription")}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-4">
              {currentWaiver ? (
                <Link
                  // The whole waiver surface is one page now (ADR
                  // 20260827-people-not-lists): `?record=` pins the row first
                  // inside its own day group, and the fragment is what opens it
                  // and scrolls past the release editor.
                  href={`/shop/${shopSlug}/waivers?record=${currentWaiver.id}#waiver-record-${currentWaiver.id}`}
                  className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline"
                >
                  {t("trips.roster.viewSignedRecord")}
                </Link>
              ) : null}
              {/* The way out, which this panel did not have. A diver hands the
                  doctor's letter to whoever is at the rail, and until #1252
                  every dock surface pointed them at a page where the hold
                  could be read and not resolved. The act itself lives on the
                  diver's record, because a clearance is a fact about the
                  person rather than about Saturday's boat.

                  Not drawn once the answer has arrived: the record has nowhere
                  for a second one to go, and offering the door anyway sends a
                  staffer to a form that is no longer there. */}
              {waiverStatus === "medical_review" ? (
                <Link
                  href={`/shop/${shopSlug}/divers/${person.id}#waiver`}
                  className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline"
                >
                  {t("trips.roster.recordPhysicianClearance")}
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </>
    );
    /**
     * **The row's lines of why** (owner, 2026-10-05: the Divers tab read as a
     * wall of open panels). Every sentence a seat with work left has to say —
     * what stops them boarding, then what is worth a word before they do —
     * stands under the name as one plain line each, with no tinted box; the
     * fixes for them wait behind the row's own control. Danger for a blocker,
     * warning for an advisory. Membership is by kind, never by value, so the
     * panel below never repeats a sentence said here.
     */
    const recencyText = diveRecencyIsNotable(booking.lastDivedBand)
      ? diveRecencyText(t, booking.lastDivedBand)
      : null;
    const reasonLines: { key: string; text: string; tone: "danger" | "warning" }[] = [
      ...blockerTexts.map(({ text }) => ({ key: text, text, tone: "danger" as const })),
      ...(depthText !== null && !depthShared
        ? [{ key: "depth", text: depthText, tone: "warning" as const }]
        : []),
      ...(drysuitCard.status !== "ok"
        ? [
            {
              key: "drysuit",
              text: drysuitCardWarningText(t, drysuitCard),
              tone: "warning" as const,
            },
          ]
        : []),
      ...(recencyText !== null
        ? [{ key: "recency", text: recencyText, tone: "warning" as const }]
        : []),
      // A seat whose readiness is clear can still be filed under "Still to
      // clear" by its paperwork or its money, and a row in that group with no
      // stated reason trains a crew to stop reading the group (dive-domain
      // review 2026-10-05). A waiver blocker already says the first; this is
      // for the seat no blocker speaks for.
      ...(waiverControl.action !== null && blockerTexts.length === 0
        ? [
            {
              key: "waiver",
              text: t("trips.roster.reasonWaiverNotSigned"),
              tone: "warning" as const,
            },
          ]
        : []),
      ...(requiresPayment &&
      paymentStatus !== "paid" &&
      paymentStatus !== "waived" &&
      paymentStatus !== "partly_refunded"
        ? [{ key: "payment", text: t("trips.roster.reasonUnpaid"), tone: "warning" as const }]
        : []),
      // Withheld on an unconfirmed row in both directions: the contact is the
      // matched person's own record (`showsPersonDetail`).
      ...(!hasEmergencyContact && showsPersonDetail
        ? [
            {
              key: "contact",
              text: `${t("trips.roster.emergencyContactHeading")} · ${t("trips.roster.emergencyContactMissing")}`,
              tone: "warning" as const,
            },
          ]
        : []),
    ];
    // Each line's mark is its first column, one line of the words tall, so it
    // centres on their first line whatever wraps below it (K-494).
    /**
     * **A held seat's two answers stand in the open, under its reason line**
     * (Aaron, 2026-10-05). The seat attached itself to an existing diver on
     * something short of proof — a reused email under a different name
     * (H-13), or a name tapped off the counter's prompt (issue #1556) — and
     * the reason line names both people. "Same person" is a blocking confirm,
     * not an undo banner: it hands the matched diver's cards and waiver to
     * this seat (docs/design/principles.md §7). "Different person" splits the
     * seat into its own record. Like the medical hold, it is a decision about
     * who may board, so it does not wait behind the row's mark.
     */
    const identityCheck = identityUnconfirmed ? (
      <IdentityCheck
        bookingId={booking.id}
        bookedAs={booking.identityBookedAs}
        words={identityCheckWords(t, person.fullName)}
        splitAction={splitIdentityAction}
        className="pb-3"
        confirm={
          <form action={confirmIdentityAction}>
            <input type="hidden" name="bookingId" value={booking.id} />
            <InlineConfirm
              triggerLabel={t("shared.identityCheck.same")}
              ariaLabel={t("shared.identityCheck.sameAria", { name: person.fullName })}
              message={t("trips.roster.confirmIdentityMessage", { name: person.fullName })}
              confirmLabel={t("trips.roster.identityConfirmButton")}
              cancelLabel={t("trips.roster.neverMind")}
              pendingLabel={t("trips.roster.confirming")}
              triggerClassName={buttonClass({ variant: "secondary", size: "sm" })}
            />
          </form>
        }
      />
    ) : null;
    const privateAtDesk = (key: string) =>
      Boolean(arrival) && (key === "payment" || key === "recency");
    const openReasonLines = reasonLines.filter(({ key }) => !privateAtDesk(key));
    const deskPrivateLines = reasonLines.filter(({ key }) => privateAtDesk(key));
    const reasonList =
      openReasonLines.length === 0 ? null : (
        <ul className="-mt-1 grid gap-1 pb-2 text-sm">
          {openReasonLines.map(({ key, text, tone }) => (
            <li
              key={key}
              className={`flex items-baseline gap-2 ${
                tone === "danger" ? "text-danger" : "text-warning-strong"
              }`}
            >
              <StatusMarkColumn variant={tone} />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      );
    /**
     * **Work**: the fix for everything this seat still owes, behind the row's
     * own mark — the sentences themselves are the reason lines under the name
     * (owner, 2026-10-05). Membership is decided by the kind of thing, never
     * by its current value, so a control can never leave from under the
     * finger that used it: payment, the contact form and the notes stay put in
     * both states, and a form that just answered holds its row open.
     */
    const outstanding = (
      <>
        {deskPrivateLines.length > 0 ? (
          <ul className="mt-2 grid gap-1 text-sm">
            {deskPrivateLines.map(({ key, text }) => (
              <li key={key} className="flex items-baseline gap-2 text-warning-strong">
                <StatusMarkColumn variant="warning" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {arrival && booking.reEntryAsk ? (
          <p className={`mt-3 ${INSET_NOTE_CLASS}`}>{t(STAFF_RE_ENTRY_KEYS[booking.reEntryAsk])}</p>
        ) : null}
        {arrival && flaggedPrompts.length > 0 ? (
          <div className="mt-3 text-sm">
            <GroupLabel as="p">{waiverControl.label}</GroupLabel>
            <ul className="mt-1 flex list-disc flex-col gap-1 ps-4">
              {flaggedPrompts.map((prompt) => (
                <li key={prompt}>{prompt}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {blockerTexts.length > 0 ? (
          <>
            {/* Every named problem carries its handle. The waiver, payment,
                and identity blockers already do — their controls are on this
                row — but a certification-family blocker's fix lives on the
                diver's record (design review 2026-08-21).

                Its 44px box carries 12px nobody sees under the words, and the
                next line's `mt-3` stacked on it: 45px of air between two text
                lines (K-551). `-mb-3 align-bottom` gives that half back, as
                `buttonClass`'s `outdent` does for a quiet button, so the next
                line's box meets this one's and the target stays whole. */}
            {blockerTexts.some(
              ({ blocker }) => BLOCKER_CATEGORY[blocker.code] === "certification",
            ) ? (
              <Link
                href={`/shop/${shopSlug}/divers/${person.id}#cards`}
                className="mt-2 -mb-3 inline-flex min-h-11 items-center align-bottom text-sm font-semibold text-primary hover:underline print:hidden"
              >
                {t("trips.roster.reviewCertificationsLink")}
              </Link>
            ) : null}
          </>
        ) : null}

        {/* The one path from "this shop taught and ran this course" to a card
            row (issues #717 and #975) — a per-student tap, collapsed by
            default. Present only on a course session's own roster. */}
        {certifyDiverAction ? (
          <details className="mt-3">
            <summary
              className={buttonClass({
                variant: "secondary",
                size: "sm",
                className: "cursor-pointer list-none",
              })}
            >
              {t("trips.roster.certifyDiver")}
            </summary>
            <FieldGrid
              as="form"
              action={certifyDiverAction}
              columns={1}
              className="mt-2 gap-y-3 sm:w-72"
            >
              <input type="hidden" name="bookingId" value={booking.id} />
              <input type="hidden" name="personId" value={person.id} />
              <Field
                label={t("trips.roster.certifyLevel")}
                description={t("trips.roster.certifyLevelHint")}
              >
                <select name="award" className={controlClass}>
                  <optgroup label={t("trips.roster.certifyLevelGroup")}>
                    {Object.entries(CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
                      <option key={value} value={value}>
                        {t(key)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={t("trips.roster.certifySpecialtyGroup")}>
                    {Object.entries(SPECIALTY_KEYS).map(([value, key]) => (
                      <option key={value} value={value}>
                        {t(key)}
                      </option>
                    ))}
                    <option value="nitrox">{t("trips.roster.certifyNitrox")}</option>
                  </optgroup>
                </select>
              </Field>
              <SubmitButton
                pendingLabel={t("trips.roster.certifying")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("trips.roster.certifyConfirm")}
              </SubmitButton>
            </FieldGrid>
          </details>
        ) : null}

        {/* What this student does next, written once and read on their recap
            (issues #1196, #1205). Beside the card above and under the same
            condition: both are things only a course session's instructor has
            to say, and neither is offered on a fun dive. */}
        {saveCourseNextStepAction ? (
          <details className="mt-3">
            <summary
              className={buttonClass({
                variant: "secondary",
                size: "sm",
                className: "cursor-pointer list-none",
              })}
            >
              {t("trips.roster.nextStepSummary")}
            </summary>
            <FieldGrid
              as="form"
              action={saveCourseNextStepAction}
              columns={1}
              className="mt-2 gap-y-3 sm:w-72"
            >
              <input type="hidden" name="bookingId" value={booking.id} />
              <Field
                label={t("trips.roster.nextStepLabel")}
                description={t("trips.roster.nextStepDescription")}
              >
                <textarea
                  name="note"
                  rows={2}
                  maxLength={280}
                  defaultValue={courseNextStepByBooking?.get(booking.id) ?? ""}
                  className={textareaClassFor(2)}
                />
              </Field>
              <SubmitButton
                pendingLabel={t("trips.roster.nextStepSaving")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("trips.roster.nextStepSave")}
              </SubmitButton>
            </FieldGrid>
          </details>
        ) : null}

        {/* The waiver, when there is one to send. The control's own face is
            the status and its label is the next action; a signed waiver has
            no control at all — its date line is reference, in the panel. */}
        {waiverControl.action ? (
          <div className="mt-3">
            <WaiverSendControl
              surface="roster"
              tripId={tripId}
              bookingIds={[booking.id]}
              label={waiverControl.label}
              hint={waiverControl.hint}
              pendingLabel={
                waiverControl.action === "send"
                  ? t("trips.roster.sending")
                  : t("trips.roster.resending")
              }
              confirmMessage={
                waiverControl.confirm
                  ? t("trips.roster.confirmResendWaiver", { name: person.fullName })
                  : undefined
              }
              className={buttonClass({ variant: waiverControl.variant, size: "sm" })}
              wrapperClassName=""
              copy={waiverSendCopy(t)}
            />
            {/* A diver who signed on paper or on shore: let a non-diver
                record it so the waiver gate isn't held up by a signature the
                app never sees. */}
            <PaperWaiverControl
              action={markWaiverInPersonAction}
              bookingId={booking.id}
              copy={paperWaiverCopy(t, "roster")}
              requiresGuardian={requiresGuardian}
              // A diver is standing at this departure, so the staffer here can
              // truthfully say they watched both a namesake parent and child
              // sign — the counter is the other such door, the diver's record
              // deliberately not one.
              offersNamesake
              // Drawn on this row's own refusal, or on a page notice that
              // named this booking, and on no other minor on the boat.
              noticedNamesake={namesakeRefused}
              // A page-level notice that landed the staffer back here reopens
              // the form; a refusal of this form no longer navigates at all.
              defaultOpen={namesakeRefused}
              // The fallback under the row's leading action reads in quiet
              // ink — a teal link out-shouted the bordered send pill above it
              // (design review 2026-08-29).
              variant="ghost"
            />
          </div>
        ) : null}

        {/* Whenever this departure takes money — never relocated by what the
            status happens to be, so the control a staffer just used to mark a
            seat Paid cannot vanish into a collapsed panel at the instant it
            lands. */}
        {requiresPayment ? (
          <div className="mt-3">
            <PaymentStatusControl
              bookingId={booking.id}
              status={paymentStatus ?? "unpaid"}
              action={markPaymentAction}
              allowedStatuses={
                mayWriteOffPayment ? PAYMENT_STATUSES_ALL : PAYMENT_STATUSES_RECORDING_ONLY
              }
              sourceNote={paymentSource}
              refundNote={
                refundEligible && cancellationDeadline
                  ? t("trips.roster.refundEligibleUntil", {
                      date: formatDateTimeTz(cancellationDeadline, locale, shopTimezone),
                    })
                  : null
              }
              copy={paymentStatusCopy}
            />
          </div>
        ) : null}
      </>
    );

    // Whether the panel's first band has anything in it — every condition
    // `outstanding` draws on, so an empty band never leaves its rule behind.
    const certificationBlocked = blockerTexts.some(
      ({ blocker }) => BLOCKER_CATEGORY[blocker.code] === "certification",
    );
    const hasWork =
      deskPrivateLines.length > 0 ||
      Boolean(arrival && booking.reEntryAsk) ||
      Boolean(arrival && flaggedPrompts.length > 0) ||
      certificationBlocked ||
      Boolean(certifyDiverAction) ||
      Boolean(saveCourseNextStepAction) ||
      waiverControl.action !== null ||
      requiresPayment;

    /**
     * **Reference**: what is merely true about this seat, one tap away.
     */
    const reference = (
      <>
        {/* The seat's own identity facts: the roster is scanned by name and
            state, and the email — with an adult's age beside it — is
            reference the moment it is needed, not a second line on every
            row. */}
        {showsPersonDetail ? null : (
          // Said, not silently blank: a panel with no contact and no sizes
          // reads as a diver who has none, which is a wrong fact rather than
          // an absent one. The confirm control is in the work above.
          <p className="mb-4 text-sm text-muted">{t("trips.roster.identityWithheldDetails")}</p>
        )}
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {/* Who this is, first: the roster is scanned by name and state, and
              the email, with an adult's age, is the fact a desk reads back. */}
          {showsPersonDetail ? (
            <div>
              <GroupLabel as="p">{t("trips.roster.diverColumnHeading")}</GroupLabel>
              <p className="mt-1 text-sm text-muted">
                <span className="[overflow-wrap:anywhere]">
                  {person.email ?? t("trips.roster.noEmailOnFile")}
                </span>
                {age !== null ? (
                  <span className="tabular-nums">
                    {" · "}
                    {t("trips.roster.ageYears", { age })}
                  </span>
                ) : null}
              </p>
            </div>
          ) : null}
          {/* The signed waiver's own evidence — when, and by which route —
              and nothing else. Every state that is *not* signed already says
              so under the name (principle 9). */}
          {showsPersonDetail && currentWaiver?.completedAt && waiverStatus === "complete" ? (
            <div>
              <GroupLabel as="p">{t("trips.roster.waiverColumnHeading")}</GroupLabel>
              <p className="mt-1 text-sm text-muted">
                {currentWaiver.signatureMethod === "in_person_attested"
                  ? t("trips.roster.signedPaper", {
                      date: formatDateTimeTz(currentWaiver.completedAt, locale, shopTimezone),
                    })
                  : currentWaiver.signatureMethod === "imported"
                    ? t("trips.roster.signedImported", {
                        date: formatDateTimeTz(currentWaiver.completedAt, locale, shopTimezone),
                      })
                    : t("trips.roster.signedPlain", {
                        date: formatDateTimeTz(currentWaiver.completedAt, locale, shopTimezone),
                      })}
              </p>
              {/* A minor's release names who co-signed it (ADR
                  20260907-guardian-co-signature) — the same sentence the
                  manifest and the signature log use. */}
              {guardian ? (
                <p className="mt-1 text-sm text-muted">{guardianCoSignedText(t, guardian)}</p>
              ) : null}
            </div>
          ) : null}

          {/* Sizes are the matched person's profile row and the nitrox word
              is their card, so the whole column waits for the confirmation. */}
          {showsPersonDetail ? (
            <div>
              <GroupLabel as="p">{t("trips.roster.rentalFitColumnHeading")}</GroupLabel>
              <p className="mt-1 text-sm text-muted">
                {rentalFitLineText(
                  t,
                  locale,
                  rentalFitLine(rentalFitByBooking.get(booking.id) ?? null, shopRentalItems),
                )}
              </p>
              {nitrox ? (
                <p className="mt-1 text-sm font-medium text-primary">
                  {nitrox.approved
                    ? t("trips.roster.nitroxApproved")
                    : t("trips.roster.nitroxUnverified")}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* A contact already on file: a fact about the seat, which is what
              this panel is for. Only this state appears here — a missing one
              is a reason line under the name (principle 9). */}
          {showsPersonDetail ? emergencyContactBlock : null}

          {/* The full per-diver list, only when the reason lines compressed
              part of it into a count. */}
          {depthShared && depthText !== null ? (
            <div>
              <GroupLabel as="p">{t("trips.roster.depthChip")}</GroupLabel>
              <p className="mt-1 text-sm text-muted">{depthText}</p>
            </div>
          ) : null}

          {/* Hotel pickup / lodging details */}
          <div>
            <GroupLabel as="p">{t("trips.roster.hotelPickupHeading")}</GroupLabel>
            {booking.hotelPickupLocation || booking.pickupTime ? (
              <p className="mt-1 text-sm text-muted">
                {booking.hotelPickupLocation ?? t("trips.roster.hotelNotSpecified")}
                {booking.pickupTime ? ` · ${booking.pickupTime}` : ""}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted">{t("trips.roster.noPickupScheduled")}</p>
            )}
            {updatePickupAction ? (
              <CompactDisclosureRow
                className="mt-1"
                bodyClassName="mt-0"
                label={
                  booking.hotelPickupLocation || booking.pickupTime
                    ? t("trips.roster.editPickup")
                    : t("trips.roster.setPickup")
                }
              >
                <form
                  action={updatePickupAction.bind(null, booking.id)}
                  className="mt-2 flex max-w-md flex-col gap-2 rounded-lg border border-border bg-surface-sunken/50 p-2"
                >
                  <FieldGrid columns={2}>
                    <Field label={t("trips.roster.pickupLocationLabel")}>
                      <input
                        name="hotelPickupLocation"
                        maxLength={300}
                        defaultValue={booking.hotelPickupLocation ?? ""}
                        placeholder={t("trips.roster.pickupLocationPlaceholder")}
                        className={controlClass}
                      />
                    </Field>
                    <Field label={t("trips.roster.pickupTimeLabel")}>
                      <input
                        name="pickupTime"
                        maxLength={20}
                        defaultValue={booking.pickupTime ?? ""}
                        placeholder="07:15"
                        className={controlClass}
                      />
                    </Field>
                  </FieldGrid>
                  <div>
                    <SubmitButton
                      pendingLabel={t("trips.roster.saving")}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      {t("trips.roster.savePickup")}
                    </SubmitButton>
                  </div>
                </form>
              </CompactDisclosureRow>
            ) : null}
          </div>
        </div>

        {/* Notes, under the facts and over the seat's own actions: writing
            one is desk work a staffer starts from here. */}
        <div className="mt-5 border-t border-border pt-3">
          <CompactDisclosureRow
            bodyClassName="mt-2"
            label={
              // A zero count is the absence of information formatted as
              // information (principle 9) — with no notes the disclosure is
              // simply the door to writing the first one.
              notes.length === 0
                ? t("trips.roster.addFirstNoteSummary")
                : t("trips.roster.privateStaffNotes", { count: notes.length })
            }
          >
            <div className="grid gap-3">
              {notes.map((entry) => {
                const { note, authorName } = entry;
                return (
                  <div
                    key={note.id}
                    className={`flex items-start justify-between gap-2 ${INSET_NOTE_BOX} bg-surface-sunken`}
                  >
                    <div className="min-w-0">
                      <p className="break-words whitespace-pre-wrap">{note.body}</p>
                      <p className="mt-1 text-xs text-muted">
                        {authorName} · {formatDateTimeTz(note.createdAt, locale, shopTimezone)}
                      </p>
                    </div>
                    {entry.deletable === false ? null : (
                      <form action={deleteNoteAction} className="shrink-0">
                        <input type="hidden" name="noteId" value={note.id} />
                        {/* No confirm dialog: the delete lands and a toast
                            offers a one-tap undo — a purely reversible edit,
                            not a real send (principle 7). */}
                        <SubmitButton
                          pendingLabel={t("trips.roster.deletingEllipsis")}
                          className={buttonClass({
                            variant: "danger-ghost",
                            size: "sm",
                            busy: true,
                          })}
                        >
                          {t("trips.roster.delete")}
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                );
              })}
              {/* Keyed on the note count so a landed note empties the box. */}
              <PrivateNoteForm
                action={addNoteAction}
                hiddenFields={{ bookingId: booking.id }}
                resetKey={notes.length}
                rows={2}
                copy={{
                  label: t("trips.roster.addNoteLabel"),
                  add: t("trips.roster.addPrivateNote"),
                  adding: t("trips.roster.adding"),
                }}
              />
            </div>
          </CompactDisclosureRow>
        </div>

        {/* Whichever control comes first is `flush`, so its word sits on the
            text column every other line in this panel sits on; the 16px gap
            is the room the first one's padding used to give the second. */}
        <div className="mt-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* One orders door per row, and only when the shop can take money
                at all (principle 9 — Settings and the Orders index own the
                "Connect payments" door). */}
            {paymentsConnected ? (
              <Link
                href={`/shop/${shopSlug}/orders/new?personId=${person.id}&bookingId=${booking.id}`}
                className={buttonClass({ variant: "link", size: "sm", flush: true })}
              >
                {t("trips.roster.createOrder")}
              </Link>
            ) : null}
            {/* A cancel inside the shop's refund window fires an automatic
                Stripe refund that the Undo banner can't claw back — a real
                send of money — so this gets a blocking confirm
                (docs/design/principles.md §7). */}
            <form action={removeBookingAction}>
              <input type="hidden" name="bookingId" value={booking.id} />
              <InlineConfirm
                triggerLabel={t("trips.roster.removeBooking")}
                message={t("trips.roster.confirmRemoveBooking", { name: person.fullName })}
                confirmLabel={t("trips.roster.removeBookingConfirmButton")}
                cancelLabel={t("trips.roster.neverMind")}
                pendingLabel={t("trips.roster.removing")}
                // `danger-ghost`, which is this variant's own stated case: a
                // destructive choice among quiet siblings. On `ghost` the
                // trigger rendered as muted body text at the foot of the
                // panel, indistinguishable from the sentences above it, so
                // the one irreversible act on the row was the only thing
                // there that did not read as a control.
                triggerClassName={buttonClass({
                  variant: "danger-ghost",
                  size: "sm",
                  flush: !paymentsConnected,
                })}
                confirmClassName={buttonClass({ variant: "danger", size: "sm" })}
              />
            </form>
          </div>
        </div>
      </>
    );
    // The row's one disclosure control, pinned to the header line's trailing
    // edge in the same spot on every row. On a cleared seat its face *is* the
    // row's mark — the drawn check — so the mark and the door to the seat's
    // reference are one object rather than two trailing glyphs; a row with
    // open work wears the caret. The summary holds only the mark, so the
    // diver-name link beside it is never an interactive element nested in
    // another (axe nested-interactive); the accessible name says whose
    // details these are.
    //
    // `top-1` is the `li`'s own top padding (`py-1`), so this 44px box and the
    // header line's 44px name link share one band and the mark centres on the
    // name and the pills (K-157: a stale `top-2.5` sat it 6px low).
    const badgeCluster =
      headerBadges.length > 0 ? (
        <div className="ms-auto flex flex-wrap items-center justify-end gap-2 max-sm:ms-0 max-sm:justify-start">
          {headerBadges}
        </div>
      ) : null;
    const markSummary = (
      <summary
        aria-label={t("trips.roster.detailsSummaryLabel", { name: person.fullName })}
        className={`absolute top-1 end-2 flex size-11 cursor-pointer list-none items-center justify-center rounded-lg transition-colors [&::-webkit-details-marker]:hidden hover:bg-surface-sunken sm:end-3 ${
          settledRow && !arrivalControl ? "text-success" : "text-muted hover:text-foreground"
        }`}
      >
        {settledRow && !arrivalControl ? (
          <ReadyMark />
        ) : (
          <DisclosureCaret
            direction="down"
            className="size-4 transition-transform group-open:rotate-180"
          />
        )}
      </summary>
    );
    return (
      <li
        key={booking.id}
        // Today's queue deep-links straight to the diver it is about;
        // scroll-mt keeps the row clear of the sticky shop header.
        id={`booking-${booking.id}`}
        className="relative scroll-mt-24 px-4 py-1 sm:px-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pe-11">
          {/* From `sm`, the line's end (`ms-auto`, `justify-end`). On a
              phone, where this wraps under the name, the row's
              `justify-between` still sends an unwrapped cluster to the end,
              and a wrapped one starts on the name's column like the name's
              own wrap (K-278: it right-aligned to the mark's edge, on no
              shared edge). */}
          {arrivalControl ? (
            <>
              {/* **The desk's tap keeps the name's line at every width**: the
                  name, its chips and its capsules wrap inside their own
                  column, so "Check in" stands at the same edge, on the first
                  line, of every row a finger runs down. */}
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                {headerLeft}
                {badgeCluster}
              </div>
              <div className="shrink-0 self-start">{arrivalControl}</div>
            </>
          ) : (
            <>
              {headerLeft}
              {badgeCluster}
            </>
          )}
        </div>
        {/* **Every seat is one line** (owner, 2026-10-05). The group band says
            the state, the name line says who, the reason lines say what is in
            the way, and everything the row can do — the waiver, payment, the
            contact, notes, the reference facts — waits behind the row's mark.
            Only a flagged medical answer and a returning diver's own ask stand
            in the open beside them, with a held seat's identity answers.
            Deep links
            (Today, the manifest's "Resolve blockers") land mid-page at one
            diver; AutoOpenDetails opens on the hash, so the fold can never
            swallow what a link promised, and `holdOpen` keeps open the row a
            form on it just answered. */}
        {reasonList}
        {identityCheck}
        {medicalHold}
        {arrivalBelow}
        <AutoOpenDetails openOnHash={`booking-${booking.id}`} open={holdOpen} className="group">
          {markSummary}
          {/* **One panel per seat** (owner, 2026-10-05: "confusing and ugly").
              It used to be a loose stack — fixes, then facts, each fact with
              its own fold, a note fold, a rule and a lone Remove — read
              straight off the row's white. Now it is one sunken card: what
              the seat still needs, then what is true about it, then notes,
              then the seat's own actions, each a band of its own. */}
          <div className="mb-3 rounded-lg border border-border bg-surface-sunken/50 p-4 sm:p-5">
            {hasWork ? (
              <div className="mb-4 border-b border-border pb-4 [&>*:first-child]:mt-0">
                {outstanding}
              </div>
            ) : null}
            {reference}
          </div>
        </AutoOpenDetails>
      </li>
    );
  };

  const hasTail = waitingGroup != null || invitedGroup != null || addDiverGroup != null;
  return (
    <section
      id="roster"
      aria-label={showSummaryHeading ? undefined : t("trips.roster.heading")}
      // Compact is the departure page, whose `space-y-10` spaces this
      // (K-262); a roster rendered outside that stack keeps its own step.
      className={`${compact ? "" : "mt-10"} scroll-mt-24`}
    >
      {arrival?.instrument ? <div className="mb-10">{arrival.instrument(deskWorkOpen)}</div> : null}
      {showSummaryHeading ? (
        <div>
          <h2 className={SECTION_TITLE_CLASS}>
            {t("trips.roster.heading")}{" "}
            <span className="font-normal text-muted tabular-nums">
              {t("trips.roster.bookedOfCapacity", { booked, capacity })}
            </span>
          </h2>
          {/* The moment the last blocker clears. Nothing renders until an
            action on this page moves the count to zero — see RosterAllClear
            for why that has to be decided in the browser rather than here.
            Held back on an empty roster: "everyone is cleared" about nobody
            is not a finished thing. */}
          {roster.length > 0 ? (
            <RosterAllClear blockedCount={blockedCount} label={t("trips.roster.allClear")} />
          ) : null}
        </div>
      ) : null}
      {!showSummaryHeading && roster.length > 0 ? (
        <RosterAllClear blockedCount={blockedCount} label={t("trips.roster.allClear")} />
      ) : null}
      {roster.length > 0 || hasTail ? (
        // One ledger, not a stack of cards: everyone this departure is about,
        // in one card of hairline-ruled rows under group bands that own the
        // state words — the same object grammar as the manifest's roll call
        // and the check-in queue, so the trip tabs read as views of one
        // thing.
        <div
          className={sectionCardClass({
            padding: "none",
            className: `${compact ? "" : "mt-5"} overflow-hidden`,
          })}
        >
          {/* Inside the card, so mounting proves the rows a deep link scrolls
              to exist: a `<Link>` transition does not run the browser's own
              fragment scroll. */}
          <ScrollToHash />
          {stillToClear.length > 0 ? (
            <>
              <RosterGroupBand
                label={`${t("trips.roster.groupStillToClear")} · ${stillToClear.length}`}
              >
                {/* The facts much of the boat shares, said once in the group
                    band instead of photocopied down its rows (principle 9).
                    They move below the label on a phone so the state word keeps
                    its own readable line.

                    The band aligns its title on this column's first baseline,
                    so each line is `items-baseline` with its mark a column of
                    its own: the words set that baseline, not the mark's foot
                    (K-181: the title sat 5px under the first fact).

                    From `sm` the column sits at the band's end, put there by
                    the band's `justify-between`, but its lines start on one
                    edge so their marks form a column (K-267: right-aligned,
                    they stepped left line by line). */}
                {sharedFacts.length > 0 ? (
                  <div className="flex w-full min-w-0 flex-col gap-1 text-xs sm:w-auto sm:max-w-[68%] sm:items-start">
                    {sharedFacts.map(({ sentence, count }) => (
                      <p
                        key={sentence}
                        className="flex min-w-0 items-baseline gap-1.5 text-warning-strong"
                      >
                        <StatusMarkColumn variant="warning" />
                        <span>{t("trips.roster.sharedFactLine", { count, sentence })}</span>
                      </p>
                    ))}
                  </div>
                ) : null}
              </RosterGroupBand>
              <ul className="divide-y divide-border">
                {stillToClear.map((entry) => renderRow(entry, false))}
              </ul>
            </>
          ) : null}
          {ready.length > 0 ? (
            <>
              <RosterGroupBand label={`${t("trips.roster.groupReady")} · ${ready.length}`} />
              <ul className="divide-y divide-border">
                {ready.map((entry) => renderRow(entry, true))}
              </ul>
            </>
          ) : null}
          {here.length > 0 ? (
            <>
              <RosterGroupBand label={`${t("trips.roster.groupCheckedIn")} · ${here.length}`}>
                {/* Boarding is the group's fact, said once (principle 9): five
                    receipts each wearing "Boarded" is one word printed five
                    times. Nothing at all before anybody boards. */}
                {hereMeta ? <span className="text-xs text-muted">{hereMeta}</span> : null}
              </RosterGroupBand>
              <ul className="divide-y divide-border">
                {here.map((entry) => renderRow(entry, true))}
              </ul>
            </>
          ) : null}
          {notHere.length > 0 ? (
            <>
              <RosterGroupBand label={`${t("trips.roster.groupNotHere")} · ${notHere.length}`} />
              <ul className="divide-y divide-border">
                {notHere.map((entry) => renderRow(entry, false))}
              </ul>
            </>
          ) : null}
          {waitingGroup}
          {invitedGroup}
          {/* One box, so `#add-diver` holds the form its links and specs
              scope to; the box draws the group's rule (K-354). */}
          {addDiverGroup ? (
            // `print:hidden`: a search box and an Add button, which a printed
            // roster has no use for.
            <RosterGroup
              id="add-diver"
              label={t("trips.addDiver.heading")}
              className="print:hidden"
            >
              <div className="px-4 py-5 sm:px-5">{addDiverGroup}</div>
            </RosterGroup>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
