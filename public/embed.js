/* DiveDay embed loader — Harbor (ADR 20260901-diveday-reimagined).
 *
 * One line on a shop's own website: <script async src="https://<diveday>/embed.js"></script>
 * Then any number of these, each a widget from Settings → Website embed:
 *
 *   <div data-diveday="calendar|grid|departure|courses" data-shop="<slug>"
 *        data-look="site|light" data-lang="auto|en-US|es-ES"
 *        [data-show="<trip id> on departure, <course slug> on courses"]
 *        [data-set="<named list id> on grid and courses"]></div>
 *   <a href="…" data-diveday="button|lightbox" data-shop="<slug>" data-look="site|light">Book a dive</a>
 *
 * The attribute names are a contract (src/lib/embed-snippets.ts pins them, and
 * src/lib/embed-loader.test.ts runs this file against a host page). Every
 * snippet works with this file missing: a button is a link, a framed kind is
 * an empty <div>. What this adds is the frame, its height, the host page's
 * colour and face when the look is "site", the contrast rule that keeps a
 * pale host colour readable under white text, and the lightbox sheet.
 */
(() => {
  const script = document.currentScript;
  let origin = "";
  try {
    origin = new URL(script?.src ? script.src : location.href).origin;
  } catch (_e) {
    return;
  }
  const mounted = new WeakSet();
  const DIVEDAY_LAGOON = "#0e7490";

  function hostBrand(el) {
    // The host page's link colour, read off the element itself when it is a
    // link and off the nearest link otherwise, as #rrggbb.
    const probe = el.tagName === "A" ? el : el.closest("a") || document.querySelector("a[href]");
    const color = probe ? getComputedStyle(probe).color : "";
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
    if (!m) return null;
    const hex = `#${[m[1], m[2], m[3]].map((n) => `0${Number(n).toString(16)}`.slice(-2)).join("")}`;
    return hex;
  }
  function hostFont(el) {
    let family = getComputedStyle(el.parentElement || document.body).fontFamily || "";
    family = family.replace(/[^A-Za-z0-9 ,'"-]/g, "").slice(0, 120);
    return family || null;
  }
  // The light half of src/lib/brand.ts's derivation, for the one widget that
  // is not framed: a button is painted here, on the host page, so the rule
  // that darkens a pale colour until white reads on it (4.5:1) has to run here
  // too — Settings promises it ("the button darkens itself"), and a framed
  // widget gets it from the server. Same arithmetic, same 8% steps, same cap.
  function luminance(hex) {
    const channel = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const n = Number.parseInt(hex.slice(1), 16);
    return (
      0.2126 * channel((n >> 16) & 255) +
      0.7152 * channel((n >> 8) & 255) +
      0.0722 * channel(n & 255)
    );
  }
  function contrastOnWhite(hex) {
    return 1.05 / (luminance(hex) + 0.05);
  }
  function darken(hex, amount) {
    const n = Number.parseInt(hex.slice(1), 16);
    const part = (v) => `0${Math.round(v * (1 - amount)).toString(16)}`.slice(-2);
    return `#${part((n >> 16) & 255)}${part((n >> 8) & 255)}${part(n & 255)}`;
  }
  function readableFill(hex) {
    let fill = hex;
    for (let step = 0; step < 12 && contrastOnWhite(fill) < 4.5; step++) {
      fill = darken(fill, 0.08);
    }
    return fill;
  }
  function frameUrl(el, kind) {
    const slug = el.getAttribute("data-shop") || "";
    const url = new URL(kind === "calendar" ? `/s/${slug}` : `/s/${slug}/embed/${kind}`, origin);
    if (kind === "calendar") url.searchParams.set("embed", "1");
    // A trip id on "departure", a course slug on "courses" (issue #1284) —
    // told apart by the kind, never by the value. Kept as a list rather than
    // an equality so the mirror in src/lib/embed-snippets.ts (SHOWS_ONE) has
    // an obvious counterpart here; src/lib/embed-loader.test.ts runs this file
    // against a host page and pins both.
    const show = el.getAttribute("data-show");
    if (show && (kind === "departure" || kind === "courses")) url.searchParams.set("show", show);
    // A named list on the two widgets that render many things (issue #1284).
    // Its own attribute, never a second meaning for `data-show`: both values
    // are opaque strings, so one name could not be read as either. The mirror
    // is SHOWS_SET in src/lib/embed-snippets.ts, and embed-loader.test.ts runs
    // this file against a host page to pin the pair.
    const set = el.getAttribute("data-set");
    if (set && (kind === "grid" || kind === "courses")) url.searchParams.set("set", set);
    const lang = el.getAttribute("data-lang");
    if (lang && lang !== "auto") url.searchParams.set("lang", lang);
    if ((el.getAttribute("data-look") || "site") === "site") {
      const brand = hostBrand(el);
      const font = hostFont(el);
      if (brand) url.searchParams.set("brand", brand);
      if (font) url.searchParams.set("font", font);
    }
    // The host page carries the credit (below), so the frame drops its own:
    // one line per widget, never two.
    url.searchParams.set("credit", "host");
    return url.toString();
  }
  function frame(el, kind) {
    const iframe = document.createElement("iframe");
    iframe.src = frameUrl(el, kind);
    iframe.title = el.getAttribute("data-title") || "DiveDay";
    iframe.loading = "lazy";
    iframe.setAttribute("data-diveday-frame", kind);
    iframe.style.cssText =
      "width:100%;max-width:100%;border:0;display:block;height:" +
      (kind === "calendar" ? "1250px" : "480px");
    el.appendChild(iframe);
    // The crawlable credit, on the host page itself: a search engine folds no
    // iframe into the page it sits in, so the link outside the frame is the
    // one that counts as the shop's — and the frame, told so, draws none.
    const credit = document.createElement("a");
    const creditUrl = new URL("/", origin);
    creditUrl.searchParams.set("utm_source", "embed");
    creditUrl.searchParams.set("utm_medium", "widget");
    creditUrl.searchParams.set("utm_campaign", el.getAttribute("data-shop") || "");
    credit.href = creditUrl.toString();
    credit.target = "_blank";
    credit.rel = "noopener";
    credit.textContent = el.getAttribute("data-credit") || "Powered by DiveDay";
    credit.style.cssText =
      "display:block;margin-top:6px;font:12px/1.4 inherit;color:#5b6f77;text-decoration:none";
    el.appendChild(credit);
    return iframe;
  }
  function styleButton(el) {
    let fill = DIVEDAY_LAGOON;
    if ((el.getAttribute("data-look") || "site") === "site") {
      const brand = hostBrand(el);
      if (brand) fill = readableFill(brand);
    }
    el.style.background = fill;
    el.style.color = "#fff";
    el.style.cssText +=
      ";display:inline-block;padding:12px 24px;font:600 15px/1 inherit;text-decoration:none;border-radius:10px";
  }
  function lightbox(el) {
    styleButton(el);
    el.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      const scrim = document.createElement("div");
      scrim.setAttribute("data-diveday-lightbox", "");
      scrim.style.cssText =
        "position:fixed;inset:0;z-index:2147483000;background:rgba(12,42,53,.55);display:flex;align-items:flex-end;justify-content:center;padding:0";
      const sheet = document.createElement("div");
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-modal", "true");
      sheet.setAttribute("aria-label", el.textContent || "DiveDay");
      // `dvh` where the browser has it, so a phone's own chrome never hides
      // the bottom of the sheet; the `vh` line stays for the ones that do not.
      sheet.style.cssText =
        "position:relative;width:100%;max-width:720px;height:min(92vh,900px);height:min(92dvh,900px);background:#fff;border-radius:18px 18px 0 0;overflow:hidden";
      const close = document.createElement("button");
      close.type = "button";
      close.setAttribute("aria-label", "Close");
      close.textContent = "×";
      close.style.cssText =
        "position:absolute;top:8px;right:8px;width:44px;height:44px;border:0;border-radius:999px;background:rgba(12,42,53,.08);font:24px/1 system-ui,sans-serif;cursor:pointer;z-index:1";
      const iframe = document.createElement("iframe");
      const href = new URL(el.getAttribute("href"), origin);
      href.searchParams.set("embed", "1");
      const lang = el.getAttribute("data-lang");
      if (lang && lang !== "auto") href.searchParams.set("lang", lang);
      if ((el.getAttribute("data-look") || "site") === "site") {
        const brand = hostBrand(el);
        const font = hostFont(el);
        if (brand) href.searchParams.set("brand", brand);
        if (font) href.searchParams.set("font", font);
      }
      iframe.src = href.toString();
      iframe.title = el.textContent || "DiveDay";
      iframe.style.cssText = "width:100%;height:100%;border:0;display:block";
      // The host page holds still under the sheet, and Tab stays inside it:
      // the close button and the frame are the sheet's two stops.
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      function dismiss() {
        scrim.remove();
        document.removeEventListener("keydown", onKey);
        document.body.style.overflow = previousOverflow;
        el.focus();
      }
      function onKey(e) {
        if (e.key === "Escape") {
          dismiss();
          return;
        }
        if (e.key !== "Tab") return;
        const stops = [close, iframe];
        const index = stops.indexOf(document.activeElement);
        if (e.shiftKey && (index === 0 || index === -1)) {
          e.preventDefault();
          iframe.focus();
        } else if (!e.shiftKey && (index === stops.length - 1 || index === -1)) {
          e.preventDefault();
          close.focus();
        }
      }
      close.addEventListener("click", dismiss);
      scrim.addEventListener("click", (e) => {
        if (e.target === scrim) dismiss();
      });
      document.addEventListener("keydown", onKey);
      sheet.appendChild(close);
      sheet.appendChild(iframe);
      scrim.appendChild(sheet);
      document.body.appendChild(scrim);
      close.focus();
    });
  }
  function mount(el) {
    if (mounted.has(el)) return;
    mounted.add(el);
    const kind = el.getAttribute("data-diveday");
    if (kind === "button") styleButton(el);
    else if (kind === "lightbox") lightbox(el);
    else if (kind === "calendar" || kind === "grid" || kind === "departure" || kind === "courses")
      frame(el, kind);
  }
  function mountAll() {
    const nodes = document.querySelectorAll("[data-diveday]");
    for (let i = 0; i < nodes.length; i++) mount(nodes[i]);
  }
  // A framed widget reports its own height, so the frame never scrolls inside
  // the shop's page. Only our own origin is believed.
  window.addEventListener("message", (event) => {
    if (event.origin !== origin || !event.data || event.data.type !== "diveday:height") return;
    const frames = document.querySelectorAll("iframe[data-diveday-frame]");
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === event.source) {
        frames[i].style.height =
          `${Math.max(120, Math.min(4000, Number(event.data.height) || 0))}px`;
      }
    }
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAll);
  else mountAll();
})();
