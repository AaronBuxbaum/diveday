// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "@/db/client";
import type { ReadyPageData } from "@/db/ready";
import { diverTranslator } from "@/i18n/messages";
import { TripCancelledCard } from "./TripCancelledCard";

vi.mock("./CarriedPreparation", () => ({ CarriedPreparation: () => <p>carried</p> }));

vi.mock("@/components/SubmitButton", () => ({
  SubmitButton: ({ children }: { children: React.ReactNode }) => (
    <button type="submit">{children}</button>
  ),
}));

const t = diverTranslator("en-US");
const DB = {} as Awaited<ReturnType<typeof getDb>>;
const DATA = {
  detail: { shop: { name: "Blue Mantis Divers", timezone: "America/New_York" } },
  shop: { slug: "blue-mantis", contactEmail: "hi@example.com", contactPhone: null },
} as unknown as ReadyPageData;
const OFFER = {
  tripId: "7b1d2e3f-aaaa-4bbb-8ccc-dddddddddddd",
  title: "Two-Tank Reef",
  startsAt: new Date("2026-10-29T16:00:00Z"),
};
const action = vi.fn(async () => {});

afterEach(cleanup);

describe("TripCancelledCard", () => {
  it("says the departure is off, names the shop, and points at what is next", () => {
    const data = {
      detail: { shop: { name: "Blue Mantis Divers" } },
      shop: { slug: "blue-mantis", contactEmail: "hi@example.com", contactPhone: null },
    } as unknown as ReadyPageData;
    render(<TripCancelledCard db={DB} data={data} t={t} locale="en-US" />);
    expect(screen.getByText(t("booking.cancelledHeading"))).toBeTruthy();
    expect(screen.getByText(t("ready.tripCancelledBody"))).toBeTruthy();
    expect(screen.getByText(/Blue Mantis Divers/)).toBeTruthy();
    expect(screen.getByText("carried")).toBeTruthy();
    expect(screen.getByRole("link", { name: t("recap.seeWhatsNext") }).getAttribute("href")).toBe(
      "/s/blue-mantis",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers one boat as an ask, with the schedule still below it", () => {
    render(
      <TripCancelledCard
        db={DB}
        data={DATA}
        t={t}
        locale="en-US"
        moveAsk={{ state: "open", offer: OFFER }}
        action={action}
      />,
    );
    expect(screen.getByText(t("ready.moveOffer.lead", { title: "Two-Tank Reef" }))).toBeTruthy();
    const button = screen.getByRole("button", {
      name: /^Ask to move to Thu, Oct\s29, 12:00\sPM\sEDT$/,
    });
    const form = button.closest("form");
    if (!form) throw new Error("the ask is not a form");
    expect(within(form).getByDisplayValue(OFFER.tripId).getAttribute("name")).toBe("tripId");
    expect(screen.getByRole("link", { name: t("recap.seeWhatsNext") }).getAttribute("href")).toBe(
      "/s/blue-mantis",
    );
  });

  it("says the ask stands instead of offering it again", () => {
    render(
      <TripCancelledCard
        db={DB}
        data={DATA}
        t={t}
        locale="en-US"
        moveAsk={{ state: "asked" }}
        action={action}
      />,
    );
    expect(screen.getByText(t("ready.moveAsk.asked", { shop: "Blue Mantis Divers" }))).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says a tap filed nothing, and offers what is true now", () => {
    render(<TripCancelledCard db={DB} data={DATA} t={t} locale="en-US" notice="move-ask" />);
    expect(screen.getByRole("status").textContent).toBe(t("ready.moveAsk.unavailable"));
    expect(screen.queryByRole("button")).toBeNull();
  });
});
