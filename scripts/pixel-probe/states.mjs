import { collectGeometry } from "./collect.mjs";

/**
 * **Hover and focus, forced — never performed.**
 *
 * `capture()` parks the pointer at (0,0) before every shot and nothing in the
 * visual suite hovers or focuses anything, so until this pass only people had
 * ever looked at a hover fill or a focus ring. Moving the mouse or tabbing
 * would change the page the next capture photographs; forcing the pseudo
 * class through DevTools does neither.
 *
 * - `CSS.forcePseudoState` sets `:hover` on the element **and every ancestor**,
 *   as a real pointer does, so `group-hover:` and `has-[…]` fills show; and
 *   `:focus` + `:focus-visible` on the element with `:focus-within` up the
 *   chain. No event fires and `document.activeElement` never moves.
 * - Each forced state is confirmed with `el.matches(…)` and recorded as
 *   `unforced` when it did not take, rather than measured as if it had.
 * - `:active` is never forced: `.pressable` scales to 0.97 by design.
 * - Layout shift is read from `offsetWidth`/`offsetHeight` and the parent's
 *   and siblings' rects, never from the element's own transformed rect, so a
 *   hover lift drawn with `transform` is not mistaken for a reflow.
 * - Every forced state is cleared in a `finally`, and the CDP session is
 *   detached, whatever threw.
 */

/** What a bounded call hands back when its budget ran out. */
export const STALLED = Symbol("pixel-probe-stalled");

const OBJECT_GROUP = "pixel-probe";

/**
 * Measures one element in whatever state is currently forced. Runs in the
 * page through `Runtime.callFunctionOn`, with the element as `this`, so like
 * `collectGeometry` it must be self-contained.
 */
function measureElementState() {
  const sx = window.scrollX || 0;
  const sy = window.scrollY || 0;
  const round = (value) => Math.round(value * 100) / 100;
  const num = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const alphaOf = (color) => {
    if (!color || color === "transparent") return 0;
    const slash = color.match(/\/\s*([0-9.]+%?)\s*\)$/);
    if (slash) return slash[1].endsWith("%") ? num(slash[1]) / 100 : num(slash[1]);
    const rgba = color.match(/^rgba\(([^)]+)\)$/);
    if (rgba) {
      const parts = rgba[1].split(",");
      return parts.length === 4 ? num(parts[3]) : 1;
    }
    return 1;
  };
  const box = (node) => {
    const rect = node.getBoundingClientRect();
    return [round(rect.left + sx), round(rect.top + sy), round(rect.width), round(rect.height)];
  };
  const radii = (style, rect) =>
    [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ].map((value) => {
      const first = String(value).trim().split(/\s+/)[0];
      const raw = first.endsWith("%")
        ? (num(first) / 100) * Math.min(rect[2], rect[3])
        : num(first);
      return round(Math.min(raw, rect[2] / 2, rect[3] / 2));
    });
  const borders = (style) => [
    num(style.borderTopWidth),
    num(style.borderRightWidth),
    num(style.borderBottomWidth),
    num(style.borderLeftWidth),
  ];
  const containerOf = (node) => {
    let cursor = node.parentElement;
    while (cursor && cursor !== document.body) {
      const style = getComputedStyle(cursor);
      const rect = box(cursor);
      const rad = radii(style, rect);
      const clips = style.overflowX !== "visible" || style.overflowY !== "visible";
      const painted =
        alphaOf(style.backgroundColor) > 0.02 ||
        style.backgroundImage !== "none" ||
        borders(style).some((width) => width > 0);
      if (Math.max(...rad) > 0.5 && (painted || clips)) {
        return { rect, rad, bw: borders(style), clips };
      }
      cursor = cursor.parentElement;
    }
    return null;
  };
  const selfArea = Math.max(1, this.offsetWidth * this.offsetHeight);
  const textBounds = (root) => {
    const rect = root.getBoundingClientRect();
    if (rect.width * rect.height > selfArea * 6) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let x1 = Number.POSITIVE_INFINITY;
    let y1 = Number.POSITIVE_INFINITY;
    let x2 = Number.NEGATIVE_INFINITY;
    let y2 = Number.NEGATIVE_INFINITY;
    let seen = 0;
    for (let node = walker.nextNode(); node && seen < 120; node = walker.nextNode()) {
      const data = node.data;
      const start = data.search(/\S/);
      if (start < 0) continue;
      const parent = node.parentElement;
      if (parent && typeof parent.checkVisibility === "function" && !parent.checkVisibility()) {
        continue;
      }
      let end = data.length;
      while (end > start && /\s/.test(data[end - 1])) end -= 1;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      for (const part of range.getClientRects()) {
        if (part.width < 0.5 || part.height < 0.5) continue;
        x1 = Math.min(x1, part.left + sx);
        y1 = Math.min(y1, part.top + sy);
        x2 = Math.max(x2, part.right + sx);
        y2 = Math.max(y2, part.bottom + sy);
      }
      seen += 1;
    }
    if (!Number.isFinite(x1)) return null;
    return [round(x1), round(y1), round(x2 - x1), round(y2 - y1)];
  };
  const paint = (key, node) => {
    const style = getComputedStyle(node);
    const rect = box(node);
    return {
      k: key,
      rect,
      bg: style.backgroundColor,
      bgAlpha: alphaOf(style.backgroundColor),
      bgi: style.backgroundImage !== "none",
      bc: [
        style.borderTopColor,
        style.borderRightColor,
        style.borderBottomColor,
        style.borderLeftColor,
      ].join(" "),
      bw: borders(style),
      rad: radii(style, rect),
      shadow: style.boxShadow,
      clips: style.overflowX !== "visible" || style.overflowY !== "visible",
      container: containerOf(node),
      text: textBounds(node),
    };
  };
  const style = getComputedStyle(this);
  const parent = this.parentElement;
  const siblings = parent
    ? Array.from(parent.children)
        .filter((sibling) => sibling !== this)
        .slice(0, 16)
    : [];
  const relatives = [["self", this]];
  let ancestor = this.parentElement;
  for (let level = 1; ancestor && level <= 4; level += 1) {
    if (ancestor === document.body) break;
    relatives.push([`a${level}`, ancestor]);
    ancestor = ancestor.parentElement;
  }
  const descendants = this.querySelectorAll("*");
  for (let index = 0; index < descendants.length && index < 10; index += 1) {
    relatives.push([`d${index}`, descendants[index]]);
  }
  return {
    matches: {
      hover: this.matches(":hover"),
      focus: this.matches(":focus"),
      focusVisible: this.matches(":focus-visible"),
    },
    ow: this.offsetWidth,
    oh: this.offsetHeight,
    rect: box(this),
    parentRect: parent ? box(parent) : null,
    sib: siblings.map(box),
    outline: {
      style: style.outlineStyle,
      width: num(style.outlineWidth),
      offset: num(style.outlineOffset),
      color: style.outlineColor,
      alpha: alphaOf(style.outlineColor),
    },
    shadow: style.boxShadow,
    color: style.color,
    deco: style.textDecorationLine,
    rel: relatives.map(([key, node]) => paint(key, node)),
  };
}

/** Every element in `this` array plus all their ancestors, each once. */
function flattenWithAncestors() {
  const all = [];
  const seen = new Map();
  for (const element of this) {
    let node = element;
    while (node && node.nodeType === 1) {
      if (!seen.has(node)) {
        seen.set(node, all.length);
        all.push(node);
      }
      node = node.parentElement;
    }
  }
  return all;
}

/** For each element in `this`, its chain (self first) as indexes into the flattened list. */
function ancestorChains() {
  const seen = new Map();
  let next = 0;
  const chains = [];
  for (const element of this) {
    const chain = [];
    let node = element;
    while (node && node.nodeType === 1) {
      if (!seen.has(node)) {
        seen.set(node, next);
        next += 1;
      }
      chain.push(seen.get(node));
      node = node.parentElement;
    }
    chains.push(chain);
  }
  return chains;
}

const asFunction = (fn) => fn.toString();

/**
 * Force, measure and clear hover and focus on each candidate element.
 *
 * @param {import("@playwright/test").Page} page
 * @param {object} options
 * @param {number[]} options.candidates record indices (as `collectGeometry` numbered them)
 * @param {"full" | "ring"} options.mode `ring` only forces focus, to measure the ring's reach
 * @param {Set<number>} [options.hoverOnly] candidates never forced into focus: ones no
 *   keyboard focuses (`takesFocus` in analyze.mjs), whose forced ring is unreachable
 * @param {(what: string, ms: number, work: Promise<unknown>, degraded: unknown) => Promise<unknown>} options.bound
 *   the caller's renderer-bounded await (`withRendererBound` in the visual spec)
 * @param {number} options.callMs the bound on any one protocol step
 * @param {number} options.deadline wall-clock ms after which no new candidate starts
 * @param {(index: number, state: "hover" | "focus", rest: object, snap: object) => Promise<void>} [options.onState]
 *   called while the state is still forced, so it can be photographed
 */
export async function statePass(page, options) {
  const { candidates, mode, bound, callMs, deadline, onState } = options;
  const hoverOnly = options.hoverOnly ?? new Set();
  const results = new Map();
  const stats = {
    requested: candidates.length,
    tested: 0,
    unforcedHover: 0,
    unforcedFocus: 0,
    truncated: 0,
    stalled: false,
    error: null,
  };
  if (candidates.length === 0) return { results, stats };

  const guarded = async (what, work) => {
    const outcome = await bound(`pixel probe (not the screenshot): ${what}`, callMs, work, STALLED);
    if (outcome === STALLED) {
      stats.stalled = true;
      throw new Error(`pixel probe: ${what} stalled`);
    }
    return outcome;
  };

  const cdp = await guarded("opening a CDP session", page.context().newCDPSession(page));
  const forced = new Set();
  const force = async (nodeIds, classes) => {
    for (const nodeId of nodeIds) forced.add(nodeId);
    await guarded(
      "CSS.forcePseudoState",
      Promise.all(
        nodeIds.map((nodeId, position) =>
          cdp.send("CSS.forcePseudoState", {
            nodeId,
            forcedPseudoClasses: classes(position),
          }),
        ),
      ),
    );
  };
  const clear = async (nodeIds) => {
    await guarded(
      "clearing CSS.forcePseudoState",
      Promise.all(
        nodeIds.map((nodeId) =>
          cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] }),
        ),
      ),
    );
    for (const nodeId of nodeIds) forced.delete(nodeId);
  };
  const measure = async (objectId) => {
    const { result } = await guarded(
      "measuring a forced state",
      cdp.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: asFunction(measureElementState),
        returnByValue: true,
        objectGroup: OBJECT_GROUP,
      }),
    );
    return result.value;
  };

  try {
    await guarded("DOM.enable", cdp.send("DOM.enable"));
    await guarded("CSS.enable", cdp.send("CSS.enable"));
    // `DOM.requestNode` hands out node ids only once the document has been
    // requested on this session.
    await guarded("DOM.getDocument", cdp.send("DOM.getDocument", { depth: 0 }));
    const { result: picked } = await guarded(
      "resolving the candidates",
      cdp.send("Runtime.evaluate", {
        expression: `(${asFunction(collectGeometry)})(${JSON.stringify({ pick: candidates })})`,
        returnByValue: false,
        objectGroup: OBJECT_GROUP,
      }),
    );
    const { result: flat } = await guarded(
      "listing ancestors",
      cdp.send("Runtime.callFunctionOn", {
        objectId: picked.objectId,
        functionDeclaration: asFunction(flattenWithAncestors),
        returnByValue: false,
        objectGroup: OBJECT_GROUP,
      }),
    );
    const { result: chainsResult } = await guarded(
      "mapping ancestor chains",
      cdp.send("Runtime.callFunctionOn", {
        objectId: picked.objectId,
        functionDeclaration: asFunction(ancestorChains),
        returnByValue: true,
      }),
    );
    const chains = chainsResult.value;
    const { result: properties } = await guarded(
      "reading element handles",
      cdp.send("Runtime.getProperties", {
        objectId: flat.objectId,
        ownProperties: true,
      }),
    );
    const objectIds = [];
    for (const property of properties) {
      if (/^\d+$/.test(property.name) && property.value?.objectId) {
        objectIds[Number(property.name)] = property.value.objectId;
      }
    }
    const nodeIds = await guarded(
      "DOM.requestNode",
      Promise.all(
        objectIds.map((objectId) =>
          objectId
            ? cdp.send("DOM.requestNode", { objectId }).then((reply) => reply.nodeId)
            : Promise.resolve(0),
        ),
      ),
    );

    for (let position = 0; position < candidates.length; position += 1) {
      if (Date.now() > deadline) {
        stats.truncated = candidates.length - position;
        break;
      }
      const chain = chains[position];
      if (!chain || chain.length === 0) continue;
      const index = candidates[position];
      const selfObject = objectIds[chain[0]];
      const chainNodes = chain.map((flatIndex) => nodeIds[flatIndex]).filter(Boolean);
      if (!selfObject || chainNodes.length === 0) continue;
      const rest = await measure(selfObject);
      const entry = { rest, hover: null, focus: null };
      if (mode === "full") {
        await force(chainNodes, () => ["hover"]);
        try {
          const hover = await measure(selfObject);
          entry.hover = hover;
          if (!hover.matches.hover) stats.unforcedHover += 1;
          else if (onState) await onState(index, "hover", rest, hover);
        } finally {
          await clear(chainNodes);
        }
      }
      if (!hoverOnly.has(index)) {
        await force(chainNodes, (at) => (at === 0 ? ["focus", "focus-visible"] : ["focus-within"]));
        try {
          const focus = await measure(selfObject);
          entry.focus = focus;
          if (!focus.matches.focusVisible) stats.unforcedFocus += 1;
          else if (onState) await onState(index, "focus", rest, focus);
        } finally {
          await clear(chainNodes);
        }
      }
      results.set(index, entry);
      stats.tested += 1;
    }
  } catch (error) {
    stats.error = String(error?.message ?? error).slice(0, 300);
  } finally {
    // Clear anything still forced, whatever threw — best effort, bounded, and
    // never allowed to mask the error above. `CSS.disable` below resets forced
    // states as well; this is the explicit half, so nothing rests on that.
    if (forced.size > 0) {
      await bound(
        "pixel probe (not the screenshot): clearing leftover forced states",
        callMs,
        Promise.all(
          [...forced].map((nodeId) =>
            cdp
              .send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] })
              .catch(() => undefined),
          ),
        ),
        STALLED,
      ).catch(() => undefined);
    }
    await cdp
      .send("Runtime.releaseObjectGroup", { objectGroup: OBJECT_GROUP })
      .catch(() => undefined);
    await cdp.send("CSS.disable").catch(() => undefined);
    await cdp.send("DOM.disable").catch(() => undefined);
    await cdp.detach().catch(() => undefined);
  }
  return { results, stats, forcedLeft: forced.size };
}

export const __test__ = { measureElementState, flattenWithAncestors, ancestorChains };
