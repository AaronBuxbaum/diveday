import { describe, expect, it } from "vitest";
import {
  analyzeSnapshot,
  analyzeStates,
  buildIndex,
  censusNearMisses,
  censusOf,
  clusterKey,
  familyOf,
  hitBox,
  ringReach,
  settledEntryFor,
  signatureOf,
} from "./analyze.mjs";

/**
 * The probe's judgement, driven by synthetic geometry.
 *
 * Every check has at least one case it must leave alone for each case it must
 * flag, because precision is this tool's main risk: a probe that keeps
 * flagging correct code gets ignored, and then it catches nothing. The
 * "leaves alone" cases are the correct shapes calibration found the first
 * version flagging — each says which.
 */

const BASE = {
  cp: -1,
  tag: "div",
  role: "",
  type: "",
  cls: "",
  label: "",
  x: 0,
  y: 0,
  w: 100,
  h: 20,
  disp: "block",
  pos: "static",
  fd: "row",
  fw: "nowrap",
  jc: "normal",
  ai: "normal",
  as: "auto",
  ji: "normal",
  ac: "normal",
  ta: "start",
  va: "baseline",
  ws: "normal",
  gapR: 0,
  gapC: 0,
  pad: [0, 0, 0, 0],
  mar: [0, 0, 0, 0],
  bw: [0, 0, 0, 0],
  bwl: [0, 0, 0, 0],
  rad: [0, 0, 0, 0],
  ovx: "visible",
  ovy: "visible",
  clips: false,
  clipsX: false,
  clipsY: false,
  fs: 16,
  lh: 24,
  fwt: 400,
  bg: false,
  bgc: "rgba(0, 0, 0, 0)",
  shadow: false,
  op: 1,
  vis: "visible",
  transform: false,
  to: "clip",
  lc: 0,
  interactive: false,
  focusable: false,
  disabled: false,
  ariaHidden: false,
  inImg: false,
  overlay: null,
  pe: "auto",
  text: [],
  asc: null,
  pseudo: null,
  inProse: false,
  srOnly: false,
  replaced: false,
  sw: 0,
  sh: 0,
  cw: 0,
  ch: 0,
  heading: false,
  id: "",
};

/** Build a snapshot from `[index, parent, props]` rows, filling every field. */
function page(rows, doc = {}) {
  const elements = rows.map(([i, p, props]) => {
    const el = { ...BASE, i, p, ...props };
    if (props.bw && !props.bwl) el.bwl = props.bw;
    return el;
  });
  const width = doc.width ?? 1280;
  return {
    url: "http://127.0.0.1/",
    path: "/",
    viewport: { width, height: 800 },
    dpr: 1,
    doc: { width, height: 3000, scrollWidth: doc.scrollWidth ?? width, clippedScrollWidth: width },
    pageBg: "rgb(245, 245, 247)",
    truncated: false,
    elements,
  };
}

const CARD = {
  cls: "rounded-panel border bg-surface overflow-hidden",
  bg: true,
  bgc: "rgb(255, 255, 255)",
  bw: [1, 1, 1, 1],
  rad: [20, 20, 20, 20],
  clips: true,
  clipsX: true,
  clipsY: true,
  ovx: "hidden",
  ovy: "hidden",
};

function flagsOf(snapshot, check, options = {}) {
  return analyzeSnapshot(snapshot, { checks: [check], ...options }).filter(
    (flag) => flag.check === check,
  );
}

describe("signatures", () => {
  it("drops the classes that only place a component, so one component reads as one", () => {
    const a = { ...BASE, i: 0, p: -1, tag: "a", cls: "inline-flex min-h-11 px-4 mt-2 w-full" };
    const b = { ...BASE, i: 1, p: -1, tag: "a", cls: "px-4 inline-flex min-h-11 sm:mt-6 flex-1" };
    expect(signatureOf(a)).toBe(signatureOf(b));
    expect(signatureOf(a)).toBe("a.inline-flex min-h-11 px-4");
  });

  it("keeps the classes that draw it", () => {
    const a = { ...BASE, i: 0, p: -1, cls: "px-4" };
    const b = { ...BASE, i: 1, p: -1, cls: "px-5" };
    expect(signatureOf(a)).not.toBe(signatureOf(b));
  });

  it("puts two tones of one badge in one census family", () => {
    const neutral = {
      ...BASE,
      i: 0,
      p: -1,
      tag: "span",
      cls: "rounded-full px-2 text-xs bg-surface-sunken text-muted border border-border",
    };
    const danger = {
      ...BASE,
      i: 1,
      p: -1,
      tag: "span",
      cls: "rounded-full px-2 text-xs bg-danger-tint text-danger",
    };
    expect(familyOf(neutral)).toBe("span.border px-2 rounded-full text-xs");
    expect(
      familyOf({ ...BASE, i: 2, p: -1, tag: "span", cls: "border-t text-sm bg-surface-sunken" }),
    ).toBe("span.border-t text-sm");
    expect(familyOf(danger)).toBe("span.px-2 rounded-full text-xs");
  });

  it("fingerprints an unclassed box by what it draws", () => {
    const a = { ...BASE, i: 0, p: -1, pad: [4, 8, 4, 8] };
    const b = { ...BASE, i: 1, p: -1, pad: [4, 8, 4, 8] };
    expect(signatureOf(a)).toBe(signatureOf(b));
    expect(signatureOf(a)).toMatch(/^div\{/);
  });
});

describe("focus ring clipped", () => {
  const row = { tag: "a", cls: "row", focusable: true, interactive: true, label: "Team" };

  it("flags a full-width row whose ring the card's overflow cuts", () => {
    const snapshot = page([
      [0, -1, { ...CARD, x: 16, y: 100, w: 400, h: 200 }],
      [1, 0, { ...row, cp: 0, x: 17, y: 101, w: 398, h: 56 }],
    ]);
    const [flag] = flagsOf(snapshot, "focus-ring-clipped");
    expect(flag.measure.sides).toMatchObject({ left: 5, right: 5, top: 5 });
    expect(flag.csig).toBe(signatureOf(snapshot.elements[0]));
  });

  it("leaves a row the card pads away from its edge, with a nested radius, alone", () => {
    const snapshot = page([
      [0, -1, { ...CARD, x: 16, y: 100, w: 400, h: 200, pad: [8, 8, 8, 8] }],
      [1, 0, { ...row, cp: 0, x: 25, y: 109, w: 382, h: 56, rad: [12, 12, 12, 12] }],
    ]);
    expect(flagsOf(snapshot, "focus-ring-clipped")).toEqual([]);
  });

  it("leaves a chip scrolled out of its row alone — that box is hidden, not its ring", () => {
    const snapshot = page([
      [
        0,
        -1,
        {
          cls: "chips overflow-x-auto",
          clips: true,
          clipsX: true,
          clipsY: true,
          ovx: "auto",
          ovy: "hidden",
          x: 0,
          y: 0,
          w: 390,
          h: 60,
          pad: [8, 0, 8, 0],
        },
      ],
      [1, 0, { ...row, cp: 0, x: 380, y: 8, w: 80, h: 44 }],
    ]);
    expect(flagsOf(snapshot, "focus-ring-clipped")).toEqual([]);
  });

  it("flags chips whose row has no vertical room for the ring", () => {
    const snapshot = page(
      [
        [
          0,
          -1,
          {
            cls: "chips overflow-x-auto",
            clips: true,
            clipsX: true,
            clipsY: true,
            ovx: "auto",
            ovy: "hidden",
            x: 16,
            y: 0,
            w: 358,
            h: 44,
          },
        ],
        [1, 0, { ...row, cp: 0, x: 24, y: 0, w: 80, h: 44 }],
      ],
      { width: 390 },
    );
    const [flag] = flagsOf(snapshot, "focus-ring-clipped");
    expect(flag.measure.sides).toMatchObject({ top: 5, bottom: 5 });
  });

  it("trusts a measured inset ring over the global one", () => {
    const snapshot = page([
      [0, -1, { ...CARD, x: 16, y: 100, w: 400, h: 200 }],
      [1, 0, { ...row, cp: 0, x: 17, y: 101, w: 398, h: 56 }],
    ]);
    expect(flagsOf(snapshot, "focus-ring-clipped", { rings: new Map([[1, 0]]) })).toEqual([]);
  });

  it("calls a pixel shaved at the screen's own edge polish, not a defect", () => {
    const snapshot = page([[0, -1, { ...row, x: 4, y: 100, w: 382, h: 60 }]], { width: 390 });
    const [flag] = flagsOf(snapshot, "focus-ring-clipped");
    expect(flag.severity).toBe("S3");
    expect(flag.measure.by).toBe("viewport");
  });

  it("finds a ring cut only by a rounded corner", () => {
    const snapshot = page([
      [0, -1, { ...CARD, x: 0, y: 0, w: 400, h: 400, rad: [40, 40, 40, 40], pad: [6, 6, 6, 6] }],
      [1, 0, { ...row, cp: 0, x: 7, y: 7, w: 100, h: 44 }],
    ]);
    const [flag] = flagsOf(snapshot, "focus-ring-clipped");
    expect(flag.measure.corners).toContain("tl");
  });
});

describe("nested corners", () => {
  const TRACK = {
    cls: "track",
    bg: true,
    bgc: "rgb(240, 240, 240)",
    bw: [1, 1, 1, 1],
    rad: [12, 12, 12, 12],
  };
  const PILL = { cls: "pill", bg: true, bgc: "rgb(255, 255, 255)", shadow: true };

  it("flags a 12px pill sitting 5px inside a 12px track (it nests at 7)", () => {
    const snapshot = page([
      [0, -1, { ...TRACK, x: 0, y: 0, w: 200, h: 54 }],
      [
        1,
        0,
        {
          ...PILL,
          pos: "absolute",
          ariaHidden: true,
          rad: [12, 12, 12, 12],
          x: 5,
          y: 5,
          w: 90,
          h: 44,
        },
      ],
    ]);
    const [flag] = flagsOf(snapshot, "nested-corners");
    expect(flag.measure.expected).toBe(7);
  });

  it("leaves a 7px pill in the same track alone", () => {
    const snapshot = page([
      [0, -1, { ...TRACK, x: 0, y: 0, w: 200, h: 54 }],
      [1, 0, { ...PILL, rad: [7, 7, 7, 7], x: 5, y: 5, w: 90, h: 44 }],
    ]);
    expect(flagsOf(snapshot, "nested-corners")).toEqual([]);
  });

  it("leaves a square row flush inside a clipping card alone — the clip rounds it", () => {
    const snapshot = page([
      [0, -1, { ...CARD, x: 0, y: 0, w: 400, h: 200 }],
      [1, 0, { cls: "row", bg: true, bgc: "rgb(250, 250, 250)", x: 1, y: 1, w: 398, h: 56 }],
    ]);
    expect(flagsOf(snapshot, "nested-corners")).toEqual([]);
  });

  it("leaves a lone border-t rule alone — it paints no corner", () => {
    const snapshot = page([
      [0, -1, { ...CARD, clips: false, clipsX: false, clipsY: false, x: 0, y: 0, w: 400, h: 200 }],
      [1, 0, { cls: "foot border-t", bw: [1, 0, 0, 0], x: 1, y: 150, w: 398, h: 47 }],
    ]);
    expect(flagsOf(snapshot, "nested-corners")).toEqual([]);
  });

  it("leaves a box far from any corner alone", () => {
    const snapshot = page([
      [0, -1, { ...TRACK, x: 0, y: 0, w: 400, h: 200 }],
      [1, 0, { ...PILL, rad: [12, 12, 12, 12], x: 24, y: 24, w: 90, h: 44 }],
    ]);
    expect(flagsOf(snapshot, "nested-corners")).toEqual([]);
  });
});

describe("off centre", () => {
  const BUTTON = {
    tag: "button",
    cls: "btn",
    interactive: true,
    focusable: true,
    disp: "flex",
    jc: "center",
    ai: "center",
    bg: true,
    bgc: "rgb(0, 100, 200)",
    x: 0,
    y: 0,
    w: 120,
    h: 44,
  };

  it("flags content pushed off centre by lopsided padding on a painted button", () => {
    const snapshot = page([
      [0, -1, { ...BUTTON, pad: [0, 16, 0, 12] }],
      // Centred in the 92px content box (12–104): 33–83, so 33px of room on
      // the left of the painted box against 37 on the right.
      [1, 0, { tag: "span", disp: "block", x: 33, y: 12, w: 50, h: 20, text: [[33, 12, 50, 20]] }],
    ]);
    const [flag] = flagsOf(snapshot, "off-centre");
    expect(flag.measure.x).toBe(-2);
    expect(flag.severity).toBe("S2");
  });

  it("leaves a symmetric button alone", () => {
    const snapshot = page([
      [0, -1, { ...BUTTON, pad: [0, 14, 0, 14] }],
      [1, 0, { tag: "span", x: 35, y: 12, w: 50, h: 20, text: [[35, 12, 50, 20]] }],
    ]);
    expect(flagsOf(snapshot, "off-centre")).toEqual([]);
  });

  it("leaves an invisible wrapper's lopsided padding alone — nobody sees its edge", () => {
    const snapshot = page([
      [
        0,
        -1,
        {
          ...BUTTON,
          tag: "div",
          interactive: false,
          focusable: false,
          bg: false,
          pad: [0, 16, 0, 12],
        },
      ],
      [1, 0, { tag: "span", x: 33, y: 12, w: 50, h: 20, text: [[33, 12, 50, 20]] }],
    ]);
    expect(flagsOf(snapshot, "off-centre")).toEqual([]);
  });

  it("leaves a band painted the page's own colour alone", () => {
    const snapshot = page([
      [0, -1, { ...BUTTON, tag: "li", bgc: "rgb(245, 245, 247)", pad: [8, 0, 12, 0], h: 60 }],
      [1, 0, { tag: "span", x: 35, y: 18, w: 50, h: 20, text: [[35, 18, 50, 20]] }],
    ]);
    expect(flagsOf(snapshot, "off-centre")).toEqual([]);
  });

  it("leaves wrapped, start-aligned text alone", () => {
    const snapshot = page([
      [0, -1, { ...BUTTON, w: 200, h: 64, pad: [0, 12, 0, 12] }],
      [
        1,
        0,
        {
          tag: "span",
          x: 12,
          y: 8,
          w: 120,
          h: 48,
          text: [
            [12, 8, 120, 24],
            [12, 32, 90, 24],
          ],
        },
      ],
    ]);
    expect(flagsOf(snapshot, "off-centre")).toEqual([]);
  });

  it("skips a box with in-flow pseudo content it cannot measure", () => {
    const snapshot = page([
      [0, -1, { ...BUTTON, pad: [0, 16, 0, 12], pseudo: "before" }],
      [1, 0, { tag: "span", x: 33, y: 12, w: 50, h: 20, text: [[33, 12, 50, 20]] }],
    ]);
    expect(flagsOf(snapshot, "off-centre")).toEqual([]);
  });
});

describe("three-part rows", () => {
  const ROW = { cls: "pager", disp: "flex", jc: "space-between", x: 0, y: 0, w: 400, h: 44 };

  it("flags a position readout pushed aside by an empty placeholder", () => {
    const snapshot = page([
      [0, -1, ROW],
      [1, 0, { tag: "span", x: 0, y: 22, w: 0, h: 0 }],
      [2, 0, { tag: "p", cls: "pos", x: 130, y: 12, w: 80, h: 20, text: [[130, 12, 80, 20]] }],
      [3, 0, { tag: "a", cls: "next", x: 300, y: 0, w: 100, h: 44 }],
    ]);
    const [flag] = flagsOf(snapshot, "three-part-row");
    expect(flag.measure.placeholder).toBe(true);
  });

  it("leaves a balanced row alone", () => {
    const snapshot = page([
      [0, -1, ROW],
      [1, 0, { tag: "a", cls: "prev", x: 0, y: 0, w: 100, h: 44 }],
      [2, 0, { tag: "p", cls: "pos", x: 160, y: 12, w: 80, h: 20, text: [[160, 12, 80, 20]] }],
      [3, 0, { tag: "a", cls: "next", x: 300, y: 0, w: 100, h: 44 }],
    ]);
    expect(flagsOf(snapshot, "three-part-row")).toEqual([]);
  });
});

describe("rows of controls", () => {
  const BTN = { tag: "button", interactive: true, focusable: true, bg: true, bgc: "rgb(0,0,0)" };

  it("flags a 48px button beside a 44px one", () => {
    const snapshot = page([
      [0, -1, { cls: "row", disp: "flex", x: 0, y: 0, w: 400, h: 48 }],
      [1, 0, { ...BTN, cls: "big", x: 0, y: 0, w: 100, h: 48 }],
      [2, 0, { ...BTN, cls: "small", x: 110, y: 2, w: 100, h: 44 }],
    ]);
    const [flag] = flagsOf(snapshot, "mismatched-controls");
    expect(flag.measure.heights).toEqual([48, 44]);
  });

  it("sees through a form that only wraps one of them", () => {
    const snapshot = page([
      [0, -1, { cls: "row", disp: "flex", x: 0, y: 0, w: 400, h: 48 }],
      [1, 0, { ...BTN, cls: "big", x: 0, y: 0, w: 100, h: 48 }],
      [2, 0, { tag: "form", x: 110, y: 2, w: 100, h: 44 }],
      [3, 2, { ...BTN, cls: "small", x: 110, y: 2, w: 100, h: 44 }],
    ]);
    expect(flagsOf(snapshot, "mismatched-controls")).toHaveLength(1);
  });

  it("leaves two 44px buttons alone", () => {
    const snapshot = page([
      [0, -1, { cls: "row", disp: "flex", x: 0, y: 0, w: 400, h: 44 }],
      [1, 0, { ...BTN, cls: "a", x: 0, y: 0, w: 100, h: 44 }],
      [2, 0, { ...BTN, cls: "b", x: 110, y: 0, w: 100, h: 44 }],
    ]);
    expect(flagsOf(snapshot, "mismatched-controls")).toEqual([]);
  });

  it("flags a title top-aligned against a taller button", () => {
    const snapshot = page([
      [
        0,
        -1,
        {
          cls: "header",
          disp: "flex",
          ai: "flex-start",
          jc: "space-between",
          x: 0,
          y: 0,
          w: 400,
          h: 44,
        },
      ],
      [
        1,
        0,
        {
          tag: "h2",
          cls: "title",
          x: 0,
          y: 0,
          w: 120,
          h: 24,
          lh: 24,
          text: [[0, 2, 120, 20]],
          asc: [16, 4],
        },
      ],
      [2, 0, { ...BTN, cls: "btn", x: 300, y: 0, w: 100, h: 44 }],
      [3, 2, { tag: "span", x: 320, y: 12, w: 60, h: 20, text: [[320, 12, 60, 20]], asc: [16, 4] }],
    ]);
    const [flag] = flagsOf(snapshot, "text-beside-control");
    expect(flag.measure.lineCentre).toBe(-10);
  });

  it("leaves a title centred on the button alone", () => {
    const snapshot = page([
      [0, -1, { cls: "header", disp: "flex", ai: "center", x: 0, y: 0, w: 400, h: 44 }],
      [
        1,
        0,
        {
          tag: "h2",
          cls: "title",
          x: 0,
          y: 10,
          w: 120,
          h: 24,
          text: [[0, 12, 120, 20]],
          asc: [16, 4],
        },
      ],
      [2, 0, { ...BTN, cls: "btn", x: 300, y: 0, w: 100, h: 44 }],
    ]);
    expect(flagsOf(snapshot, "text-beside-control")).toEqual([]);
  });

  it("leaves text sharing the button's baseline alone", () => {
    const snapshot = page([
      [0, -1, { cls: "header", disp: "flex", ai: "baseline", x: 0, y: 0, w: 400, h: 44 }],
      [
        1,
        0,
        {
          tag: "p",
          cls: "note",
          x: 0,
          y: 4,
          w: 120,
          h: 40,
          text: [
            [0, 8, 120, 20],
            [0, 28, 60, 20],
          ],
          asc: [16, 4],
        },
      ],
      [2, 0, { ...BTN, cls: "btn", x: 300, y: 0, w: 100, h: 44 }],
      [3, 2, { tag: "span", x: 320, y: 8, w: 60, h: 20, text: [[320, 8, 60, 20]], asc: [16, 4] }],
    ]);
    expect(flagsOf(snapshot, "text-beside-control")).toEqual([]);
  });
});

describe("ragged edges", () => {
  const STACK = { cls: "stack", x: 0, y: 0, w: 400, h: 300 };
  const para = (i, x, y) => [
    i,
    0,
    { tag: "p", cls: "copy", x, y, w: 300, h: 24, text: [[x, y, 200, 24]] },
  ];

  it("flags one line of a stack starting 4px in", () => {
    const snapshot = page([
      [0, -1, STACK],
      para(1, 16, 0),
      para(2, 16, 40),
      para(3, 20, 80),
      para(4, 16, 120),
    ]);
    const [flag] = flagsOf(snapshot, "ragged-edges");
    expect(flag.measure.strays[0].off).toBe(4);
  });

  it("leaves an aligned stack alone", () => {
    const snapshot = page([[0, -1, STACK], para(1, 16, 0), para(2, 16, 40), para(3, 16, 80)]);
    expect(flagsOf(snapshot, "ragged-edges")).toEqual([]);
  });

  it("leaves a card whose box lines up alone, whatever its padding", () => {
    const snapshot = page([
      [0, -1, STACK],
      para(1, 16, 0),
      para(2, 16, 40),
      [3, 0, { cls: "card", bg: true, bgc: "rgb(255,255,255)", x: 16, y: 80, w: 300, h: 60 }],
      [4, 3, { tag: "p", x: 36, y: 90, w: 200, h: 24, text: [[36, 90, 200, 24]] }],
    ]);
    expect(flagsOf(snapshot, "ragged-edges")).toEqual([]);
  });

  it("leaves a centred stack alone", () => {
    const snapshot = page([
      [0, -1, { ...STACK, ta: "center" }],
      para(1, 16, 0),
      para(2, 20, 40),
      para(3, 16, 80),
    ]);
    expect(flagsOf(snapshot, "ragged-edges")).toEqual([]);
  });

  it("flags one kind of heading at two edges in one column", () => {
    const heading = (i, x, y) => [
      i,
      0,
      { tag: "h2", heading: true, cls: "t", fs: 18, x, y, w: 300, h: 28, text: [[x, y, 150, 28]] },
    ];
    const snapshot = page([
      [0, -1, STACK],
      heading(1, 16, 0),
      heading(2, 20, 200),
      heading(3, 16, 400),
    ]);
    expect(flagsOf(snapshot, "ragged-edges").some((flag) => flag.measure.kind === "headings")).toBe(
      true,
    );
  });

  it("does not compare an h1 with a card's h3", () => {
    // Separate parents, so only the heading column is in play.
    const snapshot = page([
      [
        0,
        -1,
        { tag: "h1", heading: true, fs: 40, x: 16, y: 0, w: 300, h: 48, text: [[16, 0, 200, 48]] },
      ],
      [
        1,
        -1,
        {
          tag: "h3",
          heading: true,
          fs: 16,
          x: 20,
          y: 200,
          w: 300,
          h: 24,
          text: [[20, 200, 100, 24]],
        },
      ],
      [
        2,
        -1,
        {
          tag: "h3",
          heading: true,
          fs: 16,
          x: 20,
          y: 400,
          w: 300,
          h: 24,
          text: [[20, 400, 100, 24]],
        },
      ],
    ]);
    expect(flagsOf(snapshot, "ragged-edges")).toEqual([]);
  });

  it("finds a painted tile six wrappers down, the staff chrome's logo, before the letters inside it", () => {
    // Cluster C2, 137 captures at 390: the header's first content is the
    // shop's 36px monogram tile at x 16, on the column with the banner and the
    // page. The "BM" centred inside it starts at 23.8, and the tile sits six
    // levels under the header (bar row, two leading slots, the menu's root,
    // its button): deep enough for the content edge to read the letters and,
    // until the two walks shared one depth, too deep for the painted-box edge
    // to find the tile.
    const band = { bg: true, bgc: "rgb(255,255,255)" };
    const tile = {
      tag: "span",
      cls: "tile",
      disp: "grid",
      bg: true,
      bgc: "rgb(0,100,210)",
      rad: [12, 12, 12, 12],
    };
    const trigger = { tag: "button", cls: "trigger", disp: "flex", interactive: true };
    const snapshot = page(
      [
        [0, -1, { cls: "shell", disp: "flex", fd: "column", x: 0, y: 0, w: 390, h: 600 }],
        [1, 0, { ...band, cls: "banner", x: 0, y: 0, w: 390, h: 40 }],
        [2, 1, { tag: "p", x: 16, y: 10, w: 200, h: 20, text: [[16, 10, 200, 20]] }],
        [3, 0, { ...band, tag: "header", bw: [0, 0, 1, 0], x: 0, y: 40, w: 390, h: 56 }],
        [4, 3, { cls: "bar", disp: "flex", x: 0, y: 40, w: 390, h: 56 }],
        [5, 4, { cls: "leading", disp: "flex", x: 16, y: 46, w: 200, h: 44 }],
        [6, 5, { cls: "identity", disp: "flex", x: 16, y: 46, w: 200, h: 44 }],
        [7, 6, { cls: "menu", disp: "flex", x: 16, y: 46, w: 200, h: 44 }],
        [8, 7, { ...trigger, x: 16, y: 46, w: 200, h: 44 }],
        [9, 8, { ...tile, x: 16, y: 50, w: 36, h: 36, text: [[23.8, 60, 20.4, 16]] }],
        [10, 8, { tag: "span", x: 60, y: 58, w: 150, h: 20, text: [[60, 58, 150, 20]] }],
        [11, 0, { tag: "main", cls: "page", x: 16, y: 96, w: 358, h: 400 }],
        [12, 11, { tag: "h1", x: 16, y: 96, w: 358, h: 32, text: [[16, 96, 200, 32]] }],
      ],
      { width: 390 },
    );
    expect(flagsOf(snapshot, "ragged-edges")).toEqual([]);
  });

  it("still flags that header when the tile is off the column too", () => {
    const band = { bg: true, bgc: "rgb(255,255,255)" };
    const snapshot = page(
      [
        [0, -1, { cls: "shell", disp: "flex", fd: "column", x: 0, y: 0, w: 390, h: 600 }],
        [1, 0, { ...band, cls: "banner", x: 0, y: 0, w: 390, h: 40 }],
        [2, 1, { tag: "p", x: 16, y: 10, w: 200, h: 20, text: [[16, 10, 200, 20]] }],
        [3, 0, { ...band, tag: "header", bw: [0, 0, 1, 0], x: 0, y: 40, w: 390, h: 56 }],
        [4, 3, { cls: "bar", disp: "flex", x: 0, y: 40, w: 390, h: 56 }],
        [5, 4, { cls: "leading", disp: "flex", x: 20, y: 46, w: 200, h: 44 }],
        [6, 5, { cls: "identity", disp: "flex", x: 20, y: 46, w: 200, h: 44 }],
        [7, 6, { cls: "menu", disp: "flex", x: 20, y: 46, w: 200, h: 44 }],
        [8, 7, { tag: "button", cls: "trigger", interactive: true, x: 20, y: 46, w: 200, h: 44 }],
        [
          9,
          8,
          {
            tag: "span",
            cls: "tile",
            bg: true,
            bgc: "rgb(0,100,210)",
            x: 20,
            y: 50,
            w: 36,
            h: 36,
            text: [[27.8, 60, 20.4, 16]],
          },
        ],
        [10, 0, { tag: "main", cls: "page", x: 16, y: 96, w: 358, h: 400 }],
        [11, 10, { tag: "h1", x: 16, y: 96, w: 358, h: 32, text: [[16, 96, 200, 32]] }],
      ],
      { width: 390 },
    );
    const [flag] = flagsOf(snapshot, "ragged-edges");
    expect(flag.measure.strays[0].off).toBe(11.8);
  });

  it("reads a row's edge the same however deep an outer stack first reached it", () => {
    // `CompactDisclosureRow`, 108 flags "at −8px": its summary bleeds `-mx-2`
    // (x 165) for a hover fill that is not painted at rest, and its caret sits
    // on the rows' 173. An outer stack first reached the summary seven levels
    // down, past the content walk's depth, and cached "the summary's own x";
    // the row's own stack then read that cached 165 as the row's edge.
    const summary = {
      tag: "summary",
      cls: "-mx-2 px-2 rounded-lg hover:bg-surface-sunken",
      disp: "flex",
      interactive: true,
      focusable: true,
      pad: [8, 8, 8, 8],
      rad: [12, 12, 12, 12],
    };
    const snapshot = page([
      [0, -1, { cls: "outer", x: 0, y: 0, w: 1280, h: 900 }],
      [1, 0, { tag: "p", x: 16, y: 0, w: 400, h: 24, text: [[16, 0, 300, 24]] }],
      [2, 0, { tag: "p", x: 16, y: 40, w: 400, h: 24, text: [[16, 40, 300, 24]] }],
      [3, 0, { tag: "section", cls: "s1", x: 157, y: 80, w: 966, h: 400 }],
      [4, 3, { cls: "s2", x: 157, y: 80, w: 966, h: 400 }],
      [5, 4, { cls: "s3", x: 157, y: 80, w: 966, h: 400 }],
      [6, 5, { tag: "ul", cls: "s4", x: 157, y: 80, w: 966, h: 400 }],
      [7, 6, { cls: "s5", x: 157, y: 80, w: 966, h: 400 }],
      [8, 7, { tag: "li", cls: "row", x: 157, y: 80, w: 966, h: 200 }],
      [9, 8, { tag: "p", cls: "fact", x: 173, y: 80, w: 934, h: 24, text: [[173, 80, 200, 24]] }],
      [
        10,
        8,
        { tag: "p", cls: "fact", x: 173, y: 110, w: 934, h: 24, text: [[173, 110, 200, 24]] },
      ],
      [11, 8, { tag: "details", cls: "group/compact-row", x: 173, y: 140, w: 934, h: 44 }],
      [12, 11, { ...summary, x: 165, y: 140, w: 950, h: 44 }],
      [13, 12, { tag: "span", cls: "flex gap-2", disp: "flex", x: 173, y: 150, w: 120, h: 24 }],
      [14, 13, { tag: "svg", cls: "caret", replaced: true, x: 173, y: 154, w: 16, h: 16 }],
      [15, 13, { tag: "span", x: 197, y: 150, w: 96, h: 24, text: [[197, 150, 96, 24]] }],
    ]);
    expect(flagsOf(snapshot, "ragged-edges")).toEqual([]);
  });

  it("gives centred text no left edge to be ragged by", () => {
    // EntryShell's footer (`items-center text-center`) and a `text-center`
    // fine print: their first line starts wherever centring put it (x 36
    // against the column's 24), which is not an edge anyone aligns by.
    const footer = { tag: "footer", cls: "items-center text-center", ta: "center" };
    const snapshot = page([
      [0, -1, STACK],
      para(1, 24, 0),
      para(2, 24, 40),
      [3, 0, { ...footer, x: 24, y: 80, w: 342, h: 40, text: [[36, 80, 318, 20]] }],
      para(4, 24, 140),
    ]);
    expect(flagsOf(snapshot, "ragged-edges")).toEqual([]);
  });

  it("still reads a centred card's painted box as its edge", () => {
    const card = {
      cls: "card text-center",
      ta: "center",
      bg: true,
      bgc: "rgb(255,255,255)",
    };
    const snapshot = page([
      [0, -1, STACK],
      para(1, 24, 0),
      para(2, 24, 40),
      [3, 0, { ...card, x: 28, y: 80, w: 300, h: 40, text: [[60, 90, 236, 20]] }],
      para(4, 24, 140),
    ]);
    const [flag] = flagsOf(snapshot, "ragged-edges");
    expect(flag.measure.strays).toEqual([{ sig: "div.card text-center", off: 4 }]);
  });
});

describe("repeated rows", () => {
  const rows = (carets) =>
    page([
      [0, -1, { cls: "list", x: 0, y: 0, w: 400, h: 200 }],
      ...carets.flatMap((x, n) => [
        [1 + n * 2, 0, { tag: "li", cls: "row", x: 0, y: n * 50, w: 400, h: 48 }],
        [
          2 + n * 2,
          1 + n * 2,
          { tag: "svg", cls: "caret", replaced: true, x, y: n * 50 + 16, w: 16, h: 16 },
        ],
      ]),
    ]);

  it("flags a caret that wanders with the text before it", () => {
    const [flag] = flagsOf(rows([228, 338, 288]), "ragged-column");
    expect(flag.measure.xs).toEqual([228, 338, 288]);
  });

  it("leaves a caret pinned to the row's end alone", () => {
    expect(flagsOf(rows([368, 368, 368]), "ragged-column")).toEqual([]);
  });
});

describe("gaps", () => {
  const card = (i, y, h = 40) => [i, 0, { cls: "card", bg: true, x: 0, y, w: 300, h }];

  it("flags like siblings 16 then 24px apart", () => {
    const snapshot = page([
      [0, -1, { cls: "stack", disp: "flex", fd: "column", x: 0, y: 0, w: 300, h: 300 }],
      card(1, 0),
      card(2, 56),
      card(3, 120),
    ]);
    const [flag] = flagsOf(snapshot, "uneven-gaps");
    expect(flag.measure.gaps).toEqual([16, 24]);
  });

  it("leaves even gaps alone", () => {
    const snapshot = page([
      [0, -1, { cls: "stack", x: 0, y: 0, w: 300, h: 300 }],
      card(1, 0),
      card(2, 56),
      card(3, 112),
    ]);
    expect(flagsOf(snapshot, "uneven-gaps")).toEqual([]);
  });

  it("flags an empty child that doubles a gap between two cards", () => {
    const snapshot = page([
      [0, -1, { cls: "stack", disp: "flex", fd: "column", gapR: 16, x: 0, y: 0, w: 300, h: 300 }],
      card(1, 0),
      [2, 0, { cls: "empty", x: 0, y: 56, w: 300, h: 0 }],
      card(3, 72),
      card(4, 128),
    ]);
    const flags = flagsOf(snapshot, "phantom-gap");
    expect(flags.some((flag) => flag.measure.spanned === 32)).toBe(true);
  });

  it("flags an empty last item that adds a gap to a one-line column", () => {
    const snapshot = page([
      [
        0,
        -1,
        {
          cls: "summary",
          disp: "flex",
          fd: "column",
          jc: "center",
          gapR: 4,
          x: 0,
          y: 0,
          w: 300,
          h: 56,
        },
      ],
      [1, 0, { tag: "span", x: 0, y: 16, w: 200, h: 20, text: [[0, 16, 200, 20]] }],
      [2, 0, { tag: "span", cls: "desc", x: 0, y: 40, w: 300, h: 0 }],
    ]);
    const [flag] = flagsOf(snapshot, "phantom-gap");
    expect(flag.measure).toMatchObject({ gap: 4, position: "last" });
  });

  it("leaves a column with nothing empty in it alone", () => {
    const snapshot = page([
      [0, -1, { cls: "stack", disp: "flex", fd: "column", gapR: 16, x: 0, y: 0, w: 300, h: 300 }],
      card(1, 0),
      card(2, 56),
    ]);
    expect(flagsOf(snapshot, "phantom-gap")).toEqual([]);
  });
});

describe("overflow", () => {
  it("flags a box that pushes the page sideways", () => {
    const snapshot = page([[0, -1, { cls: "wide", x: 0, y: 0, w: 500, h: 40 }]], {
      width: 390,
      scrollWidth: 500,
    });
    const [flag] = flagsOf(snapshot, "page-overflow");
    expect(flag.measure.scrollWidth).toBe(500);
  });

  it("leaves wide content inside a scroller alone", () => {
    const snapshot = page(
      [
        [
          0,
          -1,
          { cls: "scroller", clips: true, clipsX: true, ovx: "auto", x: 0, y: 0, w: 390, h: 40 },
        ],
        [1, 0, { cls: "wide", cp: 0, x: 0, y: 0, w: 500, h: 40 }],
      ],
      { width: 390, scrollWidth: 390 },
    );
    expect(flagsOf(snapshot, "page-overflow")).toEqual([]);
  });

  it("flags text running out of a painted box sideways", () => {
    const snapshot = page([
      [0, -1, { cls: "tag", bg: true, x: 0, y: 0, w: 60, h: 24, text: [[4, 2, 80, 20]] }],
    ]);
    const [flag] = flagsOf(snapshot, "text-spill");
    expect(flag.severity).toBe("S1");
  });

  it("leaves a tight-leading heading's font overhang alone", () => {
    const snapshot = page([
      [0, -1, { tag: "h1", lh: 44, fs: 40, x: 0, y: 0, w: 400, h: 44, text: [[0, -3, 300, 50]] }],
    ]);
    expect(flagsOf(snapshot, "text-spill")).toEqual([]);
  });

  it("flags text hard-clipped by overflow", () => {
    const snapshot = page([
      [
        0,
        -1,
        {
          cls: "clip",
          clips: true,
          clipsX: true,
          clipsY: true,
          ovx: "hidden",
          ovy: "hidden",
          x: 0,
          y: 0,
          w: 200,
          h: 20,
          sw: 200,
          sh: 40,
          cw: 200,
          ch: 20,
        },
      ],
      [
        1,
        0,
        {
          tag: "p",
          cp: 0,
          x: 0,
          y: 0,
          w: 200,
          h: 40,
          text: [
            [0, 0, 200, 20],
            [0, 20, 150, 20],
          ],
          label: "Two lines",
        },
      ],
    ]);
    expect(flagsOf(snapshot, "hard-clip")).toHaveLength(1);
  });

  it("flags a clipping box that holds its words directly, with no child element", () => {
    const snapshot = page([
      [
        0,
        -1,
        {
          cls: "clip",
          clips: true,
          clipsX: true,
          clipsY: true,
          ovx: "hidden",
          ovy: "hidden",
          x: 0,
          y: 0,
          w: 160,
          h: 20,
          sw: 160,
          sh: 48,
          cw: 160,
          ch: 20,
          text: [
            [0, 0, 160, 24],
            [0, 24, 90, 24],
          ],
          label: "Two lines",
        },
      ],
    ]);
    expect(flagsOf(snapshot, "hard-clip")).toHaveLength(1);
  });

  it("calls an ellipsis a truncation, not a clip", () => {
    const snapshot = page([
      [
        0,
        -1,
        {
          cls: "truncate",
          clips: true,
          clipsX: true,
          ovx: "hidden",
          to: "ellipsis",
          x: 0,
          y: 0,
          w: 100,
          h: 20,
          sw: 180,
          cw: 100,
          text: [[0, 0, 180, 20]],
          label: "A long name",
        },
      ],
    ]);
    expect(analyzeSnapshot(snapshot).map((flag) => flag.check)).toEqual(["truncated"]);
  });

  it("leaves a scroll container's overflow alone", () => {
    const snapshot = page([
      [
        0,
        -1,
        {
          cls: "scroll",
          clips: true,
          clipsX: true,
          clipsY: true,
          ovx: "auto",
          ovy: "auto",
          x: 0,
          y: 0,
          w: 200,
          h: 20,
          sw: 200,
          sh: 40,
          cw: 200,
          ch: 20,
        },
      ],
      [
        1,
        0,
        {
          tag: "p",
          cp: 0,
          x: 0,
          y: 0,
          w: 200,
          h: 40,
          text: [
            [0, 0, 200, 20],
            [0, 20, 150, 20],
          ],
        },
      ],
    ]);
    expect(flagsOf(snapshot, "hard-clip")).toEqual([]);
  });
});

describe("targets", () => {
  const link = { tag: "a", cls: "link", interactive: true, focusable: true };
  const targets = (snapshot) => flagsOf(snapshot, "small-target", { targets: true });

  it("flags a 20px link", () => {
    const [flag] = targets(
      page([[0, -1, { ...link, label: "Pricing", x: 0, y: 0, w: 50, h: 20 }]], { width: 390 }),
    );
    expect(flag.measure).toMatchObject({ h: 20, dimension: "height" });
  });

  it("counts a stretched ::after as the hit area", () => {
    const snapshot = page([
      [0, -1, { cls: "row", pos: "relative", x: 0, y: 0, w: 390, h: 56 }],
      [1, 0, { ...link, overlay: "after", x: 16, y: 19, w: 40, h: 18 }],
    ]);
    expect(targets(snapshot)).toEqual([]);
  });

  it("cuts that hit area down to a clipping cell, as issue #786 found", () => {
    const snapshot = page([
      [0, -1, { tag: "tr", cls: "row", pos: "relative", x: 0, y: 0, w: 390, h: 56 }],
      [
        1,
        0,
        {
          tag: "td",
          cls: "cell overflow-hidden",
          clips: true,
          clipsX: true,
          clipsY: true,
          x: 0,
          y: 18,
          w: 120,
          h: 20,
        },
      ],
      [2, 1, { ...link, cp: 1, overlay: "after", x: 8, y: 19, w: 40, h: 18 }],
    ]);
    expect(targets(snapshot)).toHaveLength(1);
    expect(hitBox(buildIndex(snapshot), snapshot.elements[2]).h).toBe(20);
  });

  it("leaves a link in running prose, a skip link and a mock inside an illustration alone", () => {
    const snapshot = page([
      [0, -1, { ...link, inProse: true, x: 0, y: 0, w: 50, h: 20 }],
      [1, -1, { ...link, label: "Skip to content", x: 0, y: 0, w: 50, h: 20 }],
      [2, -1, { ...link, inImg: true, x: 0, y: 0, w: 50, h: 20 }],
    ]);
    expect(targets(snapshot)).toEqual([]);
  });

  it("leaves a checkbox whose label is the target alone", () => {
    const snapshot = page([
      [0, -1, { tag: "label", x: 0, y: 0, w: 120, h: 44 }],
      [
        1,
        0,
        {
          tag: "input",
          type: "checkbox",
          interactive: true,
          focusable: true,
          x: 0,
          y: 14,
          w: 16,
          h: 16,
        },
      ],
    ]);
    expect(targets(snapshot)).toEqual([]);
  });

  it("only runs where a finger is the pointer", () => {
    const snapshot = page([[0, -1, { ...link, x: 0, y: 0, w: 50, h: 20 }]]);
    expect(flagsOf(snapshot, "small-target")).toEqual([]);
  });
});

describe("states", () => {
  const meta = { i: 7, sig: "a.row", csig: "div.card", cls: "row", label: "Row" };
  const box = (k, rect, extra = {}) => ({
    k,
    rect,
    bg: "rgba(0, 0, 0, 0)",
    bgAlpha: 0,
    bgi: false,
    bc: "",
    bw: [0, 0, 0, 0],
    rad: [0, 0, 0, 0],
    shadow: "none",
    clips: false,
    container: null,
    text: null,
    ...extra,
  });
  const snap = (extra = {}) => ({
    matches: { hover: true, focus: true, focusVisible: true },
    ow: 200,
    oh: 44,
    rect: [0, 0, 200, 44],
    parentRect: [0, 0, 400, 200],
    sib: [[0, 50, 200, 44]],
    outline: { style: "none", width: 0, offset: 0, color: "", alpha: 0 },
    shadow: "none",
    color: "rgb(0, 0, 0)",
    deco: "none",
    rel: [box("self", [0, 0, 200, 44])],
    ...extra,
  });
  const ring = { style: "solid", width: 3, offset: 2, color: "rgb(0, 100, 255)", alpha: 1 };
  const checks = (flags) => flags.map((flag) => flag.check);

  it("flags a hover that resizes the element", () => {
    expect(checks(analyzeStates(meta, snap(), snap({ ow: 204, oh: 48 }), null))).toContain(
      "hover-shift",
    );
  });

  it("leaves a hover lift drawn with transform alone", () => {
    const lifted = snap({ rect: [0, -2, 200, 44] });
    expect(checks(analyzeStates(meta, snap(), lifted, null))).not.toContain("hover-shift");
  });

  it("flags focus that changes nothing a person can see", () => {
    expect(checks(analyzeStates(meta, snap(), null, snap()))).toEqual(["focus-invisible"]);
  });

  it("leaves the global ring alone", () => {
    expect(analyzeStates(meta, snap(), null, snap({ outline: ring }))).toEqual([]);
  });

  it("flags a 2px ring as the component drawn two ways", () => {
    const flags = analyzeStates(meta, snap(), null, snap({ outline: { ...ring, width: 2 } }));
    expect(checks(flags)).toEqual(["focus-ring-differs"]);
  });

  it("leaves the global ring's inset twin alone: 3px at -3px, globals.css's focus-ring-inset", () => {
    const inset = snap({ outline: { ...ring, offset: -3 } });
    expect(analyzeStates(meta, snap(), null, inset)).toEqual([]);
  });

  it("still flags an inset ring drawn at any other width or offset", () => {
    const hand = snap({ outline: { ...ring, width: 2, offset: -2 } });
    expect(checks(analyzeStates(meta, snap(), null, hand))).toEqual(["focus-ring-differs"]);
  });

  it("ignores a state the probe could not force", () => {
    const unforced = snap({ matches: { hover: false, focus: false, focusVisible: false } });
    expect(analyzeStates(meta, snap(), unforced, unforced)).toEqual([]);
  });

  const card = { rect: [0, 0, 400, 200], rad: [20, 20, 20, 20], bw: [1, 1, 1, 1] };

  it("flags a square hover fill flush in a rounded card that does not clip", () => {
    const hover = snap({
      rel: [
        box("self", [1, 1, 398, 44], {
          bg: "rgb(240,240,240)",
          bgAlpha: 1,
          container: { ...card, clips: false },
        }),
      ],
    });
    const rest = snap({
      rel: [box("self", [1, 1, 398, 44], { container: { ...card, clips: false } })],
    });
    expect(checks(analyzeStates(meta, rest, hover, null))).toContain("fill-corners");
  });

  it("leaves the same fill alone once the card clips it", () => {
    const hover = snap({
      rel: [
        box("self", [1, 1, 398, 44], {
          bg: "rgb(240,240,240)",
          bgAlpha: 1,
          container: { ...card, clips: true },
        }),
      ],
    });
    const rest = snap({
      rel: [box("self", [1, 1, 398, 44], { container: { ...card, clips: true } })],
    });
    expect(checks(analyzeStates(meta, rest, hover, null))).not.toContain("fill-corners");
  });

  it("flags a hover fill that touches its text, and leaves a padded one alone", () => {
    const rest = snap({ rel: [box("self", [0, 0, 200, 44])] });
    const tight = snap({
      rel: [
        box("self", [0, 0, 200, 44], {
          bg: "rgb(240,240,240)",
          bgAlpha: 1,
          text: [0, 12, 120, 20],
        }),
      ],
    });
    const roomy = snap({
      rel: [
        box("self", [0, 0, 200, 44], {
          bg: "rgb(240,240,240)",
          bgAlpha: 1,
          text: [12, 12, 120, 20],
        }),
      ],
    });
    expect(checks(analyzeStates(meta, rest, tight, null))).toContain("fill-tight");
    expect(checks(analyzeStates(meta, rest, roomy, null))).not.toContain("fill-tight");
  });

  it("reads a ring's reach from an outline or a ring shadow, never an inset one", () => {
    expect(ringReach({ outline: ring, shadow: "none" })).toBe(5);
    expect(ringReach({ outline: { ...ring, offset: -2, width: 2 }, shadow: "none" })).toBe(0);
    expect(
      ringReach({ outline: { style: "none" }, shadow: "rgb(0, 100, 255) 0px 0px 0px 2px" }),
    ).toBe(2);
    expect(
      ringReach({ outline: { style: "none" }, shadow: "rgb(0, 100, 255) 0px 0px 0px 2px inset" }),
    ).toBe(0);
  });
});

describe("clusters, the settled list and the census", () => {
  const flag = {
    check: "nested-corners",
    sig: "span.pill",
    csig: "nav.track",
    cls: "pill rounded-lg",
    label: "",
  };

  it("keys one shared component's flaw as one cluster", () => {
    expect(clusterKey(flag)).toBe(clusterKey({ ...flag, label: "other" }));
    expect(clusterKey(flag)).not.toBe(clusterKey({ ...flag, csig: "div.card" }));
  });

  it("matches a settled entry by signature or by classes, and never by check alone", () => {
    const settled = [
      { check: "nested-corners", classes: ["pill"], reason: "why", pointer: "x.tsx:1" },
      { check: "off-centre", reason: "too broad", pointer: "y" },
    ];
    expect(settledEntryFor(flag, settled)?.pointer).toBe("x.tsx:1");
    expect(settledEntryFor({ ...flag, check: "off-centre" }, settled)).toBeNull();
    expect(settledEntryFor({ ...flag, cls: "other" }, settled)).toBeNull();
  });

  it("finds one family at 22 and 24px, and leaves a deliberate size step alone", () => {
    const badge = (i, cls, h) => [
      i,
      -1,
      { tag: "span", cls, bg: true, x: 0, y: i * 40, w: 60, h, text: [[4, i * 40 + 2, 50, 18]] },
    ];
    const census = censusOf(
      page([
        badge(0, "rounded-full px-2 text-xs bg-danger-tint", 22),
        badge(1, "rounded-full px-2 text-xs bg-success-tint", 22),
        badge(2, "rounded-full px-2 text-xs bg-surface text-muted", 24),
      ]),
    );
    const misses = censusNearMisses(census);
    expect(misses.some((miss) => miss.metric === "h" && miss.values.join() === "22,24")).toBe(true);
    const steps = censusNearMisses(
      censusOf(
        page([badge(0, "rounded-full px-2 bg-a", 44), badge(1, "rounded-full px-2 bg-b", 56)]),
      ),
    );
    expect(steps.filter((miss) => miss.metric === "h")).toEqual([]);
  });
});
