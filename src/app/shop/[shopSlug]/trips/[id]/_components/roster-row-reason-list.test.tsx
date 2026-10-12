// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RosterArrival } from "./roster-model";
import { type RowReasonListInput, rowReasonList } from "./roster-row-reason-list";

afterEach(cleanup);

/**
 * `rowReasonList`'s whole input is one seat fact and the lines `rowReasonLines`
 * wrote, so it is built here as a literal: no seat, no chain.
 */
const lines: RowReasonListInput["reasonLines"] = [
  { key: "certification", text: "No certification on file", tone: "danger" },
  { key: "payment", text: "Not paid", tone: "warning" },
  { key: "recency", text: "Last dived over two years ago", tone: "warning" },
] as RowReasonListInput["reasonLines"];

describe("rowReasonList, from one literal input", () => {
  it("says every line under the name off the desk", () => {
    const { reasonList, deskPrivateLines } = rowReasonList({
      arrival: undefined,
      reasonLines: lines,
    });
    render(<>{reasonList}</>);
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "No certification on file",
      "Not paid",
      "Last dived over two years ago",
    ]);
    expect(deskPrivateLines).toEqual([]);
  });

  /**
   * At the desk the row is read across a counter: what a diver owes and how
   * long since they dived move behind the row's mark, and the blocker stays.
   */
  it("keeps payment and recency off the open row at the desk", () => {
    const { reasonList, deskPrivateLines } = rowReasonList({
      arrival: {} as RosterArrival,
      reasonLines: lines,
    });
    render(<>{reasonList}</>);
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "No certification on file",
    ]);
    expect(deskPrivateLines.map(({ key }) => key)).toEqual(["payment", "recency"]);
  });

  it("draws nothing for a seat with no lines", () => {
    expect(rowReasonList({ arrival: undefined, reasonLines: [] }).reasonList).toBeNull();
  });
});
