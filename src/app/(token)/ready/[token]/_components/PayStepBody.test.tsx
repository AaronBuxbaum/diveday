// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { PayStepBody } from "./PayStepBody";

vi.mock("../booking-actions", () => ({ payFromReady: async () => {} }));
vi.mock("@/app/s/[shopSlug]/trips/[id]/_components/TripTerms", () => ({
  TripTerms: () => <p>terms</p>,
}));

const t = diverTranslator("en-US");
const shop = {} as Parameters<typeof PayStepBody>[0]["fullShop"];
const trip = {} as Parameters<typeof PayStepBody>[0]["fullTrip"];

afterEach(cleanup);

describe("PayStepBody", () => {
  it("offers the pay button and the trip's terms on a payable booking", () => {
    render(
      <PayStepBody
        token="tok"
        payable
        depositBalanceLine={null}
        actionButton="btn"
        fullShop={shop}
        fullTrip={trip}
        locale="en-US"
        t={t}
      />,
    );
    expect(screen.getByRole("button", { name: t("ready.payForTrip") })).toBeTruthy();
    expect(screen.getByText("terms")).toBeTruthy();
  });

  it("states a deposit's balance with no button when nothing is payable here", () => {
    render(
      <PayStepBody
        token="tok"
        payable={false}
        depositBalanceLine="$50 left to pay"
        actionButton="btn"
        fullShop={shop}
        fullTrip={trip}
        locale="en-US"
        t={t}
      />,
    );
    expect(screen.getByText("$50 left to pay")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("terms")).toBeNull();
  });

  const breakdown = {
    summary: "Your package dives",
    rows: ["3 dives · Courses not included", "2 dives · Courses included"],
    note: "Used soonest-ending first, one dive per tank.",
  };

  it("is the whole body of a settled step, which the diver opens to read it (issue 4309)", () => {
    render(
      <PayStepBody
        token="tok"
        payable={false}
        depositBalanceLine={null}
        packageBreakdown={breakdown}
        actionButton="btn"
        fullShop={shop}
        fullTrip={trip}
        locale="en-US"
        t={t}
      />,
    );
    expect(screen.getByRole("region", { name: "Your package dives" })).toBeTruthy();
    expect(screen.getByText("3 dives · Courses not included")).toBeTruthy();
    expect(screen.getByText("Used soonest-ending first, one dive per tank.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("stays shut behind its own disclosure beside the pay button", () => {
    render(
      <PayStepBody
        token="tok"
        payable
        depositBalanceLine={null}
        packageBreakdown={breakdown}
        actionButton="btn"
        fullShop={shop}
        fullTrip={trip}
        locale="en-US"
        t={t}
      />,
    );
    const details = screen.getByText("Your package dives").closest("details");
    expect(details?.open).toBe(false);
    expect(screen.getByRole("button", { name: t("ready.payForTrip") })).toBeTruthy();
  });
});
