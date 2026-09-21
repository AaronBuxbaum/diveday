// @vitest-environment jsdom

import { readFile } from "node:fs/promises";
import path from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MarketingHeroMotion,
  MarketingSectionMotion,
  REVEAL_MARKER_ATTRIBUTE,
  REVEAL_READY_ATTRIBUTE,
} from "./MarketingReveal";

afterEach(cleanup);

/**
 * **A reveal that never fires leaves the page blank, and that is the whole risk.**
 *
 * `.marketing-reveal-pending` holds `opacity: 0` in its *base* style
 * (`globals.css`) and becomes visible only through the fill of the `rise-in`
 * animation its IntersectionObserver starts. So the pending class is not a
 * decoration — it is content withheld, returned only if the observer fires.
 *
 * On 2026-09-20 it did not, in the one place nobody was watching: the visual
 * suite. `MarketingSectionMotion` marks its sections in a **layout effect**, so
 * nothing is marked until the page hydrates, and `paintWholeDocument`'s
 * scroll-through — the thing that would trip the observer — had already swept an
 * unmarked page. `product-dark-vw-390`'s baseline became a hero, nine thousand
 * blank pixels and a footer, and because a pending section owns no animation,
 * `waitForEntranceAnimations` had nothing to commit and nothing to warn about
 * (issue #1910).
 *
 * jsdom runs no IntersectionObserver and lays nothing out, so both are stubbed
 * here: what is under test is the *contract* — which elements are withheld, and
 * what returns them — rather than any geometry a browser has to answer for.
 */

/** Every element the stub has been asked to watch, and the callback to feed. */
type Observed = {
  targets: Element[];
  fire: (entries: { target: Element; isIntersecting: boolean }[]) => void;
};

function stubIntersectionObserver(): Observed {
  const state: Observed = { targets: [], fire: () => {} };
  class Stub {
    constructor(callback: IntersectionObserverCallback) {
      state.fire = (entries) =>
        callback(entries as unknown as IntersectionObserverEntry[], this as never);
    }
    observe(target: Element) {
      state.targets.push(target);
    }
    unobserve(target: Element) {
      state.targets = state.targets.filter((candidate) => candidate !== target);
    }
    disconnect() {
      state.targets = [];
    }
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", Stub);
  return state;
}

/** jsdom reports every rect as zeros, so "below the fold" has to be said out loud. */
function placeSections(tops: number[]) {
  const main = document.createElement("main");
  for (const top of tops) {
    const section = document.createElement("section");
    section.getBoundingClientRect = () => ({ top, bottom: top + 100, height: 100 }) as DOMRect;
    main.append(section);
  }
  document.body.append(main);
  return [...main.querySelectorAll("section")];
}

beforeEach(() => {
  document.documentElement.removeAttribute(REVEAL_READY_ATTRIBUTE);
  document.body.innerHTML = "";
  // A 800px viewport, and no reader asking for stillness. Both are read at
  // mount and both change which branch the effect takes.
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({ matches: false, media: query }) as MediaQueryList,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the marketing section reveal", () => {
  it("withholds only the sections that start below the fold", () => {
    const observer = stubIntersectionObserver();
    const [above, below] = placeSections([200, 1400]);

    render(<MarketingSectionMotion />);

    expect(above.className).not.toContain("marketing-reveal-pending");
    expect(below.className).toContain("marketing-reveal-pending");
    // Only the withheld one is watched: an observer that fires for a section
    // nobody hid would be work with nothing to return.
    expect(observer.targets).toEqual([below]);
  });

  /**
   * The load-bearing one. A section is *withheld* by the pending class, so the
   * intersection is the only thing that gives it back — and the visual suite's
   * blank chapters were exactly this callback never running.
   */
  it("gives a section back when the reader reaches it", () => {
    const observer = stubIntersectionObserver();
    const [below] = placeSections([1400]);

    render(<MarketingSectionMotion />);
    expect(below.className).toContain("marketing-reveal-pending");

    observer.fire([{ target: below, isIntersecting: true }]);

    expect(below.className).not.toContain("marketing-reveal-pending");
    expect(below.className).toContain("marketing-reveal-visible");
  });

  it("keeps withholding a section the reader has not reached", () => {
    const observer = stubIntersectionObserver();
    const [below] = placeSections([1400]);

    render(<MarketingSectionMotion />);
    observer.fire([{ target: below, isIntersecting: false }]);

    expect(below.className).toContain("marketing-reveal-pending");
  });

  /**
   * A reader who has asked for stillness must never be shown less. The CSS
   * kill-switch would return the content anyway, but withholding it in the
   * first place would make the page depend on a stylesheet to be readable.
   */
  it("withholds nothing at all when the reader asked for no motion", () => {
    const observer = stubIntersectionObserver();
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({ matches: query.includes("reduced-motion"), media: query }) as MediaQueryList,
    );
    const sections = placeSections([200, 1400]);

    render(<MarketingSectionMotion />);

    for (const section of sections) {
      expect(section.className).not.toContain("marketing-reveal-pending");
    }
    expect(observer.targets).toEqual([]);
  });
});

describe("the hero's motion, which is the other polarity", () => {
  /**
   * `MarketingHeroMotion` fails the opposite way round, and the difference is
   * why `PENDING_REVEAL_SELECTOR` in `e2e/visual.spec.ts` names one class and
   * not both. Its animations hang off `.marketing-hero-motion-active`, so the
   * *inactive* state is the visible one: a hero whose observer never fires
   * loses an arrival and keeps its content. It fails to animate; the sections
   * above fail to appear. Pinned because a future refactor that moved the hero
   * to an `opacity: 0` base style would hand it the blank-capture bug, silently,
   * and the visual suite would not be watching for it.
   */
  it("never withholds its content, whether or not its observer fires", () => {
    stubIntersectionObserver();
    const { container } = render(
      <MarketingHeroMotion>
        <p>Nine divers, one boat.</p>
      </MarketingHeroMotion>,
    );

    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain("marketing-hero-motion");
    expect(wrapper?.className).not.toContain("pending");
    expect(wrapper?.textContent).toBe("Nine divers, one boat.");
  });
});

/**
 * The half no component test can reach: the capture has to notice. Read as text
 * for the same reason `chrome.test.ts` reads `globals.css` — the corrective
 * sweep and the tripwire live in a Playwright spec that unit tests cannot
 * execute, and a rule stated in one file about another is a rule that rots
 * quietly otherwise.
 */
describe("the capture's own guard against a blank chapter", () => {
  const read = (file: string) =>
    readFile(path.join(process.cwd(), file), "utf8") as Promise<string>;

  it("names the one class that photographs as nothing", async () => {
    const spec = await read("e2e/visual.spec.ts");
    expect(spec).toContain('const PENDING_REVEAL_SELECTOR = ".marketing-reveal-pending"');
  });

  it("refuses the capture rather than warning about it", async () => {
    const spec = await read("e2e/visual.spec.ts");
    // A `console.warn` is what the other settles do, and it is what let this
    // reach a baseline in the first place. This one has to throw.
    expect(spec).toMatch(/stillPending > 0\s*\)\s*\{\s*throw new Error\(/);
  });

  it("tries to fix it before it refuses, by scrolling again", async () => {
    const spec = await read("e2e/visual.spec.ts");
    expect(spec).toMatch(/while \(hidingSomething\(\) > 0 && revealPasses < 2\)/);
  });

  /**
   * The guard's own blind spot, closed on purpose. A zero-area `<section>` can
   * never satisfy the observer's `threshold: 0.01` — no area means no ratio to
   * clear — so it wears the pending class for the page's whole life while
   * hiding nothing at all. Counting it would sweep the document twice on every
   * marketing capture and then refuse the shot over an element with no box.
   * Both the sweep and the tripwire therefore count by rendered size, and this
   * pins that they agree.
   */
  it("counts what a pending element hides, not how many wear the class", async () => {
    const spec = await read("e2e/visual.spec.ts");
    const byRenderedSize = spec.match(/box\.width > 0 && box\.height > 0/g) ?? [];
    expect(byRenderedSize, "the sweep and the tripwire must use the same count").toHaveLength(2);
  });

  it("still holds the base style the whole risk rests on", async () => {
    const css = await read("src/app/globals.css");
    // If this ever stops being `opacity: 0`, the guard above is guarding
    // nothing — and the tripwire would fail captures for a class that no
    // longer hides anything.
    expect(css).toMatch(/\.marketing-reveal-pending\s*\{[^}]*opacity:\s*0/);
  });
});

/**
 * **The camera's half of the contract** (sourcery-ai on #1950).
 *
 * The tripwire alone could not close the race it was built for: hydration can
 * land between the last check and the shutter, marking sections hidden after
 * the guard has passed. A check placed later only narrows that window — it
 * cannot shut it, because nothing in the capture knew when the page had
 * *finished deciding*.
 *
 * So the page says. The marker is server-rendered, so its absence is an answer
 * rather than a page that has not got there yet; the stamp lands in every
 * branch the effect returns through, so the camera is never left waiting by the
 * case that had nothing to hide. Same contract as `ScrollToHash`'s
 * `data-hash-landed`.
 */
describe("the signal the camera waits on", () => {
  it("marks the page as one that runs a reveal, before any script does", () => {
    stubIntersectionObserver();
    const { container } = render(<MarketingSectionMotion />);

    // Rendered output, not an effect: a server render carries this too, which
    // is the entire point — a camera can tell "will decide" from "nothing to
    // decide" without waiting on a signal that is never coming.
    expect(container.querySelector(`[${REVEAL_MARKER_ATTRIBUTE}]`)).not.toBeNull();
  });

  it("says when it has finished deciding what to withhold", () => {
    stubIntersectionObserver();
    placeSections([1400]);

    expect(document.documentElement.hasAttribute(REVEAL_READY_ATTRIBUTE)).toBe(false);
    render(<MarketingSectionMotion />);
    expect(document.documentElement.hasAttribute(REVEAL_READY_ATTRIBUTE)).toBe(true);
  });

  /**
   * The branches that withhold nothing are the ones a duration-based wait gets
   * wrong, so they are the ones worth pinning: a camera waiting on this must
   * not hang on a page that simply had nothing to hide.
   */
  it("says so even when it withholds nothing at all", () => {
    stubIntersectionObserver();
    placeSections([200]); // every section already above the fold

    render(<MarketingSectionMotion />);

    expect(document.documentElement.hasAttribute(REVEAL_READY_ATTRIBUTE)).toBe(true);
  });

  it("says so for a reader who asked for no motion", () => {
    stubIntersectionObserver();
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({ matches: query.includes("reduced-motion"), media: query }) as MediaQueryList,
    );
    placeSections([1400]);

    render(<MarketingSectionMotion />);

    expect(document.documentElement.hasAttribute(REVEAL_READY_ATTRIBUTE)).toBe(true);
  });
});

describe("the capture waits for that signal, and bounds every pass", () => {
  const readSpec = () =>
    readFile(path.join(process.cwd(), "e2e/visual.spec.ts"), "utf8") as Promise<string>;

  it("waits for the page to finish deciding before it scrolls past", async () => {
    const spec = await readSpec();
    // Gated on the server-rendered marker, so no other surface pays the wait.
    expect(spec).toMatch(/document\.querySelector\(`\[\$\{revealMarkerAttribute\}\]`\) !== null/);
    expect(spec).toMatch(
      /!document\.documentElement\.hasAttribute\(revealReadyAttribute\) &&\s*performance\.now\(\) < deadline/,
    );
  });

  /**
   * Bounded by the same deadline as everything else in that pass: a page that
   * never stamps must reach the tripwire, not hold the capture open.
   */
  it("never lets a pass begin or end after the budget is spent", async () => {
    const spec = await readSpec();
    const guards = spec.match(/if \(performance\.now\(\) >= deadline\) return;/g) ?? [];
    expect(guards, "one before the first step, one before the reset").toHaveLength(2);
  });
});
