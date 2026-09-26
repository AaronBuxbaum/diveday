// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  CaptainPhoneFrame,
  FeatureGroupsGrid,
  MarketingMockup,
  marketingMockups,
} from "./MarketingSections";

afterEach(cleanup);

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean);

/** Every `.tsx` under `dir` that is not a test. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * The mockup registry the homepage's daily-moments band reads. The band builds
 * its rows from data, so a row's illustration is a registry entry rather than
 * an import at the call site — and the accessible name of every one of them is
 * resolved by the *caller* from a message bundle, never written into the
 * component. These pin both halves.
 */
describe("marketingMockups", () => {
  it("carries one illustration per moment the homepage tells", () => {
    // The day the band tells: a diver books, the desk clears the boat, the
    // captain calls the roll, the diver goes home with something worth
    // sending on. The evening entry landed 2026-08-28
    // (docs/product/marketing-review-20260827.md); the dock entry on
    // 2026-09-24, when the band became four annotated screens (H-89) and the
    // roll call the hero already showed became a screen of its own.
    expect(Object.keys(marketingMockups)).toEqual([
      "diverBooking",
      "frontDeskReadiness",
      "captainRollCall",
      "recap",
    ]);
  });

  it("renders the recap screen the product page's after-trip chapter also shows", () => {
    render(<div>{marketingMockups.recap.render("en-US")}</div>);
    // **The keepsake and the one ask** — no longer a photos section. Slice 7d
    // recomposed the after-state around the dive-log entry, the crew's note and
    // a single review ask, with photos and tipping demoted to quiet doors, and
    // the mockup follows the surface rather than the other way round. Asserted
    // on the two blocks that carry the argument this screen is on the product
    // page to make: the shop wrote something, and the diver is asked once.
    expect(screen.getByText("Dive log entry")).toBeInTheDocument();
    expect(screen.getByText("From your crew")).toBeInTheDocument();
    expect(screen.getByText("How was your day?")).toBeInTheDocument();
  });

  it("renders the recap screen in Spanish", () => {
    render(<div>{marketingMockups.recap.render("es-ES")}</div>);
    expect(screen.getByText("De tu tripulación")).toBeInTheDocument();
  });

  /**
   * The silence: an illustration names nothing on its own. If a mockup ever
   * grew its own `role="img"`/`aria-label`, the caller's translated label
   * would be a second name for one picture — and the English one baked into
   * the component would never reach a Spanish reader.
   */
  it("gives an illustration no accessible name of its own", () => {
    const { container } = render(<div>{marketingMockups.recap.render("en-US")}</div>);
    expect(container.querySelectorAll("[aria-label]")).toHaveLength(0);
    expect(container.querySelectorAll('[role="img"]')).toHaveLength(0);
  });
});

describe("MarketingMockup", () => {
  it("takes its accessible name from the caller, verbatim", () => {
    const label = "The trip readiness section showing clear diver-ready and diver-blocked states.";
    render(
      <MarketingMockup label={label}>{marketingMockups.recap.render("en-US")}</MarketingMockup>,
    );
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
  });

  it("draws a page's screenshot as a panel: the panel corner, one hairline and its lift", () => {
    render(<MarketingMockup label="A screen">{null}</MarketingMockup>);
    const panel = screen.getByRole("img", { name: "A screen" });
    expect(panel).toHaveClass(
      "rounded-panel",
      "border",
      "border-border",
      "shadow-xl",
      "shadow-foreground/5",
    );
    // The lift every page's screenshot has worn is the frame's own now, so no
    // second shadow sits beside it for stylesheet order to settle.
    expect(panel).not.toHaveClass("shadow-bed");
  });

  /**
   * **A frame is chosen, never overridden.** Two utilities for one property
   * on one element resolve by the order Tailwind emits them, not by which one
   * a caller meant: the phone's `rounded-[1.9rem]` lost to `rounded-panel`
   * that way (K-295), and every page's `shadow-xl` silently beat the mockup's
   * own `shadow-bed`. So each frame names exactly one corner and one shadow,
   * and no caller passes either (or a border) through `className`.
   */
  it("gives each frame exactly one corner and one shadow", () => {
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
        classes.filter((token) => /^shadow(-(xs|sm|md|lg|xl|2xl|bed|none))?$/.test(token)),
        frame,
      ).toHaveLength(1);
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

describe("FeatureGroupsGrid", () => {
  it("balances every group heading, so none ends on one word", () => {
    render(<FeatureGroupsGrid locale="en-US" />);
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings).toHaveLength(4);
    for (const heading of headings) {
      expect(heading, heading.textContent ?? "").toHaveClass("text-balance");
    }
  });
});
