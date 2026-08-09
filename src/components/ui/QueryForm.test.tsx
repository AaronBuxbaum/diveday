// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryForm } from "./QueryForm";

const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  usePathname: () => "/shop/blue-mantis/orders",
}));

afterEach(() => {
  cleanup();
  replace.mockClear();
  push.mockClear();
});

describe("a filter form that lives in the URL", () => {
  it("stays a real GET form, so it still works before hydration and with JS off", () => {
    render(
      <QueryForm aria-label="Filters">
        <input name="status" defaultValue="paid" />
      </QueryForm>,
    );
    expect(screen.getByRole("form", { name: "Filters" })).toHaveAttribute("method", "get");
  });

  it("navigates through the router instead of reloading the document", () => {
    render(
      <QueryForm aria-label="Filters">
        <input name="status" defaultValue="paid" />
        <button type="submit">Apply</button>
      </QueryForm>,
    );
    fireEvent.submit(screen.getByRole("form", { name: "Filters" }));
    // `scroll: false` is the whole point: a native GET submit landed the
    // staffer back at the top of the page, above the row they were reading.
    expect(replace).toHaveBeenCalledWith("/shop/blue-mantis/orders?status=paid", {
      scroll: false,
    });
  });

  it("drops an emptied filter out of the URL rather than leaving `?status=` behind", () => {
    render(
      <QueryForm aria-label="Filters">
        <input name="status" defaultValue="" />
      </QueryForm>,
    );
    fireEvent.submit(screen.getByRole("form", { name: "Filters" }));
    expect(replace).toHaveBeenCalledWith("/shop/blue-mantis/orders", { scroll: false });
  });

  it("replaces rather than pushes, so ten filter tweaks are one Back press", () => {
    render(
      <QueryForm aria-label="Filters">
        <input name="status" defaultValue="paid" />
      </QueryForm>,
    );
    fireEvent.submit(screen.getByRole("form", { name: "Filters" }));
    expect(push).not.toHaveBeenCalled();
  });

  it("pushes when a caller wants the change to be its own history entry", () => {
    render(
      <QueryForm aria-label="Filters" replace={false}>
        <input name="status" defaultValue="paid" />
      </QueryForm>,
    );
    fireEvent.submit(screen.getByRole("form", { name: "Filters" }));
    expect(push).toHaveBeenCalledWith("/shop/blue-mantis/orders?status=paid", { scroll: false });
  });

  it("carries state the form has no field for", () => {
    render(
      <QueryForm aria-label="Filters" keep={{ view: "departures", empty: undefined }}>
        <input name="status" defaultValue="paid" />
      </QueryForm>,
    );
    fireEvent.submit(screen.getByRole("form", { name: "Filters" }));
    expect(replace).toHaveBeenCalledWith("/shop/blue-mantis/orders?view=departures&status=paid", {
      scroll: false,
    });
  });
});
