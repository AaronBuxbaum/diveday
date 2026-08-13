// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Table, TBody, Td, THead, Th } from "./table";

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
    // The shell scrolls; it never clips (overflow-hidden once swallowed the
    // orders Amount column on a phone).
    const shell = table.parentElement;
    expect(shell).toHaveClass("overflow-x-auto");
    expect(shell).not.toHaveClass("overflow-hidden");
    // Paper opts out of the scroll rule.
    expect(shell).toHaveClass("print:overflow-visible");
    // Semantics: a header cell that screen readers can map to its column.
    expect(screen.getByRole("columnheader", { name: "Diver" })).toHaveAttribute("scope", "col");
    expect(screen.getByRole("cell", { name: "Ana Reyes" })).toBeInTheDocument();
  });

  it("clamps to a minimum width on screen and releases it in print", () => {
    render(
      <Table minWidth="40rem">
        <TBody>
          <tr>
            <Td />
          </tr>
        </TBody>
      </Table>,
    );
    const table = screen.getByRole("table");
    expect(table).toHaveClass("min-w-[40rem]");
    expect(table).toHaveClass("print:min-w-0");
  });

  it("right-aligns numeric columns with tabular figures, header and cells alike", () => {
    render(
      <Table>
        <THead>
          <Th numeric>Amount</Th>
        </THead>
        <TBody>
          <tr>
            <Td numeric>$120.00</Td>
          </tr>
        </TBody>
      </Table>,
    );
    expect(screen.getByRole("columnheader", { name: "Amount" })).toHaveClass("text-right");
    const cell = screen.getByRole("cell", { name: "$120.00" });
    expect(cell).toHaveClass("text-right");
    expect(cell).toHaveClass("tabular-nums");
  });

  it("hides folded columns below the named breakpoint", () => {
    render(
      <Table>
        <THead>
          <Th hideBelow="sm">Trip</Th>
          <Th hideBelow="md">Offers</Th>
        </THead>
        <TBody>
          <tr>
            <Td hideBelow="sm">Two-Tank Reef</Td>
            <Td hideBelow="md">None yet</Td>
          </tr>
        </TBody>
      </Table>,
    );
    expect(screen.getByRole("columnheader", { name: "Trip" })).toHaveClass(
      "hidden",
      "sm:table-cell",
    );
    expect(screen.getByRole("cell", { name: "Two-Tank Reef" })).toHaveClass(
      "hidden",
      "sm:table-cell",
    );
    expect(screen.getByRole("cell", { name: "None yet" })).toHaveClass("hidden", "md:table-cell");
  });

  it("lets a reflowing tbody own its row padding", () => {
    render(
      <Table>
        <TBody className="block sm:table-row-group">
          <tr>
            <Td pad={false} className="sm:px-4 sm:py-3">
              Aug 4
            </Td>
          </tr>
        </TBody>
      </Table>,
    );
    const cell = screen.getByRole("cell", { name: "Aug 4" });
    expect(cell).not.toHaveClass("px-4");
    expect(cell).not.toHaveClass("py-3");
    // Row dividers stay with the tbody even when it reflows.
    expect(cell.closest("tbody")).toHaveClass("divide-y", "block");
  });

  it("keeps a printed row on one page", () => {
    render(
      <Table>
        <TBody>
          <tr>
            <Td>Row</Td>
          </tr>
        </TBody>
      </Table>,
    );
    // A row that splits across a page boundary separates a diver from their
    // roll-call marks on the departure log.
    expect(screen.getByRole("cell", { name: "Row" }).closest("tbody")).toHaveClass(
      "[&>tr]:break-inside-avoid",
    );
  });
});
