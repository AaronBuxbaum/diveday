// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadyPageData } from "@/db/ready";
import { diverTranslator } from "@/i18n/messages";
import { DayOfDetails } from "./DayOfDetails";

vi.mock("../day-of-actions", () => ({ saveDayOfDetailsFromReady: async () => {} }));

const t = diverTranslator("en-US");

afterEach(cleanup);

function data(participantType: ReadyPageData["participantType"]): ReadyPageData {
  return {
    participantType,
    trip: {
      meetingPointLabel: null,
      meetingPointAddress: null,
      arrivalLandmark: null,
      arrivalParkingNote: null,
      arrivalTransitNote: null,
      arrivalLookFor: null,
      arrivalFirstInteraction: null,
    },
    lastDivedBand: null,
    diveIntent: null,
    reEntryAsk: null,
    reEntryOffersOpen: false,
    refresherCourseOffered: false,
    hotelPickupLocation: null,
    offersHotelPickup: true,
    helpRequest: null,
    helpRequestsOn: true,
    rentalFit: null,
    welcomeOffer: null,
    welcomeShared: false,
    welcomeHello: null,
  } as unknown as ReadyPageData;
}

describe("the day-of step asks a seat only what fits it (ADR 20261007-participant-types)", () => {
  // Regression (dive-domain review, PR #2224): a rider's trip prep asked
  // "When did you last dive?" and what the dive was for.
  it("asks a diver when they last dived", () => {
    render(<DayOfDetails token="tok" data={data("diver")} saved={false} t={t} />);
    expect(screen.getByLabelText(t("ready.lastDivedHeading"))).toBeInTheDocument();
  });

  it("never asks a rider or a snorkeler about diving, and still offers the pickup", () => {
    for (const type of ["rider", "snorkeler"] as const) {
      render(<DayOfDetails token="tok" data={data(type)} saved={false} t={t} />);
      expect(screen.queryByLabelText(t("ready.lastDivedHeading"))).toBeNull();
      expect(screen.queryByLabelText(t("ready.intentHeading"))).toBeNull();
      expect(screen.getByText(t("ready.hotelPickupLabel"))).toBeInTheDocument();
      cleanup();
    }
  });
});

/**
 * **No pickup a shop never offered** (fourth UX review, item 8): every diver at
 * every shop was asked "Want a morning pickup?". Only a shop that says it runs
 * pickups has the question asked.
 */
describe("the pickup question follows the shop's own setting", () => {
  it("asks nothing about a pickup at a shop that runs none", () => {
    render(
      <DayOfDetails
        token="tok"
        data={{ ...data("diver"), offersHotelPickup: false } as ReadyPageData}
        saved={false}
        t={t}
      />,
    );
    expect(screen.queryByText(t("ready.hotelPickupLabel"))).toBeNull();
    expect(screen.queryByLabelText(t("ready.hotelPickupFieldLabel"))).toBeNull();
  });

  it('asks "Want a pickup?", never a morning one, where the shop runs them', () => {
    render(<DayOfDetails token="tok" data={data("diver")} saved={false} t={t} />);
    expect(screen.getByText("Want a pickup?")).toBeInTheDocument();
  });
});

/**
 * **One form, one Save** (third UX review, item 24): six questions used to be
 * six forms, and only the last Save tapped kept its answer.
 */
describe("the day-of step saves as one", () => {
  it("asks every question inside one form, under one Save", () => {
    const { container } = render(
      <DayOfDetails
        token="tok"
        data={{ ...data("diver"), welcomeOffer: { kind: "first_trip" } } as ReadyPageData}
        saved={false}
        t={t}
      />,
    );
    expect(container.querySelectorAll("form")).toHaveLength(1);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Save day-of details" })).toBeInTheDocument();
    // The welcome word is a box in the same form now, not a button of its own.
    expect(screen.getByRole("checkbox", { name: "Yes, tell the crew" })).not.toBeChecked();
  });

  it("offers the three hello choices to a first trip only, as radios and never free text", () => {
    const { container, rerender } = render(
      <DayOfDetails
        token="tok"
        data={{ ...data("diver"), welcomeOffer: { kind: "first_trip" } } as ReadyPageData}
        saved={false}
        t={t}
      />,
    );
    const radios = container.querySelectorAll('input[name="welcomeHello"]');
    expect([...radios].map((input) => (input as HTMLInputElement).value)).toEqual([
      "",
      "first_ocean_dive",
      "celebrating",
      "nervous",
    ]);
    expect(screen.getByRole("radio", { name: "Nothing to add" })).toBeChecked();
    expect(container.querySelector("textarea[name='welcomeHello']")).toBeNull();

    rerender(
      <DayOfDetails
        token="tok"
        data={{ ...data("diver"), welcomeOffer: { kind: "returning", years: 3 } } as ReadyPageData}
        saved={false}
        t={t}
      />,
    );
    expect(container.querySelectorAll('input[name="welcomeHello"]')).toHaveLength(0);
  });

  it("shows the saved confirmation in the step itself after a save", () => {
    render(<DayOfDetails token="tok" data={data("diver")} saved t={t} />);
    expect(screen.getByRole("status").textContent).toBe(t("rental.savedNote"));
  });
});

describe("the day-of help request promise", () => {
  it("says the request was sent until the desk records a named helper", () => {
    render(
      <DayOfDetails
        token="tok"
        data={
          {
            ...data("diver"),
            helpRequest: { status: "acknowledged", helperPersonName: null },
          } as ReadyPageData
        }
        saved={false}
        t={t}
      />,
    );
    expect(screen.getByText("Your request has been sent.")).toBeInTheDocument();
    expect(screen.queryByText(/will help you/)).toBeNull();
  });

  it("names the confirmed helper at this departure's saved meeting details", () => {
    render(
      <DayOfDetails
        token="tok"
        data={
          {
            ...data("diver"),
            trip: {
              ...data("diver").trip,
              meetingPointLabel: "North dock",
              arrivalLandmark: "beside the fuel shed",
            },
            helpRequest: { status: "acknowledged", helperPersonName: "Sam" },
          } as ReadyPageData
        }
        saved={false}
        t={t}
      />,
    );
    expect(
      screen.getByText("Sam will help you at North dock · beside the fuel shed."),
    ).toBeVisible();
  });

  it("uses a truthful fallback when the departure has no meeting details", () => {
    render(
      <DayOfDetails
        token="tok"
        data={
          {
            ...data("diver"),
            helpRequest: { status: "acknowledged", helperPersonName: "Sam" },
          } as ReadyPageData
        }
        saved={false}
        t={t}
      />,
    );
    expect(screen.getByText("Sam will help you on this departure.")).toBeVisible();
  });

  it("never promises future help once staff mark the request complete", () => {
    render(
      <DayOfDetails
        token="tok"
        data={
          {
            ...data("diver"),
            trip: { ...data("diver").trip, meetingPointLabel: "North dock" },
            helpRequest: { status: "handled", helperPersonName: "Sam" },
          } as ReadyPageData
        }
        saved={false}
        t={t}
      />,
    );
    expect(screen.getByText("The crew handled this request.")).toBeVisible();
    expect(screen.queryByText(/will help you/)).toBeNull();
    expect(screen.queryByText(/Sam/)).toBeNull();
  });
});

/** Help requests switched off on the Features page take no new ask. */
describe("the help question follows the shop's Help requests switch", () => {
  it("asks for help while on", () => {
    render(<DayOfDetails token="tok" data={data("diver")} saved={false} t={t} />);
    expect(screen.getAllByText(t("ready.helpHeading")).length).toBeGreaterThan(0);
    expect(screen.getByRole("radio", { name: t("ready.helpCarryGear") })).toBeInTheDocument();
  });

  it("asks nothing while off", () => {
    const off = { ...data("diver"), helpRequestsOn: false } as ReadyPageData;
    render(<DayOfDetails token="tok" data={off} saved={false} t={t} />);
    expect(screen.queryByText(t("ready.helpHeading"))).toBeNull();
    expect(screen.queryByRole("radio", { name: t("ready.helpCarryGear") })).toBeNull();
  });

  it("still says where an open request stands while off, with no way to change it", () => {
    const off = {
      ...data("diver"),
      helpRequestsOn: false,
      helpRequest: { kind: "carry_gear", status: "requested", helperPersonName: null },
    } as unknown as ReadyPageData;
    render(<DayOfDetails token="tok" data={off} saved={false} t={t} />);
    expect(screen.getByText(t("ready.helpSent"))).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: t("ready.helpCarryGear") })).toBeNull();
    expect(screen.queryByText(t("ready.helpBody"))).toBeNull();
  });
});
