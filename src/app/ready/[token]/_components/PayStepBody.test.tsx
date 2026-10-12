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
});
