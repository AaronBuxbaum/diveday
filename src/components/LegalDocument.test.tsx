// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LegalDocument, LegalDocumentSkeleton, LegalSection, LegalTermList } from "./LegalDocument";
import { MARKETING_EYEBROW_CLASS } from "./ui/typography";

afterEach(cleanup);

const THIS_FILE = fileURLToPath(import.meta.url);
const HERE = dirname(THIS_FILE);
const SRC_DIR = join(HERE, "..");
const TYPOGRAPHY = join(HERE, "ui", "typography.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function renderDocument() {
  return render(
    <LegalDocument eyebrow="Legal" title="Privacy" updated="As it works today." intro="Intro.">
      <LegalSection heading="Who does what">
        <p>A paragraph of policy.</p>
        <LegalTermList items={[{ term: "Stripe", body: "payments, on the shop's own account" }]} />
      </LegalSection>
    </LegalDocument>,
  );
}

/**
 * The legal pages' eyebrow was the one marketing eyebrow drawn at 12px, beside
 * twenty others in eight files at 14px (K-207). The eyebrow is one spelling now,
 * and the sweep is what stops a ninth file typing its own.
 */
describe("the marketing eyebrow", () => {
  it("is the one the legal pages wear", () => {
    renderDocument();
    const eyebrow = screen.getByText("Legal");
    expect(eyebrow).toHaveClass(...MARKETING_EYEBROW_CLASS.split(" "));
    expect(eyebrow).toHaveClass("text-sm");
    expect(eyebrow).not.toHaveClass("text-xs");
  });

  it("is spelled only in typography.ts", () => {
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => file !== TYPOGRAPHY && file !== THIS_FILE)
      .filter((file) =>
        /font-semibold tracking-widest text-primary uppercase/.test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(SRC_DIR, file));
    expect(offenders).toEqual([]);
  });
});

/**
 * These two pages are read straight through, and they were ending paragraphs
 * on a lone word: "States.", "metrics." and "it." on /privacy at 1280 (K-484).
 * Three of those sit in a term list, whose `<dt>` and `<dd>` are inline in a
 * `<div>` — a line box no `p`/`dd` rule can reach. `text-wrap` inherits, so
 * one `text-pretty` on the reading column covers the intro, every paragraph,
 * every term list and every bullet.
 */
describe("the reading column", () => {
  it("wraps its prose with text-pretty, term lists included", () => {
    renderDocument();
    const column = screen.getByText("Intro.").parentElement;
    expect(column).toHaveClass("text-pretty");
    expect(column).toContainElement(screen.getByText("A paragraph of policy."));
    expect(column).toContainElement(screen.getByText("Stripe"));
  });
});

/**
 * **The skeleton is the document's own boxes, with bars for words** (K-411,
 * K-407).
 *
 * `/terms` and `/privacy` each typed a copy of one skeleton: two title bars
 * for a title that is one line from `sm` (and on /terms at every width), 16px
 * and 20px bars with an 8px gap standing in for 28px lines, three intro bars
 * for an intro of two to eight lines, and three short bars per section. The
 * streamed page landed 53px (/terms) and 40px (/privacy) higher on a desk; on
 * a phone /terms' second section's heading stood where its first section's
 * paragraph lands, and /privacy's first heading dropped 147px.
 *
 * So the skeleton now draws each block in the box the document draws it in —
 * the same classes, so the same type and the same line height — and each line
 * as a bar one line box tall (`h-lh`), stacked with no gap, as a paragraph's
 * line boxes are. What stays per page is how many lines its words wrap to:
 * both pages draw through this one component (`terms/loading.test.tsx`,
 * `privacy/loading.test.tsx` hold each page's counts).
 */
describe("the legal document's skeleton", () => {
  const SECTIONS = [[1, { terms: [1] }]] as const;

  /** The column, and its blocks in document order. */
  function columnOf(container: HTMLElement) {
    const column = container.querySelector("main > div");
    const [eyebrow, title, dateline, intro, sections] = Array.from(column?.children ?? []);
    return { column, eyebrow, title, dateline, intro, sections };
  }

  it("draws each block in the box the document draws it in", () => {
    const loaded = columnOf(renderDocument().container);
    const section = loaded.sections?.querySelector("section");
    const loadedClasses = {
      column: loaded.column?.className,
      eyebrow: loaded.eyebrow?.className,
      title: loaded.title?.className,
      dateline: loaded.dateline?.className,
      intro: loaded.intro?.className,
      sections: loaded.sections?.className,
      heading: section?.querySelector("h2")?.className,
      body: section?.querySelector("h2 + div")?.className,
      terms: section?.querySelector("dl")?.className,
    };
    cleanup();

    const skeleton = columnOf(
      render(<LegalDocumentSkeleton titleLines={1} introLines={1} sections={SECTIONS} />).container,
    );
    const [heading, body] = Array.from(skeleton.sections?.firstElementChild?.children ?? []);
    expect({
      column: skeleton.column?.className,
      eyebrow: skeleton.eyebrow?.className,
      title: skeleton.title?.className,
      dateline: skeleton.dateline?.className,
      intro: skeleton.intro?.className,
      sections: skeleton.sections?.className,
      heading: heading?.className,
      body: body?.className,
      terms: body?.children[1]?.className,
    }).toEqual(loadedClasses);
  });

  it("draws every line one line box tall, with nothing between the lines", () => {
    const { container } = render(
      <LegalDocumentSkeleton
        titleLines={{ base: 2, sm: 1 }}
        introLines={{ base: 4, sm: 2 }}
        sections={[[{ base: 3, sm: 2 }, { terms: [2, { base: 3, sm: 1 }] }]]}
      />,
    );
    const bars = Array.from(container.querySelectorAll(".bg-surface-sunken"));
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      const box = bar.classList.contains("h-lh") ? bar : bar.parentElement;
      expect(box).toHaveClass("h-lh");
      expect(box?.className).not.toMatch(/(?:^|\s)(?:m[ty]?|gap|space-y)-/);
      expect(box?.parentElement?.className ?? "").not.toMatch(/(?:^|\s)(?:gap|space-y)-/);
    }
  });

  it("draws a line per line, hiding the ones one side of sm does not wrap to", () => {
    const { container } = render(
      <LegalDocumentSkeleton
        titleLines={{ base: 2, sm: 1 }}
        introLines={{ base: 4, sm: 2 }}
        sections={[]}
      />,
    );
    const { title, intro } = columnOf(container);
    const sides = (block: Element | undefined) =>
      Array.from(block?.children ?? []).map((line) =>
        line.classList.contains("sm:hidden")
          ? "phone"
          : line.classList.contains("max-sm:hidden")
            ? "desk"
            : "both",
      );
    expect(sides(title)).toEqual(["both", "phone"]);
    expect(sides(intro)).toEqual(["both", "both", "phone", "phone"]);
  });

  it("paints nothing a reader could act on", () => {
    const { container } = render(
      <LegalDocumentSkeleton titleLines={1} introLines={1} sections={SECTIONS} />,
    );
    expect(container.querySelector("main")).toHaveClass("flex-1", "animate-pulse");
    expect(container.querySelectorAll("h1, h2, p, dl, a, button")).toHaveLength(0);
  });
});
