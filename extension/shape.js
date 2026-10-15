// Runs inside the agency's lookup page, through chrome.scripting.executeScript,
// so the function here must stand alone: no references outside its own body.

/**
 * **The page's shape, never its words**: what a check that could not finish
 * hands back, so DiveDay can see why without anyone on a call.
 *
 * Only structure: the address's path (never its query string, which carries
 * the diver's name on a search sent by GET), the title, the top headings,
 * each box's tag, type and what it says about itself (its name, id,
 * placeholder, aria-label and label), each button's words, how many forms and
 * frames, and whether a password box or a captcha is on the page. Never a
 * box's value, a table cell, a paragraph or a result row.
 *
 * Every text is cut to the words of `vocabulary` (`PAGE_SHAPE_WORDS` in
 * protocol.js), a form's own vocabulary; any other word becomes "_", and a
 * digit is never a word. The diver's own names (`scrub`) become "_" even when
 * they are form words. So no name, date or number on the page leaves it: the
 * report can say "first name", "date of birth", "search", never who.
 *
 * `captcha` is a captcha the staffer would have to answer on the page itself
 * (reCAPTCHA's box, hCaptcha, Cloudflare Turnstile), never reCAPTCHA's
 * invisible badge, which asks nothing.
 * @param {string[]} vocabulary
 * @param {string[]} scrub the diver's names, never kept
 * @returns {object}
 */
function describePageShape(vocabulary, scrub) {
  const MAX_BYTES = 4096;
  const MAX_TOKENS = 8;
  const BOX_TYPES = [
    "text",
    "search",
    "email",
    "tel",
    "number",
    "date",
    "month",
    "password",
    "checkbox",
    "radio",
    "url",
  ];
  const CAPTCHA =
    '.g-recaptcha, .h-captcha, .cf-turnstile, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"]';

  function fold(text) {
    return String(text || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  }
  const known = new Set(Array.isArray(vocabulary) ? vocabulary : []);
  const hidden = new Set(
    (Array.isArray(scrub) ? scrub : []).flatMap((name) => fold(name).split(/[^a-z]+/)),
  );

  /** The form's words of a text, in order; "_" for each run of any other. */
  function shapeWords(text) {
    const out = [];
    for (const token of fold(text).split(/[^a-z]+/)) {
      if (!token) continue;
      const word = known.has(token) && !hidden.has(token) ? token : "_";
      if (word === "_" && out[out.length - 1] === "_") continue;
      out.push(word);
      if (out.length >= MAX_TOKENS) break;
    }
    return out.join(" ");
  }

  function visible(element) {
    if (element.type === "hidden") return false;
    if (typeof element.checkVisibility === "function") {
      return element.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
    }
    for (let at = element; at; at = at.parentElement) {
      if (window.getComputedStyle(at).display === "none") return false;
    }
    return window.getComputedStyle(element).visibility !== "hidden";
  }

  function describe(element) {
    const parts = [
      element.getAttribute("name"),
      element.id,
      element.getAttribute("placeholder"),
      element.getAttribute("aria-label"),
    ];
    if (element.labels) for (const label of element.labels) parts.push(label.textContent);
    return parts.filter(Boolean).join(" ");
  }

  const path = location.pathname
    .split("/")
    .map((segment) => shapeWords(segment))
    .join("/");
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .filter(visible)
    .map((heading) => shapeWords(heading.textContent))
    .filter(Boolean)
    .slice(0, 6);
  const boxes = Array.from(document.querySelectorAll("input, select, textarea"))
    .filter(
      (element) =>
        visible(element) && !/^(submit|button|image|reset|file)$/i.test(element.type || ""),
    )
    .slice(0, 20)
    .map((element) => {
      const tag = element.tagName.toLowerCase();
      const type = tag === "input" ? String(element.type || "text").toLowerCase() : tag;
      return {
        tag,
        type: tag !== "input" ? tag : BOX_TYPES.includes(type) ? type : "other",
        words: shapeWords(describe(element)),
      };
    });
  const buttons = Array.from(
    document.querySelectorAll('button, input[type="submit"], input[type="button"]'),
  )
    .filter(visible)
    .slice(0, 12)
    .map((button) =>
      shapeWords(
        button.tagName === "INPUT"
          ? button.getAttribute("value") || button.getAttribute("aria-label")
          : button.textContent || button.getAttribute("aria-label"),
      ),
    );
  const captcha = Array.from(document.querySelectorAll(CAPTCHA)).some(
    (element) =>
      visible(element) &&
      !element.closest(".grecaptcha-badge") &&
      element.getAttribute("data-size") !== "invisible" &&
      !/[?&]size=invisible/.test(element.getAttribute("src") || ""),
  );
  const shape = {
    path,
    title: shapeWords(document.title),
    headings,
    boxes,
    buttons,
    forms: document.forms.length,
    frames: document.querySelectorAll("iframe").length,
    password: Array.from(document.querySelectorAll('input[type="password"]')).some(visible),
    captcha,
  };
  // Never more than a few kilobytes, whatever the page: the longest list gives way.
  while (JSON.stringify(shape).length > MAX_BYTES) {
    const longest = [shape.boxes, shape.buttons, shape.headings].sort(
      (a, b) => b.length - a.length,
    )[0];
    if (longest.length === 0) break;
    longest.pop();
  }
  return shape;
}

globalThis.DiveDayCertCheck = Object.assign(globalThis.DiveDayCertCheck || {}, {
  describePageShape,
});
