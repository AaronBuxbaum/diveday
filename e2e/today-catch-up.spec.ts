import { expect, signedInAsOwner, test } from "./fixtures";
import { todayCatchUpScenario } from "./today-catch-up-helper";

signedInAsOwner();
test.beforeAll(async ({ staffStorageState }) => {
  await staffStorageState("captain");
});

test("Today catches the other staffer's walk-in and remembers Got it", async ({
  browser,
  page,
  workerBaseURL,
  staffStorageState,
}) => {
  const readerStorageState = await staffStorageState("captain");
  const { reader, readerContext } = await todayCatchUpScenario(
    browser,
    page,
    workerBaseURL,
    readerStorageState,
  );
  try {
    const strip = reader.getByRole("region", { name: /Since / });
    await expect(strip).toContainText("Today Catchup Diver took a seat.");
    await expect(strip).toContainText("Two-Tank Reef — Molasses & French");
    await strip.getByRole("button", { name: "Got it" }).click();
    await expect(strip).toHaveCount(0);
    await reader.reload();
    await expect(reader.getByRole("region", { name: /Since / })).toHaveCount(0);
  } finally {
    await readerContext.close();
  }
});
