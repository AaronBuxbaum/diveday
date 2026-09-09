import { expect, signedInAsOwner, test } from "./fixtures";

/**
 * **The paper day** (N-54): one printable document holding every departure of
 * today, so a dead tablet costs a printer rather than the day.
 *
 * What is worth driving in a browser here is not the assembly — `TripPacket`
 * is the same component the per-trip packet prints, and `e2e/trips.spec.ts`
 * already pins its three sections — but the two things only a real page can
 * answer: that the day's own door reaches it, and that widening one departure
 * to several did not put a control back on paper. The packet hides every
 * button through one `.trip-print-bundle` rule, and that rule is a backstop
 * whose whole value is that nobody has to remember it.
 */
test.describe("the paper day", () => {
  signedInAsOwner();

  test("the morning end of the day spine prints every departure of today", async ({ page }) => {
    // Composing the manifest and prep readers once per departure is the
    // slowest staff render in the app, and it is a document nobody navigates
    // twice — the budget belongs to the printer, not to the 15s default.
    test.setTimeout(90_000);

    await page.goto("/shop/blue-mantis");
    // The day's own stations, by the heading each one wears. Read before the
    // packet so the assertion below compares two independent renders of the
    // same day rather than the packet against itself.
    const stationTitles = await page
      .getByRole("heading", { level: 3 })
      .filter({ has: page.locator('a[href*="/trips/"]') })
      .allInnerTexts();
    expect(stationTitles.length).toBeGreaterThan(0);

    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("link", { name: "Print the day" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    await expect(popup).toHaveURL(/\/shop\/blue-mantis\/print$/);
    await expect(popup.getByRole("heading", { level: 1, name: "Day packet" })).toBeVisible();

    // Three sections per departure, and the same three the single-trip packet
    // prints: the dive plan rendered as words, the manifest (which carries the
    // roster's waiver state and the shop's emergency card), and the morning
    // packing list.
    const divePlans = popup.getByRole("heading", { name: "Dive plan", exact: true });
    const departures = await divePlans.count();
    expect(departures).toBeGreaterThan(0);
    await expect(popup.getByRole("heading", { name: "Manifest", exact: true })).toHaveCount(
      departures,
    );
    await expect(popup.getByRole("heading", { name: "Prep", exact: true })).toHaveCount(departures);

    // Every boat the day spine showed is on the paper. The packet can hold
    // more — a departure that sailed an hour ago has left the spine's
    // forward-looking stations and is still very much on today's sheet — so
    // this is containment, not equality.
    for (const title of stationTitles) {
      const boat = title.split("\n")[0].trim();
      await expect(popup.getByText(boat, { exact: false }).first()).toBeVisible();
    }

    // The sheet says which day it is: paper outlives the morning it left the
    // printer, and a captain holding page seven has no other way to tell.
    await expect(popup.getByText(/\d{4}/).first()).toBeVisible();

    // Not one control on paper, however many departures the day holds — the
    // same claim `e2e/trips.spec.ts` makes of the single-trip packet, made
    // again here because widening it is exactly the change that could put one
    // back. Named rather than counted, for the reason that spec gives.
    await popup.emulateMedia({ media: "print" });
    const controls = await popup.evaluate(() => {
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          box.width > 0 &&
          box.height > 0
        );
      };
      return [...document.querySelectorAll("button, select, textarea, input")]
        .filter(visible)
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}: ${(element.textContent ?? "").trim().slice(0, 30) || (element as HTMLInputElement).name || "(unnamed)"}`,
        );
    });
    expect(controls).toEqual([]);
    await popup.emulateMedia({ media: "screen" });
    await popup.close();
  });
});

test("the paper day is staff-only", async ({ page }) => {
  // Signed out, and so refused at the door rather than handed a document
  // holding every diver's emergency contact for the day.
  await page.goto("/shop/blue-mantis/print");
  await expect(page).toHaveURL(/\/sign-in/);
});
