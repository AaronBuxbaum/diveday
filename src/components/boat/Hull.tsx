import type { HullGeometry, SeatState } from "@/lib/hull";

/**
 * **The boat, drawn** — ADR 20260919-one-idea, decision I · Tide: "a
 * departure's page is Deck's hull".
 *
 * A shape in the boat's own colour with its seats laid out from transom to bow,
 * one per place the boat has. Every coordinate comes from `hullGeometry`
 * (`src/lib/hull.ts`); this places them and decides nothing.
 *
 * **The hull keeps its aspect.** A boat is a shape, not a curve that may
 * flatten, so this is the one picture in the app that does *not* take
 * `preserveAspectRatio="none"` — the lettering scales with the width, which is
 * why `geometry.showsInitials` stops drawing it past eight columns rather than
 * rendering four-pixel letters.
 *
 * **It sits on paper, not on the sky.** Deck drew a hull on a dark card because
 * in Deck the whole app is boats; under Tide the sky is the day's header and
 * the seats are the *record*, so the hull is a paper object below it. That is
 * what lets the seats wear the roll call's own fills — `--success`,
 * `--warning`, `--danger` — rather than a second set of hues that could drift
 * from the rows underneath.
 *
 * **Colour never carries a state alone** (design principle 6). Every seat is
 * said again in the roster rows beneath the hull, and the hull as a whole
 * carries one sentence for a reader who cannot see it. It is `role="img"`
 * because a seat is not a control here: the roll call's one tap per name lives
 * on its own surface and is untouched by this.
 *
 * **No number is ever drawn on a seat.** Seats are never numbered and never
 * assigned (the ADR, and `src/lib/hull.ts`); the whole defence against a reader
 * taking the picture for a seating plan is that there is nothing on it to
 * mistake for one.
 */

/** What each state paints, in the roll call's own vocabulary. */
const SEAT_FILL: Record<SeatState, string> = {
  open: "none",
  booked: "var(--surface)",
  blocked: "var(--danger)",
  aboard: "var(--success)",
  ashore: "var(--warning)",
  missing: "var(--danger)",
};

/**
 * The ink two initials take on each fill. Measured rather than guessed: white
 * reads 5.43 on `--success`, 5.42 on `--warning` and 5.38 on `--danger`, and
 * ink reads 16.8 on `--surface` — the canvas's own vivid fills gave white 2.2,
 * which is the one part of the drawing that did not survive contact with AA.
 */
const SEAT_INK: Record<SeatState, string> = {
  open: "var(--muted)",
  booked: "var(--foreground)",
  blocked: "var(--surface)",
  aboard: "var(--surface)",
  ashore: "var(--surface)",
  missing: "var(--surface)",
};

export type HullSeatContent = {
  state: SeatState;
  /** Two letters, already shortened by the caller. Absent for an open seat. */
  initials?: string;
};

export function Hull({
  geometry,
  label,
  seats = [],
  color,
  crewInitials = [],
  className,
}: {
  geometry: HullGeometry;
  /** The whole boat in one sentence, for a reader who cannot see it. */
  label: string;
  /** What each place is wearing, in booking order. A short list leaves the rest open. */
  seats?: readonly HullSeatContent[];
  /** The shop's colour for this hull, or null for one nobody has painted. */
  color?: string | null;
  /** Up to two guides in the wheelhouse, already shortened. */
  crewInitials?: readonly string[];
  className?: string;
}) {
  if (geometry.seats.length === 0) return null;
  // An unpainted hull is drawn in the page's own ink — a perfectly good boat,
  // and the one every hull was before `boats.hull_color` existed.
  const line = color ?? "var(--border-strong)";

  return (
    <svg
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      className={className ?? "block h-auto w-full"}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <path
        d={geometry.outline}
        fill={color ?? "var(--surface-sunken)"}
        fillOpacity={color ? 0.12 : 1}
        stroke={line}
        strokeWidth={1.5}
      />
      <line
        x1={geometry.midline.x1}
        x2={geometry.midline.x2}
        y1={geometry.midline.y}
        y2={geometry.midline.y}
        stroke={line}
        strokeOpacity={0.35}
        strokeDasharray="2 5"
      />

      {geometry.seats.map((seat) => {
        const content = seats[seat.index] ?? { state: "open" as const };
        const open = content.state === "open";
        return (
          <g key={seat.index}>
            <rect
              x={seat.x}
              y={seat.y}
              width={seat.width}
              height={seat.height}
              rx={9}
              fill={SEAT_FILL[content.state]}
              stroke={open ? line : "none"}
              strokeOpacity={open ? 0.6 : 1}
              strokeDasharray={open ? "3 3" : undefined}
              strokeWidth={open ? 1.5 : 0}
            />
            {/* A stated "did not come back" is the loudest thing on the boat and
                the only seat that wears a ring — the same rule, and the same
                2026-08-04 dive-domain review, that gives the roll call's rows
                exactly one ring. */}
            {content.state === "missing" ? (
              <rect
                x={seat.x - 3}
                y={seat.y - 3}
                width={seat.width + 6}
                height={seat.height + 6}
                rx={11}
                fill="none"
                stroke={SEAT_FILL.missing}
                strokeOpacity={0.5}
                strokeWidth={2}
              />
            ) : null}
            {geometry.showsInitials && content.initials ? (
              <text
                x={seat.centerX}
                y={seat.centerY + 4}
                textAnchor="middle"
                fontSize={11.5}
                fontWeight={700}
                fill={SEAT_INK[content.state]}
              >
                {content.initials}
              </text>
            ) : null}
          </g>
        );
      })}

      {geometry.crew.map((station) => (
        <g key={station.index}>
          <circle
            cx={station.cx}
            cy={station.cy}
            r={station.r}
            fill={line}
            fillOpacity={0.18}
            stroke={line}
            strokeWidth={1.5}
          />
          {geometry.showsInitials && crewInitials[station.index] ? (
            <text
              x={station.cx}
              y={station.cy + 4}
              textAnchor="middle"
              fontSize={10.5}
              fontWeight={700}
              fill="var(--foreground)"
            >
              {crewInitials[station.index]}
            </text>
          ) : null}
        </g>
      ))}

      {/* The helm, which is what makes the shape read as a boat rather than a tray. */}
      <circle
        cx={geometry.helm.cx}
        cy={geometry.helm.cy}
        r={geometry.helm.ringRadius}
        fill="none"
        stroke={line}
        strokeWidth={1.5}
      />
      <circle cx={geometry.helm.cx} cy={geometry.helm.cy} r={geometry.helm.dotRadius} fill={line} />
    </svg>
  );
}
