// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FACT_SEPARATOR, FactLine } from "./FactLine";

afterEach(cleanup);

function line(
  facts: Parameters<typeof FactLine>[0]["facts"],
  empty?: string,
  separatorClassName?: string,
) {
  const { container } = render(
    <p>
      <FactLine facts={facts} empty={empty} separatorClassName={separatorClassName} />
    </p>,
  );
  return container.firstElementChild as HTMLElement;
}

/** The text between the fact spans, in order. */
function separators(root: HTMLElement): string[] {
  return [...root.childNodes]
    .filter((node) => node.nodeType === node.TEXT_NODE)
    .map((node) => node.textContent ?? "");
}

/**
 * **A line of facts wraps only after a separator.** "hello@… · +1" / "305 555
 * 0142": the settings hub's contact row was one joined string, so the phone's
 * own spaces were break opportunities and a line ended inside the number
 * (K-235, SETTINGS-1-07). Diving options broke "6:1 divers / per divemaster"
 * the same way (SETTINGS-1-21).
 */
describe("FactLine", () => {
  it("keeps each fact whole, and breaks only after a separator", () => {
    const root = line(["hello@harbour-lantern.invalid", "+1 305 555 0142"]);
    const facts = [...root.querySelectorAll(":scope > span")];
    expect(facts.map((fact) => fact.textContent)).toEqual([
      "hello@harbour-lantern.invalid",
      "+1 305 555 0142",
    ]);
    for (const fact of facts) expect(fact).toHaveClass("whitespace-nowrap");
    // The dot is glued to the fact before it, so no line opens with "·"; the
    // one ordinary space is after it, which is the line's only way to wrap.
    expect(separators(root)).toEqual([FACT_SEPARATOR]);
    expect(FACT_SEPARATOR).toBe(" · ");
  });

  it("lets free text a shop typed wrap like prose, with its dot still glued on", () => {
    const root = line([{ value: "Diving the Keys since 2012", wraps: true }, "Logo uploaded"]);
    const [tagline, logo] = [...root.querySelectorAll(":scope > span")];
    expect(tagline).not.toHaveClass("whitespace-nowrap");
    expect(logo).toHaveClass("whitespace-nowrap");
    expect(separators(root)).toEqual([FACT_SEPARATOR]);
  });

  it("carries a fact's own ink, and drops a missing or blank fact rather than printing its dot", () => {
    const root = line([
      { value: "Stripe customer", className: "font-medium" },
      null,
      "",
      false,
      { value: "cus_123", className: "font-mono" },
    ]);
    const facts = [...root.querySelectorAll(":scope > span")];
    expect(facts.map((fact) => fact.className)).toEqual([
      "whitespace-nowrap font-medium",
      "whitespace-nowrap font-mono",
    ]);
    expect(separators(root)).toEqual([FACT_SEPARATOR]);
  });

  /**
   * A dot takes its line's ink unless told otherwise, so inside a danger
   * notice every "·" turned red, even the one between two muted facts (K-341
   * review). Given `separatorClassName`, the no-break space and the dot carry
   * that ink, and the break space stays outside, after the dot: the dot is
   * still glued to the fact before it, and the line still wraps only there.
   */
  it("gives the separator its own ink when asked, and keeps the break after it", () => {
    const root = line(["Stripe customer", "raised Jul 21"], undefined, "text-muted");
    const dots = [...root.querySelectorAll(":scope > span.text-muted")];
    expect(dots.map((dot) => dot.textContent)).toEqual(["\u00a0·"]);
    const after = dots[0]?.nextSibling;
    expect(after?.nodeType).toBe(root.TEXT_NODE);
    expect(after?.textContent).toBe(" ");
    expect(root.textContent).toBe(`Stripe customer${FACT_SEPARATOR}raised Jul 21`);
  });

  it("says what it is told to when there is no fact at all", () => {
    expect(line([null, ""], "Not set").textContent).toBe("Not set");
    expect(line([]).textContent).toBe("");
  });
});
