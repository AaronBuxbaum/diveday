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
import { FilterChips } from "@/components/ui/FilterChips";
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
import { RosterAllClear } from "./RosterAllClear";
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
  savedContactBookingId,
}: {
  shopSlug: string;
  shopTimezone: string;
  locale: string;
  tripId: string;
  booked: number;
  capacity: number;
  roster: RosterEntry[];
  /**
   * The booking whose emergency contact was just saved (`?bid=`), if any.
   *
   * Saving a contact moves it from work into reference, so the block the
   * staffer was typing in lands inside the collapsed panel. This opens that
   * one row on the way back, which is what `AutoOpenDetails`'s `open` prop is
   * for — without it the save would look like the form vanished.
   */
  savedContactBookingId?: string;
  /** Server-rendered `?rf=` selection (task 69) — defaults to "all" upstream. */
  rosterFilter: RosterFilter;
  /**
   * Whether the page above still renders its `#add-diver` section (it doesn't
   * on a cancelled departure). The empty roster's one action anchors there, so
   * without this the box would offer a door that isn't on the page.
   *
   * Asked and answered 2026-08-14: the *non-empty* roster deliberately gets no
   * matching header link down to `#add-diver`. The 2026-08-11 recomposition put
   * the roster first (the page's answer, "who is attending") and left the add
   * form below it, which is slower for a walk-in morning — but `/check-in`
   * already exists for exactly that moment, and this header row already carries
   * the filter chips and the bulk waiver-send control. A third control here
   * would be a duplicate door bought at the cost of principle 8. The empty
   * state keeps its anchor because there is no list to scroll past.
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
          {/* The moment the last blocker clears. Nothing renders until an action
              on this page moves the count to zero — see RosterAllClear for why
              that has to be decided in the browser rather than here. Held back
              on an empty roster: "everyone is cleared" about nobody is not a
              finished thing. */}
          {roster.length > 0 ? (
            <RosterAllClear
              blockedCount={filterCounts.blocked}
              label={t("trips.roster.allClear")}
            />
          ) : null}
        </div>
        {/* No bulk waiver send here. "Tick divers, then Send waivers to
            selected" asked staff to learn a selection mode — a column of
            checkboxes, a count, a second send control — to save taps on the
            one control every row already carries. The per-row
            `WaiverSendControl` below is the whole feature, and the "Needs
            waiver" chip beside it is how staff narrow the roster to exactly
            the rows that want one. */}
      </div>
      {roster.length > 0 ? (
        // The one vocabulary for narrowing a staff list — the pill styling
        // (including the min-h-11 dock-test floor these chips are tapped
        // against one-handed on a moving boat) lives in FilterChips.
        <FilterChips
          label={t("trips.roster.filterAriaLabel")}
          className="mt-4"
          chips={(["all", "needs_waiver", "blocked"] as const).map((filter) => ({
            key: filter,
            href: filterChipHref(filter),
            active: rosterFilter === filter,
            label:
              filter === "all"
                ? t("trips.roster.filterAll", { count: filterCounts.all })
                : filter === "needs_waiver"
                  ? t("trips.roster.filterNeedsWaiver", { count: filterCounts.needs_waiver })
                  : t("trips.roster.filterBlocked", { count: filterCounts.blocked }),
          }))}
        />
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
            const notes = notesByBooking.get(booking.id) ?? [];
            const headerLeft = (
              <div className="flex min-w-0 items-start gap-3">
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
            // Staff record or correct a contact from the same form wherever it
            // is rendered — in the open when the seat has none (that is work),
            // behind the disclosure when it does (that is reference).
            const emergencyContactForm = (
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
            );
            // One block, rendered in exactly one of two places and never both:
            // in the open half when the seat has no contact (that is work
            // Today sends staff here to do, and it prints on the manifest), in
            // the reference panel when it has one (that is a fact about the
            // seat). Written once so the two placements cannot drift apart in
            // heading, form, or wording.
            const emergencyContactBlock = (
              <div>
                <p className="text-xs font-semibold tracking-widest text-muted uppercase">
                  {t("trips.roster.emergencyContactHeading")}
                </p>
                {hasEmergencyContact ? (
                  <p className="mt-1 text-sm text-muted">
                    {t("trips.roster.emergencyContactOnFile", {
                      name: person.emergencyContactName ?? "",
                      phone: person.emergencyContactPhone ?? "",
                    })}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-warning">
                    {t("trips.roster.emergencyContactMissing")}
                  </p>
                )}
                {emergencyContactForm}
              </div>
            );

            /**
             * **Work**: everything this seat still owes, always in the open.
             *
             * The split this half is one side of — work in the open, reference
             * behind one disclosure — replaces a card that made the choice the
             * other way round. Every fact a booking carries used to render at
             * full height on every row: two column headings, a rental-fit line
             * reading "No fit on file", an emergency contact, a payment
             * selector, an orders link and a remove button, and a notes
             * disclosure, whether or not any of it was outstanding. A boat of
             * nine ran past four screens, and the disclosure that could have
             * shortened it was offered *only* to the rows with nothing in them
             * — a diver with a blocker, which is to say every row a staffer is
             * actually working, could not be collapsed at all.
             *
             * So the panel holds what this card can only *tell* you, and the
             * open half holds everything it can also *do*. The membership is
             * decided by the kind of thing, never by its current value — a
             * first attempt sorted by state ("is payment still due?", "is a
             * contact missing?") and produced a card whose controls moved the
             * instant they were used: mark a seat Paid and the selector you
             * just used dropped into a collapsed panel; save an emergency
             * contact and the value you just typed did the same. A control
             * that leaves from under the finger that operated it is worse than
             * the line of chrome it saved, so payment, the contact, and the
             * notes stay put in both states.
             */
            const outstanding = (
              <>
                {/* What the diver themselves asked for, in the open. It is
                    the one line on this card they wrote, it only renders when
                    they wrote one, and the crew forms buddy teams from it —
                    filing a diver's own request behind a tap is the same
                    mistake as leaving a desk note off the manifest. */}
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
                  <form action={confirmIdentityAction} className="mt-3">
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

                {/* The waiver, when there is one to send. No "Waiver" column
                    heading over it any more: the control's own face is the
                    status and its label is the next action, so the heading was
                    a word above a word (design principle 9). A signed waiver
                    has no control at all — its date line is reference, and
                    lives in the panel below. */}
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
                      className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors duration-200 ${waiverControl.tone}`}
                      wrapperClassName=""
                      copy={waiverSendCopy(t)}
                    />
                    {/* A diver who signed on paper or on shore: let a non-diver
                        record it so the waiver gate isn't held up by a signature
                        the app never sees. */}
                    <PaperWaiverControl
                      action={markWaiverInPersonAction}
                      bookingId={booking.id}
                      t={t}
                    />
                  </div>
                ) : null}

                {/* Safety-critical and never disclosed: a flagged medical answer
                    is the one thing on this card that must be read before the
                    diver boards.
                    It carries the **status word** as well as the instruction.
                    A medical hold renders no waiver control — there is nothing
                    to send — so without this the only place the card said
                    "Medical review" was the reference panel, one tap away:
                    the roster would show a warning box telling staff to follow
                    something up without naming the state the diver is in
                    (caught by waivers.spec.ts). */}
                {waiverStatus === "medical_review" ? (
                  <div className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
                    <p className="font-semibold">{waiverControl.label}</p>
                    <p className="mt-0.5 font-medium">{t("trips.roster.followUpBeforeBoarding")}</p>
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

                {/* Whenever this departure takes money — never relocated by
                    what the status happens to be. It briefly lived in the work
                    area while payment was a readiness blocker and behind the
                    disclosure once it was not, which meant the control a
                    staffer had just used to mark a seat Paid vanished into a
                    collapsed panel at the instant it landed. A control that
                    moves out from under the finger that used it is worse than
                    a line of chrome, and "Payment: Paid · Paid on Stripe" is
                    one quiet line, not the bulk this card was carrying. */}
                {requiresPayment ? (
                  <div className="mt-3">
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
                  </div>
                ) : null}

                {/* Task 144 — Today used to send staff here with "ask at the
                    counter" and no field to type it into, so a *missing*
                    contact is work and stays in the open.

                    A contact on file is reference, and lives in the panel
                    below. It sat here in both states for one release, which
                    cost every settled card the heading, the value and an edit
                    link it had no reason to show — a roster of nine grew by
                    about a thousand pixels, which is the opposite of what
                    collapsing the cards was for. The reason given for keeping
                    it open was that a contact just saved must not vanish from
                    under the staffer who typed it; that is real, and it is
                    handled where it belongs — `savedContactBookingId` opens
                    that row's panel on the way back. */}
                {hasEmergencyContact ? null : <div className="mt-3">{emergencyContactBlock}</div>}

                {/* One disclosure, at the top level of the card rather than
                    nested inside "Details" — writing a note about a diver is
                    desk work a staffer starts from here, and behind two taps it
                    stopped being that. */}
                <details className="mt-3 border-t border-border pt-3">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
                    {/* A zero count is the absence of information formatted as
                        information (principle 9) — with no notes the disclosure
                        is simply the door to writing the first one. */}
                    {notes.length === 0
                      ? t("trips.roster.addFirstNoteSummary")
                      : t("trips.roster.privateStaffNotes", { count: notes.length })}
                  </summary>
                  <div className="mt-2 grid gap-3">
                    {notes.map(({ note, authorName }) => (
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
                    {/* Keyed on the note count so a landed note empties the box.
                        Adding one no longer navigates (see `addInternalNoteAction`),
                        and an uncontrolled textarea React never remounts would
                        otherwise still hold the text of the note now listed
                        above it — inviting the same note twice. */}
                    <form key={notes.length} action={addNoteAction} className="grid gap-2">
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

            /**
             * **Reference**: what is merely true about this seat, one tap away.
             */
            const reference = (
              <>
                <div className="mt-3 grid gap-5 sm:grid-cols-2">
                  {/* The signed waiver's own evidence — when, and by which
                      route — and nothing else. Every state that is *not*
                      signed already says so in the open half, as a control to
                      press or a medical hold to read, so a second copy of the
                      same word down here was the card saying one thing twice
                      (principle 9) and, worse, the only visible copy for a
                      status that renders no control. */}
                  {currentWaiver?.completedAt && waiverStatus === "complete" ? (
                    <div>
                      <p className="text-xs font-semibold tracking-widest text-muted uppercase">
                        {t("trips.roster.waiverColumnHeading")}
                      </p>
                      <p className="mt-1 text-sm text-muted">
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
                    </div>
                  ) : null}

                  <div>
                    <p className="text-xs font-semibold tracking-widest text-muted uppercase">
                      {t("trips.roster.rentalFitColumnHeading")}
                    </p>
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

                  {/* A contact already on file: a fact about the seat, which is
                      what this panel is for. Only this state appears here — a
                      missing one is work and stays in the open above, so the
                      card never states the same thing twice (principle 9). */}
                  {hasEmergencyContact ? emergencyContactBlock : null}
                </div>

                {/* `-mx-3` on the row, and both controls at the same `sm`
                    padding. "Remove booking" used to carry a hand-written
                    `px-3` while "Create order" beside it carried none, so the
                    one destructive control on the card was also the only one
                    whose label started a third of a centimetre further in —
                    reading as a nested or misaligned item rather than a peer.
                    The negative margin gives the padded pair back the text
                    column every other line in this panel sits on. */}
                <div className="mt-4 border-t border-border pt-4">
                  <div className="-mx-3 flex flex-wrap items-center gap-x-1 gap-y-2">
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
                        className={buttonClass({ variant: "link", size: "sm" })}
                      >
                        {t("trips.roster.createOrder")}
                      </Link>
                    ) : null}
                    {/* A cancel inside the shop's refund window fires an automatic
                        Stripe refund that the Undo banner can't claw back — a real
                        send of money, not a purely reversible edit — so this gets a
                        blocking confirm too (docs/design/principles.md §7).
                        Last in the row, not flung to its far right: it is already
                        the least prominent thing here and it already confirms
                        before it fires. */}
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
                        triggerClassName={buttonClass({ variant: "ghost", size: "sm" })}
                        confirmClassName={buttonClass({ variant: "danger", size: "sm" })}
                      />
                    </form>
                  </div>
                </div>
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
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {headerLeft}
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {headerBadges}
                  </div>
                </div>
                {outstanding}
                {/* Every card carries this, collapsed — including the ones with
                    work outstanding, which used to be exactly the cards that
                    could not be collapsed. The toggle is its own <summary>
                    below the header rather than wrapping it: a summary is
                    itself interactive, so the diver-name link inside it would
                    be an interactive element nested in another (axe
                    nested-interactive). Deep links (Today, the manifest's
                    "Resolve blockers") land mid-page at one diver;
                    AutoOpenDetails opens this when the hash names the row, so a
                    collapsed card never swallows what the link promised. */}
                <AutoOpenDetails
                  openOnHash={`booking-${booking.id}`}
                  open={savedContactBookingId === booking.id}
                  className="group mt-3 border-t border-border pt-1"
                >
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
                  {reference}
                </AutoOpenDetails>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
