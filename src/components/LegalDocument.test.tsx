// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LegalDocument, LegalDocumentFallback, LegalSection, LegalTermList } from "./LegalDocument";
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

const MARGIN = /^-?m[tbxyse]?-/;
const tokens = (element: Element | null | undefined) => [...(element?.classList ?? [])];

/** The document and its fallback, each reduced to the boxes a reader sees first. */
function renderBoth() {
  const real = renderDocument().container;
  const shown = {
    eyebrow: screen.getByText("Legal"),
    title: screen.getByRole("heading", { level: 1 }),
    meta: screen.getByText("As it works today."),
    intro: screen.getByText("Intro."),
    sections: screen.getByRole("heading", { level: 2 }).closest("section")?.parentElement,
    heading: screen.getByRole("heading", { level: 2 }),
    body: screen.getByText("A paragraph of policy.").parentElement,
    terms: real.querySelector("dl"),
  };
  const { container } = render(
    <LegalDocumentFallback
      titleLines={{ base: 2, sm: 1 }}
      introLines={3}
      sections={[[{ paragraph: 1 }, { terms: [2] }]]}
    />,
  );
  const column = container.querySelector("main > div");
  const [eyebrow, title, meta, intro, sections] = Array.from(column?.children ?? []);
  const section = sections?.firstElementChild;
  const body = section?.lastElementChild;
  const fallback = {
    eyebrow,
    title,
    meta,
    intro,
    sections,
    heading: section?.firstElementChild,
    body,
    terms: body?.lastElementChild,
  };
  return { shown, fallback };
}

/**
 * **The fallback is drawn from the document's own measurements** (K-407).
 *
 * `/privacy`'s skeleton was a hand copy of this layout in bars of guessed
 * heights — `h-5` with a gap for 28px lines, `h-6` for a 28px heading, two
 * title bars for a one-line title — and the page jumped 40–147px when it
 * landed. Each bar here is one line box, `h-lh` in the very type of the text
 * it stands for, stacked with no gap, and each run of lines stands where that
 * text stands: the same margins, and the same gaps between sections and
 * terms. A change to the document's type or rhythm moves its fallback with
 * it.
 */
describe("the legal document's fallback", () => {
  it("draws every line one line box of the text it stands for", () => {
    const { shown, fallback } = renderBoth();
    const lineOf = (wrapper: Element | undefined) =>
      wrapper?.classList.contains("h-lh") ? wrapper : wrapper?.firstElementChild;
    for (const part of ["eyebrow", "title", "meta", "intro", "heading"] as const) {
      const line = lineOf(fallback[part] ?? undefined);
      expect(line, part).toHaveClass("h-lh");
      const type = tokens(shown[part]).filter((token) => !MARGIN.test(token));
      expect(line, part).toHaveClass(...type);
    }
  });

  it("stands each run of lines where its text stands", () => {
    const { shown, fallback } = renderBoth();
    for (const part of ["title", "meta", "intro"] as const) {
      const margins = tokens(shown[part]).filter((token) => MARGIN.test(token));
      expect(margins, part).not.toHaveLength(0);
      expect(fallback[part], part).toHaveClass(...margins);
    }
    expect(tokens(fallback.sections)).toEqual(tokens(shown.sections));
    const gaps = (element: Element | null | undefined) =>
      tokens(element).filter((token) => MARGIN.test(token) || /^(flex|gap-)/.test(token));
    expect(gaps(fallback.body)).toEqual(gaps(shown.body));
    expect(gaps(fallback.terms)).toEqual(gaps(shown.terms));
  });

  it("stacks a paragraph's lines with no gap, and hides the lines one side of sm does not have", () => {
    const { fallback } = renderBoth();
    const title = Array.from(fallback.title?.children ?? []);
    expect(title).toHaveLength(2);
    expect(title[1]).toHaveClass("sm:hidden");
    const intro = fallback.intro;
    expect(intro?.children).toHaveLength(3);
    expect(tokens(intro).some((token) => /(^|:)(gap|space-y)-/.test(token))).toBe(false);
  });
});
