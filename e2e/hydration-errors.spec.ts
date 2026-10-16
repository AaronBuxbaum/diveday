import { expect, test } from "./fixtures";

/**
 * The `browserActivity` fixture fails a test whose page logged a React
 * hydration error (`HYDRATION_ERROR` in `e2e/fixtures.ts`). These hold that
 * rule itself: the first test's body passes, so only the fixture's teardown
 * can fail it, and `test.fail()` turns that failure into the pass.
 */

test("a test whose page logs a React hydration error fails, though its own steps passed", async ({
  page,
}) => {
  test.fail(true, "the fixture's teardown is what fails this test; that is the rule under test");
  await page.goto("/");
  const logged = page.waitForEvent("console");
  await page.evaluate(() =>
    console.error(
      "Minified React error #418; visit https://react.dev/errors/418?args[]=HTML for the full message",
    ),
  );
  await logged;
  await expect(page).toHaveURL(/\/$/);
});

test("an ordinary console error leaves the test green", async ({ page }) => {
  await page.goto("/");
  const logged = page.waitForEvent("console");
  await page.evaluate(() => console.error("Failed to load resource: 404"));
  await logged;
  await expect(page).toHaveURL(/\/$/);
});
