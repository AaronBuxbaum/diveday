// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChromeTitleSlot } from "./ChromeTitleSlot";
import { FoldedPageTitle } from "./FoldedPageTitle";

afterEach(cleanup);

/**
 * The slot's half of issue #2036: it says it may be written to only once it is
 * React's own, which is the mark `FoldedPageTitle` waits for.
 */
describe("ChromeTitleSlot", () => {
  it("marks itself ready once mounted, and the page's title lands in it", async () => {
    const { container, findByText } = render(
      <>
        <ChromeTitleSlot />
        <FoldedPageTitle title="Gear" />
      </>,
    );
    const slot = container.querySelector("[data-chrome-title-slot]");
    expect(slot?.hasAttribute("data-chrome-title-ready")).toBe(true);
    expect(await findByText("Gear")).toBe(slot);
  });
});
