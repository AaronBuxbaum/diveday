import type { Metadata } from "next";
import { connection } from "next/server";
import { DiveBriefingsSection } from "@/app/s/[shopSlug]/trips/[id]/_components/DiveBriefingsSection";
import { PackingSection } from "@/app/s/[shopSlug]/trips/[id]/_components/PackingSection";
import { RentalFitForm } from "@/app/s/[shopSlug]/trips/[id]/_components/RentalFitForm";
import { TripActions } from "@/app/s/[shopSlug]/trips/[id]/_components/TripActions";
import { EntryDone } from "@/components/account/EntryShell";
import { EarnedMoment } from "@/components/EarnedMoment";
import { FlashParams } from "@/components/FlashParams";
import { PartyClaimPanel } from "@/components/PartyClaimPanel";
import { RememberBooker } from "@/components/RememberBooker";
import { ShopContactLinks } from "@/components/ShopContactLinks";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { TokenPageHeader } from "@/components/TokenPageHeader";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard, sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import {
  resolveRevokedBookingCapability,
  verifyBookingCapability,
} from "@/db/booking-capabilities";
import { getLatestCheckoutForBooking, refreshCheckoutFromStripe } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { listDiveSiteBriefingExtras } from "@/db/dive-sites";
import { bookingConfirmationAndWaiverEmailsSent } from "@/db/notifications";
import { getBookingPayment } from "@/db/payments";
import { getReadyPageData, type ReadyPageData } from "@/db/ready";
import { certificationAgency, certificationLevel, type DiveSpecialty } from "@/db/schema";
import { issuePartySeatClaims } from "@/db/seat-claims";
import { getShopBySlug } from "@/db/shops";
import { getTripWithBooked, listTripDives } from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { fieldGuideCards } from "@/i18n/marine-life-labels";
import { type DiverMessageKey, type DiverTranslator, diverTranslator } from "@/i18n/messages";
import {
  DIVER_CERTIFICATION_AGENCY_KEYS,
  DIVER_CERTIFICATION_LEVEL_KEYS,
  DIVER_SPECIALTY_KEYS,
} from "@/i18n/readiness-labels";
import { checklistCategoryText, checklistDetailText } from "@/i18n/readiness-summary-labels";
import { requestLocale } from "@/i18n/request";
import { claimLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
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
import { publicTripCalendarPath, publicTripPath } from "@/lib/public-routes";
import type { ReadinessBlockerCode } from "@/lib/readiness";
import {
  buildDiverChecklist,
  type ChecklistState,
  type DiverChecklistItem,
  nextDiverStep,
} from "@/lib/readiness-summary";
import { nitroxCardWanted } from "@/lib/rentals";
import { shopAddressLines, shopMapQuery } from "@/lib/shop-address";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import {
  cancelMyBookingAction,
  payFromReady,
  saveCertificationFromReady,
  saveEmergencyContactFromReady,
  saveFitFromReady,
  saveNitroxCertificationFromReady,
  saveSpecialtyFromReady,
  signWaiverFromReady,
} from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return {
    title: t("ready.metaTitle"),
    robots: { index: false, follow: false },
  };
}

const STATE_STYLE: Record<
  ChecklistState,
  { glyph: string; word: DiverMessageKey; box: string; text: string }
> = {
  // `-strong` on the success pair: the raw light-palette hue reads 4.39:1 on
  // its own 10% fill, under AA (docs/design/forms-and-controls.md).
  done: {
    glyph: "✓",
    word: "ready.stateDone",
    box: "bg-success/10 text-success-strong",
    text: "text-success-strong",
  },
  action: {
    glyph: "→",
    word: "ready.stateAction",
    box: "bg-primary/10 text-primary",
    text: "text-primary",
  },
  waiting: {
    glyph: "•",
    word: "ready.stateWaiting",
    box: "bg-surface-sunken text-muted",
    text: "text-muted",
  },
};

function ChecklistRow({
  label,
  state,
  detail,
  action,
  t,
}: {
  label: string;
  state: ChecklistState;
  /** Already resolved by the caller — see `checklistDetailText`. */
  detail: string;
  action?: React.ReactNode;
  t: DiverTranslator;
}) {
  const style = STATE_STYLE[state];
  return (
    <li className="flex items-start gap-4 px-4 py-4 sm:px-5">
      <span
        aria-hidden="true"
        className={`grid size-10 shrink-0 place-items-center rounded-xl text-lg font-bold ${style.box}`}
      >
        {style.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <h3 className="text-base font-semibold">{label}</h3>
          <span className={`text-sm font-semibold ${style.text}`}>{t(style.word)}</span>
        </div>
        <p className="mt-0.5 text-base text-muted">{detail}</p>
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </li>
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
 * The receipt itself. Not a `SectionCard`: this panel carries a *tone* (a
 * settled payment), which the shared card deliberately does not model. Its
 * radius follows the canonical one so it sits at the same corner as the
 * checklist above it.
 */
function PaymentReceiptPanel({
  receipt,
  locale,
  t,
}: {
  receipt: NonNullable<PaymentReceipt>;
  locale: string;
  t: DiverTranslator;
}) {
  const depositWithBalance = receipt.isDeposit && receipt.balanceDueCents > 0;
  // The currency comes off the settled payment row, not today's shop setting:
  // a receipt is evidence of what was charged, and a shop that switches
  // currency next season must not restate last season's amount (docs ADR
  // 20260731-shop-currency). The balance is the remainder of that same charge,
  // so it is quoted in the same currency. `formatMoneyCents` divides by *that*
  // currency's minor unit — a ¥9,000 deposit is not ¥90.
  const money = (cents: number) => formatMoneyCents(cents, receipt.currency, locale);
  return (
    <div className="mt-8 rounded-2xl border border-success/40 bg-success/10 p-4 text-left sm:p-5">
      <h2 className="font-semibold text-success">
        {depositWithBalance ? t("booking.paymentDepositReceived") : t("booking.paymentReceived")}
        {receipt.amountCents !== null ? ` — ${money(receipt.amountCents)}` : ""} ✅
      </h2>
      <p className="mt-1 text-sm text-muted">
        {depositWithBalance
          ? t("booking.paymentDepositBalance", { balance: money(receipt.balanceDueCents) })
          : t("booking.paymentSquare")}
      </p>
    </div>
  );
}

/**
 * A terminal outcome for this link — a dead token, or a booking that was
 * cancelled underneath the diver. `EntryDone` is the app's one warm terminal
 * pattern (docs/design/principles.md #4) and the same shape `claim/[token]`
 * already gives a dead bearer link; this page used to spell a `rounded-2xl`
 * card of its own instead, which is how three token pages ended up with three
 * different boxes saying the same kind of thing.
 *
 * The glyph is decorative. `⏳` is the app-wide "this link has run out" mark;
 * a cancelled booking gets `🗓️` instead, because the link is fine and telling
 * that diver to ask for a fresh one would send them the wrong way.
 */
function Notice({ title, text, glyph = "⏳" }: { title: string; text: string; glyph?: string }) {
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
  "certification_expired",
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
const SPECIALTY_ENTRY_CODES = new Set<ReadinessBlockerCode>([
  "specialty_missing",
  "specialty_expired",
]);

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
 * diver short three cards was being handed three stacked forms — twelve fields
 * of agency/level/number/expiry between them, all open at once, on a phone.
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
          <Field label={t("ready.certExpiry")} hint={t("ready.certExpiryHint")}>
            <input name="expiresAt" type="date" className={controlClass} />
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
          <Field label={t("ready.certExpiry")} hint={t("ready.certExpiryHint")}>
            <input name="expiresAt" type="date" className={controlClass} />
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
 * fills enriched air: the card is what unlocks the gear row's request box, so
 * the offer belongs here with the other cards — pilled, so it never reads as
 * one more thing standing between the diver and the boat.
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
 * Which single-button action a checklist item answers with, if any. The one
 * source of truth for `itemAction`'s button branches *and* for choosing the
 * page's primary — one function so the two can never drift apart. The
 * certification rows are deliberately not here: their action is the
 * multi-field `CertificationEntry` form, whose submit stays secondary by
 * design — a form's save is not the page's one obvious action.
 */
function actionButtonKind(item: DiverChecklistItem, canPay: boolean): "waiver" | "pay" | null {
  if (item.code === "waiver_pending" || item.code === "waiver_expired") return "waiver";
  if ((item.code === "payment_due" || item.code === "payment_refunded") && canPay) return "pay";
  return null;
}

/**
 * The action a checklist item enables on this page, if any.
 *
 * `isPrimary` marks the first row whose action is a button — and only that
 * button wears primary weight. Two actionable rows at once (a waiver and a
 * payment, most commonly) used to render two primaries, leaving the diver to
 * do the triage the page had already done in its own headline (design
 * principle 8: one obvious action). Chosen among the button-bearing rows
 * rather than blindly from `nextDiverStep`: when the next step is a
 * certification form, demoting the one payment button with nothing promoted
 * in its place would leave the page with no primary at all.
 */
function itemAction(
  item: DiverChecklistItem,
  token: string,
  canPay: boolean,
  isPrimary: boolean,
  /** Whether the certification row should also offer an un-demanded nitrox card. */
  offerNitrox: boolean,
  t: DiverTranslator,
): React.ReactNode {
  const actionButton = buttonClass(
    isPrimary ? { size: "sm" } : { variant: "secondary", size: "sm" },
  );
  const buttonKind = actionButtonKind(item, canPay);
  // An expired link needs the same action as a pending one — `signWaiverFromReady`
  // always issues a fresh link and opens it, superseding whatever came before,
  // so the only difference is what the button promises. Naming the difference
  // matters: "Sign your waiver" on a link the diver already knows is dead reads
  // as the page not having noticed.
  if (buttonKind === "waiver") {
    return (
      <form action={signWaiverFromReady.bind(null, token)}>
        <SubmitButton pendingLabel={t("ready.opening")} className={actionButton}>
          {t(item.code === "waiver_expired" ? "ready.freshWaiverLink" : "ready.signWaiver")}
        </SubmitButton>
      </form>
    );
  }
  if (buttonKind === "pay") {
    return (
      <form action={payFromReady.bind(null, token)}>
        <SubmitButton pendingLabel={t("ready.openingPayment")} className={actionButton}>
          {t("ready.payForTrip")}
        </SubmitButton>
      </form>
    );
  }
  // Explicitly the certification row's, rather than "whatever is left over".
  // Every category used to fall through to here and render nothing, because an
  // empty `actionable` produced no forms — but the optional nitrox offer does
  // not come from `actionable`, so a waiting waiver row would have grown an
  // "Add your nitrox card" disclosure underneath it.
  if (item.category !== "certification") return null;
  return <CertificationEntries token={token} item={item} offerNitrox={offerNitrox} t={t} />;
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
  "saved-contact": { tone: "success", key: "ready.contactSaved" },
  "saved-contact-empty": { tone: "neutral", key: "ready.contactIncomplete" },
  "pay-paid": { tone: "success", key: "ready.paymentReceived" },
  "error-waiver": { tone: "danger", key: "ready.waiverUnavailable" },
  "error-contact": { tone: "danger", key: "ready.contactTooLong" },
  "error-pay": { tone: "danger", key: "ready.paymentUnavailable" },
  "pay-cancelled": { tone: "neutral", key: "ready.paymentCancelled" },
  // Task 49: every throttled action used to redirect with no error param at
  // all, so a rate-limited tap just looked like the button did nothing.
  "error-rate": { tone: "danger", key: "ready.rateLimited" },
  // Task 49: a failed gear/setup save (`saveFitFromReady`'s `?error=fit`)
  // had no entry here either — the same silent-failure gap, one field over.
  "error-fit": { tone: "danger", key: "ready.fitUnavailable" },
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
      glyph="🗓️"
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
  }>;
}) {
  await connection();
  const { token } = await params;
  const { saved, error, pay, cancelled, booked } = await searchParams;
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
  // What this booking has been charged, and — only in the minutes after a
  // submit — whether both of its emails actually left the building. Both moved
  // here from the trip page's confirmation branch (ADR
  // 20260820-one-page-after-booking); the receipt is read on every visit,
  // because "what did I pay?" is a question the night before too, while the
  // emails line is only ever true right after booking.
  const [paymentReceipt, emailsOnTheWay] = await Promise.all([
    resolvePaymentReceipt(
      db,
      shop.id,
      bookingId,
      // The two ways a diver arrives here straight off Stripe's hosted page:
      // paying at booking (`bookSpot`'s success_url) and paying later
      // (`payFromReady`'s). Both are the moment the webhook may still be in
      // flight; every other arrival is not.
      justBooked || pay === "paid",
      fullTrip ? perDiverBookingPriceCents(fullTrip, fullTrip.course) : null,
      toShopCurrency(shop.currency),
    ),
    justBooked
      ? bookingConfirmationAndWaiverEmailsSent(db, shop.id, bookingId)
      : Promise.resolve(false),
  ]);
  // Absolute where a canonical origin is configured — this one exists to be
  // pasted into a group chat — with the relative fallback the claim links above
  // use, so a missing APP_HOST shares a working same-origin link rather than a
  // broken one. Never `window.location.href`: see `TripActions`' `shareUrl`.
  const shareOrigin = publicAppUrl();
  const tripPath = publicTripPath(shop.slug, data.trip.id);
  const shareTripUrl = shareOrigin ? new URL(tripPath, `${shareOrigin}/`).toString() : tripPath;

  const briefingExtras = await listDiveSiteBriefingExtras(
    db,
    shop.id,
    tripDives.map(({ diveSite }) => diveSite?.id).filter((id): id is string => Boolean(id)),
  );
  const diveBriefings = tripDives.map(({ dive, diveSite }) => ({
    dive,
    diveSite,
    creatures: fieldGuideCards(
      diveSite ? (briefingExtras.creatures.get(diveSite.id) ?? []) : [],
      t,
    ),
    moments: diveSite ? (briefingExtras.moments.get(diveSite.id) ?? []) : [],
  }));
  // Dive 1 first, in the dive plan's own order: where a site names its own
  // time in the water, that is what the day's rhythm counts rather than the
  // shop-wide default (src/lib/diver-planning.ts).
  const siteBottomTimes = tripDives.map(({ diveSite }) => diveSite?.expectedBottomTimeMinutes);
  // ...and each leg of the run between them, same order: dock to the first
  // site, then site to site (ADR 20260815-per-leg-travel-minutes). The morning
  // of a dive is when a long second leg matters most.
  const legTravelTimes = tripDives.map(({ dive }) => dive.travelMinutes);

  const items = buildDiverChecklist(detail.requirement, detail.readiness);
  const nextStep = nextDiverStep(items);
  // The page's one primary button, chosen among the rows that render one.
  const primaryActionItem =
    items.find((item) => actionButtonKind(item, data.canPay) !== null) ?? null;
  const ready = detail.readiness.status === "ready";
  const hasEmergencyContact = Boolean(person.emergencyContactName && person.emergencyContactPhone);
  // A rental fit is on file — the diver has answered the gear question at least
  // once, whatever they answered. "Bringing my own" is a complete answer, so
  // this asks whether the row was filled in, never whether anything was rented.
  const hasRentalFit = Boolean(data.rentalFit);
  // Whether to ask for a nitrox card nothing has asked for yet — the rule
  // itself lives in `src/lib/rentals.ts` beside `nitroxAvailableOn`, because
  // the card disclosure below and the rental form's request lock are two
  // surfaces that must answer it identically.
  const offerNitroxCard = nitroxCardWanted(shop.rentalItems, data.trip.course, {
    verified: data.nitroxCardVerified,
    onFile: data.nitroxCardOnFile,
  });
  /**
   * ...and whether this page can actually make that offer.
   *
   * The disclosure lives inside the certification row, so it can only be
   * rendered on a page that has one. A departure gating on nothing at all has
   * no such row — and rather than grow a second place for a card to go, the
   * request box stays unlocked there, exactly as it was before this rework.
   *
   * This single boolean is what `RentalFitForm` locks on. It holds no copy of
   * the rule above: the form is told whether the control it would point at
   * exists, so the lock and the offer cannot disagree.
   */
  const nitroxCardEntryOffered =
    offerNitroxCard && items.some((item) => item.category === "certification");
  // The emergency-contact and gear rows are rendered as their own
  // `ChecklistRow`s below, outside `items` — count them alongside the
  // requirement-derived items so the progress bar and its label match what the
  // diver actually sees in the list.
  const checklistTotal = items.length + 2;
  const checklistDone =
    items.filter((item) => item.state === "done").length +
    (hasEmergencyContact ? 1 : 0) +
    (hasRentalFit ? 1 : 0);
  const noticeKey = saved
    ? `saved-${saved}`
    : error
      ? `error-${error}`
      : pay
        ? `pay-${pay}`
        : undefined;
  // `Object.hasOwn`, not `READY_NOTICES[noticeKey]` — the param is
  // attacker-supplied and a bare lookup walks the prototype
  // (src/lib/staff-notices.ts).
  const notice = noticeFromParam(noticeKey, READY_NOTICES);

  return (
    // The whole page under the provider, not just the one Client Component that
    // needs it today: a `useTranslations` call in a client child without it
    // throws during the server render and takes the entire page down to a blank
    // 200 (which is exactly how RentalFitForm broke this surface once). Its
    // namespaces are "rental" (RentalFitForm's own copy), "common"
    // ("common.optional", shared with several field hints), and "trip"
    // (TripActions' add-to-calendar and share-with-a-buddy row).
    <DiverIntlProvider
      locale={locale}
      timeZone={detail.shop.timezone}
      namespaces={["rental", "common", "trip"]}
    >
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
        {/* `booked` among them: the celebration is the moment a seat was taken,
            not a property of the link. Leaving it in the URL would replay
            "You're on the boat" every time a diver reopened this page from
            their history three days later. */}
        <FlashParams params={["saved", "error", "pay", "booked"]} />
        {/* One eyebrow, not two: this header used to stack "Your trip
            readiness" and the shop's name as two identical uppercase lines — a
            visible bug-shaped redundancy. The shop's name is the context worth
            keeping (and it is said in full, with address and map, in the shop
            card at the foot of the page); the page's own identity is carried by
            the checklist heading below. So: the shop name alone, never the
            component's two-line array form. */}
        <TokenPageHeader eyebrow={detail.shop.name} title={detail.trip.title}>
          <p className="mt-1 text-base text-muted">
            {when} · {timeRange} · {relativeWhen}
          </p>
          {/* The one number that matters on the morning of the trip — a shade
              stronger than the meta line above it, never shouting. */}
          <p className="mt-1 text-base font-medium">{dockCallLine}</p>
          {/* Put the day in a calendar, and send the trip to whoever is coming
              — the same ghost-weight row, in the same place under the masthead,
              as the public trip page carries. Nothing here competes with the
              checklist below (design/principles.md #8).

              `shareUrl` is the **public trip page**, never this one: this URL
              *is* a bearer capability that can cancel the booking and move its
              refund, and "share with a buddy" must not hand that to a group
              chat (docs/engineering/capability-telemetry-runbook.md). */}
          {fullShop ? (
            <TripActions
              calendarUrl={publicTripCalendarPath(fullShop.slug, data.trip.id)}
              shareUrl={shareTripUrl}
            />
          ) : null}
          {/* What this page *is*, said once, at the top.
              Divers arrive here from a booking submit or an emailed link, and
              both of those read as a confirmation — a thing you look at once
              and close. This one is not: it is the same URL all week, it is
              where the cards and the gear answers go, and it restates itself
              every time the shop moves. Nothing else on the page can say that,
              because every other line is about the trip rather than about the
              page. Ghost weight, under the actions, so it informs the first
              visit and disappears into the furniture on the tenth. */}
          <p className="mt-3 text-sm text-muted">{t("ready.keepThisPage")}</p>
        </TokenPageHeader>

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

        {/* One earned moment, never two. A diver who just booked reads that
            they are on the boat; a diver arriving from an email reminder with
            nothing left to do reads that they are ready. Both at once would be
            two coral boxes celebrating two different things in one screenful,
            and the booking is the newer news (ADR
            20260820-one-page-after-booking). The not-ready, not-just-booked
            state answers inside the spine card below instead, so status is
            said once, not three times. */}
        {/* Title only, no body. The trip page's confirmation spelled the date,
            the time and the dock call underneath this heading because its own
            masthead said none of them. This page's header, four lines up, says
            all three — so the same sentence here would be the page repeating
            itself inside one screenful. */}
        {justBooked ? (
          <EarnedMoment
            className="mt-8"
            title={t("booking.confirmedHeading", { name: firstName })}
          />
        ) : ready ? (
          <EarnedMoment
            className="mt-8"
            eyebrow={t("ready.allSetHeading")}
            title={t("ready.seeYou", { when, name: firstName })}
          >
            <p>{t("ready.allSetBodyReady")}</p>
          </EarnedMoment>
        ) : null}

        {/* Two messages land within seconds of each other; saying so up front
            stops the second one reading as a duplicate or a mistake. Claimed
            only when both actually left the building — a walk-in party member
            with no address of their own gets neither. */}
        {emailsOnTheWay ? (
          <p className="mt-3 text-sm text-muted">{t("booking.emailsOnTheWay")}</p>
        ) : null}

        {/* What was actually charged. Above the checklist, because a diver who
            has just paid is looking for exactly this, and the checklist's own
            payment row says "done" without ever saying how much. */}
        {paymentReceipt ? (
          <PaymentReceiptPanel receipt={paymentReceipt} locale={locale} t={t} />
        ) : null}

        {/* The spine: one card that is the page's whole reason to exist —
            "am I ready, and what's left?" answered in the first screenful.
            The greeting, the next step, the progress bar, and the rows were
            four same-weight blocks before; they are one object now. */}
        {/* The card's chrome as a class string rather than `<SectionCard>`:
            this section keeps its own `aria-labelledby` region name, and its
            header carries a progress figure and a progress bar above a
            full-bleed row list — anatomy the shared card does not model. The
            shell still comes from one place, so it cannot drift again. */}
        <section
          className={sectionCardClass({ padding: "none", className: "mt-8 overflow-hidden" })}
          aria-labelledby="checklist-heading"
        >
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id="checklist-heading" className="text-lg font-semibold">
                {t("ready.checklistHeading")}
              </h2>
              {ready ? null : (
                <p className="text-sm font-medium text-muted tabular-nums">
                  {t("ready.checklistProgress", { done: checklistDone, total: checklistTotal })}
                </p>
              )}
            </div>
            {ready ? null : (
              <>
                <p className="mt-2 text-base text-muted">
                  {t("ready.almostThere", { name: firstName })}{" "}
                  {nextStep
                    ? t("ready.nextDetail", { detail: checklistDetailText(t, nextStep) })
                    : t("ready.allSetBody")}
                </p>
                <div
                  role="progressbar"
                  aria-valuenow={checklistDone}
                  aria-valuemin={0}
                  aria-valuemax={checklistTotal}
                  aria-label={t("ready.checklistProgressAriaLabel", {
                    done: checklistDone,
                    total: checklistTotal,
                  })}
                  className="mt-4 h-3 w-full overflow-hidden rounded-full bg-surface-sunken"
                >
                  <div
                    className="progress-wave-fill h-full rounded-full"
                    style={{ width: `${(checklistDone / checklistTotal) * 100}%` }}
                  />
                </div>
              </>
            )}
          </div>
          <ul className="divide-y divide-border border-t border-border">
            {items.map((item) => (
              <ChecklistRow
                key={item.category}
                label={checklistCategoryText(t, item.category)}
                state={item.state}
                detail={checklistDetailText(t, item)}
                action={itemAction(
                  item,
                  token,
                  data.canPay,
                  item === primaryActionItem,
                  nitroxCardEntryOffered,
                  t,
                )}
                t={t}
              />
            ))}
            <ChecklistRow
              label={t("ready.emergencyContact")}
              state={hasEmergencyContact ? "done" : "action"}
              detail={
                hasEmergencyContact
                  ? t("ready.emergencyOnFile", { name: person.emergencyContactName ?? "" })
                  : t("ready.emergencyContactBody")
              }
              // Already on file (most often captured on the waiver a moment
              // earlier — both write through the same `saveBookingEmergencyContact`)
              // reads as a plain "done" row, no form: two differently-labeled
              // capture forms for the same fact was the duplication this closes
              // (UX persona Lens 17, task 143). Correcting a wrong entry is staff
              // work from here on — the roster and diver-record edit form
              // (task 144) — not a second diver-facing input.
              action={
                hasEmergencyContact ? null : (
                  <form
                    action={saveEmergencyContactFromReady.bind(null, token)}
                    className="flex flex-col gap-3"
                  >
                    <FieldGrid columns={2}>
                      <Field label={t("ready.contactName")}>
                        <input
                          name="emergencyContactName"
                          autoComplete="name"
                          maxLength={120}
                          defaultValue={person.emergencyContactName ?? ""}
                          className={controlClass}
                        />
                      </Field>
                      <Field label={t("ready.contactPhone")}>
                        <input
                          name="emergencyContactPhone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          maxLength={40}
                          defaultValue={person.emergencyContactPhone ?? ""}
                          className={controlClass}
                        />
                      </Field>
                    </FieldGrid>
                    <div>
                      <SubmitButton
                        pendingLabel={t("common.saving")}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        {t("ready.saveContact")}
                      </SubmitButton>
                    </div>
                  </form>
                )
              }
              t={t}
            />
            {/* Gear is a pre-trip item like any other, so it is a row rather
                than a section of its own further down. It is the second row
                here that is not a readiness blocker — a rental fit reserves
                nothing and gates nobody (docs/product/glossary.md) — but "what
                the crew should have ready for me" is exactly what this list is
                for, and a heading below the checklist made it look like
                something else. `RentalFitForm` renders no card and no title of
                its own for that reason: this row is its heading. */}
            <ChecklistRow
              label={t("ready.gearAndSetup")}
              state={hasRentalFit ? "done" : "action"}
              detail={t(hasRentalFit ? "ready.gearOnFile" : "ready.gearBody")}
              action={
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
              }
              t={t}
            />
          </ul>
        </section>

        <PartyClaimPanel locale={locale} seats={partySeats} className="mt-8" />

        {/* What the day actually is: what to bring, and what each tank dives.
            Below the checklist — which now carries the gear form as its last
            row — because this page's job is still "what's left before you
            sail", and this is what a diver reads once that is settled. It is
            also what they used to have to leave the page to find. */}
        {fullShop && fullTrip ? (
          <>
            <PackingSection
              shop={fullShop}
              trip={fullTrip}
              rentalFit={data.rentalFit}
              // Never the "every day follows this shape" note here, even on a
              // course weekend: this page is what a diver reads the morning
              // they sail, about the day in front of them. The booking page is
              // where the whole itinerary is laid out.
              multiDay={false}
              siteBottomTimes={siteBottomTimes}
              legTravelTimes={legTravelTimes}
              // This page renders no conditions card at all, so the suit line
              // has nowhere else to land — and the morning of a dive is exactly
              // when a diver is deciding what to put in the car.
              temperatureStatedAbove={false}
              locale={locale}
            />
            <DiveBriefingsSection briefings={diveBriefings} trip={fullTrip} locale={locale} />
          </>
        ) : null}

        {/* The diver may release their own seat; moving it is the shop's
            (ADR 20260821-the-diver-may-release-their-own-seat). It sits last,
            under everything the page is actually for, and above the shop card
            whose phone number answers every plan change this button does not.
            Rendered only when `selfCancelBooking` would actually honour it, so
            there is no control here that could only come back refused. */}
        {data.canCancelBooking ? (
          <section className="border-t border-border pt-6">
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
      </main>
    </DiverIntlProvider>
  );
}
