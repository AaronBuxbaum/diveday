import Link from "next/link";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { rollCallCheckpointShortText, rollCallCheckpointText } from "@/i18n/manifest-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type CheckpointGap, previousCheckpointGaps } from "@/lib/checkpoint-gaps";
import {
  type RollCallCheckpoint,
  rollCallCheckpointOrdinal,
  type TripManifest,
} from "@/lib/manifests";
import { CheckpointGapGuard, type CheckpointGapPrompt } from "./CheckpointGapGuard";

function checkpointHref(shopSlug: string, tripId: string, checkpoint: RollCallCheckpoint): string {
  return `/shop/${shopSlug}/trips/${tripId}/manifest?checkpoint=${checkpoint}`;
}

/** "2 people not marked after dive 1." — the guard's line and the opened page's. */
export function checkpointGapLine(t: StaffTranslator, gap: CheckpointGap): string {
  return t("manifest.checkpointGap.line", {
    count: gap.unaccounted,
    dive: rollCallCheckpointOrdinal(gap.checkpoint),
  });
}

/**
 * The checkpoint switch: departure, then one stop after each planned dive.
 *
 * **A checkpoint whose predecessor is still open asks before it opens**
 * (batch 6, item 3; `previousCheckpointGaps`, src/lib/checkpoint-gaps.ts).
 * Never a refusal: the tap is caught by `CheckpointGapGuard`, which says who
 * is still unmarked and offers both ways on. And the checkpoint once open says
 * the same line under the switch, in the server's words, so the warning holds
 * before JavaScript and after "Open anyway".
 */
export function CheckpointSwitch({
  manifests,
  checkpoint,
  shopSlug,
  tripId,
  t,
}: {
  /** The departure's manifests, dock first: one segment each, and their gaps. */
  manifests: readonly Pick<TripManifest, "checkpoint" | "summary" | "completeness">[];
  checkpoint: RollCallCheckpoint;
  shopSlug: string;
  tripId: string;
  t: StaffTranslator;
}) {
  const checkpoints = manifests.map((manifest) => manifest.checkpoint);
  // Keyed by the checkpoint being opened: the gap at the one before it.
  const gaps = previousCheckpointGaps(manifests);
  const prompts: CheckpointGapPrompt[] = checkpoints.flatMap((value) => {
    const gap = gaps.get(value);
    if (!gap) return [];
    return [
      {
        key: value,
        href: checkpointHref(shopSlug, tripId, value),
        line: checkpointGapLine(t, gap),
        openAnyway: t("manifest.checkpointGap.openAnyway"),
        back: t("manifest.checkpointGap.back", {
          dive: rollCallCheckpointOrdinal(gap.checkpoint),
        }),
        backKey: gap.checkpoint,
        backHref: checkpointHref(shopSlug, tripId, gap.checkpoint),
      },
    ];
  });
  const openedGap = gaps.get(checkpoint);
  return (
    <>
      <CheckpointGapGuard prompts={prompts} current={checkpoint}>
        {/* A segmented control, not a row of buttons: the active checkpoint used
          to wear the same filled-primary costume as "Mark boarded", which gave
          the page a second primary that was not an action at all (principle
          8). The same shared track the grouping switches use (`SegmentedControl`),
          at boat size because this row is switched at the rail. */}
        <SegmentedControl
          ariaLabel={t("manifest.checkpointNavAriaLabel")}
          items={checkpoints.map((value) => ({
            key: value,
            label: rollCallCheckpointText(t, value),
            // Below `sm` the full names overran a 390px track and the row read as
            // two — the one segmented control in the app that did (issue #1320).
            // This is the call site that earns the short form, and what makes it
            // a handle rather than a rename is `DiverRollCall`'s heading
            // underneath: the condition is spelled out over
            // `rollCallCheckpointShortText`.
            shortLabel: rollCallCheckpointShortText(t, value),
            href: checkpointHref(shopSlug, tripId, value),
          }))}
          currentKey={checkpoint}
          size="boat"
          currentIsLink
          ariaCurrentValue="true"
          scroll={false}
          className="mt-7"
        />
      </CheckpointGapGuard>
      {/* The checkpoint before this one is still open: said here, by the
          server, on the checkpoint it leads to. */}
      {openedGap ? (
        <p className="mt-3 text-base font-bold text-danger print:hidden">
          {checkpointGapLine(t, openedGap)}{" "}
          <Link
            href={checkpointHref(shopSlug, tripId, openedGap.checkpoint)}
            scroll={false}
            className="underline underline-offset-2"
          >
            {t("manifest.checkpointGap.back", {
              dive: rollCallCheckpointOrdinal(openedGap.checkpoint),
            })}
          </Link>
        </p>
      ) : null}
    </>
  );
}
