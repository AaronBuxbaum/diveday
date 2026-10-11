// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadyPageData } from "@/db/ready";
import { diverTranslator } from "@/i18n/messages";
import { DayOfDetails } from "./DayOfDetails";

vi.mock("../day-of-actions", () => {
  const action = async () => {};
  return {
    saveDiveIntentFromReady: action,
    saveDiveRecencyFromReady: action,
    saveHelpRequestFromReady: action,
    saveHotelPickupLocationFromReady: action,
    saveNoteFromReady: action,
    saveReEntryAskFromReady: action,
    saveWelcomeConsentFromReady: action,
  };
});

const t = diverTranslator("en-US");

afterEach(cleanup);

function data(participantType: ReadyPageData["participantType"]): ReadyPageData {
  return {
    participantType,
    lastDivedBand: null,
    diveIntent: null,
    reEntryAsk: null,
    reEntryOffersOpen: false,
    refresherCourseOffered: false,
    hotelPickupLocation: null,
    helpRequest: null,
    rentalFit: null,
    welcomeOffer: null,
    welcomeShared: false,
  } as unknown as ReadyPageData;
}

describe("the day-of step asks a seat only what fits it (ADR 20261007-participant-types)", () => {
  // Regression (dive-domain review, PR #2224): a rider's trip prep asked
  // "When did you last dive?" and what the dive was for.
  it("asks a diver when they last dived", () => {
    render(<DayOfDetails token="tok" data={data("diver")} t={t} />);
    expect(screen.getByLabelText(t("ready.lastDivedHeading"))).toBeInTheDocument();
  });

  it("never asks a rider or a snorkeler about diving, and still offers the pickup", () => {
    for (const type of ["rider", "snorkeler"] as const) {
      render(<DayOfDetails token="tok" data={data(type)} t={t} />);
      expect(screen.queryByLabelText(t("ready.lastDivedHeading"))).toBeNull();
      expect(screen.queryByLabelText(t("ready.intentHeading"))).toBeNull();
      expect(screen.getByText(t("ready.hotelPickupLabel"))).toBeInTheDocument();
      cleanup();
    }
  });
});
