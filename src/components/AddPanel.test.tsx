// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import { AddPanel } from "./AddPanel";

afterEach(() => {
  cleanup();
  replace.mockReset();
});

describe("AddPanel", () => {
  it("renders nothing, and never runs its form, while the URL has not opened it", () => {
    const Form = vi.fn(() => <form aria-label="Add a diver" />);
    const { container } = render(
      <AddPanel open={false} title="Add a diver" closeHref="/shop/reef/divers" closeLabel="Close">
        <Form />
      </AddPanel>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(Form).not.toHaveBeenCalled();
  });

  it("is a named region with its form, a close link back to the index, and takes focus", () => {
    render(
      <AddPanel open title="Add a diver" closeHref="/shop/reef/divers?q=ana" closeLabel="Close">
        <form aria-label="Diver" />
      </AddPanel>,
    );
    const region = screen.getByRole("region", { name: "Add a diver" });
    expect(region).toHaveAttribute("id", "add");
    expect(screen.getByRole("form", { name: "Diver" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Close" })).toHaveAttribute(
      "href",
      "/shop/reef/divers?q=ana",
    );
    expect(screen.getByRole("heading", { level: 2, name: "Add a diver" })).toHaveFocus();
  });

  /**
   * The link that opened the panel stays focused inside the previous route,
   * which Next keeps mounted as a hidden <Activity> tree. That is not the
   * staffer working somewhere else, so the panel still takes focus
   * (keyboard-booking.spec.ts, leg 4).
   */
  it("takes focus from the link that opened it, left behind on the previous page", () => {
    // Not `hidden` here: jsdom will not focus inside a hidden subtree, while
    // Chrome keeps focus on a link whose route was hidden after the tap.
    const previous = document.createElement("div");
    const link = document.createElement("a");
    link.href = "/shop/reef/divers?add=1";
    link.textContent = "Add diver";
    previous.append(link);
    document.body.append(previous);
    link.focus();
    try {
      render(
        <AddPanel open title="Add a diver" closeHref="/shop/reef/divers" closeLabel="Close">
          <input aria-label="Name" />
        </AddPanel>,
      );
      expect(screen.getByRole("heading", { level: 2, name: "Add a diver" })).toHaveFocus();
    } finally {
      previous.remove();
    }
  });

  it("leaves focus on a field inside the panel that already holds it", () => {
    function Focused() {
      return <input aria-label="Name" ref={(input) => input?.focus()} />;
    }
    render(
      <AddPanel open title="Add a diver" closeHref="/shop/reef/divers" closeLabel="Close">
        <Focused />
      </AddPanel>,
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  });

  it("shuts on Escape from inside the panel, onto the close URL", () => {
    render(
      <AddPanel open title="Add a diver" closeHref="/shop/reef/divers" closeLabel="Close">
        <input aria-label="Name" />
      </AddPanel>,
    );
    screen.getByRole("textbox", { name: "Name" }).focus();
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(replace).toHaveBeenCalledWith("/shop/reef/divers", { scroll: false });
  });
});
