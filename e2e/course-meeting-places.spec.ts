import {
  authorCourseMeetingPlaces,
  COURSE_MEETING_PLACES,
  enrollWithCourseMeetingPlaces,
} from "./course-meeting-places-helpers";
import { expect, test } from "./fixtures";

test("authored course places survive saving and follow actual meeting dates into the saved arrival card", async ({
  privateShop,
  page,
  request,
}) => {
  await authorCourseMeetingPlaces(page, privateShop.slug);
  await enrollWithCourseMeetingPlaces(page, privateShop.slug);
  const response = await request.get(`${new URL(page.url()).pathname}/offline`);
  expect(response.ok()).toBeTruthy();
  const snapshot = await response.json();
  for (const place of COURSE_MEETING_PLACES) expect(snapshot.saved).toContain(place);
  expect(snapshot.saved).toContain("Your course starts at");
  expect(snapshot.saved).not.toContain("sail");
  const downloadLink = page.locator('a[download][href*="/arrival-card"]');
  await expect(downloadLink).toHaveAttribute("href", /arrival-card\?booking=/);
  const href = await downloadLink.getAttribute("href");
  if (!href) throw new Error("Arrival card link missing");
  const downloaded = await request.get(href);
  expect(downloaded.ok()).toBeTruthy();
  const html = await downloaded.text();
  for (const place of COURSE_MEETING_PLACES) expect(html).toContain(place);
  expect(html).toContain("Your course starts at");
  expect(html).not.toContain("sail");
  expect(html).not.toContain(new URL(page.url()).pathname.split("/").at(-1));
});
