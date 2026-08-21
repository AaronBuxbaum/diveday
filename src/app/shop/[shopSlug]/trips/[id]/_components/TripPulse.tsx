import Link from "next/link";
import { BoardingBar } from "@/components/BoardingBar";

export type TripPulseFact = {
  /** The whole sentence — "1 diver can’t board yet" — never a bare count. */
  text: string;
  /**
   * Where the fix lives: the filtered roster, the prep list, the crew panel,
   * the trip-filtered Orders index. Never the page this strip is already on.
   */
  href: string;
  /** Marks the facts that hold the boat up; the words already say so too. */
  tone?: "danger";
};

/**
 * Past this many seats the strip stops drawing one cell per seat and falls
 * back to the continuous bar: sixty 8px slivers stop reading as seats.
 * Capacity is capped at 60 (the Details form's own max), so the fallback is
 * the rare big boat, not the norm.
 */
const SEAT_CELL_MAX_CAPACITY = 40;

const SEAT_CELL_CLASS = {
  /** Recorded aboard at the departure checkpoint — same hue as BoardingBar. */
  boarded: "bg-primary",
  ready: "bg-success/70",
  blocked: "bg-danger",
  open: "border border-border bg-surface-sunken",
} as const;

type SeatCellState = keyof typeof SEAT_CELL_CLASS;

/**
 * The boat drawn as its own seats: one cell per seat, in the same state order
 * and hues as {@link BoardingBar} — boarded, then clear to board, then
 * blocked, with the open seats as empty cells at the end. A staffer thinks in
 * seats, not percentages, and at trip-page scale ("how is *this* boat doing")
 * ten discrete cells answer "two seats open" before the caption is read.
 * Today's departure board keeps the continuous bar deliberately: at h-2 in a
 * dense list, cells would be noise — the grammar (order, hues, words) is
 * shared, only the drawing scale differs.
 *
 * `aria-hidden`, like BoardingBar: the caption beside it carries every number
 * in words, so the strip never carries meaning by color alone (principle 6).
 */
function SeatStrip({
  boarded,
  ready,
  blocked,
  capacity,
}: {
  boarded: number;
  ready: number;
  blocked: number;
  capacity: number;
}) {
  const cells: SeatCellState[] = [];
  for (const [state, count] of [
    ["boarded", boarded],
    ["ready", ready],
    ["blocked", blocked],
  ] as const) {
    // Clamped at capacity so a mid-mutation over-count can never draw a
    // phantom eleventh seat on a ten-seat boat.
    for (let seat = 0; seat < count && cells.length < capacity; seat += 1) {
      cells.push(state);
    }
  }
  while (cells.length < capacity) cells.push("open");
  return (
    <div aria-hidden="true" className="flex gap-1">
      {cells.map((state, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional by definition — seat N is index N.
          key={index}
          className={`h-3.5 max-w-8 flex-1 rounded ${SEAT_CELL_CLASS[state]}`}
        />
      ))}
    </div>
  );
}

/**
 * The state of the boat, answered before anything asks to be configured.
 *
 * A staffer opening a trip arrives with one question — how is this boat
 * doing? — and this strip is the page's answer and its signature object: the
 * seat numbers as the headline, the boat drawn seat by seat underneath, and
 * then only the facts that need someone, in the order a staffer asks for them
 * (who can't board, who can't be packed for, who still owes money), each one
 * a full-size link to the surface that fixes it (principle 10: show the
 * answer, and put the action on the object). A fact at zero renders nothing
 * at all (principle 9: "none" is not a status).
 *
 * The facts are the most operational words on the page — "1 diver can't
 * board yet" is exactly the wet-thumb, in-glare tap the dock test protects —
 * so each stands on its own line with a 44px target, never as footnote links.
 *
 * Deliberately absent: an all-clear badge (the quiet caption is the all
 * clear), a heading (the trip header directly above already names the boat),
 * and any rendering on a cancelled or departed trip — this is a pulse, and
 * those have none.
 */
export function TripPulse({
  booked,
  boarded,
  blocked,
  capacity,
  caption,
  captionTone,
  facts,
}: {
  booked: number;
  /** Divers already recorded aboard at the departure checkpoint. */
  boarded: number;
  blocked: number;
  capacity: number;
  /** "9 of 12 booked · 3 seats open" — the strip in words and numbers. */
  caption: string;
  /** A full boat is a win worth noticing (principle 3) — the words say it, the ink underlines it. */
  captionTone?: "success";
  facts: TripPulseFact[];
}) {
  const ready = Math.max(0, booked - blocked - boarded);
  const drawSeatCells = capacity <= SEAT_CELL_MAX_CAPACITY;
  return (
    <section className="mt-8">
      <p
        className={`text-xl font-semibold tracking-tight tabular-nums ${
          captionTone === "success" ? "text-success-strong" : ""
        }`}
      >
        {caption}
      </p>
      <div className="mt-3">
        {drawSeatCells ? (
          <SeatStrip boarded={boarded} ready={ready} blocked={blocked} capacity={capacity} />
        ) : (
          <BoardingBar boarded={boarded} ready={ready} blocked={blocked} capacity={capacity} />
        )}
      </div>
      {facts.length > 0 ? (
        <div className="mt-2 flex flex-col">
          {facts.map((fact) => (
            <Link
              key={fact.href}
              href={fact.href}
              className={`inline-flex min-h-11 w-fit items-center text-base font-medium hover:underline ${
                fact.tone === "danger" ? "text-danger" : "text-primary"
              }`}
            >
              {fact.text}&nbsp;<span aria-hidden="true">›</span>
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
