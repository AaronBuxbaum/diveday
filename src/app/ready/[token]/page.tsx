import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AfterState } from "@/app/ready/[token]/_components/AfterState";
import {
  ThreadSpine,
  type ThreadSpineStep,
  ThreadStatus,
} from "@/app/ready/[token]/_components/ThreadSpine";
import { buildAfterStateProps } from "@/app/ready/[token]/_lib/after-state-data";
import {
  startTipAction,
  submitReviewAction,
  uploadRecapPhotoAction,
} from "@/app/recap/[token]/actions";
import { PackingSection } from "@/app/s/[shopSlug]/trips/[id]/_components/PackingSection";
import { RentalFitForm } from "@/app/s/[shopSlug]/trips/[id]/_components/RentalFitForm";
import { TripActions } from "@/app/s/[shopSlug]/trips/[id]/_components/TripActions";
import { TripTerms } from "@/app/s/[shopSlug]/trips/[id]/_components/TripTerms";
import { type DoorGlyphId, EntryDone } from "@/components/account/EntryShell";
import { EarnedMoment } from "@/components/EarnedMoment";
import { ExpiredLinkCard } from "@/components/ExpiredLinkCard";
import { FlashParams } from "@/components/FlashParams";
import { PartyClaimPanel } from "@/components/PartyClaimPanel";
import { RememberBooker } from "@/components/RememberBooker";
import { ShopContactLinks } from "@/components/ShopContactLinks";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { ThreadShell } from "@/components/thread/ThreadShell";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { SettledCheck } from "@/components/ui/SettledCheck";
import {
  resolveRevokedBookingCapability,
  staleBookingCapabilityForToken,
  verifyBookingCapability,
} from "@/db/booking-capabilities";
import { getLatestCheckoutForBooking, refreshCheckoutFromStripe } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { departureRollCallForBooking } from "@/db/manifests";
import { getBookingPayment } from "@/db/payments";
import { getReadyPageData, type ReadyPageData } from "@/db/ready";
import { getRecapPageData } from "@/db/recap";
import {
  certificationAgency,
  certificationLevel,
  type DiveSpecialty,
  type Shop,
} from "@/db/schema";
import { issuePartySeatClaims } from "@/db/seat-claims";
import { getShopById, getShopBySlug } from "@/db/shops";
import { getTripWithBooked, listTripDives } from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { type DiverMessageKey, type DiverTranslator, diverTranslator } from "@/i18n/messages";
import {
  DIVER_CERTIFICATION_AGENCY_KEYS,
  DIVER_CERTIFICATION_LEVEL_KEYS,
  DIVER_DIVE_RECENCY_KEYS,
  DIVER_SPECIALTY_KEYS,
} from "@/i18n/readiness-labels";
import { checklistDetailText } from "@/i18n/readiness-summary-labels";
import { requestLocale } from "@/i18n/request";
import { THREAD_STEP_STATE_KEYS, THREAD_STEP_TITLE_KEYS } from "@/i18n/thread-labels";
import { claimLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { DIVE_RECENCY_BANDS } from "@/lib/dive-recency";
import {
  formatMoneyCents,
  formatRelativeDay,
  formatShortDate,
  formatTime,
  formatTimeRangeTz,
} from "@/lib/format";
import { googleMapEmbedUrl, googleMapsUrl } from "@/lib/maps";
import { type ShopCurrency, toShopCurrency } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import { publicSchedulePath, publicTripCalendarPath, publicTripPath } from "@/lib/public-routes";
import { combineCertRequirements, type ReadinessBlockerCode } from "@/lib/readiness";
import { buildDiverChecklist, type DiverChecklistItem } from "@/lib/readiness-summary";
import { signRecapToken } from "@/lib/recap-links";
import { nitroxCardWanted } from "@/lib/rentals";
import { shopAddressLines, shopMapQuery } from "@/lib/shop-address";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import {
  buildThreadSteps,
  isAfterTheDive,
  isDiveDay,
  partyIsAllSet,
  type ThreadStep,
  theBoatIsHome,
} from "@/lib/thread-steps";
import {
  cancelMyBookingAction,
  emailFreshReadinessLinkAction,
  payFromReady,
  saveCertificationFromReady,
  saveDiveRecencyFromReady,
  saveFitFromReady,
  saveHotelPickupLocationFromReady,
  saveNitroxCertificationFromReady,
  saveNoteFromReady,
  saveSpecialtyFromReady,
  saveSupportNeedsFromReady,
  signWaiverFromReady,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return {
    title: t("ready.metaTitle"),
    robots: { index: false, follow: false },
  };
}

/**
 * One tick-box in the support-needs question, worded on its right.
 *
 * A local helper rather than a `src/components/ui` addition: `form.tsx`'s
 * vocabulary is stacked fields and controls, and there is exactly one grouped
 * set of checkboxes in the app. It matches the diver-facing markup already in
 * `DiveDeclarationFields` — same size, same border token, same `items-start` so
 * a label that wraps stays aligned to the box rather than centring on it.
 *
 * `value="on"` is explicit rather than relied on: the action's schema reads an
 * unticked box as an absent key, which is how HTML posts one, and a diver
 * unticking something genuinely retracts it.
 */
function CheckboxRow({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-base">
      <input
        type="checkbox"
        name={name}
        value="on"
        defaultChecked={defaultChecked}
        className="mt-1 size-4 shrink-0 rounded border-border-strong"
      />
      <span>{label}</span>
    </label>
  );
}

/** One radio in the support-divers question, worded on its right. */
function RadioRow({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-base">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="mt-1 size-4 shrink-0 border-border-strong"
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * What this booking has actually been charged, or null when nothing has
 * settled. **Only the settled case**, on purpose: the unpaid states — an open
 * Stripe session, a payable balance — are the payment checklist row's job on
 * this page, and a second "Pay now" card beside it would be the duplication
 * this page was collapsed to remove (ADR 20260820-one-page-after-booking). The
 * receipt is the one thing the checklist genuinely cannot say: *how much*.
 *
 * The pending-checkout refresh comes with it, but **only on a return from
 * Stripe**. A diver who has just paid routinely beats the webhook home, and
 * without asking Stripe directly they would read "payment due" on the page
 * they were sent to by paying. On every *other* visit the webhook has long
 * since landed — and unlike the confirmation this replaced, which a diver saw
 * once, this page is opened from every reminder for as long as the trip is
 * ahead. Refreshing unconditionally would turn each of those into an outbound
 * Stripe call for an abandoned session that is never going to change.
 */
async function resolvePaymentReceipt(
  // i18n-exempt: multi-line type annotation, not copy — the scanner misreads the signature as a string.
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  bookingId: string,
  /** This request is Stripe's own return, so an open session is worth asking about. */
  returnedFromCheckout: boolean,
  /**
   * The full per-diver fare, for the balance still owed after a deposit. Null
   * on an unpriced departure, which then quotes no balance rather than
   * guessing one.
   */
  fullPriceCents: number | null,
  /**
   * What to show when a settled payment predates the currency column and has
   * none of its own. A settled amount that *does* carry a currency keeps it —
   * it is evidence of what was charged, and today's shop setting must never
   * reinterpret it.
   */
  shopCurrency: ShopCurrency,
): Promise<PaymentReceipt> {
  const receipt = (settled: Awaited<ReturnType<typeof getBookingPayment>>): PaymentReceipt => {
    if (settled?.status !== "paid" && settled?.status !== "deposit_paid") return null;
    const isDeposit = settled.status === "deposit_paid";
    return {
      amountCents: settled.amountCents ?? null,
      currency: settled.currency ?? shopCurrency,
      isDeposit,
      balanceDueCents:
        isDeposit && fullPriceCents !== null
          ? Math.max(0, fullPriceCents - (settled.amountCents ?? 0))
          : 0,
    };
  };

  const settled = await getBookingPayment(db, shopId, bookingId);
  if (settled?.status === "paid" || settled?.status === "deposit_paid") return receipt(settled);
  if (settled?.status === "waived" || !returnedFromCheckout) return null;

  const checkout = await getLatestCheckoutForBooking(db, shopId, bookingId);
  if (checkout?.status !== "pending") return null;
  // The diver may have just paid and beaten the webhook home; ask Stripe.
  const refreshed = await refreshCheckoutFromStripe(db, shopId, checkout.id);
  return refreshed?.status === "completed"
    ? receipt(await getBookingPayment(db, shopId, bookingId))
    : null;
}

/** A settled charge, as this page states it back. Null when nothing has settled. */
type PaymentReceipt = {
  amountCents: number | null;
  currency: string;
  /** True when only a deposit has been paid; a balance is still owed. */
  isDeposit: boolean;
  /** The per-diver balance still due after a deposit, or 0 when paid in full. */
  balanceDueCents: number;
} | null;

/**
 * A terminal outcome for this link — a dead token, or a booking that was
 * cancelled underneath the diver. `EntryDone` is the app's one warm terminal
 * pattern (docs/design/principles.md #4) and the same shape `claim/[token]`
 * already gives a dead bearer link; this page used to spell a `rounded-2xl`
 * card of its own instead, which is how three token pages ended up with three
 * different boxes saying the same kind of thing.
 *
 * The mark is drawn and decorative (ADR 20260827-first-light, decision 2).
 * `expired` is the app-wide "this link has run out" clock; a cancelled booking
 * gets the `cancelled` calendar instead, because the link is fine and telling
 * that diver to ask for a fresh one would send them the wrong way.
 */
function Notice({
  title,
  text,
  glyph = "expired",
}: {
  title: string;
  text: string;
  glyph?: DoorGlyphId;
}) {
  return <EntryDone glyph={glyph} title={title} text={text} />;
}

/**
 * Which cert blockers a diver can actually answer by typing their card in.
 *
 * `certification_pending` is deliberately absent: that card is already on file
 * and waiting on a staff review, so offering the form again would only invite a
 * duplicate the unique index refuses. The four here all mean the shop is
 * holding nothing usable.
 *
 * `certification_self_declared` belongs in that group and not with `pending`,
 * which is the whole reason it is its own code. A diver who picked a level on a
 * public opt-in has a `pending` row with **no card number in it** — there is
 * nothing for a unique index to collide with, nothing for a staffer to look up,
 * and if this form were withheld the diver would be told their card was being
 * verified while holding the only copy of it (ADR 20260814-self-declared-cards).
 */
const CERT_ENTRY_CODES = new Set<ReadinessBlockerCode>([
  "certification_missing",
  "certification_self_declared",
  "certification_insufficient",
]);

/**
 * A specialty card the diver can send: the trip named one and nothing on file
 * answers it. `specialty_import_unconfirmed` and `specialty_pending` are absent
 * for the same reason `certification_pending` is — a real card is already with
 * the shop, and asking again would tell a diver to re-send what they already
 * sent.
 *
 * Offering this at all took a schema change. `specialty_certifications` had no
 * `self_declared_at` column until 2026-08-20, so a row a diver typed was
 * byte-for-byte a staff transcription and the staff list's ordinary one-tap
 * confirm would have promoted an invented number to `verified` — the state that
 * clears a depth gate past 18 m (`security-reviewer`). The column, the sighting
 * guard in `reviewSpecialtyCertification`, and the `isRealCard` fix in
 * `holdsRealCardOutsideLevels` are what this form rests on.
 */
const SPECIALTY_ENTRY_CODES = new Set<ReadinessBlockerCode>(["specialty_missing"]);

/**
 * A nitrox card, likewise. `nitrox_self_declared` is here because a claim is
 * exactly the state a number resolves; `nitrox_pending` is not, because it
 * means a staffer already holds one.
 */
const NITROX_ENTRY_CODES = new Set<ReadinessBlockerCode>([
  "nitrox_missing",
  "nitrox_self_declared",
]);

/**
 * One collapsed disclosure, the shell every card-entry form on this page wears.
 *
 * Collapsed, because the row above has already said what is outstanding and a
 * diver short three cards was being handed three stacked forms — nine fields of
 * agency/level/number between them, all open at once, on a phone.
 * Shut, the same three read as a list of three things to do, and each one is a
 * tap. `<details>` carries the open state to a screen reader itself, which is
 * why the caret is decorative (`DisclosureCaret`).
 */
function CertificationDisclosure({
  summary,
  optionalLabel,
  children,
}: {
  summary: string;
  /** Rendered as a pill beside the summary. Present only on an offer the trip does not require. */
  optionalLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group/cert overflow-hidden rounded-xl border border-border bg-surface-sunken/50">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-base font-semibold">
        <DisclosureCaret className="group-open/cert:rotate-90" />
        <span className="min-w-0 flex-1">{summary}</span>
        {optionalLabel ? <Badge size="sm">{optionalLabel}</Badge> : null}
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}

/**
 * **Every card this departure can still take, each behind its own disclosure.**
 *
 * The certification row is one *line* but can be several *jobs*: a diver short
 * a level card, a Deep card and a nitrox card used to get one form, file it,
 * reload, and discover a second thing they had no way to see. `actionable`
 * carries every blocker that is on the diver, so all of them are answerable in
 * one sitting.
 *
 * `offerNitrox` is the one entry here that is not answering a blocker. A shop
 * that fills nitrox on this departure can take a card from a diver whose trip
 * does not demand one — and it has to be takeable *here*, because the gear
 * row's request box is now locked until a card is on file. It wears an
 * "Optional" pill so a list of things the boat is waiting on never quietly
 * grows an item it is not.
 */
function CertificationEntries({
  token,
  item,
  offerNitrox,
  t,
}: {
  token: string;
  item: DiverChecklistItem;
  offerNitrox: boolean;
  t: DiverTranslator;
}) {
  // Derived first, in its own pass: this used to be a flag set from inside the
  // `flatMap` below, which made whether the optional offer renders depend on a
  // side effect of building an unrelated array.
  const nitroxRequired = item.actionable.some((blocker) => NITROX_ENTRY_CODES.has(blocker.code));
  const forms = item.actionable.flatMap((blocker) => {
    if (CERT_ENTRY_CODES.has(blocker.code)) {
      return [<CertificationEntry key={blocker.code} token={token} t={t} />];
    }
    if (SPECIALTY_ENTRY_CODES.has(blocker.code) && blocker.params?.specialty) {
      return [
        <SpecialtyEntry
          key={`${blocker.code}-${blocker.params.specialty}`}
          token={token}
          specialty={blocker.params.specialty}
          t={t}
        />,
      ];
    }
    if (NITROX_ENTRY_CODES.has(blocker.code)) {
      return [<NitroxEntry key={blocker.code} token={token} t={t} />];
    }
    return [];
  });
  // Never both: a trip that demands nitrox already rendered the required one
  // above, and a second disclosure calling the same card optional would be the
  // page contradicting itself.
  if (offerNitrox && !nitroxRequired) {
    forms.push(<NitroxEntry key="nitrox-optional" token={token} optional t={t} />);
  }
  if (forms.length === 0) return null;
  return <div className="flex flex-col gap-3">{forms}</div>;
}

/**
 * The diver's own card, typed in.
 *
 * **Capture, never clearance.** The card lands `pending` and a staff review is
 * what makes it count toward readiness (`src/db/readiness.ts`), so nothing here
 * can clear the diver's own gate — which is why it can be offered behind a
 * bearer link at all. The copy says so plainly rather than implying the row is
 * settled.
 *
 * Before this, the checklist named "we still need your certification card" and
 * offered no way to answer it, so the card arrived as a photo in a reply-to
 * email or not until the dock (2026-08-06 review).
 */
function CertificationEntry({ token, t }: { token: string; t: DiverTranslator }) {
  return (
    <CertificationDisclosure summary={t("ready.certHeading")}>
      <form action={saveCertificationFromReady.bind(null, token)} className="flex flex-col gap-3">
        <p className="text-sm text-muted">{t("ready.certBody")}</p>
        <FieldGrid columns={2}>
          <Field label={t("ready.certAgency")}>
            <select name="agency" required defaultValue="" className={controlClass}>
              <option value="" disabled>
                {t("ready.certChoose")}
              </option>
              {certificationAgency.enumValues.map((agency) => (
                <option key={agency} value={agency}>
                  {t(DIVER_CERTIFICATION_AGENCY_KEYS[agency])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("ready.certLevel")}>
            <select name="level" required defaultValue="" className={controlClass}>
              <option value="" disabled>
                {t("ready.certChoose")}
              </option>
              {certificationLevel.enumValues.map((level) => (
                <option key={level} value={level}>
                  {t(DIVER_CERTIFICATION_LEVEL_KEYS[level])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("ready.certNumber")}>
            <input
              name="identifier"
              required
              minLength={2}
              maxLength={60}
              autoComplete="off"
              // A card number is printed in caps and read off plastic at arm's
              // length; a phone keyboard's own autocorrect is nothing but a
              // source of wrong digits here.
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <div>
          <SubmitButton
            pendingLabel={t("ready.certSubmitting")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("ready.certSubmit")}
          </SubmitButton>
        </div>
      </form>
    </CertificationDisclosure>
  );
}

/**
 * A specialty card, typed in. Same contract as the level card above — the row
 * lands `pending` and only a staff sighting makes it count — with one
 * difference the schema enforces rather than the form: the number is required,
 * because `specialty_certifications.identifier` is `NOT NULL` and that table
 * carries no self-declaration column. A specialty is what authorizes a
 * materially riskier dive, so there is no version of it that is only a claim.
 *
 * The specialty itself is fixed by the blocker, not chosen: the trip asked for
 * Deep, so this is the Deep form. Offering a picker would invite a diver to
 * file the card they have instead of the one they were asked for.
 */
function SpecialtyEntry({
  token,
  specialty,
  t,
}: {
  token: string;
  specialty: DiveSpecialty;
  t: DiverTranslator;
}) {
  const specialtyName = t(DIVER_SPECIALTY_KEYS[specialty]);
  return (
    <CertificationDisclosure summary={t("ready.specialtyHeading", { specialty: specialtyName })}>
      <form action={saveSpecialtyFromReady.bind(null, token)} className="flex flex-col gap-3">
        <input type="hidden" name="specialty" value={specialty} />
        <FieldGrid columns={2}>
          <Field label={t("ready.certAgency")}>
            <select name="agency" required defaultValue="" className={controlClass}>
              <option value="" disabled>
                {t("ready.certChoose")}
              </option>
              {certificationAgency.enumValues.map((agency) => (
                <option key={agency} value={agency}>
                  {t(DIVER_CERTIFICATION_AGENCY_KEYS[agency])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("ready.certNumber")}>
            <input
              name="identifier"
              required
              minLength={2}
              maxLength={60}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <div>
          <SubmitButton
            pendingLabel={t("ready.certSubmitting")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("ready.certSubmit")}
          </SubmitButton>
        </div>
      </form>
    </CertificationDisclosure>
  );
}

/**
 * A nitrox card, typed in. No level and no expiry — a nitrox card is a yes/no
 * qualification and `nitrox_certifications` has no expiry state at all
 * (`src/lib/readiness.ts` raises no `nitrox_expired`).
 *
 * `optional` is the case where the trip demands nothing and the shop simply
 * fills enriched air: the card is what makes the gear row's request box appear
 * at all, so the offer belongs here with the other cards — pilled, so it never
 * reads as one more thing standing between the diver and the boat.
 *
 * This is also where "what is nitrox?" is answered (issue 627). It used to sit
 * on the gear row's request legend, which a diver only reaches *after* filing a
 * card — the explanation arriving one step after the decision it was for. Here
 * it meets them at the word itself.
 */
function NitroxEntry({
  token,
  optional = false,
  t,
}: {
  token: string;
  optional?: boolean;
  t: DiverTranslator;
}) {
  return (
    <CertificationDisclosure
      summary={t("ready.nitroxCertHeading")}
      optionalLabel={optional ? t("ready.certOptional") : undefined}
    >
      <form
        action={saveNitroxCertificationFromReady.bind(null, token)}
        className="flex flex-col gap-3"
      >
        {/* What the word means, said plainly rather than hidden behind a
            marker. This is the gear row's old `InfoHint` detail, moved to the
            section that asks for the card (issue 627) — as text, because an
            `InfoHint` is a `<button>` and `<summary>` is already one, and
            because this page is read on a phone, where there is no hover to
            discover. Same string, so the booking page's hint and this cannot
            drift apart. */}
        <p className="text-sm text-muted">{t("rental.jargonHints.nitrox")}</p>
        <FieldGrid columns={2}>
          <Field label={t("ready.certAgency")}>
            <select name="agency" required defaultValue="" className={controlClass}>
              <option value="" disabled>
                {t("ready.certChoose")}
              </option>
              {certificationAgency.enumValues.map((agency) => (
                <option key={agency} value={agency}>
                  {t(DIVER_CERTIFICATION_AGENCY_KEYS[agency])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("ready.certNumber")}>
            <input
              name="identifier"
              required
              minLength={2}
              maxLength={60}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <div>
          <SubmitButton
            pendingLabel={t("ready.certSubmitting")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("ready.certSubmit")}
          </SubmitButton>
        </div>
      </form>
    </CertificationDisclosure>
  );
}

/**
 * Notice keys, not sentences: the query string carries a key, and the page
 * looks it up in the diver's own language. Storing the prose here would have
 * pinned every one of these to English no matter what the reader asked for
 * (docs ADR 20260729-diver-copy-localization).
 */
const READY_NOTICES: Record<
  string,
  { tone: "success" | "danger" | "neutral"; key: DiverMessageKey }
> = {
  "pay-paid": { tone: "success", key: "ready.paymentReceived" },
  "error-waiver": { tone: "danger", key: "ready.waiverUnavailable" },
  // The diver's own words to the crew, now its own row and its own save
  // (issue 627) rather than the last field of the gear form.
  "saved-note": { tone: "success", key: "ready.noteSaved" },
  "error-note": { tone: "danger", key: "ready.noteUnavailable" },
  "error-pay": { tone: "danger", key: "ready.paymentUnavailable" },
  "pay-cancelled": { tone: "neutral", key: "ready.paymentCancelled" },
  // Task 49: every throttled action used to redirect with no error param at
  // all, so a rate-limited tap just looked like the button did nothing.
  "error-rate": { tone: "danger", key: "ready.rateLimited" },
  // Task 49: a failed gear/setup save (`saveFitFromReady`'s `?error=fit`)
  // had no entry here either — the same silent-failure gap, one field over.
  "error-fit": { tone: "danger", key: "ready.fitUnavailable" },
  // And its success twin, which that pass missed: the form's own "Saved." sits
  // inside the gear step, and the redirect carries no hash, so the thread comes
  // back at rest with the confirmation shut inside a closed disclosure. The
  // diver taps Save and is told nothing. The failure path was louder than the
  // success path until this row existed.
  "saved-fit": { tone: "success", key: "ready.fitSaved" },
  // Landing here fresh off a successful seat claim (docs ADR
  // 20260804-seat-claim-links) — the one moment to say whose page this now is.
  "saved-claimed": { tone: "success", key: "seatClaim.claimedNotice" },
  // A card the diver typed in. "Added", never "verified": a staff review is
  // what makes it count, and the copy says so rather than implying the
  // checklist row has cleared.
  "saved-cert": { tone: "success", key: "ready.certSaved" },
  // The number is already on file here — most often their own card, entered
  // twice. Nothing to fix, so this is neutral rather than an error.
  "saved-cert-known": { tone: "neutral", key: "ready.certKnown" },
  "error-cert": { tone: "danger", key: "ready.certInvalid" },
  // `selfCancelBooking` refused — the seat flipped to checked-in, or the boat
  // sailed, between this page rendering and the tap. The four refusal reasons
  // are deliberately never distinguished to a diver (a booking-state oracle is
  // still a leak); the shop's number is on the card below.
  "error-cancel": { tone: "danger", key: "ready.cancelUnavailable" },
  "saved-last-dived": { tone: "success", key: "ready.lastDivedSaved" },
  "error-last-dived": { tone: "danger", key: "ready.lastDivedUnavailable" },
  "saved-support": { tone: "success", key: "ready.supportSaved" },
  "error-support": { tone: "danger", key: "ready.supportUnavailable" },
  // The count is refused on its own field (see `saveSupportNeedsFromReady`);
  // the banner stays quiet so the page does not shout about one number.
  "error-support-count": { tone: "neutral", key: "ready.supportDiversCountHint" },
};

/**
 * What to tell a diver whose seat is gone about money they had already paid —
 * derived from the booking's own current payment status and nothing else. It has
 * never been read off the query string: `?cancelled=1` is a trigger telling the
 * page to look, so a hand-edited URL can neither claim a refund that did not
 * happen nor hide one that did.
 *
 * This collapses several distinct non-refund outcomes (past the free-
 * cancellation window, no stated window, a failed/manual Stripe reversal) into
 * one honest "still paid, shop handles it" message, since none of those
 * specific reasons survive as durable state to verify against — only whether
 * the payment row currently reads `refunded` or still `paid`/`deposit_paid`
 * does.
 */
function verifiedCancelNotice(paymentStatus: string | null | undefined): DiverMessageKey | null {
  if (paymentStatus === "refunded") return "ready.refundIssued";
  if (paymentStatus === "paid" || paymentStatus === "deposit_paid") return "ready.refundManual";
  return null;
}

/**
 * Where the diver is actually going, and how to reach the people who will be
 * there — name, street, phone, email, and a map of the front door.
 *
 * This replaces the page's old one-line "Questions? Reach out to {shop}"
 * footer, which named the shop and then left a diver on the morning of a trip
 * to go hunting for the address themselves. Everything is conditional and
 * nothing is guessed: a shop with no address on file renders the contact rows
 * alone, and the map only appears once `shopMapQuery` can build a query that
 * points at a real place (`src/lib/shop-address.ts`).
 */
function ShopCard({
  name,
  contactPhone,
  contactEmail,
  address,
  t,
}: {
  name: string;
  contactPhone: string | null;
  contactEmail: string | null;
  address: ReadyPageData["shop"]["address"];
  t: DiverTranslator;
}) {
  const lines = shopAddressLines(address);
  const mapQuery = shopMapQuery(name, address);
  if (lines.length === 0 && !contactPhone && !contactEmail) return null;
  return (
    // A shell: the map bleeds to the card's edge and the block under it pads
    // itself, so the card contributes only its chrome.
    <SectionCard padding="none" className="mt-10 overflow-hidden">
      {mapQuery ? (
        <iframe
          title={t("ready.shopMapTitle", { shop: name })}
          src={googleMapEmbedUrl(mapQuery)}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          className="block h-48 w-full border-0 bg-surface-sunken sm:h-56"
        />
      ) : null}
      <div className="p-5 sm:p-6">
        <h2 className="text-lg font-semibold">{t("ready.shopHeading")}</h2>
        <p className="mt-2 text-base font-medium">{name}</p>
        {lines.length > 0 ? (
          <address className="mt-1 text-base text-muted not-italic">
            {lines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        ) : null}
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-base">
          {/* gap-y-1 rides in on the className: when a long email wraps under
              the phone number inside the component's own span, the lines keep
              the same breathing room the surrounding row declares. */}
          <ShopContactLinks phone={contactPhone} email={contactEmail} className="gap-y-1" />
          {mapQuery ? (
            <a
              href={googleMapsUrl(mapQuery)}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary hover:underline"
            >
              {t("site.openMap")}
            </a>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}

/**
 * What cancelling right now would mean for money already paid. This is the one
 * consequence the button cannot show on its own, which is why it is the only
 * sentence beside it — a diver past the free-cancellation window learning that
 * *after* the irreversible tap is the failure this exists to prevent.
 */
const CANCEL_PREVIEW_KEY: Record<ReadyPageData["cancelPreview"], DiverMessageKey | null> = {
  refund: "ready.cancelPreviewRefund",
  forfeit: "ready.cancelPreviewForfeit",
  no_policy: "ready.cancelPreviewNoPolicy",
  unpaid: null,
};

/** The "This booking was cancelled" notice, with refund copy derived from the booking's current payment status. */
function cancelledNotice(
  paymentStatus: string | null | undefined,
  tripTitle: string,
  shopName: string,
  t: DiverTranslator,
) {
  const refundKey = verifiedCancelNotice(paymentStatus);
  return (
    <Notice
      glyph="cancelled"
      title={t("ready.cancelledHeading")}
      text={
        refundKey
          ? t(refundKey)
          : t("ready.cancelledSeatReleased", { trip: tripTitle, shop: shopName })
      }
    />
  );
}

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

/**
 * **Which sentence a rescue attempt gets**, as a code the action carries in the
 * URL rather than a sentence it chose. `src/db` returns codes; the page picks
 * the words, so this reads in the visitor's own language and the action stays
 * free of copy — the same arrangement the waiver page's card uses.
 */
const RESCUE_NOTICES: Record<
  string,
  { tone: "success" | "danger" | "neutral"; key: DiverMessageKey }
> = {
  ok: { tone: "success", key: "ready.freshLinkSent" },
  // A newer link for this booking still works, so nothing was reissued — and
  // reissuing would have counted against the booking's live-capability cap.
  // Point them at their inbox without naming the address, like every other
  // notice on this card.
  live: { tone: "success", key: "ready.freshLinkCurrentLive" },
  none: { tone: "neutral", key: "ready.freshLinkNoEmail" },
  unavailable: { tone: "danger", key: "ready.freshLinkUnavailable" },
  failed: { tone: "danger", key: "ready.freshLinkFailed" },
  rate: { tone: "danger", key: "ready.rateLimited" },
};

const RESCUE_TONE: Record<"success" | "danger" | "neutral", string> = {
  success: "bg-success-tint text-success-strong",
  danger: "bg-danger-tint text-danger",
  neutral: "bg-surface-sunken text-muted",
};

/**
 * The dead-link card, with the one thing it can still do.
 *
 * #801 gave this card the shop's name and contact details; the button is the
 * other half of that issue, split out because it changes what the page can *do*
 * rather than what it says (issue #850). The rescue hands the caller nothing:
 * the fresh link goes to the address already on the booking, and only a code
 * comes back here.
 */
function ExpiredLink({
  token,
  shop,
  t,
  sent,
}: {
  token: string;
  shop: Pick<Shop, "name" | "contactEmail" | "contactPhone">;
  t: DiverTranslator;
  sent?: string;
}) {
  // `noticeFromParam`, not `RESCUE_NOTICES[sent]` — `sent` is attacker-supplied
  // and a bare lookup walks the prototype (src/lib/staff-notices.ts).
  const notice = noticeFromParam(sent, RESCUE_NOTICES);
  return (
    <ExpiredLinkCard
      title={t("ready.unavailableHeading")}
      text={t("ready.expiredBody")}
      shop={shop}
      t={t}
    >
      <FlashParams params={["sent"]} />
      {notice ? (
        <p
          role={noticeRole(notice.tone)}
          className={`rounded-lg px-4 py-3 font-medium ${RESCUE_TONE[notice.tone]}`}
        >
          {t(notice.key)}
        </p>
      ) : null}
      {/* `unavailable` is the one terminal answer — the booking is cancelled,
          or the token was never ours — so nothing about tapping again can
          change it. Offering the button would invite a pointless tap and spend
          the booking's rescue budget on it. Every other outcome is worth
          retrying: a provider failure passes, and a live link expires. */}
      {sent === "unavailable" ? null : (
        <form action={emailFreshReadinessLinkAction.bind(null, token)}>
          <SubmitButton pendingLabel={t("ready.sendingFreshLink")} className={buttonClass()}>
            {t("ready.emailFreshLink")}
          </SubmitButton>
        </form>
      )}
    </ExpiredLinkCard>
  );
}

/**
 * **Day-of details** — the last step of the thread's spine, and the one that
 * absorbed four separate rows.
 *
 * Before this it was four: "When did you last dive?", the diver's own note to
 * the crew, the hotel-pickup question and the support-needs record, each a row
 * of its own on a checklist, three of them permanently marked "Optional"
 * because most divers have nothing to say to them. Three rows that could never
 * settle are three reasons the figure over the list could never fill, which is
 * the defect ADR 20260827-the-divers-thread, decision 3 set out to end.
 *
 * So the step **counts, and settles on the recency question** — the one thing
 * genuinely asked of everybody. The other three ride inside it, save on their
 * own actions exactly as before, and gate nothing: answering none of them
 * still finishes the step, and answering one cannot blank another.
 */
function DayOfDetails({
  token,
  data,
  error,
  t,
}: {
  token: string;
  data: ReadyPageData;
  /** The `?error=` code, for the one field that refuses on itself. */
  error?: string;
  t: DiverTranslator;
}) {
  const saveButton = buttonClass({ variant: "secondary", size: "sm" });
  return (
    <div className="divide-y divide-border">
      {/* **The question nobody was asking.** A rung is what the shop gates on;
          currency is what actually catches people, and an honest "Advanced
          Open Water" from 1998 with no dive since 2013 clears every check in
          this product (ADR 20260821-currency-is-what-catches-people). It gates
          nothing — it is here because a diver whose card the shop verified
          years ago is exactly the person worth asking. */}
      <form
        action={saveDiveRecencyFromReady.bind(null, token)}
        className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-end"
      >
        <Field label={t("ready.lastDivedHeading")} htmlFor="last-dived" className="flex-1">
          <select
            id="last-dived"
            name="lastDivedBand"
            required
            defaultValue={data.lastDivedBand ?? ""}
            className={controlClass}
          >
            <option value="">{t("ready.lastDivedChoose")}</option>
            {DIVE_RECENCY_BANDS.map((band) => (
              <option key={band} value={band}>
                {t(DIVER_DIVE_RECENCY_KEYS[band])}
              </option>
            ))}
          </select>
        </Field>
        <SubmitButton pendingLabel={t("ready.savingLastDived")} className={saveButton}>
          {t("ready.saveLastDived")}
        </SubmitButton>
      </form>
      {/* **The diver's own words.** Its own save (`saveNoteFromReady` writes
          the note column and nothing else), so answering it cannot blank sizes
          set last week, and saving sizes cannot blank it (issue 627). */}
      <form action={saveNoteFromReady.bind(null, token)} className="flex flex-col gap-3 py-5">
        <Field label={t("rental.anythingElse")} htmlFor="crew-note">
          <textarea
            id="crew-note"
            name="note"
            rows={2}
            maxLength={300}
            defaultValue={data.rentalFit?.note ?? ""}
            className={controlClass}
          />
        </Field>
        <div>
          <SubmitButton pendingLabel={t("common.saving")} className={saveButton}>
            {t("ready.saveNote")}
          </SubmitButton>
        </div>
      </form>
      {/* The question asks about the *service*, not the address. "Where are you
          staying?" on a list of things a diver owes their shop reads as a
          records question — nobody volunteers their hotel room to a form that
          has not said why it wants it. The field under it keeps the address
          label. */}
      <div className="py-5">
        <h3 className="text-base font-semibold">{t("ready.hotelPickupLabel")}</h3>
        <form
          action={saveHotelPickupLocationFromReady.bind(null, token)}
          className="mt-3 flex flex-col gap-3"
        >
          <Field label={t("ready.hotelPickupFieldLabel")} htmlFor="hotel-pickup">
            <input
              id="hotel-pickup"
              type="text"
              name="hotelPickupLocation"
              maxLength={300}
              placeholder={t("ready.hotelPickupPlaceholder")}
              defaultValue={data.hotelPickupLocation ?? ""}
              className={controlClass}
            />
          </Field>
          <div>
            <SubmitButton pendingLabel={t("common.saving")} className={saveButton}>
              {t("ready.saveHotelPickup")}
            </SubmitButton>
          </div>
        </form>
      </div>
      {/* **What this dive needs set up for you** — the accessible-dive record
          (ADR 20260827-support-needs-are-a-record-about-the-dive). Asked here
          and nowhere else: `/ready` is after the sale and is the diver's own
          page, where the public booking form is a disclosure to a stranger
          before a purchase, on a page the shop's competitors can also load.

          Every question is about the *dive* — how many hands in the water,
          getting aboard, how the briefing reaches you — and none is about the
          diver. There is no condition to declare and nothing here is medical.
          Nothing it records gates anything, this step included. */}
      <div className="pt-5">
        <h3 className="text-base font-semibold">{t("ready.supportLabel")}</h3>
        <form
          action={saveSupportNeedsFromReady.bind(null, token)}
          className="mt-3 flex flex-col gap-4"
        >
          {/* **How many, and who brings them.** Two questions, because the
              shop's action is opposite in each: "please arrange them" is two
              more crew to roster, "they're coming with me" is two more seats to
              book and a buddy team to build. One number could not say which,
              and the crew was reading the same sentence for both. */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">{t("ready.supportDiversLabel")}</legend>
            <RadioRow
              name="supportDiversProvidedBy"
              value=""
              label={t("ready.supportDiversNone")}
              defaultChecked={!data.supportNeeds?.supportDiversProvidedBy}
            />
            <RadioRow
              name="supportDiversProvidedBy"
              value="shop"
              label={t("ready.supportDiversFromShop")}
              defaultChecked={data.supportNeeds?.supportDiversProvidedBy === "shop"}
            />
            <RadioRow
              name="supportDiversProvidedBy"
              value="diver"
              label={t("ready.supportDiversOwn")}
              defaultChecked={data.supportNeeds?.supportDiversProvidedBy === "diver"}
            />
            {/* Seats, not crew. Somebody in the water who is on no manifest is
                a person the coastguard's copy does not know about. */}
            <p className="text-sm text-muted">{t("ready.supportDiversSeatNote")}</p>
          </fieldset>
          <Field
            label={t("ready.supportDiversCountLabel")}
            htmlFor="support-divers"
            // The ceiling is a typo guard, not a limit, and it has to say so: a
            // browser's own validation bubble arrives in the wrong language and
            // reads as a refusal on the one form that must never feel like one.
            hint={t("ready.supportDiversCountHint")}
            error={error === "support-count" ? t("ready.supportDiversCountHint") : undefined}
          >
            <input
              id="support-divers"
              name="supportDiversNeeded"
              type="number"
              inputMode="numeric"
              min={0}
              max={4}
              defaultValue={data.supportNeeds?.supportDiversNeeded ?? ""}
              className={`${controlClass} max-w-24`}
            />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">{t("ready.supportBoardingLegend")}</legend>
            <CheckboxRow
              name="needsBoardingAssistance"
              label={t("ready.supportBoardingAssistance")}
              defaultChecked={data.supportNeeds?.needsBoardingAssistance ?? false}
            />
            <CheckboxRow
              name="needsWaterLift"
              label={t("ready.supportWaterLift")}
              defaultChecked={data.supportNeeds?.needsWaterLift ?? false}
            />
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">{t("ready.supportBriefingLegend")}</legend>
            <CheckboxRow
              name="briefingInSign"
              label={t("ready.supportBriefingSign")}
              defaultChecked={data.supportNeeds?.briefingInSign ?? false}
            />
            <CheckboxRow
              name="briefingInWriting"
              label={t("ready.supportBriefingWriting")}
              defaultChecked={data.supportNeeds?.briefingInWriting ?? false}
            />
            {/* A briefing is delivered off a map or a slate, so the options
                above are all *visual* — which is the wrong set for a blind or
                low-vision diver, and "in writing" is exactly the wrong answer
                for one. */}
            <CheckboxRow
              name="briefingAloud"
              label={t("ready.supportBriefingAloud")}
              defaultChecked={data.supportNeeds?.briefingAloud ?? false}
            />
            <CheckboxRow
              name="briefingBySignals"
              label={t("ready.supportBriefingSignals")}
              defaultChecked={data.supportNeeds?.briefingBySignals ?? false}
            />
          </fieldset>
          <Field label={t("ready.supportEquipmentLabel")} htmlFor="support-equipment">
            <textarea
              id="support-equipment"
              name="equipmentAdaptation"
              rows={2}
              maxLength={300}
              defaultValue={data.supportNeeds?.equipmentAdaptation ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label={t("ready.supportDivesWithLabel")} htmlFor="support-dives-with">
            <input
              id="support-dives-with"
              name="divesWithName"
              maxLength={120}
              defaultValue={data.supportNeeds?.divesWithName ?? ""}
              className={controlClass}
            />
          </Field>
          <div>
            <SubmitButton pendingLabel={t("common.saving")} className={saveButton}>
              {t("ready.saveSupport")}
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}

export default async function DiverReadinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{
    saved?: string;
    error?: string;
    pay?: string;
    cancelled?: string;
    booked?: string;
    sent?: string;
  }>;
}) {
  await connection();
  const { token } = await params;
  const { saved, error, pay, cancelled, booked, sent } = await searchParams;
  // A seat was taken in the request that redirected here — this page is the
  // one page after booking now (ADR 20260820-one-page-after-booking). It
  // switches the celebration from "you're ready" to "you're booked" and turns
  // on the two lines that are only ever true in the minutes after a submit.
  //
  // It carries no claim of its own and authorizes nothing: the payment
  // receipt, the checklist, and every other fact on this page are read from
  // the booking, so a hand-edited `?booked=1` moves nothing but which of two
  // congratulations renders.
  const justBooked = booked === "1";
  const db = await getDb();
  // A dead link resolves no shop, so there is no `shops.default_locale` to fall
  // back to — negotiate from the visitor's own device alone for those branches,
  // then re-negotiate below once the shop is known.
  const anonT = diverTranslator(await requestLocale());
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) {
    // Revoked, expired, or never ours — with one exception. The diver's own
    // cancel revokes this exact token as part of cancelling and then redirects
    // back to it with `?cancelled=1`, so the verified path above can never show
    // that diver their own confirmation. Resolve the token with the revocation
    // check relaxed — never the cancelled-booking or shop-scoping checks — so
    // that one redirect lands on an honest confirmation rather than the generic
    // "isn't available" notice (ADR 20260821-the-diver-may-release-their-own-seat).
    // `cancelled` is only the trigger to look: the refund copy itself comes
    // from the booking's own current payment row, fetched fresh here, never
    // from the query string.
    if (cancelled) {
      const resolved = await resolveRevokedBookingCapability(db, { token, purpose: "readiness" });
      if (resolved) {
        const data = await getReadyPageData(db, resolved.bookingId);
        if (data?.detail.cancelled) {
          const payment = await getBookingPayment(db, data.shop.id, resolved.bookingId);
          return cancelledNotice(
            payment?.status,
            data.detail.trip.title,
            data.detail.shop.name,
            anonT,
          );
        }
      }
    }
    // **Name the shop where the token still tells us which one it is.**
    //
    // `/ready` is the link in the 24-hour trip reminder, so every ordinary way
    // of reaching a dead one — a bookmark from last season, a forwarded email,
    // a reminder for a trip that moved — landed here, on four words telling a
    // diver holding a phone to ask a shop this page would not name (issue
    // #801). The waiver page solved this first and its comments say why the
    // expired branch used to "bail out before the shop (and so its contact
    // info) was ever loaded".
    //
    // `staleBookingCapabilityForToken` relaxes expiry and revocation and
    // nothing else: the hash must still match a capability genuinely issued
    // for this purpose. It is used for the shop's *name and published contact
    // details* and for nothing else — no booking, no diver, no trip is read
    // through an expired token, because an expired token is not a key.
    const stale = await staleBookingCapabilityForToken(db, { token, purpose: "readiness" });
    const staleShop = stale ? await getShopById(db, stale.shopId) : null;
    if (staleShop) {
      const staleT = diverTranslator(await requestLocale(staleShop.defaultLocale));
      return <ExpiredLink token={token} shop={staleShop} t={staleT} sent={sent} />;
    }
    // Nothing resolved at all (garbage, or a token that was never ours). There
    // is no shop to attribute it to without weakening the guarantee the model
    // rests on — a bearer token reveals only its own record.
    return (
      <Notice title={anonT("ready.unavailableHeading")} text={anonT("ready.unavailableBody")} />
    );
  }
  const { bookingId } = capability;

  const data = await getReadyPageData(db, bookingId);
  if (!data) {
    return (
      <Notice title={anonT("ready.unavailableHeading")} text={anonT("waiver.unavailableBody")} />
    );
  }

  const { detail, shop, person } = data;
  const locale = await requestLocale(shop.defaultLocale);
  const t = diverTranslator(locale);
  const firstName = detail.person.fullName.split(" ")[0] || t("ready.namelessFallback");
  // Every date, time, and relative phrase on this page formats for `locale` —
  // the *negotiated* one. These four used to pass `shop.defaultLocale`
  // straight into the formatter, so a diver reading Spanish prose got the
  // shop's own language for the one thing they most need to read at a glance:
  // when to show up (AGENTS.md — never hard-code a locale in the UI).
  const when = formatShortDate(detail.trip.startsAt, locale, detail.shop.timezone);
  const timeRange = formatTimeRangeTz(
    detail.trip.startsAt,
    detail.trip.endsAt,
    locale,
    detail.shop.timezone,
  );
  // Task 46: the day-before email already tells a diver when to be at the
  // dock (`dockCallPhrase` in src/lib/notifications/email.ts) — this page
  // never did, so a diver re-checking it after reading the email couldn't
  // find the one number that actually matters that morning.
  const dockCallAt = new Date(detail.trip.startsAt.getTime() - shop.dockCallMinutes * 60_000);
  const dockCallLine = t("ready.dockCallLine", {
    time: formatTime(dockCallAt, locale, detail.shop.timezone),
    dock: t("notifications.common.dockCallMinutes", { minutes: shop.dockCallMinutes }),
  });
  // Task 47: "in 2 days" / "tomorrow" / "today" — the page a diver opens the
  // night before should read at least as rich as the email that sent them
  // here, and a bare date is easy to misjudge at a glance the way a full
  // relative phrase isn't.
  const cancelPreviewKey = CANCEL_PREVIEW_KEY[data.cancelPreview];
  const relativeWhen = formatRelativeDay(
    detail.trip.startsAt,
    nowDate(),
    locale,
    detail.shop.timezone,
  );

  if (detail.cancelled) {
    // The shop took this seat off the boat and this diver still holds a live
    // link to it. Staff cancellation revokes the booking's capabilities too, so
    // reaching here means the read above won the race against that revoke —
    // rare, and the one path on which a diver learns from this page rather than
    // from the shop. What it says about their money is read from the payment
    // row, never from anything on the URL.
    const payment = await getBookingPayment(db, data.shop.id, bookingId);
    return cancelledNotice(payment?.status, detail.trip.title, detail.shop.name, t);
  }

  /**
   * The shop's own published identity, in the shape the two terminal notices
   * below hand to `ExpiredLinkCard`. A live token has already resolved the
   * shop, and a diver holding a phone on a day that went wrong needs somebody
   * to ask (issue #801).
   */
  const shopContact = {
    name: detail.shop.name,
    contactEmail: shop.contactEmail,
    contactPhone: shop.contactPhone,
  };

  if (data.departureCancelled) {
    /**
     * **The departure was called off**, and this diver's seat is still live —
     * which is the *normal* shape of a blow-out rather than an inconsistency
     * to tolerate. `callTripBlowout` cancels the trip and deliberately leaves
     * every booking active, because whether each seat is refunded stays a
     * per-booking staff decision (src/db/blowouts.ts). So `detail.cancelled`
     * above is false for every diver a cancellation stranded, and until a
     * review caught it (2026-08-28) nothing else asked: the page carried on
     * with a packing list before the boat was due back, and an hour after it
     * was due back with the afterglow — "Welcome back", a dive record naming
     * the boat and the crew, a request to rate the day and an invitation to
     * tip them. That is the single worst message a shop can send on the
     * afternoon it blew out, and it went automatically to everyone who drove
     * to the dock.
     *
     * The money is deliberately not spoken to. The cascade's own message
     * carries each diver's refund story, read from their payment row as it
     * was composed; a page guessing at it hours later is how two DiveDay
     * surfaces come to disagree about where somebody's money is.
     */
    return (
      <ExpiredLinkCard
        glyph="cancelled"
        title={t("booking.cancelledHeading")}
        text={t("ready.tripCancelledBody")}
        shop={shopContact}
        t={t}
      >
        <Link href={publicSchedulePath(shop.slug)} className={buttonClass()}>
          {t("recap.seeWhatsNext")}
        </Link>
      </ExpiredLinkCard>
    );
  }

  /**
   * **After the dive, the same link** (ADR 20260827-the-divers-thread,
   * decision 4). Once this diver's day is over, everything below this point —
   * the spine, the packing list, the self-cancel door — is about a day that
   * has already happened. The page becomes the afterglow instead: the
   * keepsake, one review ask, and quiet doors. `/recap/[token]` renders
   * exactly this, from its own token.
   *
   * **Whose day, not just what time it is.** The switch used to be the clock
   * alone, and the clock cannot tell whether this diver was on the boat — so
   * the crew's own departure roll call decides it wherever a shop kept one,
   * and the four-hour recap floor decides it where none exists
   * (`isAfterTheDive`, src/lib/thread-steps.ts). The read only happens once
   * the boat is scheduled home, so an ordinary night-before page load never
   * pays for it.
   *
   * The three recap actions are bound to a **recap** token minted here, never
   * to this page's readiness token: the two capabilities are domain-separated
   * on purpose (`src/lib/recap-links.ts`), and widening the recap actions to
   * accept a readiness token would hand a review form the power to cancel a
   * booking. The cost is that acting on one of them lands the diver on the
   * `/recap` URL, which renders this same surface.
   */
  const boarded = theBoatIsHome({ endsAt: detail.trip.endsAt })
    ? await departureRollCallForBooking(db, shop.id, detail.trip.id, bookingId)
    : null;
  if (isAfterTheDive({ endsAt: detail.trip.endsAt, boarded })) {
    const recap = await getRecapPageData(db, bookingId);
    if (!recap) {
      /**
       * **A no-show, said plainly and with somebody to ask.**
       *
       * Both cancellations — the booking's and the departure's — are answered
       * above, so `getRecapPageData`'s uniform null means
       * `bookings.status = 'no_show'` here (or a cancellation that landed in
       * the microseconds between the two reads, which this notice's contact
       * line covers either way).
       *
       * It used to render "This readiness link isn't available" over "This
       * booking didn't sail" — two sentences, both false for this reader: the
       * token had just verified, and the boat sailed without them. A diver
       * being charged a no-show fee, holding DiveDay's own page telling them
       * the trip never ran, is where a chargeback argument starts.
       */
      return (
        <ExpiredLinkCard
          glyph="cancelled"
          title={t("recap.noShowHeading")}
          text={t("recap.noShowBody", { shop: detail.shop.name })}
          shop={shopContact}
          t={t}
        />
      );
    }
    const recapToken = signRecapToken(bookingId);
    const after = await buildAfterStateProps({
      db,
      data: recap,
      bookingId,
      locale,
      t,
      // This route carries none of the three: each action redirects to
      // `/recap/<token>`, which is where its notice is read.
      params: {},
      actions: {
        submitReview: submitReviewAction.bind(null, recapToken),
        uploadPhoto: uploadRecapPhotoAction.bind(null, recapToken),
        startTip: startTipAction.bind(null, recapToken),
      },
    });
    return (
      <DiverIntlProvider
        locale={locale}
        timeZone={detail.shop.timezone}
        namespaces={["recap", "common", "booking", "reviews", "trip"]}
      >
        <AfterState {...after} />
      </DiverIntlProvider>
    );
  }

  // The organizer's claim panel, when this booking leads a party (docs ADR
  // 20260804-seat-claim-links): the readiness link is the durable one from
  // the confirmation email, so "who still hasn't claimed?" has an answer the
  // night before, not only in the minutes after booking. Authorized by the
  // verified `readiness` capability above; the query only ever walks seats
  // led by this booking, so a member's own /ready renders no panel.
  const partySeatClaims = await issuePartySeatClaims(db, {
    shopId: shop.id,
    leadBookingId: bookingId,
  });
  const claimOrigin = publicAppUrl();
  const partySeats = partySeatClaims.map((seat) => ({
    bookingId: seat.bookingId,
    seatName: seat.seatName,
    claimed: seat.claimed,
    claimUrl: seat.claim
      ? claimOrigin
        ? new URL(claimLinkPath(seat.claim.token), `${claimOrigin}/`).toString()
        : claimLinkPath(seat.claim.token)
      : null,
  }));

  // The trip itself, as the public trip page reads it.
  //
  // This page used to carry a five-line header and a thumbnail strip of site
  // names, so a diver who arrived here from the confirmation email — the link
  // the shop actually sends the night before — could not see which site each
  // tank was on, or what to put in the bag, without going and finding the
  // public trip page (2026-08-06 review). Its own sections stay what they were:
  // this adds the two the page had no answer for at all, and drops the site
  // *peek*, which the briefings below say properly.
  //
  // Read here in the page, not in a layout: `instant = true` holds because
  // every one of these sits inside this segment's own `loading.tsx` boundary
  // (ADR 20260804-instant-navigation).
  // One round trip, not two: the trip reads are scoped by `shop.id`, which the
  // verified capability already resolved, so none of them has to wait on the
  // shop row `PackingSection` needs for its units and rental catalogue.
  const [fullShop, fullTrip, tripDives] = await Promise.all([
    getShopBySlug(db, shop.slug),
    getTripWithBooked(db, shop.id, data.trip.id),
    listTripDives(db, shop.id, data.trip.id),
  ]);
  // What one seat on this departure costs. Null on an unpriced trip, which
  // then quotes nothing rather than guessing — see `resolvePaymentReceipt`,
  // which takes the same figure to work out a balance after a deposit.
  const fullPriceCents = fullTrip ? perDiverBookingPriceCents(fullTrip, fullTrip.course) : null;

  // What this booking has been charged. Read on every visit, because "what did
  // I pay?" is a question the night before too — and it is what the Pay step's
  // settled line says, now that the receipt panel that used to say it above
  // the checklist is gone (ADR 20260827-the-divers-thread, decision 3).
  //
  // The emails line went with that panel. It claimed, in the minutes after a
  // submit, that two messages were on their way — a third statement of the
  // booking's status in one screenful, on a page whose status is now said once
  // by the spine. `EmbedBookedNotice` still carries it where it is the *only*
  // thing the reader gets, which is the embed's confirmation and not this page.
  const paymentReceipt = await resolvePaymentReceipt(
    db,
    shop.id,
    bookingId,
    // The two ways a diver arrives here straight off Stripe's hosted page:
    // paying at booking (`bookSpot`'s success_url) and paying later
    // (`payFromReady`'s). Both are the moment the webhook may still be in
    // flight; every other arrival is not.
    justBooked || pay === "paid",
    fullPriceCents,
    toShopCurrency(shop.currency),
  );
  // Absolute where a canonical origin is configured — this one exists to be
  // pasted into a group chat — with the relative fallback the claim links above
  // use, so a missing APP_HOST shares a working same-origin link rather than a
  // broken one. Never `window.location.href`: see `TripActions`' `shareUrl`.
  const shareOrigin = publicAppUrl();
  const tripPath = publicTripPath(shop.slug, data.trip.id);
  const shareTripUrl = shareOrigin ? new URL(tripPath, `${shareOrigin}/`).toString() : tripPath;

  // Dive 1 first, in the dive plan's own order: where a site names its own
  // time in the water, that is what the day's rhythm counts rather than the
  // shop-wide default (src/lib/diver-planning.ts).
  const siteBottomTimes = tripDives.map(({ diveSite }) => diveSite?.expectedBottomTimeMinutes);
  // ...and each leg of the run between them, same order: dock to the first
  // site, then site to site (ADR 20260815-per-leg-travel-minutes). The morning
  // of a dive is when a long second leg matters most.
  const legTravelTimes = tripDives.map(({ dive }) => dive.travelMinutes);

  const items = buildDiverChecklist(detail.requirement, detail.readiness);
  /**
   * **A balance nobody named.** "There's a balance to settle" is the one step
   * on this spine whose whole subject is a number, and it carried none — the
   * amount lived on a receipt panel that exists only once something has
   * *already* settled, so the diver being asked to pay was the one reader who
   * could not see the figure.
   *
   * The trip's own list price, in the shop's currency. This is raised only on
   * an unpaid or refunded booking — `PAYMENT_CLEARED` clears a part-paid
   * deposit, so a fare is either owed whole or not owed here at all — and an
   * unpriced departure quotes nothing rather than a guess. A *settled* payment
   * quotes the receipt instead: what was actually charged is evidence, and it
   * outranks a list price that may have moved since (ADR
   * 20260731-shop-currency reasons the same way about currency).
   */
  const amountDueText =
    fullPriceCents !== null && fullPriceCents > 0
      ? formatMoneyCents(fullPriceCents, toShopCurrency(shop.currency), locale)
      : null;
  /**
   * The rung this departure actually demands — the stricter of what the shop
   * set on the trip and what the sites it visits impose
   * (`combineCertRequirements`, the same fold the readiness engine gates on).
   *
   * Named on the certification step (issue 627) because "we still need your
   * certification card" never said *which* card, and a diver holding Open Water
   * had no way to tell from this page whether the Advanced they don't have was
   * the thing standing between them and the boat. Null when the departure gates
   * on specialties or nitrox but no level, which is a real shape.
   */
  const requiredLevel = detail.requirement
    ? combineCertRequirements(detail.requirement, detail.siteRequirement).minimumCertificationLevel
    : null;
  // A rental fit is on file — the diver has answered the gear question at least
  // once, whatever they answered. "Bringing my own" is a complete answer, so
  // this asks whether the question was answered, never whether anything was
  // rented. `fitStatedAt`, not the row's existence: the note below writes the
  // same `rental_fit_profiles` row without stating a fit (schema.ts).
  const hasRentalFit = data.rentalFit?.fitStatedAt != null;
  // The diver has answered the currency question at least once. Every band is
  // a complete answer, "I haven't dived yet" included.
  const hasLastDived = data.lastDivedBand != null;
  // Whether to ask for a nitrox card nothing has asked for yet — the rule
  // itself lives in `src/lib/rentals.ts` beside `nitroxAvailableOn`, because
  // the card disclosure and the rental form's request lock are two surfaces
  // that must answer it identically.
  const offerNitroxCard = nitroxCardWanted(shop.rentalItems, data.trip.course, {
    verified: data.nitroxCardVerified,
    onFile: data.nitroxCardOnFile,
  });
  /**
   * ...and whether this page can actually make that offer. The disclosure
   * lives inside the certification step, so it can only be rendered on a
   * booking that has one. `RentalFitForm` locks on this single boolean rather
   * than on a second copy of the rule, so the lock and the offer cannot
   * disagree.
   */
  const nitroxCardEntryOffered =
    offerNitroxCard && items.some((item) => item.category === "certification");

  /**
   * **The spine** (ADR 20260827-the-divers-thread, decision 3). Every step it
   * emits is finishable, so the figure over it can always fill — which is the
   * whole reason the optional questions (the note, hotel pickup, support
   * needs) live *inside* Day-of details rather than beside it as rows of their
   * own that moved no number when answered.
   */
  const spine = buildThreadSteps({
    checklist: items,
    // Money is owed, or money has settled. The receipt matters on its own:
    // a departure whose requirement does not gate on payment can still have
    // taken a card at booking, and that payment has to render somewhere.
    hasPayableOrder: items.some((item) => item.category === "payment") || paymentReceipt !== null,
    rentalFitComplete: hasRentalFit,
    dayOfComplete: hasLastDived,
  });

  const notice = noticeFromParam(
    saved ? `saved-${saved}` : error ? `error-${error}` : pay ? `pay-${pay}` : undefined,
    READY_NOTICES,
  );

  /**
   * The departure is today. From 00:00 in the shop's own zone, not twenty-four
   * hours out: the night before, this page is a plan; on the day it is a
   * morning, and the dock call is the only number on it that matters.
   */
  const diveDay = isDiveDay({
    startsAt: detail.trip.startsAt,
    endsAt: detail.trip.endsAt,
    timeZone: detail.shop.timezone,
  });

  /** "Everyone's set — see you at the dock." The rule is `partyIsAllSet`'s. */
  const ownSignStep = spine.steps.find((step) => step.id === "sign");
  const partyAllSet = partyIsAllSet({
    seats: partySeatClaims,
    ownSignSettled: !ownSignStep || ownSignStep.state === "done",
    diveDay,
  });

  /** A money figure in the currency it was actually charged in, never today's shop setting. */
  const money = (cents: number, currency: string) => formatMoneyCents(cents, currency, locale);
  /**
   * What the Pay step says once it has settled: the figure, which is the one
   * thing the step's own word ("Paid") cannot carry. The receipt's currency,
   * not the shop's — a shop that switches currency next season must not
   * restate last season's charge (ADR 20260731-shop-currency).
   */
  const paidLine =
    paymentReceipt && paymentReceipt.amountCents !== null
      ? money(paymentReceipt.amountCents, paymentReceipt.currency)
      : t("ready.checklistDetail.paymentDone");
  const depositBalanceLine =
    paymentReceipt?.isDeposit && paymentReceipt.balanceDueCents > 0
      ? t("booking.paymentDepositBalance", {
          balance: money(paymentReceipt.balanceDueCents, paymentReceipt.currency),
        })
      : null;

  /** One step's fact, and one step's form. The two things the spine cannot derive. */
  const stepLine = (step: ThreadStep): string | null => {
    if (step.id === "gear") return hasRentalFit ? t("ready.gearOnFile") : null;
    if (step.id === "dayof") {
      return hasLastDived && data.lastDivedBand
        ? t(DIVER_DIVE_RECENCY_KEYS[data.lastDivedBand])
        : null;
    }
    if (step.id === "pay" && step.state === "done") return paidLine;
    if (!step.item) return null;
    // The certification step names which rung, on every state including
    // "done" — a diver reading a settled step still wants to know what it
    // settled against (issue 627).
    if (step.item.category === "certification" && requiredLevel) {
      return `${checklistDetailText(t, step.item)} ${t("ready.certMinimumLevel", {
        level: t(DIVER_CERTIFICATION_LEVEL_KEYS[requiredLevel]),
      })}`;
    }
    if (step.id === "pay" && step.state === "your_turn" && amountDueText) {
      return t("ready.checklistDetail.paymentDueAmount", { amount: amountDueText });
    }
    return checklistDetailText(t, step.item);
  };

  /**
   * The step's form, or nothing.
   *
   * A settled step returns nothing and renders as a line — with two deliberate
   * exceptions, gear and Day-of, whose answers a diver genuinely revisits (a
   * fin size the night before, a recency band they mistyped). Those stay
   * openable, and "collapses to a check line" is what their closed summary
   * already is.
   */
  const stepBody = (step: ThreadStep): React.ReactNode => {
    const primary = step.id === spine.current;
    const actionButton = buttonClass(
      primary ? { size: "sm" } : { variant: "secondary", size: "sm" },
    );
    switch (step.id) {
      case "sign":
        // An expired link needs the same action as a pending one —
        // `signWaiverFromReady` always issues a fresh link and opens it,
        // superseding whatever came before, so the only difference is what the
        // button promises. Naming it matters: "Sign your waiver" on a link the
        // diver already knows is dead reads as the page not having noticed.
        if (step.item?.code !== "waiver_pending" && step.item?.code !== "waiver_expired") {
          return null;
        }
        return (
          <form action={signWaiverFromReady.bind(null, token)}>
            <SubmitButton pendingLabel={t("ready.opening")} className={actionButton}>
              {t(
                step.item.code === "waiver_expired" ? "ready.freshWaiverLink" : "ready.signWaiver",
              )}
            </SubmitButton>
          </form>
        );
      case "certification":
        if (!step.item) return null;
        return (
          <CertificationEntries
            token={token}
            item={step.item}
            offerNitrox={nitroxCardEntryOffered}
            t={t}
          />
        );
      case "pay": {
        const payable =
          data.canPay &&
          (step.item?.code === "payment_due" || step.item?.code === "payment_refunded");
        if (!payable && !depositBalanceLine) return null;
        return (
          <>
            {depositBalanceLine ? (
              <p className="text-base text-muted">{depositBalanceLine}</p>
            ) : null}
            {payable ? (
              <form action={payFromReady.bind(null, token)} className="mt-3 first:mt-0">
                <SubmitButton pendingLabel={t("ready.openingPayment")} className={actionButton}>
                  {t("ready.payForTrip")}
                </SubmitButton>
              </form>
            ) : null}
            {/* The one term still ahead of a diver who has already decided,
                where ADR 20260820-one-page-after-booking always meant it to
                land — beside the money, not on the public pitch page. Once
                Pay settles the step closes and the footer's cancel door
                carries the same window. */}
            {payable && fullShop && fullTrip ? (
              <TripTerms shop={fullShop} trip={fullTrip} locale={locale} />
            ) : null}
          </>
        );
      }
      case "gear":
        return (
          <RentalFitForm
            action={saveFitFromReady.bind(null, token)}
            rentalFit={data.rentalFit}
            rentalItems={data.shop.rentalItems}
            course={data.trip.course}
            pricing={data.shop.rentalPricing}
            currency={toShopCurrency(data.shop.currency)}
            wantsNitrox={data.wantsNitrox}
            nitroxCardVerified={data.nitroxCardVerified}
            nitroxCardOnFile={data.nitroxCardOnFile}
            nitroxCardEntryOffered={nitroxCardEntryOffered}
            plannedDives={data.trip.plannedDives}
            saved={saved === "fit"}
          />
        );
      case "dayof":
        return <DayOfDetails token={token} data={data} error={error} t={t} />;
    }
  };

  const spineSteps: ThreadSpineStep[] = spine.steps.map((step) => ({
    id: step.id,
    state: step.state,
    current: step.id === spine.current,
    title: t(THREAD_STEP_TITLE_KEYS[step.id]),
    stateWord: step.state === "done" ? null : t(THREAD_STEP_STATE_KEYS[step.state]),
    line: stepLine(step),
    body: stepBody(step) ?? undefined,
  }));

  return (
    // The whole page under the provider, not just the one Client Component
    // that needs it today: a `useTranslations` call in a client child without
    // it throws during the server render and takes the entire page down to a
    // blank 200 (which is exactly how RentalFitForm broke this surface once).
    // Its namespaces are "rental" (RentalFitForm's own copy), "common"
    // ("common.optional", shared with several field hints), and "trip"
    // (TripActions' add-to-calendar and share-with-a-buddy row).
    <DiverIntlProvider
      locale={locale}
      timeZone={detail.shop.timezone}
      namespaces={["rental", "common", "trip"]}
    >
      <ThreadShell
        shopName={detail.shop.name}
        title={detail.trip.title}
        meta={
          <>
            <p className="mt-1 text-base text-muted">
              {when} · {timeRange} · {relativeWhen}
            </p>
            {/* Today. Said once, above the only number that matters this
                morning — plain ink, no motion: the thread's three coral
                moments are booked, paperwork done, and welcome home, and
                "your boat is today" is none of them. */}
            {diveDay ? (
              <p className="mt-2 text-lg font-semibold">{t("thread.diveDayLine")}</p>
            ) : null}
            {/* The one number that matters on the morning of the trip — a
                shade stronger than the meta line above it, never shouting.
                When a hotel pickup is scheduled, that time leads ahead of dock
                call. */}
            {data.pickupTime ? (
              <p className="mt-1 text-base font-medium">
                {t("ready.hotelPickupHeaderLine", {
                  time: data.pickupTime,
                  location: data.hotelPickupLocation ?? t("ready.hotelPickupLocationNotSet"),
                })}
              </p>
            ) : (
              <p className="mt-1 text-base font-medium">{dockCallLine}</p>
            )}
            {/* Put the day in a calendar, and send the trip to whoever is
                coming — the same ghost-weight row, in the same place under the
                masthead, as the public trip page carries.

                `shareUrl` is the **public trip page**, never this one: this URL
                *is* a bearer capability that can cancel the booking and move
                its refund, and "share with a buddy" must not hand that to a
                group chat (docs/engineering/capability-telemetry-runbook.md). */}
            {fullShop ? (
              <TripActions
                calendarUrl={publicTripCalendarPath(fullShop.slug, data.trip.id)}
                shareUrl={shareTripUrl}
              />
            ) : null}
            {/* What this page *is*, said once, at the top. Divers arrive here
                from a booking submit or an emailed link, and both of those
                read as a confirmation — a thing you look at once and close.
                This one is not: it is the same URL all week, it is where the
                cards and the gear answers go, and it restates itself every
                time the shop moves. */}
            <p className="mt-3 text-sm text-muted">{t("ready.keepThisPage")}</p>
          </>
        }
      >
        {/* `booked` among them: the celebration is the moment a seat was taken,
            not a property of the link. Leaving it in the URL would replay
            "You're on the boat" every time a diver reopened this page from
            their history three days later. */}
        <FlashParams params={["saved", "error", "pay", "booked"]} />
        {notice ? (
          <div className="mt-6">
            <ShopNotice tone={notice.tone} role={noticeRole(notice.tone)}>
              {t(notice.key)}
            </ShopNotice>
          </div>
        ) : null}
        {/* Client-only, per-device convenience (task 27): remember who just
            booked so their next visit starts from a filled-in form. */}
        {justBooked && person.email ? (
          <RememberBooker fullName={detail.person.fullName} email={person.email} />
        ) : null}
        {/* **The thread's first coral moment, and the only one this page
            spends** (ADR 20260827-the-divers-thread, decision 6): a seat was
            just taken. The all-set state is *not* a second one — it settles
            into the plain success line inside the status head below, because
            "paperwork done" is the waiver page's moment and one moment does
            not fire twice. Title only, no body: the header three lines up
            already says the date, the time and the dock call. */}
        {justBooked ? (
          <EarnedMoment
            className="mt-8"
            title={t("booking.confirmedHeading", { name: firstName })}
          />
        ) : null}
        {spine.setupItem ? (
          // Nothing on this booking is the diver's until the shop finishes its
          // own configuration, so there is no spine and no figure — one
          // reassuring line, in the engine's own words. Deliberately the
          // item's *own* sentence rather than the generic setup one: H-22's
          // minimum-age wording says something a diver can act on, and
          // collapsing to "still finalizing" would throw it away.
          <p className="mt-8 text-base text-muted">{checklistDetailText(t, spine.setupItem)}</p>
        ) : (
          <>
            <ThreadStatus
              done={spine.done}
              doneSuffix={t("thread.stepsDoneSuffix", { total: spine.countable })}
              settled={spine.done === spine.countable}
              trailing={
                spine.done === spine.countable
                  ? t("ready.allSetHeading")
                  : spine.current
                    ? t("thread.nextStep", {
                        step: t(THREAD_STEP_TITLE_KEYS[spine.current]),
                      })
                    : t("thread.withShopHead")
              }
            />
            <ThreadSpine steps={spineSteps} />
          </>
        )}
        <PartyClaimPanel locale={locale} seats={partySeats} className="mt-8" />
        {partyAllSet ? (
          <p className="mt-3">
            <SettledCheck settled label={t("thread.partyAllSet")} className="text-sm text-muted" />
          </p>
        ) : null}
        {/* What to put in the bag. Below the spine — which carries the gear
            form as one of its steps — because this page's job is still "what's
            left before you sail", and this is what a diver reads once that is
            settled. The dive briefings that used to follow it are the trip
            page's "The day" list and the after-state's keepsake now: what
            you'll see down there is pitch and memory, not preparation. */}
        {fullShop && fullTrip ? (
          <PackingSection
            shop={fullShop}
            trip={fullTrip}
            rentalFit={data.rentalFit}
            // Never the "every day follows this shape" note here, even on a
            // course weekend: this page is what a diver reads the morning they
            // sail, about the day in front of them.
            multiDay={false}
            siteBottomTimes={siteBottomTimes}
            legTravelTimes={legTravelTimes}
            // This page renders no conditions card at all, so the suit line
            // has nowhere else to land — and the morning of a dive is exactly
            // when a diver is deciding what to put in the car.
            temperatureStatedAbove={false}
            locale={locale}
          />
        ) : null}
        {/* The diver may release their own seat; moving it is the shop's
            (ADR 20260821-the-diver-may-release-their-own-seat). It sits last,
            under everything the page is actually for, and above the shop card
            whose phone number answers every plan change this button does not.
            Rendered only when `selfCancelBooking` would actually honour it, so
            there is no control here that could only come back refused. */}
        {data.canCancelBooking ? (
          <section className="mt-10 border-t border-border pt-6">
            {cancelPreviewKey ? (
              <p className="text-base text-muted">{t(cancelPreviewKey)}</p>
            ) : null}
            <form action={cancelMyBookingAction.bind(null, token)} className="mt-3">
              {/* The refund preview is repeated inside the confirm rather than
                  left further up the page: the diver reads what it costs at the
                  moment of commitment, not once on the way past. */}
              <InlineConfirm
                triggerLabel={t("ready.cancelSpot")}
                triggerClassName={buttonClass({ variant: "danger", size: "sm" })}
                message={[
                  t("ready.cancelConfirm", { trip: detail.trip.title }),
                  cancelPreviewKey ? t(cancelPreviewKey) : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                confirmLabel={t("ready.cancelConfirmButton")}
                cancelLabel={t("ready.neverMind")}
                pendingLabel={t("ready.cancelling")}
                confirmClassName={buttonClass({ variant: "danger", size: "sm" })}
              />
            </form>
          </section>
        ) : null}
        <ShopCard
          name={detail.shop.name}
          contactPhone={shop.contactPhone}
          contactEmail={shop.contactEmail}
          address={shop.address}
          t={t}
        />
      </ThreadShell>
    </DiverIntlProvider>
  );
}
