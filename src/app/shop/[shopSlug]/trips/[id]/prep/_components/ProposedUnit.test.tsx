// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmProposals, ProposedUnit } from "./ProposedUnit";

afterEach(cleanup);

const COPY = { line: "Proposed: BCD #3 · L", reveal: "Change" };

function renderRow() {
  render(
    <ProposedUnit copy={COPY}>
      <select aria-label="BCD · L" />
    </ProposedUnit>,
  );
}

/**
 * **One line and one text button** (visual review 2026-10-24, A10): the row
 * says the proposal and holds the picker behind Change. There is no per-row
 * Assign; "Assign all" confirms proposals, and a pick in the picker is the
 * assignment.
 */
describe("ProposedUnit", () => {
  it("says the proposal in words, with no Assign and no picker at rest", () => {
    renderRow();
    expect(screen.getByText("Proposed: BCD #3 · L")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("reveals the picker inline on Change, in place of the line", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.queryByText("Proposed: BCD #3 · L")).toBeNull();
  });
});

describe("ConfirmProposals", () => {
  const copy = {
    action: "Assign all 2 proposed units",
    pending: "Assigning…",
    refused: "Some of those couldn’t be assigned. Check the rows below.",
    failed: "That pick didn’t take. Try another unit.",
  };
  const picks = [
    { bookingId: "b1", gearItemId: "u1" },
    { bookingId: "b2", gearItemId: "u2" },
  ];

  it("sends the picks it was shown, and says nothing when every one took", async () => {
    const confirm = vi.fn().mockResolvedValue({ ok: true, assigned: 2, refused: 0 });
    render(<ConfirmProposals tripId="t1" picks={picks} confirm={confirm} copy={copy} />);
    fireEvent.click(screen.getByRole("button", { name: copy.action }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith({ tripId: "t1", picks }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so when any pick was refused", async () => {
    const confirm = vi.fn().mockResolvedValue({ ok: true, assigned: 1, refused: 1 });
    render(<ConfirmProposals tripId="t1" picks={picks} confirm={confirm} copy={copy} />);
    fireEvent.click(screen.getByRole("button", { name: copy.action }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.refused);
  });
});
