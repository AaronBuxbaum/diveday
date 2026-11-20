// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { WaterStanding } from "../water-standing";
import { WhatHappenedCard } from "./WrappedPanels";

vi.mock("../../incidents/actions", () => ({ startIncidentReportAction: vi.fn() }));
afterEach(cleanup);

const t = staffTranslator("en-US");
const standing = { timeline: [] } as unknown as WaterStanding;
const card = (records?: Parameters<typeof WhatHappenedCard>[0]["records"]) =>
  render(
    <WhatHappenedCard
      standing={standing}
      depth={(meters) => `${meters} m`}
      logRow={() => null}
      incidents={{ reports: [], mayStart: false }}
      noShows={[]}
      turnedAway={[]}
      print={null}
      records={records}
      shopSlug="blue-mantis"
      tripId="trip-1"
      locale="en-US"
      timeZone="UTC"
      t={t}
    />,
  );

describe("What happened's records (issue #4683)", () => {
  it("opens what was seen on Roll call and what was left aboard under More", () => {
    card({ seen: { species: 3, dive: 2 }, leftAboard: { count: 1 } });
    const what = screen.getByRole("region", { name: t("trips.clock.wrapped.whatHappened") });
    expect(what).toHaveTextContent(t("trips.clock.wrapped.species", { count: 3 }));
    expect(
      within(what).getByRole("link", { name: t("trips.clock.water.openRollCall") }),
    ).toHaveAttribute("href", "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=after_dive_2");
    expect(what).toHaveTextContent(t("trips.clock.wrapped.items", { count: 1 }));
    expect(within(what).getByRole("link", { name: t("trips.about.view") })).toHaveAttribute(
      "href",
      "#found-aboard",
    );
  });

  it("draws neither row when nothing was seen or left aboard", () => {
    card({ seen: null, leftAboard: null });
    expect(screen.queryByText(t("trips.clock.wrapped.seen"))).toBeNull();
    expect(screen.queryByText(t("desk.lostFound.heading"))).toBeNull();
    // The card itself still says what happened.
    expect(screen.getByText(t("trips.clock.wrapped.noShows"))).toBeVisible();
  });
});
