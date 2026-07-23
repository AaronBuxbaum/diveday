import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";

const NOTICE_MESSAGES: Record<string, { tone: "success" | "danger"; text: string }> = {
  saved: { tone: "success", text: "Changes saved." },
  cancelled: { tone: "danger", text: "Trip cancelled — it's off the public schedule." },
  reinstated: { tone: "success", text: "Back on! The trip is on the schedule again." },
  crew: { tone: "success", text: "Crew updated." },
  "booking-removed": { tone: "success", text: "Booking cancelled — the spot is open again." },
  "booking-removed-refunded": {
    tone: "success",
    text: "Booking cancelled and the payment refunded — the spot is open again.",
  },
  "booking-removed-forfeit": {
    tone: "success",
    text: "Booking cancelled — the spot is open again. It was past the cancellation window, so the seat was non-refundable.",
  },
  "booking-removed-refund-manual": {
    tone: "danger",
    text: "Booking cancelled — a refund is owed but must be issued by hand (counter payment, or Stripe isn't connected). Refund from the diver's payments.",
  },
  "booking-removed-refund-failed": {
    tone: "danger",
    text: "Booking cancelled, but the automatic refund didn't go through — issue it from the diver's payments.",
  },
  "booking-removed-refund-review": {
    tone: "danger",
    text: "Booking cancelled. The payment record and Stripe disagree on what was captured — review the diver's payments before issuing any refund.",
  },
  "booking-restored": { tone: "success", text: "Back on the roster." },
  "booking-restore-full": {
    tone: "danger",
    text: "Couldn't undo — the freed spot has been taken and the trip is full again. Add them to the wait list instead.",
  },
  "diver-added": { tone: "success", text: "Diver added to the trip." },
  "diver-waitlisted": { tone: "success", text: "Diver added to the wait list." },
  "diver-invalid": { tone: "danger", text: "Enter a name and a valid email to add a diver." },
  "diver-full": {
    tone: "danger",
    text: "That trip is full — add them to the wait list instead.",
  },
  "diver-waitlist-available": {
    tone: "danger",
    text: "There's room on this trip — add them to the trip instead of the wait list.",
  },
  "diver-already": { tone: "danger", text: "That diver already has a booking on this trip." },
  "diver-course-unstaffed": {
    tone: "danger",
    text: "This course session needs an instructor assigned before you can add divers.",
  },
  "diver-course-prerequisite": {
    tone: "danger",
    text: "That diver doesn't have a verified certification on file for this course's prerequisite.",
  },
  "diver-unavailable": { tone: "danger", text: "This trip can't accept new divers right now." },
  "waiver-complete": { tone: "success", text: "That diver already has a completed waiver." },
  "waiver-in-person": {
    tone: "success",
    text: "Paper waiver recorded — the diver's release is on file.",
  },
  "waiver-medical-attestation": {
    tone: "danger",
    text: "Confirm you reviewed the medical questionnaire before recording a paper waiver — or send the digital link so the diver answers it.",
  },
  "waiver-error": {
    tone: "danger",
    text: "That waiver link could not be created. Try a current booking and template.",
  },
  "bulk-waiver": {
    tone: "success",
    text: "Waiver links sent to the selected divers who still needed one — anyone already signed was left alone.",
  },
  "bulk-waiver-none": {
    tone: "danger",
    text: "Tick at least one diver, then send the waiver to the whole selection.",
  },
  requirements: { tone: "success", text: "Trip readiness requirements updated." },
  payment: { tone: "success", text: "Payment status updated." },
  conditions: { tone: "success", text: "Diver-facing conditions briefing updated." },
  "conditions-cleared": {
    tone: "success",
    text: "Crew prediction cleared. Divers will see the automated outlook when it is available.",
  },
  invalid: {
    tone: "danger",
    text: "That didn't save — check the date, times, and capacity, then try again.",
  },
  "end-before-start": { tone: "danger", text: "The trip has to end after it starts." },
};

export function TripNoticeBanner({
  notice,
  undoBookingId,
  undoAction,
}: {
  notice?: string;
  undoBookingId?: string;
  // Only the roster's reversible removals carry an undo; Overview's config
  // notices render the same banner without one.
  undoAction?: (formData: FormData) => void;
}) {
  const banner = notice ? NOTICE_MESSAGES[notice] : undefined;
  if (!banner) return null;
  return (
    <div className="mt-6">
      <ShopNotice tone={banner.tone} role={banner.tone === "danger" ? "alert" : "status"}>
        <div className="flex items-center justify-between gap-3">
          <span>{banner.text}</span>
          {undoBookingId && undoAction ? (
            <form action={undoAction}>
              <input type="hidden" name="bookingId" value={undoBookingId} />
              <SubmitButton
                pendingLabel="Undoing…"
                className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 font-semibold underline-offset-2 hover:underline"
              >
                Undo
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </ShopNotice>
    </div>
  );
}
