import type { HullGeometry, SeatReading, SeatState } from "@/lib/hull";

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
 * **Colour never carries a state alone** (design principle 6), and on a
 * 34×32-unit rectangle that is not a slogan. Every seat is said again in the
 * roster rows beneath the hull, and the hull as a whole carries one sentence
 * for a reader who cannot see it; inside the picture, each state is told from
 * its neighbour by *lightness and outline* as well as by hue, so the boat still
 * reads in greyscale, through polarized sunglasses, and at arm's length in sun:
 *
 * - **open** — no fill, a dashed weak line. The hull body shows through.
 * - **booked** — paper, with a solid line at full weight. The canvas drew it
 *   exactly so (`.deck .seat`, `background:#fff; border:1.5px solid`), and an
 *   earlier draft here dropped the border: a white seat on an unpainted hull's
 *   `--surface-sunken` body is 1.2:1 in light and **1.05:1 in Glare Mode**, the
 *   one mode built for this surface's weather, which left an open seat more
 *   visible than a taken one and inverted the picture's whole first reading
 *   (dive-domain review 20260919).
 * - **blocked** — the danger *tint* behind a danger line and danger ink
 *   (5.45:1, measured in `globals.css`). Quiet, like its row.
 * - **aboard / ashore** — the success and warning fills, solid, white ink.
 * - **missing** — danger, solid, and the only seat that wears a ring.
 *
 * That blocked is an outline where missing is a solid is the whole distinction
 * between "this diver's paperwork is not done" and "somebody is still in the
 * water", and it is deliberately the same loudness ordering the roll call's
 * rows carry (`ROLL_CALL_ROW_TONE`: `bg-danger/5` and no ring against
 * `bg-danger/15` with one, dive-domain review 20260804). Both were one solid
 * red separated by a half-transparent 2-unit halo until 20260919's review
 * called that a rendering artifact rather than a distinction — which it was.
 *
 * It is `role="img"` because a seat is not a control here: the roll call's one
 * tap per name lives on its own surface and is untouched by this.
 *
 * **It does not print.** `@media print` repaints the app black-on-white and
 * flattens `--success`, `--warning` and `--danger` to two near-blacks, so a
 * printed hull would show aboard and ashore as the same blob and a booked seat
 * as white on white. The rows print with every name and state in words, which
 * is what a manifest on a boat is for; a picture that prints a lie is worse
 * than one that does not print. Giving the hull its own mono treatment is on
 * the ADR's pre-manifest list.
 *
 * **No number is ever drawn on a seat**, and that is not what makes the picture
 * safe — `src/lib/hull.ts` says what does.
 */

/** What each state paints, in the roll call's own vocabulary. */
const SEAT_FILL: Record<SeatState, string> = {
  open: "none",
  booked: "var(--surface)",
  blocked: "var(--danger-tint)",
  /** Nothing said about this person yet — the slate the rows give `awaiting`. */
  awaiting: "var(--surface-sunken)",
  aboard: "var(--success)",
  ashore: "var(--warning)",
  /** The tint, not the fill — an inference does not get the stated colour. */
  ashoreImplied: "var(--warning-tint)",
  missing: "var(--danger)",
};

/**
 * The line around each seat, and how heavily it is drawn.
 *
 * `null` means the hull's own line — the shop's colour, or the page's ink on a
 * boat nobody painted — which is what the canvas gave an ordinary taken seat.
 * A dashed entry is an open place; everything else is solid, because a seat
 * that differs from its neighbour only in fill has no reading left once the
 * fill is flattened by print, by glare, or by a reader who cannot separate the
 * hues.
 */
const SEAT_LINE: Record<SeatState, { stroke: string | null; opacity: number; dashed: boolean }> = {
  open: { stroke: null, opacity: 0.6, dashed: true },
  booked: { stroke: null, opacity: 1, dashed: false },
  blocked: { stroke: "var(--danger)", opacity: 1, dashed: false },
  /**
   * **Solid, and that is not a detail.** A first pass drew this dashed, on the
   * reasoning that an unread seat and an empty one are both the picture
   * declining to claim something, with the initials to tell them apart. Two
   * things were wrong with that. A dashed near-white seat on an unpainted
   * hull's `--surface-sunken` body is the 1.2:1 this file measures above, so
   * the only real difference left was the lettering — and `hullGeometry` drops
   * the lettering above eight columns, which is *every* boat over a six-pack.
   * A booked diver nobody had vetted rendered as an empty seat, on exactly the
   * boats where a crew most needs to know the difference.
   *
   * So the rule this file already had stands: a line at full weight means a
   * body is in this seat. The doubt is carried by the slate fill and by the
   * inner mark below, both of which survive the print flattening that eats
   * hue — and neither of which needs two letters to be legible.
   */
  awaiting: { stroke: "var(--border-strong)", opacity: 1, dashed: false },
  aboard: { stroke: "var(--success)", opacity: 1, dashed: false },
  ashore: { stroke: "var(--warning)", opacity: 1, dashed: false },
  /**
   * **Dashed, and that is the whole point** (§3b.3, ADR 20260827 decision 4).
   * Nobody said this person stayed ashore; the dock's silence was carried
   * forward. A solid amber ring is what a crew member's statement earns, and
   * an inference drawn in the same weight is the picture promoting a guess.
   */
  ashoreImplied: { stroke: "var(--warning)", opacity: 1, dashed: true },
  missing: { stroke: "var(--danger)", opacity: 1, dashed: false },
};

/**
 * The ink two initials take on each fill. Measured rather than guessed: white
 * reads 5.43 on `--success`, 5.42 on `--warning` and 5.38 on `--danger`, and
 * ink reads 16.8 on `--surface` — the canvas's own vivid fills gave white 2.2,
 * which is the one part of the drawing that did not survive contact with AA.
 */
const SEAT_INK: Record<SeatState, string> = {
  /** Kept only to hold the map total: nothing ever letters an empty place. */
  open: "var(--muted)",
  booked: "var(--foreground)",
  /** Danger on its own tint — 5.45:1, the number `globals.css` measured. */
  blocked: "var(--danger)",
  /** Foreground on the slate, exactly as the `awaiting` row letters it. */
  awaiting: "var(--foreground)",
  aboard: "var(--surface)",
  ashore: "var(--surface)",
  /** Warning on its own tint, the pairing `blocked` already uses. */
  ashoreImplied: "var(--warning)",
  missing: "var(--surface)",
};

export type HullSeatContent = {
  /**
   * The seat as `seatReadingFor` read it — not the bare state.
   *
   * The picture paints `reading.state` and nothing else today. The other two
   * fields ride along because the derivation may not throw them away (ADR
   * 20260919-one-idea §3b.1 and §3b.2): `recordedAt` is the head count a green
   * fill came from, and `readiness` is what was known about the holder *even
   * where a recorded fact outranked it* — "aboard, and nobody ever cleared
   * them" is the sentence an investigator asks for, and a hull is what gets
   * photographed. Drawing either of them is the manifest's own work; §3b says
   * so, and says which half is left.
   */
  reading: SeatReading;
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
      // `print:hidden` is not the caller's to opt out of — see the note above:
      // the print palette flattens four of the six states into two inks, so the
      // rows carry the paper and the picture stands down.
      className={`${className ?? "block h-auto w-full"} print:hidden`}
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
        /* A place the roster does not reach: nobody has taken it, nothing was
           recorded, and there is no holder whose readiness could be read. */
        const content: HullSeatContent = seats[seat.index] ?? {
          reading: { state: "open", checkpoint: null, readiness: null },
        };
        const edge = SEAT_LINE[content.reading.state];
        return (
          <g key={seat.index}>
            <rect
              x={seat.x}
              y={seat.y}
              width={seat.width}
              height={seat.height}
              rx={seat.rx}
              fill={SEAT_FILL[content.reading.state]}
              stroke={edge.stroke ?? line}
              strokeOpacity={edge.opacity}
              strokeDasharray={edge.dashed ? "3 3" : undefined}
              strokeWidth={1.5}
            />
            {/* A stated "did not come back" is the loudest thing on the boat and
                the only seat that wears a ring — the same rule, and the same
                2026-08-04 dive-domain review, that gives the roll call's rows
                exactly one ring. Full opacity and a wider line than the seat's
                own: a half-transparent 2-unit halo at this scale is a rendering
                artifact, not a distinction (dive-domain review 20260919), and
                the thing it has to be told apart from means somebody's waiver
                is unsigned rather than somebody is still in the water. */}
            {content.reading.state === "missing" ? (
              <rect
                x={seat.x - 3.5}
                y={seat.y - 3.5}
                width={seat.width + 7}
                height={seat.height + 7}
                rx={seat.rx + 2}
                fill="none"
                stroke={SEAT_FILL.missing}
                strokeWidth={2.5}
              />
            ) : null}
            {/* **The mark that says nobody has said anything.** A dashed inset,
                *inside* a seat whose own line stays solid, so the seat still
                reads as occupied while the inside of it reads as unsettled.
                It is geometry rather than hue on purpose: the print palette
                flattens `--surface` and `--surface-sunken` to the same white,
                so the slate fill alone would not survive paper — and it does
                not need the two letters, which `hullGeometry` drops above
                eight columns on every boat larger than a six-pack. */}
            {content.reading.state === "awaiting" ? (
              <rect
                x={seat.x + 4}
                y={seat.y + 4}
                width={seat.width - 8}
                height={seat.height - 8}
                rx={Math.max(2, seat.rx - 3)}
                fill="none"
                stroke="var(--border-strong)"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
            ) : null}
            {geometry.showsInitials && content.initials ? (
              <text
                x={seat.centerX}
                y={seat.centerY + 4}
                textAnchor="middle"
                fontSize={11.5}
                fontWeight={700}
                fill={SEAT_INK[content.reading.state]}
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
