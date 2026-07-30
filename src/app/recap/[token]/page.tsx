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
import { diverTranslator } from "@/i18n/messages";
import { formatShortDate } from "@/lib/format";
import { verifyRecapToken } from "@/lib/recap-links";
import { MAX_REVIEW_COMMENT_LENGTH } from "@/lib/reviews";
import { startTipAction, submitReviewAction, uploadRecapPhotoAction } from "./actions";
import { TipAmountPicker } from "./TipAmountPicker";

const PHOTO_NOTICES: Record<string, { tone: "success" | "danger"; text: string }> = {
  added: { tone: "success", text: "Added to your recap — thanks for sharing!" },
  none: { tone: "danger", text: "Pick a photo first, then add it." },
  limit: {
    tone: "danger",
    text: `That’s the most photos one recap holds (${MAX_RECAP_PHOTOS_PER_BOOKING}).`,
  },
  unconfigured: {
    tone: "danger",
    text: "Photo uploads aren’t set up for this shop yet — no worries, tag them when you post.",
  },
  error: { tone: "danger", text: "That photo didn’t upload — try a JPEG or PNG under 5 MB." },
};

const TIP_NOTICES: Record<string, { tone: "success" | "danger"; text: string }> = {
  cancelled: { tone: "danger", text: "No worries — the tip wasn’t charged." },
  invalid: { tone: "danger", text: "Enter a tip amount between $1 and $500." },
  error: { tone: "danger", text: "That didn’t go through — try again in a moment." },
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

function SiteCard({ site }: { site: RecapSite }) {
  return (
    <li className="rounded-xl border border-border bg-surface p-5">
      <h3 className="font-semibold">{site.name}</h3>
      {site.locationName ? <p className="mt-0.5 text-sm text-muted">{site.locationName}</p> : null}
      {site.marineLife ? (
        <p className="mt-2 text-base text-muted">
          <span className="font-medium text-foreground">Look for:</span> {site.marineLife}
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
  const bookingId = verifyRecapToken(token);
  if (!bookingId) {
    return (
      <Notice
        title="This recap link isn’t available"
        text="Ask your dive shop for a fresh link — nothing here is private to anyone but you."
      />
    );
  }

  const db = await getDb();
  const data = await getRecapPageData(db, bookingId);
  if (!data) {
    return (
      <Notice title="This recap link isn’t available" text="Ask your dive shop for a fresh link." />
    );
  }

  const { shop, trip, diverName, sites, shoutout, photos, canTip, tip } = data;
  const t = diverTranslator(shop.defaultLocale);
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
  const when = formatShortDate(trip.startsAt, shop.defaultLocale, shop.timezone);
  const where = sitesSentence(sites);
  const conditions = [
    trip.waterTemperatureC !== null
      ? { label: "Water temp", value: `${trip.waterTemperatureC}°C` }
      : null,
    trip.visibilityMeters !== null
      ? { label: "Visibility", value: `${trip.visibilityMeters} m` }
      : null,
    trip.surfaceConditions ? { label: "Surface", value: trip.surfaceConditions } : null,
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
            ? `You logged ${diveCount === 1 ? "a dive" : `${diveCount} dives`} at ${where}.`
            : `You logged ${diveCount === 1 ? "a dive" : `${diveCount} dives`} today.`}{" "}
          We hope the water treated you well.
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
            optionLabel={(rating) => t("reviews.ratingOption", { rating })}
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
          <h2 className="text-lg font-semibold">Tip your crew</h2>
          {tipNotice ? (
            <p
              role={tipNotice.tone === "danger" ? "alert" : "status"}
              className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                tipNotice.tone === "danger"
                  ? "border-danger/30 bg-danger/10 text-danger"
                  : "border-primary/30 bg-primary/10 text-primary"
              }`}
            >
              {tipNotice.text}
            </p>
          ) : null}
          {tip?.status === "paid" ? (
            <p className="mt-1 text-base text-muted">
              Thanks — your tip goes straight to {shop.name}. They&apos;ll make sure the crew hears
              about it.
            </p>
          ) : tip?.status === "pending" && tip.checkoutUrl ? (
            <>
              <p className="mt-1 text-base text-muted">
                100% goes to {shop.name} — nothing held back, no account needed.
              </p>
              <a href={tip.checkoutUrl} className={buttonClass({ size: "cta", className: "mt-4" })}>
                Finish your ${(tip.amountCents / 100).toFixed(0)} tip
              </a>
            </>
          ) : canTip ? (
            <>
              <p className="mt-1 text-base text-muted">
                100% goes to {shop.name} — nothing held back, no account needed.
              </p>
              <form action={startTipAction.bind(null, token)} className="mt-4 flex flex-col gap-3">
                <TipAmountPicker presets={TIP_PRESETS_USD} defaultPreset={TIP_PRESETS_USD[1]} />
                <div>
                  <SubmitButton
                    pendingLabel="Heading to payment…"
                    className={buttonClass({ size: "cta" })}
                  >
                    Leave a tip
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
            From your crew
          </h2>
          <p className="mt-2 text-base text-pretty">{shoutout}</p>
        </section>
      ) : null}

      {sites.length ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Where you dived</h2>
          <RecapMap sites={sites} />
          <ul className="mt-4 space-y-3">
            {sites.map((site) => (
              <SiteCard key={site.name} site={site} />
            ))}
          </ul>
        </section>
      ) : null}

      {conditions.length ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Conditions on the day</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            {conditions.map((tile) => (
              <ConditionTile key={tile.label} label={tile.label} value={tile.value} />
            ))}
          </dl>
        </section>
      ) : null}

      <section className="mt-8 rounded-xl bg-surface-sunken p-5">
        <h2 className="text-lg font-semibold">Your photos</h2>
        <p className="mt-1 text-base text-muted">
          Add the shots from today — they stay on your recap, and {shop.name} may love to see them.
        </p>

        {photoNotice ? (
          <p
            role={photoNotice.tone === "danger" ? "alert" : "status"}
            className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
              photoNotice.tone === "danger"
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-primary/30 bg-primary/10 text-primary"
            }`}
          >
            {photoNotice.text}
          </p>
        ) : null}

        {photos.length ? (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((image) => (
              <li key={image.id} className="overflow-hidden rounded-lg border border-border">
                {/* biome-ignore lint/performance/noImgElement: diver photos come from the blob store, which no build-time image allowlist can enumerate. */}
                <img
                  src={image.imageUrl}
                  alt={image.caption ?? `A photo from ${trip.title}`}
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
          <p className="mt-4 text-sm text-muted">
            You’ve added the most photos one recap holds. Nice haul!
          </p>
        ) : (
          <form
            action={uploadRecapPhotoAction.bind(null, token)}
            className="mt-4 flex flex-col gap-3"
          >
            <label htmlFor="recap-photo" className="flex flex-col gap-1 text-sm font-medium">
              Add a photo
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
              placeholder="Add a caption (optional)"
              className={controlClass}
            />
            <button type="submit" className={buttonClass({ className: "self-start" })}>
              Add to my recap
            </button>
          </form>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Bring a buddy next time</h2>
        <p className="mt-1 text-base text-muted">
          Diving’s better with someone you know. Grab a spot on the next departure and bring them
          along.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`/shop/${shop.slug}/schedule`} className={buttonClass({ size: "cta" })}>
            See what’s next
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
              Message the shop
            </a>
          ) : null}
        </div>
      </section>
    </main>
  );
}
