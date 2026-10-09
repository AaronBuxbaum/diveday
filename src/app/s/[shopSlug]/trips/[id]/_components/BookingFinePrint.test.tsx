// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { BookingFinePrint } from "./BookingFinePrint";
import type { Shop, Trip } from "./types";

afterEach(cleanup);

const NOTE = /anyone trying it can see what you type here/;

const trip = {
  cancellationWindowHours: 24,
  startsAt: new Date("2026-08-29T15:00:00Z"),
} as Trip;

function shop(overrides: Partial<Shop>): Shop {
  return { timezone: "America/New_York", slug: "blue-mantis", isDemo: true, ...overrides } as Shop;
}

/**
 * The canonical demo's public pages are one shop every visitor shares, so a
 * name or an email typed into its booking form is there for the next visitor
 * to read (security review of ADR 20261009-demo-test-mode-payments).
 */
describe("BookingFinePrint", () => {
  it("tells a visitor on the shared demo that others can see what they type", () => {
    render(<BookingFinePrint shop={shop({})} trip={trip} locale={DEFAULT_DIVER_LOCALE} />);
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.getByText(/Free cancellation until/)).toBeInTheDocument();
  });

  it("says nothing of the kind on a real shop, or on a visitor's own demo", () => {
    for (const other of [
      shop({ isDemo: false }),
      shop({ slug: "coral-cove-divers-a1b2c3", isDemo: true }),
    ]) {
      render(<BookingFinePrint shop={other} trip={trip} locale={DEFAULT_DIVER_LOCALE} />);
      expect(screen.queryByText(NOTE)).toBeNull();
      cleanup();
    }
  });
});
