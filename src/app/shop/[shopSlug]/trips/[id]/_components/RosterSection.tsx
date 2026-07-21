import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { nowDate } from "@/lib/clock";
import { rentalFitLine } from "@/lib/dive-prep";
import { formatDateTimeTz } from "@/lib/format";
import { flaggedMedicalPrompts } from "@/lib/medical";
import { paymentSourceLine } from "@/lib/payment-source";
import { waiverState } from "@/lib/waivers";
import type {
  NitroxByBooking,
  ReadinessByBooking,
  RentalFitByBooking,
  RosterEntry,
  WaiverByBooking,
} from "./types";

type PaymentStatus = "unpaid" | "deposit_paid" | "paid" | "waived" | "refunded";

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  deposit_paid: "Deposit paid",
  paid: "Paid",
  waived: "Waived",
  refunded: "Refunded",
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

const WAIVER_CONTROLS: Record<ReturnType<typeof waiverState>, WaiverControl> = {
  not_sent: {
    label: "Send waiver",
    tone: "border border-border bg-surface hover:bg-surface-sunken",
    action: "send",
    confirm: false,
  },
  awaiting_signature: {
    label: "Waiver sent",
    hint: "Resend",
    tone: "border border-border bg-surface hover:bg-surface-sunken",
    action: "resend",
    confirm: true,
  },
  expired: {
    label: "Link expired",
    tone: "border border-danger/40 text-danger hover:bg-danger/10",
    action: "resend",
    confirm: false,
  },
  complete: {
    label: "Waiver signed",
    tone: "bg-success/10 text-success",
    action: null,
    confirm: false,
  },
  medical_review: {
    label: "Medical review",
    tone: "bg-warning/10 text-warning",
    action: null,
    confirm: false,
  },
};

export function RosterSection({
  shopSlug,
  shopTimezone,
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
  issueWaiverAction,
  markWaiverInPersonAction,
  markPaymentAction,
  removeBookingAction,
}: {
  shopSlug: string;
  shopTimezone: string;
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
  issueWaiverAction: (formData: FormData) => void;
  markWaiverInPersonAction: (formData: FormData) => void;
  markPaymentAction: (formData: FormData) => void;
  removeBookingAction: (formData: FormData) => void;
}) {
  const refundEligible = cancellationDeadline !== null && cancellationDeadline > nowDate();
  return (
    <section id="roster" className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            Divers{" "}
            <span className="font-normal text-muted tabular-nums">
              {booked} of {capacity}
            </span>
          </h2>
          <p className="mt-1 text-sm text-muted">
            Readiness, waiver, rental fit, and payment for each diver — together in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link
            href={`/shop/${shopSlug}/trips/${tripId}/prep`}
            className="inline-flex min-h-11 items-center py-2 text-sm font-medium text-primary hover:underline"
          >
            Prep list
          </Link>
          <Link
            href={`/shop/${shopSlug}/trips/${tripId}/manifest`}
            className="inline-flex min-h-11 items-center py-2 text-sm font-medium text-primary hover:underline"
          >
            Boat manifest
          </Link>
        </div>
      </div>
      {roster.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
          No bookings yet — share the trip page and they'll show up here.
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
            return (
              <li
                key={booking.id}
                // Today's queue deep-links straight to the diver it is about;
                // scroll-mt keeps the row clear of the sticky shop header.
                id={`booking-${booking.id}`}
                className="scroll-mt-24 rounded-xl border border-border bg-surface p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/shop/${shopSlug}/divers/${person.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {person.fullName}
                    </Link>
                    <p className="text-sm text-muted">{person.email ?? "no email on file"}</p>
                  </div>
                  {readiness ? (
                    readiness.status === "ready" ? (
                      <span className="shrink-0 rounded-full bg-success/10 px-3 py-1 text-sm font-medium text-success">
                        Ready
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-danger/10 px-3 py-1 text-sm font-medium text-danger">
                        Needs attention
                      </span>
                    )
                  ) : null}
                </div>

                {readiness && readiness.status !== "ready" ? (
                  <ul className="mt-3 grid gap-2 rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
                    {readiness.blockers.map((blocker) => (
                      <li key={blocker.message} className="flex gap-2">
                        <span aria-hidden="true">!</span>
                        <span>{blocker.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-4 grid gap-5 border-t border-border pt-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold tracking-widest text-muted uppercase">
                      Waiver
                    </p>
                    <div className="mt-2">
                      {waiverControl.action ? (
                        <form action={issueWaiverAction}>
                          <input type="hidden" name="bookingId" value={booking.id} />
                          <SubmitButton
                            pendingLabel={
                              waiverControl.action === "send" ? "Sending…" : "Resending…"
                            }
                            confirmMessage={
                              waiverControl.confirm
                                ? `Send ${person.fullName} a new waiver link? Their previous link will stop working.`
                                : undefined
                            }
                            className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors duration-200 ${waiverControl.tone}`}
                          >
                            {waiverControl.label}
                            {waiverControl.hint ? (
                              <>
                                <span aria-hidden="true" className="opacity-40">
                                  ·
                                </span>
                                <span className="font-normal opacity-70">{waiverControl.hint}</span>
                              </>
                            ) : null}
                          </SubmitButton>
                        </form>
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
                          Mark signed on paper
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
                            <span>
                              I have this diver&apos;s signed release on file and have reviewed
                              their medical questionnaire — no answer needs physician sign-off.
                            </span>
                          </label>
                          <SubmitButton
                            pendingLabel="Recording…"
                            className={buttonClass({
                              variant: "secondary",
                              size: "sm",
                              className: "mt-3",
                            })}
                          >
                            Record paper signature
                          </SubmitButton>
                        </form>
                      </details>
                    ) : null}
                    {currentWaiver?.completedAt && waiverStatus === "complete" ? (
                      <p className="mt-2 text-sm text-muted">
                        Signed {formatDateTimeTz(currentWaiver.completedAt, "en-US", shopTimezone)}
                        {currentWaiver.signatureMethod === "in_person_attested"
                          ? " · recorded from a paper copy"
                          : ""}
                      </p>
                    ) : null}
                    {waiverStatus === "medical_review" ? (
                      <div className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
                        <p className="font-medium">Follow up before boarding</p>
                        {flaggedPrompts.length > 0 ? (
                          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
                            {flaggedPrompts.map((prompt) => (
                              <li key={prompt}>{prompt}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1">
                            A diver answered yes to a medical question. Confirm physician clearance
                            before boarding.
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <p className="text-xs font-semibold tracking-widest text-muted uppercase">
                      Rental fit
                    </p>
                    <p className="mt-2 text-sm text-muted">
                      {rentalFitLine(rentalFitByBooking.get(booking.id) ?? null).text}
                    </p>
                    {nitrox ? (
                      <p className="mt-2 text-sm font-medium text-primary">
                        {nitrox.approved
                          ? "Nitrox requested — verified card, billed per dive. The mix is still analyzed and signed for at the fill station."
                          : "Nitrox requested, but no verified card. Planned as air."}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
                  {requiresPayment ? (
                    <form action={markPaymentAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="bookingId" value={booking.id} />
                      <span className="text-sm text-muted">
                        Payment: {PAYMENT_LABELS[paymentStatus ?? "unpaid"]}
                        {paymentSource ? (
                          <span className="text-muted"> · {paymentSource}</span>
                        ) : null}
                        {refundEligible &&
                        cancellationDeadline &&
                        (paymentStatus === "paid" || paymentStatus === "deposit_paid") ? (
                          <span className="text-muted">
                            {" "}
                            · Refund-eligible until{" "}
                            {formatDateTimeTz(cancellationDeadline, "en-US", shopTimezone)}
                          </span>
                        ) : null}
                      </span>
                      <select
                        name="status"
                        defaultValue={paymentStatus ?? "unpaid"}
                        className="min-h-11 items-center rounded-lg border border-border-strong bg-surface px-2 text-sm"
                      >
                        {Object.entries(PAYMENT_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <SubmitButton
                        pendingLabel="Updating…"
                        className={buttonClass({
                          variant: "secondary",
                          size: "sm",
                          className: "text-foreground",
                        })}
                      >
                        Update
                      </SubmitButton>
                    </form>
                  ) : null}
                  <Link
                    href={`/shop/${shopSlug}/orders/new?personId=${person.id}&bookingId=${booking.id}`}
                    className="inline-flex min-h-11 items-center py-2 text-sm font-medium text-primary hover:underline"
                  >
                    Create order
                  </Link>
                  {/* Reversible: removal shows an Undo banner, so it takes no
                      blocking confirm (docs/design/principles.md §7). */}
                  <form action={removeBookingAction} className="sm:ml-auto">
                    <input type="hidden" name="bookingId" value={booking.id} />
                    <SubmitButton
                      pendingLabel="Removing…"
                      className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-muted transition-colors duration-200 hover:bg-danger/10 hover:text-danger focus-visible:text-danger"
                    >
                      Remove booking
                    </SubmitButton>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
