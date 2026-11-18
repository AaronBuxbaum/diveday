import {
  CHART_POINT_LIMIT,
  type ProfileSample,
  profileStats,
  thinProfile,
} from "@/lib/dive-profile";
import { FEET_PER_METER } from "@/lib/dive-profile-sample";

const WIDTH = 320;
const HEIGHT = 150;
const PAD = { left: 30, right: 8, top: 8, bottom: 20 };

export type DiveProfileLabels = {
  /** "Safety stop · 3 min", worded for the stop the samples actually hold. */
  stop: (minutes: number) => string;
  /** "Max 59 ft" */
  max: string;
  /** "min" */
  minutes: string;
};

/** The first round step of 5, 10, 15 or 30 that keeps a dive's time axis to about five labels. */
function minuteStep(totalMinutes: number): number {
  return [5, 10, 15, 30].find((step) => step * 6 >= totalMinutes) ?? 60;
}

/**
 * **A dive's depth over time**, drawn the way a dive computer's own log draws it: the surface on top
 * and the water filling down to the diver's line, gridlines at round depths, minutes along the
 * bottom, a safety stop marked where the line rests near 5 m, and the deepest point labeled where
 * it happened. Everything comes from the `samples` it is given: the axes fit the dive, the stop is
 * found in the data, and a recording with no samples draws nothing.
 *
 * `unit` picks the depth axis: feet for a diver's report in a US shop, meters for the staff import,
 * which asks for meters.
 */
export function DiveProfileChart({
  samples: allSamples,
  unit,
  labels,
  className,
}: {
  samples: readonly ProfileSample[];
  unit: "ft" | "m";
  labels: DiveProfileLabels;
  className?: string;
}) {
  const stats = profileStats(allSamples);
  if (!stats) return null;
  const samples = thinProfile(allSamples, CHART_POINT_LIMIT);
  const scale = unit === "ft" ? FEET_PER_METER : 1;
  const tick = unit === "ft" ? 20 : 5;
  const axisMax = Math.max(tick, Math.ceil((stats.maxMeters * scale) / tick) * tick);
  const totalMinutes = Math.max(1, stats.durationSeconds / 60);
  const step = minuteStep(totalMinutes);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (seconds: number) => PAD.left + (seconds / 60 / totalMinutes) * plotW;
  const y = (meters: number) => PAD.top + Math.min(1, (meters * scale) / axisMax) * plotH;
  const line = samples
    .map(
      (sample, index) =>
        `${index === 0 ? "M" : "L"}${x(sample.seconds).toFixed(1)} ${y(sample.meters).toFixed(1)}`,
    )
    .join(" ");
  const last = samples[samples.length - 1] as ProfileSample;
  const area = `${line} L${x(last.seconds).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const depthTicks = Array.from({ length: axisMax / tick + 1 }, (_, i) => i * tick);
  const minuteTicks = Array.from(
    { length: Math.floor(totalMinutes / step) + 1 },
    (_, i) => i * step,
  );
  const stop = stats.safetyStop;
  const stopY = y(5);
  const stopMinutes = stop ? Math.round((stop.toSeconds - stop.fromSeconds) / 60) : 0;
  const stopX = stop ? (x(stop.fromSeconds) + x(stop.toSeconds)) / 2 : 0;
  const deepestX = x(stats.maxSeconds);
  // The label sits left of the point when the point is near the right edge.
  const maxAnchorEnd = deepestX > WIDTH * 0.7;
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={className ?? "h-auto w-full"}
      focusable="false"
    >
      {depthTicks.map((depth) => {
        const gy = PAD.top + (depth / axisMax) * plotH;
        return (
          <g key={depth}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={gy}
              y2={gy}
              className="stroke-border"
              strokeWidth={depth === 0 ? 1.2 : 0.6}
              strokeDasharray={depth === 0 ? undefined : "2 3"}
            />
            <text
              x={PAD.left - 5}
              y={gy + 3}
              textAnchor="end"
              className="fill-muted text-[8px] tabular-nums"
            >
              {depth}
            </text>
          </g>
        );
      })}
      {minuteTicks.map((minute) => (
        <g key={minute}>
          <line
            x1={x(minute * 60)}
            x2={x(minute * 60)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            className="stroke-border"
            strokeWidth={0.5}
            strokeDasharray="1 4"
          />
          <text
            x={x(minute * 60)}
            y={HEIGHT - 6}
            textAnchor="middle"
            className="fill-muted text-[8px] tabular-nums"
          >
            {minute}
          </text>
        </g>
      ))}
      <text x={PAD.left - 8} y={HEIGHT - 6} textAnchor="end" className="fill-muted text-[8px]">
        {labels.minutes}
      </text>
      {/* The safety stop: a band the line rests in near 5 m, found in the samples. */}
      {stop ? (
        <rect
          x={x(stop.fromSeconds)}
          y={stopY - 4}
          width={Math.max(2, x(stop.toSeconds) - x(stop.fromSeconds))}
          height={8}
          rx={2}
          className="fill-success-tint stroke-success"
          strokeWidth={0.6}
          opacity={0.9}
        />
      ) : null}
      <path d={area} className="fill-primary-tint" opacity={0.75} />
      <path
        d={line}
        fill="none"
        className="stroke-primary"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={deepestX}
        cy={y(stats.maxMeters)}
        r={3}
        className="fill-surface stroke-primary"
        strokeWidth={1.6}
      />
      <text
        x={deepestX + (maxAnchorEnd ? -6 : 6)}
        y={y(stats.maxMeters) - 7}
        textAnchor={maxAnchorEnd ? "end" : "start"}
        className="fill-foreground text-[8px] font-semibold"
      >
        {labels.max}
      </text>
      {stop ? (
        <text
          x={stopX}
          y={stopY - 8}
          textAnchor={stopX > WIDTH / 2 ? "end" : "start"}
          className="fill-success-strong text-[7px] font-medium"
        >
          {labels.stop(stopMinutes)}
        </text>
      ) : null}
    </svg>
  );
}
