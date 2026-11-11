// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SeenSaid } from "./SeenSaid";

afterEach(cleanup);
const species = [
  { slug: "seahorse", name: "Seahorse" },
  { slug: "nurse-shark", name: "Tiburón nodriza" },
];
function setup(result: "ok" | "error" = "ok") {
  const recordAction = vi.fn(async (_previous: unknown, _data: FormData) => ({ status: result }));
  const onResult = vi.fn();
  render(
    <SeenSaid
      species={species}
      recordAction={recordAction}
      onResult={onResult}
      copy={{ label: "Or say what you saw", add: "Add", adding: "Adding…" }}
    />,
  );
  return { recordAction, onResult, input: screen.getByRole("combobox"), user: userEvent.setup() };
}
it("offers full-catalog suggestions, selects by keyboard, then saves the canonical slug", async () => {
  const { user, input, recordAction } = setup();
  await user.type(input, "seaho");
  expect(screen.getByRole("option", { name: "Seahorse" })).toBeVisible();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(input).toHaveValue("Seahorse");
  expect(recordAction).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  expect(recordAction.mock.calls[0]?.[1].get("speciesSlug")).toBe("seahorse");
  expect(input).toHaveValue("");
});
it("records arbitrary text without adding it to subsequent suggestions", async () => {
  const { user, input, recordAction } = setup();
  await user.type(input, "seahome{Enter}");
  expect(recordAction.mock.calls[0]?.[1].get("customName")).toBe("seahome");
  await user.type(input, "seaho");
  expect(screen.queryByRole("option", { name: "seahome" })).toBeNull();
  expect(screen.getByRole("option", { name: "Seahorse" })).toBeVisible();
});
it("accepts localized catalog names case-insensitively", async () => {
  const { user, input, recordAction } = setup();
  await user.type(input, "  TIBURÓN NODRIZA  {Enter}");
  expect(recordAction.mock.calls[0]?.[1].get("speciesSlug")).toBe("nurse-shark");
});
it("Escape dismisses suggestions without losing custom words; failures preserve text", async () => {
  const { user, input, recordAction, onResult } = setup("error");
  await user.type(input, "seaho");
  await user.keyboard("{ArrowDown}{Escape}");
  expect(input).toHaveAttribute("aria-expanded", "false");
  await user.keyboard("{Enter}");
  expect(recordAction.mock.calls[0]?.[1].get("customName")).toBe("seaho");
  expect(input).toHaveValue("seaho");
  expect(onResult).toHaveBeenCalledWith({ status: "error" });
});
it("rejects blank input and supports pointer selection", async () => {
  const { user, input, recordAction } = setup();
  await user.type(input, "   {Enter}");
  expect(recordAction).not.toHaveBeenCalled();
  await user.clear(input);
  await user.type(input, "seaho");
  await user.click(screen.getByRole("option", { name: "Seahorse" }));
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(recordAction.mock.calls[0]?.[1].get("speciesSlug")).toBe("seahorse");
});

it("keeps keyboard selections visible in a long suggestion list", async () => {
  const scroll = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scroll });
  const user = userEvent.setup();
  render(
    <SeenSaid
      species={Array.from({ length: 20 }, (_, index) => ({
        slug: `shark-${index}`,
        name: `Shark ${index}`,
      }))}
      recordAction={async () => ({ status: "ok" })}
      onResult={() => {}}
      copy={{ label: "Sightings", add: "Add", adding: "Adding…" }}
    />,
  );
  await user.type(screen.getByRole("combobox"), "shark");
  await user.keyboard("{ArrowUp}");
  expect(screen.getByRole("option", { name: "Shark 19" })).toHaveAttribute("aria-selected", "true");
  expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
});

it("keeps failed requests editable and blocks duplicate submissions while pending", async () => {
  let finish: (value: { status: "error" }) => void = () => {};
  const result = new Promise<{ status: "error" }>((resolve) => {
    finish = resolve;
  });
  const action = vi.fn(() => result);
  const user = userEvent.setup();
  render(
    <SeenSaid
      species={species}
      recordAction={action}
      onResult={() => {}}
      copy={{ label: "Sightings", add: "Add", adding: "Adding…" }}
    />,
  );
  const input = screen.getByRole("combobox");
  await user.type(input, "seahome{Enter}");
  expect(input).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Adding…" }));
  expect(action).toHaveBeenCalledTimes(1);
  finish({ status: "error" });
  await screen.findByRole("button", { name: "Add" });
  expect(input).toHaveValue("seahome");
  expect(input).toBeEnabled();
});
