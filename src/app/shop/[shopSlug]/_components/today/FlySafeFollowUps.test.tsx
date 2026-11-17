// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/fly-safe-correction", () => ({
  listShopFlySafeFollowUps: vi.fn(async () => [
    {
      bookingId: "seat-1",
      name: "Queue Diver",
      status: "queued",
      tripId: "current-trip",
      tripTitle: "Current trip",
      fingerprint: "a".repeat(64),
    },
    {
      bookingId: "seat-2",
      name: "Contact Diver",
      status: "follow_up",
      tripId: "other-trip",
      tripTitle: "Other trip",
      fingerprint: "b".repeat(64),
    },
  ]),
}));
vi.mock("./fly-safe-follow-up-actions", () => ({ acknowledgeFlySafeAction: vi.fn() }));
const { getDb } = await import("@/db/client");
const { staffTranslator } = await import("@/i18n/staff-messages");
const { FlySafeFollowUps } = await import("./FlySafeFollowUps");
afterEach(cleanup);

it("names each follow-up's departure, with a link to it", async () => {
  render(
    await FlySafeFollowUps({
      db: await getDb(),
      shop: { id: "shop" },
      shopSlug: "reef",
      now: new Date("2026-07-21T12:00:00Z"),
      t: staffTranslator("en-US"),
    }),
  );
  expect(screen.getByRole("link", { name: "Current trip" }).getAttribute("href")).toBe(
    "/shop/reef/trips/current-trip",
  );
  expect(screen.getByRole("link", { name: "Other trip" }).getAttribute("href")).toBe(
    "/shop/reef/trips/other-trip",
  );
  expect(screen.getByText(/Correction waiting to send/)).toBeTruthy();
});
