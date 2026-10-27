// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MixedTrainingAdvisory } from "./MixedTrainingAdvisory";

afterEach(cleanup);

describe("mixed training advisory", () => {
  it("identifies a possible overlap without asserting a group or blocking the sale", async () => {
    render(
      await MixedTrainingAdvisory({
        sessions: Promise.resolve([
          {
            tripId: "other",
            title: "Open Water session",
            startsAt: new Date("2026-07-21T14:00:00Z"),
          },
        ]),
        shopSlug: "blue-mantis",
        locale: "en-US",
        timeZone: "America/New_York",
      }),
    );
    expect(screen.getByText(/If students from these sessions train together/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open Water session/ }).getAttribute("href")).toBe(
      "/shop/blue-mantis/trips/other",
    );
  });

  it("renders nothing without a potential overlap", async () => {
    const view = render(
      await MixedTrainingAdvisory({
        sessions: Promise.resolve([]),
        shopSlug: "blue-mantis",
        locale: "en-US",
        timeZone: "America/New_York",
      }),
    );
    expect(view.container).toBeEmptyDOMElement();
  });
});
