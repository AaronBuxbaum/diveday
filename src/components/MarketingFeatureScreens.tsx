import { RouteWaypoint } from "@/components/RouteWaypoint";
import { EYEBROW_CLASS } from "@/components/ShopPageHeader";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { StarRating } from "@/components/StarRating";
import { Badge } from "@/components/ui/badge";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import {
  DoorChevron,
  GroupLabel,
  groupLabelClass,
  LedgerGroup,
  LedgerRow,
  ledgerKindColumnClass,
  ledgerRowBoxClass,
} from "@/components/ui/ledger";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusMark, StatusMarkColumn } from "@/components/ui/StatusMark";
import { segmentClass, segmentedTrackClass } from "@/components/ui/segmented";
import {
  FIGURE_CLASS,
  FIGURE_INLINE_CLASS,
  FIGURE_LARGE_CLASS,
  ITEM_TITLE_CLASS,
  LEAD_TITLE_CLASS,
  SUB_TITLE_CLASS,
} from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { routePathD } from "@/lib/dive-site-route";
import {
  AppBar,
  MOCK_BODY,
  MOCK_PRIMARY_BUTTON,
  MOCK_SECONDARY_BUTTON,
} from "./MarketingScreenFallbacks";

/**
 * The feature pages' screens (`src/app/product/_components/FeatureScreen.tsx`),
 * one per page, in the same family as `MarketingScreenFallbacks.tsx`: the
 * shop's bar, a body on the bar's 20px inset, and buttons on the 44px rung.
 *
 * Each is a slice of one real screen, drawn with that screen's own parts
 * (`LedgerRow`, `Badge`, `StatusMark`, the segmented track) and its own words,
 * in its own order. Each component names the file it mirrors and what it
 * leaves out; a change to that screen is a change here. Nothing on these is
 * interactive: they render inside `MarketingMockup`'s `role="img"`, so every
 * button is a disabled drawing and nothing takes focus.
 *
 * Money, dates and times are words in the bundle (`fallback.<screen>.*`),
 * already formatted the way each locale's `Intl` writes them, so a mock reads
 * the same on every server and in every zone.
 */

/** The public week ledger's day rule figure, numeral and words, drawn at mock scale. */
const DAY_RULE_WORD = "text-sm font-bold tracking-[0.18em] uppercase";

/**
 * **A departure's booking card** — `BookSpotSection` on the public trip page
 * (`src/app/s/[shopSlug]/trips/[id]/_components/BookingSections.tsx`): the
 * "Grab a spot" heading and the seats left, `BookingPartyFields`' numeral
 * track, `BookingGearFields`' rental pills and nitrox line, and the money
 * block over "Book and pay". The requirement line above it is the page's own
 * (`trips/[id]/page.tsx`, `trip.requirementNote`). Left out: the contact
 * fields, the promo code and the payment hint under the button. From a 384px
 * panel the form and the money stand side by side; the page itself stacks
 * them.
 */
export function BookingCardFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const gear = [
    { label: t("fallback.bookingCard.bcd"), price: t("fallback.bookingCard.bcdPrice") },
    { label: t("fallback.bookingCard.wetsuit"), price: t("fallback.bookingCard.wetsuitPrice") },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.bookingCard.label")} />
      <div className={`@container ${MOCK_BODY}`}>
        <p className="text-xs text-muted">{t("fallback.bookingCard.requirement")}</p>
        <div className="mt-3 rounded-inset border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold">{t("fallback.bookingCard.heading")}</h3>
            <p className="text-xs font-medium text-primary tabular-nums">
              {t("fallback.spotsLeft", { count: 4 })}
            </p>
          </div>
          <div className="mt-3 grid gap-4 @sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] @sm:items-start">
            <div>
              <p className="text-xs font-semibold text-muted">{t("fallback.bookingCard.divers")}</p>
              <div className={`mt-2 w-fit max-w-full ${segmentedTrackClass}`}>
                {[1, 2, 3, 4].map((count) => (
                  <span
                    key={count}
                    className={`inline-flex min-h-9 min-w-9 flex-1 items-center justify-center px-2 text-sm tabular-nums ${segmentClass(
                      { selected: count === 1 },
                    )}`}
                  >
                    {count}
                  </span>
                ))}
              </div>
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-xs font-semibold text-muted">
                  {t("fallback.bookingCard.rentalGear")}
                </p>
                <p className="mt-2 flex items-baseline gap-2 text-xs font-medium">
                  <StatusMarkColumn variant="checked" className="text-primary" />
                  <span>{t("fallback.bookingCard.needGear")}</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {gear.map((item) => (
                    <span
                      key={item.label}
                      className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs"
                    >
                      <StatusMark variant="checked" className="text-primary" />
                      <span className="font-medium">{item.label}</span>
                      <span className="text-muted tabular-nums">{item.price}</span>
                    </span>
                  ))}
                </div>
                <p className="mt-2 flex items-baseline gap-2 text-xs">
                  <StatusMarkColumn variant="unchecked" className="text-muted" />
                  <span>{t("fallback.bookingCard.nitrox")}</span>
                </p>
              </div>
            </div>
            <div className="border-t border-border pt-3 @sm:border-t-0 @sm:pt-0">
              <dl className="space-y-1.5 text-xs">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted tabular-nums">{t("fallback.bookingCard.fare")}</dt>
                  <dd className="tabular-nums">{t("fallback.bookingCard.fareAmount")}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted">{t("fallback.bookingCard.rentalGear")}</dt>
                  <dd className="tabular-nums">{t("fallback.bookingCard.gearAmount")}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
                  <dt className="font-medium">{t("fallback.bookingCard.dueNow")}</dt>
                  <dd className={FIGURE_INLINE_CLASS}>{t("fallback.bookingCard.total")}</dd>
                </div>
              </dl>
              <button type="button" disabled className={`mt-3 w-full ${MOCK_PRIMARY_BUTTON}`}>
                {t("fallback.bookingCard.bookAndPay")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * **The shop's own booking page** — `src/app/s/[shopSlug]/page.tsx`: the hero
 * without a cover photo (`_components/ShopfrontHero.tsx`: name, tagline, the
 * star rating and its count), the year the shop opened from the badge wall
 * (`BadgeWall.tsx`), the next boat with space (`NextBoatCard.tsx`), and one
 * day of the week's departures (`WeekLedger.tsx`): the day rule, then each
 * boat's time, title, sites, seats and price, with the badge spent only on the
 * nearly full one. Left out: the cover photo, the other badges, the week
 * picker and the rest of the week.
 */
export function StorefrontFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const rating = t("fallback.storefront.rating");
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.storefront.label")} />
      <div className={`@container ${MOCK_BODY}`}>
        <div className="grid gap-4 @md:grid-cols-[minmax(0,1fr)_minmax(0,13rem)] @md:items-start">
          <div>
            {/* i18n-exempt: sample shop name used only in marketing mockups */}
            <h3 className={`font-brand-display ${LEAD_TITLE_CLASS}`}>Blue Mantis Divers</h3>
            <p className="mt-1 text-sm text-muted">{t("fallback.storefront.tagline")}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <StarRating
                rating={5}
                label={t("fallback.storefront.ratingLabel", { rating })}
                tone="accent"
              />
              <span className="font-semibold tabular-nums">{rating}</span>
              <span aria-hidden="true" className="text-muted">
                ·
              </span>
              <span className="text-muted">{t("fallback.storefront.reviews", { count: 126 })}</span>
            </p>
            <p className="mt-3">
              <span className="inline-flex min-h-7 items-center rounded-full border border-border bg-surface px-2.5 text-xs">
                {t("fallback.storefront.since")}
              </span>
            </p>
          </div>
          <div className="rounded-inset border border-border bg-surface p-4">
            <p className={groupLabelClass("primary")}>{t("fallback.storefront.nextBoat")}</p>
            <p className="mt-1">
              <span className={FIGURE_CLASS}>{t("fallback.storefront.nextTime")}</span>
              <span className="ms-2 text-sm font-medium text-muted">
                {t("fallback.storefront.nextWhen")}
              </span>
            </p>
            <p className="mt-1 text-sm font-semibold">{t("fallback.tripName")}</p>
            <p className="mt-0.5 text-xs text-muted">
              {t("fallback.spotsLeft", { count: 3 })} · {t("fallback.storefront.perDiver")}
            </p>
            <button type="button" disabled className={`mt-3 w-full ${MOCK_PRIMARY_BUTTON}`}>
              {t("fallback.storefront.bookThisBoat")}
            </button>
          </div>
        </div>
        <h3 className={`mt-5 font-brand-display ${ITEM_TITLE_CLASS}`}>
          {t("fallback.storefront.scheduleHeading")}
        </h3>
        <div className="mt-2 flex items-center gap-3">
          <span className={`min-w-[2ch] leading-none ${FIGURE_CLASS}`}>10</span>
          <span className={DAY_RULE_WORD}>{t("fallback.storefront.weekday")}</span>
          <span className={`${DAY_RULE_WORD} font-medium text-muted`}>
            {t("fallback.storefront.month")}
          </span>
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>
        <ul className="mt-1">
          <li className="flex flex-col gap-1 border-b border-border py-2.5 @md:flex-row @md:items-center @md:gap-4">
            <p className="text-sm font-semibold whitespace-nowrap tabular-nums @md:w-36 @md:shrink-0">
              {t("fallback.storefront.reefTime")}
            </p>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("fallback.tripName")}</p>
              <p className="mt-0.5 text-xs text-muted">{t("fallback.storefront.reefSites")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <p className="text-sm text-muted tabular-nums">
                {t("fallback.spotsLeft", { count: 3 })}
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {t("fallback.storefront.reefPrice")}
              </p>
              <DoorChevron className="ms-auto" />
            </div>
          </li>
          <li className="flex flex-col gap-1 border-b border-border py-2.5 @md:flex-row @md:items-center @md:gap-4">
            <p className="text-sm font-semibold whitespace-nowrap tabular-nums @md:w-36 @md:shrink-0">
              {t("fallback.storefront.nightTime")}
            </p>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("fallback.nightDive")}</p>
              {/* i18n-exempt: sample dive site used only in marketing mockups */}
              <p className="mt-0.5 text-xs text-muted">City of Washington</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Badge tone="warning" size="sm" tabularNums>
                {t("fallback.storefront.onlyLeft", { count: 2 })}
              </Badge>
              <p className="text-sm font-semibold tabular-nums">
                {t("fallback.storefront.nightPrice")}
              </p>
              <DoorChevron className="ms-auto" />
            </div>
          </li>
        </ul>
      </div>
    </div>
  );
}

/**
 * **Signing the waiver on a diver's phone** — `src/app/waivers/[token]/page.tsx`
 * with its step rail (`WaiverStepRail.tsx`) two steps in, one release question
 * from the medical form (`MedicalQuestionnaireFields.tsx`, the questions in
 * `src/lib/medical.ts`) answered, and the typed signature over "Sign waiver".
 * The release and the medical question stay in English in every language, as
 * they do on the page (H-01/H-03), and a Spanish reader gets the page's own
 * notice saying so. Left out: the rest of the release and of the form, and
 * the guardian's line. From a 448px panel the form and the signature stand
 * side by side; the page itself is one column.
 */
export function WaiverSigningFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const steps = [
    { label: t("fallback.waiverSigning.railRelease"), done: true },
    { label: t("fallback.waiverSigning.railMedical"), done: true },
    { label: t("fallback.waiverSigning.railSign"), done: false },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.waiverSigning.label")} />
      <div className={`@container ${MOCK_BODY}`}>
        <h3 className={SUB_TITLE_CLASS}>{t("fallback.waiverSigning.title")}</h3>
        <p className="mt-1 text-sm text-muted">{t("fallback.waiverSigning.description")}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-y border-border py-2">
          <ol className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center gap-1.5 text-xs font-medium">
                <StatusMark
                  variant={step.done ? "success" : "pending"}
                  className={step.done ? "text-success" : "text-muted"}
                />
                <span className={step.done ? undefined : "text-muted"}>{step.label}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted tabular-nums">{t("fallback.waiverSigning.progress")}</p>
        </div>
        {locale === DEFAULT_DIVER_LOCALE ? null : (
          <p className="mt-3 flex items-baseline gap-2 rounded-lg bg-warning-tint px-3 py-2 text-xs text-warning-strong">
            <StatusMarkColumn variant="warning" />
            <span>{t("fallback.waiverSigning.englishOnly")}</span>
          </p>
        )}
        <div className="mt-4 grid gap-4 @md:grid-cols-2 @md:items-start">
          <div>
            <p className="border-b border-border pb-1.5 text-xs font-medium text-muted">
              {t("fallback.waiverSigning.version", {
                // i18n-exempt: the sample shop's own release title, used only in marketing mockups
                title: "Blue Mantis Diving Release",
                version: 1,
              })}
            </p>
            {/* i18n-exempt: release wording stays English pending H-01/H-03 (DEFAULT_WAIVER_BODY) */}
            <p className="mt-2 text-xs font-semibold">
              Release of Liability, Waiver of Claims, and Assumption of Risk
            </p>
            {/* i18n-exempt: release wording stays English pending H-01/H-03 (DEFAULT_WAIVER_BODY) */}
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">
              I understand that scuba diving, snorkeling, and boat travel carry inherent risks
            </p>
            <div className="mt-3 rounded-lg border border-border bg-surface p-3">
              {/* i18n-exempt: medical form wording stays English pending H-01/H-03 (src/lib/medical.ts) */}
              <p className="text-sm font-medium">I am over 45 years of age.</p>
              <div className="mt-2 flex gap-2">
                <span className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs">
                  <StatusMark variant="pending" className="text-muted" />
                  {t("waiver.answerYes")}
                </span>
                <span className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-primary bg-primary-tint px-3 text-xs font-medium text-primary">
                  <span
                    aria-hidden="true"
                    className="flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"
                  >
                    <span className="size-1.5 rounded-full bg-primary" />
                  </span>
                  {t("waiver.answerNo")}
                </span>
              </div>
            </div>
          </div>
          <div className="rounded-inset border border-border bg-surface p-3">
            <p className="text-sm font-semibold">{t("fallback.waiverSigning.signature")}</p>
            <p className="mt-2 text-xs font-medium text-muted">
              {t("fallback.waiverSigning.typeFullName")}
            </p>
            <div className="mt-1 flex min-h-9 items-center rounded-lg border border-border bg-surface px-3 text-sm">
              {/* i18n-exempt: sample diver name used only in marketing mockups */}
              <span>Priya Sharma</span>
            </div>
            <p className="mt-3 flex items-baseline gap-2 text-xs">
              <StatusMarkColumn variant="checked" className="text-primary" />
              <span>{t("fallback.waiverSigning.agreement")}</span>
            </p>
            <button type="button" disabled className={`mt-3 w-full ${MOCK_PRIMARY_BUTTON}`}>
              {t("fallback.waiverSigning.signButton")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A roster group's band: its label over the sunken strip (`RosterGroupBand.tsx`). */
const ROSTER_BAND =
  "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 bg-surface-sunken/50 px-4 py-1.5";

/** The roster row's disclosure, at the row's end (`RosterSection.tsx`). */
function RowCaret() {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center text-muted"
    >
      <DisclosureCaret direction="down" />
    </span>
  );
}

/**
 * **The arrival desk** — a departure's Divers tab inside the arrivals window
 * (`src/app/shop/[shopSlug]/trips/[id]/_arrivals/arrival-desk.tsx`): the
 * counter instrument (`CounterInstrument.tsx`, "7 of 9 here" over its bar),
 * then the roster's three bands (`_components/RosterSection.tsx`,
 * `RosterGroupBand.tsx`). Still to clear: a held seat, whose identity check
 * (`src/components/IdentityCheck.tsx`) asks whether the booking is the same
 * person, and which has no Check in tap. Ready: a diver with the Check in tap
 * (`ArrivalTap.tsx`). Checked in: one of the seven, its tap turned to
 * "Checked in". Left out: the "Not here" door under each waiting row
 * (`NoShowScript.tsx`), the other six checked-in rows and the walk-in door.
 */
export function ArrivalDeskFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.arrivalDesk.label")} />
      <div className={MOCK_BODY}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm text-muted tabular-nums">
            {t.rich("fallback.arrivalDesk.hereOf", {
              here: 7,
              expected: 9,
              figure: (chunks) => (
                <span className={`${FIGURE_LARGE_CLASS} text-foreground`}>{chunks}</span>
              ),
            })}
          </p>
          <p className="text-xs text-muted">{t("fallback.arrivalDesk.remainder")}</p>
        </div>
        <ProgressBar
          aria-hidden="true"
          className="mt-2 h-[5px]"
          segments={[
            { key: "here", fraction: 7 / 9, className: "bg-success/70" },
            { key: "blocked", fraction: 1 / 9, className: "bg-danger/60" },
          ]}
        />
        <div className="mt-4 overflow-hidden rounded-inset border border-border bg-surface">
          <div className={ROSTER_BAND}>
            <p className={groupLabelClass()}>
              {t("fallback.arrivalDesk.stillToClear", { count: 1 })}
            </p>
          </div>
          <div className="px-4 py-2.5">
            <div className="flex items-center gap-2">
              {/* i18n-exempt: sample diver name used only in marketing mockups */}
              <p className="min-w-0 flex-1 text-sm font-semibold">Diego Alvarez</p>
              <Badge tone="danger" size="sm" toneMark={false}>
                {t("fallback.arrivalDesk.blocked")}
              </Badge>
              <RowCaret />
            </div>
            <p className="flex items-baseline gap-2 text-xs text-danger">
              <StatusMarkColumn variant="danger" />
              <span>
                {t("fallback.arrivalDesk.heldReason", {
                  // i18n-exempt: sample diver names used only in marketing mockups
                  bookedAs: "Mateo Rossi",
                  // i18n-exempt: sample diver names used only in marketing mockups
                  name: "Diego Alvarez",
                })}
              </span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled className={`px-3 ${MOCK_SECONDARY_BUTTON}`}>
                {t("fallback.arrivalDesk.samePerson")}
              </button>
              <button type="button" disabled className={`px-3 ${MOCK_SECONDARY_BUTTON}`}>
                {t("fallback.arrivalDesk.differentPerson")}
              </button>
            </div>
          </div>
          <div className={ROSTER_BAND}>
            <p className={groupLabelClass()}>{t("fallback.arrivalDesk.ready", { count: 1 })}</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-1.5">
            {/* i18n-exempt: sample diver name used only in marketing mockups */}
            <p className="min-w-0 flex-1 text-sm font-semibold">Priya Sharma</p>
            <button
              type="button"
              disabled
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-semibold whitespace-nowrap text-primary"
            >
              <span
                aria-hidden="true"
                className="size-5 shrink-0 rounded-full border-2 border-current"
              />
              {t("fallback.arrivalDesk.checkIn")}
            </button>
            <RowCaret />
          </div>
          <div className={ROSTER_BAND}>
            <p className={groupLabelClass()}>
              {t("fallback.arrivalDesk.checkedInGroup", { count: 7 })}
            </p>
          </div>
          <div className="flex items-center gap-2 px-4 py-1.5">
            {/* i18n-exempt: sample diver name used only in marketing mockups */}
            <p className="min-w-0 flex-1 text-sm font-semibold">Tom Okafor</p>
            <button
              type="button"
              disabled
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-semibold whitespace-nowrap text-success"
            >
              <StatusMark variant="success" size="md" />
              {t("fallback.arrivalDesk.checkedIn")}
            </button>
            <RowCaret />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The seeded Molasses Reef route (`src/db/seed-dive-sites.ts`), in the map frame's 0 to 100 units. */
const MOLASSES_ROUTE = [
  { x: 16, y: 67 },
  { x: 44, y: 29 },
  { x: 72, y: 52 },
  { x: 84, y: 78 },
];

/**
 * **A dive site's briefing, as a diver reads it** on the public trip page
 * (`src/app/s/[shopSlug]/trips/[id]/_components/TripDayPlan.tsx`): "The day"
 * with the dive's row (the site, its depth, the usual time in the water) and
 * the sightings line under it with the beat's own caption, then "The route"
 * (`TripRoutes`, `src/components/DiveSiteMap.tsx`): the shop's drawn line,
 * hollow at the start and filled at the finish, with the route's name and
 * note. The site, depth and route are the seeded Molasses Reef's, and so are
 * the two sightings' counts (`src/db/seed-sightings.ts`). The map is drawn as
 * a plain frame: the page lays the line over a terrain map. Left out: the
 * field guide, the moments, and the site's own notes.
 */
export function SiteBriefingFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const start = MOLASSES_ROUTE[0];
  const finish = MOLASSES_ROUTE[MOLASSES_ROUTE.length - 1];
  const sightings = [
    {
      line: t("fallback.siteBriefing.seenStingray"),
      lastSeen: t("fallback.siteBriefing.lastSeenStingray"),
    },
    {
      line: t("fallback.siteBriefing.seenTurtle"),
      lastSeen: t("fallback.siteBriefing.lastSeenTurtle"),
    },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.tripName")} />
      <div className={`@container ${MOCK_BODY}`}>
        <LedgerGroup as="h3" label={t("fallback.siteBriefing.theDay")}>
          <ul>
            <LedgerRow
              kind={{ word: t("fallback.siteBriefing.diveNumber"), tone: "neutral" }}
              trailing={
                <span className="flex items-center gap-3">
                  <span className="text-sm text-muted tabular-nums">
                    {t("common.units.meters", { value: 12 })}
                  </span>
                  <DoorChevron />
                </span>
              }
            >
              {/* i18n-exempt: sample dive site used only in marketing mockups */}
              <span className="block text-sm font-medium">Molasses Reef</span>
              <span className="block text-sm text-muted tabular-nums">
                {t("fallback.siteBriefing.bottomTime")}
              </span>
            </LedgerRow>
            <li className={`flex gap-3 py-2 ${ledgerRowBoxClass}`}>
              <span className={`${ledgerKindColumnClass} shrink-0`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t("fallback.siteBriefing.seenHeading")}</p>
                <ul className="mt-1 space-y-1">
                  {sightings.map((sighting) => (
                    <li key={sighting.line} className="text-sm leading-relaxed">
                      <span className="block">{sighting.line}</span>
                      <span className="block text-muted max-sm:hidden">{sighting.lastSeen}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          </ul>
        </LedgerGroup>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {t("fallback.siteBriefing.honest")}
        </p>
        <GroupLabel as="h3" className="mt-5 mb-2">
          {t("fallback.siteBriefing.theRoute")}
        </GroupLabel>
        <figure className="overflow-hidden rounded-inset border border-border bg-surface-sunken @md:grid @md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
          <div className="relative h-24">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="absolute inset-0 h-full w-full"
            >
              <path
                d={routePathD(MOLASSES_ROUTE)}
                fill="none"
                stroke="var(--primary)"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.25}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <RouteWaypoint point={start} className="border-primary bg-surface" />
            <RouteWaypoint point={finish} className="border-surface bg-primary" />
          </div>
          <figcaption className="border-t border-border bg-surface px-4 py-2.5 text-xs @md:border-t-0 @md:border-s">
            <p className="font-medium">{t("fallback.siteBriefing.routeLabel")}</p>
            <p className="mt-0.5 text-muted">{t("fallback.siteBriefing.routeNote")}</p>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}

/** A filter chip on the gear register (`src/app/shop/[shopSlug]/gear/page.tsx`). */
const GEAR_CHIP =
  "inline-flex min-h-8 shrink-0 items-center rounded-full border px-3 text-xs font-medium whitespace-nowrap";

/**
 * **The gear register** — `src/app/shop/[shopSlug]/gear/page.tsx`: the kind
 * chips with their counts, "All" lit, and the service-due chip at the end,
 * then the register itself (`_components/GearRegisterLedger.tsx`), one row
 * per unit: its tag, its model and size, and the one fact it carries. A
 * reserved unit names its diver and the day; a unit that needs service says
 * so in warning ink; a tank names its next inspection. The counts are the
 * seeded fleet's (`src/db/seed-gear.ts`, 37 units). Left out: the other 33
 * rows, the add form and the service log. Below a 448px panel the chips run
 * off the edge, where the page scrolls them.
 */
export function GearRegisterFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const chip = (label: string, count: number) => t("fallback.gearRegister.chip", { label, count });
  const kinds = [
    chip(t("fallback.gearRegister.bcd"), 6),
    chip(t("fallback.gearRegister.regulator"), 5),
    chip(t("fallback.gearRegister.wetsuit"), 6),
    chip(t("fallback.gearRegister.boots"), 3),
    chip(t("fallback.gearRegister.mask"), 3),
    chip(t("fallback.gearRegister.fins"), 3),
    chip(t("fallback.gearRegister.diveComputer"), 2),
    // i18n-exempt: a camera brand, the same word in every language
    chip("GoPro", 1),
    chip(t("fallback.gearRegister.tank"), 8),
    t("fallback.gearRegister.serviceDue", { count: 2 }),
  ];
  const units = [
    {
      // i18n-exempt: the sample shop's own unit tag and model, used only in marketing mockups
      tag: "BCD #3",
      // i18n-exempt: the sample shop's own unit tag and model, used only in marketing mockups
      descriptor: "Cressi Start · M",
      fact: (
        <span className="text-sm text-muted">
          {/* i18n-exempt: sample diver name used only in marketing mockups */}
          {t("fallback.gearRegister.reservedFor", { name: "Tom Okafor" })}
        </span>
      ),
    },
    {
      // i18n-exempt: the sample shop's own unit tag and model, used only in marketing mockups
      tag: "Reg #4",
      // i18n-exempt: the sample shop's own unit tag and model, used only in marketing mockups
      descriptor: "ScubaPro MK11/C370",
      fact: (
        <span className="text-sm font-medium text-warning-strong">
          {t("fallback.gearRegister.needsService")}
        </span>
      ),
    },
    {
      // i18n-exempt: the sample shop's own unit tag and model, used only in marketing mockups
      tag: "3mm #2",
      // i18n-exempt: the sample shop's own unit tag and model, used only in marketing mockups
      descriptor: "Bare Reactive 3mm · M",
      fact: null,
    },
    {
      // i18n-exempt: the sample shop's own unit tag, used only in marketing mockups
      tag: "AL80-03",
      descriptor: t("fallback.gearRegister.sizeOnly", { size: "AL80" }),
      fact: <span className="text-sm text-muted">{t("fallback.gearRegister.visualDue")}</span>,
    },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.gearRegister.label")} />
      <div className={`@container ${MOCK_BODY}`}>
        {/* Narrower than @md the chips run off the edge, so the row fades
            out there rather than cutting a word in half ("Wetsu"). */}
        <div className="flex gap-2 overflow-hidden mask-r-from-80% @md:flex-wrap @md:mask-none">
          <span className={`${GEAR_CHIP} border-primary bg-primary-tint text-primary`}>
            {t("fallback.gearRegister.all", { count: 37 })}
          </span>
          {kinds.map((kind) => (
            <span key={kind} className={`${GEAR_CHIP} border-border text-muted`}>
              {kind}
            </span>
          ))}
        </div>
        <LedgerGroup
          as="h3"
          label={t("fallback.gearRegister.onWall", { count: 37 })}
          className="mt-4"
        >
          <ul>
            {units.map((unit) => (
              <LedgerRow key={unit.tag} trailing={<DoorChevron />}>
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="min-w-[8ch] font-mono text-sm font-medium">{unit.tag}</span>
                  <span className="min-w-0 text-sm text-muted">{unit.descriptor}</span>
                  {unit.fact}
                </div>
              </LedgerRow>
            ))}
          </ul>
        </LedgerGroup>
      </div>
    </div>
  );
}

/**
 * **A course's public page** — `src/app/s/[shopSlug]/courses/[slug]/_components/CourseSections.tsx`:
 * the hero card (`CourseHero`: the agency's eyebrow, the course name, its
 * summary, the price per diver, and the duration and group size under it),
 * the plan by day (`CourseSessions`, from the Open Water template in
 * `src/content/course-templates.ts`), and the next date to book (`CourseSchedule`).
 * Left out: the cover photo, each day's list of skills, the requirements and
 * the other dates. The day titles take a colon where the template has a dash,
 * and from a 448px panel the hero and the plan stand side by side; the page
 * itself is one column, with the dates further down.
 */
export function CoursePageFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const days = [
    { title: t("fallback.coursePage.day1"), time: t("fallback.coursePage.dayTime") },
    { title: t("fallback.coursePage.day2"), time: t("fallback.coursePage.dayTime") },
    { title: t("fallback.coursePage.day3"), time: t("fallback.coursePage.day3Time") },
  ];
  const facts = [
    {
      term: t("fallback.coursePage.duration"),
      value: t("fallback.coursePage.durationValue"),
    },
    {
      term: t("fallback.coursePage.groupSize"),
      value: t("fallback.coursePage.groupSizeValue"),
    },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.coursePage.label")} />
      <div className={`@container ${MOCK_BODY}`}>
        <div className="grid gap-4 @md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] @md:items-start">
          <div className="overflow-hidden rounded-inset border border-border bg-surface">
            <div className="p-4">
              <p className={EYEBROW_CLASS}>
                {/* i18n-exempt: a training agency's name, the same in every language */}
                {t("fallback.coursePage.eyebrow", { agency: "PADI" })}
              </p>
              {/* i18n-exempt: sample course name used only in marketing mockups */}
              <h3 className={`mt-1 font-brand-display ${SUB_TITLE_CLASS}`}>Open Water Diver</h3>
              <p className="mt-1 text-sm text-muted">{t("fallback.coursePage.summary")}</p>
              <p className={`mt-3 ${FIGURE_CLASS}`}>
                {t("fallback.coursePage.price")}
                <span className="ms-2 text-sm font-normal text-muted">
                  {t("fallback.coursePage.perDiver")}
                </span>
              </p>
            </div>
            <dl className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border bg-surface-sunken/60 px-4 py-3">
              {facts.map((fact) => (
                <div key={fact.term}>
                  <dt className={groupLabelClass()}>{fact.term}</dt>
                  <dd className="mt-0.5 text-xs font-medium">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3 className="text-base font-semibold">{t("fallback.coursePage.howItRuns")}</h3>
            <div className="relative mt-3">
              <span
                aria-hidden="true"
                className="absolute top-1.5 bottom-1.5 start-[5px] w-px bg-border"
              />
              <ol className="space-y-3">
                {days.map((day) => (
                  <li key={day.title} className="relative ps-6">
                    <span
                      aria-hidden="true"
                      className="absolute top-1 start-0 size-[11px] rounded-full border-2 border-primary bg-surface"
                    />
                    <p className="text-sm font-semibold">{day.title}</p>
                    <p className="text-xs text-muted tabular-nums">{day.time}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3 rounded-inset border border-primary/15 bg-primary-tint p-4">
          <div>
            <p className={groupLabelClass("primary")}>{t("fallback.coursePage.nextDate")}</p>
            <p className="mt-1 text-base font-semibold tabular-nums">
              {t("fallback.coursePage.dates")}
            </p>
            <p className="text-xs text-muted">{t("fallback.coursePage.dateMeta")}</p>
          </div>
          <button type="button" disabled className={MOCK_PRIMARY_BUTTON}>
            {t("fallback.coursePage.bookThisDate")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * **One day of orders** — the Orders index under Money
 * (`src/app/shop/[shopSlug]/orders/page.tsx`, `_components/OrdersLedger.tsx`):
 * the page's title and "New order", then today's group with its count and
 * subtotal, and one row per order: the diver, what they bought, a status badge
 * only where the status is the exception (paid says nothing), and the amount.
 * Open is money still owed; the refunds wear warning. Status words and tones
 * are `src/i18n/order-labels.ts`'s. Left out: the filters, earlier days and
 * the pager. Below `sm` each row's facts take their own line under the diver
 * (`LedgerRow`'s `stacked`), where a 290px panel has no room for both; the
 * page keeps them on one line at a phone's full width.
 */
export function OrdersLedgerFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const rows = [
    {
      // i18n-exempt: sample diver name used only in marketing mockups
      diver: "Priya Sharma",
      detail: t("fallback.tripName"),
      status: null,
      amount: t("fallback.ordersLedger.amountReef"),
    },
    {
      // i18n-exempt: sample diver name used only in marketing mockups
      diver: "Tom Okafor",
      detail: t("fallback.ordersLedger.wreckTrip"),
      status: { word: t("fallback.ordersLedger.open"), tone: "primary" as const },
      amount: t("fallback.ordersLedger.amountWreck"),
    },
    {
      // i18n-exempt: sample diver name used only in marketing mockups
      diver: "Keiko Tanaka",
      detail: t("fallback.ordersLedger.counterSale"),
      status: { word: t("fallback.ordersLedger.partlyRefunded"), tone: "warning" as const },
      amount: t("fallback.ordersLedger.amountCounter"),
    },
    {
      // i18n-exempt: sample diver name used only in marketing mockups
      diver: "Diego Alvarez",
      detail: t("fallback.tripName"),
      status: { word: t("fallback.ordersLedger.refunded"), tone: "warning" as const },
      amount: t("fallback.ordersLedger.amountReef"),
    },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.ordersLedger.label")} />
      <div className={`@container ${MOCK_BODY}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className={SUB_TITLE_CLASS}>{t("fallback.ordersLedger.title")}</h3>
          <button type="button" disabled className={MOCK_PRIMARY_BUTTON}>
            {t("fallback.ordersLedger.newOrder")}
          </button>
        </div>
        <LedgerGroup
          as="h3"
          label={t("fallback.ordersLedger.today")}
          meta={t("fallback.ordersLedger.dayMeta")}
          className="mt-4"
        >
          <ul>
            {rows.map((row) => (
              <LedgerRow
                key={row.diver}
                stacked
                trailing={
                  <div className="flex items-center gap-3">
                    {row.status ? (
                      <Badge tone={row.status.tone} size="sm">
                        {row.status.word}
                      </Badge>
                    ) : null}
                    <span className="min-w-16 text-end text-sm font-semibold tabular-nums">
                      {row.amount}
                    </span>
                    <DoorChevron />
                  </div>
                }
              >
                <div className="flex min-w-0 flex-col gap-0.5 @md:flex-row @md:items-baseline @md:gap-4">
                  <span className="truncate text-sm font-medium @md:w-28 @md:shrink-0">
                    {row.diver}
                  </span>
                  <span className="text-xs text-pretty text-muted @md:truncate">{row.detail}</span>
                </div>
              </LedgerRow>
            ))}
          </ul>
        </LedgerGroup>
      </div>
    </div>
  );
}

/** One departure on the week board, as `WeekBoard.tsx`'s row draws it. */
type WeekRow = {
  time: string;
  title: string;
  meta: string;
  /** Printed only when it is not the usual crew; `null` is the usual crew. */
  crew: React.ReactNode | null;
  booked: number;
  capacity: number;
};

/**
 * **The staff week** — Schedule's Week view
 * (`src/app/shop/[shopSlug]/schedule/board/_components/WeekBoard.tsx`, the
 * pager from `src/components/ui/week-pager.tsx`): the week and its seat tally,
 * then the weekend's departures by day, each with its time, title, sites, boat
 * and price, the crew line where the crew is not the usual one ("nobody yet"
 * in warning ink), the seats filled with their bar, the row's menu, and the
 * day's Add. Left out: Monday to Friday, the flags a departure raises when it
 * has no price or an open roll call, and the print button. Below a 448px
 * panel the title drops under the time, as the board does below `md`.
 */
export function ScheduleWeekFallback({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const days: { weekday: string; numeral: number; rows: WeekRow[] }[] = [
    {
      weekday: t("fallback.scheduleWeek.sat"),
      numeral: 10,
      rows: [
        {
          time: t("fallback.scheduleWeek.reefTime"),
          title: t("fallback.tripName"),
          meta: t("fallback.scheduleWeek.reefMeta"),
          crew: null,
          booked: 8,
          capacity: 12,
        },
        {
          time: t("fallback.scheduleWeek.afternoonTime"),
          title: t("fallback.scheduleWeek.afternoonTrip"),
          meta: t("fallback.scheduleWeek.afternoonMeta"),
          crew: (
            <span className="font-medium text-warning">{t("fallback.scheduleWeek.nobodyYet")}</span>
          ),
          booked: 3,
          capacity: 12,
        },
      ],
    },
    {
      weekday: t("fallback.scheduleWeek.sun"),
      numeral: 11,
      rows: [
        {
          time: t("fallback.scheduleWeek.wreckTime"),
          title: t("fallback.scheduleWeek.wreckTrip"),
          meta: t("fallback.scheduleWeek.wreckMeta"),
          crew: null,
          booked: 6,
          capacity: 10,
        },
      ],
    },
  ];
  return (
    <div className="bg-background">
      <AppBar label={t("fallback.scheduleWeek.label")} />
      <div className={`@container ${MOCK_BODY}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-3">
          <div className="flex items-center gap-1">
            <button type="button" disabled className={`w-11 ${MOCK_SECONDARY_BUTTON}`}>
              <DiveDayIcon name="chevron-left" className="size-4" />
              <span className="sr-only">{t("fallback.scheduleWeek.previousWeek")}</span>
            </button>
            <button type="button" disabled className={`w-11 ${MOCK_SECONDARY_BUTTON}`}>
              <DiveDayIcon name="chevron-right" className="size-4" />
              <span className="sr-only">{t("fallback.scheduleWeek.nextWeek")}</span>
            </button>
            <p className="ms-1 text-sm font-semibold tracking-tight whitespace-nowrap tabular-nums">
              {t("fallback.scheduleWeek.range")}
            </p>
          </div>
          <p className="text-xs text-muted tabular-nums">{t("fallback.scheduleWeek.seatTally")}</p>
        </div>
        {days.map((day) => (
          <div key={day.numeral} className="border-b border-border">
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-3 py-1.5">
              <p className="flex min-h-8 items-center gap-1.5 py-1.5">
                <span className={`${groupLabelClass()} w-8 shrink-0`}>{day.weekday}</span>
                <span className={FIGURE_INLINE_CLASS}>{day.numeral}</span>
              </p>
              <div className="min-w-0">
                <ul>
                  {day.rows.map((row) => (
                    <li key={row.time} className="rounded-lg px-2 py-1.5">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-x-3 @md:grid-cols-[4.75rem_minmax(0,1fr)_auto_auto]">
                        <p className="col-start-1 row-start-1 flex min-h-8 items-center text-sm font-semibold whitespace-nowrap tabular-nums">
                          {row.time}
                        </p>
                        <div className="col-span-full row-start-2 min-w-0 @md:col-span-1 @md:col-start-2 @md:row-start-1 @md:pt-1.5">
                          <p className="line-clamp-2 text-sm leading-snug font-semibold">
                            {row.title}
                          </p>
                          <p className="mt-0.5 text-xs text-muted">{row.meta}</p>
                          {row.crew ? (
                            <p className="mt-0.5 text-xs text-muted">
                              {t("fallback.scheduleWeek.crewLabel")} {row.crew}
                            </p>
                          ) : null}
                        </div>
                        <div className="col-start-2 row-start-1 flex min-h-8 items-center gap-2 @md:col-start-3">
                          <ProgressBar
                            aria-hidden="true"
                            className="hidden h-1.5 w-12 shrink-0 @sm:block"
                            segments={[
                              {
                                key: "sold",
                                fraction: row.booked / row.capacity,
                                className: "bg-primary",
                              },
                            ]}
                          />
                          <p className="text-xs whitespace-nowrap text-muted tabular-nums">
                            {t("fallback.scheduleWeek.seats", {
                              booked: row.booked,
                              capacity: row.capacity,
                            })}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled
                          className="col-start-3 row-start-1 -my-1.5 -me-2 inline-flex min-h-11 w-11 items-center justify-center rounded-lg text-xs text-muted @md:col-start-4"
                        >
                          <DiveDayIcon name="more" className="size-4" />
                          <span className="sr-only">{t("fallback.scheduleWeek.rowActions")}</span>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled
                  className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-primary"
                >
                  <span aria-hidden="true">+</span>
                  {t("fallback.scheduleWeek.add")}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
