import Link from "next/link";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { EmptyState } from "@/components/EmptyState";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { ScrollToHash } from "@/components/ScrollToHash";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import type { listBookingNotes } from "@/db/operations";
import { birthdayText } from "@/i18n/birthday-labels";
import { depthWarningText } from "@/i18n/depth-labels";
import {
  readinessBlockerText,
  readinessStatusText,
  readinessStatusTone,
} from "@/i18n/readiness-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { ageOnDate, birthdayCallout, isMinorOnDate } from "@/lib/age";
import type { CalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import type { DepthUnit } from "@/lib/depth-units";
import { rentalFitLine } from "@/lib/dive-prep";
import { formatDateTimeTz } from "@/lib/format";
import { flaggedMedicalPrompts } from "@/lib/medical";
import { paymentSourceLine } from "@/lib/payment-source";
import { rosterRowIsBlocked, rosterRowNeedsWaiver } from "@/lib/roster-filters";
import { waiverState } from "@/lib/waivers";
import { PaymentStatusControl, type PaymentStatusControlCopy } from "./PaymentStatusControl";
import { BulkWaiverCheckbox, BulkWaiverSendButton } from "./RosterBulkWaiverSelection";
import type {
  NitroxByBooking,
  ReadinessByBooking,
  RentalFitByBooking,
  RosterEntry,
  WaiverByBooking,
} from "./types";

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

/**
 * The roster's filter chips (server-rendered `?rf=` query param, task 69):
 * scanning a 12-person boat for who still needs a waiver, or who's flat-out
 * blocked, beats reading every ~200px card end to end.
 */
export type RosterFilter = "all" | "needs_waiver" | "blocked";

export function isRosterFilter(value: string | undefined): value is RosterFilter {
  return value === "all" || value === "needs_waiver" || value === "blocked";
}

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
    tone: "border border-danger/40 text-danger hover:bg-danger/10",
    action: "resend",
    confirm: false,
  },
  complete: {
    labelKey: "trips.roster.waiverSigned",
    tone: "bg-success/10 text-success",
    action: null,
    confirm: false,
  },
  medical_review: {
    labelKey: "trips.roster.waiverMedicalReview",
    tone: "bg-warning/10 text-warning",
    action: null,
    confirm: false,
  },
};

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
  removeBookingAction,
  confirmIdentityAction,
  notesByBooking,
  addNoteAction,
  deleteNoteAction,
  saveEmergencyContactAction,
  // Accepted for interface parity with callers/DepthUnit plumbing elsewhere
  // on this page, but `depthWarningText` already embeds its own unit
  // formatting — nothing in this component needs it directly. Pre-existing
  // (unrelated to manifests/roll-call); kept rather than dropped from the
  // props contract in case another in-flight change depends on it.
  depthUnit: _depthUnit,
  tripDate,
  rosterFilter,
  canAddDivers,
}: {
  shopSlug: string;
  shopTimezone: string;
  locale: string;
  tripId: string;
  booked: number;
  capacity: number;
  roster: RosterEntry[];
  /** Server-rendered `?rf=` selection (task 69) — defaults to "all" upstream. */
  rosterFilter: RosterFilter;
  /**
   * Whether the page above still renders its `#add-diver` section (it doesn't
   * on a cancelled departure). The empty roster's one action anchors there, so
   * without this the box would offer a door that isn't on the page.
   */
  canAddDivers: boolean;
  readinessByBooking: ReadinessByBooking;
  waiverByBooking: WaiverByBooking;
  rentalFitByBooking: RentalFitByBooking;
  nitroxByBooking: NitroxByBooking;
  requiresPayment: boolean;
  /**
   * Whether the shop has a Stripe account that can actually take money.
   * `orders/new` refuses without one, so the per-seat "Create order" link
   * becomes "Connect payments" rather than a click that bounces straight back.
   */
  paymentsConnected: boolean;
  /** When free cancellation closes, so staff see a refund cue on paid seats; null = no stated window. */
  cancellationDeadline: Date | null;
  markWaiverInPersonAction: (formData: FormData) => void;
  markPaymentAction: (formData: FormData) => void;
  removeBookingAction: (formData: FormData) => void;
  confirmIdentityAction: (formData: FormData) => void;
  notesByBooking: Map<string, Awaited<ReturnType<typeof listBookingNotes>>>;
  addNoteAction: (formData: FormData) => void;
  deleteNoteAction: (formData: FormData) => void;
  /** Staff record or correct a diver's emergency contact from their card (task 144). */
  saveEmergencyContactAction: (formData: FormData) => void;
  /** How this shop reads depth; the stored figure is always metres. */
  depthUnit: DepthUnit;
  /** The trip's own shop-local calendar date — when age and birthdays are measured. */
  tripDate: CalendarDate;
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
      refunded: t("trips.roster.paymentRefunded"),
    },
    update: t("trips.roster.paymentUpdate"),
    updating: t("trips.roster.paymentUpdating"),
  };
  const refundEligible = cancellationDeadline !== null && cancellationDeadline > nowDate();
  // Filter chips read against the *full* roster's own signals, never a separate
  // query, so the counts and the cards they gate can never disagree. Both
  // predicates live in `src/lib/roster-filters.ts`, where the two bugs they fix
  // are written down: "needs waiver" is now the bulk button's own definition (a
  // medical-review diver has a signed waiver and nothing to send), and
  // "blocked" is now the blocker queue's rule (an absent readiness row is not a
  // blocked diver — `!== "ready"` counted `undefined`).
  const needsWaiver = ({ booking }: RosterEntry) =>
    rosterRowNeedsWaiver(waiverState(waiverByBooking.get(booking.id)?.waiver ?? null));
  const isBlocked = ({ booking }: RosterEntry) =>
    rosterRowIsBlocked(readinessByBooking.get(booking.id)?.readiness);
  // The bulk control acts on exactly the divers the "Needs waiver" chip counts
  // — one predicate, so staff can never be shown a count the button won't act
  // on. `WAIVER_CONTROLS[…].action` still decides each row's own control.
  const sendableCount = roster.filter(needsWaiver).length;
  const filterCounts = {
    all: roster.length,
    needs_waiver: roster.filter(needsWaiver).length,
    blocked: roster.filter(isBlocked).length,
  } as const;
  const filteredRoster =
    rosterFilter === "needs_waiver"
      ? roster.filter(needsWaiver)
      : rosterFilter === "blocked"
        ? roster.filter(isBlocked)
        : roster;
  const filterChipHref = (filter: RosterFilter) =>
    `/shop/${shopSlug}/trips/${tripId}/guests${filter === "all" ? "" : `?rf=${filter}`}#roster`;
  const filterChipClass = (active: boolean) =>
    // min-h-11: these chips are this tab's primary navigation, tapped
    // one-handed on a moving boat — the 44px dock-test floor applies.
    `inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors ${
      active
        ? "border-primary bg-primary/10 text-primary"
        : "border-border text-muted hover:bg-surface-sunken hover:text-foreground"
    }`;
  return (
    <section id="roster" className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {t("trips.roster.heading")}{" "}
            <span className="font-normal text-muted tabular-nums">
              {t("trips.roster.bookedOfCapacity", { booked, capacity })}
            </span>
          </h2>
        </div>
        {/* Bulk waiver send — the same `WaiverSendControl` every other surface
            uses (Lens 17: one waiver-send control, not two divergent ones),
            fed by `BulkWaiverSelectionProvider`'s shared client state rather
            than a fixed prop (the provider itself lives in TripLayout, above
            this page's dynamic content, so a diver-add redirect's re-render
            can't wipe a tick mid-selection — see RosterBulkWaiverSelection.tsx).
            Only appears when a diver is actually sendable, so it's never a
            dead control. */}
        {sendableCount > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">{t("trips.roster.tickDiversThen")}</span>
            <BulkWaiverSendButton
              shopSlug={shopSlug}
              tripId={tripId}
              label={t("trips.roster.sendWaiversToSelected")}
              pendingLabel={t("trips.roster.sending")}
              className={buttonClass({ variant: "secondary", size: "sm" })}
              copy={waiverSendCopy(t)}
            />
          </div>
        ) : null}
      </div>
      {roster.length > 0 ? (
        <nav aria-label={t("trips.roster.filterAriaLabel")} className="mt-4 flex flex-wrap gap-2">
          {(["all", "needs_waiver", "blocked"] as const).map((filter) => (
            <Link
              key={filter}
              href={filterChipHref(filter)}
              scroll={false}
              className={filterChipClass(rosterFilter === filter)}
            >
              {filter === "all"
                ? t("trips.roster.filterAll", { count: filterCounts.all })
                : filter === "needs_waiver"
                  ? t("trips.roster.filterNeedsWaiver", { count: filterCounts.needs_waiver })
                  : t("trips.roster.filterBlocked", { count: filterCounts.blocked })}
            </Link>
          ))}
        </nav>
      ) : null}
      {roster.length === 0 ? (
        // The shared empty state, not a bare paragraph: the wait list two
        // sections up already wore one, so this tab was teaching two visual
        // languages for "nothing here" on one screen (docs/design/principles.md
        // #4). The door is the add-a-diver section on this same page — dropped
        // when the departure is cancelled, where there is nothing to seat.
        <EmptyState className="mt-4">
          <h3 className="font-medium">{t("trips.roster.emptyHeading")}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t("trips.roster.noBookings")}</p>
          {canAddDivers ? (
            <a href="#add-diver" className={buttonClass({ className: "mt-4" })}>
              {t("trips.roster.emptyAction")}
            </a>
          ) : null}
        </EmptyState>
      ) : filteredRoster.length === 0 ? (
        // A filter that hides everyone is a dead end unless the way back out is
        // in the box with the bad news.
        <EmptyState className="mt-4">
          <h3 className="font-medium">{t("trips.roster.filterEmptyHeading")}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            {t("trips.roster.noneMatchFilter")}
          </p>
          <Link
            href={filterChipHref("all")}
            scroll={false}
            className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
          >
            {t("trips.roster.filterEmptyAction", { count: filterCounts.all })}
          </Link>
        </EmptyState>
      ) : (
        <ul className="mt-5 grid gap-4">
          {/* Inside the list, so mounting proves the row it scrolls to exists.
              Every door into this roster is a deep link at one diver — Today's
              queue, and the manifest's "Resolve blockers" — and a `<Link>`
              transition does not run the browser's own fragment scroll, so
              those all landed at the top of a page of ~200px cards with the
              named diver far below the fold. */}
          <ScrollToHash />
          {filteredRoster.map(({ booking, person }) => {
            const readiness = readinessByBooking.get(booking.id)?.readiness;
            const paymentStatus = readinessByBooking.get(booking.id)?.paymentStatus;
            const paymentSource = paymentSourceLine(
              paymentStatus,
              readinessByBooking.get(booking.id)?.paymentProvider,
            );
            const currentWaiver = waiverByBooking.get(booking.id)?.waiver ?? null;
            const waiverStatus = waiverState(currentWaiver);
            const waiverControl = WAIVER_CONTROLS[waiverStatus];
            const flaggedPrompts =
              waiverStatus === "medical_review" && currentWaiver?.medicalAnswers
                ? flaggedMedicalPrompts(currentWaiver.medicalAnswers)
                : [];
            const nitrox = nitroxByBooking.get(booking.id);
            const identityUnconfirmed = Boolean(
              readiness?.blockers.some((blocker) => blocker.code === "identity_unconfirmed"),
            );
            // Age is shown only when the shop actually holds a date of birth —
            // no date, no line, rather than an "unknown" that reads as a gap to
            // fill on every diver who has never been asked (H-21).
            const dateOfBirth = person.dateOfBirth;
            const age = dateOfBirth ? ageOnDate(dateOfBirth, tripDate) : null;
            const minor = dateOfBirth ? isMinorOnDate(dateOfBirth, tripDate) : false;
            const birthday = birthdayCallout(dateOfBirth, tripDate);
            // A name with no number reads as "on file" but is unreachable in an
            // incident — same both-fields rule `missingEmergencyContactByTrip`
            // (src/db/today.ts) uses for Today's nudge.
            const hasEmergencyContact = Boolean(
              person.emergencyContactName && person.emergencyContactPhone,
            );
            // A warning, never a gate: the site goes deeper than this diver's
            // training, which an instructor may well have already planned around
            // (H-08). It sits apart from the blocker list for that reason.
            const depth = readinessByBooking.get(booking.id)?.depthAdvisory;
            // A settled diver — ready, waiver signed, contact on file, nothing
            // advisory — has no work left on this tab, so the card collapses to
            // its header line and the detail waits behind a disclosure: detail
            // at the moment it's needed, not on every row (design principle 9).
            // Any open question keeps the whole card expanded.
            const settled =
              readiness?.status === "ready" &&
              waiverStatus === "complete" &&
              !identityUnconfirmed &&
              hasEmergencyContact &&
              depth?.status !== "exceeds";
            const headerLeft = (
              <div className="flex min-w-0 items-start gap-3">
                {/* Joins the bulk selection above via shared client state
                        (`BulkWaiverSelectionProvider`), not form association —
                        only sendable divers get one. */}
                {waiverControl.action ? (
                  // A bare checkbox has a ~16px hit area — too small for wet or gloved
                  // fingers (design/principles.md #2). The wrapping <label> covers only
                  // the checkbox itself (the diver name below is a separate, sibling
                  // <Link>, untouched by this), so a tap anywhere in the 44px box
                  // forwards to the input — a plain wrapper <span> would not.
                  <BulkWaiverCheckbox
                    bookingId={booking.id}
                    ariaLabel={t("trips.roster.selectToSendWaiverAriaLabel", {
                      name: person.fullName,
                    })}
                    labelClassName="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
                    className="size-4 shrink-0"
                  />
                ) : null}
                <div className="min-w-0">
                  {/* A real target, not a 21px text line: inside the collapsed
                      row's <summary> this link sits against another clickable
                      surface, so it needs its own clear hit area (WCAG 2.5.8's
                      24px floor; the dock test asks for 44). */}
                  <Link
                    href={`/shop/${shopSlug}/divers/${person.id}`}
                    className="inline-flex min-h-11 items-center font-medium text-primary hover:underline"
                  >
                    {person.fullName}
                  </Link>
                  <p className="text-sm text-muted">
                    {person.email ?? t("trips.roster.noEmailOnFile")}
                  </p>
                  {age !== null ? (
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                      <span className="tabular-nums">{t("trips.roster.ageYears", { age })}</span>
                      {/* Text, never colour alone — this is read in sunlight
                              on a moving boat (design/principles.md #2). */}
                      {minor ? (
                        <Badge tone="warning" size="sm">
                          {t("trips.roster.minorBadge")}
                        </Badge>
                      ) : null}
                      {/* The cake carries the meaning; the words are just
                              when. `sr-only` keeps that legible to a screen
                              reader, which would otherwise hear "in 2 days" alone. */}
                      {birthday ? (
                        <Badge tone="primary" size="sm">
                          <span aria-hidden="true">🎂</span>
                          <span className="sr-only">{t("shared.birthday.label")}</span>
                          <span className="ms-1">{birthdayText(t, birthday)}</span>
                        </Badge>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              </div>
            );
            // Arrived at the counter — display only, the same pill the
            // manifest shows. It reads existing booking state and gates
            // nothing.
            const checkedInPill =
              booking.status === "checked_in" ? (
                <Badge tone="neutral">{t("trips.roster.checkedInPill")}</Badge>
              ) : null;
            const headerBadges = (
              <>
                {checkedInPill}
                {/* One readiness vocabulary, one tone per state
                        (src/i18n/readiness-labels.ts): this badge said "Needs
                        attention" about the diver the manifest called "Blocked".
                        "Ready" wears the same quiet glyph-plus-text the settled
                        rows use, never the green pill — a card can be expanded
                        (missing contact, depth advisory) while still ready, and
                        a success badge one row below eight quiet ✓s read as a
                        second grammar for the same fact (principle 9). Badges
                        here mark the exceptional states only. */}
                {readiness ? (
                  readiness.status === "ready" ? (
                    <span className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted">
                      <span aria-hidden="true">✓</span>
                      {readinessStatusText(t, "ready")}
                    </span>
                  ) : (
                    <Badge tone={readinessStatusTone(readiness.status)}>
                      {readinessStatusText(t, readiness.status)}
                    </Badge>
                  )
                ) : null}
              </>
            );
            const detail = (
              <>
                {booking.groupPreference ? (
                  <p className="mt-3 rounded-lg bg-surface-sunken px-3 py-2 text-sm text-muted">
                    <span className="font-semibold text-foreground">
                      {t("trips.roster.buddyGroupNote")}
                    </span>{" "}
                    {booking.groupPreference}
                  </p>
                ) : null}

                {readiness && readiness.status !== "ready" ? (
                  <ul className="mt-3 grid gap-2 rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
                    {readiness.blockers.map((blocker) => (
                      <li key={blocker.code} className="flex gap-2">
                        <span aria-hidden="true">!</span>
                        <span>{readinessBlockerText(t, blocker)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/* Warning tone, not danger, and deliberately outside the
                    blocker list above: this diver can board. It says the site
                    goes deeper than their training, which the instructor may
                    already be planning around (H-08). */}
                {depth?.status === "exceeds" ? (
                  <p className="mt-3 flex gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
                    <span aria-hidden="true">▲</span>
                    <span>{depthWarningText(t, depth)}</span>
                  </p>
                ) : null}

                {/* This seat reused an existing diver's email under a different
                    name (H-13). Staff verify it really is the same person before
                    it can board on that person's certs/waiver — the one action
                    that clears the identity_unconfirmed blocker above. */}
                {identityUnconfirmed ? (
                  <form action={confirmIdentityAction} className="mt-2">
                    <input type="hidden" name="bookingId" value={booking.id} />
                    {/* Blocking confirm, not an undo banner: this attestation clears
                        the identity_unconfirmed blocker on someone else's evidence
                        (H-13) — worth the staffer re-reading before it lands
                        (docs/design/principles.md §7). */}
                    <InlineConfirm
                      triggerLabel={t("trips.roster.confirmThisIs", { name: person.fullName })}
                      message={t("trips.roster.confirmIdentityMessage", {
                        name: person.fullName,
                      })}
                      confirmLabel={t("trips.roster.identityConfirmButton")}
                      cancelLabel={t("trips.roster.neverMind")}
                      pendingLabel={t("trips.roster.confirming")}
                      triggerClassName={buttonClass({ variant: "secondary", size: "sm" })}
                    />
                  </form>
                ) : null}

                <div className="mt-4 grid gap-5 border-t border-border pt-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold tracking-widest text-muted uppercase">
                      {t("trips.roster.waiverColumnHeading")}
                    </p>
                    <div className="mt-2">
                      {waiverControl.action ? (
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
                          className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors duration-200 ${waiverControl.tone}`}
                          wrapperClassName=""
                          copy={waiverSendCopy(t)}
                        />
                      ) : (
                        <span
                          className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium ${waiverControl.tone}`}
                        >
                          {waiverControl.label}
                        </span>
                      )}
                    </div>
                    {waiverControl.action ? (
                      // A diver who signed on paper or on shore: let a non-diver
                      // record it so the waiver gate isn't held up by a signature
                      // the app never sees.
                      <PaperWaiverControl
                        action={markWaiverInPersonAction}
                        bookingId={booking.id}
                        t={t}
                      />
                    ) : null}
                    {currentWaiver?.completedAt && waiverStatus === "complete" ? (
                      <p className="mt-2 text-sm text-muted">
                        {currentWaiver.signatureMethod === "in_person_attested"
                          ? t("trips.roster.signedPaper", {
                              date: formatDateTimeTz(
                                currentWaiver.completedAt,
                                locale,
                                shopTimezone,
                              ),
                            })
                          : currentWaiver.signatureMethod === "imported"
                            ? t("trips.roster.signedImported", {
                                date: formatDateTimeTz(
                                  currentWaiver.completedAt,
                                  locale,
                                  shopTimezone,
                                ),
                              })
                            : t("trips.roster.signedPlain", {
                                date: formatDateTimeTz(
                                  currentWaiver.completedAt,
                                  locale,
                                  shopTimezone,
                                ),
                              })}
                      </p>
                    ) : null}
                    {waiverStatus === "medical_review" ? (
                      <div className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
                        <p className="font-medium">{t("trips.roster.followUpBeforeBoarding")}</p>
                        {flaggedPrompts.length > 0 ? (
                          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
                            {flaggedPrompts.map((prompt) => (
                              <li key={prompt}>{prompt}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1">{t("trips.roster.medicalFollowUpDescription")}</p>
                        )}
                        {currentWaiver ? (
                          <Link
                            href={`/shop/${shopSlug}/waivers/signatures?record=${currentWaiver.id}`}
                            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline"
                          >
                            {t("trips.roster.viewSignedRecord")}
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <p className="text-xs font-semibold tracking-widest text-muted uppercase">
                      {t("trips.roster.rentalFitColumnHeading")}
                    </p>
                    <p className="mt-2 text-sm text-muted">
                      {rentalFitLineText(
                        t,
                        locale,
                        rentalFitLine(rentalFitByBooking.get(booking.id) ?? null),
                      )}
                    </p>
                    {nitrox ? (
                      <p className="mt-2 text-sm font-medium text-primary">
                        {nitrox.approved
                          ? t("trips.roster.nitroxApproved")
                          : t("trips.roster.nitroxUnverified")}
                      </p>
                    ) : null}
                  </div>
                </div>

                {/* Task 144 — Today used to send staff here with "ask at the
                    counter" and no field to type it into. Read-only summary
                    plus a collapsed edit form, matching the "mark signed on
                    paper" pattern above; writes through the same
                    `saveBookingEmergencyContact` the diver's own /ready and
                    /waivers capture uses. Prints on the manifest. */}
                <div className="mt-4 border-t border-border pt-4">
                  <p className="text-xs font-semibold tracking-widest text-muted uppercase">
                    {t("trips.roster.emergencyContactHeading")}
                  </p>
                  {hasEmergencyContact ? (
                    <p className="mt-2 text-sm text-muted">
                      {t("trips.roster.emergencyContactOnFile", {
                        name: person.emergencyContactName ?? "",
                        phone: person.emergencyContactPhone ?? "",
                      })}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-warning">
                      {t("trips.roster.emergencyContactMissing")}
                    </p>
                  )}
                  <details className="mt-2">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary hover:underline">
                      {hasEmergencyContact
                        ? t("trips.roster.emergencyContactEdit")
                        : t("trips.roster.emergencyContactAdd")}
                    </summary>
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
                  </details>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
                  {requiresPayment ? (
                    <PaymentStatusControl
                      bookingId={booking.id}
                      status={paymentStatus ?? "unpaid"}
                      action={markPaymentAction}
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
                  ) : null}
                  {/* One orders door per card, and only when the shop can take
                      money at all: "Connect payments" is a shop-level fact that
                      used to repeat on every diver (principle 9 — Settings and
                      the Orders index own that door), and "View orders" sat
                      beside "Create order" doing half the same job (principle
                      8 — the orders index reachable from the diver record
                      already lists them). */}
                  {paymentsConnected ? (
                    <Link
                      href={`/shop/${shopSlug}/orders/new?personId=${person.id}&bookingId=${booking.id}`}
                      className="inline-flex min-h-11 items-center py-2 text-sm font-medium text-primary hover:underline"
                    >
                      {t("trips.roster.createOrder")}
                    </Link>
                  ) : null}
                  {/* A cancel inside the shop's refund window fires an automatic
                      Stripe refund that the Undo banner can't claw back — a real
                      send of money, not a purely reversible edit — so this gets a
                      blocking confirm too (docs/design/principles.md §7). */}
                  {/* Last in the row, not flung to its far right. The
                      `sm:ml-auto` this replaces put a gulf between "Create
                      order" and "Remove booking" wide enough to read as a
                      separate control belonging to something else — and on a
                      card whose actions are otherwise a left-aligned run, a
                      lone right-hung one is the shape a *primary* action
                      takes. It is already the least prominent thing here (ghost
                      weight, muted ink, danger only on hover) and it already
                      confirms before it fires; its position was carrying a
                      third warning nobody asked it to. */}
                  <form action={removeBookingAction}>
                    <input type="hidden" name="bookingId" value={booking.id} />
                    <InlineConfirm
                      triggerLabel={t("trips.roster.removeBooking")}
                      message={t("trips.roster.confirmRemoveBooking", {
                        name: person.fullName,
                      })}
                      confirmLabel={t("trips.roster.removeBookingConfirmButton")}
                      cancelLabel={t("trips.roster.neverMind")}
                      pendingLabel={t("trips.roster.removing")}
                      triggerClassName="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-muted transition-colors duration-200 hover:bg-danger/10 hover:text-danger focus-visible:text-danger"
                      confirmClassName={buttonClass({ variant: "danger", size: "sm" })}
                    />
                  </form>
                </div>
                <details className="mt-4 border-t border-border pt-4">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
                    {/* A zero count is the absence of information formatted as
                        information (principle 9) — with no notes the disclosure
                        is simply the door to writing the first one. */}
                    {(notesByBooking.get(booking.id)?.length ?? 0) === 0
                      ? t("trips.roster.addFirstNoteSummary")
                      : t("trips.roster.privateStaffNotes", {
                          count: notesByBooking.get(booking.id)?.length ?? 0,
                        })}
                  </summary>
                  <div className="mt-2 grid gap-3">
                    {(notesByBooking.get(booking.id) ?? []).map(({ note, authorName }) => (
                      <div
                        key={note.id}
                        className="flex items-start justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p>{note.body}</p>
                          <p className="mt-1 text-xs text-muted">
                            {authorName} · {formatDateTimeTz(note.createdAt, locale, shopTimezone)}
                          </p>
                        </div>
                        <form action={deleteNoteAction} className="shrink-0">
                          <input type="hidden" name="noteId" value={note.id} />
                          {/* No confirm dialog: the delete lands and a toast offers
                              a one-tap undo (recreates the note) — a purely
                              reversible edit, not a real send (principle 7). */}
                          <SubmitButton
                            pendingLabel={t("trips.roster.deletingEllipsis")}
                            className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-danger hover:bg-danger/10"
                          >
                            {t("trips.roster.delete")}
                          </SubmitButton>
                        </form>
                      </div>
                    ))}
                    <form action={addNoteAction} className="grid gap-2">
                      <input type="hidden" name="bookingId" value={booking.id} />
                      <label htmlFor={`note-${booking.id}`} className="text-sm font-medium">
                        {t("trips.roster.addNoteLabel")}
                      </label>
                      <textarea
                        id={`note-${booking.id}`}
                        name="note"
                        required
                        maxLength={1000}
                        rows={2}
                        className={controlClass}
                      />
                      <SubmitButton
                        pendingLabel={t("trips.roster.adding")}
                        className={buttonClass({
                          variant: "secondary",
                          size: "sm",
                          className: "justify-self-start",
                        })}
                      >
                        {t("trips.roster.addPrivateNote")}
                      </SubmitButton>
                    </form>
                  </div>
                </details>
              </>
            );
            return (
              <li
                key={booking.id}
                // Today's queue deep-links straight to the diver it is about;
                // scroll-mt keeps the row clear of the sticky shop header.
                id={`booking-${booking.id}`}
                className="scroll-mt-24 rounded-xl border border-border bg-surface p-5 shadow-sm"
              >
                {settled ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      {headerLeft}
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                        {checkedInPill}
                        {/* Quiet text, not the green Badge: on a good morning
                            every row here is settled, and a success pill
                            repeated down the list is the exact noise this
                            collapse exists to remove (principle 9). The glyph
                            stays — never color (or its absence) alone. */}
                        <span className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted">
                          <span aria-hidden="true">✓</span>
                          {readinessStatusText(t, "ready")}
                        </span>
                      </div>
                    </div>
                    {/* The disclosure toggle is its own <summary> below the
                        header rather than wrapping it: a summary is itself
                        interactive, so the diver-name link inside it would be
                        an interactive element nested in another (axe
                        nested-interactive). Deep links (Today, the manifest's
                        "Resolve blockers") land mid-page at one diver;
                        AutoOpenDetails opens this when the hash names the row,
                        so a collapsed card never swallows what the link
                        promised. */}
                    <AutoOpenDetails openOnHash={`booking-${booking.id}`} className="group -mt-2">
                      <summary
                        // Ten of these in a list all read "Details" alone; the
                        // accessible name says whose (same pattern as the
                        // roster's other per-row controls).
                        aria-label={t("trips.roster.detailsSummaryLabel", {
                          name: person.fullName,
                        })}
                        className="ml-auto flex min-h-11 w-fit cursor-pointer list-none items-center gap-1 text-sm font-medium text-muted transition-colors [&::-webkit-details-marker]:hidden hover:text-foreground"
                      >
                        {t("trips.roster.detailsSummary")}
                        <svg
                          viewBox="0 0 20 20"
                          fill="none"
                          stroke="currentColor"
                          aria-hidden="true"
                          className="size-4 transition-transform duration-200 group-open:rotate-180"
                        >
                          <path
                            d="m6 8 4 4 4-4"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </summary>
                      {detail}
                    </AutoOpenDetails>
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      {headerLeft}
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                        {headerBadges}
                      </div>
                    </div>
                    {detail}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
