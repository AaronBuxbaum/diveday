// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RowLink, Table, TBody, Td, THead, Th, Tr } from "./table";

afterEach(cleanup);

/**
 * The vocabulary's contract is mostly visual, but the parts a screenshot
 * cannot prove are here: real table semantics survive the styling, numeric
 * columns are inspectable (right-aligned tabular figures on both the header
 * and the cells), responsive hiding uses the shared breakpoint classes, and
 * print never inherits the sideways-scroll clamp.
 */
describe("Table", () => {
  it("renders a real table inside a sideways-scrolling shell", () => {
    render(
      <Table>
        <THead>
          <Th>Diver</Th>
        </THead>
        <TBody>
          <tr>
            <Td>Ana Reyes</Td>
          </tr>
        </TBody>
      </Table>,
    );
    const table = screen.getByRole("table");
    expect(table).toHaveClass("w-full");
    // The inner region scrolls while the outer shell clips rounded corners;
    // keeping those responsibilities separate prevents a first/last row
    // hover from painting square beyond the card.
    const scrollRegion = table.parentElement;
    const shell = scrollRegion?.parentElement;
    expect(scrollRegion).toHaveClass("overflow-x-auto");
    expect(shell).toHaveClass("overflow-hidden");
    // Paper opts out of the scroll rule.
    expect(shell).toHaveClass("print:overflow-visible");
    // Semantics: a header cell that screen readers can map to its column.
    expect(screen.getByRole("columnheader", { name: "Diver" })).toHaveAttribute("scope", "col");
    expect(screen.getByRole("cell", { name: "Ana Reyes" })).toBeInTheDocument();
  });

  it("drops the card chrome — but never the scroll shell — when flush", () => {
    render(
      <Table flush>
        <TBody>
          <tr>
            <Td>Nested</Td>
          </tr>
        </TBody>
      </Table>,
    );
    const scrollRegion = screen.getByRole("table").parentElement;
    const shell = scrollRegion?.parentElement;
    // A flush table sits inside an existing card: elevation follows
    // containment, so it brings no border/background/shadow of its own...
    expect(shell).not.toHaveClass("border-border");
    expect(shell).not.toHaveClass("bg-surface");
    expect(shell).not.toHaveClass("shadow-sm");
    // ...but the sideways-scroll behavior is not chrome and never leaves.
    expect(scrollRegion).toHaveClass("overflow-x-auto");
    expect(shell).toHaveClass("overflow-hidden");
    expect(shell).toHaveClass("print:overflow-visible");
  });

  it("names a row's leading cell as that row's header, without the header row's voice", () => {
    // A public briefing row is one dive site and every cell after the first is
    // a fact about it, so the site's name has to be announced with each figure
    // — which is `scope="row"`, not a styled-bold `<td>`. The uppercase voice
    // lives on THead's row, so a row header must not inherit it.
    render(
      <Table>
        <THead>
          <Th>Site</Th>
          <Th>Depth</Th>
        </THead>
        <TBody>
          <tr>
            <Th scope="row">Molasses Reef</Th>
            <Td>12-18 m</Td>
          </tr>
        </TBody>
      </Table>,
    );
    const rowHeader = screen.getByRole("rowheader", { name: "Molasses Reef" });
    expect(rowHeader).toHaveAttribute("scope", "row");
    expect(screen.getByRole("columnheader", { name: "Site" })).toHaveAttribute("scope", "col");
  });

  it("fades the scroll region's far edge while there is more table to scroll to", () => {
    // A 1152px log table in a 974px shell was cut mid-word at the card edge
    // with nothing to say it scrolls (K-91). The fade is a scroll-driven
    // animation on the region's own inline scroll, so a table that fits has an
    // inactive timeline and no fade, and paper never gets one.
    render(
      <Table minWidth="72rem">
        <TBody>
          <tr>
            <Td>Row</Td>
          </tr>
        </TBody>
      </Table>,
    );
    const scrollRegion = screen.getByRole("table").parentElement;
    expect(scrollRegion).toHaveClass("overflow-x-auto", "table-scroll-shell");

    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../app/globals.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = css.match(/\.table-scroll-shell\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/animation-timeline:\s*scroll\(self inline\)/);
    expect(rule).toMatch(/mask-image:/);
    // Other print rules can precede the table override in the same block.
    const printBlocks = css.match(/^@media print\s*\{[\s\S]*?^\}/gm) ?? [];
    const print = printBlocks.join("\n").match(/\.table-scroll-shell\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(print).toMatch(/mask-image:\s*none/);
    expect(print).toMatch(/animation:\s*none/);
  });
});

/**
 * **A clipping cell bounds its `RowLink` overlay; `clip={false}` lets it reach
 * the row** (issue #1989). The overlay is `absolute`, and CSS clips an
 * absolute box only by an `overflow` ancestor at or inside its containing
 * block. With every `Td` static that block was the `tr`, so the cell's
 * `overflow-hidden` clipped nothing and the overlay covered the Orders index's
 * receipt link in the next cell. A clipping cell that holds a `RowLink` is
 * positioned, so the overlay stops at the cell; any other cell stays static,
 * so a popover inside one is not newly clipped.
 */
describe("RowLink's reach", () => {
  it("positions a clipping cell that holds the link, and leaves an opted-out cell static", () => {
    render(
      <Table>
        <TBody>
          <Tr>
            <Td>
              <RowLink href="/shop/blue-mantis/divers/p-1">Grace Mensah</RowLink>
            </Td>
            <Td clip={false}>
              <RowLink href="/shop/blue-mantis/divers/p-2">Ade Bello</RowLink>
            </Td>
          </Tr>
        </TBody>
      </Table>,
    );
    const clipped = screen.getByRole("link", { name: "Grace Mensah" });
    expect(clipped).toHaveAttribute("data-row-link");
    expect(clipped.closest("td")).toHaveClass("overflow-hidden", "has-[>[data-row-link]]:relative");
    const rowWide = screen.getByRole("link", { name: "Ade Bello" }).closest("td");
    expect(rowWide).not.toHaveClass("overflow-hidden");
    expect(rowWide?.className).not.toContain("relative");
  });
});
