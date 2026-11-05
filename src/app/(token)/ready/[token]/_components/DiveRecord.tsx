import { SiteMark } from "@/components/illustration/SiteMark";
import { buttonClass } from "@/components/ui/button";
import { SUB_TITLE_CLASS } from "@/components/ui/typography";
import type { AfterStateProps } from "@/features/recap-after-state";
import { formatOrdinal } from "@/lib/format";
import { visitMilestone } from "@/lib/visit-milestones";
import { AFTER_STATE_TEST_IDS } from "./after-state-test-ids";
import { RecordFacts } from "./DiveRecordFacts";
import { PrintRecordButton } from "./PrintRecordButton";
import { SavePostcard } from "./SavePostcard";

/**
 * **The dive record** — the one place the day's facts render on screen. What
 * prints is its sheet (`DiveRecordSheet`), never this card.
 *
 * Every line is conditional on having actually been recorded: `trip_dives` may
 * be empty, a self-guided departure has no crew, a shore dive has no boat, and
 * the shipped recap already conditionalized conditions. What always renders is
 * the floor a logbook page needs — the shop, the trip, the date, the diver,
 * and how many dive days this makes.
 *
 * **It prints what the shop wrote down, and nothing else.** A review caught
 * this printing three things nobody observed (2026-08-28), which matters more
 * here than anywhere else on the surface: its sheet gives the same facts
 * (`RecordFacts`) a ruled Notes block and a signature rule, so what leaves
 * the printer is a logbook page a divemaster is being asked to
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
 * the sheet does not carry it: what leaves the printer is the logbook page, and
 * a brain coral on a sheet a divemaster signs is the one place the hand may not
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
  logFilePath = null,
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
  /** Where the log entry's CSV and UDDF files are served from; null off the recap page. */
  logFilePath?: string | null;
}) {
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
      // Flat at rest, like every other panel (Clearwater decision 1).
      className="mt-8 overflow-hidden rounded-panel border border-border bg-surface shadow-bed"
    >
      {/* The postcard's face: the site, drawn, and the heading in the shop's
          face on the lagoon wash. The band is the wash, so the tile takes the
          shell to keep its edge.

          It wraps: on a phone the 120px mark and the stamp left the heading
          101px of the 140 "Dive log entry" needs, and one word broke onto a
          line of its own (K-596). The stamp drops under the mark instead. */}
      <div
        data-testid={AFTER_STATE_TEST_IDS.face}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 bg-primary-tint px-5 py-4 sm:px-6"
      >
        <div className="flex min-w-0 items-center gap-4">
          {/* `data-postcard-mark` is `SavePostcard`'s reach into the live DOM:
              the export borrows this drawing rather than keeping a second copy
              of the illustration hand (issue #1081). */}
          <span data-postcard-mark className="contents">
            <SiteMark mark={siteMark} size="lg" ground="surface" />
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

      <div className="p-5 pt-0 sm:p-6 sm:pt-0">
        <RecordFacts
          t={t}
          shop={shop}
          trip={trip}
          when={when}
          diverName={diverName}
          sites={sites}
          diveRecord={diveRecord}
          observedSpecies={observedSpecies}
          course={course}
        />
        <SavePostcard
          postcard={postcard}
          fileName={`${t("recap.postcardFileName")}.png`}
          copy={{
            lineLabel: t("recap.privateLineLabel"),
            lineHint: t("recap.privateLineHint"),
            linePlaceholder: t("recap.privateLinePlaceholder"),
            save: t("recap.saveAsImage"),
            saving: t("words.busy.saving"),
            failed: t("recap.saveImageFailed"),
          }}
          // Whose record it is, which is all this card may claim of itself.
          recordedBy={
            <p className="text-xs text-muted">{t("recap.recordedBy", { shopName: shop.name })}</p>
          }
        >
          <PrintRecordButton label={t("recap.printRecord")} />
          {/* **The entry as a file** (loop 5, row 13): the same recorded facts,
              for the logbook app a diver already keeps. Plain links to a route
              that answers with an attachment, so they work with no script. */}
          {logFilePath ? (
            <>
              <a
                href={`${logFilePath}?format=csv`}
                download
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("recap.downloadCsv")}
              </a>
              <a
                href={`${logFilePath}?format=uddf`}
                download
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("recap.downloadUddf")}
              </a>
            </>
          ) : null}
        </SavePostcard>
      </div>
    </section>
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
