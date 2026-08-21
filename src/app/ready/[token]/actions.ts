"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { selfCancelBooking, setBookingLastDived } from "@/db/bookings";
import { startBookingCheckout } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { createNitroxCertification, setBookingNitrox } from "@/db/nitrox";
import { recordDiverOwnLocale } from "@/db/people";
import { createCertification, createSpecialtyCertification } from "@/db/readiness";
import { getReadyPageData, type ReadyPageData } from "@/db/ready";
import { refundBookingOnCancellation } from "@/db/refunds";
import { saveRentalFit } from "@/db/rental-fit";
import { certificationAgency, certificationLevel, diveSpecialty } from "@/db/schema";
import { issueWaiverRequest, saveBookingEmergencyContact } from "@/db/waivers";
import { diverTranslator } from "@/i18n/messages";
import { requestFirstHandLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import { trackEvent } from "@/lib/analytics";
import { nowDate } from "@/lib/clock";
import { emergencyContactSchema } from "@/lib/contact";
import { DIVE_RECENCY_BANDS } from "@/lib/dive-recency";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl, recipientLocale } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { nitroxAvailableOn } from "@/lib/rentals";
import { clientIp } from "@/lib/request-ip";

/**
 * The transactional half of the diver's readiness page. Every action is
 * authorized the same way: the signed readiness token proves the diver owns
 * this booking, and every write is then scoped to that booking's shop/person.
 * A bearer of this token can only ever touch its own booking — never another
 * diver's — and the readiness state itself stays server-authoritative.
 */

const base = (token: string) => `/ready/${token}`;

/** Where a resolved action redirects when it can't proceed — a query param the page can turn into a real notice, never silence. */
function bounceTarget(token: string, reason: "rate_limited" | "invalid"): string {
  return reason === "rate_limited" ? `${base(token)}?error=rate` : base(token);
}

type ReadyContext = {
  db: AwaitedDb;
  bookingId: string;
  data: ReadyPageData;
  /**
   * What *this* request's `Accept-Language` asked for, or null when it carried
   * nothing DiveDay speaks. Already recorded on the person by `contextFor`;
   * carried here so a send in the same request uses the fresh signal rather
   * than the row read a moment before the write.
   */
  ownLocale: DiverLocale | null;
};
type ReadyContextResult =
  | ({ ok: true } & ReadyContext)
  | { ok: false; reason: "rate_limited" | "invalid" };

type AwaitedDb = Awaited<ReturnType<typeof getDb>>;

/**
 * Resolve the token to its booking + shop context, or report why it can't be
 * used. Rate-limited by IP before verification, so this one chokepoint
 * throttles every action in this file against both token guessing and
 * replay spam of a known link (CR-013). Every call site distinguishes the
 * two failure reasons (task 49): a throttled attempt tells the diver to wait
 * a moment, rather than redirecting silently and looking like the button did
 * nothing at all — a stale/invalid token still just bounces to the plain
 * unavailable notice, since there's nothing actionable to say about it.
 */
async function contextFor(token: string): Promise<ReadyContextResult> {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("readiness-token", ip), RATE_LIMITS.capabilityAction))
      .allowed
  ) {
    return { ok: false, reason: "rate_limited" };
  }
  const db = await getDb();
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) return { ok: false, reason: "invalid" };
  const data = await getReadyPageData(db, capability.bookingId);
  if (!data || data.detail.cancelled) return { ok: false, reason: "invalid" };
  // The readiness link is the diver's own capability, so every action reaching
  // this point is the diver acting on their own booking from their own device
  // — first-hand evidence of the language they read (docs ADR
  // 20260731-per-person-notification-locale). Captured at this one chokepoint
  // so no individual action below has to remember to, and so it can never be
  // reached from a staff surface, whose header belongs to staff.
  const ownLocale = await requestFirstHandLocale();
  await recordDiverOwnLocale(db, {
    shopId: data.shop.id,
    personId: data.person.id,
    locale: ownLocale,
  });
  return { ok: true, db, bookingId: capability.bookingId, data, ownLocale };
}

/**
 * Sign the waiver from the page. We can't reconstruct an existing bearer token
 * (only its hash is stored), so this issues a fresh link for the booking and
 * sends the diver straight to it. Reissuing supersedes any prior pending link,
 * which is the intended behaviour.
 */
export async function signWaiverFromReady(token: string) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const issued = await issueWaiverRequest(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
  });
  if (!issued.ok) redirect(`${base(token)}?error=waiver`);
  redirect(`/waivers/${issued.token}`);
}

export async function saveEmergencyContactFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = emergencyContactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=contact`);
  const name = (parsed.data.emergencyContactName ?? "").trim();
  const phone = (parsed.data.emergencyContactPhone ?? "").trim();
  await saveBookingEmergencyContact(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    name,
    phone,
  });
  // A contact is only usable with a reachable number, so only a name+phone pair
  // earns the "saved" confirmation; a partial entry is nudged, never thanked.
  const complete = Boolean(name && phone);
  revalidateAndRedirect(
    base(token),
    `${base(token)}?saved=${complete ? "contact" : "contact-empty"}`,
  );
}

const fitSchema = z.object({
  bcd: z.string().optional(),
  regulator: z.string().optional(),
  wetsuit: z.string().optional(),
  maskFins: z.string().optional(),
  weights: z.string().optional(),
  diveComputer: z.string().optional(),
  gopro: z.string().optional(),
  nitrox: z.string().optional(),
  bcdSize: z.string().trim().max(20),
  wetsuitSize: z.string().trim().max(20),
  finSize: z.string().trim().max(20),
  weightPreference: z.string().trim().max(80),
  note: z.string().trim().max(300),
});

export async function saveFitFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = fitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=fit`);
  const saved = await saveRentalFit(ctx.db, {
    shopId: ctx.data.shop.id,
    personId: ctx.data.person.id,
    rentsBcd: parsed.data.bcd === "on",
    rentsRegulator: parsed.data.regulator === "on",
    rentsWetsuit: parsed.data.wetsuit === "on",
    rentsMaskFins: parsed.data.maskFins === "on",
    rentsWeights: parsed.data.weights === "on",
    rentsDiveComputer: parsed.data.diveComputer === "on",
    rentsGopro: parsed.data.gopro === "on",
    bcdSize: parsed.data.bcdSize,
    wetsuitSize: parsed.data.wetsuitSize,
    // Fins and boots are one shoe-size answer on the diver's form now, written
    // to both columns so the packing list, the manifest and the CSV export all
    // keep reading the field they already read.
    bootSize: parsed.data.finSize,
    finSize: parsed.data.finSize,
    weightPreference: parsed.data.weightPreference,
    note: parsed.data.note,
  });
  // The nitrox checkbox is only in this form when the shop currently fills
  // nitrox *and* the course being taught runs on it (RentalFitForm.tsx) — when
  // it isn't, the field is simply absent from every submission, whatever the
  // diver's actual request. Re-derived here rather than trusted from the post:
  // a hand-crafted `nitrox=on` must not record a request the form would not
  // have offered. Only written when the box could have been there at all, so
  // an unrelated save (a note, a size) never silently clears a request
  // recorded while the shop still offered it.
  if (nitroxAvailableOn(ctx.data.shop.rentalItems, ctx.data.trip.course)) {
    const wantsNitrox = parsed.data.nitrox === "on";
    await setBookingNitrox(ctx.db, {
      shopId: ctx.data.shop.id,
      bookingId: ctx.bookingId,
      wantsNitrox,
    });
  }
  const result = saved ? "saved=fit" : "error=fit";
  revalidateAndRedirect(base(token), `${base(token)}?${result}`);
}

/**
 * Pay for the trip from the page. Abandonment already degrades safely — the
 * seat is held regardless — so a failure here just returns the diver to the
 * page with a gentle notice, never to an error.
 */
export async function payFromReady(token: string) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const origin = publicAppUrl();
  if (!ctx.data.canPay || !origin || !ctx.data.person.email) {
    redirect(`${base(token)}?error=pay`);
  }
  const returnBase = `${origin}${base(token)}`;
  // The words on the hosted Stripe line come from the diver's own bundle here,
  // not from `src/db` (docs ADR 20260731-domain-layer-copy-leaks). Only
  // `startBookingCheckout` knows whether the trip's deposit policy makes this
  // a deposit or the whole fare, so it asks — the caller supplies the words for
  // both branches.
  const t = diverTranslator(recipientLocale(ctx.ownLocale, ctx.data.shop.defaultLocale));
  const outcome = await startBookingCheckout(ctx.db, {
    shopId: ctx.data.shop.id,
    tripId: ctx.data.trip.id,
    bookingIds: [ctx.bookingId],
    customerEmail: ctx.data.person.email,
    successUrl: `${returnBase}?pay=paid`,
    cancelUrl: `${returnBase}?pay=cancelled`,
    describeLine: ({ isDeposit, tripTitle }) =>
      isDeposit ? t("checkoutLine.deposit", { tripTitle }) : t("checkoutLine.full", { tripTitle }),
  }).catch(() => null);
  const url = outcome?.ok ? outcome.checkout.checkoutUrl : null;
  if (!url) redirect(`${base(token)}?error=pay`);
  redirect(url);
}

/**
 * Cancel the diver's own booking. Rate-limited harder than the rest of this
 * file — this is irreversible and, when paid, moves money. Cancellation and
 * refund stay the two independent steps the staff path uses (docs H-07): the
 * seat is freed by `selfCancelBooking` first, and a refund failure afterward
 * never re-opens it or blocks the cancellation the diver already sees.
 *
 * The move a diver cannot make here is a *move* — rescheduling is the shop's
 * (ADR 20260821-the-diver-may-release-their-own-seat).
 */
export async function cancelMyBookingAction(token: string) {
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("booking-self-cancel", ip), RATE_LIMITS.bookingSelfCancel))
      .allowed
  ) {
    redirect(bounceTarget(token, "rate_limited"));
  }
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));

  const cancelled = await selfCancelBooking(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
  });
  if (!cancelled.ok) redirect(`${base(token)}?error=cancel`);
  await trackEvent({ name: "booking_cancelled", source: "diver" });

  // The refund outcome itself is never trusted back from the client for the
  // notice: `?cancelled=1` here is only a trigger telling the page to look,
  // not the source of truth. The page re-derives what actually happened from
  // the booking's own current payment status — an edited or replayed query
  // string cannot be used to claim a refund that did not happen, or hide one
  // that did.
  //
  // Caught, not left to throw: the cancellation above already committed and
  // this token is already revoked, so a refund failure (a transient DB error,
  // say) must never turn an already-successful cancellation into an error
  // response — the diver would see a generic failure with no way to tell the
  // destructive action actually went through, since refreshing the dead link
  // only shows the unavailable notice. Staff can still see and fix a missed
  // refund from the booking's payment record; the diver just needs the
  // confirmation either way.
  try {
    const refund = await refundBookingOnCancellation(ctx.db, {
      shopId: ctx.data.shop.id,
      bookingId: ctx.bookingId,
    });
    if (refund.status !== "no_policy" && refund.status !== "unpaid") {
      await trackEvent({ name: "refund_issued", auto: true, status: refund.status });
    }
  } catch {
    console.error("Self-cancel refund could not be processed", { bookingId: ctx.bookingId });
  }
  redirect(`${base(token)}?cancelled=1`);
}

/**
 * **How recently the diver says they last dived** (ADR
 * 20260821-currency-is-what-catches-people).
 *
 * The one question on this page whose answer nothing checks and nothing gates —
 * it is shown to the crew and that is the whole of it. Validated against the
 * pgEnum's own tuple rather than a hand-written list, so widening the bands can
 * never leave this refusing an answer the column accepts (the same rule
 * `certificationSchema` follows for agency and level).
 *
 * There is no "prefer not to say" value to post: that answer is simply not
 * submitting the form, which is the state every booking is in already.
 */
const diveRecencySchema = z.object({
  lastDivedBand: z.enum(DIVE_RECENCY_BANDS),
});

export async function saveDiveRecencyFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = diveRecencySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=last-dived`);

  // The booking comes from the verified capability, never from the form: a
  // bearer of this token can only ever answer for its own seat.
  const saved = await setBookingLastDived(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    band: parsed.data.lastDivedBand,
  });
  if (!saved) redirect(`${base(token)}?error=last-dived`);
  revalidateAndRedirect(base(token), `${base(token)}?saved=last-dived`);
}

/**
 * The diver's own certification card, typed in from their phone.
 *
 * Capture, never clearance. `createCertification` stores every card `pending`,
 * and only a staff review (`reviewCertification`) makes one count toward
 * readiness — so nothing a diver types here can clear their own cert gate, and
 * the boarding decision stays exactly where it was. What it changes is that a
 * diver told "we still need your certification card" now has somewhere to put
 * it: before this, the readiness page named the blocker and offered no way to
 * answer it, so the card arrived as a photo in a reply-to email, or at the dock.
 *
 * `agency` and `level` are validated against the database enums rather than a
 * hand-written list, so widening the enum can never leave this refusing a card
 * the column accepts (the same rule `CertificationAgency` exists for).
 */
const certificationSchema = z.object({
  agency: z.enum(certificationAgency.enumValues),
  level: z.enum(certificationLevel.enumValues),
  // Long enough for every agency's format, short enough that the box can never
  // be used to push a body at the column.
  identifier: z.string().trim().min(2).max(60),
});

export async function saveCertificationFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = certificationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=cert`);

  const created = await createCertification(ctx.db, {
    // The person and shop come from the verified capability, never from the
    // form: a bearer of this token can only ever file a card against its own
    // booking's diver.
    shopId: ctx.data.shop.id,
    personId: ctx.data.person.id,
    agency: parsed.data.agency,
    level: parsed.data.level,
    identifier: parsed.data.identifier,
    // **Stamped as the diver's own word, because that is what it is.** Without
    // it the row is byte-for-byte a staff transcription of a card somebody
    // held, and `reviewCertification`'s one-tap promote — which asks for a
    // sighting only from an unsighted self-declaration — would launder a
    // number typed on a phone into `verified`, the state readiness and the
    // fill gate both read. `security-reviewer`, 2026-08-20.
    selfDeclaredAt: nowDate(),
  });
  // `createCertification` returns null when a live card already holds this
  // shop/agency/number — most often the diver's own card, already on file and
  // possibly already verified. Say so rather than reporting a failure: there is
  // nothing for them to fix, and re-typing it would only be refused again.
  revalidateAndRedirect(base(token), `${base(token)}?saved=${created ? "cert" : "cert-known"}`);
}

/**
 * A specialty card the trip demands — Deep, Wreck, Night, Drysuit.
 *
 * The number is **required**, unlike the level declaration a booking form takes:
 * `specialty_certifications.identifier` is `NOT NULL`, because a specialty is a
 * yes/no gate on a materially riskier dive and there is no version of one that
 * is only a claim with no number behind it.
 *
 * `selfDeclaredAt` is what makes this form safe to offer at all. It is why
 * `specialty_certifications` gained the column on 2026-08-20: without it a row a
 * diver typed is byte-for-byte a staff transcription, and
 * `reviewSpecialtyCertification`'s ordinary one-tap confirm would promote an
 * invented number to `verified` — the state that clears a depth gate past 18 m.
 * With it, that tap asks the staffer for the card in their hand.
 */
const specialtySchema = z.object({
  agency: z.enum(certificationAgency.enumValues),
  specialty: z.enum(diveSpecialty.enumValues),
  identifier: z.string().trim().min(2).max(60),
});

export async function saveSpecialtyFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = specialtySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=cert`);

  const created = await createSpecialtyCertification(ctx.db, {
    // Shop and person come from the verified capability, never the form.
    shopId: ctx.data.shop.id,
    personId: ctx.data.person.id,
    agency: parsed.data.agency,
    specialty: parsed.data.specialty,
    identifier: parsed.data.identifier,
    selfDeclaredAt: nowDate(),
  });
  revalidateAndRedirect(base(token), `${base(token)}?saved=${created ? "cert" : "cert-known"}`);
}

/**
 * A nitrox card, from the diver rather than the counter.
 *
 * Same contract as the two above: filed `pending`, cleared only by a staffer.
 * `authorizesNitroxFill` reads `verified` and nothing else, so this can put a
 * number on the record and can never put enriched air in a cylinder.
 */
const nitroxCertSchema = z.object({
  agency: z.enum(certificationAgency.enumValues),
  identifier: z.string().trim().min(2).max(60),
});

export async function saveNitroxCertificationFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = nitroxCertSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=cert`);

  const created = await createNitroxCertification(ctx.db, {
    shopId: ctx.data.shop.id,
    personId: ctx.data.person.id,
    agency: parsed.data.agency,
    identifier: parsed.data.identifier,
    selfDeclaredAt: nowDate(),
  });
  revalidateAndRedirect(base(token), `${base(token)}?saved=${created ? "cert" : "cert-known"}`);
}
