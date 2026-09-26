// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { segmentedTrackClass } from "@/components/ui/segmented";
import ManifestLoading from "./loading";

afterEach(cleanup);

const PAGE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");

/** Every element in the skeleton, in document order. */
function all(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("*")];
}

/**
 * **The skeleton draws the page the roll call lands in** (K-263, pixel-craft
 * class 11: 0px of shift on load). It drew no stage strip — the label and five
 * 44px taps, two rows of them on a phone — and no roll-call heading, stood a
 * full-width 48px bar for a switch that is a 66px track as wide as its
 * words, and gave the count panel 144px: the roll call arrived about 174px
 * lower than the grey list it replaced.
 */
describe("the manifest's loading skeleton", () => {
  it("draws the count panel at its resting height", () => {
    const { container } = render(<ManifestLoading />);
    const panel = all(container).find((element) => element.classList.contains("rounded-panel"));
    expect(panel).toHaveClass("h-28");
    expect(panel).not.toHaveClass("h-36");
  });

  it("draws the stage strip's label and its five taps before the switch", () => {
    const { container } = render(<ManifestLoading />);
    const row = all(container).find(
      (element) =>
        element.children.length === 5 &&
        [...element.children].every((child) => child.classList.contains("h-11")),
    );
    expect(row).toHaveClass("flex", "flex-wrap");
    expect(row?.children).toHaveLength(5);
    expect(row?.previousElementSibling).toHaveClass("h-4");
    const track = all(container).find((element) => element.className === trackClass());
    expect(track).toBeDefined();
    expect(row?.compareDocumentPosition(track as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("draws the switch as the boat track, as wide as its words rather than the page", () => {
    const { container } = render(<ManifestLoading />);
    const track = all(container).find((element) => element.className === trackClass());
    expect(track).toBeDefined();
    expect(track?.className.split(/\s+/)).not.toContain("w-full");
    expect(track?.firstElementChild).toHaveClass("h-14");
  });

  it("draws the roll call's heading over its list, on the page's one stack", () => {
    const { container } = render(<ManifestLoading />);
    const list = container.querySelector("ul");
    expect(list).toHaveClass("mt-3");
    expect(list?.previousElementSibling).toHaveClass("h-7");
    const stack = list?.parentElement?.parentElement;
    expect(stack).toHaveClass("mt-5", "space-y-10");
    expect(PAGE).toContain('<div className="mt-5 space-y-10">');
  });
});

/** The boat-size switch's track: the shared well, at its content width. */
function trackClass() {
  return `mt-7 w-72 max-w-full ${segmentedTrackClass}`;
}
