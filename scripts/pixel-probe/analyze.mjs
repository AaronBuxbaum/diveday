/**
 * **The pixel probe's judgement: pure functions over collected geometry.**
 *
 * `collect.mjs` walks a rendered page and hands back boxes; this module turns
 * those boxes into *candidates* — never verdicts. A flag here says "these
 * numbers look like a defect of this class"; a person (or an auditor agent)
 * decides, with the crop in front of them, whether it is one. That split is
 * the whole design: a probe that keeps flagging correct code gets ignored, so
 * every check below is written to leave the common correct shapes alone, and
 * `analyze.test.mjs` holds as many "leaves alone" cases as flagging ones.
 *
 * Nothing here touches a browser, a file or a clock, which is what lets the
 * tests drive it with synthetic geometry. The numbers it enforces come from
 * `src/app/globals.css` (the 3px focus ring at a 2px offset; the 12/12/20
 * radius ladder) and `docs/design/forms-and-controls.md` (44px targets, one
 * control height per row); `docs/design/pixel-craft.md` is the rubric that
 * names each class, its tolerance and its severity.
 */

/** The global focus ring (globals.css): a 3px outline at a 2px offset. */
export const GLOBAL_RING = { width: 3, offset: 2 };
/**
 * Its inset twin, `focus-ring-inset` (globals.css): the same 3px drawn wholly
 * inside the box, for a row flush in a clipping container. One ring in two
 * placements, so neither is "drawn two ways".
 */
export const GLOBAL_RING_INSET = { width: 3, offset: -3 };
/** How far that ring reaches outside the box it surrounds. */
export const DEFAULT_RING_REACH = GLOBAL_RING.width + GLOBAL_RING.offset;
/** docs/design/principles.md §2: touch targets ≥ 44 px. */
export const MIN_TARGET = 44;
/** A painted box this close to a rounded ancestor's corner should nest inside it. */
export const CORNER_NEAR = 8;

/**
 * Every check the probe runs: its number in the brief, the rubric class it
 * measures (docs/design/pixel-craft.md), and its default severity.
 */
export const CHECKS = {
  "focus-ring-clipped": { n: 1, cls: 9, severity: "S2", title: "Focus ring clipped" },
  "focus-invisible": { n: 11, cls: 7, severity: "S2", title: "Focus changes nothing visible" },
  "focus-ring-differs": {
    n: 11,
    cls: 12,
    severity: "S2",
    title: "Focus ring is not the global ring",
  },
  "nested-corners": { n: 2, cls: 6, severity: "S2", title: "Corners do not nest" },
  "off-centre": { n: 3, cls: 1, severity: "S2", title: "Content off centre" },
  "three-part-row": {
    n: 4,
    cls: 1,
    severity: "S2",
    title: "Middle of a three-part row off centre",
  },
  "mismatched-controls": { n: 5, cls: 12, severity: "S2", title: "Controls in one row differ" },
  "text-beside-control": {
    n: 6,
    cls: 1,
    severity: "S2",
    title: "Text misaligned beside a control",
  },
  "ragged-edges": { n: 7, cls: 3, severity: "S2", title: "Left edges almost aligned" },
  "ragged-column": { n: 7, cls: 3, severity: "S2", title: "Repeated child wanders across rows" },
  "uneven-gaps": { n: 8, cls: 4, severity: "S2", title: "Uneven gaps between like siblings" },
  "phantom-gap": { n: 8, cls: 4, severity: "S2", title: "Empty child doubles a gap" },
  "page-overflow": { n: 9, cls: 9, severity: "S1", title: "Page overflows sideways" },
  "text-spill": { n: 9, cls: 9, severity: "S2", title: "Text spills out of its box" },
  "hard-clip": { n: 9, cls: 9, severity: "S1", title: "Text hard-clipped" },
  truncated: { n: 9, cls: 8, severity: "S3", title: "Text truncated" },
  "small-target": { n: 10, cls: 7, severity: "S2", title: "Target under 44px" },
  "hover-shift": { n: 11, cls: 7, severity: "S2", title: "Layout shifts on hover" },
  "focus-shift": { n: 11, cls: 7, severity: "S2", title: "Layout shifts on focus" },
  "fill-corners": {
    n: 11,
    cls: 6,
    severity: "S2",
    title: "Hover fill ignores its container's corner",
  },
  "fill-tight": { n: 11, cls: 5, severity: "S2", title: "Content within 4px of its hover fill" },
  "census-near-miss": { n: 12, cls: 12, severity: "S2", title: "One component, two sizes" },
};

/** The cheap checks the width sweep runs at 360/640/768/1024. */
export const SWEEP_CHECKS = new Set([
  "page-overflow",
  "text-spill",
  "hard-clip",
  "off-centre",
  "mismatched-controls",
  "text-beside-control",
  "three-part-row",
]);

// ---------------------------------------------------------------------------
// Signatures.

/**
 * Utilities that place a component rather than draw it: margins, widths, flex
 * and grid item behaviour, order, stacking and inset offsets. One component
 * dropped into two layouts should read as one signature, so these go.
 */
const PLACEMENT = [
  /^-?m[trblxyse]?-/,
  /^(w|min-w|max-w)-/,
  /^(flex-(1|auto|initial|none)|grow|grow-\d+|shrink|shrink-\d+|basis-)/,
  /^(self|justify-self|place-self)-/,
  /^-?order-/,
  /^(col|row)-(span|start|end)-/,
  /^-?z-/,
  /^-?(inset|inset-x|inset-y|top|right|bottom|left|start|end)-/,
];

/** The utility a class names once its variant prefixes (`sm:`, `hover:`) are gone. */
function baseUtility(token) {
  let depth = 0;
  let cut = 0;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === "[") depth += 1;
    else if (char === "]") depth -= 1;
    else if (char === ":" && depth === 0) cut = index + 1;
  }
  return token.slice(cut).replace(/^!/, "");
}

export function isPlacementClass(token) {
  const base = baseUtility(token);
  return PLACEMENT.some((pattern) => pattern.test(base));
}

/** Colour and tone utilities — what the census's *family* ignores. */
const COLOUR_PREFIX =
  /^(bg|text|border|ring|outline|fill|stroke|decoration|accent|caret|divide|from|via|to|placeholder|shadow)-(.+)$/;
/** What follows a colour prefix when the utility is *not* a colour. */
const NOT_A_COLOUR =
  /^(\d.*|px|0|auto|none|solid|dashed|dotted|double|hidden|clip|ellipsis|wrap|nowrap|balance|pretty|inset|left|right|center|justify|start|end|top|bottom|cover|contain|fixed|local|scroll|repeat.*|no-repeat|origin|xs|sm|md|base|lg|xl|\d?xl|bed|inner|offset.*|(x|y|t|r|b|l|s|e)(-.*)?|\[\d.*)$/;

function isColourClass(token) {
  const match = baseUtility(token).match(COLOUR_PREFIX);
  return Boolean(match) && !NOT_A_COLOUR.test(match[2]);
}

export function kindOf(el) {
  let kind = el.tag;
  if (el.type) kind += `[${el.type}]`;
  if (el.role) kind += `[role=${el.role}]`;
  return kind;
}

/**
 * A component's identity across call sites: its kind plus its sorted classes,
 * minus the ones that only place it. An element with no classes gets a
 * fingerprint of its computed box instead, so two unstyled `<div>`s that draw
 * the same box still match.
 */
export function signatureOf(el) {
  const classes = String(el.cls || "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !isPlacementClass(token));
  if (classes.length > 0) return `${kindOf(el)}.${[...new Set(classes)].sort().join(" ")}`;
  const fingerprint = [
    el.disp,
    `p${(el.pad || []).join(",")}`,
    `b${(el.bw || []).join(",")}`,
    `r${(el.rad || []).join(",")}`,
    `f${el.fs}/${el.fwt}`,
    el.bg ? "bg" : "",
  ].join(";");
  return `${kindOf(el)}{${fingerprint}}`;
}

/** The census family: the signature with colour and tone stripped. */
export function familyOf(el) {
  const classes = String(el.cls || "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !isPlacementClass(token) && !isColourClass(token));
  if (classes.length === 0) return signatureOf(el);
  return `${kindOf(el)}.${[...new Set(classes)].sort().join(" ")}`;
}

/** FNV-1a — a short stable id for a signature, for file names. */
export function shortHash(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Geometry helpers.

const left = (b) => b.x;
const right = (b) => b.x + b.w;
const top = (b) => b.y;
const bottom = (b) => b.y + b.h;
const round1 = (value) => Math.round(value * 10) / 10;

function rectOf(el) {
  return [el.x, el.y, el.w, el.h];
}

function union(rects) {
  let x1 = Number.POSITIVE_INFINITY;
  let y1 = Number.POSITIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.NEGATIVE_INFINITY;
  for (const [x, y, w, h] of rects) {
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x + w);
    y2 = Math.max(y2, y + h);
  }
  if (!Number.isFinite(x1)) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Inside the border: where overflow clips and where a fill's corner nests. */
function paddingBox(el) {
  const [bt, br, bb, bl] = el.bwl || el.bw || [0, 0, 0, 0];
  return { x: el.x + bl, y: el.y + bt, w: el.w - bl - br, h: el.h - bt - bb };
}

function contentBox(el) {
  const pb = paddingBox(el);
  const [pt, pr, pbm, pl] = el.pad || [0, 0, 0, 0];
  return { x: pb.x + pl, y: pb.y + pt, w: pb.w - pl - pr, h: pb.h - pt - pbm };
}

function overlapY(a, b) {
  return Math.min(bottom(a), bottom(b)) - Math.max(top(a), top(b));
}

function overlapX(a, b) {
  return Math.min(right(a), right(b)) - Math.max(left(a), left(b));
}

/**
 * The index a check reads: parents, children, and the cached facts every
 * check would otherwise recompute.
 */
export function buildIndex(snapshot) {
  const els = snapshot.elements || [];
  const kids = els.map(() => []);
  for (const el of els) if (el.p >= 0 && kids[el.p]) kids[el.p].push(el.i);
  const sig = new Map();
  const sigOf = (el) => {
    if (!sig.has(el.i)) sig.set(el.i, signatureOf(el));
    return sig.get(el.i);
  };
  return { snapshot, els, kids, sigOf };
}

export function isVisible(el) {
  return !el.srOnly && el.vis !== "hidden" && el.op > 0.01 && el.w > 1 && el.h > 1;
}

export function isInFlow(el) {
  return el.pos !== "absolute" && el.pos !== "fixed";
}

export function isPainted(el) {
  return Boolean(el.bg || (el.bw || []).some((width) => width > 0) || el.shadow);
}

/** The background an element is seen against: its nearest painted ancestor's, else the page's. */
function backdropOf(ix, el) {
  let cursor = ix.els[el.p];
  while (cursor) {
    if (cursor.bg && cursor.op > 0.01) return cursor.bgc;
    cursor = ix.els[cursor.p];
  }
  return ix.snapshot.pageBg || "";
}

/**
 * Which of a box's edges a person can actually see, per axis: a fill that
 * differs from what is behind it or a shadow shows all four; otherwise only
 * a pair of borders shows an axis. A `bg-background` band on the background,
 * or a `border-t` rule, has no visible box to be centred in.
 */
export function visibleEdges(ix, el) {
  const fill = el.bg && el.op > 0.01 && el.bgc !== backdropOf(ix, el);
  if (fill || el.shadow) return { x: true, y: true };
  const [bt, br, bb, bl] = el.bw || [0, 0, 0, 0];
  return { x: br > 0 && bl > 0, y: bt > 0 && bb > 0 };
}

function maxRadius(el) {
  return Math.max(...(el.rad || [0]));
}

/** Visible, in-flow children — the boxes that make up an element's content. */
function flowKids(ix, el, { keepTiny = false } = {}) {
  return ix.kids[el.i]
    .map((i) => ix.els[i])
    .filter((kid) => isInFlow(kid) && !kid.srOnly && (keepTiny || isVisible(kid)));
}

/** Where an element's content actually is: its text and in-flow child boxes. */
export function contentBounds(ix, el) {
  const rects = [...(el.text || [])];
  for (const kid of flowKids(ix, el)) rects.push(rectOf(kid));
  return union(rects);
}

/** The nearest ancestor that paints, clips, or rounds — what a flag clusters under. */
function containerOf(ix, el) {
  let cursor = ix.els[el.p];
  while (cursor) {
    if (cursor.clips || isPainted(cursor) || maxRadius(cursor) > 0) return cursor;
    cursor = ix.els[cursor.p];
  }
  return null;
}

/** What a flag about this element carries: its signature and its container's. */
export function elementMeta(ix, el) {
  const container = containerOf(ix, el);
  return {
    i: el.i,
    sig: ix.sigOf(el),
    csig: container ? ix.sigOf(container) : "",
    cls: el.cls,
    label: el.label,
    container: container ? rectOf(container) : null,
  };
}

export function isControl(el) {
  if (!el.interactive || !isVisible(el)) return false;
  if (el.tag === "input") return !/^(checkbox|radio|range|color|file|hidden)$/.test(el.type);
  if (el.tag === "select" || el.tag === "textarea") return true;
  return isPainted(el) && el.h >= 20;
}

function firstTextLine(ix, el, depth = 0) {
  if (el.text && el.text.length > 0) return { line: el.text[0], asc: el.asc, owner: el };
  if (depth > 4) return null;
  for (const kid of flowKids(ix, el)) {
    const found = firstTextLine(ix, kid, depth + 1);
    if (found) return found;
  }
  return null;
}

function baselineOf(ix, el) {
  const found = firstTextLine(ix, el);
  if (!found?.asc) return null;
  return found.line[1] + found.asc[0];
}

function textLineCount(ix, el, depth = 0) {
  let count = (el.text || []).length;
  if (depth > 4) return count;
  for (const kid of flowKids(ix, el)) count = Math.max(count, textLineCount(ix, kid, depth + 1));
  return count;
}

/**
 * How far below a stacked sibling the two edge walks read. One number for
 * both, so any word the content walk reads inside a painted box, the box walk
 * reaches that box too: the staff chrome's monogram tile sits six levels under
 * the header, and a box walk that stopped at four read the "BM" inside it
 * (23.8px) as the header's edge instead of the tile's own 16.
 */
const EDGE_DEPTH = 6;

/**
 * Where the eye puts an element's left edge: where its first word or icon
 * starts. A painted box with nothing inside it is its own edge. Two stacked
 * siblings "line up" when their content does — an active nav item's pill can
 * bleed past the column so long as its label does not.
 *
 * The answer depends on the depth it was asked from (past `EDGE_DEPTH` a box
 * is its own x), so the cache is keyed by both: keyed by element alone, an
 * outer stack that first reached `CompactDisclosureRow`'s `-mx-2` summary
 * seven levels down stored "the summary's x" (8px left of its caret), and the
 * row's own stack read that back as the row's edge.
 */
function visualLeft(ix, el, cache, depth = 0) {
  const key = `${el.i}:${depth}`;
  if (cache.has(key)) return cache.get(key);
  let value;
  if (el.replaced || depth > EDGE_DEPTH) value = el.x;
  else {
    const lefts = (el.text || []).map((line) => line[0]);
    for (const kid of flowKids(ix, el)) lefts.push(visualLeft(ix, kid, cache, depth + 1));
    value = lefts.length > 0 ? Math.min(...lefts) : el.x;
  }
  cache.set(key, value);
  return value;
}

/**
 * The leftmost painted box edge inside (or of) an element — a card, a chip,
 * a pill — that is not a full-width band, which has no edge to align.
 */
function boxLeft(ix, el, span, depth = 0) {
  if (isPainted(el) && el.w < span - 2) return el.x;
  if (depth > EDGE_DEPTH) return null;
  let best = null;
  for (const kid of flowKids(ix, el)) {
    const edge = boxLeft(ix, kid, span, depth + 1);
    if (edge !== null && (best === null || edge < best)) best = edge;
  }
  return best;
}

function makeFlag(ix, check, el, fields) {
  const container = el ? containerOf(ix, el) : null;
  return {
    check,
    severity: fields.severity || CHECKS[check].severity,
    el: el ? el.i : -1,
    sig: el ? ix.sigOf(el) : "",
    csig: container ? ix.sigOf(container) : "",
    cls: el ? el.cls : "",
    label: el ? el.label : "",
    rect: el ? rectOf(el) : fields.rect || null,
    msg: fields.msg,
    measure: fields.measure || {},
    guides: fields.guides || [],
  };
}

/** A guide: an outlined box drawn onto the crop, in document coordinates. */
function guide(box, color) {
  const b = Array.isArray(box) ? { x: box[0], y: box[1], w: box[2], h: box[3] } : box;
  return { box: [b.x, b.y, b.w, b.h], color };
}

// ---------------------------------------------------------------------------
// 1. Focus ring clipped.

/**
 * The corner test for a rounded clip: is the ring's outermost point at this
 * corner farther from the clip's arc centre than the arc itself?
 */
function cornerClipped(ringBox, ringRadius, clip, clipRadius, corner) {
  if (clipRadius <= 0.5) return false;
  const sx = corner === "tl" || corner === "bl" ? 1 : -1;
  const sy = corner === "tl" || corner === "tr" ? 1 : -1;
  const clipX = sx > 0 ? clip.x : clip.x + clip.w;
  const clipY = sy > 0 ? clip.y : clip.y + clip.h;
  const cx = clipX + sx * clipRadius;
  const cy = clipY + sy * clipRadius;
  const ringX = sx > 0 ? ringBox.x : ringBox.x + ringBox.w;
  const ringY = sy > 0 ? ringBox.y : ringBox.y + ringBox.h;
  // Only a ring whose corner sits inside the clip's corner square can meet the arc.
  if (sx * (ringX - cx) >= 0 || sy * (ringY - cy) >= 0) return false;
  const r = Math.max(0, ringRadius);
  const px = ringX + sx * r * (1 - Math.SQRT1_2);
  const py = ringY + sy * r * (1 - Math.SQRT1_2);
  return Math.hypot(px - cx, py - cy) > clipRadius + 0.75;
}

const CORNERS = ["tl", "tr", "br", "bl"];

/**
 * Every clipping ancestor that cuts into an element's focus ring, per axis and
 * per corner. `reach` is how far the ring sits outside the box — the global
 * ring's 5px unless a measured focus state says otherwise.
 */
export function ringClips(ix, el, reach) {
  const hits = [];
  if (reach <= 0) return hits;
  const ring = { x: el.x - reach, y: el.y - reach, w: el.w + 2 * reach, h: el.h + 2 * reach };
  let clipper = ix.els[el.cp];
  while (clipper) {
    const clip = paddingBox(clipper);
    // Scrolled or pushed out of its clipper entirely: the box is hidden, not
    // its ring, and that is a different finding.
    const outside =
      (clipper.clipsX && (right(el) < clip.x + 1 || left(el) > right(clip) - 1)) ||
      (clipper.clipsY && (bottom(el) < clip.y + 1 || top(el) > bottom(clip) - 1));
    // A box already running past its clipper by more than a ring's width is
    // scroll content (a chip row) or a clipped box — not a ring problem.
    const spills =
      (clipper.clipsX && (left(el) < clip.x - 2 || right(el) > right(clip) + 2)) ||
      (clipper.clipsY && (top(el) < clip.y - 2 || bottom(el) > bottom(clip) + 2));
    if (!outside && !spills) {
      const sides = {};
      if (clipper.clipsX) {
        if (ring.x < clip.x - 0.5) sides.left = round1(clip.x - ring.x);
        if (right(ring) > right(clip) + 0.5) sides.right = round1(right(ring) - right(clip));
      }
      if (clipper.clipsY) {
        if (ring.y < clip.y - 0.5) sides.top = round1(clip.y - ring.y);
        if (bottom(ring) > bottom(clip) + 0.5) sides.bottom = round1(bottom(ring) - bottom(clip));
      }
      const corners = [];
      if (Object.keys(sides).length === 0 && clipper.clipsX && clipper.clipsY) {
        CORNERS.forEach((corner, k) => {
          const inset = Math.max(
            (clipper.bwl || clipper.bw)[k === 0 || k === 1 ? 0 : 2],
            (clipper.bwl || clipper.bw)[k === 0 || k === 3 ? 3 : 1],
          );
          const clipRadius = Math.max(0, clipper.rad[k] - inset);
          if (cornerClipped(ring, el.rad[k] + reach, clip, clipRadius, corner))
            corners.push(corner);
        });
      }
      if (Object.keys(sides).length > 0 || corners.length > 0) {
        hits.push({ by: clipper.i, sides, corners, clip });
      }
    }
    clipper = ix.els[clipper.cp];
  }
  // The viewport clips sideways too (`body { overflow-x: clip }`).
  const docWidth = ix.snapshot.doc?.width;
  if (docWidth && left(el) >= -2 && right(el) <= docWidth + 2) {
    const sides = {};
    if (ring.x < -0.5) sides.left = round1(-ring.x);
    if (right(ring) > docWidth + 0.5) sides.right = round1(right(ring) - docWidth);
    if (Object.keys(sides).length > 0) {
      hits.push({ by: -1, sides, corners: [], clip: { x: 0, y: 0, w: docWidth, h: 0 } });
    }
  }
  return hits;
}

/**
 * Whether a keyboard can put focus here — what forcing `:focus-visible` on it
 * stands in for. `tabindex="-1"` takes a box out of the tab order: the command
 * palette's options wear it because focus stays in the combobox and the arrows
 * move `aria-activedescendant`, so a ring forced onto one is a state no
 * keyboard reaches (82 dismissed `focus-ring-clipped` flags). A box that is a
 * `-1` in one capture and a tab stop in another (a roving tab stop) is judged
 * where it is the stop. It stays a pointer target either way.
 */
export function takesFocus(el) {
  return Boolean(el.focusable) && !(el.ti < 0);
}

function isFocusCandidate(el) {
  return takesFocus(el) && isVisible(el) && !el.srOnly && el.disabled !== true;
}

/** Focusable elements whose ring *would* be clipped at the global ring's reach. */
export function ringCandidates(snapshot) {
  const ix = buildIndex(snapshot);
  return ix.els
    .filter(isFocusCandidate)
    .filter((el) => ringClips(ix, el, DEFAULT_RING_REACH).length > 0)
    .map((el) => el.i);
}

function checkFocusRingClipped(ix, rings) {
  const flags = [];
  for (const el of ix.els) {
    if (!isFocusCandidate(el)) continue;
    const measured = rings?.get(el.i);
    const reach = measured === undefined ? DEFAULT_RING_REACH : measured;
    if (reach <= 0) continue;
    const hits = ringClips(ix, el, reach);
    if (hits.length === 0) continue;
    const first = hits[0];
    const by = first.by >= 0 ? ix.els[first.by] : null;
    const where = [
      ...Object.entries(first.sides).map(([side, px]) => `${side} ${px}px`),
      ...first.corners.map((corner) => `${corner} corner`),
    ].join(", ");
    const worstCut = Math.max(0, ...Object.values(first.sides));
    flags.push(
      makeFlag(ix, "focus-ring-clipped", el, {
        // A ring shaved by a pixel or two at the screen's own edge is polish;
        // one cut by a card, or cut away, is visibly off.
        severity: !by && worstCut <= 2 ? "S3" : "S2",
        msg: `focus ring (${reach}px reach${measured === undefined ? ", assumed" : ""}) cut by ${
          by ? `<${by.tag}> ${ix.sigOf(by).slice(0, 60)}` : "the viewport edge"
        } at ${where}`,
        measure: {
          reach,
          measured: measured !== undefined,
          by: by ? ix.sigOf(by) : "viewport",
          sides: first.sides,
          corners: first.corners,
          clippers: hits.length,
        },
        guides: [
          guide(el, "magenta"),
          guide(
            { x: el.x - reach, y: el.y - reach, w: el.w + 2 * reach, h: el.h + 2 * reach },
            "green",
          ),
          ...(by ? [guide(first.clip, "orange")] : []),
        ],
      }),
    );
    // The clipper's own signature is the cluster key's container half, so one
    // `overflow-hidden` card reads as one line whatever sits in it.
    if (by) flags[flags.length - 1].csig = ix.sigOf(by);
  }
  return flags;
}

// ---------------------------------------------------------------------------
// 2. Nested corners.

function paintsCorner(el, k) {
  if ((el.bg && el.op > 0.01) || el.shadow) return true;
  const [bt, br, bb, bl] = el.bw || [0, 0, 0, 0];
  const vertical = k === 0 || k === 1 ? bt : bb;
  const horizontal = k === 0 || k === 3 ? bl : br;
  return vertical > 0 && horizontal > 0;
}

function nestedCornerMiss(el, outer, outerClips) {
  let worst = null;
  const borders = outer.bwl || outer.bw || [0, 0, 0, 0];
  CORNERS.forEach((corner, k) => {
    const outerRadius = outer.rad[k];
    if (outerRadius <= 0.5) return;
    const dx = corner === "tl" || corner === "bl" ? el.x - outer.x : right(outer) - right(el);
    const dy = corner === "tl" || corner === "tr" ? el.y - outer.y : bottom(outer) - bottom(el);
    if (dx < -0.5 || dy < -0.5) return;
    if (dx > CORNER_NEAR || dy > CORNER_NEAR) return;
    const gap = (dx + dy) / 2;
    // A box paints a corner with a fill, a shadow, or both borders that meet
    // there; a lone `border-t` rule has no bottom corners to nest.
    if (!paintsCorner(el, k)) return;
    // Flush against the padding box of a clipping, rounded ancestor: the clip
    // rounds the corner to the border's inner curve, which nests by
    // construction. Measured from inside the border — a 1px-bordered card's
    // flush child sits 1px from the outer edge and 0px from the clip.
    const border = Math.max(
      borders[k === 0 || k === 1 ? 0 : 2],
      borders[k === 0 || k === 3 ? 3 : 1],
    );
    if (outerClips && gap - border < 0.75) return;
    const expected = Math.max(0, outerRadius - gap);
    const actual = el.rad[k];
    const miss = Math.abs(actual - expected);
    if (miss > 2 && (!worst || miss > worst.miss)) {
      worst = { corner, expected: round1(expected), actual, gap: round1(gap), outerRadius, miss };
    }
  });
  return worst;
}

function checkNestedCorners(ix) {
  const flags = [];
  for (const el of ix.els) {
    if (!isVisible(el) || !isPainted(el)) continue;
    let outer = ix.els[el.p];
    let outerClips = false;
    while (outer) {
      if (outer.clips) outerClips = true;
      if ((isPainted(outer) || outer.clips) && maxRadius(outer) > 0.5) break;
      outer = ix.els[outer.p];
    }
    if (!outer) continue;
    // A box that paints exactly what its parent already paints is not seen.
    const seen =
      (el.bw || []).some((width) => width > 0) || el.shadow || el.bgc !== outer.bgc || !outer.bg;
    if (!seen) continue;
    const miss = nestedCornerMiss(el, outer, outerClips || outer.clips);
    if (!miss) continue;
    flags.push(
      makeFlag(ix, "nested-corners", el, {
        severity: miss.miss >= 4 ? "S2" : "S3",
        msg: `${miss.corner} radius ${miss.actual}px, ${miss.gap}px inside a ${miss.outerRadius}px corner — nests at ≈${miss.expected}px`,
        measure: miss,
        guides: [guide(el, "magenta"), guide(outer, "orange")],
      }),
    );
  }
  return flags;
}

// ---------------------------------------------------------------------------
// 3. Off-centre content.

/** Which axes this element's own styles ask to centre its content on. */
export function centringAxes(el) {
  const axes = { x: false, y: false };
  const flex = /flex/.test(el.disp);
  const grid = /grid/.test(el.disp);
  if (flex) {
    const row = !/column/.test(el.fd);
    const main = el.jc === "center";
    const cross = el.ai === "center";
    if (row) {
      axes.x = main;
      axes.y = cross;
    } else {
      axes.x = cross;
      axes.y = main;
    }
  } else if (grid) {
    axes.x = el.ji === "center" || el.jc === "center";
    axes.y = el.ai === "center" || el.ac === "center";
  } else {
    if (el.ta === "center" && (el.text || []).length > 0) axes.x = true;
    if (el.tag === "button") {
      axes.x = el.ta === "center";
      axes.y = true;
    }
  }
  return axes;
}

function checkOffCentre(ix) {
  const flags = [];
  for (const el of ix.els) {
    if (!isVisible(el) || el.pseudo) continue;
    const axes = centringAxes(el);
    if (!axes.x && !axes.y) continue;
    const kids = flowKids(ix, el);
    if (kids.length === 0 && (el.text || []).length === 0) continue;
    // A child that is itself stretched to fill the box leaves nothing to centre.
    const content = contentBounds(ix, el);
    if (!content) continue;
    // Judged against the edges a person can see on that axis; an axis with
    // no visible edges only against the element's own content box, where
    // anything but a pseudo-element or an empty child is centred by layout.
    const edges = visibleEdges(ix, el);
    const inner = contentBox(el);
    const pad = paddingBox(el);
    const box = {
      x: edges.x ? pad.x : inner.x,
      w: edges.x ? pad.w : inner.w,
      y: edges.y ? pad.y : inner.y,
      h: edges.y ? pad.h : inner.h,
    };
    const found = {};
    // Text that wraps to several start-aligned lines fills its flex item and
    // hugs the start edge by `text-align`, not by a centring mistake.
    const wrapsStart =
      ((el.text || []).length > 1 && el.ta !== "center") ||
      kids.some((kid) => (kid.text || []).length > 1 && kid.ta !== "center");
    if (axes.x && !wrapsStart && content.w <= inner.w + 0.5 && el.ta !== "left") {
      const offset = (content.x - box.x - (right(box) - right(content))) / 2;
      if (Math.abs(offset) > 1) found.x = round1(offset);
    }
    if (axes.y && content.h <= inner.h + 0.5) {
      const offset = (content.y - box.y - (bottom(box) - bottom(content))) / 2;
      if (Math.abs(offset) > 1) found.y = round1(offset);
    }
    if (found.x === undefined && found.y === undefined) continue;
    const worst = Math.max(Math.abs(found.x || 0), Math.abs(found.y || 0));
    const asymmetricPadding = el.pad[1] !== el.pad[3] || el.pad[0] !== el.pad[2];
    flags.push(
      makeFlag(ix, "off-centre", el, {
        severity: worst >= 2 ? "S2" : "S3",
        msg: `content ${[
          found.x !== undefined ? `${found.x > 0 ? "right" : "left"} ${Math.abs(found.x)}px` : "",
          found.y !== undefined ? `${found.y > 0 ? "low" : "high"} ${Math.abs(found.y)}px` : "",
        ]
          .filter(Boolean)
          .join(", ")} of centre${asymmetricPadding ? ` (padding ${el.pad.join("/")})` : ""}`,
        measure: { ...found, padding: el.pad, box: [box.x, box.y, box.w, box.h] },
        guides: [guide(box, "magenta"), guide(content, "cyan")],
      }),
    );
  }
  return flags;
}

// ---------------------------------------------------------------------------
// 4. Three-part rows.

function checkThreePartRows(ix) {
  const flags = [];
  for (const el of ix.els) {
    if (!isVisible(el) || !/flex/.test(el.disp) || /column/.test(el.fd)) continue;
    if (el.jc !== "space-between") continue;
    const kids = flowKids(ix, el, { keepTiny: true });
    if (kids.length !== 3) continue;
    const [first, middle, last] = kids;
    if (!isVisible(middle)) continue;
    // One line: all three share it.
    if (overlapY(first, middle) < -0.5 && first.h > 1) continue;
    if (overlapY(last, middle) < -0.5 && last.h > 1) continue;
    const box = contentBox(el);
    const midContent = contentBounds(ix, middle) || middle;
    const offset = (midContent.x + midContent.w / 2 - (box.x + box.w / 2)) / 1;
    if (Math.abs(offset) <= 2) continue;
    const hollow = [first, last].filter((kid) => kid.w <= 1 || !isVisible(kid)).length;
    flags.push(
      makeFlag(ix, "three-part-row", middle, {
        msg: `middle of a spread row sits ${round1(Math.abs(offset))}px ${
          offset > 0 ? "right" : "left"
        } of centre${hollow ? " — one side is an empty placeholder" : ""}`,
        measure: {
          offset: round1(offset),
          sides: [round1(first.w), round1(last.w)],
          placeholder: hollow > 0,
        },
        guides: [guide(box, "orange"), guide(midContent, "magenta")],
      }),
    );
    flags[flags.length - 1].csig = ix.sigOf(el);
  }
  return flags;
}

// ---------------------------------------------------------------------------
// 5 & 6. Rows: controls that differ, and text beside a taller control.

/**
 * The element a box sits in a *row* of: its parent, unless that parent wraps it
 * tightly (a `<form>` around a button, a `<div>` around an input), in which
 * case the wrapper is what sits in the row.
 */
function rowUnit(ix, el) {
  let unit = el;
  let parent = ix.els[unit.p];
  while (
    parent &&
    !isPainted(parent) &&
    Math.abs(parent.w - unit.w) <= 2 &&
    Math.abs(parent.h - unit.h) <= 2
  ) {
    unit = parent;
    parent = ix.els[unit.p];
  }
  return { unit, owner: parent };
}

/** A painted track whose visible children are all controls: a segmented control, a pager. */
function isComposite(ix, el) {
  if (!isPainted(el) || el.interactive) return false;
  const kids = flowKids(ix, el);
  return kids.length >= 2 && kids.every((kid) => isControl(kid) || !isVisible(kid));
}

function rowGroups(ix) {
  const groups = new Map();
  const add = (owner, member) => {
    if (!owner) return;
    if (!groups.has(owner.i)) groups.set(owner.i, []);
    groups.get(owner.i).push(member);
  };
  for (const el of ix.els) {
    if (!isVisible(el)) continue;
    if (isControl(el) || isComposite(ix, el)) {
      const parent = ix.els[el.p];
      if (parent && isComposite(ix, parent)) continue;
      const { unit, owner } = rowUnit(ix, el);
      add(owner, { kind: "control", el, unit });
    } else if (
      (el.text || []).length > 0 &&
      !el.interactive &&
      !isPainted(el) &&
      isInFlow(el) &&
      el.disp !== "inline"
    ) {
      const { unit, owner } = rowUnit(ix, el);
      add(owner, { kind: "text", el, unit });
    }
  }
  return groups;
}

function sameLine(a, b) {
  const overlap = overlapY(a, b);
  return overlap > Math.min(a.h, b.h) * 0.5 && overlapX(a, b) <= 0.5;
}

function checkRows(ix, enabled) {
  const flags = [];
  for (const [ownerIndex, members] of rowGroups(ix)) {
    const owner = ix.els[ownerIndex];
    if (/column/.test(owner.fd) && /flex/.test(owner.disp)) {
      // A column stacks its children; nothing in it shares a line.
      continue;
    }
    const controls = members.filter((member) => member.kind === "control");
    if (enabled.has("mismatched-controls") && controls.length >= 2) {
      const lines = [];
      for (const member of controls) {
        const line = lines.find((known) => known.some((other) => sameLine(other.el, member.el)));
        if (line) line.push(member);
        else lines.push([member]);
      }
      for (const line of lines) {
        if (line.length < 2) continue;
        const single = line.filter((member) => textLineCount(ix, member.el) <= 1);
        if (single.length < 2) continue;
        const heights = single.map((member) => member.el.h);
        const fonts = single
          .map((member) => firstTextLine(ix, member.el)?.owner.fs ?? member.el.fs)
          .filter((size) => size > 0);
        const heightSpread = Math.max(...heights) - Math.min(...heights);
        const fontSpread = fonts.length > 1 ? Math.max(...fonts) - Math.min(...fonts) : 0;
        if (heightSpread < 2 && fontSpread < 1) continue;
        const odd = single.reduce((a, b) => (a.el.h < b.el.h ? a : b));
        flags.push(
          makeFlag(ix, "mismatched-controls", odd.el, {
            msg: `controls in one row: heights ${heights.map(round1).join("/")}px${
              fontSpread >= 1 ? `, text ${fonts.join("/")}px` : ""
            }`,
            measure: {
              heights: heights.map(round1),
              fonts,
              members: single.map((member) => ix.sigOf(member.el)),
            },
            guides: single.map((member) => guide(member.el, "magenta")),
          }),
        );
        flags[flags.length - 1].csig = ix.sigOf(owner);
      }
    }
    if (enabled.has("text-beside-control")) {
      for (const textMember of members.filter((member) => member.kind === "text")) {
        const text = textMember.el;
        const firstLine = text.text[0];
        const lineH = firstLine[3];
        for (const controlMember of controls) {
          const control = controlMember.el;
          if (control.h < lineH + 6) continue;
          const tBox = textMember.unit;
          if (overlapX(tBox, controlMember.unit) > 0.5) continue;
          const gapX = Math.max(
            left(controlMember.unit) - right(tBox),
            left(tBox) - right(controlMember.unit),
          );
          // In a flex row they share a line however far `justify-between`
          // spreads them (the SectionCard header); elsewhere, only neighbours.
          const flexRow = /flex/.test(owner.disp) && !/column/.test(owner.fd);
          if (!flexRow && gapX > 48) continue;
          if (overlapY(tBox, controlMember.unit) <= 0) continue;
          // Side by side means the words themselves: the first line has to
          // share some height with the control and stay out of its column. A
          // `<label>` wrapping a caption and its field runs its *box* beside
          // the row's button while its words sit above both — every one of
          // the 20 flags the audit gave this check was that stacked caption.
          const line = { x: firstLine[0], y: firstLine[1], w: firstLine[2], h: lineH };
          if (overlapY(line, control) <= 0.5 || overlapX(line, control) > 0.5) continue;
          const controlCentre = control.y + control.h / 2;
          const lineCentre = firstLine[1] + firstLine[3] / 2;
          const blockCentre = text.y + text.h / 2;
          const textBaseline = text.asc ? firstLine[1] + text.asc[0] : null;
          const controlBaseline = baselineOf(ix, control);
          const deviations = [
            Math.abs(lineCentre - controlCentre),
            Math.abs(blockCentre - controlCentre),
          ];
          if (textBaseline !== null && controlBaseline !== null) {
            deviations.push(Math.abs(textBaseline - controlBaseline));
          }
          const best = Math.min(...deviations);
          if (best <= 1.5) continue;
          flags.push(
            makeFlag(ix, "text-beside-control", text, {
              severity: best >= 2 ? "S2" : "S3",
              msg: `text sits ${round1(lineCentre - controlCentre)}px ${
                lineCentre < controlCentre ? "above" : "below"
              } the centre of the ${round1(control.h)}px control beside it (no centre or baseline agrees)`,
              measure: {
                deviation: round1(best),
                lineCentre: round1(lineCentre - controlCentre),
                baseline:
                  textBaseline !== null && controlBaseline !== null
                    ? round1(textBaseline - controlBaseline)
                    : null,
                control: ix.sigOf(control),
                align: owner.ai,
              },
              guides: [
                guide(text, "magenta"),
                guide(control, "orange"),
                guide(
                  [text.x, controlCentre, Math.max(right(control), right(text)) - text.x, 0.01],
                  "green",
                ),
              ],
            }),
          );
          flags[flags.length - 1].csig = ix.sigOf(owner);
          break;
        }
      }
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// 7. Ragged left edges, and a child that wanders across repeated rows.

function isVerticalStack(kids) {
  for (let index = 1; index < kids.length; index += 1) {
    if (top(kids[index]) < bottom(kids[index - 1]) - 1) return false;
    if (overlapX(kids[index], kids[index - 1]) <= 0) return false;
  }
  return true;
}

function checkRaggedEdges(ix) {
  const flags = [];
  const cache = new Map();
  for (const el of ix.els) {
    if (!isVisible(el) || el.ta === "center") continue;
    if (/flex/.test(el.disp) && /column/.test(el.fd) && /center|end/.test(el.ai)) continue;
    if (/flex/.test(el.disp) && !/column/.test(el.fd)) continue;
    const kids = flowKids(ix, el).filter((kid) => kid.h > 1);
    if (kids.length < 3 || !isVerticalStack(kids)) continue;
    // Each sibling offers two edges a person might align it by: where its
    // content starts, and where its painted box starts (a card, a chip). It
    // lines up if either edge meets the stack's common edge.
    // Only a full-bleed band has no edge to align; a full-width card does.
    const span = ix.snapshot.doc?.width || Number.POSITIVE_INFINITY;
    // Centred text starts wherever centring put it, so it offers no content
    // edge (EntryShell's `text-center` footer at 36 against a column at 24);
    // a centred card still offers its painted box.
    const lefts = kids.map((kid) =>
      /center/.test(kid.ta) ? null : round1(visualLeft(ix, kid, cache)),
    );
    const boxes = kids.map((kid) => {
      const edge = boxLeft(ix, kid, span);
      return edge === null ? null : round1(edge);
    });
    const counts = new Map();
    kids.forEach((_, index) => {
      for (const value of new Set([lefts[index], boxes[index]].filter((v) => v !== null))) {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    });
    if (counts.size === 0) continue;
    const mode = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const near = (value) => value !== null && Math.abs(value - mode) < 0.75;
    const strays = kids
      .map((kid, index) => {
        const edge = lefts[index] ?? boxes[index];
        return { kid, left: edge, box: boxes[index], off: edge === null ? null : edge - mode };
      })
      .filter(({ left, box }) => left !== null && !near(left) && !near(box))
      .filter(({ off }) => Math.abs(off) >= 1 && Math.abs(off) <= 12);
    if (strays.length === 0) continue;
    // A stray that is the stack's majority is the stack's choice, not a stray.
    if (strays.length > kids.length / 2) continue;
    const worst = strays.reduce((a, b) => (Math.abs(a.off) > Math.abs(b.off) ? a : b));
    flags.push(
      makeFlag(ix, "ragged-edges", worst.kid, {
        msg: `left edge at ${worst.left}px where ${counts.get(mode)} siblings start at ${mode}px (${round1(worst.off)}px off)`,
        measure: {
          lefts,
          mode,
          strays: strays.map(({ kid, off }) => ({ sig: ix.sigOf(kid), off: round1(off) })),
        },
        guides: [
          ...strays.map(({ kid }) => guide(kid, "magenta")),
          guide([mode, el.y, 0.01, el.h], "green"),
        ],
      }),
    );
    flags[flags.length - 1].csig = ix.sigOf(el);
  }
  // Headings in one column that almost share an edge: the #624 shape, a group
  // title inside some cards and outside others.
  const headings = ix.els.filter((el) => el.heading && isVisible(el) && (el.text || []).length > 0);
  const byColumn = [];
  for (const heading of headings) {
    const start = heading.text[0][0];
    // Same kind only: a page's h1 and a card's h3 are different typographic
    // jobs; the #624 shape is one kind of title in and out of cards.
    const column = byColumn.find((group) =>
      group.some(
        (other) =>
          other.el.tag === heading.tag &&
          other.el.fs === heading.fs &&
          overlapX(other.el, heading) > 0,
      ),
    );
    const entry = { el: heading, start: round1(start) };
    if (column) column.push(entry);
    else byColumn.push([entry]);
  }
  for (const column of byColumn) {
    if (column.length < 3) continue;
    const starts = [...new Set(column.map((entry) => entry.start))].sort((a, b) => a - b);
    for (let index = 1; index < starts.length; index += 1) {
      const diff = starts[index] - starts[index - 1];
      if (diff < 1 || diff > 12) continue;
      const stray = column.filter((entry) => entry.start === starts[index]);
      const anchor = column.filter((entry) => entry.start === starts[index - 1]);
      const odd = stray.length <= anchor.length ? stray : anchor;
      flags.push(
        makeFlag(ix, "ragged-edges", odd[0].el, {
          msg: `headings in one column start at ${starts[index - 1]}px and ${starts[index]}px (${round1(diff)}px apart)`,
          measure: { starts, kind: "headings", count: column.length },
          guides: column.map((entry) => guide(entry.el, "magenta")),
        }),
      );
      flags[flags.length - 1].csig = "headings";
    }
  }
  return flags;
}

function row0Width(spots) {
  return spots[0].row.w;
}

function checkRaggedColumns(ix) {
  const flags = [];
  for (const el of ix.els) {
    if (!isVisible(el)) continue;
    const kids = flowKids(ix, el).filter((kid) => kid.h > 1);
    if (kids.length < 3 || !isVerticalStack(kids)) continue;
    const bySig = new Map();
    for (const kid of kids) {
      const sig = ix.sigOf(kid);
      if (!bySig.has(sig)) bySig.set(sig, []);
      bySig.get(sig).push(kid);
    }
    for (const rows of bySig.values()) {
      if (rows.length < 3) continue;
      const widths = rows.map((row) => row.w);
      if (Math.max(...widths) - Math.min(...widths) > 2) continue;
      const positions = new Map();
      for (const row of rows) {
        const seen = new Set();
        const walk = (node, depth) => {
          if (depth > 6) return;
          for (const kidIndex of ix.kids[node.i]) {
            const kid = ix.els[kidIndex];
            if (!isVisible(kid)) continue;
            const sig = ix.sigOf(kid);
            const columnish =
              kid.interactive ||
              kid.replaced ||
              (isPainted(kid) && kid.w < row.w * 0.3) ||
              (kid.label && kid.label.length <= 2 && kid.w < 32);
            if (columnish && kid.w < row.w * 0.5 && !seen.has(sig)) {
              seen.add(sig);
              if (!positions.has(sig)) positions.set(sig, []);
              positions.get(sig).push({ kid, row, l: kid.x - row.x, r: right(row) - right(kid) });
            }
            walk(kid, depth + 1);
          }
        };
        walk(row, 0);
      }
      for (const [sig, spots] of positions) {
        if (spots.length < 3) continue;
        const ls = spots.map((spot) => spot.l);
        const rs = spots.map((spot) => spot.r);
        const lSpread = Math.max(...ls) - Math.min(...ls);
        const rSpread = Math.max(...rs) - Math.min(...rs);
        if (lSpread <= 2 || rSpread <= 2) continue;
        const cs = spots.map((spot) => spot.kid.x + spot.kid.w / 2 - spot.row.x);
        // Centred in a fixed column (a day number under a weekday) is aligned.
        if (Math.max(...cs) - Math.min(...cs) <= 2) continue;
        // A zigzag layout alternates sides on purpose; a wandering caret moves
        // a fraction of the row.
        if (Math.min(lSpread, rSpread) > row0Width(spots) * 0.4) continue;
        const xs = spots.map((spot) => round1(spot.kid.x));
        flags.push(
          makeFlag(ix, "ragged-column", spots[0].kid, {
            msg: `the same ${spots[0].kid.tag} sits at x = ${xs.slice(0, 6).join("/")} across ${spots.length} repeated rows`,
            measure: { xs, leftSpread: round1(lSpread), rightSpread: round1(rSpread), child: sig },
            guides: spots.slice(0, 8).map((spot) => guide(spot.kid, "magenta")),
          }),
        );
        flags[flags.length - 1].csig = ix.sigOf(el);
      }
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// 8. Uneven gaps, and a zero-size child doubling one.

function checkGaps(ix, enabled) {
  const flags = [];
  for (const el of ix.els) {
    if (!isVisible(el)) continue;
    const all = flowKids(ix, el, { keepTiny: true });
    const kids = all.filter((kid) => isVisible(kid));
    if (kids.length === 0 || all.length < 2) continue;
    // One visible item has no stacking to read, so its container's own
    // direction says which way the gap runs.
    const vertical =
      kids.length < 2 ? !/flex/.test(el.disp) || /column/.test(el.fd) : isVerticalStack(kids);
    const horizontal =
      !vertical &&
      kids.every(
        (kid, index) =>
          index === 0 ||
          (left(kid) >= right(kids[index - 1]) - 0.5 && overlapY(kid, kids[index - 1]) > 0),
      );
    if (!vertical && !horizontal) continue;
    const gapOf = (a, b) => (vertical ? top(b) - bottom(a) : left(b) - right(a));
    if (enabled.has("uneven-gaps") && kids.length >= 3 && !/space-(around|evenly)/.test(el.jc)) {
      let run = [kids[0]];
      const runs = [];
      for (let index = 1; index < kids.length; index += 1) {
        if (ix.sigOf(kids[index]) === ix.sigOf(run[0])) run.push(kids[index]);
        else {
          runs.push(run);
          run = [kids[index]];
        }
      }
      runs.push(run);
      for (const same of runs) {
        if (same.length < 3) continue;
        const gaps = [];
        for (let index = 1; index < same.length; index += 1)
          gaps.push(gapOf(same[index - 1], same[index]));
        const spread = Math.max(...gaps) - Math.min(...gaps);
        if (spread <= 2) continue;
        const at = gaps.indexOf(Math.max(...gaps));
        flags.push(
          makeFlag(ix, "uneven-gaps", same[at + 1], {
            msg: `${same.length} like siblings with gaps ${gaps.map(round1).join("/")}px`,
            measure: { gaps: gaps.map(round1), axis: vertical ? "y" : "x" },
            guides: same.map((kid) => guide(kid, "magenta")),
          }),
        );
        flags[flags.length - 1].csig = ix.sigOf(el);
      }
    }
    if (enabled.has("phantom-gap")) {
      // A zero-size in-flow item at either end of a gapped flex or grid track
      // still takes its gap, pushing the real content off centre — the
      // settings rows whose label sat 2px high over an empty description.
      const gap = vertical ? el.gapR : el.gapC;
      const gapped = /flex|grid/.test(el.disp) && gap > 0 && kids.length >= 1;
      if (gapped) {
        for (const [position, hollow] of [
          ["first", all[0]],
          ["last", all.at(-1)],
        ]) {
          if (!hollow || isVisible(hollow) || hollow.vis === "hidden") continue;
          if (vertical ? hollow.h > 1 : hollow.w > 1) continue;
          if (all.length < 2) continue;
          flags.push(
            makeFlag(ix, "phantom-gap", hollow, {
              msg: `an empty ${hollow.tag} is the ${position} item of a ${round1(gap)}px-gap ${
                vertical ? "column" : "row"
              }, adding a gap nothing fills`,
              measure: { gap: round1(gap), position },
              guides: [
                guide(el, "orange"),
                ...kids.slice(0, 3).map((kid) => guide(kid, "magenta")),
              ],
              rect: rectOf(el),
            }),
          );
          flags[flags.length - 1].csig = ix.sigOf(el);
        }
      }
      for (let index = 1; index < all.length - 1; index += 1) {
        const hollow = all[index];
        if (isVisible(hollow) || hollow.vis === "hidden" || hollow.op <= 0.01) continue;
        if (vertical ? hollow.h > 1 : hollow.w > 1) continue;
        const before = all.slice(0, index).reverse().find(isVisible);
        const after = all.slice(index + 1).find(isVisible);
        if (!before || !after) continue;
        const spanned = gapOf(before, after);
        const others = [];
        for (let k = 1; k < kids.length; k += 1) {
          if (kids[k - 1] === before && kids[k] === after) continue;
          others.push(gapOf(kids[k - 1], kids[k]));
        }
        const usual =
          others.length > 0
            ? others.sort((a, b) => a - b)[Math.floor(others.length / 2)]
            : vertical
              ? el.gapR
              : el.gapC;
        if (!(usual > 0) || spanned < usual * 1.5 || spanned - usual < 4) continue;
        flags.push(
          makeFlag(ix, "phantom-gap", hollow, {
            msg: `an empty ${hollow.tag} leaves ${round1(spanned)}px where siblings sit ${round1(usual)}px apart`,
            measure: { spanned: round1(spanned), usual: round1(usual) },
            guides: [guide(before, "magenta"), guide(after, "magenta"), guide(el, "orange")],
            rect: rectOf(hollow),
          }),
        );
        flags[flags.length - 1].csig = ix.sigOf(el);
      }
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// 9. Overflow, spill and clipping.

function checkOverflow(ix, enabled) {
  const flags = [];
  const { doc } = ix.snapshot;
  if (enabled.has("page-overflow") && doc && doc.scrollWidth > doc.width + 0.5) {
    const docWidth = doc.width;
    const culprits = ix.els.filter((el) => {
      if (!isVisible(el) || el.pos === "fixed") return false;
      if (right(el) <= docWidth + 0.5 && left(el) >= -0.5) return false;
      let clipper = ix.els[el.cp];
      while (clipper) {
        if (clipper.clipsX && right(clipper) <= docWidth + 0.5 && left(clipper) >= -0.5)
          return false;
        clipper = ix.els[clipper.cp];
      }
      return true;
    });
    const outermost = culprits.filter((el) => !culprits.some((other) => other.i === el.p));
    const shown = outermost.length > 0 ? outermost : [null];
    for (const el of shown.slice(0, 5)) {
      flags.push(
        makeFlag(ix, "page-overflow", el, {
          msg: `the page is ${round1(doc.scrollWidth - docWidth)}px wider than the viewport${
            el ? ` — <${el.tag}> reaches x = ${round1(right(el))}` : ""
          }`,
          measure: { scrollWidth: doc.scrollWidth, width: docWidth, culprits: culprits.length },
          guides: el ? [guide(el, "magenta"), guide([docWidth, el.y, 0.01, el.h], "orange")] : [],
          rect: el ? undefined : [0, 0, docWidth, 10],
        }),
      );
    }
  }
  for (const el of ix.els) {
    if (!isVisible(el)) continue;
    const lines = el.text || [];
    if (enabled.has("text-spill") && lines.length > 0 && el.disp !== "inline" && !el.clips) {
      const ink = union(lines);
      const spillX = Math.max(right(ink) - right(el), el.x - ink.x);
      // A Range rect is the font's content area, which is *meant* to overhang
      // a line box set tighter than it (`leading-none`, `leading-[1.1]`) by
      // half the difference on each side. Only spill past that is spill.
      const overhang = Math.max(0, (Math.max(...lines.map((line) => line[3])) - el.lh) / 2);
      const spillY = Math.max(bottom(ink) - bottom(el), el.y - ink.y) - overhang;
      if ((spillX > 1 || spillY > 1) && el.to !== "ellipsis" && !(el.lc > 0)) {
        flags.push(
          makeFlag(ix, "text-spill", el, {
            severity: isPainted(el) ? "S1" : "S2",
            msg: `text runs ${round1(Math.max(spillX, spillY))}px outside its ${
              isPainted(el) ? "painted " : ""
            }box`,
            measure: { spillX: round1(spillX), spillY: round1(spillY) },
            guides: [guide(el, "magenta"), guide(ink, "cyan")],
          }),
        );
      }
    }
    const truncates = el.to === "ellipsis" || el.lc > 0;
    if (enabled.has("truncated") && truncates && (el.sw > el.cw + 0.5 || el.sh > el.ch + 0.5)) {
      flags.push(
        makeFlag(ix, "truncated", el, {
          msg: `text truncated (${el.lc > 0 ? `${el.lc}-line clamp` : "ellipsis"}): "${el.label}"`,
          measure: { scrollWidth: el.sw, clientWidth: el.cw },
          guides: [guide(el, "magenta")],
        }),
      );
    }
    if (enabled.has("hard-clip") && el.clips && !truncates) {
      const hidesX = el.clipsX && !/auto|scroll/.test(el.ovx) && el.sw > el.cw + 1;
      const hidesY = el.clipsY && !/auto|scroll/.test(el.ovy) && el.sh > el.ch + 1;
      if (!hidesX && !hidesY) continue;
      const clip = paddingBox(el);
      const cut = [];
      const past = (lineBox) =>
        (hidesX && (right(lineBox) > right(clip) + 1 || lineBox.x < clip.x - 1)) ||
        (hidesY && (bottom(lineBox) > bottom(clip) + 1 || lineBox.y < clip.y - 1));
      // Its own text first: a clipping box that holds its words directly
      // (no child element) hides them just the same.
      for (const line of el.text || []) {
        const lineBox = { x: line[0], y: line[1], w: line[2], h: line[3] };
        if (past(lineBox)) {
          cut.push({ kid: el, line: lineBox });
          break;
        }
      }
      const walk = (node, depth) => {
        if (depth > 8 || cut.length > 3) return;
        for (const kidIndex of ix.kids[node.i]) {
          const kid = ix.els[kidIndex];
          if (!isVisible(kid) || kid.srOnly) continue;
          for (const line of kid.text || []) {
            const lineBox = { x: line[0], y: line[1], w: line[2], h: line[3] };
            if (past(lineBox)) {
              cut.push({ kid, line: lineBox });
              break;
            }
          }
          if (kid.cp === el.i || kid.cp === node.cp) walk(kid, depth + 1);
        }
      };
      walk(el, 0);
      if (cut.length === 0) continue;
      flags.push(
        makeFlag(ix, "hard-clip", el, {
          msg: `clips ${cut.length > 3 ? "several lines" : `"${cut[0].kid.label}"`} (${
            hidesX ? `${el.sw - el.cw}px wide` : ""
          }${hidesX && hidesY ? ", " : ""}${hidesY ? `${el.sh - el.ch}px tall` : ""} hidden)`,
          measure: {
            scroll: [el.sw, el.sh],
            client: [el.cw, el.ch],
            cut: cut.map((entry) => ix.sigOf(entry.kid)),
          },
          guides: [guide(el, "orange"), ...cut.map((entry) => guide(entry.line, "magenta"))],
        }),
      );
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// 10. Small targets.

function labelledByTallLabel(ix, el) {
  if (el.tag !== "input") return false;
  let cursor = ix.els[el.p];
  for (let depth = 0; cursor && depth < 4; depth += 1) {
    if (cursor.tag === "label") return cursor.h >= MIN_TARGET;
    cursor = ix.els[cursor.p];
  }
  return false;
}

/**
 * The box a finger actually meets: the element's own, or — for a link whose
 * `::after` is stretched over its nearest positioned ancestor — that
 * ancestor's, cut down by any clipping ancestor in between. The cut is the
 * lesson of issue #786: `DiverList`'s overlay was believed to cover its row
 * while `Td`'s `overflow-hidden` clipped it to the cell.
 */
export function hitBox(ix, el) {
  if (el.overlay !== "after") return { x: el.x, y: el.y, w: el.w, h: el.h };
  let host = ix.els[el.p];
  while (host && host.pos === "static") host = ix.els[host.p];
  if (!host) return { x: el.x, y: el.y, w: el.w, h: el.h };
  let box = paddingBox(host);
  let clipper = ix.els[el.cp];
  while (clipper && clipper.i !== host.i && isAncestor(ix, host, clipper)) {
    const clip = paddingBox(clipper);
    const x1 = clipper.clipsX ? Math.max(box.x, clip.x) : box.x;
    const x2 = clipper.clipsX ? Math.min(right(box), right(clip)) : right(box);
    const y1 = clipper.clipsY ? Math.max(box.y, clip.y) : box.y;
    const y2 = clipper.clipsY ? Math.min(bottom(box), bottom(clip)) : bottom(box);
    box = { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
    clipper = ix.els[clipper.cp];
  }
  return box;
}

/** Is `inner` a descendant of `outer`? */
function isAncestor(ix, outer, inner) {
  let cursor = ix.els[inner.p];
  while (cursor) {
    if (cursor.i === outer.i) return true;
    cursor = ix.els[cursor.p];
  }
  return false;
}

function checkTargets(ix) {
  const flags = [];
  for (const el of ix.els) {
    if (!el.focusable || !isVisible(el) || el.srOnly || el.inImg) continue;
    if (el.tag === "a" && /^skip to/i.test(el.label)) continue;
    if (labelledByTallLabel(ix, el)) continue;
    if (el.inProse) continue;
    const hit = hitBox(ix, el);
    if (hit.h >= MIN_TARGET && hit.w >= MIN_TARGET) continue;
    const short = hit.h < MIN_TARGET;
    flags.push(
      makeFlag(ix, "small-target", el, {
        msg: `${el.tag} "${el.label}" is ${round1(hit.w)}×${round1(hit.h)}px (${
          short ? "height" : "width"
        } under ${MIN_TARGET})${el.overlay ? " including its stretched ::after" : ""}`,
        measure: {
          w: round1(hit.w),
          h: round1(hit.h),
          dimension: short ? "height" : "width",
          overlay: Boolean(el.overlay),
        },
        guides: [
          guide(el, "magenta"),
          guide(
            {
              x: el.x + el.w / 2 - Math.max(el.w, MIN_TARGET) / 2,
              y: el.y + el.h / 2 - Math.max(el.h, MIN_TARGET) / 2,
              w: Math.max(el.w, MIN_TARGET),
              h: Math.max(el.h, MIN_TARGET),
            },
            "green",
          ),
        ],
      }),
    );
  }
  return flags;
}

// ---------------------------------------------------------------------------
// 12. Census.

/** Content-driven boxes (paragraphs, sections) have no "right" height to compare. */
function isCensusable(el) {
  if (!isVisible(el)) return false;
  if (isControl(el)) return true;
  if (isPainted(el) && el.w <= 240 && el.h <= 64 && (el.text || []).length <= 1) return true;
  return false;
}

/**
 * One capture's census: for each component family, the heights, insets,
 * radii and font sizes each of its signatures rendered at. The report merges
 * captures and looks for values 1–3px apart within one family.
 */
export function censusOf(snapshot) {
  const ix = buildIndex(snapshot);
  const families = {};
  const bump = (bucket, value) => {
    const key = String(round1(value));
    bucket[key] = (bucket[key] || 0) + 1;
  };
  for (const el of ix.els) {
    if (!isCensusable(el)) continue;
    const family = familyOf(el);
    const sig = ix.sigOf(el);
    families[family] ||= {};
    if (!families[family][sig]) {
      families[family][sig] = {
        h: {},
        pl: {},
        pt: {},
        r: {},
        fs: {},
        cls: el.cls.slice(0, 200),
        n: 0,
      };
    }
    const entry = families[family][sig];
    entry.n += 1;
    if (textLineCount(ix, el) <= 1) bump(entry.h, el.h);
    bump(entry.pl, el.pad[3] + (el.bwl || el.bw)[3]);
    bump(entry.pt, el.pad[0] + (el.bwl || el.bw)[0]);
    bump(entry.r, el.rad[0]);
    const text = firstTextLine(ix, el);
    if (text) bump(entry.fs, text.owner.fs);
  }
  // Full-width rows inside a painted container: where their content starts.
  const rows = {};
  const cache = new Map();
  for (const el of ix.els) {
    if (!isVisible(el) || el.h < MIN_TARGET) continue;
    const parent = ix.els[el.p];
    const host = parent && (isPainted(parent) ? parent : ix.els[parent.p]);
    if (!host || !isPainted(host) || maxRadius(host) <= 0) continue;
    const inner = paddingBox(host);
    if (Math.abs(el.x - inner.x) > 1 || Math.abs(right(el) - right(inner)) > 1) continue;
    const content = visualLeft(ix, el, cache) - host.x;
    const key = ix.sigOf(el);
    rows[key] ||= { insets: {}, host: ix.sigOf(host).slice(0, 120), n: 0 };
    rows[key].n += 1;
    bump(rows[key].insets, content);
  }
  return { families, rows };
}

// ---------------------------------------------------------------------------
// Entry points.

const ALL_STATIC = [
  "focus-ring-clipped",
  "nested-corners",
  "off-centre",
  "three-part-row",
  "mismatched-controls",
  "text-beside-control",
  "ragged-edges",
  "ragged-column",
  "uneven-gaps",
  "phantom-gap",
  "page-overflow",
  "text-spill",
  "hard-clip",
  "truncated",
  "small-target",
];

/**
 * Every static check over one snapshot.
 *
 * @param {object} snapshot what `collectGeometry` returned
 * @param {{ checks?: Iterable<string>, rings?: Map<number, number>, targets?: boolean }} [options]
 *   `rings` carries measured focus-ring reaches by element index (the state
 *   pass measures them; anything absent is assumed to wear the global ring).
 *   `targets` turns the 44px check on — it belongs to the phone and tablet
 *   widths, where a finger is the pointer.
 */
export function analyzeSnapshot(snapshot, options = {}) {
  const ix = buildIndex(snapshot);
  const enabled = new Set(options.checks ? [...options.checks] : ALL_STATIC);
  if (!options.targets) enabled.delete("small-target");
  const flags = [];
  if (enabled.has("focus-ring-clipped")) flags.push(...checkFocusRingClipped(ix, options.rings));
  if (enabled.has("nested-corners")) flags.push(...checkNestedCorners(ix));
  if (enabled.has("off-centre")) flags.push(...checkOffCentre(ix));
  if (enabled.has("three-part-row")) flags.push(...checkThreePartRows(ix));
  if (enabled.has("mismatched-controls") || enabled.has("text-beside-control")) {
    flags.push(...checkRows(ix, enabled));
  }
  if (enabled.has("ragged-edges")) flags.push(...checkRaggedEdges(ix));
  if (enabled.has("ragged-column")) flags.push(...checkRaggedColumns(ix));
  if (enabled.has("uneven-gaps") || enabled.has("phantom-gap"))
    flags.push(...checkGaps(ix, enabled));
  flags.push(...checkOverflow(ix, enabled));
  if (enabled.has("small-target")) flags.push(...checkTargets(ix));
  return flags;
}

// ---------------------------------------------------------------------------
// 11. Interaction states (measured by states.mjs through CDP).

function rectsDiffer(a, b, tolerance = 0.5) {
  if (!a || !b) return false;
  return a.some((value, index) => Math.abs(value - b[index]) > tolerance);
}

function outlineVisible(outline) {
  return Boolean(outline && outline.style !== "none" && outline.width > 0 && outline.alpha > 0.02);
}

/** How far a focus state's ring reaches outside the box: outline or ring shadow. */
export function ringReach(state) {
  if (!state) return DEFAULT_RING_REACH;
  let reach = 0;
  if (outlineVisible(state.outline)) reach = state.outline.offset + state.outline.width;
  if (state.shadow && state.shadow !== "none") {
    for (const part of state.shadow.split(/,(?![^(]*\))/)) {
      if (/\binset\b/.test(part)) continue;
      const lengths = (
        part
          .replace(/rgba?\([^)]*\)|oklab\([^)]*\)|color\([^)]*\)|#\w+/g, "")
          .match(/-?[\d.]+px/g) || []
      ).map((token) => Number.parseFloat(token));
      const [dx = 0, dy = 0, blur = 0, spread = 0] = lengths;
      const colour = part.match(/rgba?\([^)]*\)|oklab\([^)]*\)|color\([^)]*\)/);
      const transparent = colour && /,\s*0\)$|\/\s*0\)$/.test(colour[0]);
      if (transparent) continue;
      reach = Math.max(reach, spread + Math.max(Math.abs(dx), Math.abs(dy)) + blur);
    }
  }
  return round1(reach);
}

function paintKey(box) {
  return `${box.bg}|${box.bgi}|${box.bc}|${box.shadow}`;
}

/**
 * The flags one element's hover and focus states earn, given the rest state
 * they are compared to. Called inside the state pass so a flagged state can be
 * photographed while it is still forced.
 */
export function analyzeStates(element, rest, hover, focus) {
  const flags = [];
  const make = (check, fields) => ({
    check,
    severity: fields.severity || CHECKS[check].severity,
    el: element.i,
    sig: element.sig,
    csig: element.csig,
    cls: element.cls,
    label: element.label,
    rect: rest.rect,
    state: fields.state,
    msg: fields.msg,
    measure: fields.measure || {},
    guides: fields.guides || [],
  });
  for (const [state, snap] of [
    ["hover", hover],
    ["focus", focus],
  ]) {
    if (!snap) continue;
    if (state === "hover" && !snap.matches.hover) continue;
    if (state === "focus" && !snap.matches.focusVisible) continue;
    const sizeMoved = Math.abs(snap.ow - rest.ow) > 0.5 || Math.abs(snap.oh - rest.oh) > 0.5;
    const parentMoved = rectsDiffer(rest.parentRect, snap.parentRect);
    const siblingsMoved = rest.sib.some((rect, index) => rectsDiffer(rect, snap.sib[index]));
    if (sizeMoved || parentMoved || siblingsMoved) {
      flags.push(
        make(state === "hover" ? "hover-shift" : "focus-shift", {
          state,
          msg: `${state} ${sizeMoved ? `resizes it ${rest.ow}×${rest.oh} → ${snap.ow}×${snap.oh}` : parentMoved ? "moves its parent" : "moves its siblings"}`,
          measure: {
            before: [rest.ow, rest.oh],
            after: [snap.ow, snap.oh],
            parentMoved,
            siblingsMoved,
          },
          guides: [guide(rest.rect, "cyan"), guide(snap.rect, "magenta")],
        }),
      );
    }
  }
  if (focus?.matches.focusVisible) {
    const ringShown = outlineVisible(focus.outline);
    const shadowChanged = focus.shadow !== rest.shadow;
    const selfRest = rest.rel.find((box) => box.k === "self");
    const selfFocus = focus.rel.find((box) => box.k === "self");
    const paintChanged = selfRest && selfFocus && paintKey(selfRest) !== paintKey(selfFocus);
    const inkChanged = focus.color !== rest.color || focus.deco !== rest.deco;
    if (!ringShown && !shadowChanged && !paintChanged && !inkChanged) {
      flags.push(
        make("focus-invisible", {
          state: "focus",
          msg: "keyboard focus changes nothing visible (no outline, ring, fill or ink change)",
          measure: { outline: focus.outline },
          guides: [guide(rest.rect, "magenta")],
        }),
      );
    } else {
      const reach = ringReach(focus);
      const global =
        ringShown &&
        [GLOBAL_RING, GLOBAL_RING_INSET].some(
          (sanctioned) =>
            Math.abs(focus.outline.width - sanctioned.width) < 0.5 &&
            Math.abs(focus.outline.offset - sanctioned.offset) < 0.5,
        );
      if (!global) {
        flags.push(
          make("focus-ring-differs", {
            state: "focus",
            msg: ringShown
              ? `focus ring is ${focus.outline.width}px at ${focus.outline.offset}px offset, not the global 3px at 2px (or -3px inset)`
              : shadowChanged
                ? `focus is a box-shadow ring (${reach}px reach), not the global outline`
                : "focus is shown only by a fill, border or ink change — no ring",
            measure: { outline: focus.outline, shadow: focus.shadow, reach },
            guides: [guide(rest.rect, "magenta")],
          }),
        );
      }
    }
  }
  if (hover?.matches.hover) {
    for (const box of hover.rel) {
      const before = rest.rel.find((candidate) => candidate.k === box.k);
      if (!before) continue;
      const filled = box.bg !== before.bg || box.bgi !== before.bgi;
      if (!filled || box.bgAlpha <= 0.02) continue;
      const container = box.container;
      if (container) {
        const inner = {
          x: container.rect[0] + container.bw[3],
          y: container.rect[1] + container.bw[0],
          w: container.rect[2] - container.bw[1] - container.bw[3],
          h: container.rect[3] - container.bw[0] - container.bw[2],
        };
        const fill = { x: box.rect[0], y: box.rect[1], w: box.rect[2], h: box.rect[3] };
        let worst = null;
        CORNERS.forEach((corner, k) => {
          const outerRadius = Math.max(
            0,
            container.rad[k] - Math.max(container.bw[0], container.bw[3]),
          );
          if (outerRadius <= 0.5) return;
          const dx =
            corner === "tl" || corner === "bl" ? fill.x - inner.x : right(inner) - right(fill);
          const dy =
            corner === "tl" || corner === "tr" ? fill.y - inner.y : bottom(inner) - bottom(fill);
          if (dx < -0.5 || dy < -0.5 || dx > CORNER_NEAR || dy > CORNER_NEAR) return;
          const gap = (dx + dy) / 2;
          if (container.clips && gap < 0.75) return;
          const expected = Math.max(0, outerRadius - gap);
          const miss = Math.abs(box.rad[k] - expected);
          if (miss > 2 && (!worst || miss > worst.miss)) {
            worst = {
              corner,
              expected: round1(expected),
              actual: box.rad[k],
              gap: round1(gap),
              miss,
            };
          }
        });
        if (worst) {
          flags.push(
            make("fill-corners", {
              state: "hover",
              msg: `hover fill's ${worst.corner} corner is ${worst.actual}px, ${worst.gap}px inside a ${container.rad[CORNERS.indexOf(worst.corner)]}px container corner (nests at ≈${worst.expected}px)${container.clips ? "" : " and the container does not clip"}`,
              measure: { ...worst, fill: box.k, containerClips: container.clips },
              guides: [guide(fill, "magenta"), guide(container.rect, "orange")],
            }),
          );
        }
      }
      if (box.text) {
        const fill = { x: box.rect[0], y: box.rect[1], w: box.rect[2], h: box.rect[3] };
        const [tx, ty, tw, th] = box.text;
        const room = {
          left: tx - fill.x,
          right: right(fill) - (tx + tw),
          top: ty - fill.y,
          bottom: bottom(fill) - (ty + th),
        };
        const tight = Object.entries(room).filter(([, value]) => value < 4 && value > -20);
        if (tight.length > 0) {
          flags.push(
            make("fill-tight", {
              state: "hover",
              msg: `hover fill leaves ${tight.map(([side, value]) => `${round1(value)}px ${side}`).join(", ")} around its text`,
              measure: Object.fromEntries(
                Object.entries(room).map(([side, value]) => [side, round1(value)]),
              ),
              guides: [guide(fill, "magenta"), guide(box.text, "cyan")],
            }),
          );
        }
      }
      break;
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Clustering and the settled list.

/** One shared component's flaw is one line: check + signature + container. */
export function clusterKey(flag) {
  return `${flag.check}\u0000${flag.sig}\u0000${flag.csig}`;
}

/**
 * Whether a flag is one `scripts/pixel-probe-settled.json` has already judged
 * right. An entry names the check and either the exact signature or a
 * `classes` list every one of which the flag's class string must carry.
 */
export function settledEntryFor(flag, settled) {
  for (const entry of settled || []) {
    if (entry.check !== flag.check) continue;
    if (entry.signature && entry.signature !== flag.sig) continue;
    if (entry.container && entry.container !== flag.csig) continue;
    if (entry.classes) {
      const tokens = new Set(String(flag.cls || "").split(/\s+/));
      if (!entry.classes.every((token) => tokens.has(token))) continue;
    }
    if (entry.label && !String(flag.label || "").startsWith(entry.label)) continue;
    if (!entry.signature && !entry.classes && !entry.label && !entry.container) continue;
    return entry;
  }
  return null;
}

/**
 * Near-misses in a merged census: one family whose members render at values
 * 1–3px apart. Values further apart are a deliberate size step (a `boat`
 * control beside an `md` one), and equal values are the point.
 */
export function censusNearMisses(merged) {
  const out = [];
  for (const [family, sigs] of Object.entries(merged.families || {})) {
    for (const metric of ["h", "pl", "pt", "r"]) {
      const values = new Map();
      for (const [sig, entry] of Object.entries(sigs)) {
        for (const [value, count] of Object.entries(entry[metric] || {})) {
          const number = Number(value);
          if (!values.has(number)) values.set(number, { count: 0, sigs: new Set() });
          values.get(number).count += count;
          values.get(number).sigs.add(sig);
        }
      }
      const sorted = [...values.keys()].sort((a, b) => a - b);
      for (let index = 1; index < sorted.length; index += 1) {
        const diff = sorted[index] - sorted[index - 1];
        if (diff < 1 || diff > 3) continue;
        const a = values.get(sorted[index - 1]);
        const b = values.get(sorted[index]);
        out.push({
          family,
          metric,
          values: [sorted[index - 1], sorted[index]],
          counts: [a.count, b.count],
          sigs: [...new Set([...a.sigs, ...b.sigs])],
        });
      }
    }
  }
  return out;
}
