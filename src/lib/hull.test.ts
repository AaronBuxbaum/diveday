import { describe, expect, it } from "vitest";
import { hullGeometry, seatStateFor, VIEW_HEIGHT } from "./hull";

/**
 * **The two hulls the canvas drew**, copied out of
 * `docs/design/canvases/20260919-one-idea/Deck.dc.html` verbatim. The built
 * hull is the drawn hull or the design is a picture of something else, and
 * these two strings are the only way to say so mechanically.
 */
const DRAWN = {
  12: {
    width: 382,
    outline:
      "M16,26 L278,26 C330,26 360,52 374,75 C360,98 330,124 278,124 L16,124 Q6,124 6,114 L6,36 Q6,26 16,26 Z",
    midline: { x1: 16, x2: 298 },
    crew: [
      { cx: 322, cy: 56 },
      { cx: 322, cy: 94 },
    ],
    helm: { cx: 334, cy: 75 },
  },
  8: {
    width: 298,
    outline:
      "M16,26 L194,26 C246,26 276,52 290,75 C276,98 246,124 194,124 L16,124 Q6,124 6,114 L6,36 Q6,26 16,26 Z",
    midline: { x1: 16, x2: 214 },
    crew: [{ cx: 238, cy: 56 }],
    helm: { cx: 250, cy: 75 },
  },
} as const;

describe("the hull", () => {
  it("is the one the canvas drew, to the unit", () => {
    for (const [capacity, drawn] of Object.entries(DRAWN)) {
      const geometry = hullGeometry({
        capacity: Number(capacity),
        crewCount: drawn.crew.length,
      });
      expect(geometry.width, `capacity ${capacity} width`).toBe(drawn.width);
      expect(geometry.height).toBe(VIEW_HEIGHT);
      expect(geometry.outline, `capacity ${capacity} outline`).toBe(drawn.outline);
      expect(geometry.midline.x1).toBe(drawn.midline.x1);
      expect(geometry.midline.x2).toBe(drawn.midline.x2);
      expect(geometry.crew.map(({ cx, cy }) => ({ cx, cy }))).toEqual(drawn.crew);
      expect(geometry.helm.cx).toBe(drawn.helm.cx);
      expect(geometry.helm.cy).toBe(drawn.helm.cy);
    }
  });

  it("gives a boat one seat per place it has", () => {
    for (const capacity of [1, 2, 7, 8, 12, 40]) {
      expect(hullGeometry({ capacity }).seats).toHaveLength(capacity);
    }
  });

  it("lays the seats on two benches, in booking order", () => {
    const { seats } = hullGeometry({ capacity: 12 });
    const bench = (row: number) => seats.filter((seat) => seat.y === (row === 0 ? 34 : 84));
    expect(bench(0)).toHaveLength(6);
    expect(bench(1)).toHaveLength(6);
    // Along the first bench from the transom forward, then the second.
    expect(seats.slice(0, 6).map((seat) => seat.x)).toEqual([24, 66, 108, 150, 192, 234]);
    expect(seats[6].x).toBe(24);
    expect(seats.map((seat) => seat.index)).toEqual([...Array(12).keys()]);
  });

  /** A boat of seven has a bench of four and a bench of three, not a phantom seat. */
  it("leaves an odd capacity short on the second bench rather than inventing a place", () => {
    const { seats } = hullGeometry({ capacity: 7 });
    expect(seats).toHaveLength(7);
    expect(seats.filter((seat) => seat.y === 34)).toHaveLength(4);
    expect(seats.filter((seat) => seat.y === 84)).toHaveLength(3);
  });

  /**
   * A seat carries a box, a corner and a middle — geometry, and nothing a
   * reader could take for a label. The index exists to fill in booking order
   * and nothing else, so nothing here may carry a seat's own number; the day
   * something like `station` or `bench` appears in this list is the day the
   * picture has quietly become a seating plan, and this test is where it is
   * caught.
   */
  it("numbers nothing a reader could see", () => {
    const geometry = hullGeometry({ capacity: 12, crewCount: 2 });
    for (const seat of geometry.seats) {
      expect(Object.keys(seat).sort()).toEqual([
        "centerX",
        "centerY",
        "height",
        "index",
        "rx",
        "width",
        "x",
        "y",
      ]);
    }
  });

  it("keeps two initials only while they are big enough to read", () => {
    // The hull keeps its aspect, so the lettering scales with the width: at 390
    // a boat of sixteen renders its initials at 10.1px and a boat of
    // twenty-four at 7.1px, which is texture rather than letters.
    expect(hullGeometry({ capacity: 12 }).showsInitials).toBe(true);
    expect(hullGeometry({ capacity: 16 }).showsInitials).toBe(true);
    expect(hullGeometry({ capacity: 24 }).showsInitials).toBe(false);
    expect(hullGeometry({ capacity: 40 }).showsInitials).toBe(false);
  });

  it("holds two in the wheelhouse and hands the rest back in words", () => {
    expect(hullGeometry({ capacity: 12, crewCount: 0 }).crew).toHaveLength(0);
    expect(hullGeometry({ capacity: 12, crewCount: 2 }).crewOverflow).toBe(0);
    const crowded = hullGeometry({ capacity: 12, crewCount: 5 });
    expect(crowded.crew).toHaveLength(2);
    expect(crowded.crewOverflow).toBe(3);
  });

  /**
   * A boat with no capacity is a data problem the reader cannot act on, and an
   * empty shell of a hull is a worse answer than no picture at all.
   */
  it("draws nothing for a boat with no places", () => {
    for (const capacity of [0, -3, Number.NaN]) {
      expect(hullGeometry({ capacity }).seats).toEqual([]);
      expect(hullGeometry({ capacity }).outline).toBe("");
    }
  });
});

describe("what a seat is wearing", () => {
  const booked = { readiness: "ready" } as const;

  it("is open where nobody has taken the place", () => {
    expect(seatStateFor({ booking: null, recorded: null })).toBe("open");
    // Even after a roll call: an untaken place is not a person who stayed ashore.
    expect(seatStateFor({ booking: null, recorded: "notBoarded" })).toBe("open");
  });

  it("reads the dock's question until a human answers the deck's", () => {
    expect(seatStateFor({ booking: booked, recorded: null })).toBe("booked");
    expect(seatStateFor({ booking: { readiness: "blocked" }, recorded: null })).toBe("blocked");
  });

  /**
   * Once a human has recorded something, what they recorded outranks readiness
   * — a diver who was blocked at the dock and is aboard anyway is aboard, which
   * is the roll call's own order and the only one a crew can act on.
   */
  it("lets a recorded result outrank readiness, every tone", () => {
    const blocked = { readiness: "blocked" } as const;
    expect(seatStateFor({ booking: blocked, recorded: "boarded" })).toBe("aboard");
    expect(seatStateFor({ booking: blocked, recorded: "notBoarded" })).toBe("ashore");
    expect(seatStateFor({ booking: booked, recorded: "notBoardedImplied" })).toBe("ashore");
    expect(seatStateFor({ booking: booked, recorded: "notBackAboard" })).toBe("missing");
  });
});
