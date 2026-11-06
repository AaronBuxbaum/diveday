// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiverRecordMenu } from "./DiverRecordMenu";

afterEach(cleanup);

const download = { href: "/shop/blue-mantis/divers/p1/export", label: "Download record" };
const remove = {
  action: vi.fn(async () => {}),
  label: "Delete diver",
  pendingLabel: "Deleting",
  confirmMessage: "Takes Morgan Vale off the diver list. You can restore them.",
};

/**
 * Download and delete are buried behind one "⋯" (Aaron, 2026-11-05): nothing
 * of either shows until it is opened, and delete still asks first.
 */
describe("the diver record menu", () => {
  it("shows neither act until the menu is opened", () => {
    render(<DiverRecordMenu label="Record actions" download={download} remove={remove} />);
    expect(screen.queryByText("Download record")).toBeNull();
    expect(screen.queryByText("Delete diver")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Record actions" }));
    expect(screen.getByRole("link", { name: "Download record" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/p1/export",
    );
    expect(screen.getByRole("button", { name: "Delete diver" })).toBeInTheDocument();
  });

  it("offers only what the reader may do, and nothing at all when neither", () => {
    const { rerender, container } = render(
      <DiverRecordMenu label="Record actions" download={download} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Record actions" }));
    expect(screen.queryByRole("button", { name: "Delete diver" })).toBeNull();
    rerender(<DiverRecordMenu label="Record actions" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("asks before it deletes, and stands down when the answer is no", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DiverRecordMenu label="Record actions" remove={remove} />);
    fireEvent.click(screen.getByRole("button", { name: "Record actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete diver" }));
    expect(confirm).toHaveBeenCalledWith(remove.confirmMessage);
    confirm.mockRestore();
  });
});
