import type { IncidentTimelineEntry } from "@/lib/incident-export";

/** A diver's or crew member's roll-call mark, the only kind a checkpoint group holds. */
export type RollCallTimelineEntry = Extract<IncidentTimelineEntry, { kind: "diver" | "crew" }>;

/**
 * One line under a checkpoint heading. `ownStamp` and `ownRecorder` are set
 * only where the line differs from its heading, so a mark recorded by somebody
 * else, or at another minute, still says who and when on its own line.
 */
export type TimelineGroupLine = {
  /** Where the entry sits in the timeline as read: a stable key, never a reorder. */
  order: number;
  entry: RollCallTimelineEntry;
  ownStamp: string | null;
  ownRecorder: string | null;
};

export type TimelineGroup =
  | {
      kind: "checkpoint";
      order: number;
      checkpoint: string;
      /** The first mark's stamp: when this run of marks began. */
      stamp: string;
      /** The recorder who made most of the run's marks; the earliest wins a tie. */
      recordedByName: string;
      lines: TimelineGroupLine[];
    }
  | { kind: "single"; order: number; entry: IncidentTimelineEntry; stamp: string };

function isRollCall(entry: IncidentTimelineEntry): entry is RollCallTimelineEntry {
  return entry.kind === "diver" || entry.kind === "crew";
}

/** The name heard most often in a run, the earliest of equals. */
function mostFrequentRecorder(entries: readonly RollCallTimelineEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.recordedByName, (counts.get(entry.recordedByName) ?? 0) + 1);
  }
  let best = entries[0]?.recordedByName ?? "";
  for (const entry of entries) {
    if ((counts.get(entry.recordedByName) ?? 0) > (counts.get(best) ?? 0)) {
      best = entry.recordedByName;
    }
  }
  return best;
}

/**
 * **The roll-call timeline, grouped for reading and nothing else** (visual
 * review 2026-10-24, B05). The data is the append-only list it always was;
 * this only decides where a heading goes.
 *
 * A group is a run of consecutive roll-call marks at one checkpoint, in the
 * order they were recorded. Order is never changed: a mark at the dock made
 * after a dive-1 mark starts a new dock group further down, an undo or a
 * re-mark is its own line where it happened, and every other kind of entry
 * (a buddy team, a seat change) stands alone between groups exactly where it
 * fell. A checkpoint with no marks has no group: nothing is invented.
 *
 * `stamp` is the caller's formatting of a time at the precision the page
 * prints, so "the same time as the heading" means "prints the same".
 */
export function groupTimeline(
  entries: readonly IncidentTimelineEntry[],
  stamp: (occurredAt: string) => string,
): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  let run: { order: number; entry: RollCallTimelineEntry }[] = [];
  const closeRun = () => {
    if (run.length === 0) return;
    const headingStamp = stamp(run[0].entry.occurredAt);
    const recordedByName = mostFrequentRecorder(run.map(({ entry }) => entry));
    groups.push({
      kind: "checkpoint",
      order: run[0].order,
      checkpoint: run[0].entry.checkpoint,
      stamp: headingStamp,
      recordedByName,
      lines: run.map(({ order, entry }) => {
        const own = stamp(entry.occurredAt);
        return {
          order,
          entry,
          ownStamp: own === headingStamp ? null : own,
          ownRecorder: entry.recordedByName === recordedByName ? null : entry.recordedByName,
        };
      }),
    });
    run = [];
  };
  entries.forEach((entry, order) => {
    if (isRollCall(entry)) {
      if (run.length > 0 && run[0].entry.checkpoint !== entry.checkpoint) closeRun();
      run.push({ order, entry });
      return;
    }
    closeRun();
    groups.push({ kind: "single", order, entry, stamp: stamp(entry.occurredAt) });
  });
  closeRun();
  return groups;
}

/** Every entry the groups hold, in order: the test that grouping dropped nothing. */
export function entriesOf(groups: readonly TimelineGroup[]): IncidentTimelineEntry[] {
  return groups.flatMap((group) =>
    group.kind === "single" ? [group.entry] : group.lines.map((line) => line.entry),
  );
}
