import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";

const NOTICE_MESSAGES: Record<string, { tone: "success" | "danger"; text: string }> = {
  saved: { tone: "success", text: "Changes saved." },
  cancelled: { tone: "danger", text: "Trip cancelled — it's off the public schedule." },
  reinstated: { tone: "success", text: "Back on! The trip is on the schedule again." },
  crew: { tone: "success", text: "Crew updated." },
  "booking-removed": { tone: "success", text: "Booking cancelled — the spot is open again." },
  "booking-restored": { tone: "success", text: "Back on the roster." },
  "waiver-complete": { tone: "success", text: "That diver already has a completed waiver." },
  "waiver-error": {
    tone: "danger",
    text: "That waiver link could not be created. Try a current booking and template.",
  },
  requirements: { tone: "success", text: "Trip readiness requirements updated." },
  payment: { tone: "success", text: "Payment status updated." },
  conditions: { tone: "success", text: "Diver-facing conditions briefing updated." },
  "conditions-cleared": {
    tone: "success",
    text: "Crew prediction cleared. Divers will see the automated outlook when it is available.",
  },
  "gear-assigned": { tone: "success", text: "Gear added to the packing list." },
  "gear-returned": { tone: "success", text: "Gear returned to the gear room." },
  "gear-packed": { tone: "success", text: "Available gear was packed from diver requests." },
  "gear-none": {
    tone: "danger",
    text: "Nothing was packed automatically. Check each diver’s request and live inventory.",
  },
  "gear-error": {
    tone: "danger",
    text: "That gear is no longer available. The packing list has been refreshed.",
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
  undoAction: (formData: FormData) => void;
}) {
  const banner = notice ? NOTICE_MESSAGES[notice] : undefined;
  if (!banner) return null;
  return (
    <div className="mt-6">
      <ShopNotice tone={banner.tone} role={banner.tone === "danger" ? "alert" : "status"}>
        <div className="flex items-center justify-between gap-3">
          <span>{banner.text}</span>
          {undoBookingId ? (
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
