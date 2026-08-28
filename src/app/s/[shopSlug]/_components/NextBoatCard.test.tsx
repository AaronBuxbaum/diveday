// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { NextBoatCard } from "./NextBoatCard";

/**
 * The next-boat card's pins for ADR 20260827-clearwater-surface-language,
 * decision 8: the storefront's one card and its one primary.
 */
const t = diverTranslator("en-US");

afterEach(cleanup);

function card(overrides: Partial<Parameters<typeof NextBoatCard>[0]> = {}) {
  return (
    <NextBoatCard
      href="/s/blue-mantis/trips/trip-1#book"
      when="tomorrow"
      time="7:30 PM"
      title="Night Dive — City of Washington"
      description="Torches, tarpon, and bioluminescence."
      spots="5 spots left"
      price="$120.00"
      t={t}
      {...overrides}
    />
  );
}

describe("the page's one primary", () => {
  it("is 'Book this boat', and it lands on the trip page's booking anchor", () => {
    render(card());

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Book this boat");
    expect(links[0]).toHaveAttribute("href", "/s/blue-mantis/trips/trip-1#book");
  });

  it("wears the primary variant, and is the only control on the card", () => {
    render(card());

    expect(screen.getByRole("link").className).toContain("bg-primary");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("what the card says", () => {
  it("leads with the time as a figure, the day as its caption", () => {
    render(card());

    expect(screen.getByText(/7:30 PM/)).toHaveClass("tabular-nums");
    expect(screen.getByText("tomorrow")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Night Dive — City of Washington",
    );
  });

  it("keeps one description line — the one detail the week rows gave up", () => {
    render(card());

    expect(screen.getByText("Torches, tarpon, and bioluminescence.")).toBeInTheDocument();
  });

  it("renders no description line when the shop wrote none", () => {
    render(card({ description: null }));

    expect(screen.queryByText(/Torches/)).not.toBeInTheDocument();
  });

  it("renders no price for a departure with no price set", () => {
    const { container } = render(card({ price: null }));

    expect(container.textContent).not.toContain("$");
    expect(container.textContent).not.toContain("per diver");
    expect(screen.getByText("5 spots left")).toBeInTheDocument();
  });
});

describe("elevation is earned", () => {
  it("is flat and rounded-2xl — the rounded-3xl tinted hero it replaced is gone", () => {
    const { container } = render(card());
    const panel = container.firstElementChild as HTMLElement;

    expect(panel.className).toContain("rounded-2xl");
    expect(panel.className).not.toContain("rounded-3xl");
    expect(panel.className).not.toContain("shadow");
  });
});
