import { describe, expect, it } from "vitest";
import {
  CAPABILITY_PAGE_PRINT_MARGIN_MM,
  capabilityPagePrintRule,
  PAPER_PASS_PAPER,
  PRINT_SHEET_BOX_MM,
  paperAddress,
  paperPassPath,
  passCodePayload,
  printSheetPageRule,
  storefrontAddress,
  tripMedicalAlertsPacketPath,
  tripPacketPath,
} from "./print-sheets";

describe("the paper", () => {
  it("gives the pass a fixed pagination and a printable box", () => {
    const rule = printSheetPageRule(PAPER_PASS_PAPER);
    // In millimetres, never the named size: Chromium drops `size: A6` as an
    // unknown keyword, and the card then printed in the corner of a Letter page.
    expect(rule).toContain("size:105mm 148mm");
    expect(rule).not.toMatch(/size:\s*A6/);
    // A margin, never none: every printer has an unprintable border, and the
    // band runs to the edge of the sheet by design.
    expect(rule).toMatch(/margin:\d+mm/);
    const box = PRINT_SHEET_BOX_MM[PAPER_PASS_PAPER];
    expect(box.width).toBeGreaterThan(0);
    expect(box.height ?? 0).toBeGreaterThan(box.width);
  });
});

describe("a page opened by a bearer link, on paper", () => {
  it("leaves the browser no margin to print the link in, and pads the content instead", () => {
    const rule = capabilityPagePrintRule();
    expect(rule).toMatch(/@page\{margin:0;/);
    expect(rule).toContain("@bottom-right{content:none}");
    expect(rule).toContain(`@media print{body{padding:${CAPABILITY_PAGE_PRINT_MARGIN_MM}mm}`);
  });

  it("lets no named page bring a margin back, even one a kept-alive route still declares", () => {
    expect(capabilityPagePrintRule()).toContain("body,[data-departure-paper]{page:auto!important}");
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

  it("prints any diver page's address by the same rule", () => {
    expect(paperAddress("/s/blue-mantis/courses/owd", "https://dive.day/")).toBe(
      "dive.day/s/blue-mantis/courses/owd",
    );
    expect(paperAddress("/s/blue-mantis/courses/owd", null)).toBe("/s/blue-mantis/courses/owd");
  });
});

describe("where a packet is drawn", () => {
  it("is the departure's own print state", () => {
    expect(tripPacketPath("blue-mantis", "trip-1")).toBe("/shop/blue-mantis/trips/trip-1?print=1");
  });

  it("escapes a trip id that would otherwise rewrite the route", () => {
    expect(tripPacketPath("blue-mantis", "../../orders")).not.toContain("/orders");
  });

  it("draws the packet with the medical alerts in the same print state", () => {
    expect(tripMedicalAlertsPacketPath("blue-mantis", "trip-1")).toBe(
      "/shop/blue-mantis/trips/trip-1?print=medical-alerts",
    );
    expect(tripMedicalAlertsPacketPath("blue-mantis", "../../orders")).not.toContain("/orders");
  });
});

describe("where a pass is drawn", () => {
  it("lives on the departure it boards", () => {
    expect(paperPassPath("blue-mantis", "trip-1", "booking-1")).toBe(
      "/shop/blue-mantis/trips/trip-1?pass=booking-1",
    );
  });

  it("escapes a booking id that would otherwise rewrite the route", () => {
    // Both ids are escaped, so neither can traverse out of the departure.
    expect(paperPassPath("blue-mantis", "../../orders", "../x")).not.toContain("/orders");
    expect(paperPassPath("blue-mantis", "trip-1", "a&b=c")).toBe(
      "/shop/blue-mantis/trips/trip-1?pass=a%26b%3Dc",
    );
  });
});
