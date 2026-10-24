import { DecompressionReminder } from "@/components/DecompressionReminder";
import { StatusMark } from "@/components/ui/StatusMark";
import { FIGURE_CLASS, SUB_TITLE_CLASS } from "@/components/ui/typography";
import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import { crewDives, needsDecompressionCardReminder } from "@/lib/decompression-reminder";
import { countParticipants, hasNonDivers, joinPassengerSplit } from "@/lib/participant-types";
import { OfflineCrewRollCall } from "./CrewRollCall";
import type { OfflineTripControls } from "./controls";
import { OfflineDiverRollCall } from "./DiverRollCall";
import type { OfflineTripView } from "./trip-view";

/** The head count: the three tiles, who the passengers are, and the roll call itself. */
export function OfflineRollCallSection({
  view,
  controls,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const { manifest, checkpoint, boarded, awaiting, rollCallComplete, anyBuddies, totalDivers } =
    view;
  const { t, locale } = controls;
  // The people this copy counts: a seat the desk turned away is off the boat (#2907).
  const passengerTypes = countParticipants(
    manifest.divers.filter((_diver, index) => !view.offBoat[index]),
  );
  // A copy saved before the flag rode along has none, and says nothing.
  const showsDecompressionReminder =
    checkpoint === "departure" &&
    needsDecompressionCardReminder({
      exceedsNoDecoLimits: manifest.trip.exceedsNoDecoLimits,
      seats: manifest.divers.map((diver) => ({
        participantType: diver.participantType,
        released: Boolean(diver.notHere),
      })),
      divingCrew: crewDives(manifest.crew),
    });
  return (
    <>
      {/* One look, complete or not: no coral on a roll call (ADR
            20260901-diveday-reimagined's coral table), offline exactly as on
            the live panel — a crew that loses signal between two dives must not
            see two different completions for one fact. The heading below says
            it in words. */}
      {/* **The label fits its tile, or wraps inside it; it never spills
            into the next.** Uppercase, "EMBARCADOS" needed 86px where a `p-3`
            tile leaves 75 at 360. Narrowing the tiles' inset
            below `sm` fixed only the 360 case and left every phone's tiles
            reading cramped, 7px from their borders beside panels inset 16-20.
            In sentence case the words fit a `p-3` tile at 14px (`text-sm`: the
            counts are safety reading, never 12px muted), and anything longer
            hyphenates in the page's language (`lang`) or, where the browser
            has no dictionary, breaks inside the tile. The gap stays 8px
            below `sm`: three tiles on a phone. */}
      <section className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
        {[
          [t("shared.offlineManifest.single.statsDivers"), totalDivers],
          [t("shared.offlineManifest.single.statsBoarded"), boarded],
          [t("shared.offlineManifest.single.statsAwaiting"), awaiting],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-border bg-surface p-3">
            <p
              lang={locale}
              className="text-sm font-semibold text-muted hyphens-auto wrap-break-word"
            >
              {label}
            </p>
            <p className={`mt-1 ${FIGURE_CLASS}`}>{value}</p>
          </div>
        ))}
      </section>
      {view.overTotalPersons ? (
        <p
          className="mt-3 rounded-inset border border-danger bg-danger-tint px-4 py-3 text-base font-bold text-danger sm:px-5"
          role="status"
        >
          {t("manifest.headCountOverTotalPersonsAboard", view.overTotalPersons)}
        </p>
      ) : null}
      {/* Who the passengers are, when they are not all divers (ADR
            20261007-participant-types): read from the saved rows themselves,
            so a copy saved before the summary carried the split still says it. */}
      {hasNonDivers(passengerTypes) ? (
        <p className="mt-2 text-sm text-muted tabular-nums">
          {joinPassengerSplit(passengerTypes, (type, count) =>
            type === "diver"
              ? t("manifest.passengerDivers", { count })
              : type === "snorkeler"
                ? t("manifest.passengerSnorkelers", { count })
                : t("manifest.passengerRiders", { count }),
          )}
        </p>
      ) : null}

      <section className="mt-8">
        <h2 className={`flex items-center gap-2 ${SUB_TITLE_CLASS}`}>
          {rollCallComplete ? <StatusMark variant="success" size="md" /> : null}
          <span>
            {rollCallComplete
              ? t("shared.offlineManifest.single.rollCallCompleteHeading")
              : t("shared.offlineManifest.single.checkpointRollCallHeading", {
                  checkpoint: rollCallCheckpointText(t, checkpoint),
                })}
          </span>
        </h2>
        {/* **This copy may be missing someone** (issue #2980, option (a),
            decided 2026-10-24). The worker chose it because DiveDay was
            silent, so a walk-up seated after the save has no row below and
            nothing here can count them. The line names the save time and asks
            for a head count against the live list, ahead of the first row.
            No count field and no live rows merged in. */}
        {controls.servedWithoutAnswer ? (
          <p className="mt-1 text-sm font-semibold text-pretty text-warning-strong">
            {t("shared.offlineManifest.single.unansweredCountHeads", {
              when: view.dateTime.format(new Date(view.envelope.snapshot.savedAt)),
            })}
          </p>
        ) : null}
        {showsDecompressionReminder ? (
          <DecompressionReminder text={t("manifest.decompressionReminder")} />
        ) : null}
        {rollCallComplete ? (
          <p className="mt-1 text-sm font-semibold text-muted" role="status" aria-live="polite">
            {boarded === totalDivers
              ? t("shared.offlineManifest.single.allAboard")
              : t("shared.offlineManifest.single.someNotBoarded", {
                  count: totalDivers - boarded,
                })}
          </p>
        ) : null}
        {/*
         * The crew half of the head count — **recordable here**, since H-46.
         * Divers could always be counted with the radio off and crew could
         * not, which meant an after-dive checkpoint could never be closed at
         * sea: `rollCallCompleteness` needs both halves, and the after-dive
         * checkpoint is the one where a person may still be in the water.
         *
         * The only copy that still cannot record it is one saved before crew
         * ids rode along, whose crew have no subject to write an event
         * against. That says so in as many words below, and stays fail-closed
         * either way: the checkpoint reads open here exactly as it does
         * online, never the reverse.
         */}
        {/* **A panel's inset for the words, and the roster flush.** The box
            pads its heading and status like every panel in this column
            (`p-4 sm:p-5`), and its roster is the diver roll call's own ruled
            list laid edge to edge inside it, the shape the live crew list
            already has (`CrewRollCall`). The rows were `px-3` cards inside a
            `p-3` box, so their controls ended 5–9px inside the diver controls
            below them. `overflow-hidden` rounds the last row's fill into the
            box's corner; every control in a row sits a whole padding clear of
            that edge, so no focus ring reaches it. A `section` named by its
            heading, as the counter's is.

            **No inset ring on the missing box.** An inset ring paints under
            the box's children, and the flush roster covers it, so it ringed
            the heading and stopped where the list began. The ring belongs to
            the missing person's own row (`ROLL_CALL_ROW_TONE.notBackAboard`),
            as on every roll-call row; the box keeps its danger border, fill
            and heading.

            **A surface box while crew are still being called**, as the live
            crew list sits in a surface card. The rows wear the roll call's
            awaiting tone, a sunken fill, and on a sunken box an uncalled crew
            member matched the ground behind them, marked only by a grey rule
            and hairlines: the row a captain is looking for, read at the rail
            in sun, with the weakest fill on the page. The dock copy's earlier
            crew cards kept "awaiting" raised for that reason (dive-domain
            review, 20260804); the contrast is kept here the other way round.
            The settled and missing boxes keep their success and danger
            fills. */}
        <OfflineCrewRollCall view={view} controls={controls} />
        {/* Buddy teams are display-only on the dock copy, and the split-team
            read ("someone back, someone not") belongs to the live roll call
            alone — a snapshot cannot know who came back (ADR
            20260804-buddy-teams). Stated the same neutral way as the crew
            limitation above: a limitation of this copy, not an alarm. */}
        {anyBuddies ? (
          <p className="mt-3 text-sm font-semibold text-pretty text-muted">
            {t("shared.offlineManifest.single.buddyReadOnlyHere")}
          </p>
        ) : null}
        <OfflineDiverRollCall view={view} controls={controls} />
      </section>
    </>
  );
}
