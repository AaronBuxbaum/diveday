import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import type { RentalGearProfile, RentalGearRequest } from "@/db/schema";
import { formatDateTimeTz } from "@/lib/format";
import { flaggedMedicalPrompts } from "@/lib/medical";
import { waiverState } from "@/lib/waivers";
import type {
  AvailableGear,
  GearByBooking,
  GearProfileByBooking,
  GearRequestByBooking,
  ReadinessByBooking,
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

function rentalRequestSummary(
  request: RentalGearRequest | null | undefined,
  profile: RentalGearProfile | null | undefined,
) {
  if (!request && !profile) return "No rental request yet.";
  const requested = [
    request?.bcd && "BCD",
    request?.regulator && "regulator",
    request?.wetsuit && "wetsuit",
    request?.maskFins && "mask & fins",
    request?.weights && "weights",
    request?.tank && "tank",
    request?.diveComputer && "computer",
  ].filter(Boolean);
  const fit = [
    (request?.bcdSize ?? profile?.bcdSize) && `BCD ${request?.bcdSize ?? profile?.bcdSize}`,
    (request?.wetsuitSize ?? profile?.wetsuitSize) &&
      `wetsuit ${request?.wetsuitSize ?? profile?.wetsuitSize}`,
    (request?.bootSize ?? profile?.bootSize) && `boot ${request?.bootSize ?? profile?.bootSize}`,
    (request?.finSize ?? profile?.finSize) && `fin ${request?.finSize ?? profile?.finSize}`,
    request?.weightPreference ?? profile?.weightPreference,
  ].filter(Boolean);
  return [requested.length > 0 ? requested.join(", ") : "No rental set requested", fit.join(" · ")]
    .filter(Boolean)
    .join(" — ");
}

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
  shopName,
  shopTimezone,
  tripId,
  tripTitle,
  booked,
  capacity,
  roster,
  readinessByBooking,
  waiverByBooking,
  gearByBooking,
  gearRequestByBooking,
  gearProfileByBooking,
  availableGear,
  requiresPayment,
  assignRecommendedGearAction,
  issueWaiverAction,
  returnGearAction,
  assignGearAction,
  markPaymentAction,
  removeBookingAction,
}: {
  shopSlug: string;
  shopName: string;
  shopTimezone: string;
  tripId: string;
  tripTitle: string;
  booked: number;
  capacity: number;
  roster: RosterEntry[];
  readinessByBooking: ReadinessByBooking;
  waiverByBooking: WaiverByBooking;
  gearByBooking: GearByBooking;
  gearRequestByBooking: GearRequestByBooking;
  gearProfileByBooking: GearProfileByBooking;
  availableGear: AvailableGear;
  requiresPayment: boolean;
  assignRecommendedGearAction: () => void;
  issueWaiverAction: (formData: FormData) => void;
  returnGearAction: (formData: FormData) => void;
  assignGearAction: (formData: FormData) => void;
  markPaymentAction: (formData: FormData) => void;
  removeBookingAction: (formData: FormData) => void;
}) {
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
            Readiness, waiver, gear, and payment for each diver — together in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <form action={assignRecommendedGearAction}>
            <SubmitButton
              pendingLabel="Packing…"
              className={buttonClass({
                variant: "secondary",
                className: "text-foreground",
              })}
            >
              Pack recommendations
            </SubmitButton>
          </form>
          <Link
            href={`/shop/${shopSlug}/gear`}
            className="inline-flex min-h-11 items-center py-2 text-sm font-medium text-primary hover:underline"
          >
            Gear room
          </Link>
          <Link
            href={`/shop/${shopSlug}/trips/${tripId}/manifest`}
            className="inline-flex min-h-11 items-center py-2 text-sm font-medium text-primary hover:underline"
          >
            Boat manifest
          </Link>
          <Link
            href={`/shop/${shopSlug}/trips/${tripId}/nitrox`}
            className="inline-flex min-h-11 items-center py-2 text-sm font-medium text-primary hover:underline"
          >
            Nitrox fills
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
            const currentWaiver = waiverByBooking.get(booking.id)?.waiver ?? null;
            const waiverStatus = waiverState(currentWaiver);
            const waiverControl = WAIVER_CONTROLS[waiverStatus];
            const flaggedPrompts =
              waiverStatus === "medical_review" && currentWaiver?.medicalAnswers
                ? flaggedMedicalPrompts(currentWaiver.medicalAnswers)
                : [];
            const assignedGear = gearByBooking.get(booking.id) ?? [];
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
                          <input type="hidden" name="shopName" value={shopName} />
                          <input type="hidden" name="tripTitle" value={tripTitle} />
                          <input type="hidden" name="shopTimezone" value={shopTimezone} />
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
                    {currentWaiver?.completedAt && waiverStatus === "complete" ? (
                      <p className="mt-2 text-sm text-muted">
                        Signed {formatDateTimeTz(currentWaiver.completedAt, "en-US", shopTimezone)}
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
                      Gear
                    </p>
                    <p className="mt-2 text-sm text-muted">
                      {rentalRequestSummary(
                        gearRequestByBooking.get(booking.id),
                        gearProfileByBooking.get(booking.id),
                      )}
                    </p>
                    {assignedGear.length === 0 ? (
                      <p className="mt-2 text-sm text-muted">Nothing packed yet.</p>
                    ) : (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {assignedGear.map((item) => (
                          <li
                            key={item.assignmentId}
                            className="flex items-center gap-1 rounded-full bg-primary/10 pl-3 text-sm font-medium text-primary"
                          >
                            {item.label} <span className="font-normal">({item.type})</span>
                            <form action={returnGearAction}>
                              <input type="hidden" name="assignmentId" value={item.assignmentId} />
                              <button
                                type="submit"
                                aria-label={`Return ${item.label}`}
                                className="inline-flex min-h-11 items-center px-3 font-semibold hover:underline"
                              >
                                Return
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    )}
                    {availableGear.length > 0 ? (
                      <form action={assignGearAction} className="mt-2 flex flex-wrap gap-2">
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <select
                          name="gearItemId"
                          aria-label={`Assign gear to ${person.fullName}`}
                          defaultValue=""
                          className={`${controlClass} min-w-44 flex-1`}
                        >
                          <option value="" disabled>
                            Choose available gear
                          </option>
                          {availableGear.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label} · {item.type.replace("_", " ")}
                              {item.size ? ` · ${item.size}` : ""}
                            </option>
                          ))}
                        </select>
                        <SubmitButton
                          pendingLabel="Packing…"
                          className={buttonClass({
                            variant: "secondary",
                            className: "text-foreground",
                          })}
                        >
                          Pack
                        </SubmitButton>
                      </form>
                    ) : (
                      <p className="mt-2 text-sm text-muted">No available gear right now.</p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
                  {requiresPayment ? (
                    <form action={markPaymentAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="bookingId" value={booking.id} />
                      <span className="text-sm text-muted">
                        Payment: {PAYMENT_LABELS[paymentStatus ?? "unpaid"]}
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
                  <form action={removeBookingAction} className="sm:ml-auto">
                    <input type="hidden" name="bookingId" value={booking.id} />
                    <SubmitButton
                      pendingLabel="Removing…"
                      confirmMessage={`Remove ${person.fullName} from this trip? Their spot opens back up.`}
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
