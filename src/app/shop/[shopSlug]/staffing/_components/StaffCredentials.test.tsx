// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CredentialRow, StaffCredentials } from "./StaffCredentials";

afterEach(cleanup);

/**
 * H-59, and slice 9e of ADR 20260827-the-shops-shelves: **a credential clock
 * informs, it never gates.** The assertions below are mostly assertions of
 * *absence*, which is the kind of rule that regresses quietly — a later change
 * that disables a control on a lapsed rating looks helpful and breaks the one
 * promise this surface makes.
 */

const WORDS = { saving: "Saving…", remove: "Remove", removing: "Removing…" };

const EXPIRED: CredentialRow = {
  id: "cred-1",
  title: "Sal Moretti · Captain's licence",
  detail: "Reviewed · Captain's licence · USCG",
  renewalWord: "Expired",
  renewal: "overdue",
  reviewed: true,
  reviewLabel: "Needs review",
};

const CURRENT: CredentialRow = {
  id: "cred-2",
  title: "Keiko Tanaka · EFR Instructor",
  detail: "Reviewed · Instructor rating · EFR",
  renewalWord: "renews Oct 12, 2026",
  renewal: "current",
  reviewed: true,
  reviewLabel: "Needs review",
};

function renderLedger(rows: CredentialRow[] = [EXPIRED, CURRENT]) {
  return render(
    <StaffCredentials
      label="Credentials"
      rows={rows}
      words={WORDS}
      reviewAction={vi.fn()}
      deleteAction={vi.fn()}
      door={<li>+ Add a credential</li>}
    />,
  );
}

describe("StaffCredentials", () => {
  it("states a lapsed credential in words, and disables nothing anywhere", () => {
    const { container } = renderLedger();

    // The word carries the state — a monochrome screen loses nothing.
    expect(screen.getByText("Expired")).toBeInTheDocument();
    // H-59: nothing on this surface is gated by a clock. Not the row's own
    // controls, not anything beside it.
    expect(container.querySelector("[disabled]")).toBeNull();
    expect(container.querySelector('[aria-disabled="true"]')).toBeNull();
    // Both rows keep the same two acts; an expired credential is not a row
    // with fewer options than a current one.
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Needs review" })).toHaveLength(2);
  });

  it("keeps the group's door at the tail even with no rows above it", () => {
    renderLedger([]);

    // A manager who has never recorded a credential still has a way in; what
    // is gone is the bare "nothing recorded yet" line that used to stand in
    // for the group.
    expect(screen.getByText("+ Add a credential")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("states the renewal date quietly when the clock has nothing to warn about", () => {
    renderLedger([CURRENT]);

    // The word is present either way; only the ink changes, so the row still
    // says what it knows on a screen with no colour.
    expect(screen.getByText("renews Oct 12, 2026")).toBeInTheDocument();
    expect(screen.queryByText("Expired")).toBeNull();
    expect(screen.queryByText("Due within 30 days")).toBeNull();
  });
});
