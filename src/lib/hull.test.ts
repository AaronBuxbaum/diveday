import { describe, expect, it } from "vitest";
import { crewReadingFor, hullGeometry, seatReadingFor, VIEW_HEIGHT } from "./hull";

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
  const blocked = { readiness: "blocked" } as const;
  const unread = { readiness: "unread" } as const;
  const dock = "departure" as const;
  const afterTwo = "after_dive_2" as const;

  it("is open where nobody has taken the place", () => {
    expect(seatReadingFor({ booking: null })).toEqual({
      state: "open",
      checkpoint: null,
      readiness: null,
    });
    // Even during a roll call: an untaken place is not a person who stayed ashore.
    expect(seatReadingFor({ booking: null, at: dock, recorded: "notBoarded" }).state).toBe("open");
  });

  it("reads the dock's question on a surface with no roll call in it", () => {
    expect(seatReadingFor({ booking: booked }).state).toBe("booked");
    expect(seatReadingFor({ booking: blocked }).state).toBe("blocked");
  });

  /**
   * Once a human has recorded something, what they recorded outranks readiness
   * — a diver who was blocked at the dock and is aboard anyway is aboard, which
   * is the roll call's own order and the only one a crew can act on.
   */
  it("lets a recorded result outrank readiness, every tone", () => {
    const at = (recorded: "boarded" | "notBoarded" | "notBoardedImplied" | "notBackAboard") =>
      seatReadingFor({ booking: blocked, at: afterTwo, recorded }).state;
    expect(at("boarded")).toBe("aboard");
    expect(at("notBoarded")).toBe("ashore");
    expect(at("notBoardedImplied")).toBe("ashoreImplied");
    expect(at("notBackAboard")).toBe("missing");
  });

  /**
   * **§3b.2 — "aboard, and nobody ever cleared them."**
   *
   * Precedence is unchanged: the recorded fact is the state. What changed is
   * that readiness is no longer *destroyed* on the way through, because the
   * roll-call row carries it in words and the hull is what gets photographed.
   */
  it("keeps what readiness said even where a recorded fact outranks it", () => {
    expect(seatReadingFor({ booking: blocked, at: dock, recorded: "boarded" })).toEqual({
      state: "aboard",
      checkpoint: "departure",
      readiness: "blocked",
    });
  });

  /**
   * **§3b.1 — which head count this is.** Green at the dock is "got on the
   * boat"; green after dive two is "came back". The state is the same and the
   * sentence is not, so the reading carries the count it is being drawn at.
   */
  it("carries the head count it is being drawn at", () => {
    const early = seatReadingFor({ booking: booked, at: dock, recorded: "boarded" });
    const late = seatReadingFor({ booking: booked, at: afterTwo, recorded: "boarded" });
    expect(early.state).toBe(late.state);
    expect(early.checkpoint).toBe("departure");
    expect(late.checkpoint).toBe("after_dive_2");
  });

  /**
   * **§3b.3 — a statement is not an inference.** ADR 20260827 decision 4: an
   * alarm is earned by a recorded fact, never by the absence of one. The rows
   * already read these two differently; the picture used to paint them alike.
   */
  it("tells a stated ashore from one carried forward", () => {
    const stated = seatReadingFor({ booking: booked, at: dock, recorded: "notBoarded" });
    const inferred = seatReadingFor({ booking: booked, at: dock, recorded: "notBoardedImplied" });
    expect(stated.state).toBe("ashore");
    expect(inferred.state).toBe("ashoreImplied");
  });

  /**
   * **§3b.5 — "nobody looked" is not "fine."** `rosterRowIsBlocked` fails open,
   * so a booking nobody read used to paint as an ordinary held seat.
   */
  it("gives a booking nobody has read its own seat, not a clear one", () => {
    const seat = seatReadingFor({ booking: unread });
    expect(seat.state).toBe("awaiting");
    expect(seat.state).not.toBe("booked");
    expect(seat.readiness).toBe("unread");
  });

  /**
   * **The hole the first pass left, and the reason there is a second one.**
   *
   * The checkpoint used to arrive only *inside* the recorded half, so on the
   * one path where it matters most — nothing recorded — the derivation had no
   * checkpoint and fell through to the dock's question. An ordinary two-tank
   * morning reaches it: aboard at the dock, nobody tapped yet after dive one,
   * no tone, and the seat painted `booked` — "nothing stopping them boarding"
   * — over a diver who may still be in the water. That is DOM-H3's shape
   * again, and the glossary ranks it *unaccounted for, unfinished head count*.
   *
   * Readiness is not consulted after a dive at all: **Held** says it "exists
   * only at the dock", and a blocked diver counts back aboard like anyone
   * else.
   */
  it("will not answer the dock's question at a head count after a dive", () => {
    for (const booking of [booked, blocked, unread]) {
      const seat = seatReadingFor({ booking, at: afterTwo, recorded: null });
      expect(seat.state).toBe("awaiting");
      expect(seat.checkpoint).toBe("after_dive_2");
    }
    // At the dock, readiness *is* the question, and still answers it.
    expect(seatReadingFor({ booking: booked, at: dock, recorded: null }).state).toBe("booked");
    expect(seatReadingFor({ booking: blocked, at: dock, recorded: null }).state).toBe("blocked");
  });
});

/**
 * **A crew member has a state now** — ADR 20260919-one-idea §3b.6.
 *
 * The item this closes was written as an asymmetry: a diver had eight states
 * and a guide had one, so the better the diver half got the more confidently
 * the whole picture read "all good" over a divemaster who went back down for a
 * weight belt. What is asserted here is the shape of the fix rather than the
 * fix's pixels — that the five a head count can produce are a diver's own
 * words, that the three a guide cannot wear are absent, and that the sixth
 * exists precisely so a surface with no head count does not raise an alarm.
 */
describe("crewReadingFor", () => {
  const dock = "departure" as const;
  const afterOne = "after_dive_1" as const;

  it("is rostered, not awaiting, where the surface has no head count", () => {
    // **The whole reason `rostered` exists.** The departure page has no roll
    // call in it and passes no `at`; painting every guide amber there would be
    // an alarm earned by the absence of a surface, which is the thing ADR
    // 20260827 decision 4 forbids and `ashoreImplied` was split out over.
    const crew = crewReadingFor({});
    expect(crew.state).toBe("rostered");
    expect(crew.checkpoint).toBeNull();
  });

  it("is awaiting once there is a head count and nobody has spoken", () => {
    // Same two inputs, opposite answers, and the checkpoint is the difference.
    const crew = crewReadingFor({ at: dock, recorded: null });
    expect(crew.state).toBe("awaiting");
    expect(crew.checkpoint).toBe("departure");
  });

  it("gives a guide the same five words a diver's record gives a seat", () => {
    // The derivation under both is literally one function — crew and divers
    // share `rollCallRowState`/`rollCallRecordedTone` — so a guide counted
    // back aboard is `aboard` in the sense a diver is, or the two halves of
    // one boat are speaking different languages.
    expect(crewReadingFor({ at: afterOne, recorded: "boarded" }).state).toBe("aboard");
    expect(crewReadingFor({ at: dock, recorded: "notBoarded" }).state).toBe("ashore");
    expect(crewReadingFor({ at: dock, recorded: "notBoardedImplied" }).state).toBe("ashoreImplied");
    expect(crewReadingFor({ at: afterOne, recorded: "notBackAboard" }).state).toBe("missing");
  });

  it("keeps the head count a recorded mark was drawn at", () => {
    // Green at the dock means "got on the boat"; green after a dive means
    // "came back". A fill cannot say which, so the reading carries it out.
    const aboardAtDock = crewReadingFor({ at: dock, recorded: "boarded" });
    const aboardAfterOne = crewReadingFor({ at: afterOne, recorded: "boarded" });
    expect(aboardAtDock.state).toBe(aboardAfterOne.state);
    expect(aboardAtDock.checkpoint).toBe("departure");
    expect(aboardAfterOne.checkpoint).toBe("after_dive_1");
  });

  it("never says a guide is open, booked or blocked", () => {
    // The three a crew member cannot wear are all readiness, and readiness
    // gates boarding *against a booking* — a guide holds neither. The rows say
    // the same thing: crew never fall back to the blocked tone.
    const everyPlace = [
      crewReadingFor({}),
      crewReadingFor({ at: dock, recorded: null }),
      crewReadingFor({ at: afterOne, recorded: null }),
      ...(["boarded", "notBoarded", "notBoardedImplied", "notBackAboard"] as const).map((tone) =>
        crewReadingFor({ at: dock, recorded: tone }),
      ),
    ];
    for (const reading of everyPlace) {
      expect(["open", "booked", "blocked"]).not.toContain(reading.state);
    }
  });
});
