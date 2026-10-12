// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "./diver-roll-call-test-fixtures";
import { manifestNoteThreads, StaffNotes } from "./StaffNotes";

afterEach(cleanup);

describe("a diver's staff notes on the manifest", () => {
  it("lists every note with its author, and says when one follows the diver", () => {
    render(
      <StaffNotes
        notes={[
          {
            id: "n-1",
            body: "Seasick last time — offer the bow.",
            authorName: "Keiko Tanaka",
            createdAt: new Date("2026-09-10T14:00:00.000Z"),
            scope: "diver",
          },
          {
            id: "n-2",
            body: "Paid cash at the counter.",
            authorName: "Sam Reyes",
            createdAt: new Date("2026-09-11T12:00:00.000Z"),
            scope: "booking",
          },
        ]}
        locale="en-US"
        timezone="America/New_York"
        t={t}
      />,
    );
    const section = screen.getByRole("region", { name: t("manifest.diverNotesHeading") });
    // Never on the sheet that goes ashore.
    expect(section.className).toContain("print:hidden");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Keiko Tanaka");
    expect(items[0]).toHaveTextContent(t("manifest.noteAppliesAcrossDepartures"));
    expect(items[1]).not.toHaveTextContent(t("manifest.noteAppliesAcrossDepartures"));
  });

  it("renders nothing for a diver with no notes", () => {
    const { container } = render(
      <StaffNotes notes={[]} locale="en-US" timezone="America/New_York" t={t} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("manifestNoteThreads", () => {
  it("threads both sources onto the booking, oldest first, and drops a note with no booking", () => {
    const at = (iso: string) => new Date(iso);
    const threads = manifestNoteThreads(
      [
        {
          note: {
            id: "b-late",
            body: "Late",
            createdAt: at("2026-09-11T12:00:00Z"),
            bookingId: "bk-1",
          },
          authorName: "Sam Reyes",
        },
        {
          note: {
            id: "orphan",
            body: "Nowhere",
            createdAt: at("2026-09-09T12:00:00Z"),
            bookingId: null,
          },
          authorName: "Sam Reyes",
        },
      ],
      [
        {
          note: { id: "d-early", body: "Early", createdAt: at("2026-09-10T12:00:00Z") },
          authorName: "Keiko Tanaka",
          bookingId: "bk-1",
        },
      ],
    );
    expect([...threads.keys()]).toEqual(["bk-1"]);
    expect(threads.get("bk-1")?.map((note) => [note.id, note.scope])).toEqual([
      ["d-early", "diver"],
      ["b-late", "booking"],
    ]);
  });
});
