"use server";

/**
 * Who a departure admits and on what terms: the participant prices and seats,
 * and the admission requirements. Trip definition, so both go through
 * `requireTripConfig`.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { listTripReadiness, upsertTripRequirements } from "@/db/readiness";
import { readRequiredSpecialties } from "@/db/requirement-form";
import { getShopCurrency } from "@/db/stripe-accounts";
import { getTripWithBooked, setTripParticipantTerms } from "@/db/trips";
import { checkbox, formValue, readForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { parseParticipantTerms } from "@/lib/participant-terms";
import { paymentGateIsUnclearable, REQUIRABLE_CERTIFICATION_LEVELS } from "@/lib/readiness";
import { noticeUrl } from "@/lib/staff-notices";
import { tripPath } from "./roster-booking";
import { requireTripConfig } from "./trip-config";

const requirementsSchema = z.object({
  requiresWaiver: z.string().optional(),
  // The requirable set, not the ladder: Divemaster and Instructor are working
  // ratings and a departure may not demand one of a paying diver (issue #630).
  // Read off `REQUIRABLE_CERTIFICATION_LEVELS` rather than respelled, so the
  // picker and the parse can never disagree about what a shop may ask for.
  minimumCertificationLevel: z.preprocess(
    (value) => (value === "" ? null : value),
    z.enum(REQUIRABLE_CERTIFICATION_LEVELS).nullable(),
  ),
});
/**
 * A departure's snorkeler price, rider price and diver seats (ADR
 * 20261007-participant-types). Trip configuration, so the same gate as the
 * requirements form; the parse is `parseParticipantTerms` and the rules the
 * database holds under the trip lock are `setTripParticipantTerms`.
 */
const participantTermsForm = z.object({
  snorkelerPrice: formValue(),
  riderPrice: formValue(),
  diverSeats: formValue(),
});

/** The requirement switches: on only when the box sent `"on"`. */
const requirementSwitchesForm = z.object({
  requiresNitrox: checkbox(),
  requiresPayment: checkbox(),
});

export async function saveParticipantTermsAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const db = await getDb();
  const trip = await getTripWithBooked(db, s.user.shopId, tripId);
  if (!trip) redirect(back);
  const parsed = parseParticipantTerms(readForm(participantTermsForm, formData), {
    currency: await getShopCurrency(db, s.user.shopId),
    capacity: trip.capacity,
  });
  if (!parsed.ok) redirect(noticeUrl(back, "participant-terms-invalid"));
  const outcome = await setTripParticipantTerms(db, s.user.shopId, tripId, parsed.patch);
  if (!outcome.ok) {
    redirect(
      outcome.reason === "diver_seats_below_booked"
        ? noticeUrl(back, "participant-terms-below-booked", { count: outcome.detail.divers })
        : noticeUrl(back, "participant-terms-invalid"),
    );
  }
  revalidateAndRedirect(back, noticeUrl(back, "participant-terms-saved"));
}

export async function saveRequirementsAction(shopSlug: string, tripId: string, formData: FormData) {
  const back = tripPath(shopSlug, tripId);
  const s = await requireTripConfig(shopSlug, tripId);
  const db = await getDb();
  // Re-derive the course flag server-side rather than trusting a client field:
  // a course session's admission rules are frozen and must not be editable here,
  // and upsertTripRequirements has no independent course check.
  const trip = await getTripWithBooked(db, s.user.shopId, tripId);
  if (trip?.courseId) redirect(noticeUrl(back, "invalid", { form: "requirements" }));
  const parsed = requirementsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(back, "invalid", { form: "requirements" }));
  const switches = readForm(requirementSwitchesForm, formData);
  const specialties = readRequiredSpecialties(formData);
  if (!specialties) redirect(noticeUrl(back, "invalid", { form: "requirements" }));
  // A payment gate on an unpriced departure blocks every diver who books it,
  // forever, and nothing ever asks them for money — so this one combination is
  // refused rather than saved and explained afterwards (issue #692).
  if (paymentGateIsUnclearable(switches.requiresPayment, trip?.priceCents ?? null)) {
    redirect(noticeUrl(back, "requirements-need-price", { form: "requirements" }));
  }
  // Who was already blocked, read *before* the write — see the count below.
  const blockedBefore = new Set(
    (await listTripReadiness(db, s.user.shopId, tripId))
      .filter((row) => row.readiness.status === "blocked")
      .map((row) => row.booking.id),
  );
  const saved = await upsertTripRequirements(db, {
    shopId: s.user.shopId,
    tripId,
    requiresWaiver: parsed.data.requiresWaiver === "on",
    minimumCertificationLevel: parsed.data.minimumCertificationLevel,
    requiredSpecialties: specialties,
    requiresNitrox: switches.requiresNitrox,
    requiresPayment: switches.requiresPayment,
  });
  if (!saved) redirect(noticeUrl(back, "invalid", { form: "requirements" }));
  // **Who this just blocked.** Readiness is computed live from the trip's
  // current requirement row and the sites it visits, so a tightened gate
  // already reaches every booked diver the moment it is saved — they turn up
  // blocked on Today, the schedule board, the roster, and the manifest without
  // anything here re-checking them. What was missing is that the staffer who
  // tightened it walked away not knowing, and found out when a diver did.
  //
  // So this is a notice, not a gate: it never refuses the save (a shop may
  // legitimately tighten a gate and then work the roster), it just counts who
  // the new rule left behind.
  //
  // **Blocked status, differenced across the save** — not a filter on blocker
  // category. This counted only `certification` blockers, so ticking "Requires
  // waiver" on a roster nobody had signed, or "Requires payment" on a roster
  // nobody had paid, blocked every diver aboard and reported *zero* — and then
  // rendered the reassuring plain-success notice, which actively says nobody
  // was affected. Those two are the toggles most likely to block a whole
  // roster at once, because certification varies diver by diver while "has
  // anyone paid yet" is usually uniform: the notice was quietest exactly where
  // it had the most to say (issue #693).
  //
  // The difference, rather than the total, is what makes the sentence true —
  // it says these divers "no longer meet" the requirements, and a departure
  // where nobody had signed yet was already showing them as blocked. It also
  // needs no category list to maintain: a `setup` blocker cannot *appear* from
  // saving a requirement row (saving is what clears `requirements_not_configured`),
  // so nothing has to be excluded by hand. The cost is one extra readiness pass
  // over one boat's roster, on a form submit that already redirects.
  const blocked = (await listTripReadiness(db, s.user.shopId, tripId)).filter(
    (row) => row.readiness.status === "blocked" && !blockedBefore.has(row.booking.id),
  ).length;
  revalidateAndRedirect(
    back,
    blocked > 0
      ? noticeUrl(back, "requirements-blocking", { count: blocked })
      : noticeUrl(back, "requirements"),
  );
}
