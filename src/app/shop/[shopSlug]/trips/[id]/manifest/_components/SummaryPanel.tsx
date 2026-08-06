import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { RollCallCheckpoint, TripManifest } from "@/lib/manifests";

/**
 * The sticky progress panel: which checkpoint is live, how much of it is
 * recorded, the counts behind that fraction, and the one line that says
 * whether it is closed.
 *
 * This is the page's **only** count surface. It used to share the job with a
 * six-tile grid above the checkpoint nav (three responsive layouts of the same
 * numbers) and a standalone "Blocked divers" banner below it, which put three
 * restatements of one head count between the captain and the first diver row.
 * The tiles are gone and the blocked banner is the quiet sentence below.
 */
export function SummaryPanel({
  checkpoint,
  isDeparture,
  rollCallComplete,
  completeness,
  summary,
  separatedTeams,
  t,
}: {
  checkpoint: RollCallCheckpoint;
  /**
   * "Not boarded" is the dock's word for *never left*; after a dive the same
   * number means "not back aboard" (DOM-H3, `isNotBackAboard` in
   * src/lib/manifests.ts). The page resolves which checkpoint this is — the
   * count row and the blocked sentence both follow it, so no surface can put a
   * dock word beside a diver who is unaccounted for in the water.
   */
  isDeparture: boolean;
  rollCallComplete: boolean;
  completeness: TripManifest["completeness"];
  summary: TripManifest["summary"];
  /**
   * A count of split *teams*, not of rows wearing an alert (`splitBuddyTeamIds`,
   * src/lib/manifests.ts) — the page derives it, this only says it.
   */
  separatedTeams: number;
  t: StaffTranslator;
}) {
  // Who among the named crew is still unaccounted for at this checkpoint. Read
  // off the completeness verdict itself rather than recomputed, so this page
  // and the rule that closes the checkpoint can never disagree.
  const crewCounts = completeness.crewCounts;
  // The head count, in words and figures. Every entry is a label plus a
  // number — never a colour-coded chip a captain has to decode in sunlight
  // (phone/sunlight invariant), and `tabular-nums` so the figures hold their
  // columns as they tick.
  const counts: Array<{ label: string; value: number }> = [
    { label: t("trips.manifest.summaryBoarded"), value: summary.boarded },
    {
      label: isDeparture
        ? t("trips.manifest.summaryNotBoarded")
        : t("trips.manifest.summaryNotBackAboard"),
      value: isDeparture ? summary.notBoarded : summary.notBackAboard,
    },
    { label: t("trips.manifest.summaryAwaiting"), value: summary.awaiting },
    { label: t("trips.manifest.summaryBlocked"), value: summary.blocked },
  ];
  return (
    <section
      aria-labelledby="roll-call-progress-heading"
      className={
        rollCallComplete
          ? "rise-in sticky top-20 z-10 mt-4 rounded-2xl border border-accent/50 bg-accent/10 p-4 shadow-lg backdrop-blur print:hidden"
          : "sticky top-20 z-10 mt-4 rounded-2xl border border-primary/30 bg-surface/95 p-4 shadow-lg backdrop-blur print:hidden"
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">
            {t("trips.manifest.activeCheckpoint")}
          </p>
          <h2 id="roll-call-progress-heading" className="mt-1 text-lg font-bold">
            {rollCallComplete
              ? t("trips.manifest.rollCallComplete")
              : rollCallCheckpointText(t, checkpoint)}
          </h2>
        </div>
        <p className="text-base font-bold tabular-nums">
          {t("trips.manifest.recordedOfTotal", {
            recorded: summary.totalDivers - summary.awaiting,
            total: summary.totalDivers,
          })}
        </p>
      </div>
      <div
        className="mt-3 h-3 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-label={t("trips.manifest.progressAriaLabel")}
        aria-valuemin={0}
        aria-valuemax={summary.totalDivers}
        aria-valuenow={summary.totalDivers - summary.awaiting}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200"
          style={{
            width: `${
              summary.totalDivers === 0
                ? 0
                : ((summary.totalDivers - summary.awaiting) / summary.totalDivers) * 100
            }%`,
          }}
        />
      </div>
      {/* The counts the six tiles used to carry, folded in under the bar they
          explain. A definition list, not a grid of cards: four label/number
          pairs read in one pass and cost the roll-call list no vertical space
          on a phone. */}
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {counts.map((count) => (
          <div key={count.label} className="flex items-baseline gap-1.5">
            <dt className="text-muted">{count.label}</dt>
            <dd className="font-bold tabular-nums">{count.value}</dd>
          </div>
        ))}
      </dl>
      {/* The one line that says whether this checkpoint is closed. It used to
          go quiet at `awaiting === 0` — every diver counted, nothing said
          about the crew. Now it names what is still open. */}
      <p
        className={
          completeness.reason === "divers_not_back_aboard" ||
          completeness.reason === "crew_not_back_aboard"
            ? "mt-2 text-sm font-bold text-danger"
            : "mt-2 text-sm font-semibold text-muted"
        }
        aria-live="polite"
      >
        {completeness.reason === "divers_not_back_aboard"
          ? t("trips.manifest.notBackAboardOpen", { count: summary.notBackAboard })
          : completeness.reason === "divers_awaiting"
            ? t("trips.manifest.stillToCall", { count: summary.awaiting })
            : completeness.reason === "crew_not_back_aboard"
              ? t("trips.manifest.crewNotBackAboard", { count: crewCounts.crewNotBackAboard })
              : completeness.reason === "crew_none_assigned"
                ? t("trips.manifest.crewNoneAssignedYet")
                : completeness.reason === "crew_none_aboard"
                  ? t("trips.manifest.crewNoneAboard")
                  : completeness.reason === "crew_awaiting"
                    ? t("trips.manifest.crewAwaiting", { count: crewCounts.crewAwaiting })
                    : t("trips.manifest.allAccountedFor")}
      </p>
      {/* What being blocked means at *this* checkpoint. This was a warning-
          toned banner of its own under the panel, with a "Blocked divers"
          heading restating the count the panel already showed. The count is
          in the row above; what the banner actually added was this sentence,
          so that is all that is left of it. It says the state in words, not
          only in tone. */}
      {summary.blocked > 0 ? (
        <p className="mt-1 text-sm font-semibold text-warning">
          {isDeparture
            ? t("trips.manifest.blockedDeparture", { count: summary.blocked })
            : t("trips.manifest.blockedAfterDive", { count: summary.blocked })}
        </p>
      ) : null}
      {/* Buddy teams that came back split — someone aboard, someone not
          (ADR 20260804-buddy-teams). Its own line, never folded into the
          completeness reason above: it informs the deck and blocks
          nothing, and the checkpoint's own open/closed verdict must not
          appear to depend on it. */}
      {separatedTeams > 0 ? (
        <p className="mt-1 text-sm font-bold text-danger" role="status">
          {t("trips.manifest.buddySeparatedLine", { count: separatedTeams })}
        </p>
      ) : null}
    </section>
  );
}
