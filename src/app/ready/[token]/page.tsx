import type { Metadata } from "next";
import { connection } from "next/server";
import { DiveBriefingsSection } from "@/app/s/[shopSlug]/trips/[id]/_components/DiveBriefingsSection";
import { PackingSection } from "@/app/s/[shopSlug]/trips/[id]/_components/PackingSection";
import { RentalFitForm } from "@/app/s/[shopSlug]/trips/[id]/_components/RentalFitForm";
import { EntryDone } from "@/components/account/EntryShell";
import { EarnedMoment } from "@/components/EarnedMoment";
import { FlashParams } from "@/components/FlashParams";
import { PartyClaimPanel } from "@/components/PartyClaimPanel";
import { ShopContactLinks } from "@/components/ShopContactLinks";
import { ShopNotice } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { TokenPageHeader } from "@/components/TokenPageHeader";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import {
  resolveRevokedBookingCapability,
  verifyBookingCapability,
} from "@/db/booking-capabilities";
import { getDb } from "@/db/client";
import { listDiveSiteBriefingExtras } from "@/db/dive-sites";
import { getBookingPayment } from "@/db/payments";
import { getReadyPageData, type ReadyPageData } from "@/db/ready";
import { certificationAgency, certificationLevel } from "@/db/schema";
import { issuePartySeatClaims } from "@/db/seat-claims";
import { getShopBySlug } from "@/db/shops";
import { getTripWithBooked, listTripDives } from "@/db/trips";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { fieldGuideCards } from "@/i18n/marine-life-labels";
import { type DiverMessageKey, type DiverTranslator, diverTranslator } from "@/i18n/messages";
import {
  DIVER_CERTIFICATION_AGENCY_KEYS,
  DIVER_CERTIFICATION_LEVEL_KEYS,
} from "@/i18n/readiness-labels";
import { checklistCategoryText, checklistDetailText } from "@/i18n/readiness-summary-labels";
import { requestLocale } from "@/i18n/request";
import { claimLinkPath } from "@/lib/booking-capabilities";
import { nowDate } from "@/lib/clock";
import { formatRelativeDay, formatShortDate, formatTime, formatTimeRangeTz } from "@/lib/format";
import { googleMapEmbedUrl, googleMapsUrl } from "@/lib/maps";
import { toShopCurrency } from "@/lib/money";
import { publicAppUrl } from "@/lib/notifications";
import type { ReadinessBlockerCode } from "@/lib/readiness";
import {
  buildDiverChecklist,
  type ChecklistState,
  type DiverChecklistItem,
  nextDiverStep,
} from "@/lib/readiness-summary";
import { shopAddressLines, shopMapQuery } from "@/lib/shop-address";
import { noticeFromParam, noticeRole } from "@/lib/staff-notices";
import {
  cancelMyBookingAction,
  payFromReady,
  rescheduleMyBookingAction,
  saveCertificationFromReady,
  saveEmergencyContactFromReady,
  saveFitFromReady,
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
  done: {
    glyph: "✓",
    word: "ready.stateDone",
    box: "bg-success/10 text-success",
    text: "text-success",
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
    <form
      action={saveCertificationFromReady.bind(null, token)}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface-sunken/50 p-4"
    >
      <div>
        <h4 className="text-base font-semibold">{t("ready.certHeading")}</h4>
        <p className="mt-1 text-sm text-muted">{t("ready.certBody")}</p>
      </div>
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
  if (item.code && CERT_ENTRY_CODES.has(item.code)) {
    return <CertificationEntry token={token} t={t} />;
  }
  return null;
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
  "error-cancel": { tone: "danger", key: "ready.cancelUnavailable" },
  "saved-rescheduled": { tone: "success", key: "ready.movedHeading" },
  "error-reschedule": { tone: "danger", key: "ready.moveFailed" },
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
};

/**
 * What to tell the diver about their own refund, right after they cancel —
 * derived from the booking's own current payment status, not from anything
 * the client sent back. `?cancelled=1` on the URL is only a trigger to look;
 * it carries no claim of its own, so an edited or replayed query string
 * can't be used to assert a refund that didn't happen, or hide one that did
 * (Codex finding). This collapses several distinct non-refund outcomes
 * (past the free-cancellation window, no stated window, a failed/manual
 * Stripe reversal) into one honest "still paid, shop handles it" message,
 * since none of those specific reasons survive as durable state to verify
 * against — only whether the payment row currently reads `refunded` or
 * still `paid`/`deposit_paid` does.
 */
function verifiedCancelNotice(paymentStatus: string | null | undefined): DiverMessageKey | null {
  if (paymentStatus === "refunded") return "ready.refundIssued";
  if (paymentStatus === "paid" || paymentStatus === "deposit_paid") return "ready.refundManual";
  return null;
}

/**
 * Why the reschedule picker isn't there, in the diver's own words. `src/db/
 * ready.ts` states which rule is in force; this is the one place each becomes
 * a sentence. `booking_closed` has no entry: that case takes the whole
 * section down to the "call the shop" line below, which says it better than a
 * paragraph next to a picker that isn't rendered.
 */
const RESCHEDULE_BLOCKED_KEYS: Record<
  Exclude<NonNullable<ReadyPageData["rescheduleBlocked"]>, "booking_closed">,
  DiverMessageKey
> = {
  payment_settled: "ready.moveNeedsShop",
  no_open_trips: "ready.noOtherTrips",
};

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
    <section className="mt-10 overflow-hidden rounded-2xl border border-border bg-surface">
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
    </section>
  );
}

/** What cancelling right now would mean for money already paid — shown before the diver commits. */
const CANCEL_PREVIEW_KEY: Record<ReadyPageData["cancelPreview"], DiverMessageKey | null> = {
  refund: "ready.cancelPreviewRefund",
  forfeit: "ready.cancelPreviewForfeit",
  // Genuinely paid — this trip just has no stated cancellation window, so
  // nothing is refunded automatically. Disclosing this only after the
  // irreversible cancel action (Codex finding) would leave a paid diver
  // finding out too late that the shop, not an automatic reversal, decides
  // their refund.
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
  searchParams: Promise<{ saved?: string; error?: string; pay?: string; cancelled?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { saved, error, pay, cancelled } = await searchParams;
  const db = await getDb();
  // A dead link resolves no shop, so there is no `shops.default_locale` to fall
  // back to — negotiate from the visitor's own device alone for those branches,
  // then re-negotiate below once the shop is known.
  const anonT = diverTranslator(await requestLocale());
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) {
    // A diver's own cancel action revokes this exact token as part of
    // cancelling, then redirects back to it with `?cancelled=1` — so the
    // normal verified-capability path above can never show the refund
    // notice for a self-cancel. Resolve the token with the revocation check
    // relaxed (never the cancelled-booking or shop-scoping checks) so that
    // one redirect still lands on an honest confirmation instead of the
    // generic "isn't available" notice. `cancelled` is only the trigger to
    // look — the refund copy itself comes from the booking's own current
    // payment row, fetched fresh here, never from the query string.
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
  const relativeWhen = formatRelativeDay(
    detail.trip.startsAt,
    nowDate(),
    locale,
    detail.shop.timezone,
  );

  if (detail.cancelled) {
    // Reached when the capability check above succeeded but the booking was
    // cancelled in the gap before this fresh read (a tight race, not the
    // normal self-cancel redirect — that one is revoked and handled by the
    // branch above). `cancelled` here is still just the raw, untrusted query
    // string; deriving the notice from it directly would reopen exactly the
    // spoofable-notice gap already closed above (Codex finding) — a crafted
    // `?cancelled=refunded` could claim a refund that hasn't happened. Same
    // fix: read the booking's own current payment status fresh.
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

  const cancelPreviewKey = CANCEL_PREVIEW_KEY[data.cancelPreview];
  const rescheduleBlockedKey =
    data.rescheduleBlocked && data.rescheduleBlocked !== "booking_closed"
      ? RESCHEDULE_BLOCKED_KEYS[data.rescheduleBlocked]
      : null;
  const items = buildDiverChecklist(detail.requirement, detail.readiness);
  const nextStep = nextDiverStep(items);
  // The page's one primary button, chosen among the rows that render one.
  const primaryActionItem =
    items.find((item) => actionButtonKind(item, data.canPay) !== null) ?? null;
  const ready = detail.readiness.status === "ready";
  const hasEmergencyContact = Boolean(person.emergencyContactName && person.emergencyContactPhone);
  // The emergency-contact row is rendered as its own `ChecklistRow` below,
  // outside `items` — count it alongside the requirement-derived items so the
  // progress bar and its label match what the diver actually sees in the list.
  const checklistTotal = items.length + 1;
  const checklistDone =
    items.filter((item) => item.state === "done").length + (hasEmergencyContact ? 1 : 0);
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
    // namespaces are "rental" (RentalFitForm's own copy) and "common"
    // ("common.optional", shared with several field hints).
    <DiverIntlProvider
      locale={locale}
      timeZone={detail.shop.timezone}
      namespaces={["rental", "common"]}
    >
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
        <FlashParams params={["saved", "error", "pay"]} />
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
        </TokenPageHeader>

        {notice ? (
          <div className="mt-6">
            <ShopNotice tone={notice.tone} role={noticeRole(notice.tone)}>
              {t(notice.key)}
            </ShopNotice>
          </div>
        ) : null}

        {/* The ready state leads with the earned moment — the page's answer,
            before any list. The not-ready state answers inside the spine card
            below instead, so status is said once, not three times. */}
        {ready ? (
          <EarnedMoment
            className="mt-8"
            eyebrow={t("ready.allSetHeading")}
            title={t("ready.seeYou", { when, name: firstName })}
          >
            <p>{t("ready.allSetBodyReady")}</p>
          </EarnedMoment>
        ) : null}

        {/* The spine: one card that is the page's whole reason to exist —
            "am I ready, and what's left?" answered in the first screenful.
            The greeting, the next step, the progress bar, and the rows were
            four same-weight blocks before; they are one object now. */}
        <section
          className="mt-8 rounded-2xl border border-border bg-surface"
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
                action={itemAction(item, token, data.canPay, item === primaryActionItem, t)}
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
          </ul>
        </section>

        <PartyClaimPanel locale={locale} seats={partySeats} className="mt-8" />

        {/* Supporting, at visibly quieter weight than the spine: one heading
            grammar for every page-level section from here down (text-lg
            semibold), never a second card competing with the checklist. */}
        <section className="mt-10" aria-labelledby="setup-heading">
          <h2 id="setup-heading" className="text-lg font-semibold">
            {t("ready.gearAndSetup")}
          </h2>
          <RentalFitForm
            action={saveFitFromReady.bind(null, token)}
            rentalFit={data.rentalFit}
            rentalItems={data.shop.rentalItems}
            course={data.trip.course}
            pricing={data.shop.rentalPricing}
            currency={toShopCurrency(data.shop.currency)}
            wantsNitrox={data.wantsNitrox}
            nitroxCardVerified={data.nitroxCardVerified}
            plannedDives={data.trip.plannedDives}
            saved={saved === "fit"}
          />
        </section>

        {/* What the day actually is: what to bring, and what each tank dives.
            Below the checklist and the gear form, because this page's job is
            still "what's left before you sail" — this is what a diver reads
            once that is settled, and it is what they used to have to leave the
            page to find. */}
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
              // This page renders no conditions card at all, so the suit line
              // has nowhere else to land — and the morning of a dive is exactly
              // when a diver is deciding what to put in the car.
              temperatureStatedAbove={false}
              locale={locale}
            />
            <DiveBriefingsSection briefings={diveBriefings} trip={fullTrip} locale={locale} />
          </>
        ) : null}

        {/* The rare path, dressed as one: moving or cancelling a booking is a
            minority act on a page most divers open to check what's left — so
            it sits last among the actions, borderless under a rule instead of
            wearing the same card the checklist earns (principle 8's collapse-
            the-rare-path, held to what must stay visible). */}
        {data.manageState === "closed" ? null : (
          <section
            className="mt-10 border-t border-border pt-6"
            aria-labelledby="change-plans-heading"
          >
            <h2 id="change-plans-heading" className="text-lg font-semibold">
              {t("ready.changePlans")}
            </h2>

            {/* Trip morning: the seat is past self-service, but this is the
                moment a diver most needs the shop's number — and the whole
                section used to render as nothing at all here. The policy is
                unchanged; the silence isn't. */}
            {data.manageState === "shop_only" ? (
              <div className="mt-3">
                <p className="text-base text-muted">{t("ready.manageShopOnly")}</p>
                {/* The component's own null-render carries the no-contacts
                    case — a wrapper element here would leave a stray empty
                    paragraph exactly when the shop published nothing. */}
                <ShopContactLinks
                  phone={shop.contactPhone}
                  email={shop.contactEmail}
                  className="mt-2 gap-y-1 text-base"
                />
              </div>
            ) : null}

            {data.manageState === "self_serve" &&
            data.rescheduleCandidates &&
            data.rescheduleCandidates.length > 0 ? (
              <div className="mt-3">
                <p className="text-base text-muted">{t("ready.reschedulePitch")}</p>
                <form
                  action={rescheduleMyBookingAction.bind(null, token)}
                  className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center"
                >
                  <label htmlFor="newTripId" className="sr-only">
                    {t("ready.pickATrip")}
                  </label>
                  <select id="newTripId" name="newTripId" required className={controlClass}>
                    <option value="">{t("ready.chooseTrip")}</option>
                    {data.rescheduleCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.title} —{" "}
                        {formatShortDate(candidate.startsAt, locale, detail.shop.timezone)} ·{" "}
                        {formatTimeRangeTz(
                          candidate.startsAt,
                          candidate.endsAt,
                          locale,
                          detail.shop.timezone,
                        )}{" "}
                        · {t("ready.spotsLeft", { count: candidate.spotsLeft })}
                      </option>
                    ))}
                  </select>
                  <InlineConfirm
                    triggerLabel={t("ready.moveBooking")}
                    triggerClassName={buttonClass({ variant: "secondary", size: "sm" })}
                    message={t("ready.moveConfirm")}
                    confirmLabel={t("ready.moveConfirmButton")}
                    cancelLabel={t("ready.neverMind")}
                    pendingLabel={t("ready.moving")}
                  />
                </form>
              </div>
            ) : rescheduleBlockedKey ? (
              // Cancel survives, moving doesn't — say which rule is in force
              // and hand over the shop's number, rather than letting the
              // picker quietly disappear the moment a payment settles.
              <div className="mt-3">
                <p className="text-base text-muted">{t(rescheduleBlockedKey)}</p>
                <ShopContactLinks
                  phone={shop.contactPhone}
                  email={shop.contactEmail}
                  className="mt-2 gap-y-1 text-base"
                />
              </div>
            ) : null}

            {data.manageState === "self_serve" ? (
              <div className="mt-6 border-t border-border pt-5">
                <p className="text-base text-muted">
                  {t("ready.cancelLead")} {cancelPreviewKey ? t(cancelPreviewKey) : null}
                </p>
                <form action={cancelMyBookingAction.bind(null, token)} className="mt-3">
                  {/* Task 50: replaces window.confirm, which could only show a
                      fixed string — never the refund preview this page already
                      computed above. Repeating it right at the point of
                      commitment (task 41's "reassurance at the point of
                      anxiety" pattern, applied to a warning instead) means the
                      diver reads it once more, right before the irreversible
                      submit, not just once further up the page. */}
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
              </div>
            ) : null}
          </section>
        )}

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
