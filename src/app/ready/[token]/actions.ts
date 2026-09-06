"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import {
  confirmCarriedFacts,
  selfCancelBooking,
  setBookingDiveIntent,
  setBookingHotelPickup,
  setBookingLastDived,
  setBookingReEntryAsk,
} from "@/db/bookings";
import { startBookingCheckout } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { saveHelpRequest } from "@/db/help-requests";
import { createNitroxCertification, setBookingNitrox } from "@/db/nitrox";
import { recordDiverOwnLocale } from "@/db/people";
import { createCertification, createSpecialtyCertification } from "@/db/readiness";
import {
  planReadinessLinkRescue,
  type ReadinessLinkRescue,
  sendPlannedReadinessLink,
} from "@/db/readiness-link-rescue";
import { getReadyPageData, type ReadyPageData } from "@/db/ready";
import { refundBookingOnCancellation } from "@/db/refunds";
import { saveRentalFit, saveRentalFitNote } from "@/db/rental-fit";
import { certificationAgency, certificationLevel, diveSpecialty } from "@/db/schema";
import { saveSupportNeeds } from "@/db/support-needs";
import { issueWaiverRequest, saveBookingEmergencyContact } from "@/db/waivers";
import { setWelcomeConsent } from "@/db/welcome-cues";
import { diverTranslator } from "@/i18n/messages";
import { requestFirstHandLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import { trackEvent } from "@/lib/analytics";
import { nowDate } from "@/lib/clock";
import { emergencyContactSchema } from "@/lib/contact";
import { DIVE_INTENTS } from "@/lib/dive-intent";
import { DIVE_RECENCY_BANDS } from "@/lib/dive-recency";
import { revalidateAndRedirect } from "@/lib/navigation";
import { publicAppUrl, recipientLocale } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { RE_ENTRY_ASKS, reEntryOffersFor } from "@/lib/re-entry";
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

/**
 * The diver's own words to the crew, saved on their own.
 *
 * Its own action rather than a field of `saveFitFromReady` (issue 627): the
 * note is a question of its own on the page now, and `saveRentalFitNote` writes
 * the note column alone — so answering it cannot blank sizes the diver set on a
 * different day, and saving sizes cannot blank the note.
 */
const noteSchema = z.object({ note: z.string().trim().max(300) });

export async function saveNoteFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = noteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=note`);
  const saved = await saveRentalFitNote(ctx.db, {
    shopId: ctx.data.shop.id,
    personId: ctx.data.person.id,
    note: parsed.data.note,
  });
  revalidateAndRedirect(base(token), `${base(token)}?${saved ? "saved=note" : "error=note"}`);
}

/**
 * **What this diver's dive needs set up.**
 *
 * Its own action, and its own row on the checklist, for the reason ADR
 * 20260827-support-needs-are-a-record-about-the-dive gives: this is asked
 * *after the sale*, on the diver's own page, and never on the public booking
 * form — which would be a disclosure to a stranger before a purchase, on a page
 * the shop's competitors can also load.
 *
 * Every field is optional and the whole form saves at once, because the diver
 * answers it as one thought. The checkbox fields arrive only when ticked, which
 * is how HTML posts a checkbox — so an unticked box is a real `false` rather
 * than a missing value, and unticking one genuinely retracts it.
 *
 * The ceiling matches the `dive_support_needs_support_divers_range` check
 * constraint. It is a typo guard, not a limit: nothing downstream refuses a
 * departure for being short of the number.
 */
const supportNeedsSchema = z.object({
  /**
   * A count and a supplier, which the `dive_support_needs_provider_pairs_with_count`
   * check constraint requires to travel together. An empty radio is "no support
   * divers", and the writer normalises the count away with it.
   */
  supportDiversProvidedBy: z.enum(["shop", "diver"]).or(z.literal("")),
  supportDiversNeeded: z
    .string()
    .trim()
    .max(2)
    .regex(/^\d*$/)
    .transform((value) => (value === "" ? null : Number(value)))
    .refine((value) => value === null || (value >= 0 && value <= 4)),
  needsBoardingAssistance: z.literal("on").optional(),
  needsWaterLift: z.literal("on").optional(),
  briefingInSign: z.literal("on").optional(),
  briefingInWriting: z.literal("on").optional(),
  briefingAloud: z.literal("on").optional(),
  briefingBySignals: z.literal("on").optional(),
  equipmentAdaptation: z.string().trim().max(300),
  divesWithName: z.string().trim().max(120),
});

export async function saveSupportNeedsFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = supportNeedsSchema.safeParse(Object.fromEntries(formData));
  // The count is the one field a diver can plausibly get refused on — 5 is a
  // real configuration for a first open-water session — so it says so on the
  // field rather than as a page-level "that did not save". Everything else in
  // this schema is a control the form itself produces, where a failure is a bug
  // rather than an answer.
  if (!parsed.success) {
    const countRefused = parsed.error.issues.some(
      (issue) => issue.path[0] === "supportDiversNeeded",
    );
    redirect(`${base(token)}?error=${countRefused ? "support-count" : "support"}`);
  }
  const providedBy = parsed.data.supportDiversProvidedBy;
  const saved = await saveSupportNeeds(ctx.db, {
    shopId: ctx.data.shop.id,
    personId: ctx.data.person.id,
    // The diver, on their own page — which is what the trail this write leaves
    // records, since a forwarded readiness link writes as the diver too.
    actor: { kind: "diver" },
    // "No" means no support divers, whatever number is left in the box.
    supportDiversNeeded: providedBy === "" ? null : parsed.data.supportDiversNeeded,
    supportDiversProvidedBy: providedBy === "" ? null : providedBy,
    needsBoardingAssistance: parsed.data.needsBoardingAssistance === "on",
    needsWaterLift: parsed.data.needsWaterLift === "on",
    briefingInSign: parsed.data.briefingInSign === "on",
    briefingInWriting: parsed.data.briefingInWriting === "on",
    briefingAloud: parsed.data.briefingAloud === "on",
    briefingBySignals: parsed.data.briefingBySignals === "on",
    equipmentAdaptation: parsed.data.equipmentAdaptation,
    divesWithName: parsed.data.divesWithName,
  });
  revalidateAndRedirect(base(token), `${base(token)}?${saved ? "saved=support" : "error=support"}`);
}

const hotelPickupSchema = z.object({
  hotelPickupLocation: z.string().trim().max(300),
});

export async function saveHotelPickupLocationFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = hotelPickupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=pickup`);
  const location = parsed.data.hotelPickupLocation || null;
  const saved = await setBookingHotelPickup(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    hotelPickupLocation: location,
  });
  revalidateAndRedirect(base(token), `${base(token)}?${saved ? "saved=pickup" : "error=pickup"}`);
}

const helpRequestSchema = z.object({
  kind: z.enum(["carry_gear", "first_timer", "find_group", "none"]),
});

/** Capture one small day-of request and let the shop visibly settle it. */
export async function saveHelpRequestFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = helpRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=help`);
  const result = await saveHelpRequest(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    kind: parsed.data.kind,
  });
  if (!result.ok) {
    revalidateAndRedirect(
      base(token),
      `${base(token)}?error=${result.reason === "handled" ? "help-handled" : "help"}`,
    );
  }
  revalidateAndRedirect(base(token), `${base(token)}?saved=help`);
}

const welcomeConsentSchema = z.object({ share: z.enum(["on", "off"]) });

/**
 * **Tell the crew, or take it back** (issue #1182, delight report D22).
 *
 * The only writer of `bookings.welcome_shared_at` anywhere in the app: staff
 * have no door to it, because a cue a shop switched on about a diver is the
 * profile badge D22's boundary refuses. Both directions are one action —
 * withdrawing has to be exactly as easy as consenting, which is Budget rule 6's
 * "the way back" made a button rather than a sentence.
 */
export async function saveWelcomeConsentFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = welcomeConsentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=welcome`);
  const result = await setWelcomeConsent(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    shared: parsed.data.share === "on",
  });
  if (!result.ok) {
    revalidateAndRedirect(base(token), `${base(token)}?error=welcome`);
  }
  // No success notice, unlike every other action on this page. The block's own
  // line says what the answer now is, and it keeps saying it on a reload — a
  // banner reading "Saved." above a form that already states the standing
  // answer is the second confirmation, not the first.
  revalidateAndRedirect(base(token));
}

const fitSchema = z.object({
  bcd: z.string().optional(),
  regulator: z.string().optional(),
  wetsuit: z.string().optional(),
  maskFins: z.string().optional(),
  weights: z.string().optional(),
  diveComputer: z.string().optional(),
  gopro: z.string().optional(),
  drysuit: z.string().optional(),
  hoodGloves: z.string().optional(),
  torch: z.string().optional(),
  smb: z.string().optional(),
  nitrox: z.string().optional(),
  bcdSize: z.string().trim().max(20),
  wetsuitSize: z.string().trim().max(20),
  finSize: z.string().trim().max(20),
  weightPreference: z.string().trim().max(80),
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
    rentsDrysuit: parsed.data.drysuit === "on",
    rentsHoodGloves: parsed.data.hoodGloves === "on",
    rentsTorch: parsed.data.torch === "on",
    rentsSmb: parsed.data.smb === "on",
    bcdSize: parsed.data.bcdSize,
    wetsuitSize: parsed.data.wetsuitSize,
    // Fins and boots are one shoe-size answer on the diver's form now, written
    // to both columns so the packing list, the manifest and the CSV export all
    // keep reading the field they already read.
    bootSize: parsed.data.finSize,
    finSize: parsed.data.finSize,
    weightPreference: parsed.data.weightPreference,
    // Deliberately absent, and `saveRentalFit` reads that absence as "leave the
    // stored note alone": the note is `saveNoteFromReady`'s to write since issue
    // 627, so a diver nudging a boot size here must not silently delete words
    // the crew is relying on.
    note: undefined,
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
  // Saving sizes is one of the three ways to answer "Anything changed?", so it
  // settles that step too. A diver who fixes a wetsuit size must not then be
  // asked to confirm that they fixed it.
  await confirmCarriedFacts(ctx.db, { shopId: ctx.data.shop.id, bookingId: ctx.bookingId });
  const result = saved ? "saved=fit" : "error=fit";
  revalidateAndRedirect(base(token), `${base(token)}?${result}`);
}

/**
 * **"Nothing changed."** — the primary answer to the returning diver's one
 * question (ADR 20260904-reef-all-the-way-down, D15 with D19 folded in).
 *
 * The whole of it is a stamp on this booking. It writes no fact, because the
 * point of the answer is that none of them moved; the three doors beside it
 * each write their own single fact and stamp this in the same breath.
 */
export async function confirmCarriedFactsFromReady(token: string) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const saved = await confirmCarriedFacts(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
  });
  revalidateAndRedirect(base(token), `${base(token)}?${saved ? "saved=changes" : "error=changes"}`);
}

const tanksSchema = z.object({ nitrox: z.string().optional() });

/**
 * **Air or nitrox**, on its own.
 *
 * Its own action and its own scope, which is the whole point of the question
 * being a door rather than a field of the dense prep form: a partial post to
 * that form would clear sizes the diver never touched (issue #1175's named
 * trap). This writes `bookings.wants_nitrox` and nothing else.
 *
 * The offer is re-derived here rather than trusted from the post, exactly as
 * `saveFitFromReady` does it: a hand-crafted `nitrox=on` must not record a
 * request against a shop that does not fill nitrox, or a course that cannot run
 * on it. When the shop could not have asked, the field is ignored entirely
 * rather than read as a `false` — so an unrelated tap never silently clears a
 * request recorded while the shop still offered it.
 */
export async function saveTanksFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = tanksSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=tanks`);
  if (!nitroxAvailableOn(ctx.data.shop.rentalItems, ctx.data.trip.course)) {
    redirect(`${base(token)}?error=tanks`);
  }
  const saved = await setBookingNitrox(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    wantsNitrox: parsed.data.nitrox === "on",
  });
  if (!saved) redirect(`${base(token)}?error=tanks`);
  await confirmCarriedFacts(ctx.db, { shopId: ctx.data.shop.id, bookingId: ctx.bookingId });
  revalidateAndRedirect(base(token), `${base(token)}?saved=tanks`);
}

/**
 * **Who to call**, on its own.
 *
 * New reach for the readiness capability — the emergency contact has been
 * written from the *waiver* token until now — and bounded the same way that one
 * is: the shared `emergencyContactSchema` (max 120/40, the bound CR-014 added
 * precisely because this page's equivalent action once had none), and
 * `saveBookingEmergencyContact`, which resolves the person from the booking the
 * verified capability names rather than from anything posted.
 *
 * It never blanks a field, which is that writer's own standing rule: a diver
 * who submits an empty box keeps what is on file. A contact on a manifest is
 * safety data, and a silent clear is worse than a stale one.
 */
export async function saveEmergencyContactFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = emergencyContactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=contact`);
  const saved = await saveBookingEmergencyContact(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    name: parsed.data.emergencyContactName,
    phone: parsed.data.emergencyContactPhone,
  });
  if (!saved) redirect(`${base(token)}?error=contact`);
  await confirmCarriedFacts(ctx.db, { shopId: ctx.data.shop.id, bookingId: ctx.bookingId });
  revalidateAndRedirect(base(token), `${base(token)}?saved=contact`);
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

/**
 * **What this dive is for, changed after the booking** (ADR
 * 20260904-reef-all-the-way-down, D12).
 *
 * The booking form promises "change it any time from the link we send you";
 * this is that link. It also reaches the divers who never saw the booking form
 * at all — a party member, a walk-in a staffer seated — which is the argument
 * ADR 20260821-currency-is-what-catches-people already made for putting the
 * recency question here.
 *
 * Validated against the pgEnum's own tuple, like the band below it, and there
 * is no "prefer not to say" value to post: that answer is not submitting the
 * form, which is the state every booking is in already.
 */
const diveIntentSchema = z.object({
  diveIntent: z.enum(DIVE_INTENTS),
});

export async function saveDiveIntentFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = diveIntentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=dive-intent`);

  // The booking comes from the verified capability, never from the form: a
  // bearer of this token can only ever answer for its own seat.
  const saved = await setBookingDiveIntent(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    intent: parsed.data.diveIntent,
  });
  if (!saved) redirect(`${base(token)}?error=dive-intent`);
  revalidateAndRedirect(base(token), `${base(token)}?saved=dive-intent`);
}

/**
 * **What would help, from a diver easing back in** (ADR
 * 20260904-reef-all-the-way-down, D18).
 *
 * **Every gate is re-derived here, never trusted from the post** — the same
 * rule the nitrox request follows. All three are `getReadyPageData`'s own, so
 * what this accepts is exactly what the page offered:
 *
 * - the saved intent is `easing_back`, so an ask cannot arrive without the
 *   answer that opens it;
 * - the departure is more than a day out, because inside 24 hours nobody at
 *   the shop can act on an ask and a request recorded then would read to the
 *   crew as one somebody could have;
 * - and the ask is one of `reEntryOffersFor`, which drops `refresher_course`
 *   for a shop that publishes no refresher. That third gate was missing until
 *   review of PR #1416: the page filtered the option out, so a crafted post —
 *   or an ordinary one from a page rendered before the shop deactivated its
 *   refresher course — recorded an offer the shop could not make.
 */
const reEntryAskSchema = z.object({
  reEntryAsk: z.enum(RE_ENTRY_ASKS),
});

export async function saveReEntryAskFromReady(token: string, formData: FormData) {
  const ctx = await contextFor(token);
  if (!ctx.ok) redirect(bounceTarget(token, ctx.reason));
  const parsed = reEntryAskSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`${base(token)}?error=re-entry-ask`);
  // `reEntryOffersOpen` is the saved intent and the window together, resolved
  // by the same read the page rendered from; `refresherCourseOffered` is the
  // third. Both are read fresh on this request, so a shop that switched its
  // refresher off a minute ago is answered as it is now.
  if (
    !ctx.data.reEntryOffersOpen ||
    !reEntryOffersFor(ctx.data.refresherCourseOffered).includes(parsed.data.reEntryAsk)
  ) {
    redirect(`${base(token)}?error=re-entry-ask`);
  }

  const saved = await setBookingReEntryAsk(ctx.db, {
    shopId: ctx.data.shop.id,
    bookingId: ctx.bookingId,
    ask: parsed.data.reEntryAsk,
  });
  if (!saved) redirect(`${base(token)}?error=re-entry-ask`);
  revalidateAndRedirect(base(token), `${base(token)}?saved=re-entry-ask`);
}

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

/**
 * **The one transactional thing a dead trip-prep link still offers: send its
 * owner a fresh one.**
 *
 * Nothing here hands the caller new access. The replacement goes to the address
 * already on the booking, and only an outcome code comes back to the page — so
 * a leaked stale URL can trigger a delivery to its owner and nothing more. The
 * rules live with `planReadinessLinkRescue`; this is the two rate-limit nets
 * around it, and it is the waiver page's action with the nouns changed (issue
 * #850).
 */
const RESCUE_PARAM: Record<ReadinessLinkRescue, string> = {
  sent: "ok",
  no_email: "none",
  current_link_live: "live",
  unavailable: "unavailable",
  failed: "failed",
};

export async function emailFreshReadinessLinkAction(token: string) {
  const ip = await clientIp();
  // Two nets, because they bound different abuses: the shared per-IP bucket —
  // the same one every other action on this page spends from — stops one client
  // hammering many tokens, and the narrow bucket below stops many clients
  // hammering one diver's inbox.
  if (
    !(await checkRateLimit(rateLimitKey("readiness-token", ip), RATE_LIMITS.capabilityAction))
      .allowed
  ) {
    redirect(`${base(token)}?sent=rate`);
  }

  const db = await getDb();
  // **Decide first, spend second.** Every refusal is reached from reads alone,
  // and none of them costs the diver anything. Spending the per-inbox budget
  // before deciding meant a leaked dead URL could burn it on answers that sent
  // nothing — five taps at a booking holding a live link returned
  // `current_link_live` five times and left the real diver rate-limited for the
  // hour (`security-reviewer`, issue #850).
  const plan = await planReadinessLinkRescue(db, token);
  if (!plan.ok) redirect(`${base(token)}?sent=${RESCUE_PARAM[plan.reason]}`);

  // The narrow bucket belongs to the **inbox**, so it is keyed by the booking
  // the stale link resolves to — not by the URL. A booking accumulates a dead
  // capability every time one is issued, and keying by token would hand each of
  // those leaked URLs its own full budget: one holder with a handful of old
  // links could spray the same mailbox N times over. Keyed by booking, every
  // link ever issued for it spends from one budget. `rateLimitKey` hashes it,
  // so a booking id is never held as a literal key.
  const inboxKey = rateLimitKey("readiness-link-resend", "booking", plan.bookingId);
  if (!(await checkRateLimit(inboxKey, RATE_LIMITS.readinessLinkResendByBooking)).allowed) {
    redirect(`${base(token)}?sent=rate`);
  }

  redirect(`${base(token)}?sent=${RESCUE_PARAM[await sendPlannedReadinessLink(db, plan)]}`);
}
