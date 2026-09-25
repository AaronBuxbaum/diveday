/**
 * **The pixel probe's eyes: one self-contained walk of the rendered document.**
 *
 * `collectGeometry` is handed to `page.evaluate` (and, in its `pick` form, to a
 * CDP `Runtime.callFunctionOn`), which serialises its *source* and runs it
 * inside the page. Nothing outside the function body exists over there — not a
 * module `const`, not an import, not a helper declared beside it. That exact
 * mistake broke `scripts/screenshot.mjs` once (its `waitForFunction` closed
 * over `SKELETON_SELECTOR` and threw a `ReferenceError` on every route), so
 * `collect.test.mjs` re-creates this function from its source text inside a
 * fresh jsdom window and fails if it reaches for anything it did not declare.
 *
 * **It measures what rendered, never what the class string intended.** Every
 * number here comes from `getBoundingClientRect`, `getComputedStyle` or a text
 * `Range`: `px-0` losing to a size's `px-4` in the cascade (a417831) and a
 * vertical margin doing nothing to an inline box (a1c5500) are both invisible
 * to anyone reading source, and both are plain in these numbers.
 *
 * **It changes nothing it does not put back in the same breath.** The one write
 * is lifting `body { overflow-x: clip }` to read the document's true
 * `scrollWidth` (globals.css hides sideways overflow from that measure; see
 * `e2e/waivers.spec.ts`, which does the same), restored in a `finally` before
 * the function returns. It never scrolls, focuses or dispatches anything.
 *
 * What it returns is raw geometry, not verdicts — `analyze.mjs` decides.
 *
 * @param {{ pick?: number[] | null, maxElements?: number, labelChars?: number }} [options]
 *   `pick` switches the function into its second job: return the live elements
 *   at those record indices (same walk, same numbering) so the CDP state pass
 *   can address exactly the boxes the analysis talked about.
 */
export function collectGeometry(options) {
  const opts = options || {};
  const maxElements = opts.maxElements || 15000;
  const labelChars = opts.labelChars || 40;
  const pick = Array.isArray(opts.pick) ? new Set(opts.pick) : null;
  const picked = [];

  const sx = window.scrollX || 0;
  const sy = window.scrollY || 0;
  const round = (value) => Math.round(value * 100) / 100;
  const num = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  // Alpha of a computed colour, whatever notation the engine serialised it in:
  // `rgba(0, 0, 0, 0)`, `rgb(1 2 3 / 0.5)`, `oklab(… / 0)`, `color(srgb … / 0)`.
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
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "TEMPLATE",
    "NOSCRIPT",
    "LINK",
    "META",
    "BR",
    "WBR",
    "NEXTJS-PORTAL",
  ]);
  const FOCUSABLE_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);
  const CONTROL_ROLES = new Set([
    "button",
    "link",
    "tab",
    "menuitem",
    "menuitemradio",
    "menuitemcheckbox",
    "switch",
    "checkbox",
    "radio",
    "option",
    "combobox",
    "slider",
  ]);

  // Font metrics for baselines: a text Range's rect top is the inline box's
  // top, which sits exactly one ascent above the baseline for its primary font.
  // An unattached canvas is not a DOM write; it never enters the document.
  let metricsContext = null;
  const ascentCache = new Map();
  const ascentOf = (style) => {
    const key = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    if (ascentCache.has(key)) return ascentCache.get(key);
    let ascent = null;
    try {
      if (!metricsContext) {
        const canvas =
          typeof OffscreenCanvas === "function"
            ? new OffscreenCanvas(1, 1)
            : document.createElement("canvas");
        metricsContext = canvas.getContext("2d");
      }
      if (metricsContext) {
        metricsContext.font = key;
        const metrics = metricsContext.measureText("Hg");
        if (Number.isFinite(metrics.fontBoundingBoxAscent)) {
          ascent = [round(metrics.fontBoundingBoxAscent), round(metrics.fontBoundingBoxDescent)];
        }
      }
    } catch {
      ascent = null;
    }
    ascentCache.set(key, ascent);
    return ascent;
  };

  const radiusOf = (value, width, height) => {
    if (!value) return 0;
    const first = String(value).trim().split(/\s+/)[0];
    const raw = first.endsWith("%") ? (num(first) / 100) * Math.min(width, height) : num(first);
    return round(Math.min(raw, width / 2, height / 2));
  };

  // Direct, non-blank text children, measured through a Range trimmed of the
  // whitespace around them — so indentation in the markup never widens a box.
  const textLinesOf = (element) => {
    const lines = [];
    for (const node of element.childNodes) {
      if (node.nodeType !== 3) continue;
      const data = node.data;
      const start = data.search(/\S/);
      if (start < 0) continue;
      let end = data.length;
      while (end > start && /\s/.test(data[end - 1])) end -= 1;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, end);
      for (const rect of range.getClientRects()) {
        if (rect.width < 0.5 || rect.height < 0.5) continue;
        const top = rect.top + sy;
        const line = lines.find((known) => Math.abs(known[1] - top) < 1);
        if (line) {
          const right = Math.max(line[0] + line[2], rect.right + sx);
          line[0] = Math.min(line[0], rect.left + sx);
          line[2] = right - line[0];
          line[3] = Math.max(line[3], rect.height);
        } else {
          lines.push([rect.left + sx, top, rect.width, rect.height]);
        }
      }
    }
    return lines.slice(0, 24).map((line) => line.map(round));
  };

  const inFlowPseudo = (element) => {
    let found = null;
    for (const which of ["::before", "::after"]) {
      const pseudo = getComputedStyle(element, which);
      const content = pseudo.content;
      if (!content || content === "none" || content === "normal") continue;
      if (pseudo.display === "none") continue;
      if (pseudo.position === "absolute" || pseudo.position === "fixed") continue;
      found = found ? "both" : which.slice(2);
    }
    return found;
  };

  const records = [];
  let truncated = false;
  const stack = [];
  const pushChildren = (element, parent, clipParent) => {
    const children = element.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push([children[index], parent, clipParent]);
    }
  };

  const liftedFrom = document.body ? document.body.style.overflowX : "";
  let scrollWidth = 0;
  let clippedScrollWidth = 0;
  try {
    clippedScrollWidth = document.documentElement.scrollWidth;
    if (document.body && !pick) {
      document.body.style.overflowX = "visible";
      scrollWidth = document.documentElement.scrollWidth;
    }
  } finally {
    if (document.body && !pick) document.body.style.overflowX = liftedFrom;
  }

  if (document.body) pushChildren(document.body, -1, -1);
  while (stack.length > 0) {
    const [element, parent, clipParent] = stack.pop();
    if (SKIP_TAGS.has(element.tagName)) continue;
    const isSvg = typeof SVGElement === "function" && element instanceof SVGElement;
    if (isSvg && element.tagName.toLowerCase() !== "svg") continue;
    const style = getComputedStyle(element);
    if (style.display === "none") continue;
    if (style.display === "contents") {
      pushChildren(element, parent, clipParent);
      continue;
    }
    if (typeof element.checkVisibility === "function" && !element.checkVisibility()) continue;
    if (records.length >= maxElements) {
      truncated = true;
      break;
    }
    const index = records.length;
    if (pick) {
      records.push(null);
      if (pick.has(index)) picked[opts.pick.indexOf(index)] = element;
      if (!isSvg) pushChildren(element, index, clipParent);
      continue;
    }

    const rect = element.getBoundingClientRect();
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role") || "";
    const className =
      typeof element.className === "string"
        ? element.className
        : element.getAttribute("class") || "";
    const clipsX = style.overflowX !== "visible";
    const clipsY = style.overflowY !== "visible";
    const contain = style.contain || "";
    const clipsPaint =
      /paint|strict|content/.test(contain) || (style.clipPath && style.clipPath !== "none");
    const clips = clipsX || clipsY || clipsPaint;
    const tabIndexAttr = element.getAttribute("tabindex");
    const focusable =
      (FOCUSABLE_TAGS.has(element.tagName) &&
        !(element.tagName === "A" && !element.hasAttribute("href")) &&
        !(element.tagName === "INPUT" && element.type === "hidden")) ||
      (tabIndexAttr !== null && Number(tabIndexAttr) >= 0);
    const interactive = focusable || CONTROL_ROLES.has(role);
    const disabled = element.disabled === true || element.getAttribute("aria-disabled") === "true";
    const text = textLinesOf(element);
    const bgAlpha = alphaOf(style.backgroundColor);
    const borderWidths = [
      num(style.borderTopWidth),
      num(style.borderRightWidth),
      num(style.borderBottomWidth),
      num(style.borderLeftWidth),
    ];
    const borderSeen = [
      style.borderTopStyle !== "none" && alphaOf(style.borderTopColor) > 0.02,
      style.borderRightStyle !== "none" && alphaOf(style.borderRightColor) > 0.02,
      style.borderBottomStyle !== "none" && alphaOf(style.borderBottomColor) > 0.02,
      style.borderLeftStyle !== "none" && alphaOf(style.borderLeftColor) > 0.02,
    ];
    const record = {
      i: index,
      p: parent,
      cp: clipParent,
      tag,
      role,
      type: tag === "input" ? element.type : "",
      cls: className.slice(0, 400),
      label: "",
      x: round(rect.left + sx),
      y: round(rect.top + sy),
      w: round(rect.width),
      h: round(rect.height),
      disp: style.display,
      pos: style.position,
      fd: style.flexDirection,
      fw: style.flexWrap,
      jc: style.justifyContent,
      ai: style.alignItems,
      as: style.alignSelf,
      ji: style.justifyItems,
      ac: style.alignContent,
      ta: style.textAlign,
      va: style.verticalAlign,
      ws: style.whiteSpace,
      gapR: num(style.rowGap),
      gapC: num(style.columnGap),
      pad: [
        num(style.paddingTop),
        num(style.paddingRight),
        num(style.paddingBottom),
        num(style.paddingLeft),
      ],
      mar: [
        num(style.marginTop),
        num(style.marginRight),
        num(style.marginBottom),
        num(style.marginLeft),
      ],
      // Border widths the eye can see: a transparent or `none` border takes
      // space but paints nothing, so it counts as zero here.
      bw: borderWidths.map((width, side) => (borderSeen[side] ? width : 0)),
      // The space a border takes whether or not it paints — what an inset is
      // measured from.
      bwl: borderWidths,
      rad: [
        radiusOf(style.borderTopLeftRadius, rect.width, rect.height),
        radiusOf(style.borderTopRightRadius, rect.width, rect.height),
        radiusOf(style.borderBottomRightRadius, rect.width, rect.height),
        radiusOf(style.borderBottomLeftRadius, rect.width, rect.height),
      ],
      ovx: style.overflowX,
      ovy: style.overflowY,
      clips,
      clipsX: clipsX || Boolean(clipsPaint),
      clipsY: clipsY || Boolean(clipsPaint),
      fs: num(style.fontSize),
      lh: style.lineHeight === "normal" ? round(num(style.fontSize) * 1.2) : num(style.lineHeight),
      fwt: num(style.fontWeight),
      bg: bgAlpha > 0.02 || style.backgroundImage !== "none",
      bgc: style.backgroundColor,
      shadow: style.boxShadow !== "none",
      op: num(style.opacity),
      vis: style.visibility,
      transform: style.transform !== "none",
      to: style.textOverflow,
      lc: num(style.webkitLineClamp || style.getPropertyValue("-webkit-line-clamp")),
      interactive,
      focusable,
      disabled,
      ariaHidden: element.closest('[aria-hidden="true"]') !== null,
      // Inside an illustration (`role="img"`): a mock of the product drawn on
      // a marketing page, not a control anyone is meant to press.
      inImg: element.parentElement?.closest('[role="img"]') != null,
      // A `::after` stretched over the nearest positioned ancestor is this
      // link's real hit area (`after:absolute after:inset-0`).
      overlay: null,
      pe: style.pointerEvents,
      text,
      asc: null,
      pseudo: null,
      inProse: false,
      srOnly: false,
      replaced: /^(img|svg|video|canvas|iframe|input|select|textarea|picture|object)$/.test(tag),
      sw: 0,
      sh: 0,
      cw: 0,
      ch: 0,
      heading: /^h[1-6]$/.test(tag) || role === "heading",
      // Through the attribute, never the property: a <form> holding an
      // <input name="id"> answers `form.id` with that input (DOM clobbering),
      // which is how settings-display's form once skipped every width.
      id: (element.getAttribute("id") || "").slice(0, 60),
    };
    if (text.length > 0) record.asc = ascentOf(style);
    if (interactive || text.length > 0) {
      const aria = element.getAttribute("aria-label");
      const own = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
      record.label = (aria || own).slice(0, labelChars);
    }
    if (
      /flex|grid/.test(style.display) ||
      style.textAlign === "center" ||
      tag === "button" ||
      tag === "a" ||
      tag === "summary"
    ) {
      record.pseudo = inFlowPseudo(element);
    }
    if (interactive) {
      const after = getComputedStyle(element, "::after");
      if (
        after.content &&
        after.content !== "none" &&
        after.content !== "normal" &&
        after.position === "absolute" &&
        num(after.top) === 0 &&
        num(after.left) === 0 &&
        num(after.right) === 0 &&
        num(after.bottom) === 0
      ) {
        record.overlay = "after";
      }
    }
    if (tag === "a" && element.parentElement) {
      for (const sibling of element.parentElement.childNodes) {
        if (sibling.nodeType === 3 && /\S/.test(sibling.data)) {
          record.inProse = true;
          break;
        }
      }
    }
    record.srOnly =
      /(^|\s)sr-only(\s|$)/.test(className) ||
      (rect.width <= 1 &&
        rect.height <= 1 &&
        style.position === "absolute" &&
        style.overflow !== "visible");
    if (clips || style.textOverflow === "ellipsis" || record.lc > 0 || text.length > 0) {
      record.sw = element.scrollWidth;
      record.sh = element.scrollHeight;
      record.cw = element.clientWidth;
      record.ch = element.clientHeight;
    }
    records.push(record);
    if (!isSvg) pushChildren(element, index, clips ? index : clipParent);
  }

  if (pick) return picked;
  return {
    url: location.href,
    path: location.pathname + location.search,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    dpr: window.devicePixelRatio || 1,
    doc: {
      width: document.documentElement.clientWidth,
      height: document.documentElement.scrollHeight,
      scrollWidth,
      clippedScrollWidth,
    },
    // What an element with no painted ancestor is seen against.
    pageBg: document.body ? getComputedStyle(document.body).backgroundColor : "",
    truncated,
    elements: records,
  };
}
