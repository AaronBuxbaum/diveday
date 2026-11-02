import Link from "next/link";
import { BrandStyle } from "@/components/BrandStyle";
import { EarnedMoment } from "@/components/EarnedMoment";
import { EYEBROW_CLASS } from "@/components/ShopPageHeader";
import { THREAD_MEASURE_CLASS } from "@/components/thread/ThreadShell";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { SECTION_TITLE_CLASS, SHELL_TITLE_CLASS } from "@/components/ui/typography";
import type { AfterStateProps } from "@/features/recap-after-state";
import { fieldGuideCards } from "@/i18n/marine-life-labels";
import { flySafeMessageKey } from "@/lib/fly-safe";
import { publicSchedulePath } from "@/lib/public-routes";
import { afterNotices } from "./after-notices";
import { AFTER_STATE_TEST_IDS } from "./after-state-test-ids";
import { BuddyShareButton } from "./BuddyShareButton";
import { CourseAfterState } from "./CourseAfterState";
import { DiveRecord } from "./DiveRecord";
import { NextDiveCard } from "./NextDiveCard";
import { Door, FieldGuideDoor, PhotoDoor, TipDoor } from "./RecapDoors";
import { hasRecapPulseNotice, RecapPulse } from "./RecapPulse";
import { ReviewAsk } from "./ReviewAsk";
import { ShareReviewButton } from "./ShareReviewButton";

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
 *    it — after a rating has just landed, never beside it.
 * 5. **The other thing worth saying, privately** — the pulse (D40, issue
 *    #1200). Outside the review's `<form>`, because a private field inside a
 *    public one is a trap and a diver who has already left a review must still
 *    be able to reach it. It is the **first quiet door** and shut at rest: it
 *    stood open at the review's own weight until 2026-09-17, so one page asked
 *    one question twice — five stars, a box and a send button, then five chips,
 *    a box and a send button. A complaint is a minority act at a minority
 *    moment, which is what disclosure is for.
 * 6. **The rest of the quiet doors** — photos and the tip, each a hairline row
 *    that opens its existing form in place, in the same grammar the prep
 *    state's spine uses one screen earlier. A door shows only the controls
 *    that can do something: the photo form's caption and submit appear with
 *    the file, not before it.
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
 * and 8 above, replaced the face's sentence with its number (H-20260904-reef-go-all-way c), and put
 * the private line and the export in the record's own footer. This component is
 * where that decision lives and the one that must not drift from it.
 */
export type { AfterStateProps };

export function AfterState({
  context,
}: {
  /** Everything the page draws, assembled once by `buildAfterStateProps`. */
  context: AfterStateProps;
}) {
  const {
    t,
    locale,
    shop,
    trip,
    when,
    diverName,
    sites,
    diveRecord,
    flySafe,
    fieldGuide,
    observedSpecies,
    course,
    shoutout,
    photos,
    maxPhotos,
    photosOn,
    visitCount,
    currency,
    canTip,
    tip,
    tipPresets,
    canReview,
    ownReview,
    ownPulse,
    params,
    nextDeparture,
    postcard,
    nextDive,
    nextDiveWorded,
    nextDiveHref = null,
    bookedNext = null,
    yourDays = null,
    buddyLinkUrl = null,
    canShareWithBoat,
    actions,
    siteMark,
  } = context;
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
  const { reviewNotice, photoNotice, tipNotice, externalReviewUrl } = afterNotices(
    params,
    ownReview,
    shop.reviewUrl,
  );

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
        course={course}
      />

      {/* The one line the diver's body still needs after the record is closed
          (issue #1425): when they may fly, in the shop's zone, with the hours
          and who set them in the same sentence. A sentence and no panel — it
          informs, and a boxed warning would read as a gate. Off the print, which
          is the keepsake alone. A section's `mt-10` like every one around it:
          at `mt-6` it broke the page's 40px rhythm under the record (K-532). */}
      {flySafe ? (
        <p data-testid={AFTER_STATE_TEST_IDS.flySafe} className="mt-10 text-base print:hidden">
          {t(`recap.${flySafeMessageKey(flySafe)}`, {
            when: flySafe.when,
            count: flySafe.hours,
            shopName: shop.name,
          })}
        </p>
      ) : null}

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
      {canReview ? (
        <ReviewAsk
          t={t}
          notice={reviewNotice}
          ownReview={ownReview}
          stepsBack={externalReviewUrl !== null}
          action={actions.submitReview}
        />
      ) : null}

      {/* ——— The quiet doors: hairline rows on the page background, each one a
          tap away from the form it already had. Same grammar as the prep
          state's spine, one screen earlier in the same thread. */}
      <ul className="mt-10 print:hidden">
        {/* ——— The other thing worth saying, and it is private. It stands
            **outside the review's `<form>`** — a private field inside a public
            one is a trap, and a diver who has already left a review must still
            be able to reach this.

            It used to be a standing section at the review's own weight: five
            chips, a textarea and a "Send it to the shop" button, all open, so
            the page asked one question twice and a diver had to work out which
            one the page wanted (2026-09-17 design review). It is the first
            quiet door now, directly under the review, shut at rest — a
            complaint is a minority act at a minority moment, which is exactly
            what disclosure is for (principle 8). It opens on arrival only when
            there is something in it already: a diver's own standing pulse, or
            a `?pulse=` this render has to answer. */}
        <Door
          id="pulse"
          summary={t("recap.pulseHeading")}
          open={hasRecapPulseNotice(params.pulse) || ownPulse !== null}
        >
          <RecapPulse
            t={t}
            shopName={shop.name}
            ownPulse={ownPulse}
            notice={params.pulse}
            action={actions.submitPulse}
          />
        </Door>

        {/* Recap photos switched off on Features: no door at all. */}
        {photosOn ? (
          <PhotoDoor
            t={t}
            shopName={shop.name}
            tripTitle={trip.title}
            photos={photos}
            maxPhotos={maxPhotos}
            canShareWithBoat={canShareWithBoat}
            notice={photoNotice}
            action={actions.uploadPhoto}
            unshareAction={actions.unsharePhoto}
          />
        ) : null}

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
        <FieldGuideDoor t={t} groups={fieldGuideGroups} />

        {/* The one review ask left: a rating just landed, so offer to
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
                    ? t("recap.externalReviewBody")
                    : t("recap.externalReviewBodyNoComment")}
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
        href={nextDiveHref}
        when={nextDiveWorded?.when ?? ""}
        reason={nextDiveWorded?.reason ?? ""}
        levelCovers={nextDiveWorded?.levelCovers ?? null}
      />
      {/* ——— **The seat they already hold, in the pick's place** (fifth-loop
          ideas, item 37). A regular booked on Dec 5 is told so rather than
          sold another seat; `/recap` never carries it. */}
      {bookedNext ? (
        <SectionCard padding="lg" className="mt-10 print:hidden" title={t("recap.nextDiveHeading")}>
          <p className="text-base">{t("recap.bookedNext", bookedNext)}</p>
        </SectionCard>
      ) : null}

      {/* ——— Every other day with the shop, each row sending its own fresh
          link (H-20261014-other-days-send-fresh). Only `/ready` fills it. */}
      {yourDays}

      {/* ——— **Bring a buddy next time** (ADR 20260908-one-hand, decision 6,
          lever W). One line under the day that just happened, and a link the
          diver hands to a friend. The friend books their own seat and signs
          their own waiver; the shop is told where the seat came from.

          **No discount, no code, no reward** — the roadmap's referral-program
          call stays parked. This is the door, counted. */}
      {buddyLinkUrl ? (
        <section className="mt-10 rounded-panel bg-surface-sunken p-5 print:hidden sm:p-6">
          <h2 className={SECTION_TITLE_CLASS}>{t("recap.buddyHeading")}</h2>
          <p className="mt-1 text-muted">{t("recap.buddyBody")}</p>
          {/* The control is the affordance; the URL is not page furniture. It
              used to print in full, mono, under a "Your link" caption — the
              loudest thing in the block and the one thing nobody reads. It
              reaches a screen reader as the button's description instead
              (`BuddyShareButton`). */}
          <BuddyShareButton
            url={buddyLinkUrl}
            action={t("recap.buddyCta")}
            copied={t("recap.buddyCopied")}
            copyFailed={t("recap.buddyCopyFailed")}
          />
        </section>
      ) : null}

      {/* ——— One fact, one link. The shop's next public departure is the only
          thing worth saying on the way out; when the board is empty the link
          goes on its own rather than borrowing a sentence.

          **The fact stands down when the card above rendered.** Two "here is
          what is next" claims one scroll apart, naming two different
          departures, is the page arguing with itself — so the card wins and
          the footer keeps the link it always had. */}
      <footer className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-6 print:hidden">
        {nextDeparture && !nextDive && !bookedNext ? (
          <p className="min-w-0 flex-1 text-base text-muted">
            {nextDeparture.title} · {nextDeparture.when}
          </p>
        ) : null}
        <Link
          href={publicSchedulePath(shop.slug)}
          className={buttonClass({ variant: "link", flush: true })}
        >
          {t("recap.seeWhatsNext")}
        </Link>
      </footer>
    </main>
  );
}
