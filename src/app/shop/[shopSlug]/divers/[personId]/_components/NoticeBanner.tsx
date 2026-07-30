/**
 * One entry per notice, carrying its own tone. Previously this was a ternary
 * chain with a hand-maintained parallel list of which codes were errors —
 * adding a danger notice to one and not the other rendered a failure in
 * success green. Tone lives with the text so the two cannot drift.
 */
const NOTICE_MESSAGES: Record<string, { tone: "success" | "danger"; text: string }> = {
  captured: {
    tone: "success",
    text: "Card captured as pending. Look the number up with the agency, then mark it certified before it can make this diver ready.",
  },
  "captured-no-photo": {
    tone: "success",
    text: "Card captured as pending. Photo storage isn’t set up for this shop, so no photo was attached.",
  },
  verified: { tone: "success", text: "Card marked certified. It now counts toward readiness." },
  "card-deleted": {
    tone: "success",
    text: "Card removed. It no longer counts toward readiness; its history is kept for records.",
  },
  "card-restored": { tone: "success", text: "Card restored. It counts toward readiness again." },
  "card-restore-conflict": {
    tone: "danger",
    text: "Couldn't restore that card — another card now uses its number. Re-add it if you still need it.",
  },
  "person-saved": { tone: "success", text: "Diver details updated." },
  "profile-saved": { tone: "success", text: "Rental fit profile saved." },
  "fit-flagged": {
    tone: "success",
    text: "Flagged for hands-on fitting. The prep list will show this diver needs staff sizing at check-in.",
  },
  "fit-cleared": {
    tone: "success",
    text: "Fit flag cleared — this diver packs from their stated sizes again.",
  },
  image: {
    tone: "danger",
    text: "That photo could not be used. Upload a JPG, PNG, or WebP under 5 MB.",
  },
  duplicate: { tone: "danger", text: "Another diver already uses that email in this shop." },
  refunded: {
    tone: "success",
    text: "Payment refunded — the trip now shows as unpaid for this diver.",
  },
  booked: {
    tone: "success",
    text: "Activity booked. Review it below, then create and send the invoice.",
  },
  trip_full: { tone: "danger", text: "That activity just filled up. Choose another." },
  already_booked: { tone: "danger", text: "This diver is already booked on that activity." },
  course_unstaffed: { tone: "danger", text: "Assign an instructor before booking this course." },
  course_prerequisite: {
    tone: "danger",
    text: "Mark the required certification as certified before booking this course.",
  },
  course_ratio_full: {
    tone: "danger",
    text: "This session is at its instructor-to-student ratio limit. Assign another instructor or certified assistant, or choose another activity.",
  },
  course_min_age: {
    tone: "danger",
    text: "This diver is under that course's minimum age on the day it runs, going by the date of birth on file. Correct the date of birth if it's wrong.",
  },
  trip_unavailable: { tone: "danger", text: "Add an email and choose an available activity." },
  "booking-invalid": { tone: "danger", text: "Add an email and choose an available activity." },
  "refund-failed": {
    tone: "danger",
    text: "That payment could not be refunded. It may not be paid, or Stripe may need attention.",
  },
  "demo-disabled": {
    tone: "success",
    text: "This is a demo order — it isn’t backed by a live Stripe invoice, so it can’t be refunded.",
  },
  deleted: {
    tone: "success",
    text: "Diver removed from active shop work. Their bookings and cards are preserved.",
  },
  "not-authorized-refund": {
    tone: "danger",
    text: "Refunds are limited to owners and managers — ask one of them to issue this refund.",
  },
  "not-authorized-delete": {
    tone: "danger",
    text: "Removing a diver is limited to owners and managers — ask one of them to do it.",
  },
  "not-authorized-fit": {
    tone: "danger",
    text: "Changing a diver's stated rental fit is limited to owners, managers, instructors, and divemasters. You can still flag them for hands-on fitting at check-in.",
  },
  "card-sighting-required": {
    tone: "danger",
    text: "Confirming an imported card needs the checkbox: it opens the dive or the fill that card allows, so a staffer has to say they've actually seen it or checked the number with the agency.",
  },
  invalid: { tone: "danger", text: "Check the details and try again." },
};

export function NoticeBanner({ notice }: { notice?: string }) {
  // `Object.hasOwn`, not a bare lookup: `notice` is an attacker-supplied query
  // param, and `?notice=constructor` would otherwise return a truthy inherited
  // value and render an empty banner.
  const banner =
    notice && Object.hasOwn(NOTICE_MESSAGES, notice) ? NOTICE_MESSAGES[notice] : undefined;
  if (!banner) return null;

  return (
    <p
      role="status"
      className={`mt-6 rounded-lg px-4 py-3 text-sm font-medium ${banner.tone === "danger" ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`}
    >
      {banner.text}
    </p>
  );
}
