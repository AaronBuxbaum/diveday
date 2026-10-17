// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteFocus, SHOP_MAIN_ID } from "./RouteFocus";

const location = vi.hoisted(() => ({ pathname: "/shop/blue-mantis" }));
vi.mock("next/navigation", () => ({ usePathname: () => location.pathname }));

/** The staff shell's shape: a sidebar link, the main region, then RouteFocus. */
function Shell({ page }: { page: ReactNode }) {
  return (
    <>
      <a href="/shop/blue-mantis/divers">Divers</a>
      <div id={SHOP_MAIN_ID} tabIndex={-1}>
        {page}
      </div>
      <RouteFocus />
    </>
  );
}

function navigate(to: string, page: ReactNode, rerender: (ui: ReactNode) => void) {
  location.pathname = to;
  act(() => rerender(<Shell page={page} />));
}

afterEach(() => {
  location.pathname = "/shop/blue-mantis";
  document.body.innerHTML = "";
});

describe("RouteFocus", () => {
  it("leaves the first load alone, so the skip link stays the first stop", () => {
    render(<Shell page={<h1>Today</h1>} />);
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus to the new page's h1 on a route change, past the hidden old route", () => {
    const { rerender, getByRole } = render(<Shell page={<h1>Today</h1>} />);
    getByRole("link", { name: "Divers" }).focus();
    navigate(
      "/shop/blue-mantis/divers",
      <>
        <div style={{ display: "none" }}>
          <h1>Today</h1>
        </div>
        <div>
          <h1>Divers</h1>
          <button type="button">Add diver</button>
        </div>
      </>,
      rerender,
    );
    const heading = getByRole("heading", { level: 1, name: "Divers" });
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute("tabindex")).toBe("-1");
  });

  it("holds the main region while only the skeleton is painted, then hands focus to the h1", async () => {
    const { rerender, getByRole } = render(<Shell page={<h1>Today</h1>} />);
    navigate("/shop/blue-mantis/divers", <div aria-busy="true" />, rerender);
    expect(document.activeElement?.id).toBe(SHOP_MAIN_ID);
    // The observer's callback is a microtask after the commit.
    await act(async () => rerender(<Shell page={<h1>Divers</h1>} />));
    expect(document.activeElement).toBe(getByRole("heading", { level: 1, name: "Divers" }));
  });

  it("does not pull focus back once the person has moved it", async () => {
    const { rerender, getByRole } = render(<Shell page={<h1>Today</h1>} />);
    navigate("/shop/blue-mantis/divers", <div aria-busy="true" />, rerender);
    const link = getByRole("link", { name: "Divers" });
    link.focus();
    await act(async () => rerender(<Shell page={<h1>Divers</h1>} />));
    expect(document.activeElement).toBe(link);
  });

  it("keeps a field the new page focused itself", () => {
    const { rerender, getByRole } = render(<Shell page={<h1>Today</h1>} />);
    navigate(
      "/shop/blue-mantis/divers/new",
      <>
        <h1>Add a diver</h1>
        {/* biome-ignore lint/a11y/noAutofocus: the case under test */}
        <input aria-label="Full name" autoFocus />
      </>,
      rerender,
    );
    expect(document.activeElement).toBe(getByRole("textbox", { name: "Full name" }));
  });

  it("moves nothing on a same-page query change", () => {
    const { rerender, getByRole } = render(<Shell page={<h1>Today</h1>} />);
    const link = getByRole("link", { name: "Divers" });
    link.focus();
    // A tab or filter link changes only the query, which usePathname leaves out.
    act(() => rerender(<Shell page={<h1>Today</h1>} />));
    expect(document.activeElement).toBe(link);
  });
});
