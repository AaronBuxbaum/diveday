// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { staffTranslator } from "@/i18n/staff-messages";
import { Pager, type PagerWords, staffPagerWords } from "./Pager";

afterEach(cleanup);

const words = staffPagerWords(staffTranslator("en-US"));
const href = (page: number) =>
  page > 1 ? `/shop/blue-mantis/orders?page=${page}` : "/shop/blue-mantis/orders";

describe("Pager", () => {
  it("renders nothing when there is only one page", () => {
    // A shop with one screenful of anything must never be told it is on
    // "page 1 of 1" — the guard lives here so no caller has to remember it.
    const { container } = render(<Pager page={1} pageCount={1} href={href} words={words} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the list is empty", () => {
    const { container } = render(<Pager page={1} pageCount={0} href={href} words={words} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers Next but not Previous on the first page", () => {
    render(<Pager page={1} pageCount={4} href={href} words={words} />);
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/orders?page=2",
    );
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
  });

  it("offers Previous but not Next on the last page", () => {
    render(<Pager page={4} pageCount={4} href={href} words={words} />);
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/orders?page=3",
    );
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
  });

  it("goes both ways in the middle — the whole reason this shape won", () => {
    render(<Pager page={3} pageCount={7} href={href} words={words} />);
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
    render(<Pager page={3} pageCount={7} href={href} words={words} />);
    expect(screen.getByText("Page 3 of 7")).toBeInTheDocument();
  });

  it("appends the surface's own count when it supplies one", () => {
    // The noun belongs to the list, not to the shared pager — a bare noun
    // interpolated into a shared sentence does not survive translation.
    const t = staffTranslator("en-US");
    render(
      <Pager
        page={1}
        pageCount={7}
        href={href}
        words={words}
        total={t("orders.index.pagination.total", { count: 323 })}
      />,
    );
    expect(screen.getByText("Page 1 of 7 · 323 orders")).toBeInTheDocument();
  });

  it("names its navigation landmark from the shared key set", () => {
    render(<Pager page={2} pageCount={3} href={href} words={words} />);
    expect(screen.getByRole("navigation", { name: "Pages" })).toBeInTheDocument();
  });

  it("speaks the reader's language, not the shop's default", () => {
    render(
      <Pager
        page={2}
        pageCount={5}
        href={href}
        words={staffPagerWords(staffTranslator("es-ES"))}
      />,
    );
    expect(screen.getByRole("link", { name: "Anterior" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Siguiente" })).toBeInTheDocument();
    expect(screen.getByText("Página 2 de 5")).toBeInTheDocument();
  });

  /**
   * The public reviews archive is the one pager outside staff land. It used to
   * hand-copy the old `justify-between` row, empty `<span>` stand-ins and all,
   * because this component could only speak the staff bundle. It now takes its
   * words, and the archive passes the diver's.
   */
  it("speaks whichever bundle the surface passes: the diver's on the public archive", () => {
    const t = diverTranslator("es-ES");
    const diverWords: PagerWords = {
      label: t("reviews.paginationLabel"),
      previous: t("reviews.previousPage"),
      next: t("reviews.nextPage"),
      position: (page, pageCount) => t("reviews.pagePosition", { page, pageCount }),
    };
    render(<Pager page={2} pageCount={5} href={href} words={diverWords} />);

    expect(
      screen.getByRole("navigation", { name: t("reviews.paginationLabel") }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Anterior" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Siguiente" })).toBeInTheDocument();
    expect(screen.getByText("Página 2 de 5")).toBeInTheDocument();
  });

  /**
   * K-130. Every caller used to pass its own top margin — `mt-4` on ten lists,
   * `mt-6` on six, `mt-8` on three — so the one pager sat 16, 24 or 32px under
   * its list depending on the page it was on. The offset is the pager's.
   */
  it("owns its offset from the list above it", () => {
    render(<Pager page={2} pageCount={3} href={href} words={words} />);
    const nav = screen.getByRole("navigation", { name: "Pages" });
    expect(nav).toHaveClass("mt-6", "grid", "grid-cols-2", "sm:grid-cols-[1fr_auto_1fr]");
  });

  it("takes no margin from a caller", () => {
    // @ts-expect-error — there is no `className` to pass: the offset is the pager's own.
    render(<Pager page={2} pageCount={3} href={href} words={words} className="mt-8" />);
    const nav = screen.getByRole("navigation", { name: "Pages" });
    expect(nav).not.toHaveClass("mt-8");
    expect(nav).toHaveClass("mt-6");
  });

  /**
   * The pixel probe measured "Page 1 of 3 · 47 departures" 28px left of
   * centre: the old `justify-between` row centred its middle only while both
   * ends matched, and page 1 had an empty `<span>` where Previous goes.
   *
   * jsdom lays nothing out, so these two tests pin the structure that does the
   * centring rather than the centring itself. The geometry was measured in
   * Chromium against Tailwind's compiled utilities, at the probe's own link
   * and readout widths: 0px off centre at 328 and 358 (below `sm`) and at 592
   * and 624 (from `sm`), where three equal-outer columns on one row had left
   * the longest readout 25px off at 358 and 28px off at 328. The capture-level
   * proof is `PIXEL_PROBE=1 pnpm e2e:run e2e/visual.spec.ts --grep
   * 'staff-reviews|courses-list-page-two|booking-new'`.
   */
  it.each([
    ["first", 1, ["Next"]],
    ["middle", 3, ["Previous", "Next"]],
    ["last", 7, ["Previous"]],
  ])(
    "gives the readout its own row below sm and the middle column from sm, with no empty stand-in, on the %s page",
    (_where, page, links) => {
      render(<Pager page={page} pageCount={7} href={href} words={words} />);
      const nav = screen.getByRole("navigation", { name: "Pages" });
      const readout = screen.getByText(`Page ${page} of 7`);

      expect(nav).toHaveClass("grid", "grid-cols-2", "sm:grid-cols-[1fr_auto_1fr]");
      expect(readout).toHaveClass(
        "col-span-2",
        "row-start-1",
        "text-center",
        "sm:col-span-1",
        "sm:col-start-2",
      );
      // Only what is there: the readout and the links this page offers, in
      // reading order, and nothing empty holding a missing link's place.
      expect(nav.querySelectorAll(":scope > :empty")).toHaveLength(0);
      expect([...nav.children].map((child) => child.textContent)).toEqual(
        [
          links.includes("Previous") ? "Previous" : null,
          `Page ${page} of 7`,
          links.includes("Next") ? "Next" : null,
        ].filter(Boolean),
      );
    },
  );

  it("pins each link to its column's outer edge, on the row under the readout below sm and beside it from sm", () => {
    render(<Pager page={3} pageCount={7} href={href} words={words} />);

    expect(screen.getByRole("link", { name: "Previous" })).toHaveClass(
      "col-start-1",
      "row-start-2",
      "justify-self-start",
      "sm:row-start-1",
    );
    expect(screen.getByRole("link", { name: "Next" })).toHaveClass(
      "col-start-2",
      "row-start-2",
      "justify-self-end",
      "sm:col-start-3",
      "sm:row-start-1",
    );
  });
});
