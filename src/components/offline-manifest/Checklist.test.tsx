// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OfflineChecklist, OfflineSnags } from "./Checklist";
import { controls, view } from "./section-fixtures";

afterEach(cleanup);

describe("OfflineChecklist", () => {
  it("draws no checklist for a shop that keeps none", () => {
    const { container } = render(<OfflineChecklist view={view()} controls={controls()} />);
    expect(container.innerHTML).toBe("");
  });

  it("draws the boat's open snags as saved, with nothing to press", () => {
    const saved = view();
    saved.envelope.snapshot.snags = {
      heading: "Open on this boat",
      items: [
        {
          line: "Radio check: VHF crackles on 16",
          notedBy: "Noted by Sal Moretti, Wed, Oct 14, 5:16 AM EDT",
          stillThere: "Ana Ruiz found it still there, Wed, Oct 14, 1:05 PM EDT",
        },
      ],
    };
    const { getByRole, getByText, queryByRole } = render(<OfflineSnags view={saved} />);
    expect(getByRole("heading", { name: "Open on this boat" })).toBeTruthy();
    expect(getByText("Radio check: VHF crackles on 16")).toBeTruthy();
    expect(getByText(/Ana Ruiz found it still there/)).toBeTruthy();
    expect(queryByRole("button")).toBeNull();
  });

  it("draws nothing when the copy carries no snags", () => {
    const { container } = render(<OfflineSnags view={view()} />);
    expect(container.innerHTML).toBe("");
  });
});
