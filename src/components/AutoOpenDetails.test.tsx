// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { AutoOpenDetails } from "./AutoOpenDetails";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

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

  it("leaves a tap made before hydration alone", async () => {
    // /ready streams its thread in, so a diver can tap another step before
    // React owns the spine. The native accordion closed the current step
    // under that tap; re-opening it on mount closed the tapped one again.
    const tree = (
      <AutoOpenDetails openOnHash="x" open>
        <summary>Row</summary>
      </AutoOpenDetails>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    details(container).open = false;
    await act(async () => {
      hydrateRoot(container, tree);
    });
    expect(details(container).open).toBe(false);
    container.remove();
  });
});

describe("AutoOpenDetails same-page links", () => {
  it("reveals a Next-style same-page anchor click without waiting for hashchange", () => {
    const { container } = render(
      <>
        <a href="#x">Jump</a>
        <AutoOpenDetails id="x" openOnHash="x">
          <summary>Row</summary>
        </AutoOpenDetails>
      </>,
    );
    const link = container.querySelector("a") as HTMLAnchorElement;
    link.addEventListener("click", (event) => event.preventDefault());
    expect(details(container).open).toBe(false);
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);
    expect(window.location.hash).toBe("");
    expect(details(container).open).toBe(true);
    // Clicking the same destination again must reveal a row closed by the reader.
    details(container).open = false;
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);
    expect(details(container).open).toBe(true);
  });

  it("reveals before the link's own handler can measure the scroll target", () => {
    let openAtNavigation: boolean | undefined;
    const { container } = render(
      <>
        <a href="#x">Jump</a>
        <AutoOpenDetails id="x" openOnHash="x">
          <summary>Row</summary>
        </AutoOpenDetails>
      </>,
    );
    const link = container.querySelector("a") as HTMLAnchorElement;
    link.addEventListener("click", (event) => {
      openAtNavigation = details(container).open;
      event.preventDefault();
    });
    fireEvent.click(container.querySelector("a") as HTMLAnchorElement);
    expect(openAtNavigation).toBe(true);
  });

  it("does not reveal the current row for another page or a new-tab click", () => {
    const { container } = render(
      <>
        <a href="/elsewhere#x">Other page</a>
        <a href="#x">New tab</a>
        <AutoOpenDetails id="x" openOnHash="x">
          <summary>Row</summary>
        </AutoOpenDetails>
      </>,
    );
    const links = container.querySelectorAll("a");
    for (const link of links) link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(links[0]);
    expect(details(container).open).toBe(false);
    for (const intent of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      fireEvent.click(links[1], intent);
      expect(details(container).open).toBe(false);
    }
  });
});
