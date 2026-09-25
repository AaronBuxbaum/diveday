import type { Page } from "@playwright/test";
import {
  analyzeSnapshot,
  analyzeStates,
  buildIndex,
  elementMeta,
} from "../scripts/pixel-probe/analyze.mjs";
import { collectGeometry } from "../scripts/pixel-probe/collect.mjs";
import { statePass } from "../scripts/pixel-probe/states.mjs";
import { expect, test } from "./fixtures";

/**
 * **The pixel probe, held to fixtures of its own.**
 *
 * `scripts/pixel-probe/` proposes candidates, never verdicts, and a list of
 * candidates is only worth reading while it is mostly right: a check that keeps
 * flagging correct code teaches everyone to skim past it, and then its real
 * finds go unread too. So every check gets two tiny pages here, in plain CSS
 * with no app styles — the defect it names, which it must flag, and the correct
 * twin a line or two away, which it must leave alone. A twin that starts being
 * flagged is the probe drifting into noise, and this is where that shows first.
 *
 * Every page carries the two globals the probe's numbers assume
 * (src/app/globals.css): the 3px focus ring at a 2px offset, and
 * `body { overflow-x: clip }`. The state checks force `:hover` and
 * `:focus-visible` through the same CDP pass the visual suite runs, and assert
 * the state actually took before judging it — a pass that forced nothing
 * returns no flags, and must not read as a clean twin.
 */

const PHONE = { width: 390, height: 800 };

const GLOBALS = `
  :where(a, button, input, select, textarea, summary):focus-visible { outline: 3px solid #0a6cff; outline-offset: 2px; }
  body { margin: 0; font: 16px/1.5 sans-serif; overflow-x: clip }
  button { font: inherit; color: inherit; }
  .page { padding: 16px; }
`;

/** One fixture page: the globals, the check's own CSS, and its markup inside a padded `.page`. */
function html(css: string, body: string): string {
  return `<!doctype html><html><head><style>${GLOBALS}${css}</style></head><body><main class="page">${body}</main></body></html>`;
}

type Probed = { i: number; cls: string; label: string };
type Snapshot = { elements: Probed[] };
type Flag = ReturnType<typeof analyzeSnapshot>[number];

async function snapshotOf(page: Page, doc: string): Promise<Snapshot> {
  await page.setViewportSize(PHONE);
  await page.setContent(doc);
  return (await page.evaluate(collectGeometry, {})) as Snapshot;
}

/** The first collected element wearing `token` — so a twin cannot pass by rendering nothing. */
function byClass(snapshot: Snapshot, token: string): Probed {
  const found = snapshot.elements.find((el) => el.cls.split(/\s+/).includes(token));
  if (!found) throw new Error(`the fixture rendered no element with class "${token}"`);
  return found;
}

function listed(flags: { cls: string; msg: string }[]): string[] {
  return flags.map((flag) => `.${flag.cls.replace(/\s+/g, ".")}: ${flag.msg}`);
}

/** Run one static check, alone, over a fixture; `target` must have been collected. */
async function staticFlags(page: Page, check: string, doc: string, target: string) {
  const snapshot = await snapshotOf(page, doc);
  const el = byClass(snapshot, target);
  const flags = analyzeSnapshot(snapshot, {
    checks: new Set([check]),
    targets: check === "small-target",
  });
  return { el, flags };
}

async function flagsStatic(page: Page, check: string, doc: string, target: string): Promise<Flag> {
  const { el, flags } = await staticFlags(page, check, doc, target);
  const hit = flags.find((flag) => flag.el === el.i);
  expect(
    hit,
    `${check} should flag .${target}; it raised: ${listed(flags).join(" | ")}`,
  ).toBeTruthy();
  return hit as Flag;
}

async function leavesStatic(page: Page, check: string, doc: string, target: string) {
  const { flags } = await staticFlags(page, check, doc, target);
  expect(listed(flags)).toEqual([]);
}

/** What the visual spec's `withRendererBound` does, minus the renderer probe: race a timer. */
async function bound(
  _what: string,
  ms: number,
  work: Promise<unknown>,
  degraded: unknown,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise((resolve) => {
    timer = setTimeout(() => resolve(degraded), ms);
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/** Force hover and focus on `.target`, confirm both took, and judge them. */
async function stateFlags(page: Page, doc: string, target: string) {
  const snapshot = await snapshotOf(page, doc);
  const el = byClass(snapshot, target);
  const { results, stats } = await statePass(page, {
    candidates: [el.i],
    mode: "full",
    bound,
    callMs: 5_000,
    deadline: Date.now() + 10_000,
  });
  expect(stats.error).toBeNull();
  const entry = results.get(el.i);
  expect(entry?.hover?.matches.hover, "hover was forced").toBe(true);
  expect(entry?.focus?.matches.focusVisible, "focus-visible was forced").toBe(true);
  return analyzeStates(elementMeta(buildIndex(snapshot), el), entry.rest, entry.hover, entry.focus);
}

async function flagsState(page: Page, check: string, doc: string, target: string) {
  const flags = await stateFlags(page, doc, target);
  const hit = flags.find((flag) => flag.check === check);
  expect(
    hit,
    `${check} should flag .${target}; it raised: ${listed(flags).join(" | ")}`,
  ).toBeTruthy();
  return hit as ReturnType<typeof analyzeStates>[number];
}

async function leavesState(page: Page, check: string, doc: string, target: string) {
  const flags = await stateFlags(page, doc, target);
  expect(listed(flags.filter((flag) => flag.check === check))).toEqual([]);
}

// ---------------------------------------------------------------------------
// Static checks.

test.describe("focus-ring-clipped", () => {
  const card = (padding: number, rowRadius: number) =>
    html(
      `.card { border-radius: 20px; overflow: hidden; background: #f2f4f7; padding: ${padding}px; }
       .row { display: block; padding: 12px 16px; border-radius: ${rowRadius}px; }
       .note { margin: 0; padding: 12px 16px; }`,
      `<div class="card"><a class="row" href="#">Tuesday dives</a><p class="note">Two boats out</p></div>`,
    );

  test("flags a full-width row flush against a clipping rounded card", async ({ page }) => {
    const flag = await flagsStatic(page, "focus-ring-clipped", card(0, 0), "row");
    // The row is the card's first child: the ring is cut on the top and both sides.
    expect(flag.measure.sides).toEqual({ left: 5, right: 5, top: 5 });
  });

  test("leaves a row inset by the card's padding, its corners nested, alone", async ({ page }) => {
    // 8px of padding clears the ring's 5px reach on every side; a square row
    // would still lose its ring's corners to the card's 20px arc, so the row
    // takes the nested 12px radius the ladder gives it.
    await leavesStatic(page, "focus-ring-clipped", card(8, 12), "row");
  });

  // The command palette's shape: an input that keeps focus and moves
  // `aria-activedescendant`, over a scrolling listbox whose options sit flush
  // against its sides.
  const palette = (optionAttrs: string) =>
    html(
      `.list { height: 120px; overflow-y: auto; padding: 8px 0; }
       .opt { display: block; width: 100%; padding: 12px 20px; border: 0; background: none; text-align: left; }`,
      `<input class="field" role="combobox" aria-controls="list" aria-activedescendant="o1">
       <div id="list" class="list" role="listbox"><button id="o1" class="opt" type="button" role="option" ${optionAttrs}>Tuesday dives</button></div>`,
    );

  test("flags an option in the tab order flush in a scrolling listbox", async ({ page }) => {
    await flagsStatic(page, "focus-ring-clipped", palette(""), "opt");
  });

  test("leaves an option focus never reaches (tabindex -1) alone", async ({ page }) => {
    await leavesStatic(page, "focus-ring-clipped", palette(`tabindex="-1"`), "opt");
  });

  test("hovers that option but never forces it into focus", async ({ page }) => {
    const snapshot = await snapshotOf(page, palette(`tabindex="-1"`));
    const el = byClass(snapshot, "opt");
    const { results, stats } = await statePass(page, {
      candidates: [el.i],
      hoverOnly: new Set([el.i]),
      mode: "full",
      bound,
      callMs: 5_000,
      deadline: Date.now() + 10_000,
    });
    expect(stats.error).toBeNull();
    expect(results.get(el.i)?.hover?.matches.hover, "hover was forced").toBe(true);
    expect(results.get(el.i)?.focus).toBeNull();
  });
});

test.describe("nested-corners", () => {
  const track = (pillRadius: number) =>
    html(
      `.track { display: flex; width: 240px; padding: 5px; border-radius: 12px; background: #e4e7ec; }
       .pill { flex: 1; height: 32px; border-radius: ${pillRadius}px; background: #fff; }`,
      `<div class="track"><span class="pill"></span></div>`,
    );

  test("flags a 12px pill 5px inside a 12px track", async ({ page }) => {
    const flag = await flagsStatic(page, "nested-corners", track(12), "pill");
    expect(flag.measure).toMatchObject({ gap: 5, expected: 7, actual: 12 });
  });

  test("leaves a 7px pill 5px inside a 12px track alone", async ({ page }) => {
    await leavesStatic(page, "nested-corners", track(7), "pill");
  });
});

test.describe("off-centre", () => {
  const button = (padding: string) =>
    html(
      `.btn { display: flex; align-items: center; justify-content: center; height: 44px;
              padding: ${padding}; border: 0; border-radius: 12px; background: #0a6cff; color: #fff; }`,
      `<button class="btn" type="button">Save</button>`,
    );

  test("flags a centred button whose side paddings differ", async ({ page }) => {
    const flag = await flagsStatic(page, "off-centre", button("0 16px 0 12px"), "btn");
    // 12px left, 16px right: the label sits 2px left of the painted box's centre.
    expect(flag.measure.x).toBe(-2);
  });

  test("leaves a button with equal side paddings alone", async ({ page }) => {
    await leavesStatic(page, "off-centre", button("0 14px"), "btn");
  });
});

test.describe("three-part-row", () => {
  const bar = (start: string) =>
    html(
      `.bar { display: flex; justify-content: space-between; align-items: center; height: 44px; }
       .side { width: 80px; }`,
      `<div class="bar">${start}<span class="title">Tuesday</span><a class="side" href="#">Share</a></div>`,
    );

  test("flags a spread row whose left side is an empty placeholder", async ({ page }) => {
    const flag = await flagsStatic(
      page,
      "three-part-row",
      bar(`<span class="spacer"></span>`),
      "title",
    );
    // The title centres between 0px and 80px of sides: half the difference left.
    expect(flag.measure.offset).toBeCloseTo(-40, 0);
    expect(flag.measure.placeholder).toBe(true);
  });

  test("leaves a spread row with equal-width sides alone", async ({ page }) => {
    await leavesStatic(page, "three-part-row", bar(`<a class="side" href="#">Back</a>`), "title");
  });
});

test.describe("mismatched-controls", () => {
  const row = (firstClass: string) =>
    html(
      `.row { display: flex; gap: 8px; align-items: center; }
       .btn { height: 44px; padding: 0 16px; border: 0; border-radius: 12px; background: #e4e7ec; }
       .btn.tall { height: 48px; }`,
      `<div class="row"><button class="${firstClass}" type="button">Cancel</button><button class="btn save" type="button">Save</button></div>`,
    );

  test("flags a 48px and a 44px button sharing a row", async ({ page }) => {
    // The flag lands on the odd one out, which the check takes to be the shorter.
    const flag = await flagsStatic(page, "mismatched-controls", row("btn tall"), "save");
    expect(flag.measure.heights).toEqual([48, 44]);
  });

  test("leaves two 44px buttons sharing a row alone", async ({ page }) => {
    await leavesStatic(page, "mismatched-controls", row("btn"), "save");
  });
});

test.describe("text-beside-control", () => {
  const row = (align: string) =>
    html(
      `.row { display: flex; align-items: ${align}; gap: 12px; }
       .title { margin: 0; font-size: 18px; line-height: 24px; }
       .btn { height: 44px; padding: 0 16px; border: 0; border-radius: 12px; background: #e4e7ec; }`,
      `<div class="row"><h2 class="title">Tuesday</h2><button class="btn" type="button">Add</button></div>`,
    );

  test("flags a heading top-aligned beside a taller button", async ({ page }) => {
    const flag = await flagsStatic(page, "text-beside-control", row("flex-start"), "title");
    // A 24px line at the top of a 44px row: its centre is 10px above the button's.
    expect(flag.measure.lineCentre).toBeLessThan(-1.5);
    expect(flag.msg).toContain("above");
  });

  test("leaves a heading centred beside the button alone", async ({ page }) => {
    await leavesStatic(page, "text-beside-control", row("center"), "title");
  });
});

test.describe("ragged-edges", () => {
  const stack = (middleClass: string) =>
    html(
      `.line { margin: 0; }
       .nudged { padding-left: 4px; }`,
      `<div class="stack"><p class="line">Boat A</p><p class="${middleClass}">Boat B</p><p class="line">Boat C</p></div>`,
    );

  test("flags one line of a stack starting 4px right of the others", async ({ page }) => {
    const flag = await flagsStatic(page, "ragged-edges", stack("line nudged"), "nudged");
    expect(flag.measure.strays).toEqual([{ sig: "p.line nudged", off: 4 }]);
  });

  test("leaves a stack whose lines share one left edge alone", async ({ page }) => {
    await leavesStatic(page, "ragged-edges", stack("line"), "stack");
  });
});

test.describe("ragged-column", () => {
  const list = (caret: string) =>
    html(
      `.list { margin: 0; padding: 0; list-style: none; }
       .item { display: flex; align-items: center; gap: 8px; height: 44px; }
       .caret { color: #667085; ${caret} }`,
      `<ul class="list">
         <li class="item"><span class="name">Ann Lee</span><span class="caret">›</span></li>
         <li class="item"><span class="name">Bartholomew Okafor</span><span class="caret">›</span></li>
         <li class="item"><span class="name">Christopher Jones-Whitfield</span><span class="caret">›</span></li>
       </ul>`,
    );

  test("flags a caret that follows each row's text across repeated rows", async ({ page }) => {
    const flag = await flagsStatic(page, "ragged-column", list(""), "caret");
    expect(flag.measure.leftSpread).toBeGreaterThan(2);
    expect(flag.measure.rightSpread).toBeGreaterThan(2);
  });

  test("leaves a caret pushed to each row's right edge alone", async ({ page }) => {
    await leavesStatic(page, "ragged-column", list("margin-left: auto;"), "caret");
  });
});

test.describe("uneven-gaps", () => {
  // `mt-2` is a placement utility, so the signature strips it: all three cards
  // read as one component, which is what makes their gaps comparable.
  const stack = (lastClass: string) =>
    html(
      `.stack { display: flex; flex-direction: column; gap: 16px; }
       .card { height: 48px; border-radius: 12px; background: #e4e7ec; }
       .mt-2 { margin-top: 8px; }`,
      `<div class="stack"><div class="card"></div><div class="card"></div><div class="${lastClass}"></div></div>`,
    );

  test("flags three like cards with gaps of 16px and 24px", async ({ page }) => {
    const flag = await flagsStatic(page, "uneven-gaps", stack("card mt-2"), "mt-2");
    expect(flag.measure).toMatchObject({ gaps: [16, 24], axis: "y" });
  });

  test("leaves three like cards 16px apart alone", async ({ page }) => {
    await leavesStatic(page, "uneven-gaps", stack("card"), "stack");
  });
});

test.describe("phantom-gap", () => {
  const stack = (middle: string) =>
    html(
      `.stack { display: flex; flex-direction: column; gap: 16px; }
       .card { height: 48px; border-radius: 12px; background: #e4e7ec; }`,
      `<div class="stack"><div class="card"></div>${middle}<div class="card"></div></div>`,
    );

  test("flags an empty child that doubles a column's gap", async ({ page }) => {
    const flag = await flagsStatic(page, "phantom-gap", stack(`<div class="slot"></div>`), "slot");
    expect(flag.measure).toEqual({ spanned: 32, usual: 16 });
  });

  test("leaves a column with no empty child alone", async ({ page }) => {
    await leavesStatic(page, "phantom-gap", stack(""), "stack");
  });

  test("leaves an empty slot in a spread row alone: the free space takes its gap", async ({
    page,
  }) => {
    // The ready roster row: a name, then a badge slot that is empty for a
    // ready diver, in a `justify-content: space-between` header.
    const header = html(
      `.header { display: flex; justify-content: space-between; align-items: center; gap: 12px; height: 44px; }`,
      `<div class="header"><span class="name">Ann Lee</span><div class="badges"></div></div>`,
    );
    await leavesStatic(page, "phantom-gap", header, "badges");
  });
});

test.describe("page-overflow", () => {
  const banner = (extra: string) =>
    html(
      `.banner { width: 500px; height: 48px; background: #e4e7ec; ${extra} }`,
      `<div class="banner"></div>`,
    );

  test("flags a 500px box on a 390px page", async ({ page }) => {
    const flag = await flagsStatic(page, "page-overflow", banner(""), "banner");
    expect(flag.measure.width).toBe(PHONE.width);
    expect(flag.measure.scrollWidth).toBeGreaterThan(PHONE.width);
  });

  test("leaves the same box capped at max-width: 100% alone", async ({ page }) => {
    await leavesStatic(page, "page-overflow", banner("max-width: 100%;"), "banner");
  });
});

test.describe("text-spill", () => {
  const chip = (extra: string) =>
    html(
      `.chip { width: 120px; padding: 4px 8px; border-radius: 12px; background: #e4e7ec; ${extra} }`,
      `<div class="chip">Supercalifragilisticexpialidocious</div>`,
    );

  test("flags an unbreakable word running out of its painted box", async ({ page }) => {
    const flag = await flagsStatic(page, "text-spill", chip(""), "chip");
    expect(flag.severity).toBe("S1");
    expect(flag.measure.spillX).toBeGreaterThan(1);
  });

  test("leaves the same word allowed to break anywhere alone", async ({ page }) => {
    await leavesStatic(page, "text-spill", chip("overflow-wrap: anywhere;"), "chip");
  });

  test("leaves a preserved space hanging at a wrap alone", async ({ page }) => {
    // `pre-wrap` keeps the space at each wrap and lets it hang past the line's
    // end (the waiver release, a diver's message). "aaaa bbbb" fills the 9ch
    // box exactly, so the space after it hangs 1ch outside: no ink does.
    const release = html(
      `.release { width: 9ch; margin: 0; font: 16px/24px monospace; white-space: pre-wrap; }`,
      `<p class="release">aaaa bbbb cccc dddd</p>`,
    );
    await leavesStatic(page, "text-spill", release, "release");
  });
});

test.describe("hard-clip", () => {
  const box = (height: string) =>
    html(
      `.clip { width: 160px; height: ${height}; overflow: hidden; }
       .copy { margin: 0; }`,
      `<div class="clip"><p class="copy">Two lines of copy that wrap in a narrow box</p></div>`,
    );

  test("flags a 20px-tall overflow-hidden box cutting wrapped text", async ({ page }) => {
    const flag = await flagsStatic(page, "hard-clip", box("20px"), "clip");
    expect(flag.measure.client).toEqual([160, 20]);
    expect(flag.measure.cut).toEqual(["p.copy"]);
  });

  test("leaves the same box at its natural height alone", async ({ page }) => {
    await leavesStatic(page, "hard-clip", box("auto"), "clip");
  });
});

test.describe("truncated", () => {
  const name = (text: string) =>
    html(
      `.name { width: 100px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
      `<div class="name">${text}</div>`,
    );

  test("flags an ellipsis that is cutting a long name", async ({ page }) => {
    const flag = await flagsStatic(page, "truncated", name("Christopher Jones-Whitfield"), "name");
    expect(flag.measure.scrollWidth).toBeGreaterThan(flag.measure.clientWidth);
  });

  test("leaves an ellipsis box whose name fits alone", async ({ page }) => {
    await leavesStatic(page, "truncated", name("Ann Lee"), "name");
  });
});

test.describe("small-target", () => {
  const nav = (css: string) =>
    html(`.link { ${css} }`, `<nav class="links"><a class="link" href="#">Settings</a></nav>`);

  test("flags a 20px-tall link at phone width", async ({ page }) => {
    const flag = await flagsStatic(
      page,
      "small-target",
      nav("display: inline-block; height: 20px; line-height: 20px;"),
      "link",
    );
    expect(flag.measure).toMatchObject({ h: 20, dimension: "height" });
  });

  test("leaves a link with a 44px minimum height alone", async ({ page }) => {
    await leavesStatic(
      page,
      "small-target",
      nav("display: inline-flex; align-items: center; min-height: 44px; padding: 0 12px;"),
      "link",
    );
  });
});

// ---------------------------------------------------------------------------
// State checks: hover and focus forced through CDP.

const BUTTON = `.btn { height: 44px; padding: 0 16px; border-radius: 12px; background: #e4e7ec; }`;

test.describe("hover-shift", () => {
  const button = (css: string) =>
    html(`${BUTTON} ${css}`, `<button class="btn" type="button">Save</button>`);

  test("flags a button that gains a border only on hover", async ({ page }) => {
    const flag = await flagsState(
      page,
      "hover-shift",
      button(".btn { border: 0; } .btn:hover { border: 2px solid #0a6cff; }"),
      "btn",
    );
    // A button is `border-box` in Chromium's UA sheet, so its fixed 44px height
    // holds and the two 2px sides push its auto width out instead.
    const [width, height] = flag.measure.before;
    expect(flag.measure.after).toEqual([width + 4, height]);
  });

  test("leaves a button whose border is there, transparent, at rest alone", async ({ page }) => {
    await leavesState(
      page,
      "hover-shift",
      button(".btn { border: 2px solid transparent; } .btn:hover { border-color: #0a6cff; }"),
      "btn",
    );
  });
});

test.describe("focus-shift", () => {
  const button = (css: string) =>
    html(`${BUTTON} .btn { border: 0; } ${css}`, `<button class="btn" type="button">Save</button>`);

  test("flags a button that gains a border on keyboard focus", async ({ page }) => {
    const flag = await flagsState(
      page,
      "focus-shift",
      button(".btn:focus-visible { border: 2px solid #0a6cff; }"),
      "btn",
    );
    expect(flag.state).toBe("focus");
  });

  test("leaves a button wearing only the global ring alone", async ({ page }) => {
    await leavesState(page, "focus-shift", button(""), "btn");
  });
});

test.describe("focus-invisible", () => {
  const button = (css: string) =>
    html(`${BUTTON} .btn { border: 0; } ${css}`, `<button class="btn" type="button">Save</button>`);

  test("flags a button whose focus-visible removes the ring and adds nothing", async ({ page }) => {
    await flagsState(
      page,
      "focus-invisible",
      button(".btn:focus-visible { outline: none; }"),
      "btn",
    );
  });

  test("leaves a button wearing the global ring alone", async ({ page }) => {
    await leavesState(page, "focus-invisible", button(""), "btn");
  });
});

test.describe("focus-ring-differs", () => {
  const button = (css: string) =>
    html(`${BUTTON} .btn { border: 0; } ${css}`, `<button class="btn" type="button">Save</button>`);

  test("flags a 2px ring where the global ring is 3px", async ({ page }) => {
    const flag = await flagsState(
      page,
      "focus-ring-differs",
      button(".btn:focus-visible { outline: 2px solid #0a6cff; outline-offset: 2px; }"),
      "btn",
    );
    expect(flag.measure.outline).toMatchObject({ width: 2, offset: 2 });
  });

  test("leaves the global 3px ring at a 2px offset alone", async ({ page }) => {
    await leavesState(page, "focus-ring-differs", button(""), "btn");
  });
});

test.describe("fill-corners", () => {
  const card = (clip: string) =>
    html(
      `.card { width: 300px; border: 1px solid #d0d5dd; border-radius: 20px; background: #fff; ${clip} }
       .list { margin: 0; padding: 0; list-style: none; }
       .row { display: block; padding: 12px 16px; }
       .row:hover { background: #eef2ff; }`,
      `<div class="card"><ul class="list">
         <li><a class="row" href="#">First trip</a></li>
         <li><a class="row" href="#">Second trip</a></li>
       </ul></div>`,
    );

  test("flags a square hover fill in a rounded card's corner that does not clip", async ({
    page,
  }) => {
    const flag = await flagsState(page, "fill-corners", card(""), "row");
    // Flush with the card's inner edge, under a 20px corner less its 1px border.
    expect(flag.measure).toMatchObject({ corner: "tl", gap: 0, expected: 19, actual: 0 });
    expect(flag.measure.containerClips).toBe(false);
  });

  test("leaves the same fill alone when the card clips it to its corner", async ({ page }) => {
    await leavesState(page, "fill-corners", card("overflow: hidden;"), "row");
  });
});

test.describe("fill-tight", () => {
  const chip = (padding: number) =>
    html(
      `.chip { display: inline-block; padding: ${padding}px; border-radius: 6px; }
       .chip:hover { background: #eef2ff; }`,
      `<p class="meta"><a class="chip" href="#">Edit</a></p>`,
    );

  test("flags a hover fill hugging its text with 2px of padding", async ({ page }) => {
    const flag = await flagsState(page, "fill-tight", chip(2), "chip");
    expect(flag.measure.left).toBeCloseTo(2, 0);
    expect(flag.measure.right).toBeCloseTo(2, 0);
  });

  test("leaves a hover fill with 8px of padding alone", async ({ page }) => {
    await leavesState(page, "fill-tight", chip(8), "chip");
  });
});
