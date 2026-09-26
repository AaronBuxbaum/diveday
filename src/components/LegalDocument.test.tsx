// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LegalDocument, LegalSection, LegalTermList } from "./LegalDocument";
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
