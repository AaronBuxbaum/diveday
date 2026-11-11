import type { Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect } from "./fixtures";
import { bookASeatAndOpenThread } from "./helpers";

const staff = staffTranslator("en-US");
const diver = diverTranslator("en-US");
// Deliberately authored test-shop facts, never inferred from an activity description.
export const COURSE_MEETING_PLACES = ["Shop classroom", "Training pool entrance", "Shop dock"];

export async function authorCourseMeetingPlaces(page: Page, shopSlug: string) {
  await page.goto(`/shop/${shopSlug}/courses/open-water-diver/edit`);
  await expect(page.locator('[data-hydrated="true"]:has([name="summary"])')).toBeVisible();
  for (const [index, place] of COURSE_MEETING_PLACES.entries()) {
    await page
      .getByLabel(staff("courses.dayByDay.meetingPlaceLabel", { number: index + 1 }))
      .fill(place);
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Course page saved");
  await page.reload();
  for (const [index, place] of COURSE_MEETING_PLACES.entries()) {
    await expect(
      page.getByLabel(staff("courses.dayByDay.meetingPlaceLabel", { number: index + 1 })),
    ).toHaveValue(place);
  }
}

export async function enrollWithCourseMeetingPlaces(page: Page, shopSlug: string) {
  await page.goto(`/s/${shopSlug}/courses/open-water-diver`);
  for (const place of COURSE_MEETING_PLACES) {
    await expect(
      page.locator("#how-it-runs").filter({ visible: true }).getByText(place, { exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("link", { name: "Book this date" }).first().click();
  await expect(page.getByRole("heading", { name: diver("booking.courseHeading") })).toBeVisible();
  await bookASeatAndOpenThread(page, "Jordan Places", "jordan-places@example.com");
  const meetingList = page.getByTestId("ready-meeting-days").filter({ visible: true });
  await expect(meetingList).toHaveCount(1);
  const meetings = meetingList.locator("li");
  await expect(meetings).toHaveCount(3);
  for (const [index, place] of COURSE_MEETING_PLACES.entries()) {
    await expect(meetings.nth(index)).toContainText(place);
  }
  await expect(page.getByText(/Your course starts at/)).toBeVisible();
}
