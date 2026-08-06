import type { StaffTranslator } from "@/i18n/staff-messages";
import type { TripManifest } from "@/lib/manifests";

/**
 * The head-count tiles above the checkpoint nav. Three responsive layouts of
 * the same six numbers, extracted verbatim from the page.
 */
export function SummaryTiles({
  summary,
  notBoardedTileLabel,
  notBoardedTileValue,
  t,
}: {
  summary: TripManifest["summary"];
  /**
   * "Not boarded" is the dock's word; after a dive the same number means "not
   * back aboard" (DOM-H3). The page resolves which one this checkpoint is
   * asking about — the tile only renders it.
   */
  notBoardedTileLabel: string;
  notBoardedTileValue: number;
  t: StaffTranslator;
}) {
  return (
    <section className="mt-7">
      {/*
       * Two key tiles + a `<details>` for the rest below `sm` (task 75,
       * persona 10 Sal): the full six-tile `grid-cols-2` grid used to push
       * the first diver row below the fold on a phone. Boarded/Awaiting are
       * what a captain checks mid-roll-call; Divers/Ready/Blocked/Not
       * boarded are one tap away instead of gone.
       */}
      <div className="grid grid-cols-2 gap-3 sm:hidden">
        {[
          [t("trips.manifest.summaryBoarded"), summary.boarded],
          [t("trips.manifest.summaryAwaiting"), summary.awaiting],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <details className="mt-3 sm:hidden">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-primary">
          {t("trips.manifest.moreStatsSummary")}
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {[
            [t("trips.manifest.summaryDivers"), summary.totalDivers],
            [t("trips.manifest.summaryReady"), summary.ready],
            [t("trips.manifest.summaryBlocked"), summary.blocked],
            [notBoardedTileLabel, notBoardedTileValue],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-lg border border-border bg-surface px-4 py-3"
            >
              <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      </details>
      <div className="hidden gap-3 sm:grid sm:grid-cols-3 lg:grid-cols-6">
        {[
          [t("trips.manifest.summaryDivers"), summary.totalDivers],
          [t("trips.manifest.summaryReady"), summary.ready],
          [t("trips.manifest.summaryBlocked"), summary.blocked],
          [t("trips.manifest.summaryBoarded"), summary.boarded],
          [notBoardedTileLabel, notBoardedTileValue],
          [t("trips.manifest.summaryAwaiting"), summary.awaiting],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-border bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
