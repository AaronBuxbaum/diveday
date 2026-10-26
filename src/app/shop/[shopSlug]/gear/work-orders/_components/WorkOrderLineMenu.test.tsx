// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { keptTypedKey } from "@/components/kept-typed-scope";
import { WorkOrderLineMenu, type WorkOrderLineMenuCopy } from "./WorkOrderLineMenu";

const { updateLine } = vi.hoisted(() => ({ updateLine: vi.fn(async () => {}) }));
vi.mock("../actions", () => ({
  updateWorkOrderLineAction: updateLine,
  deleteWorkOrderLineAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/shop/blue-mantis/gear/work-orders/ticket",
}));
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  updateLine.mockReset();
  updateLine.mockResolvedValue(undefined);
});
const scope = "shop.staff.ticket.line-1";
const copy: WorkOrderLineMenuCopy = {
  edit: "Edit",
  delete: "Delete",
  deleting: "Deleting…",
  save: "Save",
  saving: "Saving…",
  kind: "Kind",
  part: "Part",
  labor: "Labor",
  description: "Description",
  quantity: "Quantity",
  unitAmount: "Price each",
};
function menu(notice?: string) {
  return (
    <WorkOrderLineMenu
      workOrderId="ticket"
      line={{
        id: "line-1",
        kind: "part",
        description: "Old seal",
        quantity: "1",
        unitAmount: "12",
      }}
      label="Change Old seal"
      maxDescription={200}
      copy={copy}
      scope={scope}
      notice={notice}
      refusal={
        notice === "invalid-amount"
          ? { field: "unitAmount", message: "Check the price." }
          : undefined
      }
    />
  );
}
async function submitTyped(container: HTMLElement) {
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Corrected seal" } });
  fireEvent.change(screen.getByLabelText("Price each"), { target: { value: "bad" } });
  const form = container.querySelector("form");
  if (!form) throw new Error("Missing edit form");
  await act(async () => {
    fireEvent.submit(form);
  });
}
it("reopens the refused line and retains its attempted fields through a redirect remount", async () => {
  const first = render(menu());
  fireEvent.click(screen.getByRole("button", { name: "Change Old seal" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await submitTyped(first.container);
  first.unmount();
  render(menu("invalid-amount"));
  expect(screen.getByLabelText("Description")).toHaveValue("Corrected seal");
  expect(screen.getByLabelText("Price each")).toHaveValue("bad");
  expect(screen.getByText("Check the price.").closest("form")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByLabelText("Price each")).toBeNull();
  expect(screen.getByRole("button", { name: "Change Old seal" })).toHaveFocus();
});
it("clears the saved line draft after remount even while its editor is folded", async () => {
  const first = render(menu());
  fireEvent.click(screen.getByRole("button", { name: "Change Old seal" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await submitTyped(first.container);
  first.unmount();
  window.sessionStorage.setItem(keptTypedKey("work-order-edit-line", scope), "kept");
  render(menu("line-saved"));
  expect(window.sessionStorage.getItem(keptTypedKey("work-order-edit-line", scope))).toBeNull();
});

it("keeps a refused attempt made after a previous success and clears only its later correction", async () => {
  const view = render(menu("line-saved"));
  fireEvent.click(screen.getByRole("button", { name: "Change Old seal" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  let finish!: () => void;
  updateLine.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Later seal" } });
  fireEvent.change(screen.getByLabelText("Price each"), { target: { value: "bad" } });
  const form = view.container.querySelector("form");
  if (!form) throw new Error("Missing editor");
  fireEvent.submit(form);
  expect(window.sessionStorage.getItem(keptTypedKey("work-order-edit-line", scope))).not.toBeNull();
  view.rerender(menu("invalid-amount"));
  await act(async () => {
    finish();
  });
  await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
  expect(screen.getByLabelText("Price each")).toHaveValue("bad");
  expect(screen.getByLabelText("Description")).toHaveValue("Later seal");
  fireEvent.change(screen.getByLabelText("Price each"), { target: { value: "15" } });
  updateLine.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.submit(form);
  view.rerender(menu("line-saved"));
  await act(async () => {
    finish();
  });
  expect(window.sessionStorage.getItem(keptTypedKey("work-order-edit-line", scope))).toBeNull();
  expect(screen.queryByLabelText("Price each")).toBeNull();
});

it("reopens a preserved closed menu when its redirect brings a validated refusal", () => {
  const view = render(menu());
  view.rerender(menu("invalid-amount"));
  expect(screen.getByLabelText("Price each")).toBeVisible();
  expect(screen.getByText("Check the price.")).toBeVisible();
});

it("keeps an explicit close until a new same-code refusal reopens that line", () => {
  const result = menu("invalid-amount");
  const view = render(result);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByLabelText("Price each")).toBeNull();
  expect(screen.getByRole("button", { name: "Change Old seal" })).toHaveFocus();
  view.rerender(result);
  expect(screen.queryByLabelText("Price each")).toBeNull();
  view.rerender(menu("invalid-amount"));
  expect(screen.getByLabelText("Price each")).toBeVisible();
});
