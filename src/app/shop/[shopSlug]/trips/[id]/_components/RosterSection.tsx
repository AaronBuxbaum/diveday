import Link from "next/link";
import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { SubmitButton } from "@/components/SubmitButton";
import { WaiverSendControl } from "@/components/today/WaiverSendControl";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import type { listBookingNotes } from "@/db/operations";
import { birthdayText } from "@/i18n/birthday-labels";
import { depthWarningText } from "@/i18n/depth-labels";
import { readinessBlockerText } from "@/i18n/readiness-labels";
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
import { waiverState } from "@/lib/waivers";
import { PaymentStatusControl, type PaymentStatusControlCopy } from "./PaymentStatusControl";
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
  cancellationDeadline,
  bulkSendWaiversAction,
  markWaiverInPersonAction,
  markPaymentAction,
  removeBookingAction,
  confirmIdentityAction,
  notesByBooking,
  addNoteAction,
  deleteNoteAction,
  depthUnit,
  tripDate,
}: {
  shopSlug: string;
  shopTimezone: string;
  locale: string;
  tripId: string;
  booked: number;
  capacity: number;
  roster: RosterEntry[];
  readinessByBooking: ReadinessByBooking;
  waiverByBooking: WaiverByBooking;
  rentalFitByBooking: RentalFitByBooking;
  nitroxByBooking: NitroxByBooking;
  requiresPayment: boolean;
  /** When free cancellation closes, so staff see a refund cue on paid seats; null = no stated window. */
  cancellationDeadline: Date | null;
  bulkSendWaiversAction: (formData: FormData) => void;
  markWaiverInPersonAction: (formData: FormData) => void;
  markPaymentAction: (formData: FormData) => void;
  removeBookingAction: (formData: FormData) => void;
  confirmIdentityAction: (formData: FormData) => void;
  notesByBooking: Map<string, Awaited<ReturnType<typeof listBookingNotes>>>;
  addNoteAction: (formData: FormData) => void;
  deleteNoteAction: (formData: FormData) => void;
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
  // How many divers still have a waiver a staffer can send or resend — the
  // count the bulk control acts on. A signed or medical-review diver is not
  // offered a checkbox, so ticking "the outstanding list" can't touch them.
  const sendableCount = roster.filter(({ booking }) => {
    const action =
      WAIVER_CONTROLS[waiverState(waiverByBooking.get(booking.id)?.waiver ?? null)].action;
    return action !== null;
  }).length;
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
        {/* Bulk waiver send. The row checkboxes below are associated to this
            form by its id (the HTML `form` attribute), not nested inside it —
            so each per-diver form stays its own island and one action chases
            the whole outstanding list. Only appears when a diver is actually
            sendable, so it's never a dead control. */}
        {sendableCount > 0 ? (
          <form id="roster-bulk" action={bulkSendWaiversAction} className="flex items-center gap-2">
            <span className="text-sm text-muted">{t("trips.roster.tickDiversThen")}</span>
            <SubmitButton
              pendingLabel={t("trips.roster.sending")}
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {t("trips.roster.sendWaiversToSelected")}
            </SubmitButton>
          </form>
        ) : null}
      </div>
      {roster.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          {t("trips.roster.noBookings")}
        </p>
      ) : (
        <ul className="mt-5 grid gap-4">
          {roster.map(({ booking, person }) => {
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
            // A warning, never a gate: the site goes deeper than this diver's
            // training, which an instructor may well have already planned around
            // (H-08). It sits apart from the blocker list for that reason.
            const depth = readinessByBooking.get(booking.id)?.depthAdvisory;
            return (
              <li
                key={booking.id}
                // Today's queue deep-links straight to the diver it is about;
                // scroll-mt keeps the row clear of the sticky shop header.
                id={`booking-${booking.id}`}
                className="scroll-mt-24 rounded-xl border border-border bg-surface p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    {/* Associated to the bulk form above by `form`, not nested,
                        so it can't sit inside this row's own action forms.
                        Only sendable divers get one. */}
                    {waiverControl.action ? (
                      // A bare checkbox has a ~16px hit area — too small for wet or gloved
                      // fingers (design/principles.md #2). This <label> wraps only the
                      // checkbox itself (the diver name below is a separate, sibling
                      // <Link>, untouched by this), so a tap anywhere in the 44px box
                      // forwards to the input — a plain wrapper <span> would not.
                      <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
                        <input
                          type="checkbox"
                          name="bookingId"
                          value={booking.id}
                          form="roster-bulk"
                          aria-label={t("trips.roster.selectToSendWaiverAriaLabel", {
                            name: person.fullName,
                          })}
                          className="size-4 shrink-0"
                        />
                      </label>
                    ) : null}
                    <div className="min-w-0">
                      <Link
                        href={`/shop/${shopSlug}/divers/${person.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {person.fullName}
                      </Link>
                      <p className="text-sm text-muted">
                        {person.email ?? t("trips.roster.noEmailOnFile")}
                      </p>
                      {age !== null ? (
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                          <span className="tabular-nums">
                            {t("trips.roster.ageYears", { age })}
                          </span>
                          {/* Text, never colour alone — this is read in sunlight
                              on a moving boat (design/principles.md #2). */}
                          {minor ? (
                            <Badge tone="warning" size="sm">
                              {t("trips.roster.minorBadge")}
                            </Badge>
                          ) : null}
                          {/* The cake carries the meaning; the words are just
                              when. `sr-only` keeps that legible to a screen
                              reader, which would otherwise hear "in 2d" alone. */}
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
                  {readiness ? (
                    <Badge
                      tone={readiness.status === "ready" ? "success" : "danger"}
                      className="shrink-0"
                    >
                      {readiness.status === "ready"
                        ? t("trips.roster.ready")
                        : t("trips.roster.needsAttention")}
                    </Badge>
                  ) : null}
                </div>
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
                    <SubmitButton
                      pendingLabel={t("trips.roster.confirming")}
                      confirmMessage={t("trips.roster.confirmIdentityMessage", {
                        name: person.fullName,
                      })}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      {t("trips.roster.confirmThisIs", { name: person.fullName })}
                    </SubmitButton>
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
                      // the app never sees. Same immutable record, staff-attested.
                      // The medical clearance is its own required control, not a
                      // buried confirm — a flagged medical must use the digital
                      // link, which captures the questionnaire and routes to review.
                      <details className="mt-2">
                        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary hover:underline">
                          {t("trips.roster.markSignedOnPaper")}
                        </summary>
                        <form
                          action={markWaiverInPersonAction}
                          className="mt-2 max-w-md rounded-lg border border-border bg-surface-sunken/50 p-3"
                        >
                          <input type="hidden" name="bookingId" value={booking.id} />
                          <label className="flex items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              name="medicalAttested"
                              required
                              className="mt-1 size-4 shrink-0"
                            />
                            <span>{t("trips.roster.medicalAttestationLabel")}</span>
                          </label>
                          <SubmitButton
                            pendingLabel={t("trips.roster.recording")}
                            className={buttonClass({
                              variant: "secondary",
                              size: "sm",
                              className: "mt-3",
                            })}
                          >
                            {t("trips.roster.recordPaperSignature")}
                          </SubmitButton>
                        </form>
                      </details>
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
                  <Link
                    href={`/shop/${shopSlug}/orders/new?personId=${person.id}&bookingId=${booking.id}`}
                    className="inline-flex min-h-11 items-center py-2 text-sm font-medium text-primary hover:underline"
                  >
                    {t("trips.roster.createOrder")}
                  </Link>
                  {/* A cancel inside the shop's refund window fires an automatic
                      Stripe refund that the Undo banner can't claw back — a real
                      send of money, not a purely reversible edit — so this gets a
                      blocking confirm too (docs/design/principles.md §7). */}
                  <form action={removeBookingAction} className="sm:ml-auto">
                    <input type="hidden" name="bookingId" value={booking.id} />
                    <SubmitButton
                      pendingLabel={t("trips.roster.removing")}
                      confirmMessage={t("trips.roster.confirmRemoveBooking", {
                        name: person.fullName,
                      })}
                      className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-muted transition-colors duration-200 hover:bg-danger/10 hover:text-danger focus-visible:text-danger"
                    >
                      {t("trips.roster.removeBooking")}
                    </SubmitButton>
                  </form>
                </div>
                <details className="mt-4 border-t border-border pt-4">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-primary">
                    {t("trips.roster.privateStaffNotes", {
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
                          <SubmitButton
                            pendingLabel={t("trips.roster.deletingEllipsis")}
                            confirmMessage={t("trips.roster.confirmDeleteNote")}
                            className="rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
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
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
