/**
 * **Reading a dive computer's depth samples**: the numbers a recap shows beside the chart, taken
 * from the recording and nothing else. Evidence for a diver's own keepsake, never an input to
 * readiness, no-fly or any gate (`src/features/after-the-dive/computer-dives/README.md`).
 */

export type ProfileSample = { seconds: number; meters: number };

export type SafetyStop = { fromSeconds: number; toSeconds: number; meters: number };

export type ProfileStats = {
  maxMeters: number;
  /** When the deepest sample was logged, for labeling it on the chart. */
  maxSeconds: number;
  /** Depth averaged over time, not over samples, so an uneven sample rate cannot skew it. */
  averageMeters: number;
  durationSeconds: number;
  safetyStop: SafetyStop | null;
};

/** A stop counts at 3.5 to 6.5 m for at least two minutes, after the deepest point of a dive past 10 m. */
const STOP_MIN_METERS = 3.5;
const STOP_MAX_METERS = 6.5;
const STOP_MIN_SECONDS = 120;
const STOP_DIVE_MIN_METERS = 10;

/** Fewer points than this are drawn as they are; more are thinned to keep the picture light. */
export const CHART_POINT_LIMIT = 480;

/** Null for a recording with no samples: nothing is drawn rather than a guess. */
export function profileStats(samples: readonly ProfileSample[]): ProfileStats | null {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return null;
  let deepest = first;
  let weighted = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] as ProfileSample;
    if (sample.meters > deepest.meters) deepest = sample;
    const next = samples[i + 1];
    if (next) weighted += ((sample.meters + next.meters) / 2) * (next.seconds - sample.seconds);
  }
  const span = last.seconds - first.seconds;
  return {
    maxMeters: deepest.meters,
    maxSeconds: deepest.seconds,
    averageMeters: span > 0 ? weighted / span : deepest.meters,
    durationSeconds: last.seconds,
    safetyStop: findSafetyStop(samples, deepest),
  };
}

function findSafetyStop(
  samples: readonly ProfileSample[],
  deepest: ProfileSample,
): SafetyStop | null {
  if (deepest.meters < STOP_DIVE_MIN_METERS) return null;
  let best: SafetyStop | null = null;
  let runStart: ProfileSample | null = null;
  let runEnd: ProfileSample | null = null;
  const close = () => {
    if (runStart && runEnd && runEnd.seconds - runStart.seconds >= STOP_MIN_SECONDS) {
      if (!best || runEnd.seconds - runStart.seconds > best.toSeconds - best.fromSeconds) {
        best = { fromSeconds: runStart.seconds, toSeconds: runEnd.seconds, meters: 5 };
      }
    }
    runStart = null;
    runEnd = null;
  };
  for (const sample of samples) {
    const inBand =
      sample.seconds > deepest.seconds &&
      sample.meters >= STOP_MIN_METERS &&
      sample.meters <= STOP_MAX_METERS;
    if (inBand) {
      runStart ??= sample;
      runEnd = sample;
    } else close();
  }
  close();
  return best;
}

/** At most `limit` points, always keeping the first, the last and the deepest. */
export function thinProfile(
  samples: readonly ProfileSample[],
  limit = CHART_POINT_LIMIT,
): ProfileSample[] {
  if (samples.length <= limit) return [...samples];
  const stride = Math.ceil(samples.length / limit);
  const deepest = samples.reduce((best, s) => (s.meters > best.meters ? s : best));
  const kept = samples.filter(
    (sample, index) => index % stride === 0 || sample === deepest || index === samples.length - 1,
  );
  return kept;
}
