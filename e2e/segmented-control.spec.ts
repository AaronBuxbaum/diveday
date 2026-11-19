import { expect, signedInAsOwner, test } from "./fixtures";
import { openTripTab } from "./helpers";
import { openReefTrip, staffCopy } from "./visual-harness";

test.describe("prep grouping pill", () => {
  signedInAsOwner();

  test("realigns after the selected option's press transform settles", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openReefTrip(page);
    await openTripTab(page, "Prep");
    const grouping = page.getByRole("navigation", {
      name: staffCopy("tripPrep.groupLabel"),
      exact: true,
    });
    const diver = grouping.getByRole("link", {
      name: staffCopy("tripPrep.groupByDiver"),
      exact: true,
    });
    // Hold a release-spring-sized transform during the real view switch. Its
    // rectangle can be read while transformed; restore the real UI before
    // checking the settled state. This is the measured #4777 failure shape.
    const pressed = await page.addStyleTag({
      content:
        'nav[aria-label="Group by"] a[data-key="diver"] { transition: none !important; transform: scale(1.01) !important; }',
    });
    await diver.click();
    await expect(diver).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("columnheader", { name: "Diver" })).toBeVisible();
    const pill = grouping.locator(":scope > span[aria-hidden='true']");
    await expect(pill).toHaveJSProperty("offsetHeight", 45);
    await pressed.evaluate((style) => style.parentNode?.removeChild(style));
    await expect
      .poll(() => diver.evaluate((link) => getComputedStyle(link).transform))
      .toBe("none");
    await expect
      .poll(() =>
        grouping.evaluate((nav) => {
          const pill = nav.querySelector<HTMLElement>(":scope > span[aria-hidden='true']");
          const selected = nav.querySelector<HTMLElement>('[aria-current="true"]');
          if (!pill || !selected) return false;
          const box = selected.getBoundingClientRect();
          const raised = pill.getBoundingClientRect();
          const snap = (value: number) => Math.round(value * devicePixelRatio) / devicePixelRatio;
          return (
            Math.abs(raised.top - snap(box.top)) < 0.05 &&
            Math.abs(raised.bottom - snap(box.bottom)) < 0.05
          );
        }),
      )
      .toBe(true);
  });
});
