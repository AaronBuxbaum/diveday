// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { Pager } from "./Pager";

afterEach(cleanup);

const t = staffTranslator("en-US");
const href = (page: number) =>
  page > 1 ? `/shop/blue-mantis/orders?page=${page}` : "/shop/blue-mantis/orders";

describe("Pager", () => {
  it("renders nothing when there is only one page", () => {
    // A shop with one screenful of anything must never be told it is on
    // "page 1 of 1" — the guard lives here so no caller has to remember it.
    const { container } = render(<Pager page={1} pageCount={1} href={href} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the list is empty", () => {
    const { container } = render(<Pager page={1} pageCount={0} href={href} t={t} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers Next but not Previous on the first page", () => {
    render(<Pager page={1} pageCount={4} href={href} t={t} />);
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/orders?page=2",
    );
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
  });

  it("offers Previous but not Next on the last page", () => {
    render(<Pager page={4} pageCount={4} href={href} t={t} />);
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/orders?page=3",
    );
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
  });

  it("goes both ways in the middle — the whole reason this shape won", () => {
    render(<Pager page={3} pageCount={7} href={href} t={t} />);
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/orders?page=2",
    );
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/orders?page=4",
    );
  });

  it("says where the reader is", () => {
    render(<Pager page={3} pageCount={7} href={href} t={t} />);
    expect(screen.getByText("Page 3 of 7")).toBeInTheDocument();
  });

  it("appends the surface's own count when it supplies one", () => {
    // The noun belongs to the list, not to the shared pager — a bare noun
    // interpolated into a shared sentence does not survive translation.
    render(
      <Pager
        page={1}
        pageCount={7}
        href={href}
        t={t}
        total={t("orders.index.pagination.total", { count: 323 })}
      />,
    );
    expect(screen.getByText("Page 1 of 7 · 323 orders")).toBeInTheDocument();
  });

  it("names its navigation landmark from the shared key set", () => {
    render(<Pager page={2} pageCount={3} href={href} t={t} />);
    expect(screen.getByRole("navigation", { name: "Pages" })).toBeInTheDocument();
  });

  it("speaks the reader's language, not the shop's default", () => {
    render(<Pager page={2} pageCount={5} href={href} t={staffTranslator("es-ES")} />);
    expect(screen.getByRole("link", { name: "Anterior" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Siguiente" })).toBeInTheDocument();
    expect(screen.getByText("Página 2 de 5")).toBeInTheDocument();
  });

  it("adds the caller's spacing without losing its own layout", () => {
    render(<Pager page={2} pageCount={3} href={href} t={t} className="mt-4" />);
    const nav = screen.getByRole("navigation", { name: "Pages" });
    expect(nav.className).toContain("mt-4");
    expect(nav.className).toContain("justify-between");
  });
});
