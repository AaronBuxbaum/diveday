import { FEET_PER_METER, PROFILE_MINUTES, SAMPLE_PROFILE } from "./dive-profile-sample";

const WIDTH = 320;
const HEIGHT = 150;
const PAD = { left: 30, right: 8, top: 8, bottom: 20 };

export type DiveProfileLabels = {
  /** The chart's name for a screen reader: "Depth over time, 42 minutes, 59 ft deepest". */
  /** "Safety stop · 3 min" */
  stop: string;
  /** "Max 59 ft" */
  max: string;
  /** "min" */
  minutes: string;
};

/**
 * **A dive's depth over time**, drawn the way a dive computer's own log draws it: the surface on top
 * and the water filling down to the diver's line, gridlines at round depths, minutes along the
 * bottom, the safety stop marked at 5 m, and the deepest point labeled where it happened. Sample
 * data (`SAMPLE_PROFILE`), the one dive the marketing drawings give Priya.
 *
 * `unit` picks the depth axis: feet for a diver's report in a US shop, meters for the staff import,
 * which asks for meters.
 */
export function DiveProfileChart({
  unit,
  labels,
  className,
}: {
  unit: "ft" | "m";
  labels: DiveProfileLabels;
  className?: string;
}) {
  const scale = unit === "ft" ? FEET_PER_METER : 1;
  const axisMax = unit === "ft" ? 60 : 20;
  const tick = unit === "ft" ? 20 : 5;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (seconds: number) => PAD.left + (seconds / 60 / PROFILE_MINUTES) * plotW;
  const y = (meters: number) => PAD.top + Math.min(1, (meters * scale) / axisMax) * plotH;
  const line = SAMPLE_PROFILE.map(
    (sample, index) =>
      `${index === 0 ? "M" : "L"}${x(sample.seconds).toFixed(1)} ${y(sample.meters).toFixed(1)}`,
  ).join(" ");
  const last = SAMPLE_PROFILE[SAMPLE_PROFILE.length - 1];
  const area = `${line} L${x(last?.seconds ?? 0).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const deepest = SAMPLE_PROFILE.reduce((best, sample) =>
    sample.meters > best.meters ? sample : best,
  );
  const depthTicks = Array.from({ length: axisMax / tick + 1 }, (_, i) => i * tick);
  const minuteTicks = [0, 10, 20, 30, 40];
  const stopY = y(5 / scale);
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
      {/* The safety stop: a band at 5 m the line rests on for three minutes. */}
      <rect
        x={x(36.7 * 60)}
        y={stopY - 4}
        width={x(39.6 * 60) - x(36.7 * 60)}
        height={8}
        rx={2}
        className="fill-success-tint stroke-success"
        strokeWidth={0.6}
        opacity={0.9}
      />
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
        cx={x(deepest.seconds)}
        cy={y(deepest.meters)}
        r={3}
        className="fill-surface stroke-primary"
        strokeWidth={1.6}
      />
      <text
        x={x(deepest.seconds) + 6}
        y={y(deepest.meters) - 7}
        className="fill-foreground text-[8px] font-semibold"
      >
        {labels.max}
      </text>
      <text
        x={x(38.1 * 60)}
        y={stopY - 8}
        textAnchor="middle"
        className="fill-success-strong text-[7px] font-medium"
      >
        {labels.stop}
      </text>
    </svg>
  );
}
