// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonClass } from "@/components/ui/button";
import { AddUnitControl } from "./AddUnitControl";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Door = "header" | "empty" | "deleted";

function Register({ door, initialOpen = false }: { door: Door; initialOpen?: boolean }) {
  const control = (
    <AddUnitControl
      className={buttonClass({ variant: door === "deleted" ? "secondary" : "primary" })}
      initialOpen={initialOpen}
      title="Add a unit"
    >
      <label>
        Tag
        <input name="label" />
      </label>
    </AddUnitControl>
  );

  return (
    <>
      {door === "header" ? <header>{control}</header> : null}
      {door === "empty" ? <section aria-label="Empty register">{control}</section> : null}
      {door === "deleted" ? <section aria-label="Deleted view">{control}</section> : null}
    </>
  );
}

function reduceMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

describe("AddUnitControl", () => {
  it("opens from the active header, empty-register, or deleted-view door", async () => {
    reduceMotion();
    const user = userEvent.setup();
    const { rerender } = render(<Register door="header" />);

    for (const door of ["header", "empty", "deleted"] as const) {
      rerender(<Register door={door} />);
      const trigger = screen.getByRole("button", { name: "Add a unit" });
      expect(trigger).toHaveAttribute("data-hydrated", "true");
      await user.click(trigger);

      const dialog = screen.getByRole("dialog", { name: "Add a unit" });
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(dialog).toContainElement(screen.getByLabelText("Tag"));
      expect(dialog).toHaveFocus();

      if (door === "header") {
        fireEvent.keyDown(document, { key: "Escape" });
      } else {
        fireEvent.click(screen.getByRole("presentation"));
      }
      expect(screen.queryByRole("dialog")).toBeNull();
    }
  });

  it("opens after a refusal with the server-rendered form value intact", () => {
    reduceMotion();
    render(
      <AddUnitControl className={buttonClass()} initialOpen title="Add a unit">
        <label>
          Tag
          <input name="label" defaultValue="BCD #1" />
        </label>
      </AddUnitControl>,
    );

    expect(screen.getByRole("dialog", { name: "Add a unit" })).toBeVisible();
    expect(screen.getByLabelText("Tag")).toHaveValue("BCD #1");
  });

  it("cleans up modal behavior when its active location unmounts", async () => {
    reduceMotion();
    const user = userEvent.setup();
    const page = render(<Register door="header" />);
    await user.click(screen.getByRole("button", { name: "Add a unit" }));
    expect(screen.getByRole("dialog", { name: "Add a unit" })).toBeVisible();

    page.unmount();
    render(<Register door="empty" />);
    expect(screen.queryByRole("dialog", { name: "Add a unit" })).toBeNull();
  });
});
