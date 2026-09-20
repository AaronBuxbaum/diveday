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
 * made spatial.
 *
 * **The absent number is not what makes that true**, and a dive-domain review
 * on 2026-09-19 was right to say so: two letters inside a rectangle at a fixed
 * place on a drawing of a real boat is a position whether or not a numeral sits
 * beside them. What makes it safe is that nothing stores one and nothing reads
 * one — the glossary closes that door in as many words under **Roll-call
 * order** ("a number a diver keeps for the day ... is a stored fact about a
 * person on a departure, not a position in a list"), and the roll is called by
 * name from `getTripRoster`, in seat-age order, with no bench anywhere in it.
 * The layout is therefore *unstable on purpose*: a seat released and resold
 * moves everyone after it, which is harmless for a count and would be a hazard
 * for a plan. Anything that would make a rectangle mean something — a stored
 * station, a bench a crew is told to call — needs its own decision, not this
 * module.
 *
 * **It informs and gates nothing.** No capacity, readiness, admission or
 * manifest rule reads a coordinate from here, exactly like the sky.
 *
 * Every number below is in one viewBox-shaped space so a caller can scale the
 * whole hull with CSS and never recompute. The constants are the ones the
 * canvas was drawn at (`docs/design/canvases/20260919-one-idea/Deck.dc.html`),
 * kept to the unit so the built hull is the drawn one.
 */

import type { RollCallCheckpoint, RollCallRecordedTone } from "@/lib/manifests";

/** A seat's box, and the pitch between two of them. */
const SEAT_W = 34;
const SEAT_H = 32;
const SEAT_RX = 9;
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
 * How many of a departure's crew the picture will not draw.
 *
 * The geometry already returns this as `crewOverflow`, and for its first
 * fortnight nothing read it — so a departure with four guides drew two circles
 * and left two human beings out of a drawing of a boat, silently. On screen
 * that is recoverable, because the crew line is on the same page; on paper it
 * is a picture of a whole boat missing two souls, and paper is what gets
 * carried when the app is not there. The surface that writes the hull's
 * sentence calls this and says the number out loud (dive-domain review
 * 20260920; ADR 20260919-one-idea §3b.6).
 */
export function crewNotDrawn(crewCount: number): number {
  return Math.max(0, crewCount - CREW_IN_WHEELHOUSE);
}

/**
 * Above this many columns two initials stop being letters and become texture.
 *
 * The hull keeps its aspect — a boat is a shape, not a curve that may flatten —
 * so everything on it scales with the width, the lettering included. The
 * measure is therefore the *text*, not the seat: 390px of phone across a hull
 * of `42·cols + 106` units renders the canvas's 11.5-unit initials at
 * `390 · 11.5 / (42·cols + 106)` pixels — 10.1 at eight columns, 7.1 at twelve,
 * 4.4 at twenty. Above the threshold the seats stay and the letters go, and the
 * picture is still the count made spatial, which is the whole point of drawing
 * it rather than listing it.
 *
 * **The letterless hull is not an edge case.** An earlier draft of this comment
 * called a boat of sixteen "past the size of an ordinary dive boat"; a
 * dive-domain review corrected it, and it was wrong about the market this
 * product is for — Florida and Caribbean day boats routinely run twenty to
 * thirty divers, and the ADR's own weakness note imagines forty. So every
 * operator above a six-pack reads the letterless hull as their *normal*, and
 * the seats must tell one state from another with no lettering to help them:
 * that is why `Hull` draws a booked seat with an outline rather than a fill
 * alone.
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
  /**
   * The seat's corner, so the one radius the canvas drew travels with the box
   * rather than being re-typed at the element. It used to be a loose export
   * with no consumer while `Hull` hard-coded a 9 beside it — two spellings of
   * one number, which is how a picture stops being the drawn one.
   */
  rx: number;
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
    // the other — the order Deck drew. **Not** an order anyone calls: the roll
    // is read by name from `getTripRoster`, and a sentence here claiming
    // otherwise is what would persuade the next reader the geometry means
    // something (dive-domain review 20260919).
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
      rx: SEAT_RX,
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
 * roll-call tone. The fills themselves are the row tones'
 * (`src/components/row-tones.ts`); this decides only which one.
 *
 * **It used to be coarser than the rows in one place, and is not any more.**
 * `notBoarded` and `notBoardedImplied` are two row treatments — the rows give
 * the implied one a quieter, dashed reading, because an alarm is earned by a
 * recorded fact and never by the absence of one (ADR 20260827, decision 4) —
 * and both used to land on `ashore` here, a picture declining to tell a
 * statement from an inference. They are `ashore` and `ashoreImplied` now, in
 * the rows' own weights (ADR 20260919-one-idea §3b.3).
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
  /**
   * **Nobody has said anything about this person at this checkpoint.**
   *
   * One state for the same idea at two head counts, which is the word the
   * roll-call rows already use (`ROLL_CALL_ROW_TONE.awaiting`, "nothing has
   * been said about that person yet"):
   *
   * - At the dock, nobody has read their readiness. `rosterRowIsBlocked` fails
   *   open, so this used to paint as an ordinary held seat — the picture
   *   saying "fine" where the truth was "nobody looked" (§3b.5).
   * - After a dive, nobody has counted them back. Readiness is not the
   *   question there at all: the glossary's **Held** entry says readiness
   *   "exists only at the dock … after a dive roll call is a physical head
   *   count", so a seat that answered the dock's question at `after_dive_2`
   *   was a picture of a settled diver over somebody who may be in the water
   *   (dive-domain review 20260919, second pass).
   *
   * A picture of a boat may be coarse; it may not be confidently wrong.
   */
  | "awaiting"
  /** A human recorded them aboard. */
  | "aboard"
  /** A human **said** they are ashore: they never left the dock. */
  | "ashore"
  /**
   * Nobody said anything, and the absence was carried forward as "ashore"
   * (ADR 20260919-one-idea §3b.3).
   *
   * Its own state rather than a second spelling of `ashore`, because ADR
   * 20260827 decision 4 is that an alarm is earned by a recorded fact and
   * never by the absence of one. The rows already give this the quieter,
   * dashed reading; painting it identically to a stated `ashore` was the
   * picture turning an inference into a statement.
   */
  | "ashoreImplied"
  /** After the dive, a human said they did not come back (DOM-H3). */
  | "missing";

/**
 * What readiness said about a seat's holder — including that nobody asked.
 *
 * `unknown` is not a third opinion between ready and blocked. It is the
 * absence of one, and it is here because `rosterRowIsBlocked` fails open and
 * cannot tell a caller which of those two it just gave them (§3b.5).
 */
export type SeatReadiness = "ready" | "blocked" | "unread";

/**
 * **Not `unknown`**, deliberately. The glossary already owns that word for an
 * *aboard blocker kind* — "nothing on file that clears them … a failed
 * readiness lookup" — which is a diver who **is** blocked. This one is neither
 * blocked nor cleared, so reusing the word would put the fail-open and
 * fail-closed directions under one name on a boarding surface.
 *
 * It is also not a third readiness *status*: `Blocked / Ready` are still the
 * only two a readiness check has. `unread` says the check did not happen.
 */

/**
 * A seat, read — what it paints, what was recorded and where, and what
 * readiness said **whether or not the recorded fact outranked it**.
 *
 * A record rather than the bare `SeatState` it used to be, for the sentence an
 * investigator asks for (ADR 20260919-one-idea §3b.2): *"aboard, and nobody
 * ever cleared them"*. Precedence is unchanged and correct — a body on the
 * boat is a fact, readiness is a decision, and the picture may not argue with
 * the row beneath it — but a flat union **discarded** the readiness at the
 * moment of derivation, and the roll-call row that still carries it in words
 * is not what gets photographed. The hull is.
 *
 * Named for the shape `skyReadingFor` already uses in this codebase: a reading
 * is what a thing says when you look at it, with everything that went into it
 * still attached.
 */
export type SeatReading = {
  /** What the picture paints. */
  state: SeatState;
  /**
   * **The head count this seat is being drawn at** — not a time, despite every
   * other `*At` in this codebase being one, which is why it is not called one.
   * Null on a surface with no roll call in it at all, which is the departure
   * page today.
   *
   * Green at the dock means "got on the boat"; green after dive two means
   * "came back", and no reader can tell those apart from the fill alone. It is
   * the checkpoint *being drawn* rather than the one a record was written at,
   * because a carried-forward `ashoreImplied` is by definition recorded at the
   * dock and displayed later — and the sentence a reader needs is about the
   * count in front of them.
   */
  checkpoint: RollCallCheckpoint | null;
  /**
   * What readiness said, kept even where a recorded fact outranks it. Null on
   * a place nobody has taken — an open seat has no holder to clear.
   */
  readiness: SeatReadiness | null;
};

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
  notBoardedImplied: "ashoreImplied",
};

/**
 * A place on a boat, as the derivation needs it.
 *
 * Two arms rather than three fields, so **a recorded tone cannot arrive
 * without the head count it belongs to** (§3b.1) and nothing has to remember
 * to pass one: a surface with no roll call in it says so once, and a surface
 * with a roll call names the checkpoint it is drawing. `recorded: never` on
 * the first arm is what makes handing a tone to a dock-only picture a `tsc`
 * error rather than a comment asking nobody to do it.
 */
export type SeatPlace = {
  /** Null where the boat has this place and nobody has taken it. */
  booking: { readiness: SeatReadiness } | null;
} & (
  | {
      /** No roll call on this surface — the departure page as it stands. */
      at?: null;
      recorded?: never;
    }
  | {
      /** The head count being drawn. */
      at: RollCallCheckpoint;
      /** What a human recorded at it, from `rollCallRecordedTone`. */
      recorded: RollCallRecordedTone | null;
    }
);

/**
 * The seat a place is wearing.
 *
 * A place with no booking is open. A booking wears what a human recorded, and
 * where nobody has recorded anything it wears readiness — which is the dock's
 * question ("may they board?") rather than the deck's ("did they?"), and is
 * exactly the order the roll call reads them in. A recorded fact outranking
 * readiness is the point: a body on the boat is a fact and readiness is a
 * decision, and a picture arguing with the row beneath it would be worse than
 * one that is coarser.
 *
 * **It knows which head count it is drawing** (ADR 20260919-one-idea §3b.1).
 * Green at the dock means "got on the boat" and green after dive two means
 * "came back"; amber at the dock ("never left") is a different conversation
 * from amber after dive two. A tone alone cannot say which, so a recorded tone
 * arrives *with* its checkpoint or it does not arrive: `recorded` is one object
 * carrying both, which makes "drew a recorded fact without saying where it was
 * counted" a compile error rather than a comment asking nobody to do it.
 *
 * The checkpoint does not move any tone to a different seat — `rollCallRowState`
 * has already used it, which is how `notBackAboard` exists at all — so it rides
 * out on the reading rather than changing the mapping. What it is for is the
 * *sentence*: the hull carries one line for a reader who cannot see it, and
 * that line has to name the head count before a recorded tone is ever drawn.
 * Wiring that copy belongs with the manifest itself; §3b records what is left.
 */
export function seatReadingFor(place: SeatPlace): SeatReading {
  const checkpoint = place.at ?? null;
  const booking = place.booking;
  if (!booking) return { state: "open", checkpoint, readiness: null };
  const readiness = booking.readiness;
  const recorded = place.at ? place.recorded : null;
  if (recorded) return { state: SEAT_OF_RECORDED_TONE[recorded], checkpoint, readiness };
  /*
   * **Nothing recorded, and which question that leaves depends on where we
   * are standing** (dive-domain review 20260919, second pass).
   *
   * At the dock — or on a surface with no roll call at all — readiness is the
   * question, because readiness is what gates boarding and it gates nothing
   * anywhere else. After a dive it is not the question and must not be
   * consulted: the glossary's **Held** entry is explicit that "after a dive
   * roll call is a physical head count", and a blocked diver counts back
   * aboard like anyone else. Answering the dock's question there painted an
   * uncounted diver as a settled one, which is the shape of DOM-H3 again.
   */
  if (checkpoint !== null && checkpoint !== "departure") {
    return { state: "awaiting", checkpoint, readiness };
  }
  return { state: SEAT_OF_UNRECORDED[readiness], checkpoint, readiness };
}

/**
 * The seat a booking wears when nobody has recorded anything — the dock's
 * question, answered by readiness alone.
 *
 * Total rather than a ternary for the reason `SEAT_OF_RECORDED_TONE` is: a
 * readiness added without a seat here is a compile error, and the alternative
 * is a new state falling through to `booked` — the one value that means
 * "nothing is wrong".
 */
const SEAT_OF_UNRECORDED: Record<SeatReadiness, SeatState> = {
  ready: "booked",
  blocked: "blocked",
  unread: "awaiting",
};
