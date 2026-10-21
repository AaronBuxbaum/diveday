import { buildIndex, isPainted, isVisible, visualLeft } from "./analyze.mjs";

const has = (el, classes) => {
  const tokens = new Set(String(el?.cls || "").split(/\s+/));
  return classes.split(" ").every((token) => tokens.has(token));
};
const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.1;
const round1 = (value) => Math.round(value * 10) / 10;

/**
 * Evidence for the two structures dismissed in #2887, not another analyzer.
 * The original flags stay intact. Old records without this evidence cannot
 * claim these settlements; a new capture must prove the structure again.
 */
export function settlementContextFor(snapshot) {
  const ix = buildIndex(snapshot);
  const kids = (el) => (ix.kids[el?.i] || []).map((i) => ix.els[i]);
  const context = { version: 1, conditionsLine: [], certCheckSteps: [] };
  if (snapshot.truncated) return context;

  for (const line of ix.els) {
    if (
      line.tag !== "p" ||
      !isVisible(line) ||
      !has(line, "overflow-x-clip text-sm text-muted") ||
      line.ovx !== "clip" ||
      !line.clipsX ||
      ix.els[line.p]?.tag !== "section" ||
      !has(ix.els[line.p], "border-t border-border pt-4 px-2")
    )
      continue;
    const [run, ...extra] = kids(line);
    if (
      extra.length ||
      run?.tag !== "span" ||
      !has(run, "-ms-3 flex flex-wrap items-baseline gap-x-2") ||
      !near(run.x, line.x - 12) ||
      run.disp !== "flex" ||
      run.fw !== "wrap"
    )
      continue;
    const readings = kids(run);
    if (
      !readings.length ||
      !readings.every((reading) => {
        const [dot, words, ...rest] = kids(reading);
        return (
          reading.tag === "span" &&
          has(reading, "inline-flex items-baseline gap-x-2") &&
          !rest.length &&
          dot?.tag === "span" &&
          has(dot, "w-1 text-center") &&
          dot.ariaHidden &&
          near(dot.w, 4) &&
          words?.tag === "span" &&
          near(words.x - dot.x, 12) &&
          words.x >= line.x - 0.1
        );
      })
    )
      continue;

    // K-483 clips only the leading separator. Representing that verified
    // subtree by its clip edge must remove the entire measured propagation.
    // A second, visible stray elsewhere in an ancestor still wins the minimum
    // and therefore cannot inherit this settlement.
    const clipped = buildIndex({
      ...snapshot,
      elements: ix.els.map((el) => (el.i === line.i ? { ...el, replaced: true } : el)),
    });
    for (let candidate = line; candidate; candidate = ix.els[candidate.p]) {
      const parent = ix.els[candidate.p];
      const publicRegion =
        candidate.id === "public-shop-main-content" &&
        parent?.id === "main-content" &&
        has(candidate, "flex flex-1 flex-col outline-none") &&
        has(parent, "flex flex-col outline-none");
      const wrapper =
        candidate.tag === "div" &&
        !isPainted(candidate) &&
        !candidate.clipsX &&
        (publicRegion || (!candidate.cls && has(parent, "space-y-10 lg:contents lg:space-y-0")));
      if (candidate !== line && !wrapper) continue;
      const clippedLeft = visualLeft(clipped, clipped.els[candidate.i]);
      // At the exact public skip region, the probe's six-level cutoff lands
      // on a disclosure rule's -mx-2 box after the separator is clipped.
      // Six more levels reach its inset content. This evidence-only proof
      // requires the observed 8px rule edge and raw -12px separator edge;
      // any second visible stray still prevents a return to the column.
      const clippedColumn =
        near(clippedLeft, line.x) ||
        (publicRegion &&
          near(clippedLeft, line.x - 8) &&
          near(visualLeft(ix, candidate, new Map(), -6), line.x - 12) &&
          near(visualLeft(clipped, clipped.els[candidate.i], new Map(), -6), line.x));
      if (near(visualLeft(ix, candidate), line.x - 12) && clippedColumn)
        context.conditionsLine.push({ el: candidate.i, mode: round1(line.x) });
    }
  }

  const statusIcon = (body) => {
    const badge = kids(body).find(
      (el) =>
        el.tag === "span" &&
        has(el, "inline-flex items-baseline rounded-full gap-1 px-3 py-1 text-sm"),
    );
    const icon = kids(badge).find(
      (el) =>
        el.tag === "svg" &&
        has(el, "size-4 shrink-0 self-center") &&
        near(el.w, 16) &&
        near(el.h, 16),
    );
    return icon && near(icon.x - badge.x, 12) ? icon : null;
  };
  for (const list of ix.els) {
    if (list.tag !== "ol" || !isVisible(list) || !has(list, "mt-4 divide-y divide-border"))
      continue;
    const steps = kids(list);
    if (
      steps.length !== 4 ||
      !steps.every(
        (step) =>
          step.tag === "li" &&
          step.disp === "grid" &&
          has(step, "grid grid-cols-[2rem_1fr] gap-x-3 py-4"),
      )
    )
      continue;
    const bodies = steps.map((step) => {
      const [number, content, ...rest] = kids(step);
      const [heading, body, ...after] = kids(content);
      return !rest.length &&
        has(number, "font-semibold tabular-nums text-muted") &&
        content?.tag === "div" &&
        has(content, "min-w-0") &&
        heading?.tag === "h2" &&
        has(heading, "text-base font-semibold") &&
        !after.length &&
        body?.tag === "div" &&
        has(body, "mt-2 text-sm")
        ? body
        : null;
    });
    if (bodies.some((body) => !body) || !bodies.every((body) => near(body.x, bodies[0].x)))
      continue;
    const [samples, ...extra] = kids(bodies[1]);
    if (extra.length || samples?.tag !== "ul" || !has(samples, "space-y-2")) continue;
    const rows = kids(samples);
    if (
      !rows.length ||
      !rows.every(
        (row) =>
          row.tag === "li" &&
          has(row, "flex flex-wrap items-center gap-x-3 gap-y-1") &&
          has(kids(row)[0], "min-w-16 font-medium"),
      )
    )
      continue;
    const icons = [statusIcon(bodies[0]), statusIcon(rows[0]), statusIcon(bodies[2])];
    if (
      icons.some((icon) => !icon) ||
      !near(icons[1].x - icons[0].x, 76) ||
      !near(icons[2].x, icons[0].x)
    )
      continue;
    context.certCheckSteps.push({ el: icons[0].i, xs: icons.map((icon) => round1(icon.x)) });
  }
  return context;
}
