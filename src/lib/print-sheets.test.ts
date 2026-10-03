import { describe, expect, it } from "vitest";
import {
  PAPER_PASS_PAPER,
  PRINT_SHEET_BOX_MM,
  paperPassPath,
  passCodePayload,
  printSheetPageRule,
  storefrontAddress,
} from "./print-sheets";

describe("the paper", () => {
  it("gives the pass a fixed pagination and a printable box", () => {
    const rule = printSheetPageRule(PAPER_PASS_PAPER);
    expect(rule).toContain(`size:${PAPER_PASS_PAPER}`);
    // A margin, never none: every printer has an unprintable border, and the
    // band runs to the edge of the sheet by design.
    expect(rule).toMatch(/margin:\d+mm/);
    const box = PRINT_SHEET_BOX_MM[PAPER_PASS_PAPER];
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(box.width);
  });
});

describe("the pass's code", () => {
  it("carries the booking id and nothing else", () => {
    // Not a URL, not a name, not the shop: a pass left on a boat seat hands a
    // finder nothing it can open.
    const bookingId = "9f4b2f7e-1f1a-4a2f-9f3c-2b0c1d5e6f70";
    expect(passCodePayload(bookingId)).toBe(bookingId);
    expect(passCodePayload(bookingId)).not.toContain("http");
  });
});

describe("the fold line's address", () => {
  it("prints the storefront without a scheme, because nobody clicks paper", () => {
    expect(storefrontAddress("blue-mantis", "https://dive.day")).toBe("dive.day/s/blue-mantis");
    expect(storefrontAddress("blue-mantis", "http://localhost:3000/")).toBe(
      "localhost:3000/s/blue-mantis",
    );
  });

  it("falls back to the path rather than printing a broken host", () => {
    // A sheet saying `https://undefined/s/blue-mantis` is worse than one saying
    // where the page lives and nothing about the host.
    expect(storefrontAddress("blue-mantis", null)).toBe("/s/blue-mantis");
  });
});

describe("where a pass is drawn", () => {
  it("lives under the shop's own print segment", () => {
    expect(paperPassPath("blue-mantis", "booking-1")).toBe(
      "/shop/blue-mantis/print/pass/booking-1",
    );
  });

  it("escapes a booking id that would otherwise rewrite the route", () => {
    // `shopPath` escapes each segment, which is what stops a submitted id
    // traversing out of the print segment.
    expect(paperPassPath("blue-mantis", "../../orders")).not.toContain("/orders");
  });
});
