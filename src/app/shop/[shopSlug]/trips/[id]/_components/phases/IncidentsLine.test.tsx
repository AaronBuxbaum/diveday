// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { IncidentsLine } from "./WrappedPanels";

afterEach(cleanup);

const t = staffTranslator("en-US");
const ids = { shopSlug: "blue-mantis", tripId: "trip-1", t };

it("names each report this viewer may read as a door to it", () => {
  render(
    <IncidentsLine
      incidents={{ reports: [{ id: "report-1", status: "draft", createdByName: "Ana" }] }}
      {...ids}
    />,
  );
  const row = document.getElementById("incidents") as HTMLElement;
  expect(row).toHaveTextContent(t("trips.clock.wrapped.incidents"));
  expect(
    screen.getByRole("link", { name: t("trips.clock.wrapped.reportDraft", { name: "Ana" }) }),
  ).toHaveAttribute("href", "/shop/blue-mantis/trips/trip-1/incidents/report-1");
});

it("draws nothing, and no door to start one, when there is no report", () => {
  render(<IncidentsLine incidents={{ reports: [] }} {...ids} />);
  expect(document.getElementById("incidents")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});
