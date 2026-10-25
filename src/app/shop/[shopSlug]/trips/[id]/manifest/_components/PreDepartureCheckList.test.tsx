// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLEAR_CONFIRM_MIN_GAP_MS, CLEAR_CONFIRM_TIMEOUT_MS } from "@/lib/pre-departure-check";
import {
  type PreDepartureCheckAction,
  PreDepartureCheckList,
  type PreDepartureCheckListCopy,
  type PreDepartureCheckListItem,
} from "./PreDepartureCheckList";

afterEach(cleanup);

const copy: PreDepartureCheckListCopy = {
  heading: "Before you leave the dock",
  summary: "Before you leave the dock — 1 of 2 checked",
  errorRefusal: "That check did not save.",
  checkedLabel: "Checked",
  uncheckedLabel: "Not checked",
  confirmClear: "Tap again to clear",
  snagsHeading: "Open on this boat",
  snagFixed: "Fixed",
  snagStillThere: "Still there",
  snagSaving: "Saving…",
  noteProblem: "Note a problem",
  noteItemLabel: "Which item?",
  noteItemPlaceholder: "Pick an item",
  noteLabel: "What’s wrong?",
  noteSave: "Save note",
  noteRefused: "Write what’s wrong, up to 280 characters.",
};

const items = [
  {
    id: "oxygen",
    label: "Emergency oxygen kit aboard",
    checkedByLine: "Checked by the recorder · 7:12 AM",
    printLine: "Emergency oxygen kit aboard — Checked by the recorder · 7:12 AM",
  },
  {
    id: "radio",
    label: "Radio check done",
    printLine: "Radio check done — Not checked",
  },
];

/**
 * **The sheet a captain carries prints each mark in front of its own line.**
 *
 * The printed list is restated outside the disclosure so paper still says
 * what was checked. Its mark was a bare `StatusMark`, which preflight makes a
 * block, so on paper every box stood on a line of its own above the words it
 * belonged to (K-15) — a list of boxes and a list of sentences, interleaved.
 * Only the layout moved: which mark an item prints, and the line beside it,
 * are pinned here unchanged, including the one that matters most on a boat —
 * an unchecked item never prints a checked box.
 */
describe("the printed pre-departure list", () => {
  function printedRows() {
    const { container } = render(
      <PreDepartureCheckList action={async () => null} items={items} copy={copy} atDeparture />,
    );
    const printed = container.querySelector(".print\\:block");
    if (!printed) throw new Error("no printed list");
    return Array.from(printed.querySelectorAll("li"));
  }

  it("opens each line with its mark, standing in the line rather than above it", () => {
    const rows = printedRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const box = row.firstElementChild;
      expect(box?.tagName).toBe("SPAN");
      expect(box).toHaveClass("inline-flex", "h-lh", "items-center", "align-top");
      expect(box?.querySelector("svg")).not.toBeNull();
    }
  });

  it("prints a checked box only for the item that was checked", () => {
    const [oxygen, radio] = printedRows();
    expect(oxygen.textContent?.trim()).toBe(items[0].printLine);
    expect(radio.textContent?.trim()).toBe(items[1].printLine);
    // `checked` draws the box and its tick; `unchecked` draws the box alone.
    expect(oxygen.querySelectorAll("svg path")).toHaveLength(1);
    expect(radio.querySelectorAll("svg path")).toHaveLength(0);
    expect(radio.querySelector("svg rect")).not.toBeNull();
  });
});

/**
 * **The one line never ends on one word** (K-486). At 390 "Before you leave
 * the dock: 0 of 5 checked" wrapped to two lines with "checked" alone on the
 * second. The base rule gives running text `pretty`; a heading is not running
 * text, so the summary asks for `balance` itself.
 */
describe("the checklist's summary line", () => {
  it("balances its heading's lines", () => {
    const { container } = render(
      <PreDepartureCheckList action={async () => null} items={items} copy={copy} atDeparture />,
    );
    const heading = container.querySelector("summary h2");
    expect(heading?.textContent).toBe(copy.summary);
    expect(heading).toHaveClass("text-balance");
  });
});

/**
 * **Open until it is done, at the dock** (UX audit 2026-10-07, item 17): "0 of
 * 5 checked" sat collapsed above the roll call of a boat about to leave.
 */
describe("the boat check's disclosure", () => {
  const checked = items.map((item) => ({
    ...item,
    checkedByLine: "Checked by the recorder · 7:12 AM",
  }));

  function details(container: HTMLElement) {
    const element = container.querySelector("details");
    if (!element) throw new Error("no disclosure");
    return element;
  }

  it("stands open at the dock while an item is unchecked", () => {
    const { container } = render(
      <PreDepartureCheckList action={async () => null} items={items} copy={copy} atDeparture />,
    );
    expect(details(container).open).toBe(true);
  });

  it("folds to its line once every item is checked", () => {
    const { container } = render(
      <PreDepartureCheckList action={async () => null} items={checked} copy={copy} atDeparture />,
    );
    expect(details(container).open).toBe(false);
  });

  it("folds the moment the last item is checked", () => {
    const { container, rerender } = render(
      <PreDepartureCheckList action={async () => null} items={items} copy={copy} atDeparture />,
    );
    expect(details(container).open).toBe(true);
    rerender(
      <PreDepartureCheckList action={async () => null} items={checked} copy={copy} atDeparture />,
    );
    expect(details(container).open).toBe(false);
  });

  it("stays a line after a dive, finished or not", () => {
    const { container } = render(
      <PreDepartureCheckList
        action={async () => null}
        items={items}
        copy={copy}
        atDeparture={false}
      />,
    );
    expect(details(container).open).toBe(false);
  });
});

/**
 * **A check's own label is critical text** (UX review 2026-10-11, item 29):
 * "Emergency oxygen kit aboard" is a control's label read at the dock, so it
 * sits at the 16px floor. "Checked by the recorder · 7:12 AM" is the caption
 * under it: smaller, but at full ink and never below 14px (dive-domain review
 * of layer 8, F8).
 */
describe("the pre-departure check's label", () => {
  it("reads at the dock-test size while its caption stays small", () => {
    const { getAllByRole, getByText } = render(
      <PreDepartureCheckList action={async () => null} items={items} copy={copy} atDeparture />,
    );
    const oxygen = getAllByRole("button", { pressed: true })[0];
    expect(oxygen).toHaveClass("text-base");
    expect(oxygen).not.toHaveClass("text-sm");
    const caption = getByText("Checked by the recorder · 7:12 AM");
    expect(caption).toHaveClass("text-sm");
    expect(caption).not.toHaveClass("text-xs");
    expect(caption).not.toHaveClass("opacity-80");
  });
});

/**
 * **Checking is one tap; clearing is two** (#2481). A brushed button in a
 * pocket or a wet hand on a moving deck must not clear "Emergency oxygen kit
 * aboard" unnoticed, so the first tap on a checked item only asks.
 */
describe("clearing a checked item", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const action = vi.fn<PreDepartureCheckAction>(async () => ({ ok: true }));
    render(<PreDepartureCheckList action={action} items={items} copy={copy} atDeparture />);
    const oxygen = () => screen.getByRole("button", { name: /Emergency oxygen kit aboard/ });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    return { action, oxygen, user };
  }
  /** The pause a deliberate second tap takes; a bounce never does. */
  const pause = (ms = CLEAR_CONFIRM_MIN_GAP_MS) => act(() => vi.advanceTimersByTimeAsync(ms));

  it("checks an unchecked item in one tap", async () => {
    const { action, user } = setup();
    await user.click(screen.getByRole("button", { name: /Radio check done/ }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    const formData = action.mock.calls[0]?.[1];
    expect(formData?.get("checklistItemId")).toBe("radio");
    expect(formData?.get("status")).toBe("checked");
  });

  it("does not clear a checked item on one tap, and says what the next tap does", async () => {
    const { action, oxygen, user } = setup();
    await user.click(oxygen());
    await pause();
    expect(action).not.toHaveBeenCalled();
    expect(oxygen()).toHaveTextContent("Tap again to clear");
    // Announced, since a changed button name is not.
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toContain(
      "Tap again to clear",
    );
  });

  it("clears it on the second tap", async () => {
    const { action, oxygen, user } = setup();
    await user.click(oxygen());
    await pause();
    await user.click(oxygen());
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    const formData = action.mock.calls[0]?.[1];
    expect(formData?.get("checklistItemId")).toBe("oxygen");
    expect(formData?.get("status")).toBe("cleared");
  });

  it("ignores a bounced double tap: two taps 50ms apart only ask", async () => {
    const { action, oxygen } = setup();
    fireEvent.click(oxygen());
    await pause(50);
    fireEvent.click(oxygen());
    await pause();
    expect(action).not.toHaveBeenCalled();
    // The bounce did not spend the ask: a deliberate tap now clears.
    expect(oxygen()).toHaveTextContent("Tap again to clear");
  });

  it("stands down when the tap goes elsewhere, so a later stray tap only asks again", async () => {
    const { action, oxygen, user } = setup();
    await user.click(oxygen());
    await pause();
    fireEvent.blur(oxygen());
    expect(oxygen()).not.toHaveTextContent("Tap again to clear");
    await user.click(oxygen());
    expect(action).not.toHaveBeenCalled();
  });

  it("stands down on Escape", async () => {
    const { action, oxygen, user } = setup();
    await user.click(oxygen());
    await pause();
    fireEvent.keyDown(oxygen(), { key: "Escape" });
    expect(oxygen()).not.toHaveTextContent("Tap again to clear");
    expect(action).not.toHaveBeenCalled();
  });

  it("ignores a held Enter key, so one press cannot ask and then clear", async () => {
    const { action, oxygen } = setup();
    // A browser repeats keydown while Enter is held, and each repeat clicks a
    // focused button: the first asks, one past the gap would submit the clear.
    expect(fireEvent.keyDown(oxygen(), { key: "Enter", repeat: true })).toBe(false);
    // The first press is the browser's to turn into a click.
    expect(fireEvent.keyDown(oxygen(), { key: "Enter" })).toBe(true);
    expect(action).not.toHaveBeenCalled();
  });

  it("stands down by itself if left asking", async () => {
    const { action, oxygen } = setup();
    fireEvent.click(oxygen());
    await pause();
    expect(oxygen()).toHaveTextContent("Tap again to clear");
    await pause(CLEAR_CONFIRM_TIMEOUT_MS);
    expect(oxygen()).not.toHaveTextContent("Tap again to clear");
    expect(action).not.toHaveBeenCalled();
  });
});

describe("the boat's snags (fifth-loop ideas, item 1)", () => {
  const carried = [
    {
      id: "snag-1",
      line: "Radio check done: VHF crackles on 16",
      note: "VHF crackles on 16",
      notedBy: "Noted by Sal Moretti, 5:16 AM",
      printLine: "Open: Radio check done: VHF crackles on 16 (Noted by Sal Moretti, 5:16 AM)",
    },
  ];
  const snagActions = { note: vi.fn(async () => null), answer: vi.fn(async () => null) };

  it("stands an earlier crew's snag above the list, with Fixed and Still there", () => {
    render(
      <PreDepartureCheckList
        action={vi.fn()}
        items={items}
        copy={copy}
        atDeparture={false}
        carried={carried}
        snagActions={snagActions}
      />,
    );
    const group = screen.getByRole("region", { name: "Open on this boat" });
    expect(group).toHaveTextContent("Radio check done: VHF crackles on 16");
    expect(group).toHaveTextContent("Noted by Sal Moretti, 5:16 AM");
    expect(screen.getByRole("button", { name: "Fixed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Still there" })).toBeInTheDocument();
    // The sheet the boat carries says it too.
    expect(screen.getByText(carried[0]?.printLine ?? "")).toBeInTheDocument();
  });

  it("offers Note a problem once for the list, with an item picker, only where a snag can be written", () => {
    // B07 (visual review 2026-10-24): one action at the list's foot rather
    // than one under every line; the picker names the line the note is on.
    const { rerender } = render(
      <PreDepartureCheckList
        action={vi.fn()}
        items={items}
        copy={copy}
        atDeparture
        snagActions={snagActions}
      />,
    );
    expect(screen.getAllByText("Note a problem")).toHaveLength(1);
    const picker = screen.getByLabelText("Which item?") as HTMLSelectElement;
    expect(picker.name).toBe("checklistItemId");
    expect([...picker.options].map((option) => [option.value, option.text])).toEqual([
      ["", "Pick an item"],
      ["oxygen", "Emergency oxygen kit aboard"],
      ["radio", "Radio check done"],
    ]);
    expect(screen.getByLabelText("What’s wrong?")).toHaveAttribute("name", "note");
    rerender(<PreDepartureCheckList action={vi.fn()} items={items} copy={copy} atDeparture />);
    expect(screen.queryByText("Note a problem")).toBeNull();
    expect(screen.queryByRole("region", { name: "Open on this boat" })).toBeNull();
  });

  it("sends the picked line with the note, and gates no check on it (H-51)", async () => {
    const note = vi.fn(async (_prev: unknown, _form: FormData) => ({ ok: true }) as const);
    render(
      <PreDepartureCheckList
        action={vi.fn()}
        items={items}
        copy={copy}
        atDeparture
        snagActions={{ note, answer: vi.fn(async () => null) }}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("Note a problem"));
    await user.selectOptions(screen.getByLabelText("Which item?"), "radio");
    await user.type(screen.getByLabelText("What’s wrong?"), "VHF crackles on 16");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(note).toHaveBeenCalledTimes(1));
    const form = note.mock.calls[0]?.[1] as FormData;
    expect(form.get("checklistItemId")).toBe("radio");
    expect(form.get("note")).toBe("VHF crackles on 16");
    // Every check stays a tap away: the note disabled nothing.
    for (const button of screen.getAllByRole("button", { pressed: false })) {
      expect(button).not.toBeDisabled();
    }
  });

  it("picks no line for the crew, and refuses a note saved without one (review dde-a F3)", async () => {
    const note = vi.fn(async (_prev: unknown, _form: FormData) => ({ ok: true }) as const);
    render(
      <PreDepartureCheckList
        action={vi.fn()}
        items={items}
        copy={copy}
        atDeparture
        snagActions={{ note, answer: vi.fn(async () => null) }}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByText("Note a problem"));
    const picker = screen.getByLabelText("Which item?") as HTMLSelectElement;
    // Nothing chosen: the empty choice shows, and it is not itself a line.
    expect(picker.value).toBe("");
    expect(screen.getByRole("option", { name: "Pick an item" })).toBeDisabled();
    expect(picker).toBeRequired();
    expect(picker).toBeInvalid();
    await user.type(screen.getByLabelText("What’s wrong?"), "VHF crackles on 16");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    expect(note).not.toHaveBeenCalled();
  });

  it("keeps this crew's own note under its line with Fixed alone", () => {
    render(
      <PreDepartureCheckList
        action={vi.fn()}
        items={[{ ...(items[1] as PreDepartureCheckListItem), snags: carried }]}
        copy={copy}
        atDeparture
        snagActions={snagActions}
      />,
    );
    expect(screen.getByText("VHF crackles on 16")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fixed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Still there" })).toBeNull();
  });
});
