// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { TripAboutLinks } from "./TripAboutLinks";

vi.mock("../print-actions", () => ({ recordTripPrintPdfAction: async () => {} }));
vi.mock("./CopyLinkButton", () => ({
  CopyLinkButton: ({ path }: { path: string }) => <span data-copy={path}>copy</span>,
}));
vi.mock("./PrintTripBundleButton", () => ({
  PrintTripBundleButton: ({ href }: { href: string }) => <a href={href}>print</a>,
}));
vi.mock("./DepartureLogLink", () => ({ DepartureLogLink: () => <span>log</span> }));
vi.mock("./PrintWithMedicalAlertsLink", () => ({
  PrintWithMedicalAlertsLink: () => <span>print with alerts</span>,
}));

const t = staffTranslator("en-US");

afterEach(cleanup);

describe("TripAboutLinks", () => {
  it("copies and opens the public page, prints the packet, and offers the log", () => {
    const { container } = render(
      <TripAboutLinks
        shop={{ id: "shop", slug: "blue-mantis", defaultLocale: "en-US" }}
        personId="person"
        shopSlug="blue-mantis"
        tripId="trip-1"
        t={t}
      />,
    );
    expect(container.querySelector("[data-copy]")?.getAttribute("data-copy")).toBe(
      "/s/blue-mantis/trips/trip-1",
    );
    const open = screen.getByRole("link", { name: t("trips.about.viewPublic") });
    expect(open.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("print").getAttribute("href")).toBe(
      "/shop/blue-mantis/trips/trip-1/print",
    );
    expect(screen.getByText("log")).toBeTruthy();
    expect(screen.getByText("print with alerts")).toBeTruthy();
  });
});
