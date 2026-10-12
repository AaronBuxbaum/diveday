// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { getDb } from "@/db/client";
import type { ReadyPageData } from "@/db/ready";
import { diverTranslator } from "@/i18n/messages";
import { TripCancelledCard } from "./TripCancelledCard";

vi.mock("./CarriedPreparation", () => ({ CarriedPreparation: () => <p>carried</p> }));

const t = diverTranslator("en-US");

afterEach(cleanup);

describe("TripCancelledCard", () => {
  it("says the departure is off, names the shop, and points at what is next", () => {
    const data = {
      detail: { shop: { name: "Blue Mantis Divers" } },
      shop: { slug: "blue-mantis", contactEmail: "hi@example.com", contactPhone: null },
    } as unknown as ReadyPageData;
    render(<TripCancelledCard db={{} as Awaited<ReturnType<typeof getDb>>} data={data} t={t} />);
    expect(screen.getByText(t("booking.cancelledHeading"))).toBeTruthy();
    expect(screen.getByText(t("ready.tripCancelledBody"))).toBeTruthy();
    expect(screen.getByText(/Blue Mantis Divers/)).toBeTruthy();
    expect(screen.getByText("carried")).toBeTruthy();
    expect(screen.getByRole("link", { name: t("recap.seeWhatsNext") }).getAttribute("href")).toBe(
      "/s/blue-mantis",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
