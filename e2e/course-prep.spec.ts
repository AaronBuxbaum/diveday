import { enrollInMultiDayCourse } from "./course-prep-helpers";
import { expect, test } from "./fixtures";

test("a course booking keeps every meeting and its course plan on the immediate prep page", async ({
  page,
}) => {
  await enrollInMultiDayCourse(page);
  await expect(page.getByText(/Aim to be at the dock/)).toHaveCount(0);
});
