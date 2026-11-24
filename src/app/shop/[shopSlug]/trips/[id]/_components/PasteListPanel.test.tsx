// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import type { PasteListState } from "../paste-list-actions";
import { type PasteListCopy, PasteListPanel } from "./PasteListPanel";

/**
 * **Paste a list** ("Try it Saturday", item 1), the panel: read, preview with
 * a per-row on-file choice, add, and a result that names who was not added.
 */

const counted = (word: string) => ({ one: `{count} ${word}`, other: `{count} ${word}s` });
const COPY: PasteListCopy = {
  listLabel: "List",
  listDescription: "One a line",
  chooseFile: "Choose a CSV file",
  fileUnreadable: "Unreadable",
  read: "Read the list",
  reading: "Reading",
  refused: {
    empty: "Nothing to read",
    too_large: "Too large",
    too_many_columns: "Too wide",
    too_many_rows: "Too long",
    cell_too_long: "Cell too long",
    no_names: "No names",
    invalid: "Changed",
  },
  toAdd: counted("to add"),
  skipped: counted("skipped"),
  duplicates: counted("repeat"),
  whoLabel: "Who {name} is",
  newPerson: "New person",
  onFile: "{name}, on file",
  onFileWith: "{name}, on file ({contact})",
  droppedEmail: "Email left off",
  droppedPhone: "Phone left off",
  linksGo: "Each gets a ready link",
  seat: { one: "Add {count} person", other: "Add {count} people" },
  seating: "Adding",
  startOver: "Start over",
  added: { one: "{count} person added", other: "{count} people added" },
  notAdded: { one: "{count} not added", other: "{count} not added" },
  reached: { email: "email sent", sms: "text sent", whatsapp: "WhatsApp sent" },
  nothingSent: "nothing sent",
  held: "held",
  refusal: {
    full: "the boat is full",
    already: "already on this trip",
    cards: "cards",
    course: "course",
    busy: "busy",
    unavailable: "unavailable",
  },
  done: "Done",
};

const ON_FILE = "44444444-4444-4444-8444-444444444444";

const PREVIEW: PasteListState = {
  step: "preview",
  text: "Ana López\tana@example.com\nBen Ortiz",
  skipped: [
    { row: 3, text: "12" },
    { row: 4, text: "---" },
  ],
  duplicates: 0,
  rows: [
    {
      row: 1,
      fullName: "Ana López",
      email: "ana@example.com",
      dropped: [],
      candidates: [
        {
          id: ON_FILE,
          fullName: "Ana López",
          email: "ana@example.com",
          phone: null,
          byContact: true,
        },
      ],
      choice: ON_FILE,
    },
    { row: 2, fullName: "Ben Ortiz", dropped: ["phone"], candidates: [], choice: "new" },
  ],
};

afterEach(cleanup);

function panel(
  action: (state: PasteListState | undefined, data: FormData) => Promise<PasteListState>,
) {
  render(<PasteListPanel action={action} copy={COPY} locale="en-US" choiceField="choice" />);
}

describe("PasteListPanel", () => {
  it("previews what was read with each person's on-file choice, then posts the choices in order", async () => {
    const posted: FormData[] = [];
    const action = vi.fn(async (_state: PasteListState | undefined, data: FormData) => {
      posted.push(data);
      return posted.length === 1
        ? PREVIEW
        : ({
            step: "seated",
            outcomes: [
              {
                ok: true,
                row: 1,
                fullName: "Ana López",
                bookingId: "b1",
                reached: ["email"],
                held: false,
              },
              { ok: false, row: 2, fullName: "Ben Ortiz", reason: "trip_full" },
            ],
          } satisfies PasteListState);
    });
    panel(action);
    await userEvent.type(screen.getByLabelText("List"), "Ana López");
    await userEvent.click(screen.getByRole("button", { name: "Read the list" }));

    expect(await screen.findByText("2 to adds")).toBeTruthy();
    // What was left out is shown as it was pasted, so staff can see nobody was lost.
    expect(screen.getByText("2 skippeds")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("---")).toBeTruthy();
    // Staff are told the list will be contacted before they add it.
    expect(screen.getByText("Each gets a ready link")).toBeTruthy();
    expect(screen.getByText("Phone left off")).toBeTruthy();
    const who = screen.getByRole("combobox", { name: "Who Ana López is" }) as HTMLSelectElement;
    expect(who.value).toBe(ON_FILE);
    expect(
      screen.getByRole("option", { name: "Ana López, on file (ana@example.com)" }),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Add 2 people" }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]?.get("step")).toBe("seat");
    expect(posted[1]?.get("list")).toBe(PREVIEW.text);
    expect(posted[1]?.getAll("choice")).toEqual([ON_FILE, "new"]);

    expect(await screen.findByText("1 person added")).toBeTruthy();
    expect(screen.getByText("1 not added")).toBeTruthy();
    expect(screen.getByTestId("paste-list-refused").textContent).toContain("the boat is full");

    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Read the list" })).toBeTruthy();
  });

  it("fills the box from a chosen CSV file", async () => {
    panel(vi.fn());
    const file = new File(["Name,Email\nAna López,ana@example.com"], "trip.csv", {
      type: "text/csv",
    });
    const input = screen.getByLabelText("Choose a CSV file") as HTMLInputElement;
    await userEvent.upload(input, file);
    await waitFor(() =>
      expect((screen.getByLabelText("List") as HTMLTextAreaElement).value).toContain("Ana López"),
    );
  });
});
