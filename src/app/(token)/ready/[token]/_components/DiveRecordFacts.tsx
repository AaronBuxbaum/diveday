import type { AfterStateProps } from "@/features/recap-after-state";
import { fieldGuideCards } from "@/i18n/marine-life-labels";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { depthText, temperatureText } from "@/i18n/unit-labels";
import { AFTER_STATE_TEST_IDS } from "./after-state-test-ids";

/**
 * **What the shop wrote down about the day** — the dive record's facts, one
 * list for the card on screen and for its sheet on paper (issue #2745), so the
 * paper can never say something the screen does not.
 *
 * `paper` drops the one row that is the keepsake's and not the logbook's: what
 * the crew saw (see the row). Everything else is the same row on both faces;
 * the rules for what a row may claim are `DiveRecord`'s.
 */
export function RecordFacts({
  t,
  shop,
  trip,
  when,
  diverName,
  sites,
  diveRecord,
  observedSpecies,
  course,
  paper = false,
}: Pick<
  AfterStateProps,
  "t" | "shop" | "when" | "diverName" | "sites" | "diveRecord" | "observedSpecies" | "course"
> & {
  trip: AfterStateProps["trip"];
  /** The logbook sheet's list: no sighting, ruled top and bottom. */
  paper?: boolean;
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

  return (
    <dl
      className={
        paper ? "divide-y divide-border border-y border-border" : "mt-5 divide-y divide-border"
      }
    >
      <Fact label={t("recap.diverLabel")}>{diverName}</Fact>
      {/* **The peak of a course, where the diver keeps it** (fourth review,
          item 55). Only from the card this shop issued from this session
          and marked verified (`src/features/recap/store.ts`, the same guard
          `CourseAfterState` keeps), so the logbook sheet carries it too:
          it is something the shop wrote down, not something inferred. */}
      {course?.certification ? (
        <Fact label={t("recap.certifiedLabel")} testId={AFTER_STATE_TEST_IDS.certified}>
          <span className="font-semibold text-primary">
            {t(DIVER_CERTIFICATION_LEVEL_KEYS[course.certification.level])}
          </span>
        </Fact>
      ) : null}
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
        <Fact
          label={t(paper ? "recap.printSitesOnTheDay" : "recap.sitesLabel")}
          testId={AFTER_STATE_TEST_IDS.sites}
        >
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

          **Never on the sheet, unlike every other row here.** The sheet
          is hand-ruled and countersigned into a paper logbook, and
          `observedSpecies` is scoped to the *trip* — a diver who sat out
          the second tank with an ear squeeze would carry that tank's manta
          onto a page a divemaster signs. The sites line above has the same
          trip scope and stays, because an itinerary is a property of the
          day; a sighting is a property of one dive by one group. On screen
          it is the keepsake's line and belongs there
          (dive-domain review, 2026-09-04). */}
      {!paper && seenNames.length > 0 ? (
        <Fact label={t("recap.seenOnTheDay")} testId={AFTER_STATE_TEST_IDS.seen}>
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
  );
}

/** One recorded fact of the day: its name, and what was recorded. */
function Fact({
  label,
  testId,
  children,
}: {
  label: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4"
    >
      <dt className="text-xs font-medium text-muted sm:w-28 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1 text-base">{children}</dd>
    </div>
  );
}
