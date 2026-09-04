import Link from "next/link";
import type { ReactNode } from "react";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { PrivateNoteForm } from "@/components/PrivateNoteForm";
import { paperWaiverCopy } from "@/components/paper-waiver-copy";
import { ScrollToHash } from "@/components/ScrollToHash";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { CompactDisclosureRow } from "@/components/ui/disclosure";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { GroupLabel } from "@/components/ui/ledger";
import { StatusMark } from "@/components/ui/StatusMark";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { listBookingNotes } from "@/db/operations";
import { birthdayCalloutText } from "@/i18n/birthday-labels";
import { depthWarningText } from "@/i18n/depth-labels";
import {
  CERTIFICATION_LEVEL_KEYS,
  diveRecencyText,
  readinessBlockerText,
  readinessStatusText,
  readinessStatusTone,
  SPECIALTY_KEYS,
} from "@/i18n/readiness-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { ageOnDate, birthdayCallout, isMinorOnDate } from "@/lib/age";
import type { CalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { DepthUnit } from "@/lib/depth-units";
import { rentalFitLine } from "@/lib/dive-prep";
import { diveRecencyIsNotable } from "@/lib/dive-recency";
import { formatDateTimeTz } from "@/lib/format";
import { flaggedMedicalPrompts } from "@/lib/medical";
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
import { RosterGroupBand } from "./RosterGroupBand";
import { SHARED_FACT_MIN, UNGROUPABLE_BLOCKER_CODES } from "./shared-facts";
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

type RosterPrivateNote = Awaited<ReturnType<typeof listBookingNotes>>[number] & {
  /** Diver-record notes are visible here but remain editable on their canonical page. */
  deletable?: boolean;
};

// The whole waiver collapses to a single control per diver. Its face is the
// status; its click is the only sensible next action. `action: null` means the
// waiver is signed and there is nothing left to do — it renders as a static pill.
type WaiverControl = {
  label: string;
  hint?: string;
  tone: string;
  action: "send" | "resend" | null;
  confirm: boolean;
};

type WaiverControlKeys = {
  labelKey: StaffMessageKey;
  hintKey?: StaffMessageKey;
  tone: string;
  action: "send" | "resend" | null;
  confirm: boolean;
};

const WAIVER_CONTROL_KEYS: Record<ReturnType<typeof waiverState>, WaiverControlKeys> = {
  not_sent: {
    labelKey: "trips.roster.waiverSend",
    tone: "border border-border bg-surface hover:bg-surface-sunken",
    action: "send",
    confirm: false,
  },
  awaiting_signature: {
    labelKey: "trips.roster.waiverSent",
    hintKey: "trips.roster.waiverResendHint",
    tone: "border border-border bg-surface hover:bg-surface-sunken",
    action: "resend",
    confirm: true,
  },
  expired: {
    labelKey: "trips.roster.waiverLinkExpired",
    tone: "border border-danger/40 text-danger hover:bg-danger-tint",
    action: "resend",
    confirm: false,
  },
  complete: {
    labelKey: "trips.roster.waiverSigned",
    tone: "bg-success-tint text-success-strong",
    action: null,
    confirm: false,
  },
  medical_review: {
    labelKey: "trips.roster.waiverMedicalReview",
    tone: "bg-warning-tint text-warning-strong",
    action: null,
    confirm: false,
  },
  // Danger where the review above it is warning: a hold might still clear, and
  // this one will not. `action: null` for the same reason as `complete` —
  // there is no next tap here, and a refusal is the one waiver state where
  // sending another link would be the wrong thing to offer (issue #1283).
  medical_not_cleared: {
    labelKey: "trips.roster.waiverMedicalNotCleared",
    tone: "bg-danger-tint text-danger-strong",
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
  nitroxByBooking,
  requiresPayment,
  paymentsConnected,
  cancellationDeadline,
  markWaiverInPersonAction,
  markPaymentAction,
  mayWriteOffPayment,
  removeBookingAction,
  confirmIdentityAction,
  notesByBooking,
  addNoteAction,
  deleteNoteAction,
  saveEmergencyContactAction,
  certifyDiverAction,
  updatePickupAction,
  // Accepted for interface parity with callers/DepthUnit plumbing elsewhere
  // on this page, but `depthWarningText` already embeds its own unit
  // formatting — nothing in this component needs it directly.
  depthUnit: _depthUnit,
  tripDate,
  keepOpenBookingId,
  waitingGroup,
  invitedGroup,
  addDiverGroup,
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
  readinessByBooking: ReadinessByBooking;
  waiverByBooking: WaiverByBooking;
  rentalFitByBooking: RentalFitByBooking;
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
  markWaiverInPersonAction: (formData: FormData) => void;
  markPaymentAction: (formData: FormData) => void;
  /**
   * Whether this staffer may set `waived` or `refunded` — a decision about
   * money rather than a record of it, gated by `canRefund` everywhere else
   * (issue #714). Recording counter cash stays open to the whole crew.
   */
  mayWriteOffPayment: boolean;
  removeBookingAction: (formData: FormData) => void;
  confirmIdentityAction: (formData: FormData) => void;
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
        label: t(entry.labelKey),
        hint: entry.hintKey ? t(entry.hintKey) : undefined,
        tone: entry.tone,
        action: entry.action,
        confirm: entry.confirm,
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

  // A blocker or depth advisory whose sentence renders identically for much
  // of the boat is one fact about the trip, not N facts about N divers
  // (principle 9): it renders once, under the group band, and each affected
  // row keeps a one-line count plus its full list in the reference panel.
  const blockerSentenceCounts = new Map<string, number>();
  const advisorySentenceCounts = new Map<string, number>();
  for (const { booking } of roster) {
    const row = readinessByBooking.get(booking.id);
    if (row?.readiness && row.readiness.status !== "ready") {
      for (const blocker of row.readiness.blockers) {
        if (UNGROUPABLE_BLOCKER_CODES.has(blocker.code)) continue;
        const text = readinessBlockerText(t, blocker);
        blockerSentenceCounts.set(text, (blockerSentenceCounts.get(text) ?? 0) + 1);
      }
    }
    if (row?.depthAdvisory?.status === "exceeds") {
      const text = depthWarningText(t, row.depthAdvisory);
      advisorySentenceCounts.set(text, (advisorySentenceCounts.get(text) ?? 0) + 1);
    }
  }
  const sharedBlockerTexts = new Set(
    [...blockerSentenceCounts]
      .filter(([, count]) => count >= SHARED_FACT_MIN)
      .map(([sentence]) => sentence),
  );
  const sharedAdvisoryTexts = new Set(
    [...advisorySentenceCounts]
      .filter(([, count]) => count >= SHARED_FACT_MIN)
      .map(([sentence]) => sentence),
  );
  const sharedFacts = [
    ...[...blockerSentenceCounts]
      .filter(([sentence]) => sharedBlockerTexts.has(sentence))
      .map(([sentence, count]) => ({ sentence, count, tone: "danger" as const })),
    ...[...advisorySentenceCounts]
      .filter(([sentence]) => sharedAdvisoryTexts.has(sentence))
      .map(([sentence, count]) => ({ sentence, count, tone: "warning" as const })),
  ];

  /**
   * Which group a seat files under. The predicate is the old collapsed-row
   * rule unchanged: a seat is settled when nothing on it still needs a
   * staffer — readiness clear, waiver signed with no medical hold, identity
   * confirmed, an emergency contact on file, no buddy request to read, no
   * advisory particular to this diver, and the money recorded.
   */
  const isSettled = ({ booking, person }: RosterEntry): boolean => {
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
    const depth = readinessByBooking.get(booking.id)?.depthAdvisory;
    const depthText = depth?.status === "exceeds" ? depthWarningText(t, depth) : null;
    const depthShared = depthText !== null && sharedAdvisoryTexts.has(depthText);
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
      !booking.groupPreference &&
      (depthText === null || depthShared) &&
      // Currency informs, never gates (ADR 20260821-currency-is-what-catches-
      // people) — but a warning filed under "Ready" is a warning nobody reads
      // (dive-domain review 2026-08-21).
      !diveRecencyIsNotable(booking.lastDivedBand) &&
      paymentSettled
    );
  };

  const stillToClear = roster.filter((entry) => !isSettled(entry));
  const ready = roster.filter((entry) => isSettled(entry));
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
    const flaggedPrompts =
      (waiverStatus === "medical_review" || waiverStatus === "medical_not_cleared") &&
      currentWaiver?.medicalAnswers
        ? flaggedMedicalPrompts(currentWaiver.medicalAnswers)
        : [];
    const nitrox = nitroxByBooking.get(booking.id);
    const identityUnconfirmed = Boolean(
      readiness?.blockers.some((blocker) => blocker.code === "identity_unconfirmed"),
    );
    // Age is shown only when the shop actually holds a date of birth — no
    // date, no line, rather than an "unknown" that reads as a gap to fill on
    // every diver who has never been asked (H-21).
    const dateOfBirth = person.dateOfBirth;
    const age = dateOfBirth ? ageOnDate(dateOfBirth, tripDate) : null;
    const minor = dateOfBirth ? isMinorOnDate(dateOfBirth, tripDate) : false;
    const birthday = birthdayCallout(dateOfBirth, tripDate);
    const hasEmergencyContact = Boolean(
      person.emergencyContactName && person.emergencyContactPhone,
    );
    // A warning, never a gate: the site goes deeper than this diver's
    // training, which an instructor may well have already planned around
    // (H-08). It sits apart from the blocker list for that reason.
    const depth = readinessByBooking.get(booking.id)?.depthAdvisory;
    const notes = notesByBooking.get(booking.id) ?? [];
    // This row's blockers, split against the group's shared lines above: the
    // sentences the group already states for much of the boat shrink to a
    // one-line count here, the ones particular to this diver keep their full
    // sentence, and the complete per-diver list waits in the reference panel.
    const blockerTexts =
      readiness && readiness.status !== "ready"
        ? readiness.blockers.map((blocker) => ({
            blocker,
            text: readinessBlockerText(t, blocker),
          }))
        : [];
    const uniqueBlockers = blockerTexts.filter(
      ({ blocker, text }) =>
        UNGROUPABLE_BLOCKER_CODES.has(blocker.code) || !sharedBlockerTexts.has(text),
    );
    const sharedBlockerCount = blockerTexts.length - uniqueBlockers.length;
    const depthText = depth?.status === "exceeds" ? depthWarningText(t, depth) : null;
    const depthShared = depthText !== null && sharedAdvisoryTexts.has(depthText);
    const holdOpen = keepOpenBookingId === booking.id;

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
    // Arrived at the counter — display only, the same capsule the manifest
    // shows. It reads existing booking state and gates nothing.
    const headerBadges = (
      <>
        {/* A note nobody knows exists was never written: the settled one-line
            row still says there are notes to read (dive-domain review,
            2026-08-21). An unsettled row's open half already shows the notes
            disclosure itself. */}
        {settledRow && !holdOpen && notes.length > 0 ? (
          <span className="text-sm text-muted">
            {t("trips.roster.privateStaffNotes", { count: notes.length })}
          </span>
        ) : null}
        {booking.status === "checked_in" ? (
          <Badge tone="neutral">{t("trips.roster.checkedInPill")}</Badge>
        ) : null}
        {/* The group band already says what the rows beneath it share, so a
            capsule here marks only this diver's own exceptional state — the
            word, never an emoji mark (readiness vocabulary:
            src/i18n/readiness-labels.ts; "blocked is always danger"). */}
        {readiness && readiness.status !== "ready" ? (
          // `lg`: the readiness word is the one fact on this row a staffer
          // reads to decide, which principle 2's own definition makes
          // critical text — 16px, not the pill default.
          <Badge tone={readinessStatusTone(readiness.status)} toneMark={false} size="lg">
            {readinessStatusText(t, readiness.status)}
          </Badge>
        ) : null}
        {/* The boat-wide advisory's mark on this diver — the group's shared
            line above carries the sentence once. */}
        {depthShared ? (
          <Badge tone="warning" size="sm">
            {t("trips.roster.depthChip")}
          </Badge>
        ) : null}
      </>
    );
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
        label={t("trips.roster.emergencyContactEdit")}
      >
        {contactForm}
      </CompactDisclosureRow>
    );
    // A contact on file is a fact about the seat, so this renders only in the
    // reference panel; a *missing* one is work and renders in the open half
    // as a warning line with the same edit form.
    const emergencyContactBlock = (
      <div>
        <GroupLabel as="p">{t("trips.roster.emergencyContactHeading")}</GroupLabel>
        <p className="mt-1 text-sm text-muted">
          {t("trips.roster.emergencyContactOnFile", {
            name: person.emergencyContactName ?? "",
            phone: person.emergencyContactPhone ?? "",
          })}
        </p>
        {emergencyContactForm}
      </div>
    );

    /**
     * **Work**: everything this seat still owes, always in the open — one
     * item per line, each beside its own fix (the ADR's "open work expands
     * inline"). Membership is decided by the kind of thing, never by its
     * current value, so a control can never leave from under the finger that
     * used it: payment, the contact form and the notes stay put in both
     * states.
     */
    const outstanding = (
      <>
        {/* What the diver themselves asked for, in the open. It is the one
            line on this row they wrote, it only renders when they wrote one,
            and the crew forms buddy teams from it. */}
        {booking.groupPreference ? (
          <p className="mt-3 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-muted">
            <span className="font-semibold text-foreground">
              {t("trips.roster.buddyGroupNote")}
            </span>{" "}
            {booking.groupPreference}
          </p>
        ) : null}

        {blockerTexts.length > 0 ? (
          <>
            {/* diveday:allow-tinted-ink: a 5% wash, not the status tint — `text-danger` on `danger/5` measures 5.66:1 over `--background` in the app palette (issue #874) */}
            <ul className="mt-3 grid gap-2 rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
              {uniqueBlockers.map(({ text }) => (
                <li key={text} className="flex gap-2">
                  <StatusMark variant="danger" />
                  <span>{text}</span>
                </li>
              ))}
              {/* The row must never read as "fix the one thing listed and
                  they're clear" when the group above holds more of this
                  diver's blockers — the count keeps the row honest, and the
                  reference panel has their full list. */}
              {sharedBlockerCount > 0 ? (
                <li className="flex gap-2">
                  <StatusMark variant="danger" />
                  <span>{t("trips.roster.sharedOnCard", { count: sharedBlockerCount })}</span>
                </li>
              ) : null}
            </ul>
            {/* Every named problem carries its handle. The waiver, payment,
                and identity blockers already do — their controls are on this
                row — but a certification-family blocker's fix lives on the
                diver's record (design review 2026-08-21). */}
            {blockerTexts.some(
              ({ blocker }) => BLOCKER_CATEGORY[blocker.code] === "certification",
            ) ? (
              <Link
                href={`/shop/${shopSlug}/divers/${person.id}#cards`}
                className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
              >
                {t("trips.roster.reviewCertificationsLink")}
              </Link>
            ) : null}
          </>
        ) : null}

        {/* Warning tone, not danger, and deliberately outside the blocker
            list above: this diver can board. It says the site goes deeper
            than their training, which the instructor may already be planning
            around (H-08). An advisory the group already states for much of
            the boat shrinks to the capsule in this row's header instead. */}
        {depthText !== null && !depthShared ? (
          <p className="mt-3 flex gap-2 rounded-lg bg-warning-tint px-3 py-2 text-sm text-warning-strong">
            <StatusMark variant="warning" />
            <span>{depthText}</span>
          </p>
        ) : null}

        {/* **Currency, which no card can express** (ADR
            20260821-currency-is-what-catches-people). Warning tone and
            outside the blocker list for the same reason the depth line above
            is: this diver boards. It is a refresher conversation and a buddy
            pairing, not a refusal. */}
        {diveRecencyIsNotable(booking.lastDivedBand) ? (
          <p className="mt-3 flex gap-2 rounded-lg bg-warning-tint px-3 py-2 text-sm text-warning-strong">
            <StatusMark variant="warning" />
            <span>{diveRecencyText(t, booking.lastDivedBand)}</span>
          </p>
        ) : null}

        {/* This seat reused an existing diver's email under a different name
            (H-13). Staff verify it really is the same person before it can
            board on that person's certs/waiver — the one action that clears
            the identity_unconfirmed blocker above. */}
        {identityUnconfirmed ? (
          <form action={confirmIdentityAction} className="mt-3">
            <input type="hidden" name="bookingId" value={booking.id} />
            {/* Blocking confirm, not an undo banner: this attestation clears
                the identity_unconfirmed blocker on someone else's evidence
                (H-13) — worth the staffer re-reading before it lands
                (docs/design/principles.md §7). */}
            <InlineConfirm
              triggerLabel={t("trips.roster.confirmThisIs", { name: person.fullName })}
              message={t("trips.roster.confirmIdentityMessage", { name: person.fullName })}
              confirmLabel={t("trips.roster.identityConfirmButton")}
              cancelLabel={t("trips.roster.neverMind")}
              pendingLabel={t("trips.roster.confirming")}
              triggerClassName={buttonClass({ variant: "secondary", size: "sm" })}
            />
          </form>
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

        {/* The waiver, when there is one to send. The control's own face is
            the status and its label is the next action; a signed waiver has
            no control at all — its date line is reference, in the panel. */}
        {waiverControl.action ? (
          <div className="mt-3">
            <WaiverSendControl
              shopSlug={shopSlug}
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
              className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors ${waiverControl.tone}`}
              wrapperClassName=""
              copy={waiverSendCopy(t)}
            />
            {/* A diver who signed on paper or on shore: let a non-diver
                record it so the waiver gate isn't held up by a signature the
                app never sees. */}
            <PaperWaiverControl
              action={markWaiverInPersonAction}
              bookingId={booking.id}
              copy={paperWaiverCopy(t)}
              // The fallback under the row's leading action reads in quiet
              // ink — a teal link out-shouted the bordered send pill above it
              // (design review 2026-08-29).
              variant="ghost"
            />
          </div>
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
            {flaggedPrompts.length > 0 ? (
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
                {flaggedPrompts.map((prompt) => (
                  <li key={prompt}>{prompt}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1">{t("trips.roster.medicalFollowUpDescription")}</p>
            )}
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

        {/* Task 144 — a *missing* contact is work and stays in the open, as
            one line in the same warning grammar as its siblings above with
            its fix riding the line's end: the whole line is the disclosure
            that opens the form (`keepOpenBookingId` reopens the row a
            just-saved contact settled). */}
        {hasEmergencyContact ? null : (
          <details className="group/missing-contact mt-3">
            <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 rounded-lg bg-warning-tint px-3 py-2 text-sm text-warning-strong transition-colors hover:bg-warning-tint [&::-webkit-details-marker]:hidden">
              <StatusMark variant="warning" />
              <span>
                {t("trips.roster.emergencyContactHeading")} ·{" "}
                {t("trips.roster.emergencyContactMissing")}
              </span>
              <span className="ms-auto font-semibold">{t("trips.roster.emergencyContactAdd")}</span>
              <DisclosureCaret
                direction="down"
                className="size-4 group-open/missing-contact:rotate-180"
              />
            </summary>
            {contactForm}
          </details>
        )}

        {/* One disclosure, at the top level of the row — writing a note about
            a diver is desk work a staffer starts from here. */}
        <CompactDisclosureRow
          className="mt-3"
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
                  className="flex items-start justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm"
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
      </>
    );

    /**
     * **Reference**: what is merely true about this seat, one tap away.
     */
    const reference = (
      <>
        {/* The seat's own identity facts: the roster is scanned by name and
            state, and the email — with an adult's age beside it — is
            reference the moment it is needed, not a second line on every
            row. */}
        <p className="mt-3 text-sm text-muted">
          <span>{person.email ?? t("trips.roster.noEmailOnFile")}</span>
          {age !== null ? (
            <span className="tabular-nums">
              {" · "}
              {t("trips.roster.ageYears", { age })}
            </span>
          ) : null}
        </p>
        <div className="mt-3 grid gap-5 sm:grid-cols-2">
          {/* The signed waiver's own evidence — when, and by which route —
              and nothing else. Every state that is *not* signed already says
              so in the open half (principle 9). */}
          {currentWaiver?.completedAt && waiverStatus === "complete" ? (
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
            </div>
          ) : null}

          <div>
            <GroupLabel as="p">{t("trips.roster.rentalFitColumnHeading")}</GroupLabel>
            <p className="mt-1 text-sm text-muted">
              {rentalFitLineText(
                t,
                locale,
                rentalFitLine(rentalFitByBooking.get(booking.id) ?? null),
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

          {/* A contact already on file: a fact about the seat, which is what
              this panel is for. Only this state appears here — a missing one
              is work and stays in the open above (principle 9). */}
          {hasEmergencyContact ? emergencyContactBlock : null}

          {/* The full per-diver list, only when the open half compressed part
              of it into a count. */}
          {depthShared && depthText !== null ? (
            <div>
              <GroupLabel as="p">{t("trips.roster.depthChip")}</GroupLabel>
              <p className="mt-1 text-sm text-muted">{depthText}</p>
            </div>
          ) : null}

          {sharedBlockerCount > 0 ? (
            <div>
              <GroupLabel as="p">{t("trips.roster.blockersReferenceHeading")}</GroupLabel>
              <ul className="mt-1 grid gap-1 text-sm text-muted">
                {blockerTexts.map(({ text }) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
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

        {/* `-mx-3` on the row, and both controls at the same `sm` padding, so
            the padded pair sits on the text column every other line in this
            panel sits on. */}
        <div className="mt-4 border-t border-border pt-4">
          <div className="-mx-3 flex flex-wrap items-center gap-x-1 gap-y-2">
            {/* One orders door per row, and only when the shop can take money
                at all (principle 9 — Settings and the Orders index own the
                "Connect payments" door). */}
            {paymentsConnected ? (
              <Link
                href={`/shop/${shopSlug}/orders/new?personId=${person.id}&bookingId=${booking.id}`}
                className={buttonClass({ variant: "link", size: "sm" })}
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
                triggerClassName={buttonClass({ variant: "ghost", size: "sm" })}
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
    const markSummary = (
      <summary
        aria-label={t("trips.roster.detailsSummaryLabel", { name: person.fullName })}
        className={`absolute top-2.5 end-2 flex size-11 cursor-pointer list-none items-center justify-center rounded-lg transition-colors [&::-webkit-details-marker]:hidden hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary sm:end-3 ${
          settledRow ? "text-success" : "text-muted hover:text-foreground"
        }`}
      >
        {settledRow ? (
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
          {headerLeft}
          <div className="ms-auto flex flex-wrap items-center justify-end gap-2">
            {headerBadges}
          </div>
        </div>
        {/* A cleared seat is one line in the Ready group (principle 9): the
            group band says the state, the drawn mark confirms it, and
            everything the row can still tell or do — payment corrections,
            notes, the reference facts — waits behind the mark. A row with
            open work keeps that work in the open. Deep links (Today, the
            manifest's "Resolve blockers") land mid-page at one diver;
            AutoOpenDetails opens on the hash, so the collapse can never
            swallow what a link promised. */}
        {settledRow && !holdOpen ? (
          <AutoOpenDetails openOnHash={`booking-${booking.id}`} className="group">
            {markSummary}
            <div className="pb-1.5">
              {outstanding}
              {reference}
            </div>
          </AutoOpenDetails>
        ) : (
          <>
            {outstanding}
            <AutoOpenDetails openOnHash={`booking-${booking.id}`} open={holdOpen} className="group">
              {markSummary}
              <div className="pb-1.5">{reference}</div>
            </AutoOpenDetails>
          </>
        )}
      </li>
    );
  };

  const hasTail = waitingGroup != null || invitedGroup != null || addDiverGroup != null;
  return (
    <section
      id="roster"
      aria-label={showSummaryHeading ? undefined : t("trips.roster.heading")}
      className={`${compact ? "mt-5" : "mt-10"} scroll-mt-24`}
    >
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
                    its own readable line. */}
                {sharedFacts.length > 0 ? (
                  <div className="flex w-full min-w-0 flex-col gap-1 text-xs sm:w-auto sm:max-w-[68%] sm:items-end">
                    {sharedFacts.map(({ sentence, count, tone }) => (
                      <p
                        key={sentence}
                        className={`flex min-w-0 items-start gap-1.5 ${
                          tone === "danger" ? "text-danger" : "text-warning-strong"
                        }`}
                      >
                        <StatusMark variant={tone === "danger" ? "danger" : "warning"} />
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
          {waitingGroup}
          {invitedGroup}
          {addDiverGroup ? (
            <div id="add-diver" className="scroll-mt-24">
              <RosterGroupBand label={t("trips.addDiver.heading")} />
              <div className="px-4 pt-3 pb-5 sm:px-5">{addDiverGroup}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
