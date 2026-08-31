// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StaffRolesDisclosure } from "./StaffRolesDisclosure";

afterEach(cleanup);

/**
 * Slice 9h of ADR 20260827-the-shops-shelves, pinned as rules rather than
 * pixels: closing the row is the save, Escape is the abort, a refusal reopens
 * the row it came from with the words beside the checkboxes, and a row with
 * nothing to say says nothing.
 */
const OPTIONS = [
  { value: "owner", label: "Owner", checked: false },
  { value: "manager", label: "Manager", checked: true },
  { value: "captain", label: "Captain", checked: false },
];

function renderRow({
  action = vi.fn(),
  refusal,
  footer,
  options = OPTIONS,
}: {
  action?: (formData: FormData) => void;
  refusal?: string;
  footer?: React.ReactNode;
  options?: typeof OPTIONS;
} = {}) {
  const view = render(
    <StaffRolesDisclosure
      personId="person-1"
      summary="Manager"
      legend="Roles"
      editLabel="Edit roles for Keiko Tanaka"
      options={options}
      action={action}
      refusal={refusal}
      footer={footer}
    />,
  );
  return { ...view, action };
}

const toggle = () => screen.getByRole("button", { name: "Edit roles for Keiko Tanaka" });

describe("StaffRolesDisclosure", () => {
  it("sits closed on the roles as words, with no Save button anywhere", async () => {
    renderRow();

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    // The page-level "Save changes" this replaced is gone, and nothing took
    // its place on the row: the close *is* the save.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("keeps the role disclosure hover state padded", () => {
    renderRow();

    expect(toggle()).toHaveClass("-mx-2", "px-2", "hover:bg-surface-sunken");
  });

  it("saves the row when it closes, posting that person and their checked roles", async () => {
    const action = vi.fn();
    renderRow({ action });

    await userEvent.click(toggle());
    await userEvent.click(screen.getByLabelText("Owner"));
    await userEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const posted = action.mock.calls[0]?.[0] as FormData;
    expect(posted.get("personId")).toBe("person-1");
    expect(posted.get("role_owner")).toBe("on");
    expect(posted.get("role_manager")).toBe("on");
    expect(posted.get("role_captain")).toBeNull();
  });

  it("writes nothing when the row closes on the roles it opened with", async () => {
    const action = vi.fn();
    renderRow({ action });

    await userEvent.click(toggle());
    await userEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(action).not.toHaveBeenCalled();
  });

  it("Escape aborts: the boxes go back, the row closes, nothing is saved", async () => {
    const action = vi.fn();
    renderRow({ action });

    await userEvent.click(toggle());
    await userEvent.click(screen.getByLabelText("Owner"));
    await userEvent.click(screen.getByLabelText("Manager"));
    expect(screen.getByLabelText("Owner")).toBeChecked();
    expect(screen.getByLabelText("Manager")).not.toBeChecked();

    await userEvent.keyboard("{Escape}");

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Owner")).not.toBeChecked();
    expect(screen.getByLabelText("Manager")).toBeChecked();
  });

  it("aborting then reopening offers the saved roles again, not the abandoned edit", async () => {
    const action = vi.fn();
    renderRow({ action });

    await userEvent.click(toggle());
    await userEvent.click(screen.getByLabelText("Captain"));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(toggle());

    expect(screen.getByLabelText("Captain")).not.toBeChecked();
    expect(action).not.toHaveBeenCalled();
  });

  it("saves when a click lands outside the row", async () => {
    const action = vi.fn();
    const { container } = renderRow({ action });
    const elsewhere = document.createElement("button");
    elsewhere.textContent = "Somewhere else";
    container.ownerDocument.body.append(elsewhere);

    await userEvent.click(toggle());
    await userEvent.click(screen.getByLabelText("Captain"));
    await userEvent.click(elsewhere);

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("reopens on a refusal and renders it beside the checkboxes, never as a banner", () => {
    renderRow({ refusal: "Check at least one role before saving." });

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    const refusal = screen.getByRole("alert");
    expect(refusal).toHaveTextContent("Check at least one role before saving.");
    // Beside the boxes it is about: inside the row's own form, and named by
    // the fieldset that holds them.
    expect(refusal.closest("form")).not.toBeNull();
    const fieldset = screen.getByRole("group", { name: "Roles" });
    expect(fieldset.getAttribute("aria-describedby")).toBe(refusal.id);
  });

  it("posts the roles it was rendered with, so a stale close is refused rather than written", async () => {
    // The lost update this guards: two people with the page open, the second
    // close reverting whatever the first added. `saveStaffRolesAction` compares
    // this against the row's live roles and writes nothing when they disagree.
    const action = vi.fn();
    renderRow({ action });

    await userEvent.click(toggle());
    await userEvent.click(screen.getByLabelText("Owner"));
    await userEvent.click(toggle());

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const posted = action.mock.calls[0]?.[0] as FormData;
    expect(posted.get("baseline")).toBe("manager");
  });

  it("Escape aborts with focus outside the row, where a refusal leaves it", async () => {
    // The row that gets refused was usually closed by a click elsewhere, so it
    // is reopened with focus off it entirely; a click on the panel's own
    // padding lands the same way. An abort that answered only to focus would
    // be unreachable in both, and the next click elsewhere would write the
    // edit the reader was trying to abandon.
    const action = vi.fn();
    renderRow({ action });

    await userEvent.click(toggle());
    await userEvent.click(screen.getByLabelText("Owner"));
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    await userEvent.keyboard("{Escape}");

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Owner")).not.toBeChecked();
  });

  it("puts the cursor on the boxes a refusal is about", async () => {
    renderRow({ refusal: "Check at least one role before saving." });

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Owner")));
  });

  it("takes the row's own answer without saving on the way to it", async () => {
    // Undo renders inside the row for exactly this reason: it is a sibling on
    // the page, so tabbing to it or pressing it used to close-and-save the open
    // row first and turn one tap into two writes.
    const action = vi.fn();
    renderRow({
      action,
      footer: (
        <button type="button" data-testid="undo">
          Undo
        </button>
      ),
    });

    await userEvent.click(toggle());
    await userEvent.click(screen.getByLabelText("Owner"));
    await userEvent.click(screen.getByTestId("undo"));

    expect(action).not.toHaveBeenCalled();
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
  });

  it("shows the roles the server now holds after a save the reader did not make here", async () => {
    // An Undo, or a reload after somebody else's edit: React assigns
    // `defaultChecked` on mount and never again, so without a remount the boxes
    // would keep the values they were last clicked to and read back roles the
    // shop no longer holds.
    const { rerender } = renderRow();

    await userEvent.click(toggle());
    await userEvent.click(screen.getByLabelText("Captain"));
    expect(screen.getByLabelText("Captain")).toBeChecked();

    rerender(
      <StaffRolesDisclosure
        personId="person-1"
        summary="Owner"
        legend="Roles"
        editLabel="Edit roles for Keiko Tanaka"
        options={[
          { value: "owner", label: "Owner", checked: true },
          { value: "manager", label: "Manager", checked: false },
          { value: "captain", label: "Captain", checked: false },
        ]}
        action={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Captain")).not.toBeChecked();
    expect(screen.getByLabelText("Owner")).toBeChecked();
  });

  it("says nothing when there is nothing to say", async () => {
    renderRow();

    // No refusal element at rest — the design's silence, not an empty box
    // holding space for one.
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(toggle());
    expect(screen.queryByRole("alert")).toBeNull();
    const fieldset = screen.getByRole("group", { name: "Roles" });
    expect(fieldset).not.toHaveAttribute("aria-describedby");
  });
});
