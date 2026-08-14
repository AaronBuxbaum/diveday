import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { EarnedMoment } from "@/components/EarnedMoment";
import { ImageFileInput } from "@/components/ImageFileInput";
import { RecapMap } from "@/components/RecapMap";
import { StarRatingInput } from "@/components/StarRatingInput";
import { SubmitButton } from "@/components/SubmitButton";
import { TokenPageHeader } from "@/components/TokenPageHeader";
import { buttonClass } from "@/components/ui/button";
import { controlClass, FormStatus } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { getRecapPageData, MAX_RECAP_PHOTOS_PER_BOOKING, type RecapSite } from "@/db/recap";
import { getReviewForBooking } from "@/db/reviews";
import { tipPresetsMajor } from "@/db/tips";
import { type DiverMessageKey, diverTranslator } from "@/i18n/messages";
import { requestLocale, requestTranslator } from "@/i18n/request";
import { depthText, temperatureText } from "@/i18n/unit-labels";
import { formatShortDate } from "@/lib/format";
import { cachedFormatter, cachedListFormat } from "@/lib/intl-cache";
import { currencySymbol, minorToMajor } from "@/lib/money";
import { publicSchedulePath } from "@/lib/public-routes";
import { verifyRecapToken } from "@/lib/recap-links";
import { MAX_REVIEW_COMMENT_LENGTH, REVIEW_RATINGS } from "@/lib/reviews";
import { openGraphSite } from "@/lib/site-metadata";
import { noticeFromParam } from "@/lib/staff-notices";
import { MAX_IMAGE_MB } from "@/lib/storage/limits";
import { temperatureUnitFor } from "@/lib/temperature-units";
import { startTipAction, submitReviewAction, uploadRecapPhotoAction } from "./actions";
import { RecapShareButton } from "./RecapShareButton";
import { ShareReviewButton } from "./ShareReviewButton";
import { TipAmountPicker } from "./TipAmountPicker";

/**
 * Notice keys, not sentences — the query string names an outcome and the page
 * says it in the diver's own language (docs ADR 20260729-diver-copy-localization).
 */
const PHOTO_NOTICES: Record<string, { tone: "success" | "danger"; key: DiverMessageKey }> = {
  added: { tone: "success", key: "recap.photoAdded" },
  none: { tone: "danger", key: "recap.photoMissing" },
  limit: { tone: "danger", key: "recap.photoLimit" },
  unconfigured: { tone: "danger", key: "recap.photoUnsupported" },
  // A cancelled or no-show booking, not a bad file — "try a JPEG under 5 MB"
  // would be a lie about what actually went wrong (task 56).
  cancelled: { tone: "danger", key: "recap.photoCancelled" },
  error: { tone: "danger", key: "recap.photoFailed" },
};

const TIP_NOTICES: Record<string, { tone: "success" | "danger"; key: DiverMessageKey }> = {
  paid: { tone: "success", key: "recap.tipThanksNotice" },
  cancelled: { tone: "danger", key: "recap.tipCancelled" },
  invalid: { tone: "danger", key: "recap.tipRange" },
  error: { tone: "danger", key: "recap.tipFailed" },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const t = diverTranslator(await requestLocale());
  const bookingId = verifyRecapToken(token);
  const db = bookingId ? await getDb() : null;
  const data = db && bookingId ? await getRecapPageData(db, bookingId) : null;
  if (!data) {
    return { title: t("recap.metaTitle"), robots: { index: false, follow: false } };
  }
  // Bearer-token page: the URL itself is the credential, so whoever already
  // has the link can see the whole page — but a link-preview unfurl (Slack,
  // iMessage, ...) renders for bystanders who never clicked it. Keep the
  // unfurl to the same non-personal facts a signed-out visitor of the shop's
  // own public schedule page already sees — trip title, shop name, dive
  // site names — never the diver's name, contact info, photos, review
  // words, or tip amount (checked against
  // docs/engineering/capability-telemetry-runbook.md; task 59).
  const { shop, trip, sites } = data;
  const siteNames = sitesSentence(sites, shop.defaultLocale);
  const ogTitle = `${trip.title} · ${shop.name}`;
  const ogDescription = siteNames
    ? `A dive recap from ${shop.name} — ${siteNames}.`
    : `A dive recap from ${shop.name}.`;
  return {
    title: t("recap.metaTitle"),
    robots: { index: false, follow: false },
    // No `url`: this is a bearer-token page, and `og:url` would put the
    // capability itself in a meta tag that unfurls for bystanders who never
    // clicked the link (docs/engineering/capability-telemetry-runbook.md).
    openGraph: { ...openGraphSite, title: ogTitle, description: ogDescription },
  };
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <div className="rounded-xl border border-border bg-surface p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-muted">{text}</p>
      </div>
    </main>
  );
}

/**
 * The small-caps label the relive sections hang from — the same grammar as
 * `EarnedMoment`'s eyebrow, so the whole first act reads as one composition
 * carried by type and space rather than a stack of boxed cards
 * (docs/design/principles.md #10).
 */
function Kicker({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "primary";
}) {
  return (
    <h2
      className={`text-xs font-semibold tracking-[0.18em] uppercase ${
        tone === "primary" ? "text-primary" : "text-muted"
      }`}
    >
      {children}
    </h2>
  );
}

/**
 * One stop on the day's route — a dot on the vertical line that continues the
 * map's charter-path metaphor down into the site details. Unboxed: the line
 * carries the itinerary shape, so each stop needs no card of its own.
 */
function SiteStop({ site, lookForLabel }: { site: RecapSite; lookForLabel: string }) {
  return (
    <li className="relative">
      {/* 31px centers the 12px dot on the ol's 2px rail: the ol gives each li
          pl-6 (24px) from the border's inner edge, so the rail's center sits
          24 + 1 (half the border) = 25px left of the text, and half the dot
          (6px) more puts its left edge at 31px. Touch pl-6, border-l-2, or
          size-3 and this number moves with them. */}
      <span
        aria-hidden="true"
        className="absolute top-1.5 -left-[31px] size-3 rounded-full border-2 border-primary bg-surface"
      />
      <h3 className="text-lg font-semibold tracking-tight">{site.name}</h3>
      {site.locationName ? <p className="mt-0.5 text-sm text-muted">{site.locationName}</p> : null}
      {site.marineLife ? (
        <p className="mt-1.5 text-base text-muted">
          <span className="font-medium text-foreground">{lookForLabel}</span> {site.marineLife}
        </p>
      ) : null}
    </li>
  );
}

/** Name the sites in prose: "French Reef", "French Reef and Molasses", etc. */
function sitesSentence(sites: RecapSite[], locale: string): string | null {
  const names = sites.map((s) => s.name);
  if (names.length === 0) return null;
  return cachedListFormat(locale, { type: "conjunction" }).format(names);
}

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

/**
 * The page is an arc, not a stack (docs/design/principles.md #11):
 *
 *   Act I — relive. The coral moment, the crew's own words as a pull-quote,
 *   the day's route (map + a dotted itinerary line), and the conditions as a
 *   quiet stat row. All of it unboxed — hierarchy by type and space — so the
 *   one accent card (`EarnedMoment`) and the one ask card below keep their
 *   meaning.
 *
 *   Act II — one ask. The review is the page's single bordered card and its
 *   single primary action: it is the only review DiveDay can prove came from
 *   someone on the boat, and it feeds the shop's public schedule page. When a
 *   strong rating has just landed, the form's submit demotes and the
 *   carry-it-to-Google CTA takes the primary weight — one primary at a time,
 *   sequenced by state rather than stacked (principle #8).
 *
 *   Act III — quiet follows. Tip and photos are hairline-topped sections with
 *   secondary-weight controls: real affordances, never rivals to the ask.
 *
 *   Coda — bring a buddy, centered and muted, the page's soft landing.
 */
export default async function DiveRecapPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ photo?: string; tip?: string; review?: string }>;
}) {
  await connection();
  const { token } = await params;
  const { photo, tip: tipParam, review: reviewParam } = await searchParams;
  // A dead link resolves no shop, so there is no `shops.default_locale` to fall
  // back to — negotiate from the visitor's own device alone for those branches.
  const anonT = diverTranslator(await requestLocale());
  const bookingId = verifyRecapToken(token);
  if (!bookingId) {
    return (
      <Notice title={anonT("recap.unavailableHeading")} text={anonT("recap.unavailableBody")} />
    );
  }

  const db = await getDb();
  const data = await getRecapPageData(db, bookingId);
  if (!data) {
    // `getRecapPageData` nulls the whole page uniformly for a cancelled/
    // no-show booking, same as a bad or forged token — so a diver who was
    // rating or adding a photo when staff cancelled their booking underneath
    // them lands right back here on redirect, never seeing a
    // `reviews.savedDidNotDive`/`recap.photoCancelled` notice at all (those
    // dictionary entries stay for a future page shape that doesn't collapse
    // this state). This is the one honest thing this branch *can* say
    // without weakening the fail-closed uniformity a forged token still
    // gets: the token itself parsed (so this is a real diver on a real,
    // now-cancelled booking, not a guess), and "didn't sail" reveals
    // nothing more than the diver's own crew already told them (task 56).
    const didNotDive = reviewParam === "did_not_dive" || photo === "cancelled";
    return (
      <Notice
        title={anonT("recap.unavailableHeading")}
        text={anonT(didNotDive ? "recap.didNotDiveBody" : "waiver.unavailableBody")}
      />
    );
  }

  const { shop, trip, diverName, sites, shoutout, photos, canTip, tip, currency } = data;
  const { locale, t } = await requestTranslator(shop.defaultLocale);
  // A shop can disconnect Stripe (or lose chargesEnabled) after a tip was
  // already started or paid; canTip alone would then hide the diver's own
  // paid confirmation or an already-open checkout link along with the
  // "start a new tip" form. Show the section whenever there's a durable tip
  // to report, using canTip only to gate a *new* attempt (Codex finding).
  const hasReportableTip =
    tip?.status === "paid" || (tip?.status === "pending" && Boolean(tip.checkoutUrl));
  const showTipSection = canTip || hasReportableTip;
  const ownReview = await getReviewForBooking(db, bookingId);
  // Built here rather than as a module constant: the wording is the shop's
  // language, not the server's.
  const reviewNotices: Record<string, { tone: "success" | "danger"; text: string }> = {
    published: { tone: "success", text: t("reviews.savedPublished") },
    pending: { tone: "success", text: t("reviews.savedPending") },
    // A no-show/cancelled booking never dived — "pick a rating and try
    // again" would send them in a loop that can never succeed (task 56).
    did_not_dive: { tone: "danger", text: t("reviews.savedDidNotDive") },
    error: { tone: "danger", text: t("reviews.savedError") },
  };
  const reviewNotice = noticeFromParam(reviewParam, reviewNotices);
  // One review ask, not two: the "share it on Google too" CTA only appears
  // right after a strong (4-5★) on-page submission just went through, folded
  // into that success state instead of a second section that used to render
  // unconditionally underneath it (task 57). One spelling of that state — the
  // submit button's demotion and the CTA block below both read this, so they
  // can never disagree about whether the CTA is on screen.
  const justSubmittedStrongReview =
    (reviewParam === "published" || reviewParam === "pending") &&
    ownReview !== null &&
    ownReview.rating >= 4;
  const externalReviewUrl = justSubmittedStrongReview ? shop.reviewUrl : null;
  // `Object.hasOwn` via `noticeFromParam`, never a bare `PHOTO_NOTICES[photo]`
  // — all three params are attacker-supplied and a bare lookup walks the
  // prototype (src/lib/staff-notices.ts).
  const photoNotice = noticeFromParam(photo, PHOTO_NOTICES);
  const tipNotice = noticeFromParam(tipParam, TIP_NOTICES);
  const atPhotoLimit = photos.length >= MAX_RECAP_PHOTOS_PER_BOOKING;
  const remainingPhotoSlots = Math.max(0, MAX_RECAP_PHOTOS_PER_BOOKING - photos.length);
  const firstName = diverName.trim().split(/\s+/)[0] || t("recap.namelessFallback");
  const when = formatShortDate(trip.startsAt, locale, shop.timezone);
  const where = sitesSentence(sites, locale);
  // The shop's declared currency (ADR 20260731-shop-currency) — no longer the
  // connected account's settlement currency that task 60 read, so the tip a
  // diver leaves is denominated the same way the trip they paid for was.
  // Narrow symbol only ("$", "€"), not the full "US$"-style display Intl
  // otherwise defaults to; src/lib/money.ts is the one place that glyph is
  // derived.
  const symbol = currencySymbol(currency, locale);
  // Scaled by the same table as the tip bounds, so a preset can never sit
  // below the minimum the action enforces (src/db/tips.ts).
  const tipPresets = tipPresetsMajor(currency);
  // Stored metric, displayed in the shop's own units (src/lib/depth-units.ts,
  // src/lib/temperature-units.ts) — a shop working in feet was reading its own
  // divers' recaps in °C and metres.
  const temperatureUnit = temperatureUnitFor(shop);
  const conditions = [
    trip.waterTemperatureC !== null
      ? {
          label: t("recap.waterTemp"),
          value: temperatureText(t, trip.waterTemperatureC, temperatureUnit),
        }
      : null,
    trip.visibilityMeters !== null
      ? { label: t("trip.visibility"), value: depthText(t, trip.visibilityMeters, shop.depthUnit) }
      : null,
    trip.surfaceConditions ? { label: t("trip.surface"), value: trip.surfaceConditions } : null,
  ].filter((tile): tile is { label: string; value: string } => tile !== null);
  const diveCount = Math.max(trip.plannedDives, sites.length);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
      <TokenPageHeader eyebrow={shop.name} title={trip.title}>
        <p className="mt-1 text-base text-muted">{when}</p>
        {/* Same share-then-clipboard-fallback affordance TripActions gives a
            trip page — `recap-links.ts` already calls this link shareable,
            this is what makes it actually be that (task 59). */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <RecapShareButton
            shareTitle={trip.title}
            shareText={t("recap.shareRecapText", { shop: shop.name })}
            label={t("recap.shareRecap")}
            copiedLabel={t("recap.linkCopied")}
            copiedAnnouncement={t("recap.linkCopiedAnnouncement")}
            failedLabel={t("recap.linkCopyFailed")}
          />
        </div>
      </TokenPageHeader>

      {/* ——— Act I: relive. Memory before the ask — the coral moment, the
          crew's words, the route, the water. Everything here is unboxed:
          hierarchy comes from type and space, so the one accent card stays
          the page's only loud object and the day itself does the talking. */}

      <EarnedMoment
        className="mt-8"
        eyebrow={t("recap.eyebrow")}
        title={t("recap.greeting", { name: firstName })}
      >
        <p>
          {where
            ? t("recap.loggedAt", { count: diveCount, where })
            : t("recap.loggedToday", { count: diveCount })}{" "}
          {t("recap.hopeWaterTreatedYou")}
        </p>
      </EarnedMoment>

      {/* The crew's own words carry themselves — a pull-quote, not a boxed
          panel. The primary-tinted kicker is its only ornament. */}
      {shoutout ? (
        <section className="mt-10">
          <Kicker tone="primary">{t("recap.fromYourCrew")}</Kicker>
          {/* The quote glyphs come from the bundle, not this component — each
              locale sets its own convention (es-ES/README.md keeps “ ”). */}
          <blockquote className="mt-3 text-xl leading-relaxed font-medium text-pretty">
            {t("recap.crewQuote", { words: shoutout })}
          </blockquote>
        </section>
      ) : null}

      {/* The day's route: the map draws the charter path, and the itinerary
          line beneath continues it — one dot per stop, no card per site. */}
      {sites.length ? (
        <section className="mt-10">
          <Kicker>{t("recap.whereYouDived")}</Kicker>
          <RecapMap
            sites={sites}
            copy={{
              mapAriaLabel: t("recap.mapAriaLabel"),
              charterPath: t("recap.charterPath"),
              boatTrack: t("recap.boatTrack"),
              theDock: t("recap.theDock"),
              reconstructedPath: t("recap.reconstructedPath", { count: sites.length }),
            }}
          />
          <ol className="mt-6 ml-1.5 space-y-6 border-l-2 border-border pl-6">
            {sites.map((site) => (
              <SiteStop key={site.name} site={site} lookForLabel={t("recap.lookFor")} />
            ))}
          </ol>
        </section>
      ) : null}

      {/* Conditions as a quiet stat row — facts, not tiles. */}
      {conditions.length ? (
        <section className="mt-10">
          <Kicker>{t("recap.conditionsOnTheDay")}</Kicker>
          <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
            {conditions.map((fact) => (
              <div key={fact.label}>
                <dt className="text-sm text-muted">{fact.label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tracking-tight">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {/* ——— Act II: the one ask. The review is the page's single bordered
          card and its single primary action — it's one tap, it stays on this
          page, and it's the only review a diver can leave that DiveDay can
          prove came from someone who was actually on the boat. Its geometry
          (rounded-2xl, p-6/7) deliberately echoes the EarnedMoment above:
          two cards on the page, the joy and the ask. */}
      <section className="mt-12 rounded-2xl border border-border bg-surface p-6 sm:mt-14 sm:p-7">
        <h2 className="text-xl font-semibold tracking-tight">{t("reviews.askHeading")}</h2>
        <p className="mt-1 text-base text-muted">{t("reviews.askBody")}</p>
        {reviewNotice ? (
          <FormStatus tone={reviewNotice.tone} className="mt-3">
            {reviewNotice.text}
          </FormStatus>
        ) : null}
        {ownReview ? (
          <p className="mt-3 text-sm text-muted">
            {t("reviews.yourRating", { rating: ownReview.rating })}
          </p>
        ) : null}
        <form action={submitReviewAction.bind(null, token)} className="mt-4 flex flex-col gap-3">
          <StarRatingInput
            legend={t("reviews.ratingLegend")}
            optionLabels={Object.fromEntries(
              REVIEW_RATINGS.map((rating) => [rating, t("reviews.ratingOption", { rating })]),
            )}
            defaultValue={ownReview?.rating}
          />
          <label htmlFor="review-comment" className="text-sm font-medium">
            {t("reviews.commentLabel")}
          </label>
          <p id="review-comment-hint" className="text-xs text-muted">
            {t("reviews.commentModerationHint")}
          </p>
          <textarea
            id="review-comment"
            name="comment"
            rows={3}
            maxLength={MAX_REVIEW_COMMENT_LENGTH}
            defaultValue={ownReview?.comment ?? ""}
            placeholder={t("reviews.commentPlaceholder")}
            aria-describedby="review-comment-hint"
            className={controlClass}
          />
          <div>
            {/* One primary at a time: the moment a strong rating lands and
                the carry-it-to-Google CTA appears below, this submit steps
                back to secondary so the page still points at exactly one
                next action (principle #8). */}
            <SubmitButton
              pendingLabel={t("reviews.submitting")}
              className={buttonClass({
                variant: externalReviewUrl ? "secondary" : "primary",
                size: "cta",
              })}
            >
              {t("reviews.submit")}
            </SubmitButton>
          </div>
        </form>

        {/* The one review ask left: a strong rating just landed, so offer to
            carry it further instead of stacking a second, separately-worded
            ask underneath (task 57). */}
        {externalReviewUrl ? (
          <div className="mt-4 border-t border-border pt-4">
            <h3 className="text-base font-semibold">{t("recap.externalReviewHeading")}</h3>
            <p className="mt-1 text-sm text-muted">
              {ownReview?.comment
                ? t("recap.externalReviewBody", { shop: shop.name })
                : t("recap.externalReviewBodyNoComment", { shop: shop.name })}
            </p>
            <ShareReviewButton
              reviewUrl={externalReviewUrl}
              comment={ownReview?.comment ?? null}
              cta={t("recap.externalReviewCta")}
              copiedLabel={t("recap.commentCopied")}
            />
          </div>
        ) : null}
      </section>

      {/* ——— Act III: quiet follows. Real affordances at secondary weight —
          hairline-topped sections, never rival cards to the one ask above. */}

      {showTipSection ? (
        <section className="mt-10 border-t border-border pt-8">
          <h2 className="text-base font-semibold">{t("recap.tipCrew")}</h2>
          {tipNotice ? (
            <FormStatus tone={tipNotice.tone} className="mt-3">
              {t(tipNotice.key)}
            </FormStatus>
          ) : null}
          {tip?.status === "paid" ? (
            <p className="mt-1 text-base text-muted">{t("recap.tipPaid", { shop: shop.name })}</p>
          ) : tipParam === "paid" ? (
            // Stripe already redirected the diver back with `?tip=paid`, but the
            // webhook that flips `tip.status` to "paid" can lag a few seconds —
            // never re-show the payment form or a stale checkout link in that
            // window, which would read as "you still need to pay."
            <p className="mt-1 text-base text-muted">{t("recap.tipConfirming")}</p>
          ) : tip?.status === "pending" && tip.checkoutUrl ? (
            <>
              <p className="mt-1 text-base text-muted">
                {t("recap.tipAllGoes", { shop: shop.name })}
              </p>
              <a
                href={tip.checkoutUrl}
                className={buttonClass({ variant: "secondary", size: "cta", className: "mt-4" })}
              >
                {t("recap.tipFinish", {
                  // `minorToMajor`, never a literal 100 — a ¥3,000 tip is
                  // whole yen and dividing it would offer to pay ¥30.
                  amount: cachedFormatter("num", Intl.NumberFormat, locale, {
                    style: "currency",
                    currency: currency.toUpperCase(),
                    maximumFractionDigits: 0,
                  }).format(minorToMajor(tip.amountCents, currency)),
                })}
              </a>
            </>
          ) : canTip ? (
            <>
              <p className="mt-1 text-base text-muted">
                {t("recap.tipAllGoes", { shop: shop.name })}
              </p>
              <form action={startTipAction.bind(null, token)} className="mt-4 flex flex-col gap-3">
                <TipAmountPicker
                  presets={tipPresets}
                  defaultPreset={tipPresets[1]}
                  currencySymbol={symbol}
                  legend={t("recap.tipAmountLegend")}
                  otherPlaceholder={t("recap.otherTipPlaceholder")}
                  otherAriaLabel={t("recap.otherTipAriaLabel")}
                />
                <div>
                  <SubmitButton
                    pendingLabel={t("booking.headingToPayment")}
                    className={buttonClass({ variant: "secondary", size: "cta" })}
                  >
                    {t("recap.tipLeave")}
                  </SubmitButton>
                </div>
              </form>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="mt-10 border-t border-border pt-8">
        <h2 className="text-base font-semibold">{t("recap.yourPhotos")}</h2>
        <p className="mt-1 text-base text-muted">{t("recap.photosBody", { shop: shop.name })}</p>

        {photoNotice ? (
          <FormStatus tone={photoNotice.tone} className="mt-3">
            {photoNotice.key === "recap.photoLimit"
              ? t(photoNotice.key, { max: MAX_RECAP_PHOTOS_PER_BOOKING })
              : t(photoNotice.key)}
          </FormStatus>
        ) : null}

        {photos.length ? (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((image) => (
              <li key={image.id} className="overflow-hidden rounded-xl border border-border">
                <div className="relative aspect-square w-full">
                  {/* Diver photos always come from the blob store (storeRecapImage), so the
                      remotePatterns entry in next.config.ts covers every url here. */}
                  <Image
                    src={image.imageUrl}
                    alt={image.caption ?? t("recap.photoAlt", { trip: trip.title })}
                    fill
                    sizes="(min-width: 640px) 33vw, 50vw"
                    className="object-cover"
                  />
                </div>
                {image.caption ? (
                  <p className="px-2 py-1.5 text-xs text-muted">{image.caption}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {atPhotoLimit ? (
          <p className="mt-4 text-sm text-muted">{t("recap.photoLimitReached")}</p>
        ) : (
          <form
            action={uploadRecapPhotoAction.bind(null, token)}
            className="mt-4 flex flex-col gap-3"
          >
            <label htmlFor="recap-photo" className="flex flex-col gap-1 text-sm font-medium">
              {t("recap.addAPhoto")}
            </label>
            <ImageFileInput
              id="recap-photo"
              name="photo"
              required
              multiple
              maxFiles={remainingPhotoSlots}
              // file:py-3 (not py-2) so the "Choose file" pseudo-button clears the
              // 44px dock-test floor — this is a mobile, post-dive, add-your-shots
              // flow where the tap target matters (design/principles.md #2).
              // Sunken-surface fill, not primary: the review above is the page's
              // one primary ask, and a teal "Choose file" chip was competing
              // with it from two sections away.
              className="text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-surface-sunken file:px-3 file:py-3 file:text-sm file:font-medium file:text-foreground"
              copy={{
                wrongTypeSuffix: t("recap.photoWrongTypeSuffix"),
                tooBigSuffix: t("recap.photoTooBigSuffix", { maxMb: MAX_IMAGE_MB }),
                tooMany: t("recap.photoTooMany", { max: remainingPhotoSlots }),
              }}
            />
            <input
              type="text"
              name="caption"
              maxLength={140}
              placeholder={t("recap.captionLabel")}
              className={controlClass}
            />
            <div>
              <SubmitButton
                pendingLabel={t("recap.addingPhoto")}
                className={buttonClass({ variant: "secondary", className: "self-start" })}
              >
                {t("recap.addToMyRecap")}
              </SubmitButton>
            </div>
          </form>
        )}
      </section>

      {/* ——— Coda: the soft landing. Centered and muted — an invitation on
          the way out, not another ask. */}
      <footer className="mt-14 border-t border-border pt-10 text-center">
        <h2 className="text-base font-semibold">{t("recap.bringABuddy")}</h2>
        <p className="mx-auto mt-1 max-w-md text-base text-muted">{t("recap.buddyBody")}</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={publicSchedulePath(shop.slug)}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("recap.seeWhatsNext")}
          </Link>
          {shop.contactEmail ? (
            <a href={`mailto:${shop.contactEmail}`} className={buttonClass({ variant: "ghost" })}>
              {t("recap.messageTheShop")}
            </a>
          ) : null}
        </div>
      </footer>
    </main>
  );
}
