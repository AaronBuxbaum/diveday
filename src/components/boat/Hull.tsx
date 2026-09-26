import type { CrewReading, CrewState, HullGeometry, SeatReading, SeatState } from "@/lib/hull";

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
 * - **awaiting** — the rows' own slate, a solid line at full weight, and a
 *   dashed box *inside* it. Solid outside because a body is in this seat;
 *   unsettled inside because nobody has said anything about them yet (§3b.5).
 * - **blocked** — the danger *tint* behind a danger line and danger ink
 *   (5.45:1, measured in `globals.css`). Quiet, like its row.
 * - **aboard / ashore** — the success and warning fills, solid, white ink.
 * - **ashoreImplied** — the warning *tint* behind a **dashed** warning line.
 *   Nobody said this person stayed ashore; the dock's silence was carried
 *   forward, and an inference never wears a stated line (§3b.3).
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
 * **It prints, and paper is a second language.** It did not until the sheet had
 * a treatment of its own: the print palette flattens `--success` and
 * `--warning` onto one near-black, so `aboard` and `ashore` — the only two
 * answers a head count has — came off a printer identical, and the picture
 * stood down rather than lie. `@media print` in `globals.css` now re-cuts all
 * eight (ADR 20260919-one-idea §3b.4), and the classes on the elements below
 * exist for it to reach. Three rules govern that sheet, and none of them is
 * the screen's:
 *
 * 1. **A fill means a body is in this boat**, and `aboard` is the only state
 *    that has one. Every absence is an empty seat, `missing` included — a
 *    diver who did not come back aboard is the last person to say otherwise
 *    about.
 * 2. **An inner mark means the seat is spoken for and the body is not in it**
 *    — solid for a stated `ashore`, dashed for an `awaiting` nobody has read.
 * 3. **The heaviest line always means a person is not accounted for.** That
 *    ordering is the invariant below, and it is why `blocked` is heavier than
 *    an ordinary seat and lighter than `missing`, which also wears the ring
 *    and the one diagonal in the picture.
 *
 * So "a line at full weight means a body is in this seat" holds on screen and
 * is *not* the paper rule: there, a full-weight line means the seat is spoken
 * for, and the fill is what says the body is in it.
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
/**
 * **The seat states that carry an inner mark**, and what the mark means.
 *
 * On screen only `awaiting` draws one. The other two render the element with
 * no stroke, because paper needs a mark there and CSS can give it one:
 * `@media print` in `globals.css` strokes `.hull-seat-inset-ashore` and
 * `-ashore-implied`, and a rule always beats a presentation attribute. An
 * element that is not in the document cannot be styled into existence, which
 * is the whole reason they are drawn at all (ADR 20260919-one-idea §3b.4).
 */
const INSET_STATES = new Set<SeatState>(["awaiting", "ashore", "ashoreImplied"]);

/** `ashoreImplied` → `ashore-implied`; every other state is already one word. */
const kebab = (state: SeatState) => state.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

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

/**
 * **What a guide's circle paints** — ADR 20260919-one-idea §3b.6.
 *
 * Its own map rather than a reuse of `SEAT_FILL`, because a crew member's
 * vocabulary is not a diver's: three of the seat's eight are readiness, which
 * a guide holds none of, and `rostered` is a sixth the seats have no need for.
 * A `Record<CrewState, …>` is what makes adding a state without deciding how
 * it looks a compile error, which is the same brace the seats use.
 */
const CREW_FILL: Record<CrewState, string | null> = {
  /**
   * `null` is the hull's own line at 18% — the drawing a guide has always
   * had, and the one a surface with no head count must keep. A page with no
   * roll call in it may not paint a person as a question.
   */
  rostered: null,
  /** Nothing said about this person yet — the slate the rows give `awaiting`. */
  awaiting: "var(--surface-sunken)",
  aboard: "var(--success)",
  ashore: "var(--warning)",
  /** The tint, not the fill — an inference does not get the stated colour. */
  ashoreImplied: "var(--warning-tint)",
  /**
   * **Empty, like the seat's.** `notBackAboard` means *not* aboard, and a
   * filled circle is what this picture says about somebody who is. The weight
   * below and the ring and cross are what make it the loudest mark on the
   * boat without borrowing the mark that means the opposite.
   */
  missing: "none",
};

/**
 * The line around each guide, and how heavily it is drawn.
 *
 * `null` is the hull's own line, as it is for the seats. Everything that is
 * not `rostered` states its own colour, because a circle that differs from its
 * neighbour only in fill has no reading left once print flattens the hue —
 * which is the whole lesson of §3b.4.
 */
const CREW_LINE: Record<CrewState, { stroke: string | null; width: number; dashed: boolean }> = {
  rostered: { stroke: null, width: 1.5, dashed: false },
  awaiting: { stroke: "var(--border-strong)", width: 1.5, dashed: false },
  aboard: { stroke: "var(--success)", width: 1.5, dashed: false },
  ashore: { stroke: "var(--warning)", width: 1.5, dashed: false },
  /** Dashed for the reason the seat's is: nobody *said* this (§3b.3). */
  ashoreImplied: { stroke: "var(--warning)", width: 1.5, dashed: true },
  /** The heaviest line on the boat, and the only one that is. */
  missing: { stroke: "var(--danger)", width: 3, dashed: false },
};

/** The ink two initials take on each crew fill, paired as the seats' are. */
const CREW_INK: Record<CrewState, string> = {
  rostered: "var(--foreground)",
  awaiting: "var(--foreground)",
  aboard: "var(--surface)",
  ashore: "var(--surface)",
  /** Warning on its own tint, the pairing `blocked` already uses. */
  ashoreImplied: "var(--warning)",
  /** On an empty circle the letters sit on the page, not on a fill. */
  missing: "var(--danger)",
};

/**
 * **The crew states that carry an inner mark**, and why each needs one.
 *
 * Paper has three channels — fill, weight, dash — and six states to tell
 * apart, so three of them are separated by a shape inside the circle rather
 * than by a fourth channel that does not exist. The seats reached the same
 * conclusion and this is deliberately the same answer, drawn round: two halves
 * of one boat may not speak two visual languages.
 *
 * - `awaiting` against `rostered`: both are "nothing has been said", but only
 *   one of them is a **gap in a head count**. Without a mark they print as one
 *   circle, which the test below caught on the first run.
 * - `ashore` against `rostered`: a stated fact and a roster entry are not the
 *   same claim, and on paper the outline alone made them one.
 * - `ashoreImplied` rides the same inset with a dashed outline, exactly as the
 *   seat does — the statement and the inference share an inside and differ on
 *   the line, which is §3b.3's rule drawn rather than written.
 */
const CREW_INSET_STATES = new Set<CrewState>(["awaiting", "ashore", "ashoreImplied"]);

/** `ashoreImplied` → `ashore-implied`; every other state is already one word. */
const crewKebab = (state: CrewState) => state.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * A guide in the wheelhouse.
 *
 * The same shape `HullSeatContent` has, for the same reason: the picture needs
 * the reading rather than the bare state, so the head count a green circle
 * came from rides out with it and the sentence can name it later.
 */
export type HullCrewContent = {
  /** The mark as `crewReadingFor` read it. */
  reading: CrewReading;
  /**
   * Two letters, already shortened by the caller. Absent for a guide whose
   * name would not letter — the circle is still drawn, because a person with
   * an awkward name is still a person on the boat.
   */
  initials?: string;
};

export type HullSeatContent = {
  /**
   * The seat as `seatReadingFor` read it — not the bare state.
   *
   * The picture paints `reading.state` and nothing else today. The other two
   * fields ride along because the derivation may not throw them away (ADR
   * 20260919-one-idea §3b.1 and §3b.2): `checkpoint` is the head count a green
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
  crew = [],
  className,
}: {
  geometry: HullGeometry;
  /** The whole boat in one sentence, for a reader who cannot see it. */
  label: string;
  /** What each place is wearing, in booking order. A short list leaves the rest open. */
  seats?: readonly HullSeatContent[];
  /** The shop's colour for this hull, or null for one nobody has painted. */
  color?: string | null;
  /**
   * The guides in the wheelhouse, **in crew order and with holes kept**: an
   * entry whose `initials` are absent is a crew member whose name would not
   * letter, and the circle is still drawn, because a person with an awkward
   * name is still a person on the boat. Only the first two are drawn —
   * `hullGeometry` returns the rest as `crewOverflow`, and the caller says
   * that number in words.
   *
   * Each carries a reading rather than a name, which is §3b.6: a guide used to
   * have one state where a diver had eight, so the better the seats got the
   * more confidently the whole picture read "all good" over a divemaster who
   * went back down for a weight belt.
   */
  crew?: readonly HullCrewContent[];
  className?: string;
}) {
  if (geometry.seats.length === 0) return null;
  // An unpainted hull is drawn in the page's own ink — a perfectly good boat,
  // and the one every hull was before `boats.hull_color` existed.
  const line = color ?? "var(--border-strong)";

  return (
    <>
      <svg
        viewBox={`${geometry.viewBox.x} ${geometry.viewBox.y} ${geometry.viewBox.width} ${geometry.viewBox.height}`}
        // **The hull prints.** It used to carry `print:hidden`, because the print
        // palette collapses `--success` and `--warning` onto one near-black and
        // leaves the tints alone, so `aboard` and `ashore` — the two answers a
        // head count has — came out of a printer pixel-identical. Every class
        // below exists so `@media print` can re-cut that on paper by weight,
        // dash and an inner mark instead of by hue (ADR 20260919-one-idea
        // §3b.4). Nothing here changes what the screen draws.
        className={`hull ${className ?? "block h-auto w-full"}`}
        role="img"
        aria-label={label}
      >
        <title>{label}</title>
        <path
          className="hull-body"
          d={geometry.outline}
          fill={color ?? "var(--surface-sunken)"}
          fillOpacity={color ? 0.12 : 1}
          stroke={line}
          strokeWidth={1.5}
        />
        <line
          className="hull-midline"
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
          const state = content.reading.state;
          const edge = SEAT_LINE[state];
          return (
            <g key={seat.index}>
              <rect
                className={`hull-seat hull-seat-${kebab(state)}`}
                x={seat.x}
                y={seat.y}
                width={seat.width}
                height={seat.height}
                rx={seat.rx}
                fill={SEAT_FILL[state]}
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
              {state === "missing" ? (
                <rect
                  className="hull-seat-ring"
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
              {/* **The one seat that is crossed out**, and only on paper.
                `missing` is `notBackAboard`: the diver did not come back
                aboard, so on a sheet where a *fill* means a body is in this
                boat, this seat is empty like every other absence — and then
                marked, because it is the one absence nobody has accounted
                for. On screen the alarm is red and the cross would be noise;
                the print sheet strokes it (ADR 20260919-one-idea §3b.4,
                dive-domain review 20260920). */}
              {state === "missing" ? (
                <path
                  className="hull-seat-cross"
                  d={`M${seat.x + 5} ${seat.y + 5}L${seat.x + seat.width - 5} ${seat.y + seat.height - 5}M${seat.x + seat.width - 5} ${seat.y + 5}L${seat.x + 5} ${seat.y + seat.height - 5}`}
                  fill="none"
                  stroke="none"
                  strokeWidth={2}
                  strokeLinecap="round"
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
              {INSET_STATES.has(state) ? (
                <rect
                  className={`hull-seat-inset hull-seat-inset-${kebab(state)}`}
                  x={seat.x + 4}
                  y={seat.y + 4}
                  width={seat.width - 8}
                  height={seat.height - 8}
                  rx={Math.max(2, seat.rx - 3)}
                  fill="none"
                  stroke={state === "awaiting" ? "var(--border-strong)" : "none"}
                  strokeDasharray={state === "awaiting" ? "3 3" : undefined}
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
                  className={`hull-seat-ink hull-seat-ink-${kebab(state)}`}
                  fill={SEAT_INK[state]}
                >
                  {content.initials}
                </text>
              ) : null}
            </g>
          );
        })}

        {geometry.crew.map((station) => {
          // A station with no entry is a boat whose crew list is shorter than
          // its wheelhouse — draw the circle the guide has always had rather
          // than inventing a state for somebody who is not there.
          const member = crew[station.index];
          const state = member?.reading.state ?? "rostered";
          const fill = CREW_FILL[state];
          const stroke = CREW_LINE[state];
          return (
            <g key={station.index}>
              <circle
                className={`hull-crew hull-crew-${crewKebab(state)}`}
                cx={station.cx}
                cy={station.cy}
                r={station.r}
                fill={fill ?? line}
                fillOpacity={fill === null ? 0.18 : 1}
                stroke={stroke.stroke ?? line}
                strokeWidth={stroke.width}
                strokeDasharray={stroke.dashed ? "4 3" : undefined}
              />
              {/* The inner ring that separates the three above from a guide
                  the page has nothing to say about. Stroked here only for
                  `awaiting`, whose doubt is worth showing on screen too; the
                  other two are drawn unstroked so `@media print` can reach
                  them — a rule beats a presentation attribute, but it cannot
                  style an element that is not in the document. */}
              {CREW_INSET_STATES.has(state) ? (
                <circle
                  className={`hull-crew-inset hull-crew-inset-${crewKebab(state)}`}
                  cx={station.cx}
                  cy={station.cy}
                  r={station.r - 4}
                  fill="none"
                  stroke={state === "awaiting" ? "var(--border-strong)" : "none"}
                  strokeDasharray={state === "awaiting" ? "3 3" : undefined}
                  strokeWidth={1}
                />
              ) : null}
              {/* **The ring and the cross a missing guide wears**, drawn for
                  the reason the seat's are: paper cannot tell `--danger` from
                  `--warning`, so the loudest thing on the boat needs a mark
                  that is a shape rather than a hue. Stroked only under print
                  for the ring — a rule beats a presentation attribute, but it
                  cannot style an element that is not in the document. */}
              {state === "missing" ? (
                <>
                  <circle
                    className="hull-crew-ring"
                    cx={station.cx}
                    cy={station.cy}
                    r={station.r + 3}
                    fill="none"
                    stroke="none"
                    strokeWidth={1}
                  />
                  <path
                    className="hull-crew-cross"
                    d={`M${station.cx - 5} ${station.cy - 5}L${station.cx + 5} ${station.cy + 5}M${station.cx + 5} ${station.cy - 5}L${station.cx - 5} ${station.cy + 5}`}
                    fill="none"
                    stroke="var(--danger)"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                </>
              ) : null}
              {geometry.showsInitials && member?.initials && state !== "missing" ? (
                <text
                  className={`hull-crew-ink-${crewKebab(state)}`}
                  x={station.cx}
                  y={station.cy + 4}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontWeight={700}
                  fill={CREW_INK[state]}
                >
                  {member.initials}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* The helm, which is what makes the shape read as a boat rather than a tray. */}
        <circle
          className="hull-helm"
          cx={geometry.helm.cx}
          cy={geometry.helm.cy}
          r={geometry.helm.ringRadius}
          fill="none"
          stroke={line}
          strokeWidth={1.5}
        />
        <circle
          className="hull-helm-dot"
          cx={geometry.helm.cx}
          cy={geometry.helm.cy}
          r={geometry.helm.dotRadius}
          fill={line}
        />
      </svg>
      {/* **The sentence, printed.** `<title>` is an accessible name and a
          tooltip; it is never ink. On screen the rows under the hull say every
          one of these facts in words, and a reader who cannot see the picture
          is given the same sentence — but on paper a letterless hull (every
          boat over eight columns, which `hull.ts` calls the normal case) would
          otherwise be a grid of unlabelled boxes in a visual language that
          exists nowhere else in the product, on the one artifact used when the
          app is not there to explain it. So the sentence goes on the sheet
          too, and it is the same string, which is why it cannot drift from the
          picture (dive-domain review 20260920). */}
      <p className="hidden print:block mt-1 text-xs text-foreground">{label}</p>
    </>
  );
}
