import Link from "next/link";
import { BOAT_SEGMENT_TRACK_CLASS, boatSegmentClass } from "@/components/boat-segments";
import { checkpointGapLine } from "@/components/checkpoint-gap-words";
import { rollCallCheckpointShortText, rollCallCheckpointText } from "@/i18n/manifest-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { previousCheckpointGaps } from "@/lib/checkpoint-gaps";
import {
  type RollCallCheckpoint,
  rollCallCheckpointOrdinal,
  type TripManifest,
} from "@/lib/manifests";
import { CheckpointGapGuard, type CheckpointGapPrompt } from "./CheckpointGapGuard";

function checkpointHref(shopSlug: string, tripId: string, checkpoint: RollCallCheckpoint): string {
  return `/shop/${shopSlug}/trips/${tripId}/manifest?checkpoint=${checkpoint}`;
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
  manifests: readonly Pick<TripManifest, "checkpoint" | "summary" | "crew">[];
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
        {/* The boat's one segmented control (`boat-segments.ts`, visual review
          2026-10-24, B06): the stage strip above wears the identical track,
          segment and selected fill, so the two selectors at the rail read as
          one idiom. Below `sm` each segment shows its short word, a handle
          rather than a rename: `DiverRollCall`'s heading underneath spells the
          condition out, and the full name stays the link's accessible name.
          `data-key` is what `CheckpointGapGuard` catches. */}
        <nav
          aria-label={t("manifest.checkpointNavAriaLabel")}
          className={`mt-7 ${BOAT_SEGMENT_TRACK_CLASS}`}
        >
          {checkpoints.map((value) => {
            const current = value === checkpoint;
            return (
              <Link
                key={value}
                href={checkpointHref(shopSlug, tripId, value)}
                data-key={value}
                scroll={false}
                aria-current={current ? "true" : undefined}
                className={boatSegmentClass(current)}
              >
                <span aria-hidden="true" className="sm:hidden">
                  {rollCallCheckpointShortText(t, value)}
                </span>
                <span className="max-sm:sr-only">{rollCallCheckpointText(t, value)}</span>
              </Link>
            );
          })}
        </nav>
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
