// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FEATURE_PAGES, FEATURE_PHASES, featurePagePath } from "@/lib/feature-pages";
import { RecapPageFallback } from "./MarketingScreenFallbacks";
import { CaptainPhoneFrame, FeatureDirectory, MarketingMockup } from "./MarketingSections";

afterEach(cleanup);

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean);

/** Every `.tsx` under `dir` that is not a test. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("MarketingMockup", () => {
  it("takes its accessible name from the caller, verbatim", () => {
    const label = "The trip readiness section showing clear diver-ready and diver-blocked states.";
    render(
      <MarketingMockup label={label}>
        <RecapPageFallback locale="en-US" />
      </MarketingMockup>,
    );
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
  });

  it("draws a page's screenshot as a panel: the panel corner and one hairline, no lift", () => {
    render(<MarketingMockup label="A screen">{null}</MarketingMockup>);
    const panel = screen.getByRole("img", { name: "A screen" });
    expect(panel).toHaveClass("rounded-panel", "border", "border-border");
    expect(tokens(panel.className).filter((token) => /^shadow(-|$)/.test(token))).toEqual([]);
  });

  /**
   * **A frame is chosen, never overridden.** Two utilities for one property
   * on one element resolve by the order Tailwind emits them, not by which one
   * a caller meant: the phone's `rounded-[1.9rem]` lost to `rounded-panel`
   * that way (K-295), and every page's `shadow-xl` silently beat the mockup's
   * own `shadow-bed`. So each frame names exactly one corner and, under
   * Logbook, no shadow at all (ADR 20261001-logbook, decision 5); no caller
   * passes a corner, a border or a shadow through `className`.
   */
  it("gives each frame exactly one corner and no shadow", () => {
    for (const frame of ["panel", "screen"] as const) {
      render(
        <MarketingMockup label={`A ${frame}`} frame={frame}>
          {null}
        </MarketingMockup>,
      );
      const classes = tokens(screen.getByRole("img", { name: `A ${frame}` }).className);
      expect(
        classes.filter((token) => /^rounded(-|$)/.test(token)),
        frame,
      ).toHaveLength(1);
      expect(
        classes.filter((token) => /^shadow(-|$)/.test(token)),
        frame,
      ).toHaveLength(0);
    }
  });

  it("is never handed a corner, a border or a shadow by its caller", () => {
    const offenders: string[] = [];
    let callers = 0;
    for (const file of [
      ...sourcesUnder(join(SRC_DIR, "app")),
      ...sourcesUnder(join(SRC_DIR, "components")),
    ]) {
      const source = readFileSync(file, "utf8");
      for (const [, attributes] of source.matchAll(/<MarketingMockup\b([^>]*)>/g)) {
        callers++;
        const where = relative(SRC_DIR, file);
        if (/className=\{/.test(attributes)) {
          offenders.push(`${where}: a computed className cannot be checked; pass a literal`);
          continue;
        }
        const className = /className="([^"]*)"/.exec(attributes)?.[1] ?? "";
        for (const token of tokens(className)) {
          const utility = token.split(":").at(-1) ?? token;
          if (/^(rounded|border|shadow)(-|$)/.test(utility)) offenders.push(`${where}: ${token}`);
        }
      }
    }
    expect(callers, "the scan found the mockup's callers").toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

/**
 * The screen inside the phone bezel. The frame used to ask for its corner by
 * passing a second radius utility through `className`, beside the mockup's own
 * `rounded-panel`; Tailwind emits one property's utilities in its own order,
 * the panel rung won, and a 20px screen corner sat inside a 40px bezel where it
 * nests at 25 (docs/design/pixel-craft.md, class 6). The corner is now the
 * mockup's own choice, so no utility is left to lose.
 *
 * The first test pins the *derivation*, like `SEGMENT_CORNER`'s and
 * `PANEL_INNER_RADIUS`'s: the screen's corner is spelled from the bezel's own
 * corner, frame and padding, so a bezel that changes any of the three fails
 * here until the screen is re-derived, and a root font size other than 16px
 * moves both curves together. The second pins today's number, 25px.
 */
describe("CaptainPhoneFrame", () => {
  const bezelOf = (screenBox: HTMLElement) => {
    const bezel = tokens(screenBox.parentElement?.className ?? "");
    const pick = (pattern: RegExp) =>
      bezel.flatMap((token) => {
        const value = pattern.exec(token)?.[1];
        return value ? [value] : [];
      });
    return {
      corner: pick(/^rounded-\[(.+)\]$/),
      frame: pick(/^border-\[(\d+px)\]$/),
      padding: pick(/^p-([\d.]+)$/),
    };
  };

  it("spells the screen's corner as the bezel's corner less its frame and padding", () => {
    render(<CaptainPhoneFrame label="The roll call on a phone" locale="en-US" />);
    const screenBox = screen.getByRole("img", { name: "The roll call on a phone" });
    const { corner, frame, padding } = bezelOf(screenBox);
    // One of each, or the subtraction below is not the whole inset.
    expect(corner).toHaveLength(1);
    expect(frame).toHaveLength(1);
    expect(padding).toHaveLength(1);
    expect(screenBox).toHaveClass(
      `rounded-[calc(${corner[0]}-${frame[0]}-var(--spacing)*${padding[0]})]`,
    );
    expect(screenBox).not.toHaveClass("rounded-panel");
    expect(screenBox).not.toHaveClass("rounded-[25px]");
    // Nothing to cancel either: the bezel is the screen's edge.
    expect(screenBox).not.toHaveClass("border");
    expect(screenBox).not.toHaveClass("border-0");
    expect(screenBox).not.toHaveClass("rounded-[1.9rem]");
  });

  it("comes to 25px at a 16px root: a 40px bezel corner, less 9px of frame and 6px of padding", () => {
    render(<CaptainPhoneFrame label="The roll call on a phone" locale="en-US" />);
    const { corner, frame, padding } = bezelOf(
      screen.getByRole("img", { name: "The roll call on a phone" }),
    );
    expect(corner[0]).toMatch(/^[\d.]+rem$/);
    // `p-N` is N × `--spacing`, Tailwind's 0.25rem, which the app leaves alone
    // (segmented.test.ts pins that).
    const px =
      Number.parseFloat(corner[0]) * 16 - Number.parseFloat(frame[0]) - Number(padding[0]) * 4;
    expect(px).toBe(25);
  });
});

/**
 * The directory the homepage and the hub both render. It reads the registry,
 * so these pin that it lists every page there is, once, under its phase, and
 * that a page added to `src/lib/feature-pages.ts` needs no second edit here.
 */
describe("FeatureDirectory", () => {
  it("links every feature page once, at its own path", () => {
    render(<FeatureDirectory locale="en-US" />);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(FEATURE_PAGES.map((page) => featurePagePath(page.slug)));
  });

  it("lists the pages under their phase, in the order a shop's year runs", () => {
    render(<FeatureDirectory locale="en-US" />);
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Before the dive day",
      "On the day",
      "Across the season",
    ]);
    expect(headings).toHaveLength(FEATURE_PHASES.length);
    const dayList = headings[1].nextElementSibling;
    expect(dayList?.textContent).toContain("Boat manifest and roll call");
    expect(dayList?.textContent).not.toContain("Online booking");
  });

  it("names the phases at the level the page gives them", () => {
    render(<FeatureDirectory locale="en-US" headingLevel="h2" />);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(FEATURE_PHASES.length);
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  // On the hub each row's checklist shows only its count, under the link that
  // names the page. Read as a list of controls, out of that context, twelve
  // counts would name nothing, so each is named by its page first.
  it("names each page's checklist on the hub by its page, then its count", () => {
    const { container } = render(<FeatureDirectory locale="en-US" lines />);
    const summaries = [...container.querySelectorAll("li > a + details > summary")];
    expect(summaries).toHaveLength(FEATURE_PAGES.length);
    const names = summaries.map((summary) =>
      (summary.getAttribute("aria-labelledby") ?? "")
        .split(" ")
        .map((id) => container.querySelector(`[id="${id}"]`)?.textContent)
        .join(" "),
    );
    expect(names[0]).toMatch(/^Online booking \d+ workflows$/);
    for (const name of names) expect(name).toMatch(/^\S.* \d+ workflows?$/);
    expect(new Set(names).size).toBe(names.length);
  });

  it("renders in Spanish", () => {
    render(<FeatureDirectory locale="es-ES" />);
    expect(screen.getByRole("heading", { name: "El día de la salida" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Manifiesto del barco y pase de lista/ }),
    ).toHaveAttribute("href", "/product/boat-manifest");
  });
});
