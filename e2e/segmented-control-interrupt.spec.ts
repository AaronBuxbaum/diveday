import { expect, signedInAsOwner, test } from "./fixtures";
import { openTripTab } from "./helpers";
import { openReefTrip, staffCopy } from "./visual-harness";

test.describe("interrupted prep grouping motion", () => {
  signedInAsOwner();

  test("realigns the selected pill when a release transition is cancelled", async ({ page }) => {
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
    const pressed = await page.addStyleTag({
      content:
        'nav[aria-label="Group by"] a[data-key="diver"] { transition: none !important; transform: scale(1.01) !important; }',
    });
    await diver.click();
    await expect(diver).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("columnheader", { name: "Diver" })).toBeVisible();
    const pill = grouping.locator(":scope > span[aria-hidden='true']");
    await expect(pill).toHaveJSProperty("offsetHeight", 45);
    // Hold the release long enough to interrupt it deterministically. These
    // temporary styles are removed before checking the real settled control.
    const release = await page.addStyleTag({
      content:
        'nav[aria-label="Group by"] a[data-key="diver"] { transition: transform 2s linear !important; }',
    });
    await pressed.evaluate((style) => style.parentNode?.removeChild(style));
    await expect
      .poll(() =>
        diver.evaluate((link) => link.getAnimations().some((a) => a.playState === "running")),
      )
      .toBe(true);
    const stop = await page.addStyleTag({
      content: 'nav[aria-label="Group by"] a[data-key="diver"] { transition: none !important; }',
    });
    await expect
      .poll(() => diver.evaluate((link) => getComputedStyle(link).transform))
      .toBe("none");
    await expect
      .poll(() =>
        grouping.evaluate((nav) => {
          const raised = nav.querySelector<HTMLElement>(":scope > span[aria-hidden='true']");
          const selected = nav.querySelector<HTMLElement>('[aria-current="true"]');
          if (!raised || !selected) return false;
          const box = selected.getBoundingClientRect();
          const pill = raised.getBoundingClientRect();
          const snap = (value: number) => Math.round(value * devicePixelRatio) / devicePixelRatio;
          return (
            Math.abs(pill.top - snap(box.top)) < 0.05 &&
            Math.abs(pill.bottom - snap(box.bottom)) < 0.05
          );
        }),
      )
      .toBe(true);
    await expect(diver).toHaveAttribute("aria-current", "true");
    await stop.evaluate((style) => style.parentNode?.removeChild(style));
    await release.evaluate((style) => style.parentNode?.removeChild(style));
  });
});
