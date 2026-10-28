"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { confirmBookingIdentity, splitBookingIdentity } from "@/db/bookings";
import { getDb } from "@/db/client";
import { repointHeldBooking } from "@/db/identity-repoint";
import { applyPaidRentalKindsToFit } from "@/db/rental-fit";
import { type IdentityReleaseOutcome, sendReleasesOnceIdentityKnown } from "@/db/waiver-issue";
import { saveBookingEmergencyContact } from "@/db/waivers";
import { emergencyContactSchema } from "@/lib/contact";
import { checkbox, readForm, text } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { blankableDiverEmailSchema, diverPhoneSchema } from "@/lib/person-fields";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { requireRosterBooking, tripPath } from "./roster-booking";

const confirmIdentityForm = z.object({
  bookingId: text(),
  heldContact: text(),
  applyPaidGear: checkbox(),
});

const splitIdentityForm = z.object({
  bookingId: text(),
  email: text(),
  phone: text(),
  fullName: text(),
  dateOfBirth: text(),
  adultAttested: checkbox("yes"),
  sameNameSeatIds: text(),
});

const repointIdentityForm = z.object({
  bookingId: text(),
  toPersonId: text(),
  sameNameSeatIds: text(),
});

const rosterBookingForm = z.object({ bookingId: text() });

/**
 * Staff confirm a flagged booking is the person it was attached to (H-13),
 * clearing the `identity_unconfirmed` readiness blocker. Same shop-scoped
 * session gate as every roster action; a no-op on an already-clear booking
 * still settles cleanly so a double-tap is harmless.
 *
 * Open to every staff role, and what carries that is the trail
 * `confirmBookingIdentity` writes under this staffer's name — see its docblock
 * for what the tap hands over and why the role list stays where it is.
 */
export async function confirmDiverIdentityAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const form = readForm(confirmIdentityForm, formData);
  const { bookingId } = form;
  if (!uuidParam(bookingId)) redirect(back);
  const db = await getDb();
  await requireRosterBooking(db, s.user.shopId, tripId, bookingId, back);
  // Which emergency contact stands, when the seat's and the record's differ
  // (dive-domain review H3); anything else posted is no answer.
  const heldContactPosted = form.heldContact;
  const heldContact =
    heldContactPosted === "use_held" || heldContactPosted === "keep_record"
      ? heldContactPosted
      : undefined;
  const confirmed = await confirmBookingIdentity(db, {
    shopId: s.user.shopId,
    bookingId,
    actorPersonId: s.user.personId,
    heldContact,
  });
  if (confirmed === "contact_differs")
    revalidateAndRedirect(back, noticeUrl(back, "identity-contact-differs", { bid: bookingId }));
  if (!confirmed) revalidateAndRedirect(back, noticeUrl(back, "invalid", { bid: bookingId }));
  // The gear this seat paid for at checkout waited on the booking while it was
  // held (`paid_rental_kinds`); the staffer's tick carries it to the fit, which
  // is a standing record, so it is theirs to decline.
  if (form.applyPaidGear) {
    await applyPaidRentalKindsToFit(db, { shopId: s.user.shopId, bookingId });
  }
  // A held seat was sent no release (issue #2125); now that the desk knows
  // who it is, it goes out the way a join's does, unless their signature
  // already covers it, and the notice says where it got to.
  const release = await sendReleasesOnceIdentityKnown(db, s.user.shopId, [bookingId]);
  revalidateAndRedirect(
    back,
    noticeUrl(back, IDENTITY_RELEASE_NOTICE.confirmed[release], { bid: bookingId }),
  );
}

/**
 * Staff answer "different person" to a held seat (H-13): the booking leaves
 * the matched diver's record and becomes a new diver of its own. The other
 * door onto the same question as {@link confirmDiverIdentityAction}; the write
 * and its trail are `splitBookingIdentity`'s.
 */
export async function splitDiverIdentityAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const form = readForm(splitIdentityForm, formData);
  const { bookingId } = form;
  if (!uuidParam(bookingId)) redirect(back);
  const db = await getDb();
  await requireRosterBooking(db, s.user.shopId, tripId, bookingId, back);
  // Who the new diver is, beyond a name (issue #2081). The email is checked
  // for shape here; whether another record holds it is the writer's call.
  const email = blankableDiverEmailSchema.safeParse(form.email.trim());
  const phone = diverPhoneSchema.safeParse(form.phone);
  if (!email.success || !phone.success) {
    revalidateAndRedirect(
      back,
      noticeUrl(back, email.success ? "invalid" : "identity-split-email-invalid", {
        bid: bookingId,
      }),
    );
  }
  const split = await splitBookingIdentity(db, {
    shopId: s.user.shopId,
    bookingId,
    actorPersonId: s.user.personId,
    fullName: form.fullName,
    dateOfBirth: form.dateOfBirth,
    adultAttested: form.adultAttested,
    email: email.data,
    phone: phone.data,
    // The bookings the ticked box named. Only ids; the writer moves only those
    // that are still the same guess and still movable.
    sameNameSeatIds: form.sameNameSeatIds.split(",").filter((id) => uuidParam(id)),
  });
  if (!split.ok) {
    revalidateAndRedirect(
      back,
      noticeUrl(back, SPLIT_REFUSAL_NOTICE[split.reason], { bid: bookingId }),
    );
  }
  // The new diver's fit is empty and the gear is what this seat paid for, so
  // it goes straight on: otherwise it would leave the rack the moment the
  // seat stopped being held.
  await applyPaidRentalKindsToFit(db, { shopId: s.user.shopId, bookingId });
  // Every seat that moved is its own diver's now, and was sent no release
  // while it was held (issue #2125): each goes out the way a join's does.
  const release = await sendReleasesOnceIdentityKnown(db, s.user.shopId, split.seatIds);
  revalidateAndRedirect(
    back,
    noticeUrl(back, IDENTITY_RELEASE_NOTICE.split[release], { bid: bookingId }),
  );
}

/**
 * Staff answer "another diver on file" to a seat held because two divers share
 * its name (issue #2129): the seat moves to the namesake the staffer picked and
 * **stays held**, so "Same person" is still asked of the new match. The write,
 * its refusals and its trail are `repointHeldBooking`'s; no release goes out,
 * because nobody is confirmed yet.
 */
export async function repointDiverIdentityAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const form = readForm(repointIdentityForm, formData);
  const { bookingId, toPersonId } = form;
  if (!uuidParam(bookingId)) redirect(back);
  if (!uuidParam(toPersonId))
    revalidateAndRedirect(back, noticeUrl(back, "invalid", { bid: bookingId }));
  const db = await getDb();
  await requireRosterBooking(db, s.user.shopId, tripId, bookingId, back);
  const moved = await repointHeldBooking(db, {
    shopId: s.user.shopId,
    bookingId,
    actorPersonId: s.user.personId,
    toPersonId,
    sameNameSeatIds: form.sameNameSeatIds.split(",").filter((id) => uuidParam(id)),
  });
  revalidateAndRedirect(
    back,
    noticeUrl(
      back,
      moved.ok
        ? moved.flySafeFollowUp
          ? "identity-repointed-fly-safe"
          : "identity-repointed"
        : REPOINT_REFUSAL_NOTICE[moved.reason],
      {
        bid: bookingId,
      },
    ),
  );
}

/** Which notice each refused re-point lands on (`repointHeldBooking`). */
const REPOINT_REFUSAL_NOTICE = {
  not_held: "invalid",
  person_unavailable: "identity-repoint-unavailable",
  medical_hold: "identity-repoint-medical-hold",
  already_on_departure: "identity-repoint-already-booked",
  departure_closed: "identity-departure-closed",
} as const satisfies Record<
  Extract<Awaited<ReturnType<typeof repointHeldBooking>>, { ok: false }>["reason"],
  string
>;

/**
 * Which notice confirm and split land on, by what sending the owed release
 * came to (`sendReleasesOnceIdentityKnown`). A release that reached nobody
 * reads as the row's to hand over, on this device or on paper.
 */
const IDENTITY_RELEASE_NOTICE = {
  confirmed: {
    not_needed: "identity-confirmed",
    sent: "identity-confirmed-waiver-sent",
    ready: "identity-confirmed-waiver-ready",
    failed: "new-waiver-failed",
  },
  split: {
    not_needed: "identity-split",
    sent: "identity-split-waiver-sent",
    ready: "identity-split-waiver-ready",
    failed: "new-waiver-failed",
  },
} as const satisfies Record<"confirmed" | "split", Record<IdentityReleaseOutcome, string>>;

/** Which notice each refused split lands on (`splitBookingIdentity`). */
const SPLIT_REFUSAL_NOTICE = {
  not_held: "invalid",
  name_required: "invalid",
  medical_hold: "identity-medical-hold",
  date_of_birth_required: "identity-split-dob-required",
  date_of_birth_invalid: "identity-split-dob-invalid",
  age_unstated: "identity-split-age-unstated",
  email_in_use: "identity-split-email-in-use",
  held_contact_conflict: "identity-split-contact-conflict",
  departure_closed: "identity-departure-closed",
} as const satisfies Record<
  Extract<Awaited<ReturnType<typeof splitBookingIdentity>>, { ok: false }>["reason"],
  string
>;

/**
 * Staff record (or correct) a diver's emergency contact straight from the
 * roster — the fallback for a diver who never filled it in themselves, and
 * the field Today's "ask at the counter" nudge used to have nowhere to land
 * (UX persona Lens 17, task 144). Writes through the same
 * `saveBookingEmergencyContact` the diver-facing /ready and /waivers capture
 * uses, so there is exactly one write path regardless of who fills it in.
 * Prints on the manifest — safety-adjacent, hence the shop-scoped booking
 * lookup inside `saveBookingEmergencyContact` rather than trusting the
 * `bookingId` field alone, and a blank submission is reported distinctly from
 * a genuine failure rather than silently landing on the same "invalid" notice.
 */
export async function saveRosterEmergencyContactAction(
  shopSlug: string,
  tripId: string,
  formData: FormData,
) {
  const back = tripPath(shopSlug, tripId);
  const s = (await requireShopSurface(shopSlug)).session;
  const { bookingId } = readForm(rosterBookingForm, formData);
  const parsed = emergencyContactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(noticeUrl(back, "invalid"));
  const dbi = await getDb();
  await requireRosterBooking(dbi, s.user.shopId, tripId, bookingId, noticeUrl(back, "invalid"));
  const name = (parsed.data.emergencyContactName ?? "").trim();
  const phone = (parsed.data.emergencyContactPhone ?? "").trim();
  await saveBookingEmergencyContact(dbi, {
    shopId: s.user.shopId,
    bookingId,
    name,
    phone,
    actor: "staff",
  });
  // A contact is only usable with a reachable number, and the writer holds
  // that line for every surface (`readEmergencyContact`): a name without a
  // number wrote nothing at all, rather than landing the new name on the
  // contact's old phone. So this notice reports a refusal, not a half-save.
  const complete = Boolean(name && phone);
  revalidateAndRedirect(
    back,
    noticeUrl(back, complete ? "contact-saved" : "contact-incomplete", { bid: bookingId }),
  );
}
