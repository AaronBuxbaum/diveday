// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { routeSource } from "@/test/route-source";
import { SafetyRecordPanel, SafetyRecordSection } from "./SafetyRecord";

afterEach(cleanup);

const record = {
  startsOn: "2026-03-03",
  endsOn: "2026-11-18",
  departures: 40,
  diversBoarded: 1204,
  rollCallsCompleted: 38,
  readinessCompleted: 31,
};

describe("SafetyRecordPanel", () => {
  it("names its four counts and the days they cover, and claims nothing else", () => {
    render(<SafetyRecordPanel record={record} locale="en-US" t={diverTranslator("en-US")} />);
    const panel = screen.getByRole("region", { name: "Our departure record" });
    expect(within(panel).getByText(/Mar 3.*Nov 18, 2026/)).toBeInTheDocument();
    expect(within(panel).getByText("Departures run").nextSibling).toHaveTextContent("40");
    expect(within(panel).getByText("Divers boarded").nextSibling).toHaveTextContent("1,204");
    expect(within(panel).getByText("Roll calls completed").nextSibling).toHaveTextContent("38");
    expect(within(panel).getByText("Readiness completed").nextSibling).toHaveTextContent("31");
  });

  it("shows one departure as one, with no minimum, and a real zero as zero", () => {
    render(
      <SafetyRecordPanel
        record={{
          ...record,
          departures: 1,
          diversBoarded: 6,
          rollCallsCompleted: 0,
          readinessCompleted: 1,
        }}
        locale="en-US"
        t={diverTranslator("en-US")}
      />,
    );
    expect(screen.getByText("Departure run").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Roll calls completed").nextSibling).toHaveTextContent("0");
  });

  it("speaks Spanish with the same numbers", () => {
    render(<SafetyRecordPanel record={record} locale="es-ES" t={diverTranslator("es-ES")} />);
    expect(screen.getByText("Salidas realizadas").nextSibling).toHaveTextContent("40");
    expect(screen.getByText("Pases de lista completados")).toBeInTheDocument();
  });
});

describe("SafetyRecordSection", () => {
  it("draws nothing while the owner has it off, and reads nothing", async () => {
    const shop = { id: "no-such-shop", timezone: "UTC", safetyRecordEnabled: false };
    expect(
      await SafetyRecordSection({ shop, locale: "en-US", t: diverTranslator("en-US") }),
    ).toBeNull();
  });

  it("is switched by the shop's own column, and kept out of the embed", () => {
    expect(routeSource(import.meta.dirname, "SafetyRecord.tsx")).toContain(
      "if (!shop.safetyRecordEnabled) return null;",
    );
    expect(routeSource(import.meta.dirname, "ShopfrontCounts.tsx")).toContain(
      "<SafetyRecordSection",
    );
    expect(routeSource(import.meta.dirname, "../page.tsx")).toContain("<ShopfrontCounts");
    expect(routeSource(import.meta.dirname, "../embed/calendar/page.tsx")).not.toContain(
      "SafetyRecord",
    );
  });
});
