import type { DayStripGeometry } from "@/lib/day-strip";

/**
 * **The day's picture** — ADR 20260919-one-idea, decision I · Tide.
 *
 * The sun's arc over a horizon, the tide breathing under it, the shop's
 * departures on the hours they leave, and a line for now. Every coordinate
 * comes from `dayStripGeometry` (`src/lib/day-strip.ts`); this places them and
 * decides nothing.
 *
 * **Curves stretch, things do not.** The strip is one box that has to be 390
 * wide on a phone and 976 on a desk, so the arc and the tide are an SVG with
 * `preserveAspectRatio="none"` — a curve *should* flatten as the day gets
 * wider, because that is what a shallower day looks like. Everything discrete
 * is HTML positioned in percent over the top: a dot drawn in that same SVG
 * would be an egg standing on end at 390 and lying down at 976, and an
 * 11-unit label would render at four pixels on the phone and eleven on the
 * desk. Real elements are round at every width and read at one size.
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
 * A thousandth of the strip's width per unit, measured against the longest
 * label a departure carries ("11:00 AM") at the *narrowest* width the strip is
 * ever drawn at — a phone. Two touching times is a picture to be deciphered
 * rather than read, and the cost of the phone's threshold on a desk is the
 * occasional label raised with room to spare, which reads as rhythm.
 */
const LABEL_CLEARANCE = 150;

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
  const px = (x: number): string => `${(x / width) * 100}%`;
  const py = (y: number): string => `${(y / height) * 100}%`;
  const horizon = py(horizonY);
  /**
   * A word is centred on its hour, except near the ends, where centring it
   * would hang half of it outside the strip. `clamp` holds the centre far
   * enough in for the longest label the strip carries — one line, and no branch
   * per edge that would then need a threshold nobody can check.
   */
  const centred = (x: number, room: string): string =>
    `clamp(${room}, ${px(x)}, calc(100% - ${room}))`;

  /**
   * How far in a label's centre must stay, for a label of this length.
   *
   * The clamp above holds a word off the edges, and the room it needs is half
   * the word. A fixed figure was tuned for a time — "11:00 AM" is about 3.5rem
   * at 11px, so 1.75rem — and it is too little for anything longer. The
   * departure page labels its first dive with the site, and "Molasses Reef" at
   * the left end of a 390px phone clears the edge by about seven pixels: whole,
   * but only because that mark happens to sit far enough in. A dive arriving at
   * the very start of the window would lose its first letters.
   *
   * A semibold 11px character averages about 6.3px, so half a word of `n` is
   * `n · 0.2rem`. Floored at the old figure, so every caller that labels a mark
   * with a time places it exactly where it did.
   */
  const roomFor = (text: string): string => `${Math.max(1.75, text.length * 0.2).toFixed(2)}rem`;

  // Marks alternate rows only where they would otherwise collide, so a day with
  // three well-spaced boats reads on one line and a day with two at the same
  // hour still reads at all. Only a word can collide with a word: a mark the
  // caller gave no label (the trip page's lines-off) is skipped, where it used
  // to push the next label up a row to clear nothing.
  let lastLabelX = Number.NEGATIVE_INFINITY;
  let lastWasRaised = false;
  const marks = geometry.marks.map((mark) => {
    if (!markLabels[mark.id]) return { ...mark, raised: false };
    const raised = mark.x - lastLabelX < LABEL_CLEARANCE ? !lastWasRaised : false;
    lastLabelX = mark.x;
    lastWasRaised = raised;
    return { ...mark, raised };
  });

  return (
    <div className={`relative ${className ?? "h-24 w-full"}`.trim()} role="img" aria-label={label}>
      {/* Now, on a pill in a row of its own above the picture. Inside it, the
          sun reaches the same apex at noon that the pill occupies, and the two
          would sit on top of one another every day at solar noon. */}
      {geometry.nowX !== null && nowLabel ? (
        <span
          className="absolute top-0 -translate-x-1/2 rounded-full bg-(--sky-now) px-1.5 py-px text-[11px] leading-[15px] font-bold text-(--sky-now-ink) tabular-nums"
          style={{ left: centred(geometry.nowX, "1.75rem") }}
        >
          {nowLabel}
        </span>
      ) : null}

      <div className="absolute inset-x-0 top-5 bottom-0">
        {/* The curves, and only the curves. */}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
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
          {geometry.ticks.map((tick) => (
            <line
              key={tick.at.toISOString()}
              x1={tick.x}
              x2={tick.x}
              y1={horizonY}
              y2={horizonY + 6}
              stroke="var(--sky-rule-faint)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* One dashed arc per day the window touches, with the part already
              walked drawn solid over whichever of them holds now. A day is one
              arc; a voyage that sails overnight is two, and the bare stretch of
              horizon between them is the night (issue #1904). */}
          {geometry.sunArcs.map((arc) => (
            <path
              key={arc}
              d={arc}
              fill="none"
              stroke="var(--sky-rule-faint)"
              strokeWidth={1.5}
              strokeDasharray="2 5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
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

          {/* A span in the water: a thick line on the horizon. */}
          {geometry.bands.map((band) => (
            <line
              key={band.id}
              x1={band.from}
              x2={band.to}
              y1={horizonY}
              y2={horizonY}
              stroke="var(--sky-ink)"
              strokeWidth={7}
              strokeLinecap="round"
              opacity={0.9}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {/* Now: a line down from the pill to just under the horizon. */}
        {geometry.nowX !== null ? (
          <div
            className="absolute top-0 w-0.5 -translate-x-1/2 rounded-full bg-(--sky-ink)"
            style={{
              left: px(geometry.nowX),
              bottom: `calc(${py(height - horizonY)} - 0.375rem)`,
            }}
          />
        ) : null}

        {/* Each departure, on its own hour. The dot's centre is held half a
            dot in from either end, as a label's is held half a word in: the
            geometry's end inset is 1% of the width, 3.6px on a phone against
            the dot's 5.5px radius, so an end dot hung past the column the
            header shares. It moves at most a pixel or two, and only there. */}
        {marks.map((mark) => (
          <div key={mark.id}>
            <span
              className="absolute size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--sky-ink)"
              style={{ left: centred(mark.x, "5.5px"), top: horizon }}
            />
            {markLabels[mark.id] ? (
              <span
                className={`absolute -translate-x-1/2 text-[11px] leading-none font-semibold whitespace-nowrap text-(--sky-ink) tabular-nums ${
                  mark.raised
                    ? "-translate-y-[calc(100%+1.5rem)]"
                    : "-translate-y-[calc(100%+0.625rem)]"
                }`}
                style={{ left: centred(mark.x, roomFor(markLabels[mark.id])), top: horizon }}
              >
                {markLabels[mark.id]}
              </span>
            ) : null}
          </div>
        ))}

        {/* The sun itself, over its own arc. */}
        {geometry.sun ? (
          <span
            className="absolute size-[15px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--sky-sun)"
            style={{ left: px(geometry.sun.x), top: py(geometry.sun.y) }}
          />
        ) : null}

        {/* The hour under each tick. */}
        {geometry.ticks.map((tick, index) => {
          const word = tickLabels[index];
          return word ? (
            <span
              key={tick.at.toISOString()}
              className="absolute -translate-x-1/2 translate-y-[0.5rem] text-[11px] leading-none font-medium whitespace-nowrap text-(--sky-ink-soft) tabular-nums"
              style={{ left: centred(tick.x, "1.25rem"), top: horizon }}
            >
              {word}
            </span>
          ) : null;
        })}

        {/* The word for a span in the water, over the middle of it. */}
        {geometry.bands.map((band) => {
          const word = bandLabels[band.id];
          return word ? (
            <span
              key={band.id}
              className="absolute -translate-x-1/2 -translate-y-[calc(100%+0.625rem)] text-[11px] leading-none font-semibold whitespace-nowrap text-(--sky-ink)"
              style={{ left: centred((band.from + band.to) / 2, "2.5rem"), top: horizon }}
            >
              {word}
            </span>
          ) : null;
        })}
      </div>
    </div>
  );
}
