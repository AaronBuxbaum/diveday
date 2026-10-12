// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { RosterPrivateNote } from "./roster-model";
import { blocked, fixtures, noop, renderRoster } from "./roster-test-fixtures";
import { SeatNotes } from "./SeatNotes";

afterEach(cleanup);

const t = staffTranslator("en-US");

function note(id: string, body: string, deletable?: boolean): RosterPrivateNote {
  return {
    note: { id, body, createdAt: new Date("2026-08-20T15:00:00Z") },
    authorName: "Dana Lead",
    ...(deletable === undefined ? {} : { deletable }),
  } as RosterPrivateNote;
}

function renderNotes(notes: RosterPrivateNote[]) {
  return render(
    <SeatNotes
      bookingId="a"
      notes={notes}
      t={t}
      locale="en-US"
      shopTimezone="America/New_York"
      addNoteAction={noop}
      deleteNoteAction={noop}
    />,
  );
}

describe("the roster's row geometry", () => {
  it("keeps the notes in their own band of the seat's panel, ruled off from the facts", () => {
    const { container } = renderRoster(fixtures);

    const row = container.querySelector(`#booking-${blocked.booking.id}`);
    const notes = within(row as HTMLElement)
      .getByText("Add a private note")
      .closest("details");
    expect(notes?.lastElementChild).toHaveClass("mt-2");
    expect(notes?.parentElement).toHaveClass("border-t", "border-border");
  });
});

describe("SeatNotes", () => {
  it("offers the first note when there is none", () => {
    renderNotes([]);
    expect(screen.getByText(t("trips.roster.addFirstNoteSummary"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("trips.roster.delete") })).toBeNull();
  });

  it("counts the notes, and offers Delete only on a note the reader may delete", () => {
    renderNotes([note("n1", "Prefers the bow"), note("n2", "Left early last time", false)]);
    expect(screen.getByText(t("trips.roster.privateStaffNotes", { count: 2 }))).toBeTruthy();
    expect(screen.getByText("Prefers the bow")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: t("trips.roster.delete") })).toHaveLength(1);
  });
});
