import type { DayStripGeometry } from "@/lib/day-strip";

/**
 * **The day's picture** — ADR 20260919-one-idea, decision I · Tide.
 *
 * The sun's arc over a horizon, the tide breathing under it, the shop's
 * departures on the hours they leave, and a line for now. Every coordinate
 * comes from `dayStripGeometry` (`src/lib/day-strip.ts`); this places them and
 * decides nothing.
 *
 * **It says no word of its own.** Every label — a departure's time, an hour
 * tick, the word for now — arrives worded and zoned from the caller, which is
 * what keeps a staff surface's copy in the message bundle and a rendered time
 * in the shop's own zone.
 *
 * **One image to a screen reader.** `role="img"` with the caller's `label`,
 * because everything drawn here is said again in the list underneath it; a
 * reader who cannot see the arc loses a picture, never a fact.
 */

export type DayStripProps = {
  geometry: DayStripGeometry;
  /** The whole picture in one sentence, for a reader who cannot see it. */
  label: string;
  /** The word beside each mark, by the id the geometry carries. */
  markLabels?: Record<string, string>;
  /** Ticks, in the order `geometry.ticks` holds them. */
  tickLabels?: readonly string[];
  /** The time now, on the pill. Omitted where the strip has no now in it. */
  nowLabel?: string;
  /** The word for a band, by id — drawn inside the band rather than beside it. */
  bandLabels?: Record<string, string>;
  className?: string;
};

/**
 * How close two marks may sit before the second one climbs a row.
 *
 * Measured in the strip's own units against the longest label a departure
 * carries ("11:00 AM"): below this the two words touch, and two touching times
 * is a picture that has to be deciphered rather than read.
 */
const LABEL_CLEARANCE = 110;

export function DayStrip({
  geometry,
  label,
  markLabels = {},
  tickLabels = [],
  nowLabel,
  bandLabels = {},
  className,
}: DayStripProps) {
  const { width, height, horizonY } = geometry;
  // Marks alternate rows only where they would otherwise collide, so a day with
  // three well-spaced boats reads on one line and a day with two at the same
  // hour still reads at all.
  let lastLabelX = Number.NEGATIVE_INFINITY;
  let lastWasRaised = false;
  const marks = geometry.marks.map((mark) => {
    const raised = mark.x - lastLabelX < LABEL_CLEARANCE ? !lastWasRaised : false;
    lastLabelX = mark.x;
    lastWasRaised = raised;
    return { ...mark, labelY: raised ? horizonY - 28 : horizonY - 14 };
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className ?? "block h-auto w-full"}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <title>{label}</title>
      {/* The horizon, and the hour ticks hanging under it. */}
      <line
        x1={0}
        x2={width}
        y1={horizonY}
        y2={horizonY}
        stroke="var(--sky-rule-faint)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {geometry.ticks.map((tick, index) => (
        <g key={tick.at.toISOString()}>
          <line
            x1={tick.x}
            x2={tick.x}
            y1={horizonY}
            y2={horizonY + 5}
            stroke="var(--sky-rule-faint)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {tickLabels[index] ? (
            <text
              x={tick.x}
              y={horizonY + 18}
              textAnchor="middle"
              fill="var(--sky-ink-soft)"
              fontSize={11}
              fontWeight={500}
            >
              {tickLabels[index]}
            </text>
          ) : null}
        </g>
      ))}

      {/* The sun's whole arc, dashed, with the part already walked drawn solid. */}
      {geometry.sunArc ? (
        <path
          d={geometry.sunArc}
          fill="none"
          stroke="var(--sky-rule-faint)"
          strokeWidth={1.5}
          strokeDasharray="2 5"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {geometry.sunArcElapsed ? (
        <path
          d={geometry.sunArcElapsed}
          fill="none"
          stroke="var(--sky-rule)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}

      {/* The tide, under the horizon where the water is. */}
      {geometry.tidePath ? (
        <path
          d={geometry.tidePath}
          fill="none"
          stroke="var(--sky-rule)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}

      {/* A span in the water: a thick line on the horizon, worded inside it. */}
      {geometry.bands.map((band) => (
        <g key={band.id}>
          <line
            x1={band.from}
            x2={band.to}
            y1={horizonY}
            y2={horizonY}
            stroke="var(--sky-ink)"
            strokeWidth={7}
            strokeLinecap="round"
            opacity={0.9}
          />
          {bandLabels[band.id] ? (
            <text
              x={(band.from + band.to) / 2}
              y={horizonY - 14}
              textAnchor="middle"
              fill="var(--sky-ink)"
              fontSize={11}
              fontWeight={600}
            >
              {bandLabels[band.id]}
            </text>
          ) : null}
        </g>
      ))}

      {/* Each departure, on its own hour. */}
      {marks.map((mark) => (
        <g key={mark.id}>
          <circle cx={mark.x} cy={horizonY} r={5.5} fill="var(--sky-ink)" />
          {markLabels[mark.id] ? (
            <text
              x={mark.x}
              y={mark.labelY}
              textAnchor="middle"
              fill="var(--sky-ink)"
              fontSize={11}
              fontWeight={600}
            >
              {markLabels[mark.id]}
            </text>
          ) : null}
        </g>
      ))}

      {/* The sun itself, last, so it sits over its own arc. */}
      {geometry.sun ? (
        <circle cx={geometry.sun.x} cy={geometry.sun.y} r={7} fill="var(--sky-sun)" />
      ) : null}

      {/* Now: a white line with an amber pill at its head. */}
      {geometry.nowX !== null ? (
        <g>
          <line
            x1={geometry.nowX}
            x2={geometry.nowX}
            y1={22}
            y2={horizonY + 8}
            stroke="var(--sky-ink)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {nowLabel ? (
            <>
              <rect
                x={geometry.nowX - 22}
                y={6}
                width={44}
                height={17}
                rx={8.5}
                fill="var(--sky-now)"
              />
              <text
                x={geometry.nowX}
                y={18.5}
                textAnchor="middle"
                fill="var(--sky-now-ink)"
                fontSize={11}
                fontWeight={700}
              >
                {nowLabel}
              </text>
            </>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}
