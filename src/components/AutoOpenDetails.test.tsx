// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AutoOpenDetails } from "./AutoOpenDetails";

afterEach(cleanup);

function details(container: HTMLElement): HTMLDetailsElement {
  const el = container.querySelector("details");
  if (!el) throw new Error("no details rendered");
  return el;
}

/**
 * `open` is the server's word that a row just saved; the `?notice=` carrying
 * it is cleared from the URL a moment later. A roster row snapping shut under
 * the staffer when that happens is the bug these pin.
 */
describe("AutoOpenDetails' open prop", () => {
  it("renders open when the server says so", () => {
    const { container } = render(
      <AutoOpenDetails openOnHash="x" open>
        <summary>Row</summary>
      </AutoOpenDetails>,
    );
    expect(details(container).open).toBe(true);
  });

  it("stays open when a later render says false", () => {
    const { container, rerender } = render(
      <AutoOpenDetails openOnHash="x" open>
        <summary>Row</summary>
      </AutoOpenDetails>,
    );
    rerender(
      <AutoOpenDetails openOnHash="x" open={false}>
        <summary>Row</summary>
      </AutoOpenDetails>,
    );
    expect(details(container).open).toBe(true);
  });

  it("opens when a later render says true", () => {
    const { container, rerender } = render(
      <AutoOpenDetails openOnHash="x" open={false}>
        <summary>Row</summary>
      </AutoOpenDetails>,
    );
    expect(details(container).open).toBe(false);
    rerender(
      <AutoOpenDetails openOnHash="x" open>
        <summary>Row</summary>
      </AutoOpenDetails>,
    );
    expect(details(container).open).toBe(true);
  });

  it("leaves a row the reader closed closed while the prop stays false", () => {
    const { container, rerender } = render(
      <AutoOpenDetails openOnHash="x" open={false}>
        <summary>Row</summary>
      </AutoOpenDetails>,
    );
    details(container).open = true;
    details(container).open = false;
    rerender(
      <AutoOpenDetails openOnHash="x" open={false}>
        <summary>Row</summary>
      </AutoOpenDetails>,
    );
    expect(details(container).open).toBe(false);
  });
});
