/* Paste this entire file into Safari Web Inspector's Console for the affected
 * Chrome-on-iOS tab, then tap More once within 10 seconds. The trace stays in
 * this console; it does not read URLs, page text or send data. Compare the
 * final geometry and hit test with what is actually painted on the phone.
 */
(() => {
  const navSelector = "[data-staff-tabbar]";
  const ids = new WeakMap();
  let nextId = 1;
  const id = (node) => {
    if (!node) return null;
    if (!ids.has(node)) ids.set(node, nextId++);
    return ids.get(node);
  };
  const find = () => {
    const nav = document.querySelector(navSelector);
    const button = nav?.querySelector("button[aria-expanded]");
    return {
      nav,
      button,
      root: button?.parentElement,
      panel: button?.parentElement?.querySelector("ul"),
    };
  };
  const rect = (node) => {
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const style = (node) => {
    if (!node) return null;
    const s = window.getComputedStyle(node);
    return {
      display: s.display,
      visibility: s.visibility,
      opacity: s.opacity,
      transform: s.transform,
      overflowX: s.overflowX,
      overflowY: s.overflowY,
    };
  };
  const records = [];
  let dropped = 0;
  let stopped = false;
  const record = (kind, extra = {}) => {
    if (stopped) return;
    if (records.length >= 39 && kind !== "end") {
      dropped++;
      return;
    }
    const { nav, button, root, panel } = find();
    const r = panel?.getBoundingClientRect();
    const hit = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const expandedValue = button?.getAttribute("aria-expanded");
    const expanded = ["true", "false"].includes(expandedValue) ? expandedValue : null;
    records.push({
      kind,
      elapsedMs: Math.round(window.performance.now() - start),
      navId: id(nav),
      buttonId: id(button),
      rootId: id(root),
      panelId: id(panel),
      expanded,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      navRect: rect(nav),
      panelRect: rect(panel),
      navStyle: style(nav),
      panelStyle: style(panel),
      centerHitsPanel: panel && hit ? panel.contains(hit) : null,
      ...extra,
    });
  };
  const start = window.performance.now();
  let lastNav = find().nav;
  let lastButton = find().button;
  const onPointer = (event) => {
    const { root } = find();
    const pointerType = ["touch", "mouse", "pen"].includes(event.pointerType)
      ? event.pointerType
      : "unknown";
    record("pointerdown", { pointerType, inside: !!root?.contains(event.target) });
  };
  const onClick = (event) => {
    const { root } = find();
    record("click", { inside: !!root?.contains(event.target) });
    window.requestAnimationFrame(() => record("after-click-frame"));
    window.setTimeout(() => record("after-click-settled"), 600);
  };
  const onResize = () => record("resize");
  const onAnimationEnd = (event) => {
    if (event.target === find().panel) record("animation-end");
  };
  const observer = new MutationObserver((changes) => {
    for (const change of changes) {
      const { nav, button, root } = find();
      if (nav !== lastNav || button !== lastButton) {
        lastNav = nav;
        lastButton = button;
        record("remount");
      }
      if (change.type === "attributes" && change.target === button) {
        const previousExpanded = ["true", "false"].includes(change.oldValue)
          ? change.oldValue
          : null;
        record("expanded-change", { previousExpanded });
      } else if (change.type === "childList") {
        if (
          change.target === nav ||
          root?.contains(change.target) ||
          change.target === document.body
        )
          record("tree-change");
      }
    }
  });
  document.addEventListener("pointerdown", onPointer, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("animationend", onAnimationEnd, true);
  window.addEventListener("resize", onResize);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-expanded"],
    attributeOldValue: true,
  });
  record("start");
  window.setTimeout(() => {
    record("end");
    stopped = true;
    observer.disconnect();
    document.removeEventListener("pointerdown", onPointer, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("animationend", onAnimationEnd, true);
    window.removeEventListener("resize", onResize);
    console.log("More local trace", JSON.stringify({ records, dropped }));
  }, 10000);
})();
