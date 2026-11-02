// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./layer";

afterEach(cleanup);

describe("Dialog", () => {
  it("renders nothing while closed", () => {
    render(
      <Dialog open={false} onClose={() => {}} title="Pull for service">
        body
      </Dialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names itself by its title and portals to the body", () => {
    render(
      <Dialog open onClose={() => {}} title="Pull for service">
        body
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Pull for service" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.closest("body")).toBe(document.body);
  });

  it("closes on Escape and on a click on the scrim, not on the panel", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Pull for service">
        <button type="button">inside</button>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "inside" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
