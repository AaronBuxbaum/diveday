import { ProgressBar } from "@/components/ui/ProgressBar";
/**
 * The glance: one bar for "can this boat sail?". Boarded fills from the left,
 * then divers who are clear to board, then anyone blocked; the unfilled track
 * is seats still open. Decorative on purpose — the caption beside it carries
 * every fact in words and numbers, so the bar never has to be read, only
 * glanced at (principle 6: state is never color alone).
 *
 * The continuous drawing, kept for the boat too big to draw seat by seat —
 * {@link BoardingSeats} is what a surface renders, and it chooses.
 */
export function BoardingBar({
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
  const total = Math.max(capacity, boarded + ready + blocked, 1);
  return (
    <ProgressBar
      // Decorative: the caption beside it carries every fact in words and
      // numbers, so the bar is glanced at and never read (principle 6).
      aria-hidden="true"
      className="h-2"
      // Left to right as a staffer reads it; `ProgressBar` works out the
      // stacking. It also owns the motion — this bar used to jump while the
      // manifest's roll-call bar next door animated, on two surfaces somebody
      // moves between all morning (issue #834).
      segments={[
        { key: "boarded", fraction: boarded / total, className: "bg-primary" },
        { key: "ready", fraction: ready / total, className: "bg-success/70" },
        { key: "blocked", fraction: blocked / total, className: "bg-danger" },
      ]}
    />
  );
}

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
 * seats, not percentages, and ten discrete cells answer "two seats open"
 * before the caption is read.
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
 * **How a boat is doing, drawn the one way.**
 *
 * Seats where the boat can be drawn seat by seat, the continuous bar where it
 * cannot — one decision, made here, so no surface has to make it again. The
 * trip Overview's pulse and Today's departure board both render this: "how is
 * this boat doing" looks the same wherever a staffer meets it, which is the
 * whole point of a signature object. Today's board used to keep the continuous
 * bar on the reasoning that cells would be noise in a dense list; on the cards
 * as they are actually laid out they are not, and two drawings of one fact on
 * two surfaces somebody moves between all morning cost more than the density
 * they bought.
 */
export function BoardingSeats({
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
  return capacity <= SEAT_CELL_MAX_CAPACITY ? (
    <SeatStrip boarded={boarded} ready={ready} blocked={blocked} capacity={capacity} />
  ) : (
    <BoardingBar boarded={boarded} ready={ready} blocked={blocked} capacity={capacity} />
  );
}
