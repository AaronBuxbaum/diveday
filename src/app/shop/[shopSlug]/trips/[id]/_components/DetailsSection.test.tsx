// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DetailsSection } from "./DetailsSection";
import type { Trip } from "./types";

afterEach(cleanup);

/**
 * Only the fields this form reads. The full `getTripWithBooked` row is not
 * what is under test — where the stored arrival photo is drawn is.
 */
const trip = {
  id: "trip-1",
  title: "Two-Tank Reef",
  description: null,
  capacity: 12,
  priceCents: 12000,
  depositCents: null,
  cancellationWindowHours: null,
  minimumBookings: null,
  minimumDecisionHours: null,
  meetingPointLabel: null,
  meetingPointAddress: null,
  arrivalLandmark: null,
  arrivalLookFor: null,
  arrivalFirstInteraction: null,
  arrivalParkingNote: null,
  arrivalTransitNote: null,
  arrivalPhotoUrl: "/dive-sites/molasses-dock.jpg",
  plannedDives: 2,
  diveMode: "boat",
  boatId: null,
  lensId: null,
  courseId: null,
  isPrivate: false,
  selfGuided: false,
} as unknown as Trip;

const wall = { year: 2026, month: 10, day: 3, hour: 8, minute: 0 };

function renderDetails(
  days: { dayCount: number; laterDates: string[] } = {
    dayCount: 1,
    laterDates: [],
  },
) {
  return render(
    <DetailsSection
      context={{
        action: () => {},
        trip: trip,
        diveSiteList: [],
        tripDiveList: [],
        startWall: wall,
        endWall: { ...wall, hour: 12 },
        ...days,
        locale: "en-US",
        currency: "USD",
        boats: [],
        lenses: [],
        hasBoatDiving: true,
        hasShoreDiving: false,
        hasPoolDiving: false,
        rentalItems: [],
      }}
    />,
  );
}

/**
 * The arrival photo is the sixth field of the arrival fieldset's two-column
 * grid, so from `sm` up it is a half column. Wrapped in the gallery's
 * three-across grid, the stored photo was a third of that half — 83px wide at
 * 640, 100px at 1280, against the 128×80 thumbnail it replaced — and `h-24`
 * with `object-cover` cropped a landscape dock photo to a portrait sliver
 * while "Remove current photo" wrapped under it. A half column's photo takes
 * the column, as the dive-site editor's map and route stills do.
 */
describe("DetailsSection — the stored arrival photo", () => {
  it("takes its half column rather than a third of it", () => {
    const { container } = renderDetails();

    const box = container.querySelector<HTMLInputElement>('input[name="removeArrivalPhoto"]');
    expect(box).not.toBeNull();
    const wrapper = box?.closest("label")?.parentElement;
    expect(wrapper).not.toHaveClass("grid");
    expect(wrapper?.className).not.toMatch(/grid-cols/);
    // Why: the field it sits in is one cell of a two-column grid.
    expect(wrapper?.closest('[class*="grid-cols"]')).toHaveClass("sm:grid-cols-2");
  });
});

/**
 * **A departure's days run back to back, for now** (`MAX_MEETING_DAY_GAP_DAYS`):
 * Today and the roll call read a departure as one window, so the edit form
 * asks only how many days and offers no date to put a gap in. The date boxes
 * themselves are `MeetingDaysField.test.tsx`'s.
 */
describe("a departure that meets on several days", () => {
  it("asks only how many days, with no date box for a later day", () => {
    renderDetails({ dayCount: 1, laterDates: [] });
    fireEvent.change(screen.getByRole("spinbutton", { name: /Days/ }), { target: { value: "3" } });
    expect(screen.queryByLabelText("Day 2")).toBeNull();
    expect(document.querySelector('input[name="meetingDate"]')).toBeNull();
  });
});
