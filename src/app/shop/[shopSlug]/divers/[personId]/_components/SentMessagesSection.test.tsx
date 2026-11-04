// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { SentMessagesSection } from "./SentMessagesSection";

afterEach(cleanup);

const at = new Date("2026-11-02T15:30:00Z");
const row = (id: string, kind: string, status: string, providerStatus: string | null = null) =>
  ({ id, kind, status, providerStatus, attemptedAt: at }) as never;

describe("SentMessagesSection", () => {
  it("draws nothing for a diver the shop sent nothing", () => {
    const { container } = render(
      <SentMessagesSection
        messages={[]}
        locale="en-US"
        timezone="America/Cancun"
        t={staffTranslator("en-US")}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names each send and how it landed, preferring what the provider reported", () => {
    render(
      <SentMessagesSection
        messages={[
          row("1", "booking_confirmation", "sent", "delivered"),
          row("2", "trip_reminder_24h", "sent", "bounced"),
          row("3", "trip_recap", "failed"),
        ]}
        locale="en-US"
        timezone="America/Cancun"
        t={staffTranslator("en-US")}
      />,
    );
    expect(screen.getByText("What the shop sent")).toBeInTheDocument();
    expect(screen.getByText(/Booking confirmation · Delivered · /)).toBeInTheDocument();
    expect(screen.getByText(/24-hour reminder · Bounced · /)).toBeInTheDocument();
    expect(screen.getByText(/Trip recap · Did not send · /)).toBeInTheDocument();
  });

  it("speaks Spanish for a Spanish shop", () => {
    render(
      <SentMessagesSection
        messages={[row("1", "trip_reminder_7d", "sent")]}
        locale="es-ES"
        timezone="America/Cancun"
        t={staffTranslator("es-ES")}
      />,
    );
    expect(screen.getByText(/Recordatorio de 7 días · Enviado · /)).toBeInTheDocument();
  });
});
