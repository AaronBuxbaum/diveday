// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tapTargetLinkClass } from "@/components/ui/button";

// The demo door is a Server Action; rendering the pair needs only its
// reference, not the session and database behind it.
vi.mock("@/app/actions/demo", () => ({ enterDemoAction: vi.fn() }));

const {
  ClosingCta,
  DividedList,
  GUIDE_BAND_CLASS,
  GUIDE_BAND_LEDE_CLASS,
  GuideBodySkeleton,
  GuideContext,
  GuideHero,
  MovePath,
  MovePhase,
  SourcesFootnote,
} = await import("./guide");

afterEach(cleanup);

const TAP_TARGET = tapTargetLinkClass.split(" ");

/**
 * **The external-link arrow travels with the last word** (K-232).
 *
 * The footnote rendered `{label} ↗` with an ordinary space, so on a phone a
 * label that filled its first line put the 8px arrow alone on a second: the
 * pixel probe found six such lines across the EVE, FareHarbor and Rezdy
 * guides at 390.
 */
describe("the sources footnote", () => {
  it("glues the arrow to the label with a no-break space", () => {
    render(
      <SourcesFootnote
        locale="en-US"
        sources={[
          { label: "FareHarbor Help — downloading a manifest", url: "https://example.com" },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: /downloading a manifest/ });
    expect(link.textContent).toBe("FareHarbor Help — downloading a manifest\u00A0↗");
  });

  it("runs its links as 44px targets at a 44px pitch", () => {
    render(
      <SourcesFootnote
        locale="en-US"
        sources={[
          { label: "EVE — exporting a report", url: "https://example.com/a" },
          { label: "EVE — the customer list", url: "https://example.com/b" },
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveClass(...TAP_TARGET);
    // The targets are the spacing: a gap on top of them would open the list
    // past the 44px each row already is.
    expect(links[0].closest("ul")?.className).not.toMatch(/(?:^|\s)(?:gap|space-y)-(?!0\b)/);
  });
});

/**
 * **The guide's own text links are 44px targets** (K-192).
 *
 * The pixel probe measured "← All switching guides" at 147.9×17 and "Other
 * switching guides →" at 168.8×20 on every guide at 390: text-height words,
 * a third of the floor (principles.md §2).
 */
describe("the guide's back links", () => {
  it("gives the hero's back link a 44px target on a line its text's height", () => {
    render(<GuideHero locale="en-US" source="switching-eve" eyebrow="E" title="T" lede="L" />);
    const link = screen.getByRole("link", { name: "← All switching guides" });
    expect(link).toHaveClass(...TAP_TARGET);
    // The line keeps the 14px text's own 20px, so the eyebrow below does not
    // move; the target bleeds 12px either side into the hero's padding and the
    // eyebrow's `mt-6`, clear of both.
    expect(link.parentElement).toHaveClass("flex", "h-5", "items-center");
  });

  it("gives the closing band's way back a 44px target", () => {
    renderClosing();
    expect(screen.getByRole("link", { name: "Other switching guides →" })).toHaveClass(
      ...TAP_TARGET,
    );
  });
});

function renderClosing() {
  return render(
    <ClosingCta
      locale="en-US"
      source="switching-eve-close"
      title="Ready?"
      body="Walk the demo first."
      backLabel="Other switching guides →"
    />,
  );
}

/**
 * **One rule at every band join, the concierge's included** (K-200).
 *
 * The closing band always follows `SwitchingConcierge`, and both were bare
 * `py-16 lg:py-20` boxes, so the two paddings stacked into 164px of nothing
 * under the concierge panel (135 at 390) where every other join on the page is
 * 80 | rule | 80. The band is now full-bleed and ruled on top, the shape
 * `SourcesFootnote` and `MovePath` have.
 */
describe("the closing band", () => {
  it("is a full-bleed section ruled on top, holding the column's box", () => {
    const { container } = renderClosing();
    const band = container.firstElementChild;
    expect(band?.tagName).toBe("SECTION");
    expect(band).toHaveClass("border-t", "border-border");
    expect(band?.className).not.toMatch(/max-w-|(?:^|\s)p[xy]?-/);
    expect(band?.firstElementChild).toHaveClass(
      "mx-auto",
      "max-w-4xl",
      "px-6",
      "py-16",
      "lg:py-20",
    );
  });
});

function renderContext() {
  return render(<GuideContext locale="en-US" paragraphs={["EVE ran the back office."]} />);
}

/**
 * **The mid-page card sits between two rules** (K-204).
 *
 * On the leave-it guides and the spreadsheet guide nothing ruled the "you are
 * here" band off from the demo card under it, so the band's bottom padding and
 * the card's top padding stacked: 144px above the card at 1280 (169 on the
 * spreadsheet guide) against 64 below it. The band is now full-bleed and ruled
 * below, as the hero is, so the card sits 64 | card | 64 between rules.
 */
describe("the you-are-here band", () => {
  it("is a full-bleed section ruled below, holding the column's box", () => {
    const { container } = renderContext();
    const band = container.firstElementChild;
    expect(band?.tagName).toBe("SECTION");
    expect(band).toHaveClass("border-b", "border-border");
    expect(band?.className).not.toMatch(/max-w-|(?:^|\s)p[xy]?-/);
    expect(band?.firstElementChild).toHaveClass("mx-auto", "max-w-4xl", "px-6");
  });

  /**
   * **One padding for every eyebrow-and-prose band** (K-518). This band was
   * `py-14` where the move rail, the coexist and website bands, the concierge
   * and the closing band are `py-16`, so on a phone the rules above and below
   * it sat 56px from its words against the 64 every band around it keeps.
   */
  it("pads its box as the move rail's, 64px on a phone and 80 from lg", () => {
    const { container } = renderContext();
    const box = container.firstElementChild?.firstElementChild;
    expect(box).toHaveClass("py-16", "lg:py-20");
    expect(box?.className).toBe(GUIDE_BAND_CLASS);
    cleanup();
    const rail = render(<MovePath locale="en-US">{null}</MovePath>).container;
    expect(rail.firstElementChild?.firstElementChild?.className).toBe(GUIDE_BAND_CLASS);
  });
});

/**
 * **One step from a band's heading to its lede** (K-495). The move rail's lede
 * was `mt-4` where the coexist and website bands' are `mt-5`, a 4px step
 * between bands of one kind at both widths.
 */
describe("the move rail's lede", () => {
  it("sits under its heading at the band lede's step", () => {
    render(<MovePath locale="en-US">{null}</MovePath>);
    const heading = screen.getByRole("heading", { name: "How the move works" });
    const lede = heading.nextElementSibling;
    expect(lede?.tagName).toBe("P");
    expect(lede?.className).toBe(GUIDE_BAND_LEDE_CLASS);
    expect(lede).toHaveClass("mt-5");
  });
});

/**
 * **A phase's heading shares its marker's centre** (K-205).
 *
 * The marker was a 36px circle and the heading's first line a 32px box nudged
 * down `pt-1`, so the line's centre sat at 20 against the marker's 18: the
 * probe measured the cap centre 1.5–3px low on every phase of every guide. The
 * marker is now the line's own 32px, at the line's top, with no nudge, so both
 * centres are 16px down; the rail still leaves from the marker's centre line,
 * 8px under it.
 */
describe("a move phase", () => {
  it("sizes its marker to the heading's 32px first line, with no nudge", () => {
    render(
      <ol>
        <MovePhase number={2} title="What comes across" />
      </ol>,
    );
    const heading = screen.getByRole("heading", { name: "What comes across" });
    // `text-2xl` carries a 32px line (2rem); nothing pads it off the top.
    expect(heading).toHaveClass("text-2xl");
    expect(heading.className).not.toMatch(/(?:^|\s)(?:p[ty]?|m[ty]?)-/);
    const [marker, rail] = Array.from(
      heading.parentElement?.querySelectorAll("[aria-hidden]") ?? [],
    );
    expect(marker.textContent).toBe("2");
    expect(marker).toHaveClass("absolute", "top-0", "start-0", "size-8");
    expect(rail).toHaveClass("top-10", "start-4");
  });
});

/**
 * **The guide body's skeleton is the loaded hero and "you are here" band, box
 * for box and line for line** (K-342, K-410).
 *
 * `/switching/[competitor]` painted an empty `<main>` while its body streamed
 * in, 0px against a 6,338–13,076px page, so the footer painted at the top and
 * everything jumped. `/switching/spreadsheet`'s skeleton drew bars, but wrong
 * ones: two headline bars at every width for a title that is one line from
 * `sm`, a two-line lede for four lines on a phone, 44px bars for 48px doors, a
 * one-line note for a two-line one, and facts a line tall. The band under the
 * hero landed 264px low at 390. Both guides now paint this one skeleton, in
 * the loaded page's own boxes, with a bar per line each guide's words wrap to.
 */
describe("the guide body's skeleton", () => {
  const SPREADSHEET_LIKE = {
    title: { base: 2, sm: 1 },
    lede: { base: 4, sm: 2 },
    context: [{ base: 4, sm: 2 }, 1],
    list: [
      { title: { base: 2, sm: 1 }, detail: 3 },
      { title: 1, detail: { base: 3, sm: 2 } },
    ],
  };

  function renderPair() {
    const skeleton = render(<GuideBodySkeleton lines={SPREADSHEET_LIKE} />).container;
    const hero = render(
      <GuideHero locale="en-US" source="switching-spreadsheet" eyebrow="E" title="T" lede="L" />,
    ).container;
    const context = render(
      <GuideContext locale="en-US" paragraphs={["One.", "Two."]}>
        <DividedList
          items={[
            { title: "A", detail: "a" },
            { title: "B", detail: "b" },
          ]}
        />
      </GuideContext>,
    ).container;
    const [skeletonHero, skeletonContext] = Array.from(skeleton.querySelectorAll("main > section"));
    return { skeleton, skeletonHero, skeletonContext, hero, context };
  }

  /** The line boxes a `SkeletonLineBars` run draws, in order. */
  const linesIn = (wrapper: Element | undefined | null) => Array.from(wrapper?.children ?? []);

  it("paints nothing a reader could tap", () => {
    const { skeleton } = renderPair();
    expect(skeleton.querySelectorAll("a, button, form, input, select, textarea")).toHaveLength(0);
    expect(skeleton.querySelector("main")).toHaveClass("flex-1", "animate-pulse");
  });

  it("draws the hero in GuideHero's own section, box and facts grid", () => {
    const { skeletonHero, hero } = renderPair();
    const realHero = hero.querySelector("section");
    expect(skeletonHero?.className).toBe(realHero?.className);
    expect(skeletonHero?.firstElementChild?.className).toBe(realHero?.firstElementChild?.className);
    expect(skeletonHero?.querySelector("dl, .lg\\:grid-cols-4")?.className).toBe(
      realHero?.querySelector("dl")?.className,
    );
  });

  it("stands a bar the height of each hero line: 20px back link and eyebrow, 40px title lines (48 from sm), 32px lede lines", () => {
    const { skeletonHero } = renderPair();
    const [back, eyebrow, title, lede, doors, note] = Array.from(
      skeletonHero?.firstElementChild?.children ?? [],
    );
    expect(back).toHaveClass("h-5");
    expect(eyebrow).toHaveClass("mt-6", "h-5");
    expect(title).toHaveClass("mt-4");
    const titleLines = linesIn(title);
    expect(titleLines).toHaveLength(2);
    for (const line of titleLines) expect(line).toHaveClass("h-10", "sm:h-12");
    // The spreadsheet guide's title is two lines on a phone and one from sm.
    expect(titleLines[1]).toHaveClass("sm:hidden");
    expect(lede).toHaveClass("mt-6");
    const ledeLines = linesIn(lede);
    expect(ledeLines).toHaveLength(4);
    for (const line of ledeLines) expect(line).toHaveClass("h-8");
    expect(ledeLines.filter((line) => line.classList.contains("sm:hidden"))).toHaveLength(2);
    // The demo and set-up doors are md buttons: 48px, stacked below sm.
    expect(doors).toHaveClass("mt-8", "flex", "flex-col", "gap-3", "sm:flex-row");
    const doorBars = Array.from(doors.children);
    expect(doorBars).toHaveLength(2);
    for (const bar of doorBars) expect(bar).toHaveClass("h-12");
    // The note under the doors is two 20px lines on a phone, one from sm.
    expect(note).toHaveClass("mt-3");
    const noteLines = linesIn(note);
    expect(noteLines).toHaveLength(2);
    for (const line of noteLines) expect(line).toHaveClass("h-5");
    expect(noteLines[1]).toHaveClass("sm:hidden");
  });

  it("draws each fact as its 16px label and a 24px line per line its words wrap to", () => {
    const { skeletonHero } = renderPair();
    const facts = Array.from(skeletonHero?.querySelector(".lg\\:grid-cols-4")?.children ?? []);
    expect(facts).toHaveLength(4);
    for (const fact of facts) {
      const [label, value] = Array.from(fact.children);
      expect(label).toHaveClass("h-4");
      expect(value).toHaveClass("mt-1");
      for (const line of linesIn(value)) expect(line).toHaveClass("h-6");
    }
    // "What moves" is the tallest: five lines in a phone's half column.
    expect(linesIn(facts[0].children[1])).toHaveLength(5);
  });

  it("draws the you-are-here band in GuideContext's own boxes, a bar per paragraph line", () => {
    const { skeletonContext, context } = renderPair();
    const realBand = context.querySelector("section");
    expect(skeletonContext?.className).toBe(realBand?.className);
    expect(skeletonContext?.firstElementChild?.className).toBe(GUIDE_BAND_CLASS);
    const [eyebrow, paragraphs, list] = Array.from(
      skeletonContext?.firstElementChild?.children ?? [],
    );
    expect(eyebrow).toHaveClass("h-5");
    expect(paragraphs.className).toBe(realBand?.querySelector("div > div")?.className);
    const [first, second] = Array.from(paragraphs.children);
    expect(linesIn(first)).toHaveLength(4);
    expect(linesIn(second)).toHaveLength(1);
    for (const line of [...linesIn(first), ...linesIn(second)]) expect(line).toHaveClass("h-8");
    // The wedge list, in DividedList's own grid and rules.
    expect(list.className).toBe(realBand?.querySelector("ul")?.className);
    const items = Array.from(list.children);
    expect(items).toHaveLength(2);
    expect(items[0].className).toBe(realBand?.querySelector("li")?.className);
    const [itemTitle, itemDetail] = Array.from(items[0].children);
    expect(linesIn(itemTitle)).toHaveLength(2);
    expect(itemDetail).toHaveClass("mt-1.5");
    expect(linesIn(itemDetail)).toHaveLength(3);
    for (const line of [...linesIn(itemTitle), ...linesIn(itemDetail)]) {
      expect(line).toHaveClass("h-6");
    }
  });

  it("draws no list for a guide whose band has none", () => {
    const { container } = render(
      <GuideBodySkeleton lines={{ title: 1, lede: 3, context: [2, 2] }} />,
    );
    const band = container.querySelectorAll("main > section")[1];
    expect(band?.firstElementChild?.children).toHaveLength(2);
  });
});
