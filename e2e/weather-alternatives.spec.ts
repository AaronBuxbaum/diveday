import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  createTrip,
  daysFromNow,
  openTripMore,
  publicTripUrl,
  tripPathByTitle,
} from "./helpers";

signedInAsOwner();
const t = staffTranslator("en-US");
// story: DESK-10
test("prioritizes an existing shore departure without moving the canceled booking", async ({
  page,
}) => {
  const charter = "Weather alternative source";
  const shore = "Weather alternative shore";
  await createTrip(page, {
    title: charter,
    date: daysFromNow(9),
    departsAt: "08:00",
    returnsAt: "10:00",
    price: 120,
  });
  await createTrip(page, {
    title: shore,
    date: daysFromNow(10),
    departsAt: "09:00",
    returnsAt: "11:00",
    price: 80,
    diveMode: "shore",
  });
  const path = await tripPathByTitle(page, "blue-mantis", charter);
  await page.goto(publicTripUrl(path));
  await bookASeatAndOpenThread(page, "Shore Recovery Diver");
  await page.goto(path);
  await openTripMore(page);
  await page.getByRole("link", { name: "Weather blow-out…" }).click();
  await page.getByText(t("blowout.alternatives.title"), { exact: true }).click();
  const option = page.getByRole("checkbox", { name: new RegExp(shore) });
  await expect(option).not.toBeChecked();
  await option.check();
  await page.getByRole("button", { name: t("blowout.confirm.button"), exact: true }).click();
  await expect(
    page.getByRole("heading", { name: t("blowout.record.title"), exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(shore) })).toBeVisible();
  await expect(
    page.getByText(t("blowout.record.unresolvedBadge"), { exact: true }).first(),
  ).toBeVisible();
});
