import { SiteMark } from "@/components/illustration/SiteMark";
import { SUB_TITLE_CLASS } from "@/components/ui/typography";
import type { AfterStateProps } from "@/features/recap-after-state";
import { fieldGuideCards } from "@/i18n/marine-life-labels";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { depthText, temperatureText } from "@/i18n/unit-labels";
import { formatOrdinal } from "@/lib/format";
import { visitMilestone } from "@/lib/visit-milestones";
import { AFTER_STATE_TEST_IDS } from "./after-state-test-ids";
import { PrintRecordButton } from "./PrintRecordButton";
import { SavePostcard } from "./SavePostcard";

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
export function DiveRecord({
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
  course,
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
  | "course"
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
          drawing and the heading stands alone at the top of the sheet.

          It wraps: on a phone the 120px mark and the stamp left the heading
          101px of the 140 "Dive log entry" needs, and one word broke onto a
          line of its own (K-596). The stamp drops under the mark instead. */}
      <div
        data-testid={AFTER_STATE_TEST_IDS.face}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 bg-primary-tint px-5 py-4 sm:px-6 print:bg-transparent print:px-0 print:py-0"
      >
        <div className="flex min-w-0 items-center gap-4">
          {/* `data-postcard-mark` is `SavePostcard`'s reach into the live DOM:
              the export borrows this drawing rather than keeping a second copy
              of the illustration hand (issue #1081). */}
          <span data-postcard-mark className="contents">
            <SiteMark mark={siteMark} size="lg" ground="surface" className="print:hidden" />
          </span>
          <h2 id="dive-record-heading" className={`font-brand-display ${SUB_TITLE_CLASS}`}>
            {t("recap.logbookHeading")}
          </h2>
        </div>
        {stampText ? (
          <MilestoneStamp label={stampText} />
        ) : (
          // **A number, not a sentence** (H-20260904-reef-go-all-way c). It said "Your 3rd dive day
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
        {/* The top rule is paper's only: on screen the band's wash is this
            list's top edge, and a hairline 20px under it drew it twice
            (K-595); in print the band goes transparent. */}
        <dl className="mt-5 divide-y divide-border print:border-t print:border-border">
          <Fact label={t("recap.diverLabel")}>{diverName}</Fact>
          {/* **The peak of a course, where the diver keeps it** (fourth review,
              item 55). Only from the card this shop issued from this session
              and marked verified (`src/db/recap.ts`, the same guard
              `CourseAfterState` keeps), so it prints on the logbook page too:
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
