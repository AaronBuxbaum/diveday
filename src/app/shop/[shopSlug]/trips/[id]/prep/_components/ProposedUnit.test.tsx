// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssignGearUnitResult } from "../actions";
import { ConfirmProposals, ProposedUnit } from "./ProposedUnit";

afterEach(cleanup);

const COPY = {
  proposed: "Proposed: BCD #3 · L",
  assign: "Assign",
  assigning: "Assigning…",
  change: "Change",
  refusals: { unit_unavailable: "Somebody got that unit first. Pick another." },
  refusalFallback: "That pick didn’t take. Try another unit.",
};

type Assign = (input: {
  tripId: string;
  bookingId: string;
  gearItemId: string;
}) => Promise<AssignGearUnitResult>;

function renderRow(assign: Assign) {
  render(
    <ProposedUnit tripId="t1" bookingId="b1" gearItemId="u3" assign={assign} copy={COPY}>
      <select aria-label="BCD · L" />
    </ProposedUnit>,
  );
}

describe("ProposedUnit", () => {
  it("reserves exactly the proposed unit on one tap", async () => {
    const assign = vi.fn<Assign>().mockResolvedValue({ ok: true });
    renderRow(assign);
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith({
        tripId: "t1",
        bookingId: "b1",
        gearItemId: "u3",
        proposed: true,
      }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says why on a refusal and opens the picker, never claiming the unit", async () => {
    const assign = vi.fn<Assign>().mockResolvedValue({ ok: false, reason: "unit_unavailable" });
    renderRow(assign);
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    expect(screen.queryByText("Proposed: BCD #3 · L")).toBeNull();
  });

  it("opens the picker on Change without reserving anything", () => {
    const assign = vi.fn<Assign>();
    renderRow(assign);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
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
