// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { TodayHeaderNotes } from "./TodayHeaderNotes";

afterEach(cleanup);

const t = staffTranslator("en-US");

function renderNotes(props: Partial<ComponentProps<typeof TodayHeaderNotes>>) {
  return render(
    <TodayHeaderNotes
      shopSlug="blue-mantis"
      quietDay={false}
      hasStations={false}
      boatsToday={false}
      nextDeparture={null}
      showFirstRunChecklist={false}
      locale="en-US"
      timeZone="America/New_York"
      t={t}
      {...props}
    />,
  );
}

describe("TodayHeaderNotes with nothing left on the board", () => {
  it("teaches the board to a shop that has never had a boat today", () => {
    renderNotes({});
    expect(screen.getByText(t("shopHome.noDeparturesEmpty"), { exact: false })).toBeVisible();
    expect(screen.getByRole("link", { name: t("shopHome.scheduleTrip") })).toBeVisible();
  });

  it("says no more, never yet, once today's boats are home", () => {
    renderNotes({ boatsToday: true });
    expect(screen.getByText(t("shopHome.noDeparturesLeft"), { exact: false })).toBeVisible();
    expect(screen.queryByText(t("shopHome.noDeparturesEmpty"), { exact: false })).toBeNull();
    expect(screen.getByRole("link", { name: t("shopHome.scheduleTrip") })).toBeVisible();
  });

  it("says nothing while first run's own ledger owns the first departure", () => {
    renderNotes({ showFirstRunChecklist: true });
    expect(screen.queryByRole("link", { name: t("shopHome.scheduleTrip") })).toBeNull();
  });
});
