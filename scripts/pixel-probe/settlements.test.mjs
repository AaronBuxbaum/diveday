import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIndex, settledEntryFor, visualLeft } from "./analyze.mjs";
import { settlementContextFor } from "./settlements.mjs";

const settled = JSON.parse(
  fs.readFileSync(new URL("../pixel-probe-settled.json", import.meta.url), "utf8"),
).settled;
const E = {
  tag: "div",
  cls: "",
  x: 16,
  y: 0,
  w: 300,
  h: 20,
  text: [],
  disp: "block",
  pos: "static",
  op: 1,
  vis: "visible",
  srOnly: false,
  bg: false,
  bw: [0, 0, 0, 0],
  shadow: false,
  clipsX: false,
};
const snapshotOf = (rows) => ({
  elements: rows.map(([p, props], i) => ({ ...E, i, p, ...props })),
  truncated: false,
});

function conditions() {
  return snapshotOf([
    [-1, { id: "main-content", cls: "flex flex-col outline-none" }],
    [0, { id: "public-shop-main-content", cls: "flex flex-1 flex-col outline-none" }],
    [1, { cls: "space-y-10 lg:contents lg:space-y-0" }],
    [2, {}],
    [3, { tag: "section", cls: "border-t border-border pt-4 px-2" }],
    [4, { tag: "p", cls: "overflow-x-clip text-sm text-muted", ovx: "clip", clipsX: true }],
    [
      5,
      {
        tag: "span",
        cls: "-ms-3 flex flex-wrap items-baseline gap-x-2",
        x: 4,
        disp: "flex",
        fw: "wrap",
      },
    ],
    [6, { tag: "span", cls: "inline-flex items-baseline gap-x-2", x: 4 }],
    [
      7,
      { tag: "span", cls: "w-1 text-center", x: 4, w: 4, ariaHidden: true, text: [[4, 0, 4, 20]] },
    ],
    [7, { tag: "span", text: [[16, 0, 150, 20]] }],
    [4, { tag: "p", text: [[16, 40, 150, 20]] }],
    [4, { tag: "p", text: [[16, 80, 150, 20]] }],
  ]);
}

/** The real 390px path: the summary's rule is the depth-7 fallback edge. */
function outerConditions() {
  return snapshotOf([
    [-1, { id: "main-content", cls: "flex flex-1 flex-col outline-none" }],
    [0, { id: "public-shop-main-content", cls: "flex flex-1 flex-col outline-none" }],
    [
      1,
      {
        tag: "main",
        cls: "mx-auto w-full max-w-xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:max-w-5xl",
      },
    ],
    [2, { cls: "lg:grid lg:grid-cols-[minmax(0,1fr)_25rem]" }],
    [3, { cls: "mt-10 space-y-10 lg:contents lg:space-y-0" }],
    [4, {}],
    [5, { tag: "section", cls: "border-t border-border pt-4 -mx-2 px-2", x: 8 }],
    [6, { tag: "p", cls: "overflow-x-clip text-sm text-muted", ovx: "clip", clipsX: true }],
    [
      7,
      {
        tag: "span",
        cls: "-ms-3 flex flex-wrap items-baseline gap-x-2",
        x: 4,
        disp: "flex",
        fw: "wrap",
      },
    ],
    [8, { tag: "span", cls: "inline-flex items-baseline gap-x-2", x: 4 }],
    [
      9,
      { tag: "span", cls: "w-1 text-center", x: 4, w: 4, ariaHidden: true, text: [[4, 0, 4, 20]] },
    ],
    [9, { tag: "span", text: [[16, 0, 150, 20]] }],
    [6, { tag: "p", text: [[16, 40, 150, 20]] }],
    [6, { tag: "p", text: [[16, 80, 150, 20]] }],
    [5, { tag: "section" }],
    [14, { tag: "details", cls: "group/fold mt-4" }],
    [15, { tag: "summary", cls: "-mx-2 px-2 flex min-h-14 border-t border-border", x: 8 }],
    [16, { tag: "svg", replaced: true, w: 16 }],
    [16, { tag: "span", x: 40, text: [[40, 100, 100, 20]] }],
  ]);
}
const edges = [
  {
    el: 5,
    sig: "p.overflow-x-clip text-muted text-sm",
    csig: "section.border-border border-t pt-4 px-2",
  },
  { el: 1, sig: "div.flex flex-col outline-none", csig: "div.flex flex-col outline-none" },
  {
    el: 3,
    sig: "div{block;p0,0,0,0;b0,0,0,0;r0,0,0,0;f16/400;}",
    csig: "div.lg:contents lg:space-y-0 space-y-10",
  },
].map((edge) => ({
  ...edge,
  check: "ragged-edges",
  measure: {
    lefts: [4, 16, 16],
    mode: 16,
    strays: [{ sig: edge.sig, off: -12 }],
  },
}));
const recordFor = (snapshot, capture = "booking-email-correction") => ({
  capture,
  settlementContext: settlementContextFor(snapshot),
});

describe("the clipped ConditionsLine separator and its two transparent ancestors", () => {
  it("proves the real outer skip region beyond the summary rule's depth-cutoff edge", () => {
    const snapshot = outerConditions();
    const ix = buildIndex(snapshot);
    const clipped = buildIndex({
      ...snapshot,
      elements: snapshot.elements.map((el) => (el.i === 7 ? { ...el, replaced: true } : el)),
    });
    expect(visualLeft(ix, ix.els[1])).toBe(4);
    expect(visualLeft(clipped, clipped.els[1])).toBe(8);
    const flag = { ...edges[1], measure: { ...edges[1].measure, lefts: [26, 16, 4, 16] } };
    expect(settledEntryFor(flag, settled, recordFor(snapshot))?.context).toBe(
      "conditions-line-separator",
    );
  });

  it("leaves another visible stray or a different outer region open at that depth", () => {
    const snapshot = outerConditions();
    snapshot.elements.push({ ...E, i: 19, p: 5, tag: "p", x: 4, text: [[4, 100, 90, 20]] });
    expect(settledEntryFor(edges[1], settled, recordFor(snapshot))).toBeNull();
    snapshot.elements.pop();
    snapshot.elements[1].id = "unrelated-main-content";
    expect(settledEntryFor(edges[1], settled, recordFor(snapshot))).toBeNull();
  });

  it("settles exactly the measured -12px propagation in the reviewed captures", () => {
    for (const capture of ["booking-email-correction", "site-briefing"]) {
      for (const flag of edges) {
        expect(settledEntryFor(flag, settled, recordFor(conditions(), capture))?.context).toBe(
          "conditions-line-separator",
        );
      }
    }
  });

  it("leaves other captures, absent evidence and different elements open", () => {
    for (const flag of edges) {
      expect(settledEntryFor(flag, settled, recordFor(conditions(), "some-other-trip"))).toBeNull();
      expect(settledEntryFor(flag, settled, { capture: "site-briefing" })).toBeNull();
      expect(settledEntryFor({ ...flag, el: 100 }, settled, recordFor(conditions()))).toBeNull();
    }
  });

  it.each(["absent", "unclipped", "different offset", "different separator", "truncated"])(
    "leaves the %s subtree open",
    (change) => {
      const snapshot = conditions();
      if (change === "absent") snapshot.elements[5].cls = "text-sm text-muted";
      if (change === "unclipped")
        Object.assign(snapshot.elements[5], { ovx: "visible", clipsX: false });
      if (change === "different offset") snapshot.elements[6].x = 8;
      if (change === "different separator") snapshot.elements[8].ariaHidden = false;
      if (change === "truncated") snapshot.truncated = true;
      for (const flag of edges)
        expect(settledEntryFor(flag, settled, recordFor(snapshot))).toBeNull();
    },
  );

  it("leaves changed probe measurements open even with the original subtree", () => {
    const flag = edges[0];
    const record = recordFor(conditions());
    for (const measure of [
      { ...flag.measure, strays: [{ sig: flag.sig, off: -8 }] },
      { ...flag.measure, mode: 20 },
      { ...flag.measure, strays: [...flag.measure.strays, { sig: "p.other", off: -4 }] },
    ])
      expect(settledEntryFor({ ...flag, measure }, settled, record)).toBeNull();
  });

  it("does not settle a real visible -12px stray beside the verified clipped subtree", () => {
    const snapshot = conditions();
    snapshot.elements.push({ ...E, i: 12, p: 3, tag: "p", x: 4, text: [[4, 100, 90, 20]] });
    const record = recordFor(snapshot);
    expect(settledEntryFor(edges[0], settled, record)).not.toBeNull();
    expect(settledEntryFor(edges[1], settled, record)).toBeNull();
    expect(settledEntryFor(edges[2], settled, record)).toBeNull();
  });
});

function certChecks() {
  const rows = [];
  const add = (p, props) => {
    rows.push([p, props]);
    return rows.length - 1;
  };
  const list = add(-1, { tag: "ol", cls: "mt-4 divide-y divide-border" });
  const bodies = [];
  for (let number = 1; number <= 4; number += 1) {
    const step = add(list, {
      tag: "li",
      disp: "grid",
      cls: "grid grid-cols-[2rem_1fr] gap-x-3 py-4",
    });
    add(step, { tag: "span", cls: "font-semibold tabular-nums text-muted" });
    const content = add(step, { cls: "min-w-0", x: 60 });
    add(content, { tag: "h2", cls: "text-base font-semibold", x: 60 });
    bodies.push(add(content, { cls: "mt-2 text-sm", x: 60 }));
  }
  const badge = (parent, x) => {
    const pill = add(parent, {
      tag: "span",
      x,
      cls: "inline-flex items-baseline rounded-full font-medium whitespace-nowrap gap-1 px-3 py-1 text-sm bg-success-tint text-success-strong",
    });
    return add(pill, { tag: "svg", cls: "size-4 shrink-0 self-center", x: x + 12, w: 16, h: 16 });
  };
  const firstIcon = badge(bodies[0], 60);
  const samples = add(bodies[1], { tag: "ul", cls: "space-y-2", x: 60 });
  const sample = add(samples, {
    tag: "li",
    cls: "flex flex-wrap items-center gap-x-3 gap-y-1",
    x: 60,
  });
  add(sample, { tag: "span", cls: "min-w-16 font-medium", x: 60, w: 64 });
  const sampleIcon = badge(sample, 136);
  const lastIcon = badge(bodies[2], 60);
  const snapshot = snapshotOf(rows);
  const flag = {
    el: firstIcon,
    check: "ragged-column",
    sig: "svg.size-4",
    csig: "ol.divide-border divide-y",
    cls: "size-4 shrink-0 self-center",
    measure: { xs: [72, 148, 72], leftSpread: 76, rightSpread: 76, child: "svg.size-4" },
  };
  return { snapshot, flag, samples, sample, sampleIcon, lastIcon };
}

describe("Try the checks' nested sample-result status", () => {
  it("settles the reviewed four-step structure and 76px agency-label inset", () => {
    const { snapshot, flag } = certChecks();
    expect(
      settledEntryFor(flag, settled, recordFor(snapshot, "settings-cert-checks"))?.context,
    ).toBe("cert-check-step-icons");
  });

  it("leaves other captures and a generic SVG list column open", () => {
    const { snapshot, flag, samples } = certChecks();
    expect(settledEntryFor(flag, settled, recordFor(snapshot, "settings-team"))).toBeNull();
    snapshot.elements[samples].tag = "div";
    expect(settledEntryFor(flag, settled, recordFor(snapshot, "settings-cert-checks"))).toBeNull();
  });

  it("leaves a changed nested result, column measurement or icon open", () => {
    const { snapshot, flag, sampleIcon } = certChecks();
    const record = recordFor(snapshot, "settings-cert-checks");
    expect(settledEntryFor({ ...flag, el: sampleIcon }, settled, record)).toBeNull();
    expect(
      settledEntryFor(
        { ...flag, measure: { ...flag.measure, xs: [72, 144, 72] } },
        settled,
        record,
      ),
    ).toBeNull();
    snapshot.elements[sampleIcon].x -= 4;
    expect(settledEntryFor(flag, settled, recordFor(snapshot, "settings-cert-checks"))).toBeNull();
  });

  it("does not settle an unknown context or unscoped contextual entry", () => {
    const { snapshot, flag } = certChecks();
    const entry = settled.find((entry) => entry.context === "cert-check-step-icons");
    const record = recordFor(snapshot, "settings-cert-checks");
    expect(settledEntryFor(flag, [{ ...entry, context: "any-svg-column" }], record)).toBeNull();
    expect(settledEntryFor(flag, [{ ...entry, captures: undefined }], record)).toBeNull();
  });
});
