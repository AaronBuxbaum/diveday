/**
 * **The boat, as geometry** — ADR 20260919-one-idea, decision I · Tide: "a
 * departure's page is Deck's hull".
 *
 * A hull is an object a crew recognises before reading a word: a shape in the
 * boat's own colour with its seats laid out bow to stern, one seat per place
 * the boat has. This module turns a capacity into the numbers that picture is
 * made of, and does nothing else — no colour, no words, no element. `Hull`
 * places what comes out.
 *
 * **Seats are never numbered and never assigned** (the ADR, and Deck's own
 * rule). A seat fills in booking order; which rectangle a diver lands in means
 * nothing, and no booking rule changes because of one. The picture is the count
 * made spatial. The risk this carries is implied precision — a reader taking it
 * for a seating plan — and the whole defence is that no number is ever drawn on
 * a seat, so there is nothing to mistake for an assignment.
 *
 * **It informs and gates nothing.** No capacity, readiness, admission or
 * manifest rule reads a coordinate from here, exactly like the sky.
 *
 * Every number below is in one viewBox-shaped space so a caller can scale the
 * whole hull with CSS and never recompute. The constants are the ones the
 * canvas was drawn at (`docs/design/canvases/20260919-one-idea/Deck.dc.html`),
 * kept to the unit so the built hull is the drawn one.
 */

import type { RollCallRecordedTone } from "@/lib/manifests";

/** A seat's box, and the pitch between two of them. */
const SEAT_W = 34;
const SEAT_H = 32;
export const SEAT_RX = 9;
const COL_PITCH = 42;
/** The first seat's left edge, inboard of the hull's own line. */
const FIRST_SEAT_X = 24;
/** The two benches, by their top edge. */
const ROW_Y = [34, 84] as const;
/** The gunwales. */
const HULL_TOP = 26;
const HULL_BOTTOM = 124;
/** The transom, and the radius its two corners are cut at. */
const TRANSOM_X = 6;
const TRANSOM_RADIUS = 10;
export const VIEW_HEIGHT = 150;
/** The waterline the hull is drawn about, and the centre line's own height. */
const MIDLINE_Y = 75;
/** How far the bow reaches beyond the last seat, and the room after it. */
const BOW_LENGTH = 96;
const BOW_MARGIN = 8;
/** The wheelhouse: crew inboard of the bow, and the helm ahead of them. */
const CREW_R = 12;
const HELM_RING_R = 9;
const HELM_DOT_R = 2.5;
const CREW_Y = [56, 94] as const;

/**
 * The most crew the wheelhouse holds before the picture stops being a boat and
 * starts being a queue. Two is what the canvas drew, and a third guide is a
 * name in the crew line rather than a circle in the bow.
 */
const CREW_IN_WHEELHOUSE = 2;

/**
 * Above this many columns two initials stop being letters and become texture.
 *
 * The hull keeps its aspect — a boat is a shape, not a curve that may flatten —
 * so everything on it scales with the width, the lettering included. The
 * measure is therefore the *text*, not the seat: 390px of phone across a hull
 * of `42·cols + 106` units renders the canvas's 11.5-unit initials at
 * `390 · 11.5 / (42·cols + 106)` pixels — 10.1 at eight columns, 7.1 at twelve,
 * 4.4 at twenty. Eight columns is a boat of sixteen, which is past the size of
 * an ordinary dive boat; above it the seats stay and the letters go, and the
 * picture is still the count made spatial, which is the whole point of drawing
 * it rather than listing it.
 */
const MAX_COLUMNS_WITH_INITIALS = 8;

/** A boat has two benches. Everything else about it follows from its capacity. */
const ROWS = 2;

/**
 * What the colour picker opens on for a hull nobody has painted.
 *
 * `<input type="color">` cannot hold `var(--border-strong)` — it needs a
 * concrete value — so the picker opens on the neutral that token *is* in light
 * mode while the hull itself stays unpainted, drawn in the page's own ink,
 * until the shop actually picks. This is a control's default value rather than
 * a style, which is why it lives here and not in a component.
 */
export const UNPAINTED_HULL_PICKER_COLOR = "#8e8e93";

export type HullSeat = {
  /** The seat's place in booking order, from 0. Never drawn, never assigned. */
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The middle of the seat, for a word centred on it. */
  centerX: number;
  centerY: number;
};

export type HullGeometry = {
  width: number;
  height: number;
  /** The hull's outline, transom to bow and back. */
  outline: string;
  /** The dashed line down the middle of the deck. */
  midline: { x1: number; x2: number; y: number };
  seats: HullSeat[];
  /** Where a crew member's circle goes; at most two fit in the wheelhouse. */
  crew: { index: number; cx: number; cy: number; r: number }[];
  /** Crew the wheelhouse could not hold, for the caller to name in words. */
  crewOverflow: number;
  helm: { cx: number; cy: number; ringRadius: number; dotRadius: number };
  /**
   * Whether a seat is big enough to carry two initials at phone width. A hull
   * that says no is not a lesser picture — it is a bigger boat.
   */
  showsInitials: boolean;
};

/**
 * The hull for a boat of `capacity`, with `crewCount` in the wheelhouse.
 *
 * A capacity of zero or less has no boat in it — answer with an empty geometry
 * rather than a hull with no seats, which would draw as an empty shell and read
 * as a data problem the reader cannot act on.
 */
export function hullGeometry(input: { capacity: number; crewCount?: number }): HullGeometry {
  // `Math.max(0, NaN)` is `NaN`, and `NaN < 1` is false — so a capacity that is
  // not a number walks straight past a lower bound and out the other side as a
  // path full of `NaN`s. Finiteness is the first question, not the last.
  const capacity = Number.isFinite(input.capacity) ? Math.max(0, Math.floor(input.capacity)) : 0;
  const columns = Math.ceil(capacity / ROWS);
  if (columns < 1) return emptyHull();

  // Where the gunwales stop being straight and the bow begins: past the last
  // seat, with room for it to sit inboard of the line. Six columns put it at
  // 278 and four at 194, which is what the canvas drew.
  const bow = COL_PITCH * columns + FIRST_SEAT_X + 2;
  const width = bow + BOW_LENGTH + BOW_MARGIN;

  const seats: HullSeat[] = [];
  for (let index = 0; index < capacity; index += 1) {
    // Booking order runs along one bench from the transom forward, then along
    // the other — the order Deck drew, and the order a crew calls names in.
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = FIRST_SEAT_X + COL_PITCH * column;
    const y = ROW_Y[Math.min(row, ROW_Y.length - 1)];
    seats.push({
      index,
      x,
      y,
      width: SEAT_W,
      height: SEAT_H,
      centerX: x + SEAT_W / 2,
      centerY: y + SEAT_H / 2,
    });
  }

  const crewCount = Math.max(0, Math.floor(input.crewCount ?? 0));
  const seated = Math.min(crewCount, CREW_IN_WHEELHOUSE);
  const crew = Array.from({ length: seated }, (_, index) => ({
    index,
    cx: bow + 44,
    // One guide stands where the canvas put them rather than in the middle of
    // the wheel; two take the pair of stations the canvas drew.
    cy: seated === 1 ? CREW_Y[0] : CREW_Y[index],
    r: CREW_R,
  }));

  return {
    width,
    height: VIEW_HEIGHT,
    outline: outlinePath(bow),
    midline: { x1: TRANSOM_X + TRANSOM_RADIUS, x2: bow + 20, y: MIDLINE_Y },
    seats,
    crew,
    crewOverflow: crewCount - seated,
    helm: {
      cx: bow + 56,
      cy: MIDLINE_Y,
      ringRadius: HELM_RING_R,
      dotRadius: HELM_DOT_R,
    },
    showsInitials: columns <= MAX_COLUMNS_WITH_INITIALS,
  };
}

/**
 * Transom to bow and back: a square stern with its corners cut, two straight
 * gunwales, and a bow that comes to a point on the waterline.
 */
function outlinePath(bow: number): string {
  const r = TRANSOM_RADIUS;
  const left = TRANSOM_X;
  const corner = left + r;
  return [
    `M${corner},${HULL_TOP}`,
    `L${bow},${HULL_TOP}`,
    `C${bow + 52},${HULL_TOP} ${bow + 82},${HULL_TOP + 26} ${bow + BOW_LENGTH},${MIDLINE_Y}`,
    `C${bow + 82},${HULL_BOTTOM - 26} ${bow + 52},${HULL_BOTTOM} ${bow},${HULL_BOTTOM}`,
    `L${corner},${HULL_BOTTOM}`,
    `Q${left},${HULL_BOTTOM} ${left},${HULL_BOTTOM - r}`,
    `L${left},${HULL_TOP + r}`,
    `Q${left},${HULL_TOP} ${corner},${HULL_TOP}`,
    "Z",
  ].join(" ");
}

function emptyHull(): HullGeometry {
  return {
    width: 0,
    height: VIEW_HEIGHT,
    outline: "",
    midline: { x1: 0, x2: 0, y: MIDLINE_Y },
    seats: [],
    crew: [],
    crewOverflow: 0,
    helm: { cx: 0, cy: MIDLINE_Y, ringRadius: HELM_RING_R, dotRadius: HELM_DOT_R },
    showsInitials: true,
  };
}

/**
 * **What a seat is wearing.**
 *
 * One vocabulary for the hull, derived from the two the boat already speaks —
 * `readiness.ts`'s ready-or-blocked at the dock, and `manifests.ts`'s recorded
 * roll-call tone — so a colour on the hull can never disagree with the same
 * person's row in the roll call beneath it. The fills themselves are the row
 * tones' (`src/components/row-tones.ts`); this decides only which one.
 *
 * Colour never carries a state alone here either: every seat is said again in
 * the roster rows under the hull, and the hull as a whole carries one sentence
 * for a reader who cannot see it (design principle 6).
 */
export type SeatState =
  /** Nobody has taken this place. */
  | "open"
  /** Booked, nothing recorded, and nothing stopping them boarding. */
  | "booked"
  /** Booked, and readiness says they cannot board. */
  | "blocked"
  /** A human recorded them aboard. */
  | "aboard"
  /** A human recorded them ashore — either flavour, stated or carried forward. */
  | "ashore"
  /** After the dive, a human said they did not come back (DOM-H3). */
  | "missing";

/**
 * Every recorded tone's seat, as a total map rather than a chain of ifs.
 *
 * A tone added to `RollCallRecordedTone` without a meaning here is a **compile**
 * error, which is the same brace `src/components/row-tones.ts` uses and for the
 * same reason: the alternative is a seat that silently renders as an ordinary
 * booking on the one surface a crew uses to decide whether anyone is missing.
 */
const SEAT_OF_RECORDED_TONE: Record<RollCallRecordedTone, SeatState> = {
  notBackAboard: "missing",
  boarded: "aboard",
  notBoarded: "ashore",
  notBoardedImplied: "ashore",
};

/**
 * The seat a place is wearing.
 *
 * A place with no booking is open. A booking wears what a human recorded, and
 * where nobody has recorded anything it wears readiness — which is the dock's
 * question ("may they board?") rather than the deck's ("did they?"), and is
 * exactly the order the roll call reads them in.
 */
export function seatStateFor(place: {
  /** Null where the boat has this place and nobody has taken it. */
  booking: { readiness: "ready" | "blocked" } | null;
  /** What a human recorded at this checkpoint, from `rollCallRecordedTone`. */
  recorded: RollCallRecordedTone | null;
}): SeatState {
  if (!place.booking) return "open";
  if (place.recorded) return SEAT_OF_RECORDED_TONE[place.recorded];
  return place.booking.readiness === "blocked" ? "blocked" : "booked";
}
