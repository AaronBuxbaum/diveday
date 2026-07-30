import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { EarnedMoment } from "@/components/EarnedMoment";
import { ImageFileInput } from "@/components/ImageFileInput";
import { RecapMap } from "@/components/RecapMap";
import { StarRatingInput } from "@/components/StarRatingInput";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { getRecapPageData, MAX_RECAP_PHOTOS_PER_BOOKING, type RecapSite } from "@/db/recap";
import { getReviewForBooking } from "@/db/reviews";
import { type DiverMessageKey, diverTranslator } from "@/i18n/messages";
import { requestLocale, requestTranslator } from "@/i18n/request";
import { formatShortDate } from "@/lib/format";
import { verifyRecapToken } from "@/lib/recap-links";
import { MAX_REVIEW_COMMENT_LENGTH, REVIEW_RATINGS } from "@/lib/reviews";
import { startTipAction, submitReviewAction, uploadRecapPhotoAction } from "./actions";
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
  error: { tone: "danger", key: "recap.photoFailed" },
};

const TIP_NOTICES: Record<string, { tone: "success" | "danger"; key: DiverMessageKey }> = {
  cancelled: { tone: "danger", key: "recap.tipCancelled" },
  invalid: { tone: "danger", key: "recap.tipRange" },
  error: { tone: "danger", key: "recap.tipFailed" },
};

const TIP_PRESETS_USD = [5, 10, 20];

export const metadata: Metadata = {
  title: "Your dive recap — DiveDay",
  robots: { index: false, follow: false },
};

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

/** A conditions stat tile, shown only when the crew logged that reading. */
function ConditionTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-sunken p-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold">{value}</dd>
    </div>
  );
}

function SiteCard({ site, lookForLabel }: { site: RecapSite; lookForLabel: string }) {
  return (
    <li className="rounded-xl border border-border bg-surface p-5">
      <h3 className="font-semibold">{site.name}</h3>
      {site.locationName ? <p className="mt-0.5 text-sm text-muted">{site.locationName}</p> : null}
      {site.marineLife ? (
        <p className="mt-2 text-base text-muted">
          <span className="font-medium text-foreground">{lookForLabel}</span> {site.marineLife}
        </p>
      ) : null}
    </li>
  );
}

/** Name the sites in prose: "French Reef", "French Reef and Molasses", etc. */
function sitesSentence(sites: RecapSite[]): string | null {
  const names = sites.map((s) => s.name);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

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
    return (
      <Notice title={anonT("recap.unavailableHeading")} text={anonT("waiver.unavailableBody")} />
    );
  }

  const { shop, trip, diverName, sites, shoutout, photos, canTip, tip } = data;
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
    error: { tone: "danger", text: t("reviews.savedError") },
  };
  const reviewNotice = reviewParam ? reviewNotices[reviewParam] : undefined;
  const photoNotice = photo ? PHOTO_NOTICES[photo] : undefined;
  const tipNotice = tipParam ? TIP_NOTICES[tipParam] : undefined;
  const atPhotoLimit = photos.length >= MAX_RECAP_PHOTOS_PER_BOOKING;
  const firstName = diverName.trim().split(/\s+/)[0] || "diver";
  const when = formatShortDate(trip.startsAt, locale, shop.timezone);
  const where = sitesSentence(sites);
  const conditions = [
    trip.waterTemperatureC !== null
      ? { label: t("recap.waterTemp"), value: `${trip.waterTemperatureC}°C` }
      : null,
    trip.visibilityMeters !== null
      ? { label: t("trip.visibility"), value: `${trip.visibilityMeters} m` }
      : null,
    trip.surfaceConditions ? { label: t("trip.surface"), value: trip.surfaceConditions } : null,
  ].filter((tile): tile is { label: string; value: string } => tile !== null);
  const diveCount = Math.max(trip.plannedDives, sites.length);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16">
      <header>
        <p className="text-sm font-medium tracking-widest text-primary uppercase">{shop.name}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">{trip.title}</h1>
        <p className="mt-1 text-base text-muted">{when}</p>
      </header>

      <EarnedMoment
        className="mt-8"
        eyebrow={t("recap.eyebrow")}
        title={`${t("recap.heading")}, ${firstName}.`}
      >
        <p>
          {where
            ? t("recap.loggedAt", { count: diveCount, where })
            : t("recap.loggedToday", { count: diveCount })}{" "}
          {t("recap.hopeWaterTreatedYou")}
        </p>
      </EarnedMoment>

      {/* The shop's own rating comes first: it's one tap, it stays on this
          page, and it's the only review a diver can leave that DiveDay can
          prove came from someone who was actually on the boat. The off-site
          ask below it is a second, optional step, not the primary one. */}
      <section className="mt-8 rounded-xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">{t("reviews.askHeading")}</h2>
        <p className="mt-1 text-base text-muted">{t("reviews.askBody")}</p>
        {reviewNotice ? (
          <p
            role={reviewNotice.tone === "danger" ? "alert" : "status"}
            className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
              reviewNotice.tone === "danger"
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-primary/30 bg-primary/10 text-primary"
            }`}
          >
            {reviewNotice.text}
          </p>
        ) : null}
        {ownReview ? (
          <p className="mt-3 text-sm text-muted">
            {t("reviews.yourRating", { rating: ownReview.rating })}
          </p>
        ) : null}
        <form action={submitReviewAction.bind(null, token)} className="mt-3 flex flex-col gap-3">
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
          <textarea
            id="review-comment"
            name="comment"
            rows={3}
            maxLength={MAX_REVIEW_COMMENT_LENGTH}
            defaultValue={ownReview?.comment ?? ""}
            placeholder={t("reviews.commentPlaceholder")}
            className={controlClass}
          />
          <div>
            <SubmitButton pendingLabel={t("reviews.submitting")} className={buttonClass()}>
              {t("reviews.submit")}
            </SubmitButton>
          </div>
        </form>
      </section>

      {shop.reviewUrl ? (
        <section className="mt-8 rounded-xl bg-surface-sunken p-5">
          <h2 className="text-lg font-semibold">{t("recap.externalReviewHeading")}</h2>
          <p className="mt-1 text-base text-muted">
            {t("recap.externalReviewBody", { shop: shop.name })}
          </p>
          <a
            href={shop.reviewUrl}
            target="_blank"
            rel="noopener"
            className={buttonClass({ size: "cta", className: "mt-4" })}
          >
            {t("recap.externalReviewCta")}
          </a>
        </section>
      ) : null}

      {showTipSection ? (
        <section className="mt-8 rounded-xl border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold">{t("recap.tipCrew")}</h2>
          {tipNotice ? (
            <p
              role={tipNotice.tone === "danger" ? "alert" : "status"}
              className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                tipNotice.tone === "danger"
                  ? "border-danger/30 bg-danger/10 text-danger"
                  : "border-primary/30 bg-primary/10 text-primary"
              }`}
            >
              {t(tipNotice.key)}
            </p>
          ) : null}
          {tip?.status === "paid" ? (
            <p className="mt-1 text-base text-muted">{t("recap.tipPaid", { shop: shop.name })}</p>
          ) : tip?.status === "pending" && tip.checkoutUrl ? (
            <>
              <p className="mt-1 text-base text-muted">
                {t("recap.tipAllGoes", { shop: shop.name })}
              </p>
              <a href={tip.checkoutUrl} className={buttonClass({ size: "cta", className: "mt-4" })}>
                {t("recap.tipFinish", {
                  amount: new Intl.NumberFormat(locale, {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                  }).format(tip.amountCents / 100),
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
                  presets={TIP_PRESETS_USD}
                  defaultPreset={TIP_PRESETS_USD[1]}
                  legend={t("recap.tipAmountLegend")}
                  otherPlaceholder={t("recap.otherTipPlaceholder")}
                  otherAriaLabel={t("recap.otherTipAriaLabel")}
                />
                <div>
                  <SubmitButton
                    pendingLabel={t("booking.headingToPayment")}
                    className={buttonClass({ size: "cta" })}
                  >
                    {t("recap.tipLeave")}
                  </SubmitButton>
                </div>
              </form>
            </>
          ) : null}
        </section>
      ) : null}

      {shoutout ? (
        <section className="mt-8 rounded-xl border border-primary/25 bg-primary/5 p-5">
          <h2 className="text-sm font-medium tracking-widest text-primary uppercase">
            {t("recap.fromYourCrew")}
          </h2>
          <p className="mt-2 text-base text-pretty">{shoutout}</p>
        </section>
      ) : null}

      {sites.length ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t("recap.whereYouDived")}</h2>
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
          <ul className="mt-4 space-y-3">
            {sites.map((site) => (
              <SiteCard key={site.name} site={site} lookForLabel={t("recap.lookFor")} />
            ))}
          </ul>
        </section>
      ) : null}

      {conditions.length ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t("recap.conditionsOnTheDay")}</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            {conditions.map((tile) => (
              <ConditionTile key={tile.label} label={tile.label} value={tile.value} />
            ))}
          </dl>
        </section>
      ) : null}

      <section className="mt-8 rounded-xl bg-surface-sunken p-5">
        <h2 className="text-lg font-semibold">{t("recap.yourPhotos")}</h2>
        <p className="mt-1 text-base text-muted">{t("recap.photosBody", { shop: shop.name })}</p>

        {photoNotice ? (
          <p
            role={photoNotice.tone === "danger" ? "alert" : "status"}
            className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
              photoNotice.tone === "danger"
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-primary/30 bg-primary/10 text-primary"
            }`}
          >
            {photoNotice.key === "recap.photoLimit"
              ? t(photoNotice.key, { max: MAX_RECAP_PHOTOS_PER_BOOKING })
              : t(photoNotice.key)}
          </p>
        ) : null}

        {photos.length ? (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((image) => (
              <li key={image.id} className="overflow-hidden rounded-lg border border-border">
                {/* biome-ignore lint/performance/noImgElement: diver photos come from the blob store, which no build-time image allowlist can enumerate. */}
                <img
                  src={image.imageUrl}
                  alt={image.caption ?? t("recap.photoAlt", { trip: trip.title })}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
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
              // file:py-3 (not py-2) so the "Choose file" pseudo-button clears the
              // 44px dock-test floor — this is a mobile, post-dive, add-your-shots
              // flow where the tap target matters (design/principles.md #2).
              className="text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-3 file:text-sm file:font-medium file:text-primary-foreground"
            />
            <input
              type="text"
              name="caption"
              maxLength={140}
              placeholder={t("recap.captionLabel")}
              className={controlClass}
            />
            <button type="submit" className={buttonClass({ className: "self-start" })}>
              {t("recap.addToMyRecap")}
            </button>
          </form>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{t("recap.bringABuddy")}</h2>
        <p className="mt-1 text-base text-muted">{t("recap.buddyBody")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`/shop/${shop.slug}/schedule`} className={buttonClass({ size: "cta" })}>
            {t("recap.seeWhatsNext")}
          </Link>
          {shop.contactEmail ? (
            <a
              href={`mailto:${shop.contactEmail}`}
              className={buttonClass({
                variant: "secondary",
                size: "cta",
                className: "text-foreground",
              })}
            >
              {t("recap.messageTheShop")}
            </a>
          ) : null}
        </div>
      </section>
    </main>
  );
}
