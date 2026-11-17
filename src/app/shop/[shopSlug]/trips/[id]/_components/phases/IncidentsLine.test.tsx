// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { IncidentsLine } from "./WrappedPanels";

vi.mock("../../incidents/actions", () => ({ startIncidentReportAction: vi.fn() }));
afterEach(cleanup);

const t = staffTranslator("en-US");
const ids = { shopSlug: "blue-mantis", tripId: "trip-1", t };

it("names its fact beside the one door: Incidents, None, Report one", () => {
  render(<IncidentsLine incidents={{ reports: [], mayStart: true }} {...ids} />);
  const row = document.getElementById("incidents") as HTMLElement;
  expect(row).toHaveTextContent(t("trips.clock.wrapped.incidents"));
  expect(row).toHaveTextContent(t("trips.clock.wrapped.none"));
  expect(screen.getByRole("button", { name: t("trips.clock.wrapped.reportOne") })).toBeVisible();
});

it("renders nothing for a viewer who may neither read nor start a report", () => {
  render(<IncidentsLine incidents={{ reports: [], mayStart: false }} {...ids} />);
  expect(document.getElementById("incidents")).toBeNull();
});
