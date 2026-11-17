// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CustomerPicker } from "./CustomerPicker";

// Issue #4601: the order forms find a customer by typing, a few at a time, and
// say when more match than are shown.
const search = vi.hoisted(() => vi.fn());
vi.mock("../customer-search-actions", () => ({ searchOrderCustomersAction: search }));
afterEach(() => {
  cleanup();
  search.mockReset();
});

const words = {
  label: "Customer",
  placeholder: "Name, email, or phone",
  choose: "Choose a customer",
  change: "Change",
  noMatches: "No one by that name, email, or phone",
  more: "More people match. Keep typing to narrow it.",
};
const maya = { id: "p-maya", fullName: "Maya Torres", email: "maya@example.com" };
const hidden = () => document.querySelector<HTMLInputElement>('input[name="personId"]');

it("lists nobody and asks nothing until something is typed", () => {
  render(<CustomerPicker name="personId" initial={null} required words={words} />);
  expect(screen.getByLabelText("Customer")).toHaveValue("");
  expect(screen.queryByRole("list")).toBeNull();
  expect(search).not.toHaveBeenCalled();
  expect(hidden()).toHaveValue("");
  // Nobody chosen: the send is refused on the box itself.
  expect((screen.getByLabelText("Customer") as HTMLInputElement).validationMessage).toBe(
    "Choose a customer",
  );
});

it("finds a customer by typing, says when more match, and holds the one chosen", async () => {
  search.mockResolvedValue({ customers: [maya], more: true });
  const onChange = vi.fn();
  render(
    <CustomerPicker name="personId" initial={null} required onChange={onChange} words={words} />,
  );
  fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "may" } });
  fireEvent.click(await screen.findByRole("button", { name: /Maya Torres/ }));
  expect(search).toHaveBeenCalledWith("may");
  expect(hidden()).toHaveValue("p-maya");
  expect(onChange).toHaveBeenCalledWith("p-maya");
  expect(screen.getByText("Maya Torres")).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  expect(hidden()).toHaveValue("");
  expect(onChange).toHaveBeenLastCalledWith("");
});

it("says there are more matches rather than hiding them", async () => {
  search.mockResolvedValue({ customers: [maya], more: true });
  render(<CustomerPicker name="personId" initial={null} words={words} />);
  fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "a" } });
  expect(await screen.findByText(words.more)).toBeVisible();
});

it("says when nobody matches", async () => {
  search.mockResolvedValue({ customers: [], more: false });
  render(<CustomerPicker name="personId" initial={null} words={words} />);
  fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "zzz" } });
  expect(await screen.findByText(words.noMatches)).toBeVisible();
});

it("opens with the customer a link named, and sends the walk-in value when cleared", () => {
  render(<CustomerPicker name="personId" initial={maya} emptyValue="walk-in" words={words} />);
  expect(hidden()).toHaveValue("p-maya");
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  expect(hidden()).toHaveValue("walk-in");
});

it("shows the customer again when the form comes back refused, and forgets them on a fresh visit", async () => {
  window.sessionStorage.clear();
  search.mockResolvedValue({ customers: [maya], more: false });
  const keep = { scope: "shop.staffer", restore: false };
  const first = render(
    <CustomerPicker name="personId" initial={null} required keep={keep} words={words} />,
  );
  fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "may" } });
  fireEvent.click(await screen.findByRole("button", { name: /Maya Torres/ }));
  first.unmount();

  // The refusal lands: the same form, remounted with nobody chosen by the page.
  render(
    <CustomerPicker
      name="personId"
      initial={null}
      required
      keep={{ ...keep, restore: true }}
      words={words}
    />,
  );
  expect(await screen.findByText("Maya Torres")).toBeVisible();
  expect(hidden()).toHaveValue("p-maya");
  cleanup();

  // A later visit that is not a refusal starts empty.
  render(<CustomerPicker name="personId" initial={null} required keep={keep} words={words} />);
  expect(screen.getByLabelText("Customer")).toHaveValue("");
  expect(hidden()).toHaveValue("");
});
