import { formatCalendarDate } from "../src/lib/calendar-date";
import { expect, test } from "./fixtures";
import {
  capture,
  FLOW_TIMEOUT_MS,
  installVisualBuildGuard,
  staffCopy,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: FLOW_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);

test.describe("light mode", () => {
  test.use({
    colorScheme: "light",
    viewport: { width: 1280, height: 800 },
    privateShopSlug: "future-crew-visual",
  });
  test("shows the unverified rating on Today, the trip and staffing", async ({
    page,
    request,
    privateShop,
  }) => {
    const seeded = await request.post(
      `/api/test/seed-trouble-states?futureCrew=1&shop=${privateShop.slug}`,
    );
    expect(seeded.ok()).toBe(true);
    const { futureCrew } = (await seeded.json()) as {
      futureCrew: { tripId: string; uncrewedTripId: string; issueDate: string };
    };
    const note = staffCopy("today.detail.ratingUnverified", { names: "Alex Future", count: 1 });
    await page.goto(`/shop/${privateShop.slug}`);
    await expect(page.getByText(note)).toBeVisible();
    await capture(page, "today-future-crew-rating", "light");
    await page.goto(
      `/shop/${privateShop.slug}/trips/${futureCrew.uncrewedTripId}?view=details#crew`,
    );
    await expect(page.getByText(staffCopy("trips.crew.courseNeedsInstructor"))).toBeVisible();
    await page.goto(`/shop/${privateShop.slug}/trips/${futureCrew.tripId}?view=details#crew`);
    await expect(page.getByText(note)).toBeVisible();
    await expect(page.getByText(staffCopy("trips.crew.courseNeedsInstructor"))).toHaveCount(0);
    await capture(page, "trip-future-crew-rating", "light");
    await page.goto(`/shop/${privateShop.slug}/staffing`);
    const warning = staffCopy("desk.staffingWarnings.credentialNotYetIssued", {
      name: "Alex Future",
      title: "Legacy rating check",
      credential: staffCopy("staffing.credentials.kinds.instructor_rating"),
      date: formatCalendarDate(futureCrew.issueDate, "en-US"),
    });
    await expect(page.getByText(warning)).toBeVisible();
    await capture(page, "staffing-future-crew-rating", "light");
  });
});
