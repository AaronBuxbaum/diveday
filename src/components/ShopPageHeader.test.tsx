// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  EYEBROW_CLASS,
  EYEBROW_TAP_WRAPPER,
  EyebrowBackLink,
  ShopNotice,
  ShopPageHeader,
  ShopPageHeaderSkeleton,
  ShopStat,
} from "./ShopPageHeader";

afterEach(cleanup);

describe("ShopPageHeader's title", () => {
  it("keeps a trip title's em dash off the start of a line", () => {
    // The title rung balances its wrap, and balancing broke at the space
    // before the dash on the public trip page at 390 (K-117).
    render(<ShopPageHeader title="Two-Tank Reef — Benwood & Elbow" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Two-Tank Reef\u00A0— Benwood & Elbow",
    );
  });
});

/**
 * **The title never gives up a word to its doors** (pixel-craft class 2). The
 * row was a flex row with a `shrink-0` actions band, so the title column took
 * every pixel the doors did not: at 640 the schedule board's three doors left
 * "Board" 103.6px for a word that needs 106, and the word ran past its column.
 * With doors, the row is a grid whose title track is at least its longest word
 * (`minmax(min-content, 1fr)`) and whose doors' track is `auto`: the doors keep
 * their one row while there is room, the title wraps first as it always did,
 * and only then do the doors fold onto a second row. jsdom has no layout, so
 * the template is the assertion.
 */
describe("the header's row", () => {
  const row = (container: HTMLElement) =>
    container.querySelector("header")?.firstElementChild as HTMLElement;

  it("keeps the title's longest word whole, folding the doors first", () => {
    const { container } = render(
      <ShopPageHeader title="Board" actions={<a href="/shop/x/schedule">View public page</a>} />,
    );
    expect(row(container)).toHaveClass("sm:grid", "sm:grid-cols-[minmax(min-content,1fr)_auto]");
  });

  it("stays a flex row when there are no doors to leave a track for", () => {
    const { container } = render(<ShopPageHeader title="Board" />);
    expect(row(container)).toHaveClass("sm:flex-row");
    expect(row(container).className).not.toMatch(/grid-cols/);
  });
});

/**
 * **One number, in three places, that nothing else checks.**
 *
 * The header's eyebrow is 16px of line box. A page that links its eyebrow
 * somewhere renders `EyebrowBackLink` instead of a `<p>`, and that link has to
 * be 44px for WCAG 2.5.8 — so it is wrapped in a box the eyebrow's own height
 * and allowed to bleed out of it. `ShopPageHeaderSkeleton` stands a bar in for
 * whichever one the page uses, and it can only stand in for both while all
 * three agree.
 *
 * They did not agree, and nothing said so: the margin that was supposed to
 * reconcile them sat on an `inline-flex` box, whose vertical margins do not
 * move the line box it sits on, so the linked eyebrow occupied 28px against a
 * plain one's 16. Every sub-page with a back-link jumped its title 12px on
 * arrival (issue #1857). jsdom has no layout engine and cannot catch that by
 * measuring, so this pins the classes the measurement came down to — and pins
 * them *against each other*, because three constants that are equal by
 * coincidence go out of step the first time one of them moves.
 */
const heightOf = (classes: string, prefix: string) => {
  const match = classes.match(new RegExp(`(?:^|\\s)${prefix}-(\\d+(?:\\.\\d+)?)(?:\\s|$)`));
  if (!match) throw new Error(`no \`${prefix}-*\` in "${classes}"`);
  // Tailwind's numeric scale is quarter-rem: `h-4` is 1rem is 16px.
  return Number(match[1]) * 4;
};

describe("the eyebrow's line box", () => {
  it("is the same height in the plain eyebrow, the linked one's wrapper, and the skeleton's bar", () => {
    const { container } = render(<ShopPageHeaderSkeleton />);
    // The eyebrow's bar is the first of the three the skeleton stands up.
    const bar = container.firstElementChild?.firstElementChild;
    if (!bar) throw new Error("the skeleton rendered no bars");

    const lineBox = heightOf(EYEBROW_CLASS, "leading");
    expect(lineBox, "EYEBROW_CLASS stopped pinning its line box").toBe(16);
    expect(heightOf(EYEBROW_TAP_WRAPPER, "h"), "the linked eyebrow's wrapper").toBe(lineBox);
    expect(heightOf(bar.className, "h"), "the skeleton's eyebrow bar").toBe(lineBox);
  });

  it("keeps the linked eyebrow's own box over the 24px WCAG floor, which is why it needs a wrapper", () => {
    render(<EyebrowBackLink href="/shop/blue-mantis/settings">Settings</EyebrowBackLink>);
    const link = screen.getByRole("link", { name: "Settings" });
    // `min-h-11` is 44px. Were it ever dropped to fit the line box, the link
    // would fit its wrapper and axe's `target-size` would start failing — the
    // opposite trade from the one this design makes.
    expect(heightOf(link.className, "min-h")).toBeGreaterThanOrEqual(24);
  });

  /**
   * **The wrapper is the element the caller lays out.** `TripPageHeader` places
   * its back link with `col-start-1 row-start-1`, and the log and ticket pages
   * hide theirs with `print:hidden` so a print-only `<p>` can take the line.
   * Introducing the wrapper put those on the nested link, where grid placement
   * does nothing and `print:hidden` leaves a 16px band of nothing on paper
   * (`sourcery-ai` on #1943). Colour is the exception, and already has `onSky`.
   */
  it("gives the caller's layout classes to the wrapper, which is what the parent lays out", () => {
    render(
      <EyebrowBackLink
        href="/shop/blue-mantis/trips/1"
        className="col-start-1 row-start-1 print:hidden"
      >
        Board
      </EyebrowBackLink>,
    );
    const link = screen.getByRole("link", { name: "Board" });
    const wrapper = link.parentElement;
    for (const cls of ["col-start-1", "row-start-1", "print:hidden"]) {
      expect(wrapper?.className, `wrapper is missing ${cls}`).toContain(cls);
      expect(link.className, `link should not carry ${cls}`).not.toContain(cls);
    }
  });

  /**
   * **The target spills upward, never onto the title.** Centred on its 16px
   * line, the 44px box hung 14px below it, and the title sits only `mt-2`
   * (8px) under the eyebrow: the box already overlapped the `<h1>`'s line
   * box, and the focus ring 5px outside it drew a 3px band straight through
   * the title's cap tops (K-395, measured on `/dive/[region]` at both
   * widths). Bottom-aligned, the box sits 28px above the line and none below
   * it, so the ring ends 5px under the eyebrow, inside the title's `mt-2`.
   */
  it("bleeds its 44px box upward, so the focus ring ends before the title starts", () => {
    render(<EyebrowBackLink href="/shop/blue-mantis/settings">Settings</EyebrowBackLink>);
    const link = screen.getByRole("link", { name: "Settings" });
    const wrapper = link.parentElement;

    // The wrapper stands the box on the line's bottom edge…
    expect(wrapper).toHaveClass("flex", "h-4", "items-end");
    expect(wrapper).not.toHaveClass("items-center");
    // …and the link keeps its words on that edge too, so they stay on the
    // line a `<p>` eyebrow's would, with the whole spare 28px above them.
    expect(link).toHaveClass("inline-flex", "min-h-11", "items-end");
    expect(link).not.toHaveClass("items-center");
  });

  it("wraps the link rather than giving it a margin, because an inline box's margins do not move a line box", () => {
    const { container } = render(
      <EyebrowBackLink href="/shop/blue-mantis/settings">Settings</EyebrowBackLink>,
    );
    const link = screen.getByRole("link", { name: "Settings" });
    // No caller class here, so the wrapper is exactly the constant.
    expect(link.parentElement?.className).toBe(EYEBROW_TAP_WRAPPER);
    expect(container.firstElementChild).toBe(link.parentElement);
    // The paired negative: no vertical margin anywhere on the link. One left
    // behind would silently re-open the gap this closed, and would read as
    // deliberate to whoever found it next.
    expect(link.className).not.toMatch(/(?:^|\s)-?my-/);
  });
});

/**
 * **The mark opens the notice's first line; it is not a line of its own.**
 *
 * The notice used to be a block holding `<StatusMark className="me-1" />` and
 * then its words. Preflight makes every `svg` a block, so the mark stood alone
 * on a line above the sentence it marks, its `me-1` spacing it from nothing:
 * 16px of every toned notice spent on a lone glyph, on orders, check-in, the
 * trip packet and the rest (K-15).
 *
 * The root is a row. The words keep their own block in the second column, so
 * a notice holding a heading, a paragraph and a list still stacks them. The
 * row aligns on the first baseline, not the top, because not every notice's
 * first line starts at its top: the trip banner's words sit centred beside a
 * 44px Undo, and the duplicate-diver warning opens on a 16px heading. So the
 * mark's column holds one line of the notice's own text — a box `h-lh` tall
 * with the mark centred in it — and that line's baseline is the one the row
 * lines up with the words' first line, wherever that line is.
 */
/**
 * **The chevron's box is its ink**, so the way back starts on the title's
 * column rather than 4px inside it.
 *
 * It was drawn centred in a 24-unit square at `size-3`: the stroke spans x 9
 * to 15 plus half its width, so the ink began 3.9px into the box, and every
 * back-linked header's chevron stood 3–4px right of the `<h1>`, description
 * and card edge below it (K-114, measured on 31 captures). The viewBox is cut
 * to the stroke horizontally and kept whole vertically, so the chevron's
 * height and centre do not move; it is sized by its height, and its width
 * follows the cropped box.
 */
describe("the back-link chevron", () => {
  function chevron() {
    render(<EyebrowBackLink href="/shop/blue-mantis/settings">Settings</EyebrowBackLink>);
    const svg = screen.getByRole("link", { name: "Settings" }).querySelector("svg");
    if (!svg) throw new Error("no chevron");
    return svg;
  }

  it("crops its viewBox to the stroke, so the ink starts on the box's edge", () => {
    const svg = chevron();
    const d = svg.querySelector("path")?.getAttribute("d") ?? "";
    const stroke = Number(svg.getAttribute("stroke-width"));
    // `m x y dx dy dx dy …`: one absolute point, then relative steps.
    const [x0, , ...steps] = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const xs = [x0];
    for (let i = 0; i < steps.length; i += 2) xs.push(xs[xs.length - 1] + steps[i]);
    const left = Math.min(...xs) - stroke / 2;
    const width = Math.max(...xs) - Math.min(...xs) + stroke;

    expect(svg.getAttribute("viewBox")).toBe(`${left} 0 ${width} 24`);
  });

  it("is sized by its height, the old square's, so it neither grows nor moves up or down", () => {
    const svg = chevron();
    expect(svg).toHaveClass("h-3", "w-auto", "shrink-0");
    expect(svg).not.toHaveClass("size-3");
  });

  it("keeps the words as far from the ink as they were", () => {
    // The square carried 3.9px of empty box on the chevron's right as well;
    // `gap-1` plus that was about 8px of ink-to-text. With the box cut to the
    // ink the gap has to carry all of it.
    const link = chevron().closest("a");
    expect(link).toHaveClass("gap-2");
    expect(link).not.toHaveClass("gap-1");
  });
});

/**
 * **Below `sm` the header's doors share the band; what is not a door keeps
 * its own width.** Two buttons stretched to equal halves read as one tidy
 * row. But the rule grew *every* child, and the offline manifest passes two
 * status pills as its actions: at 390px each became a half-width bar with its
 * words hugging the left and 91px of empty fill on the right (K-65).
 */
describe("the header's actions below sm", () => {
  it("grow only the links, buttons and forms, never a status pill", () => {
    render(
      <ShopPageHeader
        title="Roll call"
        actions={
          <>
            <a href="/shop/blue-mantis/orders/new">New order</a>
            <span>Offline</span>
          </>
        }
      />,
    );
    const band = screen.getByRole("link", { name: "New order" }).parentElement;
    const classes = band?.className.split(/\s+/) ?? [];
    expect(classes).toContain("max-sm:[&>:is(a,button,form)]:grow");
    expect(classes).not.toContain("max-sm:[&>*]:grow");
  });
});

/**
 * **A row of stat tiles puts every figure on one line, whatever its label
 * wraps to.**
 *
 * The tile stacked its label and its figure in block flow, so a label that
 * wrapped ("Divers on the / manifest") pushed its own figure 20px below the
 * figures beside it — on the departure log an insurer is handed, in print too
 * (K-75). The ledger proposed `flex-col` with the figure `mt-auto`, which
 * aligns figures only when every tile carries the same lines *under* them:
 * the blowout record's first tile has no detail line and its two neighbours
 * do, so its figure would have dropped to the bottom instead.
 *
 * So the tile subgrids onto two rows of the grid it stands in — labels, then
 * figures — the same mechanism `Field` uses for captions over controls
 * (`ui/form.tsx`). The label row is as tall as the row's longest label, and
 * every figure starts where that row ends. The gap the figure's `mt-*` used to
 * give is the subgrid's own row gap.
 */
describe("ShopStat's figure", () => {
  it("stands on a row shared with its neighbours, not under its own label", () => {
    const { container } = render(
      <ShopStat label="Divers on the manifest" value={12} detail="All accounted for" />,
    );
    const tile = container.firstElementChild;
    expect(tile).toHaveClass("grid", "row-span-2", "grid-rows-subgrid", "gap-y-2");

    // Exactly two children, one per row: the label, and everything under it.
    const [label, figureRow] = Array.from(tile?.children ?? []);
    expect(tile?.children).toHaveLength(2);
    expect(label.textContent).toBe("Divers on the manifest");
    const figure = figureRow.firstElementChild;
    expect(figure?.textContent).toBe("12");
    expect(figure?.className).not.toMatch(/(?:^|\s)mt-/);
    // The detail line rides in the figure's row, so it cannot open a third.
    expect(figureRow.textContent).toContain("All accounted for");
  });

  it("keeps the inset tile's tighter gap as its row gap", () => {
    const { container } = render(<ShopStat label="Skipped" value={3} variant="inset" />);
    const tile = container.firstElementChild;
    expect(tile).toHaveClass("grid", "row-span-2", "grid-rows-subgrid", "gap-y-0.5");
    expect(tile?.innerHTML).not.toMatch(/\bmt-0\.5\b/);
  });

  it("puts the <dt> and the <dd> on the two rows in a definition list", () => {
    const { container } = render(
      <dl>
        <ShopStat definition label="Recorded not boarded" value={0} />
      </dl>,
    );
    const tile = container.querySelector("dl > div");
    expect(Array.from(tile?.children ?? []).map((child) => child.tagName)).toEqual(["DT", "DD"]);
    expect(tile?.querySelector("dd")?.className).not.toMatch(/(?:^|\s)mt-/);
  });
});

describe("ShopNotice's mark", () => {
  it("sits beside the first line of the words rather than on a line above them", () => {
    render(
      <ShopNotice tone="danger" role="alert">
        <p>Two refunds are owed.</p>
        <ul>
          <li>Ana Silva</li>
        </ul>
      </ShopNotice>,
    );
    const notice = screen.getByRole("alert");
    expect(notice).toHaveClass("flex", "items-baseline", "gap-2");

    const [markColumn, words] = Array.from(notice.children);
    // A block (a flex item) holding a one-line inline box: a real line, so a
    // real baseline for the row to align.
    expect(markColumn).toHaveClass("shrink-0");
    const lineBox = markColumn.firstElementChild;
    expect(lineBox).toHaveClass("inline-flex", "h-lh", "items-center", "align-top");
    expect(lineBox?.querySelector("svg")).not.toBeNull();

    expect(words).toHaveClass("min-w-0", "flex-1");
    expect(words.firstElementChild?.textContent).toBe("Two refunds are owed.");
    // The spacing belongs to the row's gap now; a margin on the mark is the
    // one that never worked.
    expect(notice.innerHTML).not.toMatch(/\bme-1\b/);
  });

  it("gives an untoned notice the same column for its words and no mark at all", () => {
    render(<ShopNotice tone="neutral">The demo was reset.</ShopNotice>);
    const notice = screen.getByRole("status");

    expect(notice.querySelector("svg")).toBeNull();
    expect(notice.children).toHaveLength(1);
    expect(notice.firstElementChild).toHaveClass("min-w-0", "flex-1");
  });
});
