// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { depthWarningText } from "@/i18n/depth-labels";
import { diver, t } from "./diver-roll-call-test-fixtures";
import { SharedDepthAdvisories, sharedDepthAdvisories } from "./SharedDepthAdvisories";

afterEach(cleanup);

const deep = {
  status: "exceeds",
  siteDepth: 30,
  limitDepth: 18,
  unit: "meters",
  basis: "certification",
  level: null,
} as const;

function deepDiver(index: number, name: string) {
  return diver({
    bookingId: `00000000-0000-4000-8000-00000000000${index}`,
    fullName: name,
    depthAdvisory: deep,
  });
}

/**
 * **One fact about the plan is said once** (principle 9): an advisory enough
 * of the roster shares is lifted out of the rows and names its divers.
 */
describe("sharedDepthAdvisories", () => {
  it("lifts an advisory three divers share, naming them, and leaves two alone", () => {
    const three = sharedDepthAdvisories(
      [deepDiver(1, "Ana Ruiz"), deepDiver(2, "Ben Okafor"), deepDiver(3, "Cleo Park")],
      t,
    );
    expect(three.sharedAdvisories).toEqual([
      [depthWarningText(t, deep), ["Ana Ruiz", "Ben Okafor", "Cleo Park"]],
    ]);
    expect(three.sharedAdvisoryTexts.has(depthWarningText(t, deep))).toBe(true);

    const two = sharedDepthAdvisories([deepDiver(1, "Ana Ruiz"), deepDiver(2, "Ben Okafor")], t);
    expect(two.sharedAdvisories).toEqual([]);
  });

  it("draws the strip once with the names joined in the reader's language, off paper", () => {
    const { container } = render(
      <SharedDepthAdvisories
        sharedAdvisories={[[depthWarningText(t, deep), ["Ana Ruiz", "Ben Okafor", "Cleo Park"]]]}
        locale="en-US"
        t={t}
      />,
    );
    expect(screen.getByText(depthWarningText(t, deep))).toBeInTheDocument();
    expect(container.textContent).toContain("Ana Ruiz, Ben Okafor, and Cleo Park");
    expect(container.firstElementChild?.className).toContain("print:hidden");
  });

  it("draws nothing when no advisory is shared", () => {
    const { container } = render(
      <SharedDepthAdvisories sharedAdvisories={[]} locale="en-US" t={t} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
