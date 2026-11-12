import { saveCardAtCheckIn } from "./card-at-checkin-helpers";
import { expect, test } from "./fixtures";

test("a certified diver without a number leaves card verification with the shop", async ({
  page,
}) => {
  const step = await saveCardAtCheckIn(page);
  await expect(step.getByText("Add your certification", { exact: true })).toBeVisible();
  await expect(step.getByText("Your turn", { exact: true })).toHaveCount(0);
});
