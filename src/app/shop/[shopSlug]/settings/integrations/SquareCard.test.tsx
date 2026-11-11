// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { SquareCard } from "./SquareCard";

afterEach(cleanup);

vi.mock("./actions", () => ({
  chooseSquareLocationAction: vi.fn(),
  startSquareConnectionAction: vi.fn(),
  disconnectIntegrationAction: vi.fn(),
}));
const t = staffTranslator("en-US");
const row = {
  id: "connection",
  provider: "square" as const,
  status: "connected" as const,
  externalAccountId: "merchant",
  externalLabel: "Square",
  settings: { environment: "sandbox" as const },
  lastSyncedAt: null,
  lastError: null,
  connectedAt: new Date("2026-11-11T00:00:00Z"),
  updatedAt: new Date("2026-11-11T00:00:00Z"),
};

describe("Square connection card", () => {
  it("does not advertise a connector without deployment configuration", () => {
    const { container } = render(<SquareCard t={t} configured={false} locations={null} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("offers a deliberate connection, not payment capture", () => {
    render(<SquareCard t={t} configured locations={null} />);
    expect(screen.getByRole("button", { name: t("integrations.square.connect") })).toBeEnabled();
    expect(screen.getByText(t("integrations.square.description"))).toBeInTheDocument();
  });
  it("requires a chosen location and labels sandbox evidence", () => {
    render(
      <SquareCard
        t={t}
        configured
        row={row}
        locations={[
          { id: "location", name: "Dive counter", currency: "usd", merchantId: "merchant" },
        ]}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: t("integrations.square.location") }),
    ).toBeRequired();
    expect(screen.getByRole("option", { name: "Dive counter" })).toBeInTheDocument();
    expect(screen.getByText(t("integrations.square.sandbox"))).toBeInTheDocument();
  });
  it("keeps the disconnect door when deployment credentials are unavailable", () => {
    render(<SquareCard t={t} configured={false} row={row} locations={null} />);
    expect(screen.getByRole("button", { name: t("integrations.square.reconnect") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("integrations.common.disconnect") })).toBeEnabled();
    expect(screen.getByText(t("integrations.notice.not-configured"))).toBeInTheDocument();
  });
});
