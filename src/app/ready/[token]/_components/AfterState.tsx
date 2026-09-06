import Image from "next/image";
import Link from "next/link";
import { BrandStyle } from "@/components/BrandStyle";
import { EarnedMoment } from "@/components/EarnedMoment";
import { ImageFileInput } from "@/components/ImageFileInput";
import { SiteMark } from "@/components/illustration/SiteMark";
import { EYEBROW_CLASS } from "@/components/ShopPageHeader";
import { StarRatingInput } from "@/components/StarRatingInput";
import { StoredPhoto } from "@/components/StoredPhoto";
import { SubmitButton } from "@/components/SubmitButton";
import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, FormStatus } from "@/components/ui/form";
import { SHELL_TITLE_CLASS, SUB_TITLE_CLASS } from "@/components/ui/typography";
import type { RecapPageData, RecapPhotoView, RecapSite } from "@/db/recap";
import type { RecapPulseCategory } from "@/db/recap-pulses";
import { fieldGuideCards } from "@/i18n/marine-life-labels";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import { depthText, temperatureText } from "@/i18n/unit-labels";
import type { BrandDisplayFontCode } from "@/lib/brand";
import type { DepthUnit } from "@/lib/depth-units";
import type { DiveRecordComparison } from "@/lib/dive-record";
import { formatOrdinal } from "@/lib/format";
import { cachedFormatter } from "@/lib/intl-cache";
import { currencySymbol, minorToMajor, type ShopCurrency } from "@/lib/money";
import type { NextDivePick } from "@/lib/next-dive";
import type { PostcardImage } from "@/lib/postcard-image";
import { publicSchedulePath } from "@/lib/public-routes";
import { MAX_REVIEW_COMMENT_LENGTH, REVIEW_RATINGS } from "@/lib/reviews";
import type { SiteMarkCode } from "@/lib/site-mark";
import { noticeFromParam } from "@/lib/staff-notices";
import { MAX_IMAGE_MB } from "@/lib/storage/limits";
import type { TemperatureUnit } from "@/lib/temperature-units";
import { visitMilestone } from "@/lib/visit-milestones";
import { CourseAfterState } from "./CourseAfterState";
import { NextDiveCard } from "./NextDiveCard";
import { PrintRecordButton } from "./PrintRecordButton";
import { RecapPulse } from "./RecapPulse";
import { SavePostcard } from "./SavePostcard";
import { ShareReviewButton } from "./ShareReviewButton";
import { TipAmountPicker } from "./TipAmountPicker";

/**
 * **The thread's third state: after the dive** — ADR
 * 20260827-the-divers-thread, decision 4 (slice 7d).
 *
 * Once the departure has ended and the standing one-hour buffer has run out
 * (`isAfterTheDive`, src/lib/thread-steps.ts), the diver's own link stops
 * being a checklist and becomes the afterglow. `/recap/[token]` renders this
 * same component from its own signed token, which is what closes the
 * concept-model row's "folding recap into the same link" half: existing recap
 * emails keep their URLs and land on one surface rather than a second page
 * with a second style of the same card.
 *
 * The composition is the decision, in order:
 *
 * 1. **The greeting**, which is the thread's third and last coral moment —
 *    and only until the diver's review is in, after which it renders quiet.
 *    Its register is welcome-home: a sentence that is still true after a hard
 *    day (`thread.afterGreeting`).
 * 2. **The dive record**, the *only* place the day's facts render. The page
 *    this replaced said conditions and sites twice — a stat row up top and a
 *    keepsake card below — so a diver read the same two numbers in two
 *    typefaces. Every line here renders only when it was recorded.
 * 3. **The crew's word**, when the crew wrote one.
 * 4. **The one ask.** The review is the page's single primary, and the
 *    carry-it-to-Google door is the one thing that may take that weight off
 *    it — after a strong rating has just landed, never beside it.
 * 5. **The other thing worth saying, privately** — the pulse (D40, issue
 *    #1200). Beside the review and outside its `<form>`, because a private
 *    field inside a public one is a trap and a diver who has already left a
 *    review must still be able to reach it. Not a door: the doors are places
 *    to go, and this is a second thing to say.
 * 6. **Quiet doors** — photos and the tip, each a hairline row that opens its
 *    existing form in place, in the same grammar the prep state's spine uses
 *    one screen earlier.
 * 7. **One next dive, and one reason it is that one** (D35, issue #1195) —
 *    over candidates `decideTripAdmission` has already cleared, so the card
 *    never points at a boat this diver could not board.
 * 8. **One link** at the foot, and the shop's next public departure beside it
 *    *only when the card above did not render*: two "here is what is next"
 *    claims naming two different departures is the page arguing with itself.
 *
 * Presentational and synchronous, like `ThreadSpine`: the two pages resolve
 * the data and bind the four token-scoped server actions, and hand them over.
 * That split is what lets `AfterState.test.tsx` pin the rules — the day's
 * facts once, one primary at rest, the stamp's set — with no database.
 *
 * **There is no share-this-page control.** `/recap`'s used to offer one, and
 * this surface now also answers on `/ready`, whose URL is a bearer capability
 * that can cancel the booking and move its refund
 * (docs/engineering/capability-telemetry-runbook.md). A button that hands that
 * to a group chat cannot exist on one of two URLs rendering one surface. The
 * keepsake's own shareable artifact — an image with no bearer URL in it — is
 * `SavePostcard`, which draws the record into a canvas in the browser from a
 * value object that has no URL field at all (issue #1081).
 *
 * **Slice 16i of ADR 20260904-reef-all-the-way-down** is what added items 5, 7
 * and 8 above, replaced the face's sentence with its number (H-67 c), and put
 * the private line and the export in the record's own footer. This component is
 * where that decision lives and the one that must not drift from it.
 */
export type AfterStateProps = {
  t: DiverTranslator;
  /** The negotiated request locale, for every figure and date on the page. */
  locale: string;
  shop: {
    name: string;
    slug: string;
    depthUnit: DepthUnit;
    temperatureUnit: TemperatureUnit;
    /** Where "take it to Google" goes, or null when the shop has set none. */
    reviewUrl: string | null;
    /**
     * The shop's brand, worn by this surface the way the storefront wears it
     * (ADR 20260901-diveday-reimagined, slice 13i). Null renders DiveDay's own.
     */
    brandColor: string | null;
    brandDisplayFont: BrandDisplayFontCode | null;
    /**
     * How this shop signs off a finished day (issue #1212). Read only where
     * the crew wrote nothing of their own: a standing sentence never talks
     * over one somebody wrote today.
     */
    signOffNote: string | null;
  };
  /** The day's site, drawn in the illustration hand on the record's face. */
  siteMark: SiteMarkCode;
  /**
   * `plannedDives` is deliberately not here. It is what a shop typed on the
   * trip row, not a count of dives this diver made, and the one place it was
   * read printed it as "{n} dives logged" on a page built to be signed
   * (see `DiveRecord`).
   */
  trip: Pick<
    RecapPageData["trip"],
    "title" | "waterTemperatureC" | "visibilityMeters" | "surfaceConditions" | "boatName" | "crew"
  >;
  /** The trip's date, already formatted in the shop's zone. */
  when: string;
  diverName: string;
  sites: RecapSite[];
  /**
   * Where the day went against where it meant to go, or null when it went to
   * plan — which is the ordinary answer and renders nothing extra at all
   * (issue #1191).
   */
  diveRecord: DiveRecordComparison | null;
  /**
   * Per site the day dived, the species that site's field guide names.
   *
   * **What the place may hold, never what this dive did.** The drawer this
   * feeds is future-tense and scoped to the site by construction (issue #1192),
   * and it stays that way now that a sighting can be recorded: `observedSpecies`
   * below is the other field, deliberately, because merging them would let the
   * shop's standing claim about a reef render as somebody's report of a day.
   */
  fieldGuide: { siteName: string; rows: { id: string; catalogSlug: string | null }[] }[];
  /**
   * **What the crew wrote down that they saw** — catalog slugs, in dive order,
   * deduped (issue #1190, delight report D30).
   *
   * Present only when somebody recorded it. Empty is the ordinary state and
   * renders nothing, which is the boundary: a species is never inferred from
   * the guide above, and a day where nothing stood out is just a day. The words
   * come from the same `marineLife.*` copy the guide uses, so this arrives in
   * the diver's own language whatever the crew was reading when they picked it.
   */
  observedSpecies: string[];
  /**
   * The course this departure taught, with what the shop recorded for it
   * (issues #1196, #1205). Null on an ordinary charter and then nothing about
   * courses renders — see `CourseAfterState` for the overclaim rule.
   */
  course: RecapPageData["course"];
  shoutout: string | null;
  photos: RecapPhotoView[];
  /** How many photos one booking may hold — `MAX_RECAP_PHOTOS_PER_BOOKING`. */
  maxPhotos: number;
  /** Dive days with this shop, native bookings and imported visits merged. */
  visitCount: number;
  currency: ShopCurrency;
  /** A *new* tip may be started right now (the shop's Stripe account can take one). */
  canTip: boolean;
  tip: RecapPageData["tip"];
  /** Tip presets in major units, scaled by the same table as the tip bounds. */
  tipPresets: number[];
  /** The diver's own review, when they have left one. */
  ownReview: { rating: number; comment: string | null } | null;
  /**
   * The diver's own private pulse, when they have left one — never a review and
   * never public (D40, issue #1200). Its presence is also what puts the way back
   * on screen.
   */
  ownPulse: { categories: RecapPulseCategory[]; note: string | null } | null;
  /**
   * `?review=`, `?photo=`, `?tip=` and `?pulse=`, straight off the URL. All four
   * are attacker-supplied and every read below goes through `noticeFromParam`,
   * never a bare lookup that walks the prototype.
   */
  params: { review?: string; photo?: string; tip?: string; pulse?: string };
  /**
   * The shop's next public departure, already worded ("Two-Tank Reef" ·
   * "tomorrow"). Null when the board is empty, which renders the bare link.
   */
  nextDeparture: { title: string; when: string } | null;
  /**
   * **The day's record as a picture** (issue #1081): the same worded facts the
   * card below renders, assembled in `buildAfterStateProps` so the export and
   * the screen cannot disagree. It carries **no URL, token or slug** — that
   * absence is the whole reason this surface exports an image rather than
   * offering a share link (see this component's own note, and
   * `src/lib/postcard-image.ts`).
   */
  postcard: PostcardImage;
  /**
   * The one departure this diver is pointed at, or null when the board has
   * nothing for them (D35, issue #1195). Every candidate has already been
   * through `decideTripAdmission`, so the card can never suggest a boat they
   * could not board.
   */
  nextDive: NextDivePick | null;
  /** That pick's sentences, worded where every other fact on this page is worded. */
  nextDiveWorded: { when: string; reason: string; levelCovers: string | null } | null;
  /** The four recap actions, already bound to a signed recap token. */
  actions: {
    submitReview: (formData: FormData) => void | Promise<void>;
    uploadPhoto: (formData: FormData) => void | Promise<void>;
    startTip: (formData: FormData) => void | Promise<void>;
    submitPulse: (formData: FormData) => void | Promise<void>;
  };
};

/**
 * Notice keys, not sentences — the query string names an outcome and the page
 * says it in the diver's own language (ADR 20260729-diver-copy-localization).
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

const REVIEW_NOTICES: Record<string, { tone: "success" | "danger"; key: DiverMessageKey }> = {
  published: { tone: "success", key: "reviews.savedPublished" },
  pending: { tone: "success", key: "reviews.savedPending" },
  // A no-show/cancelled booking never dived — "pick a rating and try again"
  // would send them in a loop that can never succeed (task 56).
  did_not_dive: { tone: "danger", key: "reviews.savedDidNotDive" },
  error: { tone: "danger", key: "reviews.savedError" },
};

const TIP_NOTICES: Record<string, { tone: "success" | "danger"; key: DiverMessageKey }> = {
  paid: { tone: "success", key: "recap.tipThanksNotice" },
  cancelled: { tone: "danger", key: "recap.tipCancelled" },
  invalid: { tone: "danger", key: "recap.tipRange" },
  error: { tone: "danger", key: "recap.tipFailed" },
};

/** Hooks the rule tests scope to, named here so they cannot drift from the surface. */
export const AFTER_STATE_TEST_IDS = {
  record: "dive-record",
  sites: "dive-record-sites",
  plannedSites: "dive-record-planned-sites",
  conditions: "dive-record-conditions",
  stamp: "dive-record-stamp",
  visitLine: "dive-record-visit-line",
  printNotes: "dive-record-print-notes",
  printSignature: "dive-record-print-signature",
  face: "dive-record-face",
  seen: "dive-record-seen",
} as const;

export function AfterState({
  t,
  locale,
  shop,
  trip,
  when,
  diverName,
  sites,
  diveRecord,
  fieldGuide,
  observedSpecies,
  course,
  shoutout,
  photos,
  maxPhotos,
  visitCount,
  currency,
  canTip,
  tip,
  tipPresets,
  ownReview,
  ownPulse,
  params,
  nextDeparture,
  postcard,
  nextDive,
  nextDiveWorded,
  actions,
  siteMark,
}: AfterStateProps) {
  // Resolved before anything decides what to render, because
  // `fieldGuideCards` drops a slug the catalog no longer carries: a site whose
  // whole guide has aged out arrives with rows and resolves to no cards, and
  // counting rows instead of cards would open a drawer onto a site heading with
  // nothing under it — the empty drawer this feature exists not to render.
  const fieldGuideGroups = fieldGuide
    .map((site) => ({ siteName: site.siteName, cards: fieldGuideCards(site.rows, t) }))
    .filter((group) => group.cards.length > 0);
  const firstName = diverName.trim().split(/\s+/)[0] || t("recap.namelessFallback");
  const greeting = t("thread.afterGreeting", { name: firstName });
  // `noticeFromParam`, never a bare `REVIEW_NOTICES[params.review]` — all
  // three params are attacker-supplied and a bare lookup walks the prototype
  // (src/lib/staff-notices.ts).
  const reviewNotice = noticeFromParam(params.review, REVIEW_NOTICES);
  const photoNotice = noticeFromParam(params.photo, PHOTO_NOTICES);
  const tipNotice = noticeFromParam(params.tip, TIP_NOTICES);

  /**
   * One review ask, not two: the "share it on Google too" door only lights up
   * right after a strong (4–5★) on-page submission went through, and while it
   * is lit the form's own submit steps back to secondary. One spelling of that
   * state, so the two can never disagree about which is the page's primary.
   */
  const justSubmittedStrongReview =
    (params.review === "published" || params.review === "pending") &&
    ownReview !== null &&
    ownReview.rating >= 4;
  const externalReviewUrl = justSubmittedStrongReview ? shop.reviewUrl : null;

  /**
   * **The last coral this thread spends** (decision 6). The moment is "you're
   * home", and it stops the moment the diver has answered the one thing the
   * page asks — after which the same words render as an ordinary page title.
   */
  const celebrate = ownReview === null;

  return (
    // Its own `<main>` rather than `ThreadShell`, for the same reason the
    // waiver's completed state has one (see `ThreadShell`'s doc comment): this
    // state's header *is* its moment, and the header itself is `print:hidden`
    // so the keepsake prints alone. The measure is the shell's own exported
    // constant, so the thread's one column still cannot drift.
    <main className={THREAD_MEASURE_CLASS}>
      {/* The shop's brand, as tokens — the same `BrandStyle` the storefront
          mounts, so the day a diver keeps is in the colour and face of the
          shop that gave it to them (slice 13i). Ink, ground and every signal
          colour stay DiveDay's; only the action tokens and the display face
          move, which is what keeps the review's primary and the tip's form on
          brand while a refusal never is. */}
      <BrandStyle brandColor={shop.brandColor} brandDisplayFont={shop.brandDisplayFont} />
      {celebrate ? (
        <EarnedMoment
          as="h1"
          eyebrow={shop.name}
          title={greeting}
          titleClassName="font-brand-display"
          className="print:hidden"
        >
          <p className="text-base">
            {trip.title} · {when}
          </p>
        </EarnedMoment>
      ) : (
        <header className="print:hidden">
          <p className={EYEBROW_CLASS}>{shop.name}</p>
          <h1 className={`font-brand-display mt-2 ${SHELL_TITLE_CLASS} text-balance`}>
            {greeting}
          </h1>
          <p className="mt-1 text-base text-muted">
            {trip.title} · {when}
          </p>
        </header>
      )}

      <DiveRecord
        t={t}
        locale={locale}
        shop={shop}
        trip={trip}
        when={when}
        diverName={diverName}
        sites={sites}
        diveRecord={diveRecord}
        observedSpecies={observedSpecies}
        visitCount={visitCount}
        siteMark={siteMark}
        postcard={postcard}
      />

      {/* The crew's own words carry themselves — a quote, not a boxed panel.
          The quote glyphs come from the bundle, since each locale sets its own
          convention (es-ES/README.md keeps “ ”). */}
      {shoutout ? (
        <figure className="mt-10 print:hidden">
          <blockquote className="text-xl leading-relaxed font-medium text-pretty">
            {t("recap.crewQuote", { words: shoutout })}
          </blockquote>
          <figcaption className="mt-2 text-sm text-muted">{t("recap.fromYourCrew")}</figcaption>
        </figure>
      ) : shop.signOffNote?.trim() ? (
        // The shop's standing sign-off, in the shop's own words and only where
        // the crew wrote none for this diver (issue #1212). Uncaptioned: it is
        // a sentence, not a quotation the reader has to attribute.
        <p className="mt-10 text-base print:hidden">{shop.signOffNote.trim()}</p>
      ) : null}

      {/* What a course day left the student holding — before the review ask,
          which stays the page's one primary (issues #1196, #1205). */}
      {course ? (
        <CourseAfterState
          t={t}
          courseTitle={course.title}
          shopName={shop.name}
          certification={course.certification}
          nextStep={course.nextStep}
        />
      ) : null}

      {/* ——— The one ask. It is the page's single primary in every variant: a
          sparse keepsake never promotes a door to fill the space above it. */}
      <SectionCard
        padding="lg"
        className="mt-10 print:hidden"
        title={t("reviews.askHeading")}
        description={t("reviews.askBody")}
      >
        {reviewNotice ? (
          <FormStatus tone={reviewNotice.tone}>{t(reviewNotice.key)}</FormStatus>
        ) : null}
        {ownReview ? (
          <p className="mt-3 text-sm text-muted">
            {t("reviews.yourRating", { rating: ownReview.rating })}
          </p>
        ) : null}
        <form action={actions.submitReview} className="mt-4 flex flex-col gap-3">
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
            <SubmitButton
              pendingLabel={t("reviews.submitting")}
              className={buttonClass({
                variant: externalReviewUrl ? "secondary" : "primary",
              })}
            >
              {t("reviews.submit")}
            </SubmitButton>
          </div>
        </form>
      </SectionCard>

      {/* ——— The other thing worth saying, and it is private. Beside the review
          above and deliberately *outside* its `<form>` — a private field inside
          a public one is a trap, and a diver who has already left a review must
          still be able to reach this. Never a quiet door of its own: the doors
          below are places to go, and this is a second thing to say. */}
      <RecapPulse
        t={t}
        shopName={shop.name}
        ownPulse={ownPulse}
        notice={params.pulse}
        action={actions.submitPulse}
      />

      {/* ——— The quiet doors: hairline rows on the page background, each one a
          tap away from the form it already had. Same grammar as the prep
          state's spine, one screen earlier in the same thread. */}
      <ul className="mt-10 print:hidden">
        <Door
          id="photos"
          summary={t("recap.yourPhotos")}
          open={Boolean(photoNotice) || photos.length > 0}
        >
          <p className="text-base text-muted">{t("recap.photosBody", { shop: shop.name })}</p>
          {photoNotice ? (
            <FormStatus tone={photoNotice.tone} className="mt-3">
              {photoNotice.key === "recap.photoLimit"
                ? t(photoNotice.key, { max: maxPhotos })
                : t(photoNotice.key)}
            </FormStatus>
          ) : null}
          {photos.length ? (
            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((image) => (
                <li key={image.id} className="overflow-hidden rounded-inset border border-border">
                  <div className="relative aspect-square w-full">
                    {/* Diver photos always come from the blob store
                        (storeRecapImage), so the remotePatterns entry in
                        next.config.ts covers every url here. */}
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
          {photos.length >= maxPhotos ? (
            <p className="mt-4 text-sm text-muted">{t("recap.photoLimitReached")}</p>
          ) : (
            <form action={actions.uploadPhoto} className="mt-4 flex flex-col gap-3">
              {/* No separate caption: the control's own button *is* "Add a
                  photo", so a label above it saying the same thing was a second
                  reading of one instruction. */}
              <ImageFileInput
                name="photo"
                required
                multiple
                maxFiles={Math.max(0, maxPhotos - photos.length)}
                copy={{
                  choose: t("recap.addAPhoto"),
                  chooseAnother: t("recap.addAnotherPhoto"),
                  wrongTypeSuffix: t("recap.photoWrongTypeSuffix"),
                  tooBigSuffix: t("recap.photoTooBigSuffix", { maxMb: MAX_IMAGE_MB }),
                  tooMany: t("recap.photoTooMany", { max: Math.max(0, maxPhotos - photos.length) }),
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
        </Door>

        <TipDoor
          t={t}
          locale={locale}
          shopName={shop.name}
          currency={currency}
          canTip={canTip}
          tip={tip}
          tipPresets={tipPresets}
          tipParam={params.tip}
          notice={tipNotice}
          action={actions.startTip}
        />

        {/* ——— What these places are known to hold, for a next dive.
            Closed on arrival and never promoted: the review ask above is the
            page's one primary, and this is a keepsake's footnote. Absent
            entirely when no site the day dived names a species — an empty
            drawer is a heading apologising for having nothing behind it. */}
        {fieldGuideGroups.length > 0 ? (
          <Door
            id="field-guide"
            summary={t("recap.fieldGuideTitle", { count: fieldGuideGroups.length })}
            open={false}
          >
            <ul className="flex flex-col gap-6">
              {fieldGuideGroups.map((site) => (
                <li key={site.siteName}>
                  {/* The site's own name above its faces is what keeps this a
                      statement about a place. Without it the list floats free
                      and reads as the day's tally. */}
                  <p className="text-sm font-semibold">{site.siteName}</p>
                  <ul className="mt-3 grid gap-x-6 gap-y-5 sm:grid-cols-2">
                    {site.cards.map((card) => (
                      <li key={card.id} className="flex min-w-0 gap-3">
                        <StoredPhoto
                          src={card.imageUrl}
                          alt=""
                          className="size-12 shrink-0 rounded-inset"
                          sizes="48px"
                        />
                        <div className="min-w-0">
                          <p className="font-medium">{card.name}</p>
                          {card.description ? (
                            <p className="mt-1 text-sm leading-relaxed text-muted">
                              {card.description}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Door>
        ) : null}

        {/* The one review ask left: a strong rating just landed, so offer to
            carry it further instead of stacking a second, separately-worded
            ask underneath. It is a door rather than a disclosure — the
            destination is somebody else's site. */}
        {externalReviewUrl ? (
          <li className="border-t border-border last:border-b">
            <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">{t("recap.externalReviewHeading")}</p>
                <p className="mt-0.5 text-sm text-muted">
                  {ownReview?.comment
                    ? t("recap.externalReviewBody", { shop: shop.name })
                    : t("recap.externalReviewBodyNoComment", { shop: shop.name })}
                </p>
              </div>
              <ShareReviewButton
                reviewUrl={externalReviewUrl}
                comment={ownReview?.comment ?? null}
                cta={t("recap.externalReviewCta")}
                copiedLabel={t("recap.commentCopied")}
              />
            </div>
          </li>
        ) : null}
      </ul>

      {/* ——— One next dive, and one reason it is that one (D35, issue #1195).
          Renders nothing when the board has nothing this diver can dive. */}
      <NextDiveCard
        t={t}
        shopSlug={shop.slug}
        pick={nextDive}
        when={nextDiveWorded?.when ?? ""}
        reason={nextDiveWorded?.reason ?? ""}
        levelCovers={nextDiveWorded?.levelCovers ?? null}
      />

      {/* ——— One fact, one link. The shop's next public departure is the only
          thing worth saying on the way out; when the board is empty the link
          goes on its own rather than borrowing a sentence.

          **The fact stands down when the card above rendered.** Two "here is
          what is next" claims one scroll apart, naming two different
          departures, is the page arguing with itself — so the card wins and
          the footer keeps the link it always had. */}
      <footer className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-6 print:hidden">
        {nextDeparture && !nextDive ? (
          <p className="min-w-0 flex-1 text-base text-muted">
            {nextDeparture.title} · {nextDeparture.when}
          </p>
        ) : null}
        <Link
          href={publicSchedulePath(shop.slug)}
          className="font-medium text-primary hover:underline"
        >
          {t("recap.seeWhatsNext")}
        </Link>
      </footer>
    </main>
  );
}

/**
 * **The dive record** — the one place the day's facts render, and the one
 * thing on this page that prints.
 *
 * Every line is conditional on having actually been recorded: `trip_dives` may
 * be empty, a self-guided departure has no crew, a shore dive has no boat, and
 * the shipped recap already conditionalized conditions. What always renders is
 * the floor a logbook page needs — the shop, the trip, the date, the diver,
 * and how many dive days this makes.
 *
 * **It prints what the shop wrote down, and nothing else.** A review caught
 * this printing three things nobody observed (2026-08-28), which matters more
 * here than anywhere else on the surface: the print pass hides the whole page
 * except this card and gives it a ruled Notes block and a signature rule, so
 * what leaves the printer is a logbook page a divemaster is being asked to
 * sign — and logged dive counts and depths are what divers present for course
 * prerequisites (Rescue, Divemaster, Master Scuba Diver at 50 dives). It said
 * "Verified log entry from {shop}", which DiveDay cannot verify; it counted
 * `max(trips.planned_dives, sites.length)` as "{n} dives logged", which is
 * what a shop typed on the trip row weeks earlier and not what this diver did
 * — a diver who sat out the second tank with an ear squeeze read "2 dives
 * logged"; and it printed `dive_sites.max_depth_meters` under "Max depth",
 * which the glossary defines as the *site's* deepest point, "solely to be
 * comparable to a certification's depth ceiling", falling back when null to
 * `depth_range` — free-text briefing prose, so "Max depth: 40–60 ft, sandy
 * patches" could print under a depth label.
 *
 * All three are gone. The numbers a logbook wants are the diver's to write and
 * the signing divemaster's to countersign, on the ruled lines below — which is
 * what that block was always for. DiveDay records nothing about dives
 * *performed*; the nearest thing it holds is who boarded
 * (`roll_call_events`), and boarding is not a dive either.
 *
 * **The postcard** — Reef's third moment (ADR 20260901-diveday-reimagined,
 * slice 13i). The record's face is a band of the lagoon wash carrying the
 * day's site drawn in the illustration hand, with the heading in the shop's
 * own display face; the page above it already wears the shop's colour. The
 * drawing is decoration beside facts that say everything (`aria-hidden`), and
 * it does not print: what leaves the printer is still the logbook page, and a
 * brain coral on a sheet a divemaster signs is the one place the hand may not
 * go. Nothing about what the record *claims* changes — the sentence above
 * this one still governs every line.
 */
function DiveRecord({
  t,
  locale,
  shop,
  trip,
  when,
  diverName,
  sites,
  diveRecord,
  observedSpecies,
  visitCount,
  siteMark,
  postcard,
}: Pick<
  AfterStateProps,
  | "t"
  | "locale"
  | "shop"
  | "when"
  | "diverName"
  | "sites"
  | "diveRecord"
  | "observedSpecies"
  | "visitCount"
  | "siteMark"
  | "postcard"
> & {
  trip: AfterStateProps["trip"];
}) {
  // The plan, unless a record disagrees with it — see the Sites fact below.
  const recordedSiteNames = diveRecord
    ? diveRecord.actualSiteNames
    : sites.map((site) => site.name);
  const conditions = [
    trip.waterTemperatureC !== null
      ? {
          label: t("recap.waterTemp"),
          value: temperatureText(t, trip.waterTemperatureC, shop.temperatureUnit),
        }
      : null,
    trip.visibilityMeters !== null
      ? { label: t("trip.visibility"), value: depthText(t, trip.visibilityMeters, shop.depthUnit) }
      : null,
    trip.surfaceConditions ? { label: t("trip.surface"), value: trip.surfaceConditions } : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);
  // `fieldGuideCards` drops a slug the catalog no longer carries, the same way
  // the guide below does: a species DiveDay has retired has no words, and a
  // sighting rendered as a raw slug is worse than one not rendered at all.
  const seenNames = fieldGuideCards(
    observedSpecies.map((slug, index) => ({ id: String(index), catalogSlug: slug })),
    t,
  ).map((card) => card.name);
  const milestone = visitMilestone(visitCount);
  const stampText = milestone
    ? milestone === 1
      ? t("recap.milestoneStampFirst")
      : t("recap.milestoneStamp", { ordinal: formatOrdinal(milestone, locale) })
    : null;

  return (
    <section
      data-testid={AFTER_STATE_TEST_IDS.record}
      aria-labelledby="dive-record-heading"
      // Flat at rest, like every other panel (Clearwater decision 1). In print
      // it drops its chrome entirely and takes the page.
      className="mt-8 overflow-hidden rounded-panel border border-border bg-surface shadow-bed print:mt-0 print:rounded-none print:border-0"
    >
      {/* The postcard's face: the site, drawn, and the heading in the shop's
          face on the lagoon wash. The band is the wash, so the tile takes the
          shell to keep its edge. In print the band drops its wash and its
          drawing and the heading stands alone at the top of the sheet. */}
      <div
        data-testid={AFTER_STATE_TEST_IDS.face}
        className="flex items-center justify-between gap-4 bg-primary-tint px-5 py-4 sm:px-6 print:bg-transparent print:px-0 print:py-0"
      >
        <div className="flex min-w-0 items-center gap-4">
          {/* `data-postcard-mark` is `SavePostcard`'s reach into the live DOM:
              the export borrows this drawing rather than keeping a second copy
              of the illustration hand (issue #1081). */}
          <span data-postcard-mark className="contents">
            <SiteMark mark={siteMark} size="lg" ground="surface" className="print:hidden" />
          </span>
          <h2
            id="dive-record-heading"
            className={`font-brand-display ${SUB_TITLE_CLASS} text-pretty`}
          >
            {t("recap.logbookHeading")}
          </h2>
        </div>
        {stampText ? (
          <MilestoneStamp label={stampText} />
        ) : (
          // **A number, not a sentence** (H-67 c). It said "Your 3rd dive day
          // with Blue Mantis" — a whole clause naming the shop, on a card whose
          // eyebrow already says the shop and whose footer already says who
          // recorded it, three times on one postcard. "Dive day № 3" is the
          // fact and nothing else.
          //
          // The milestone roundel above keeps its own words, deliberately:
          // "First dive day" is a different sentence from an ordinary count,
          // and it is the one visit where the count *is* the moment.
          //
          // Never coral, exactly like the stamp it stands in for: primary tint
          // is the visit's ink either way. A first visit cannot reach this
          // branch — 1 is a milestone — so the count is always past one.
          <span
            data-testid={AFTER_STATE_TEST_IDS.visitLine}
            className="rounded-md bg-primary-tint px-2.5 py-1 text-xs font-semibold text-primary tabular-nums"
          >
            {t("recap.diveDayNumber", { count: visitCount })}
          </span>
        )}
      </div>

      <div className="p-5 pt-0 sm:p-6 sm:pt-0 print:p-0">
        <dl className="mt-5 divide-y divide-border border-t border-border">
          <Fact label={t("recap.diverLabel")}>{diverName}</Fact>
          <Fact label={t("recap.dateLabel")}>{when}</Fact>
          {trip.boatName ? <Fact label={t("recap.vesselLabel")}>{trip.boatName}</Fact> : null}
          {trip.crew.length > 0 ? (
            <Fact label={t("recap.crewLabel")}>{trip.crew.join(", ")}</Fact>
          ) : null}
          {recordedSiteNames.length > 0 ? (
            // Names only. The site's own maximum depth used to sit beside each
            // one under a "Max depth" label, on a card built to be printed and
            // pasted into a logbook — see this component's doc comment for why
            // that number is not this diver's.
            //
            // Which names these are depends on `diveRecord`: normally the day's
            // published plan, and where a divemaster wrote down a different site
            // the record instead, with the plan kept below (issue #1191). The
            // label is honest either way — on a day that went to plan the two
            // lists are the same list.
            <Fact label={t("recap.sitesLabel")} testId={AFTER_STATE_TEST_IDS.sites}>
              <ul className="flex flex-col gap-1">
                {recordedSiteNames.map((name) => (
                  <li key={name} className="font-medium">
                    {name}
                  </li>
                ))}
              </ul>
            </Fact>
          ) : null}
          {/* Only when the day went somewhere else. A "went as planned" line on
            every other recap would restate the list directly above it, and the
            copy rule deletes that sentence rather than shortening it. */}
          {diveRecord ? (
            <Fact label={t("recap.plannedSitesLabel")} testId={AFTER_STATE_TEST_IDS.plannedSites}>
              <ul className="flex flex-col gap-1">
                {diveRecord.plannedSiteNames.map((name) => (
                  <li key={name} className="text-muted">
                    {name}
                  </li>
                ))}
              </ul>
            </Fact>
          ) : null}
          {conditions.length > 0 ? (
            <Fact label={t("recap.conditionsOnTheDay")} testId={AFTER_STATE_TEST_IDS.conditions}>
              <span className="tabular-nums">
                {conditions.map((fact) => `${fact.label}: ${fact.value}`).join(" · ")}
              </span>
            </Fact>
          ) : null}
          {/* **Only when a crew member wrote it down** (issue #1190, D30). The
              field guide further down this page says what the reef *may* show
              you and is the shop's standing claim about a place; this line is
              somebody saying they saw it, on this day. Nothing here is derived
              from that guide — a sighting inferred from a site's usual life is
              the one thing D30's boundary rules out, and the two are separate
              fields so it cannot happen by accident.

              A past-tense label, deliberately: "Seen on the day" can only be
              read as a report, where a bare species name beside the conditions
              could be read as a promise.

              **`print:hidden`, unlike every other row here.** This card is
              built to be printed, hand-ruled and countersigned into a paper
              logbook, and `observedSpecies` is scoped to the *trip* — a diver
              who sat out the second tank with an ear squeeze would carry that
              tank's manta onto a page a divemaster signs. The sites line above
              has the same trip scope and stays, because an itinerary is a
              property of the day; a sighting is a property of one dive by one
              group. On screen it is the keepsake's line and belongs there
              (dive-domain review, 2026-09-04). */}
          {seenNames.length > 0 ? (
            <Fact
              label={t("recap.seenOnTheDay")}
              testId={AFTER_STATE_TEST_IDS.seen}
              className="print:hidden"
            >
              <ul className="flex flex-col gap-1">
                {seenNames.map((name) => (
                  <li key={name} className="font-medium">
                    {name}
                  </li>
                ))}
              </ul>
            </Fact>
          ) : null}
        </dl>

        {/* ——— Print only: what a paper logbook page has and a screen does not.
          Four ruled lines to write the dive up on, and a rule for whoever
          signs it off. */}
        <div
          data-testid={AFTER_STATE_TEST_IDS.printNotes}
          className="mt-6 hidden print:block"
          aria-hidden="true"
        >
          <p className="text-xs font-medium text-muted">{t("recap.printNotes")}</p>
          <div className="mt-2 flex flex-col gap-5">
            {[0, 1, 2, 3].map((line) => (
              <span key={line} className="block border-b border-border" />
            ))}
          </div>
        </div>
        <div
          data-testid={AFTER_STATE_TEST_IDS.printSignature}
          className="mt-8 hidden print:block"
          aria-hidden="true"
        >
          <span className="block border-b border-border" />
          <p className="mt-2 text-xs font-medium text-muted">{t("recap.printSignature")}</p>
        </div>

        {/* **The line a diver writes for themselves, and the picture it goes
            on** (D33 issue #1193, issue #1081). One component because they are
            one piece of state: the line is typed in the browser, drawn into the
            canvas in the browser, and has no path off the phone at all — and it
            owns the record's closing block, because the dashed row and the
            footer carrying Save are two rows of one thing. */}
        <SavePostcard
          postcard={postcard}
          fileName={`${t("recap.postcardFileName")}.png`}
          copy={{
            lineLabel: t("recap.privateLineLabel"),
            lineHint: t("recap.privateLineHint"),
            linePlaceholder: t("recap.privateLinePlaceholder"),
            save: t("recap.saveAsImage"),
            saving: t("recap.savingImage"),
            failed: t("recap.saveImageFailed"),
          }}
          // Whose record it is, which is all this card may claim of itself.
          recordedBy={
            <p className="text-xs text-muted">{t("recap.recordedBy", { shopName: shop.name })}</p>
          }
        >
          <PrintRecordButton label={t("recap.printRecord")} />
        </SavePostcard>
      </div>
    </section>
  );
}

/** One recorded fact of the day: its name, and what was recorded. */
function Fact({
  label,
  testId,
  className,
  children,
}: {
  label: string;
  testId?: string;
  /** For the one row that is the keepsake's and not the logbook's — see the sighting. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className={`flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4${className ? ` ${className}` : ""}`}
    >
      <dt className="text-xs font-medium text-muted sm:w-28 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1 text-base">{children}</dd>
    </div>
  );
}

/**
 * **The milestone stamp** — the keepsake's one piece of delight, on the visits
 * `src/lib/visit-milestones.ts` names and no others.
 *
 * Drawn, never an emoji, and **primary ink, never coral**: the thread spends
 * its accent exactly three times and this is not one of them (the same rule
 * the visit-ordinal chip beside it keeps). Static, so there is no reduced
 * variant to give a `prefers-reduced-motion` reader.
 *
 * The words are the caller's, out of the bundle — the `<text>` is laid out
 * here but never written here, so the stamp reads in Spanish too. The `<svg>`
 * carries the whole label as its accessible name, so a screen reader gets one
 * sentence rather than the three fragments the lines are broken into.
 */
function MilestoneStamp({ label }: { label: string }) {
  const lines = stampLines(label);
  return (
    <svg
      data-testid={AFTER_STATE_TEST_IDS.stamp}
      role="img"
      aria-label={label}
      viewBox="0 0 56 56"
      className="size-14 shrink-0 -rotate-6 text-primary"
    >
      <circle cx="28" cy="28" r="26" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="28" cy="28" r="21.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <text
        x="28"
        textAnchor="middle"
        fill="currentColor"
        fontSize="7.5"
        fontWeight="600"
        y={28 - (lines.length - 1) * 4.5}
      >
        {lines.map((line, index) => (
          <tspan key={line} x="28" dy={index === 0 ? "0.34em" : "1.2em"}>
            {line}
          </tspan>
        ))}
      </text>
    </svg>
  );
}

/**
 * The stamp's words, wrapped to fit inside a 56px roundel — greedily, at most
 * three lines, on whitespace only.
 *
 * A width in characters rather than in pixels because there is no text
 * measurement inside an SVG at render time; eleven is what fits the inner
 * circle at 7.5px in both bundled locales ("First dive day", "Primer día de
 * buceo"). A locale whose words genuinely do not fit overflows the ring rather
 * than being cut, which is the failure mode a reader can report.
 */
function stampLines(label: string): string[] {
  const lines: string[] = [];
  for (const word of label.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= 11) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  if (lines.length <= 3) return lines;
  return [...lines.slice(0, 2), lines.slice(2).join(" ")];
}

/**
 * One quiet door: a hairline row that says what is behind it and opens it in
 * place. The same construction the prep state's spine uses for a step with a
 * form — a native `<details>`, so keyboard and screen-reader semantics come
 * free and a failed hydrate still leaves the form one tap away.
 */
function Door({
  id,
  summary,
  open,
  children,
}: {
  id: string;
  summary: string;
  /** Open on arrival — there is something inside worth landing on. */
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    // `data-recap-door` is the door's own hook, the same reach
    // `data-thread-step` gives the prep spine: an e2e spec has to *open* a door
    // before the form inside it is on screen, and `e2e/fixtures.ts` filters
    // every `getBy*` to visible nodes.
    <li data-recap-door={id} className="border-t border-border last:border-b">
      <details id={id} open={open} className="group/door">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-3 select-none [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1 text-base font-semibold">{summary}</span>
          <DisclosureCaret className="text-muted group-open/door:rotate-90" />
        </summary>
        <div className="pb-6">{children}</div>
      </details>
    </li>
  );
}

/**
 * The tip door. It renders at all only when the shop can take a tip right now
 * *or* there is a durable tip to report: a shop that disconnects Stripe after
 * a diver already paid must not lose the diver's own confirmation along with
 * the form.
 */
function TipDoor({
  t,
  locale,
  shopName,
  currency,
  canTip,
  tip,
  tipPresets,
  tipParam,
  notice,
  action,
}: {
  t: DiverTranslator;
  locale: string;
  shopName: string;
  currency: ShopCurrency;
  canTip: boolean;
  tip: RecapPageData["tip"];
  tipPresets: number[];
  tipParam?: string;
  notice: { tone: "success" | "danger"; key: DiverMessageKey } | undefined;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const hasReportableTip =
    tip?.status === "paid" || (tip?.status === "pending" && Boolean(tip.checkoutUrl));
  if (!canTip && !hasReportableTip) return null;

  return (
    <Door
      id="tip"
      summary={t("recap.tipCrew")}
      open={Boolean(notice) || tip?.status === "paid" || tipParam === "paid"}
    >
      {notice ? (
        <FormStatus tone={notice.tone} className="mb-3">
          {t(notice.key)}
        </FormStatus>
      ) : null}
      {tip?.status === "paid" ? (
        <p className="text-base text-muted">{t("recap.tipPaid", { shop: shopName })}</p>
      ) : tipParam === "paid" ? (
        // Stripe already redirected the diver back with `?tip=paid`, but the
        // webhook that flips `tip.status` to "paid" can lag a few seconds —
        // never re-show the payment form or a stale checkout link in that
        // window, which would read as "you still need to pay."
        <p className="text-base text-muted">{t("recap.tipConfirming")}</p>
      ) : tip?.status === "pending" && tip.checkoutUrl ? (
        <>
          <p className="text-base text-muted">{t("recap.tipAllGoes", { shop: shopName })}</p>
          <a
            href={tip.checkoutUrl}
            className={buttonClass({ variant: "secondary", className: "mt-4" })}
          >
            {t("recap.tipFinish", {
              // `minorToMajor`, never a literal 100 — a ¥3,000 tip is whole
              // yen and dividing it would offer to pay ¥30.
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
          <p className="text-base text-muted">{t("recap.tipAllGoes", { shop: shopName })}</p>
          <form action={action} className="mt-4 flex flex-col gap-3">
            <TipAmountPicker
              presets={tipPresets}
              defaultPreset={tipPresets[1]}
              currencySymbol={currencySymbol(currency, locale)}
              legend={t("recap.tipAmountLegend")}
              otherPlaceholder={t("recap.otherTipPlaceholder")}
              otherAriaLabel={t("recap.otherTipAriaLabel")}
            />
            <div>
              <SubmitButton
                pendingLabel={t("booking.headingToPayment")}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("recap.tipLeave")}
              </SubmitButton>
            </div>
          </form>
        </>
      ) : null}
    </Door>
  );
}
