// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDiver } from "@/test/intl";
import { type PackageOffer, PackagePurchaseForm } from "./PackagePurchaseForm";

vi.mock("../actions", () => ({ buyPackageAction: vi.fn() }));
afterEach(cleanup);
const offers: PackageOffer[] = [
  {
    id: "five",
    name: "Five dives",
    priceText: "$200",
    facts: ["5 dives", "$40 a dive", "No expiry date"],
    tankNote: "One dive is one tank",
  },
  {
    id: "ten",
    name: "Ten dives",
    priceText: "$375",
    facts: ["10 dives", "$37.50 a dive", "Use by Dec 31, 2026"],
    tankNote: "One dive is one tank",
  },
];
describe("package tank accounting", () => {
  it("describes the whole choice once while preserving the different option facts", () => {
    renderDiver(<PackagePurchaseForm shopSlug="blue-mantis" offers={offers} today="2026-11-16" />);
    expect(screen.getByText("$200")).toBeVisible();
    expect(screen.getByText("$375")).toBeVisible();
    expect(screen.getAllByText("One dive is one tank")).toHaveLength(1);
    expect(screen.getByRole("group")).toHaveAccessibleDescription("One dive is one tank");
    expect(screen.getByRole("radio", { name: /Five dives/ })).toHaveAccessibleName(
      /5 dives.*\$40 a dive.*No expiry date/,
    );
    expect(screen.getByRole("radio", { name: /Ten dives/ })).toHaveAccessibleName(
      /10 dives.*\$37.50 a dive.*Use by Dec 31, 2026/,
    );
  });
  it("keeps genuinely different tank terms with their own option", () => {
    renderDiver(
      <PackagePurchaseForm
        shopSlug="blue-mantis"
        today="2026-11-16"
        offers={[offers[0], { ...offers[1], tankNote: "Different tank accounting" }]}
      />,
    );
    expect(screen.getByRole("group")).not.toHaveAttribute("aria-describedby");
    expect(screen.getByRole("radio", { name: /Five dives/ })).toHaveAccessibleName(
      /One dive is one tank/,
    );
    expect(screen.getByRole("radio", { name: /Ten dives/ })).toHaveAccessibleName(
      /Different tank accounting/,
    );
  });
});

describe("a package as a gift (issue 4629)", () => {
  it("asks for the recipient and a send date only once it is a gift, today by default", () => {
    renderDiver(<PackagePurchaseForm shopSlug="blue-mantis" offers={offers} today="2026-11-16" />);
    expect(screen.queryByLabelText("Their email")).toBeNull();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "This is a gift" }));
    expect(screen.getByLabelText("Your name")).toBeRequired();
    expect(screen.getByLabelText("Their name")).toBeRequired();
    expect(screen.getByLabelText("Their email")).toHaveAttribute("type", "email");
    const date = screen.getByLabelText("Send the gift email on");
    expect(date).toHaveValue("2026-11-16");
    expect(date).toHaveAttribute("min", "2026-11-16");
    expect(screen.getByText(/The receipt is yours/)).toBeInTheDocument();
  });
});
