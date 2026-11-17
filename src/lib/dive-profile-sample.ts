/**
 * The one dive the marketing drawings show Priya having: a 42-minute reef dive to 18 m (59 ft),
 * sampled every 20 seconds the way a dive computer logs it. It is drawn, not recorded: the shape
 * is a real recreational profile (a paused descent, a bottom that follows the reef's contour, a
 * slow ascent, a three-minute stop at 5 m), and its wobble comes from fixed sines, so the picture
 * is the same on every render and every machine.
 */

import type { ProfileSample } from "./dive-profile";

export type { ProfileSample };

const TOTAL_SECONDS = 42 * 60;
const STEP_SECONDS = 20;
const MAX_METERS = 18.2;

/** Depth the diver is working toward at `seconds`, before the contour's wobble. */
function planned(seconds: number): number {
  const minutes = seconds / 60;
  if (minutes < 1) return minutes * 4; // off the line, down to 4 m
  if (minutes < 1.8) return 4 + (minutes - 1) * 1.2; // a pause to clear her ears
  if (minutes < 4) return 5 + ((minutes - 1.8) / 2.2) * 12.3; // on down to the reef
  if (minutes < 34) {
    // The reef's contour: a slow ridge down to the deepest point at about 14 minutes, then back up
    // a ledge at a time as the dive turns toward the boat.
    const along = (minutes - 4) / 30;
    return 17.3 + Math.sin(along * Math.PI * 0.9) * 2 - along * 5.5;
  }
  if (minutes < 36.5) return 10.7 - ((minutes - 34) / 2.5) * 5.4; // a slow ascent
  if (minutes < 39.5) return 5.3 - (minutes - 36.5) * 0.05; // the safety stop, about 5 m
  return Math.max(0, 5.1 - ((minutes - 39.5) / 2.5) * 5.1); // the last climb
}

function wobble(seconds: number, amount: number): number {
  return (
    Math.sin(seconds / 37) * 0.5 * amount +
    Math.sin(seconds / 91 + 1.3) * 0.7 * amount +
    Math.sin(seconds / 13 + 0.4) * 0.15 * amount
  );
}

export const SAMPLE_PROFILE: readonly ProfileSample[] = Array.from(
  { length: TOTAL_SECONDS / STEP_SECONDS + 1 },
  (_, index) => {
    const seconds = index * STEP_SECONDS;
    const minutes = seconds / 60;
    // The wobble dies away at the surface and on the stop, where she holds still.
    const calm = minutes < 1 || minutes > 36.5 ? 0.15 : 1;
    const raw = planned(seconds) + wobble(seconds, 0.55 * calm);
    const meters = Math.min(MAX_METERS, Math.max(0, raw));
    return { seconds, meters: Math.round(meters * 10) / 10 };
  },
);

export const PROFILE_MINUTES = TOTAL_SECONDS / 60;
export const PROFILE_MAX_METERS = Math.max(...SAMPLE_PROFILE.map((sample) => sample.meters));
export const PROFILE_AVG_METERS =
  SAMPLE_PROFILE.reduce((sum, sample) => sum + sample.meters, 0) / SAMPLE_PROFILE.length;
export const FEET_PER_METER = 3.28084;
