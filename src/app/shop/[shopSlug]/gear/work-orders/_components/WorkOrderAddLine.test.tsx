// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keptTypedKey } from "@/components/kept-typed-scope";
import { WorkOrderAddLine } from "./WorkOrderAddLine";

const { addLine } = vi.hoisted(() => ({ addLine: vi.fn(async () => {}) }));
vi.mock("../actions", () => ({ addWorkOrderLineAction: addLine }));
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  addLine.mockReset();
  addLine.mockResolvedValue(undefined);
});

function renderedForm(container: HTMLElement) {
  const form = container.querySelector("form");
  if (!form) throw new Error("Add-line form is missing");
  return form;
}

function editor(notice?: string, scope = "shop.staff.ticket-1") {
  return (
    <>
      <span id="work-order-total" tabIndex={-1}>
        Total: $54.00
      </span>
      <WorkOrderAddLine label="Add part or labor" notice={notice} scope={scope}>
        <label htmlFor="description">Description</label>
        <input id="description" name="description" />
        <label htmlFor="amount">Price each</label>
        <input id="amount" name="unitAmount" />
        <button type="submit">Add</button>
      </WorkOrderAddLine>
    </>
  );
}

describe("the existing add-line form's local door", () => {
  it("keeps the blank form folded until requested", () => {
    const { container } = render(editor());
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(screen.getByText("Add part or labor")).toBeVisible();
  });
  it("reopens a refused attempt with the figures the staffer entered", () => {
    const { container, rerender } = render(editor());
    const details = container.querySelector("details");
    details?.setAttribute("open", "");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Hatch seal" } });
    fireEvent.change(screen.getByLabelText("Price each"), { target: { value: "invalid" } });
    fireEvent.submit(renderedForm(container));
    rerender(editor("invalid-amount"));
    expect(details).toHaveAttribute("open");
    expect(screen.getByLabelText("Description")).toHaveValue("Hatch seal");
    expect(screen.getByLabelText("Price each")).toHaveValue("invalid");
  });
  it("restores a refused redirect after the form has been remounted", () => {
    const first = render(editor());
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Hatch seal" } });
    fireEvent.change(screen.getByLabelText("Price each"), { target: { value: "bad" } });
    fireEvent.submit(renderedForm(first.container));
    first.unmount();
    const next = render(editor("invalid-amount"));
    expect(screen.getByLabelText("Description")).toHaveValue("Hatch seal");
    expect(screen.getByLabelText("Price each")).toHaveValue("bad");
    expect(next.container.querySelector("details")).toHaveAttribute("open");
  });
  it("keeps refused parts separate for another staffer or ticket and clears a saved attempt", () => {
    const first = render(editor());
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Hatch seal" } });
    fireEvent.change(screen.getByLabelText("Price each"), { target: { value: "bad" } });
    fireEvent.submit(renderedForm(first.container));
    first.unmount();
    const other = render(editor("invalid-amount", "shop.staff.ticket-2"));
    expect(screen.getByLabelText("Description")).toHaveValue("");
    other.unmount();
    const staff = render(editor("invalid-amount", "shop.other.ticket-1"));
    expect(screen.getByLabelText("Description")).toHaveValue("");
    staff.unmount();
    const success = render(editor("line-added"));
    success.unmount();
    render(editor("invalid-amount"));
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });
  it("returns focus to the changed total after a line is saved", () => {
    const { rerender } = render(editor());
    rerender(editor("line-added"));
    expect(screen.getByText("Total: $54.00")).toHaveFocus();
  });
  it("restores attempted figures after consecutive refusals with the same code", async () => {
    const { container, rerender } = render(editor("invalid-amount"));
    const form = renderedForm(container);
    for (const description of ["Hatch seal", "Second seal"]) {
      let finish!: () => void;
      addLine.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: description } });
      fireEvent.change(screen.getByLabelText("Price each"), { target: { value: "bad" } });
      fireEvent.submit(form);
      rerender(editor("invalid-amount"));
      await act(async () => {
        finish();
      });
      await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
      expect(screen.getByLabelText("Description")).toHaveValue(description);
      expect(screen.getByLabelText("Price each")).toHaveValue("bad");
      expect(container.querySelector("details")).toHaveAttribute("open");
    }
  });
  it("refolds and focuses the total after every same-code successful add", async () => {
    const { container, rerender } = render(editor("line-added"));
    const form = renderedForm(container);
    for (const description of ["First seal", "Second seal"]) {
      let finish!: () => void;
      addLine.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      container.querySelector("details")?.setAttribute("open", "");
      const descriptionField = screen.getByLabelText("Description");
      fireEvent.change(descriptionField, { target: { value: description } });
      descriptionField.focus();
      fireEvent.submit(form);
      rerender(editor("line-added"));
      await act(async () => {
        finish();
      });
      expect(container.querySelector("details")).not.toHaveAttribute("open");
      expect(screen.getByText("Total: $54.00")).toHaveFocus();
      expect(
        window.sessionStorage.getItem(keptTypedKey("work-order-add-line", "shop.staff.ticket-1")),
      ).toBeNull();
    }
  });
});

it("holds submitted fields while pending, then reenables the retained refused attempt", async () => {
  let finish!: () => void;
  addLine.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(editor());
  view.container.querySelector("details")?.setAttribute("open", "");
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Held seal" } });
  fireEvent.change(screen.getByLabelText("Price each"), { target: { value: "bad" } });
  fireEvent.submit(renderedForm(view.container));
  expect(screen.getByLabelText("Description")).toBeDisabled();
  expect(screen.getByLabelText("Price each")).toBeDisabled();
  view.rerender(editor("invalid-amount"));
  await act(async () => {
    finish();
  });
  await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
  expect(screen.getByLabelText("Description")).toBeEnabled();
  expect(screen.getByLabelText("Description")).toHaveValue("Held seal");
  expect(screen.getByLabelText("Price each")).toHaveValue("bad");
});
