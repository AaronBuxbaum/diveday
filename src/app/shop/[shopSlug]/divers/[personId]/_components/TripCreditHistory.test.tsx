// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { TripCreditHistory, tripCreditEntryKey } from "./TripCreditHistory";

afterEach(cleanup);

const occurredAt = new Date("2026-11-20T15:00:00Z");
const entries = [
  {
    id: "referral",
    kind: "grant" as const,
    reason: "referral" as const,
    amountCents: 2_500,
    currency: "usd",
    occurredAt,
  },
  {
    id: "goodwill",
    kind: "grant" as const,
    reason: "goodwill" as const,
    amountCents: 1_000,
    currency: "usd",
    occurredAt,
  },
];

describe("trip credit history", () => {
  it.each([
    ["en-US", "Brought a buddy", "Granted"],
    ["es-ES", "Trajo a alguien", "Otorgado"],
  ])("names a buddy's credit apart from a staff grant in %s", (locale, referral, granted) => {
    const t = staffTranslator(locale);
    render(
      <TripCreditHistory
        entries={entries}
        locale={locale}
        timezone="UTC"
        title={t("divers.tripCredit.history")}
        kindLabel={(entry) => t(tripCreditEntryKey(entry))}
      />,
    );
    expect(screen.getByText(new RegExp(`^${referral} · `))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^${granted} · `))).toBeInTheDocument();
    expect(screen.getByText(/\+\$25\.00|\+25,00/)).toBeInTheDocument();
  });

  it("draws nothing without entries", () => {
    const { container } = render(
      <TripCreditHistory
        entries={[]}
        locale="en-US"
        timezone="UTC"
        title=""
        kindLabel={() => ""}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
