// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TicketMark } from "./TicketMark";

const TRIP = "11111111-2222-4333-8444-555555555555";
const mark = (container: HTMLElement) => container.querySelector("[data-ticket-mark]");

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Issue #4386: the bubbles rise on the first open of a departure's ticket and never again.
describe("TicketMark", () => {
  it("rises on the first open, with the existing entrance only", () => {
    const { container } = render(<TicketMark tripId={TRIP} />);
    expect(mark(container)?.getAttribute("data-ticket-mark")).toBe("rise");
    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(3);
    for (const circle of circles) expect(circle.getAttribute("class")).toBe("rise-in");
  });

  it("sits still on every later open", () => {
    render(<TicketMark tripId={TRIP} />);
    cleanup();
    const { container } = render(<TicketMark tripId={TRIP} />);
    expect(mark(container)?.getAttribute("data-ticket-mark")).toBe("still");
    expect(container.querySelector(".rise-in")).toBeNull();
  });

  it("rises again for a different departure", () => {
    render(<TicketMark tripId={TRIP} />);
    cleanup();
    const { container } = render(<TicketMark tripId="99999999-2222-4333-8444-555555555555" />);
    expect(mark(container)?.getAttribute("data-ticket-mark")).toBe("rise");
  });

  it("still draws the mark when storage refuses", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { container } = render(<TicketMark tripId={TRIP} />);
    expect(mark(container)?.getAttribute("data-ticket-mark")).toBe("rise");
    expect(container.querySelector("circle")?.getAttribute("opacity")).toBeNull();
  });

  it("is decoration, hidden from the accessibility tree", () => {
    const { container } = render(<TicketMark tripId={TRIP} />);
    expect(mark(container)?.getAttribute("aria-hidden")).toBe("true");
  });
});
