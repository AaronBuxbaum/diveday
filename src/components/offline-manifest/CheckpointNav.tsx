"use client";

import { useEffect, useRef, useState } from "react";
import { BOAT_SEGMENT_TRACK_CLASS, boatSegmentClass } from "@/components/boat-segments";
import { checkpointGapLine } from "@/components/checkpoint-gap-words";
import { buttonClass } from "@/components/ui/button";
import { TONE_PANEL_CLASS } from "@/components/ui/card";
import { rollCallCheckpointShortText, rollCallCheckpointText } from "@/i18n/manifest-labels";
import {
  type RollCallCheckpoint,
  rollCallCheckpointOrdinal,
  rollCallCheckpoints,
} from "@/lib/manifests";
import type { OfflineTripControls } from "./controls";
import type { OfflineTripView } from "./trip-view";

/**
 * **The checkpoint switch, with the live page's ask-before-going-on step**
 * (issue #2599; `CheckpointGapGuard` is the live one). Tapping a checkpoint
 * whose count before it is still open says who is unmarked and offers "Back to
 * dive N" first and "Open anyway" beside it. A warning, never a refusal: the
 * crew can always open any checkpoint, and nothing here changes how a mark
 * syncs. Once the checkpoint is open, the same line stays under the switch.
 *
 * Read off this device's own taps (`offlineCheckpointGapInputs`), so a count
 * taken with no signal moves the line the moment it is tapped.
 */
export function OfflineCheckpointNav({
  view,
  controls,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const { t, setCheckpoint } = controls;
  const { manifest, checkpoint, previousGaps } = view;
  const [asking, setAsking] = useState<RollCallCheckpoint | null>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `checkpoint` is a trigger — a checkpoint opened, so the question has been answered.
  useEffect(() => {
    setAsking(null);
  }, [checkpoint]);
  useEffect(() => {
    if (asking) lineRef.current?.focus({ preventScroll: true });
  }, [asking]);

  const prompt = asking ? previousGaps.get(asking) : undefined;
  const openedGap = previousGaps.get(checkpoint);
  const backLabel = (gapCheckpoint: RollCallCheckpoint) =>
    t("manifest.checkpointGap.back", { dive: rollCallCheckpointOrdinal(gapCheckpoint) });

  return (
    <>
      {/* The live manifest's control (`boat-segments.ts`, visual review
          2026-10-24, B06): one track of three segments that never wraps, the
          short word below `sm` and the full name as the accessible name. */}
      <nav
        className={`mt-6 ${BOAT_SEGMENT_TRACK_CLASS}`}
        aria-label={t("shared.offlineManifest.single.checkpointNavAria")}
      >
        {rollCallCheckpoints(manifest.trip.plannedDives).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={value === checkpoint}
            onClick={() => {
              if (value !== checkpoint && previousGaps.has(value)) setAsking(value);
              else setCheckpoint(value);
            }}
            className={boatSegmentClass(value === checkpoint)}
          >
            <span aria-hidden="true" className="sm:hidden">
              {rollCallCheckpointShortText(t, value)}
            </span>
            <span className="max-sm:sr-only">{rollCallCheckpointText(t, value)}</span>
          </button>
        ))}
      </nav>
      {asking && prompt ? (
        <div className={`mt-3 ${TONE_PANEL_CLASS} border-danger/60 bg-surface print:hidden`}>
          <p ref={lineRef} tabIndex={-1} role="alert" className="text-base font-bold text-danger">
            {checkpointGapLine(t, prompt)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                prompt.checkpoint === checkpoint
                  ? setAsking(null)
                  : setCheckpoint(prompt.checkpoint)
              }
              className={buttonClass({ variant: "primary", size: "boat" })}
            >
              {backLabel(prompt.checkpoint)}
            </button>
            <button
              type="button"
              onClick={() => setCheckpoint(asking)}
              className={buttonClass({ variant: "secondary", size: "boat" })}
            >
              {t("manifest.checkpointGap.openAnyway")}
            </button>
          </div>
        </div>
      ) : null}
      {/* The count before this one is still open: said on the checkpoint it
          leads to, so the warning holds after "Open anyway". */}
      {openedGap ? (
        <p className="mt-3 text-base font-bold text-danger print:hidden">
          {checkpointGapLine(t, openedGap)}{" "}
          <button
            type="button"
            onClick={() => setCheckpoint(openedGap.checkpoint)}
            className="underline underline-offset-2"
          >
            {backLabel(openedGap.checkpoint)}
          </button>
        </p>
      ) : null}
    </>
  );
}
