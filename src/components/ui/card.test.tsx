// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "./badge";
import {
  cardSummaryClass,
  INSET_NOTE_BOX,
  INSET_NOTE_CLASS,
  PANEL_INNER_RADIUS,
  SectionCard,
  sectionCardClass,
  TONE_PANEL_CLASS,
} from "./card";

afterEach(cleanup);

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, "..", "..");

/**
 * The card's contract is mostly visual, but the parts a screenshot cannot
 * prove are here: there is exactly one radius and it is not configurable, the
 * heading is a real heading at the right level, and the shell string a
 * `loading.tsx` skeleton wears is the same one the card wears — a skeleton
 * that drifts from its page is a layout jump on every navigation.
 */
describe("sectionCardClass", () => {
  it("is one radius, and the ShopStat/Table spelling", () => {
    expect(sectionCardClass()).toBe(
      "rounded-panel border border-border bg-surface shadow-bed p-4 sm:p-5",
    );
  });

  it("drops the padding for a shell", () => {
    expect(sectionCardClass({ padding: "none" })).not.toMatch(/\bp-\d/);
    expect(sectionCardClass({ padding: "lg" })).toContain("p-5 sm:p-6");
  });

  /**
   * **Elevation is earned** — ADR 20260827-clearwater-surface-language,
   * decision 1. A panel at rest is a fill and a hairline; a shadow says the
   * thing floats above the page, which is true of a menu, a sheet, a dialog
   * and a toast and of nothing else. Asserted as "no shadow utility at all"
   * rather than as "not `shadow-sm`", because the failure this guards against
   * is somebody reaching for a *quieter* shadow rather than reaching for the
   * same one again.
   */
  it("emits the bed and never shadow-sm, at any padding or with any className", () => {
    for (const padding of ["none", "md", "lg"] as const) {
      expect(sectionCardClass({ padding }), padding).toMatch(/\bshadow-bed\b/);
      expect(sectionCardClass({ padding }), padding).not.toMatch(/\bshadow-sm\b/);
    }
    expect(sectionCardClass({ className: "scroll-mt-24" })).toMatch(/\bshadow-bed\b/);
  });

  /**
   * The prop is gone, not merely defaulted off. It existed so a card nested in
   * another card could stop stacking surface on surface; with no shadow at
   * rest there is nothing to stack, and leaving it accepted would let a call
   * site keep asking for an elevation it will never get.
   */
  it("takes no `elevated` option — the escape hatch is inert, not just off", () => {
    // `pnpm typecheck` refuses the prop at a call site; this is the runtime
    // half, for the JS a `.mjs` script or a stale build could still hand it.
    const forced = (sectionCardClass as (options: Record<string, unknown>) => string)({
      elevated: true,
    });
    expect(forced).toBe(sectionCardClass());
  });

  /**
   * **A fill laid flush inside a panel takes the panel's inner corner** —
   * pixel-craft class 6. The manifest's "On this phone" summary painted its
   * hover fill at the control rung, 12px, flush against the inside of a 20px
   * panel that does not clip, so the fill's corner poked out past the panel's
   * curve (the probe's `fill-corners`, 13 manifest captures). The concentric
   * radius is the panel's less the one thing between them, its hairline: pinned
   * as that derivation, so a heavier border fails here first.
   */
  it("derives the inner corner from the panel's own radius and border", () => {
    const shell = sectionCardClass({ padding: "none" }).split(" ");
    expect(shell).toContain("rounded-panel");
    expect(shell.filter((token) => /^border(-\d+)?$/.test(token))).toEqual(["border"]);
    expect(PANEL_INNER_RADIUS).toBe("rounded-[calc(var(--radius-panel)-1px)]");
  });
});

/**
 * The primitive moving is only half of slice 13a. The other half is the tree:
 * a page whose `SectionCard`s sit at 28px on the bed and whose hand-rolled
 * panels still wear the retired 16px shell re-creates the opening complaint
 * of ADR 20260827-clearwater-surface-language — identically-shaped panels at
 * two radii on one page. This is the tree half, asserted mechanically rather
 * than remembered (ADR 20260901-diveday-reimagined, 13a).
 *
 * Two nets. The first says the retired shell is gone: no class string pairs
 * `rounded-2xl` with the panel's `border-border bg-surface`. The second keeps
 * Clearwater's rule for what the bed replaced: nothing wearing the panel's
 * radius wears `shadow-sm`, because the panel's elevation is `shadow-bed` and
 * nothing else — `shadow-sm` stays legitimate on a button, a thumb, a
 * segmented tile, the sticky chrome bar, none of which wear the panel radius.
 */
describe("every panel shell wears the panel radius and the bed", () => {
  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return files(full);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  function offenders(test: (text: string) => boolean): string[] {
    return files(SRC_DIR)
      .filter((file) => {
        // Quoted and templated strings only, so a doc comment discussing the
        // retired token is not an offender. A class list lives in one such
        // string; a block comment never puts both tokens inside one of them.
        const strings = readFileSync(file, "utf8").match(/"[^"]*"|`[^`]*`/g) ?? [];
        return strings.some(test);
      })
      .map((file) => relative(SRC_DIR, file).split(/[\\/]/).join("/"));
  }

  it("finds no panel still wearing the retired rounded-2xl shell", () => {
    // Listed, not counted — a failure should name the file to open.
    expect(
      offenders(
        (text) =>
          /\brounded-2xl\b/.test(text) &&
          /\bborder-border\b/.test(text) &&
          /\bbg-surface\b/.test(text),
      ),
    ).toEqual([]);
  });

  it("finds no rounded-panel class string carrying shadow-sm", () => {
    expect(
      offenders((text) => /\brounded-panel\b/.test(text) && /\bshadow-sm\b/.test(text)),
    ).toEqual([]);
  });
});

/**
 * **The face of a card that is a disclosure** — pixel-craft classes 7 and 12.
 * Nine summaries were hand-rolled four ways: no radius, so the global ring
 * drew a square around a 20px card (8px off each corner); `items-center`, so a
 * wrapped title left its caret floating between lines (12–21px low on the
 * manifest at 390); two gaps (8 and 12px) and two hovers on one page.
 */
describe("cardSummaryClass", () => {
  it("takes the panel's inner corner, square at the bottom once open", () => {
    const tokens = cardSummaryClass().split(" ");
    expect(tokens).toContain(PANEL_INNER_RADIUS);
    // The open state is spelled against the `<details>`, never `group-open:`:
    // none of these disclosures names an unnamed `group`.
    expect(tokens).toContain("[[open]>&]:rounded-b-none");
    expect(tokens.some((token) => token.startsWith("group-open:"))).toBe(false);
  });

  it("starts its row at the top, so a caret stays on the first line", () => {
    const tokens = cardSummaryClass().split(" ");
    expect(tokens).toEqual(expect.arrayContaining(["flex", "items-start", "gap-3"]));
    expect(tokens).not.toContain("items-center");
  });

  it("is a control, with one hover fill, and no marker", () => {
    const tokens = cardSummaryClass().split(" ");
    expect(tokens).toEqual(
      expect.arrayContaining([
        "cursor-pointer",
        "list-none",
        "[&::-webkit-details-marker]:hidden",
        "hover:bg-surface-sunken",
      ]),
    );
    // The global ring, following the corner: the card does not clip.
    expect(tokens).not.toContain("focus-visible:focus-ring-inset");
  });

  it("fills a danger band with its own tint, and appends the caller's padding", () => {
    const tokens = cardSummaryClass({ tone: "danger", className: "px-4 py-3" }).split(" ");
    expect(tokens).toContain("hover:bg-danger/5");
    expect(tokens).not.toContain("hover:bg-surface-sunken");
    expect(tokens).toEqual(expect.arrayContaining(["px-4", "py-3"]));
  });
});

/**
 * **A tone panel is a card in a tone** — pixel-craft classes 3 and 12. The
 * roster's minimum-seats and unmet-demand bands hand-rolled `p-5` with no
 * `sm:` step and no bed, one of them at the 12px inset radius, so on a phone
 * their words started 4px right of every card above and below them.
 */
describe("TONE_PANEL_CLASS", () => {
  it("is the card's radius, bed and padding, and no colour", () => {
    expect(TONE_PANEL_CLASS).toBe("rounded-panel border p-4 shadow-bed sm:p-5");
    // The same inset as SectionCard's default, so a tone panel's words start
    // where a card's do at every width.
    for (const token of ["rounded-panel", "shadow-bed", "p-4", "sm:p-5"]) {
      expect(sectionCardClass().split(" ")).toContain(token);
    }
    expect(TONE_PANEL_CLASS).not.toMatch(
      /\b(border|bg|text)-(border|surface|warning|danger|success|primary)/,
    );
  });
});

/**
 * **A note carved into a card is one box** — pixel-craft class 12. The
 * departure's panels spelled it three ways: 16px in and 16px down in the crew
 * list, 12px in the requirements and roster notes, 12px all round at 12px type
 * under the conditions. `px-3 py-2 text-sm` was already the majority spelling.
 */
describe("the inset note", () => {
  it("is one geometry, and one sunken spelling of it", () => {
    expect(INSET_NOTE_BOX).toBe("rounded-lg px-3 py-2 text-sm");
    expect(INSET_NOTE_CLASS).toBe(`${INSET_NOTE_BOX} bg-surface-sunken text-muted`);
  });
});

/**
 * The tree half: a `<summary>` that is the first thing inside a card —
 * a `padding="none"` shell, a `SectionCard as="details"`, a `<details>` that
 * wears the panel radius itself — takes the shared class, or it draws its ring
 * square and its caret wherever `items-center` leaves it. A clipped card
 * (`overflow-hidden`) rounds its own fills and rings inside (the About card,
 * `LIST_ROW_SUMMARY_RING`), so it is not a card face in this sense.
 */
describe("every card-face summary wears cardSummaryClass", () => {
  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return files(full);
      return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
    });
  }

  const CARD_OPENER =
    /sectionCardClass\(\{[^}]*padding: "none"|<SectionCard\b[^>]*as="details"|<details\b[^>]*rounded-panel/g;

  it("finds none hand-rolled", () => {
    const offenders: string[] = [];
    for (const file of files(SRC_DIR)) {
      const text = readFileSync(file, "utf8");
      for (const summary of text.matchAll(/<summary\s/g)) {
        const before = text.slice(0, summary.index);
        const openers = [...before.matchAll(CARD_OPENER)];
        const opener = openers.at(-1);
        if (opener?.index === undefined) continue;
        // Nothing closed between the card's opening and the summary: the
        // summary is the card's first child, through a bare `<details>` at most.
        const between = before.slice(opener.index);
        if (between.includes("</")) continue;
        const openingTag = between.slice(0, between.indexOf(">") + 1);
        if (/\boverflow-hidden\b/.test(openingTag)) continue;
        const tag = text.slice(summary.index, text.indexOf(">", summary.index));
        if (!tag.includes("cardSummaryClass(")) {
          const line = before.split("\n").length;
          offenders.push(`${relative(SRC_DIR, file).split(/[\\/]/).join("/")}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("SectionCard", () => {
  it("wears one radius, whatever the call site asks for", () => {
    const { container } = render(
      <SectionCard className="scroll-mt-24">
        <p>Body</p>
      </SectionCard>,
    );
    const card = container.querySelector("section");
    expect(card).toHaveClass(
      "rounded-panel",
      "border",
      "border-border",
      "bg-surface",
      "shadow-bed",
    );
    // The bed is the panel's only elevation: never the ad-hoc `shadow-sm`.
    expect(card?.className).not.toMatch(/\bshadow-sm\b/);
    // The drift this component exists to end: no call site can reintroduce a
    // second radius through the escape hatch.
    expect(card?.className).not.toMatch(/rounded-(lg|xl|2xl|3xl)\b/);
    expect(card).toHaveClass("scroll-mt-24");
  });

  it("renders the title as a real heading, at the level the caller names", () => {
    render(<SectionCard title="Backups">body</SectionCard>);
    expect(screen.getByRole("heading", { level: 2, name: "Backups" })).toHaveClass(
      "text-2xl",
      "font-semibold",
    );
    cleanup();
    render(
      <SectionCard title="Delivery history" titleAs="h3">
        body
      </SectionCard>,
    );
    // A card nested under a group's own h2 steps down, so the two do not shout
    // at the same volume.
    expect(screen.getByRole("heading", { level: 3, name: "Delivery history" })).toHaveClass(
      "text-base",
    );
  });

  it("owns the gap under its header, so no call site opens its body with a margin", () => {
    const { container } = render(
      <SectionCard title="Test message" description="Send one to your own phone.">
        <form data-testid="body" />
      </SectionCard>,
    );
    expect(screen.getByTestId("body").parentElement).toHaveClass("mt-4");
    // ...and carries no outer margin of its own: rhythm belongs to the page.
    expect(container.querySelector("section")?.className).not.toMatch(/\bm[tby]?-\d/);
  });

  it("renders no header wrapper at all when it has no heading", () => {
    const { container } = render(
      <SectionCard as="li" id="staff-1">
        <p>Ana Reyes</p>
      </SectionCard>,
    );
    const card = container.querySelector("li");
    expect(card).toHaveAttribute("id", "staff-1");
    // The body is the card's own child, not wrapped in a spacer that would put
    // 16px of nothing at the top of every row in a roster.
    expect(card?.firstElementChild?.tagName).toBe("P");
  });

  it("puts actions beside the heading", () => {
    render(
      <SectionCard title="Connected" actions={<span>Verified</span>}>
        body
      </SectionCard>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "Connected" });
    const header = heading.parentElement?.parentElement;
    expect(header).toHaveClass("justify-between");
    expect(header).toContainElement(screen.getByText("Verified"));
  });

  /**
   * **The title and the action share a line** — pixel-craft class 1. The
   * header top-aligned a 32px title line beside a 44px button, so the two
   * shared no line at all: "My departures" sat with its baseline 2px above
   * the button's label and its centre 5.5px above the button's
   * (settings-calendar at 1280), and "Grab a spot" 10px under "5 spots left"
   * on the public trip. Baselines are the line text beside a control shares.
   */
  it("sets the title and its actions on one baseline", () => {
    render(
      <SectionCard title="My departures" actions={<button type="button">Copy link</button>}>
        body
      </SectionCard>,
    );
    const header = screen.getByRole("heading", { name: "My departures" }).parentElement
      ?.parentElement;
    expect(header).toHaveClass("items-baseline");
    expect(header).not.toHaveClass("items-start");
  });

  /**
   * A toned badge is the other action a header carries (the backup
   * destination, each integration, the WhatsApp number), and its first item
   * is a drawn mark whose baseline is its bottom edge. The header can only
   * share a baseline the badge hands it from its word: aligned on the mark,
   * "Delivery proven" would sit 3px above "Backups are set up"
   * (settings-export at 1280). The badge owns that (badge.test.tsx); this
   * pins the pairing.
   */
  it("sets the title on a toned badge's word, not on its mark", () => {
    render(
      <SectionCard
        title="Backups are set up"
        actions={<Badge tone="success">Delivery proven</Badge>}
      >
        body
      </SectionCard>,
    );
    const header = screen.getByRole("heading", { name: "Backups are set up" }).parentElement
      ?.parentElement;
    expect(header).toHaveClass("items-baseline");
    const badge = screen.getByText("Delivery proven");
    expect(header).toContainElement(badge);
    expect(badge).toHaveClass("inline-flex", "items-baseline");
    expect(badge).not.toHaveClass("items-center");
    expect(badge.querySelector("svg")).toHaveClass("self-center");
  });

  /**
   * **A wrapped title keeps more than one word on its last line** — class 8.
   * The 24px title set "No WhatsApp number" on one line and "connected" alone
   * on the next (settings-whatsapp at 390). Card titles are short, so they
   * balance, at both levels.
   */
  it("balances its title at either level", () => {
    render(<SectionCard title="No WhatsApp number connected">body</SectionCard>);
    expect(screen.getByRole("heading", { level: 2 })).toHaveClass("text-balance");
    cleanup();
    render(
      <SectionCard title="Delivery history" titleAs="h3">
        body
      </SectionCard>,
    );
    expect(screen.getByRole("heading", { level: 3 })).toHaveClass("text-balance");
  });
});

describe("naming the region", () => {
  it("labels a titled card with its own heading", () => {
    // The hand-rolled panels this replaces paired a written `aria-labelledby`
    // with a written heading id, and mostly did not bother. Deriving it means
    // the label cannot drift from the title.
    const { container } = render(<SectionCard title="Backups">body</SectionCard>);
    const section = container.querySelector("section");
    const heading = container.querySelector("h2");
    expect(heading?.id).toBeTruthy();
    expect(section?.getAttribute("aria-labelledby")).toBe(heading?.id);
  });

  it("gives two cards sharing a heading distinct ids", () => {
    // Two "Notes" cards on one page is legitimate, which is why the id comes
    // from useId rather than from a slug of the title.
    const { container } = render(
      <>
        <SectionCard title="Notes">one</SectionCard>
        <SectionCard title="Notes">two</SectionCard>
      </>,
    );
    const [first, second] = Array.from(container.querySelectorAll("h2"));
    expect(first?.id).toBeTruthy();
    expect(first?.id).not.toBe(second?.id);
  });

  it("does not label an untitled card, or a list item", () => {
    // Nothing to point at; and an `li` is named by its content, so labelling
    // it would announce the heading twice.
    const { container } = render(<SectionCard>body</SectionCard>);
    expect(container.querySelector("section")?.hasAttribute("aria-labelledby")).toBe(false);

    const list = render(
      <SectionCard as="li" title="Rosa Delgado">
        row
      </SectionCard>,
    );
    expect(list.container.querySelector("li")?.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("preserves aria-label when passed explicitly", () => {
    const { container: kebabContainer } = render(
      <SectionCard aria-label="Conservation commitments">body</SectionCard>,
    );
    expect(kebabContainer.querySelector("section")?.getAttribute("aria-label")).toBe(
      "Conservation commitments",
    );

    const { container: camelContainer } = render(
      <SectionCard ariaLabel="Conservation commitments">body</SectionCard>,
    );
    expect(camelContainer.querySelector("section")?.getAttribute("aria-label")).toBe(
      "Conservation commitments",
    );
  });
});
