import { expect, signedInAsOwner, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, signOut } from "./helpers";

test.describe("staff-prepared trip", () => {
  signedInAsOwner();

  test("a booked diver's readiness page lets them act, and saves an emergency contact", async ({
    page,
  }) => {
    // Unique title for this spec's own trip; the e2eNow() suffix keeps every
    // test-side timestamp anchored to the frozen clock (helpers.ts).
    // Isolation from other specs — including the visual suite — comes from
    // the per-test demo reset in fixtures.ts.
    const title = `Readiness Run ${e2eNow().getTime()}`;

    // Staff puts a trip on the board.
    await createTrip(page, {
      title,
      date: daysFromNow(4),
      departsAt: "08:00",
      returnsAt: "11:00",
      capacity: 6,
    });
    await signOut(page);

    // A visitor books it.
    await page.goto("/s/blue-mantis", { waitUntil: "domcontentloaded" });
    // Scoped to the trip list itself: a day with more than one departure
    // also renders a same-titled <li> in the month calendar
    // (src/components/ScheduleCalendar.tsx), and an unscoped locator can
    // resolve to both.
    await page
      .getByRole("list", { name: "Upcoming trips" })
      .locator("li")
      .filter({ hasText: title })
      .getByRole("link")
      .click();
    // The booking form is controlled, so wait for hydration before typing.
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name", { exact: true }).fill("Nemo Quinn");
    // Same frozen-clock suffix convention as the trip title above.
    await page.getByLabel("Email", { exact: true }).fill(`nemo-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: /^Book/ }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat/ })).toBeVisible();

    // The confirmation hands the diver their readiness link — follow it.
    await page.getByRole("link", { name: /readiness page/ }).click();
    await expect(page).toHaveURL(/\/ready\//);
    await expect(page.getByRole("heading", { name: "Your pre-trip checklist" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Emergency contact" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rental fit" })).toBeVisible();

    // The emergency contact is transactional now — the diver fills it in place.
    await page.getByLabel("Contact name").fill("Coral Quinn");
    await page.getByLabel("Contact phone").fill("+1 305 555 0180");
    await page.getByRole("button", { name: "Save contact" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Emergency contact saved" }),
    ).toBeVisible();
    // The row now reads as on file rather than asking again.
    await expect(page.getByText(/On file — Coral Quinn/)).toBeVisible();

    // Where the diver is actually going, and how to reach the people who will
    // be there. This page used to close on a one-line "Questions? Reach out to
    // {shop}" that named the shop and left the address to be hunted for.
    const shopCard = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Your dive shop" }) });
    await expect(shopCard.getByText("Blue Mantis Divers")).toBeVisible();
    await expect(shopCard.getByText("100 Ocean Drive")).toBeVisible();
    await expect(shopCard.getByText("Key Largo, FL 33037")).toBeVisible();
    await expect(shopCard.getByRole("link", { name: "hello@demo.invalid" })).toHaveAttribute(
      "href",
      "mailto:hello@demo.invalid",
    );
    // The map is a plain roadmap embed built from the shop's own address —
    // never a guessed location. The e2e context aborts maps.google.com
    // requests (fixtures.ts), so this asserts the frame, not its contents.
    await expect(shopCard.locator('iframe[title="Map of Blue Mantis Divers"]')).toHaveAttribute(
      "src",
      /100%20Ocean%20Drive/,
    );
  });
});

test("a tampered readiness token reveals nothing", async ({ page }) => {
  await page.goto("/ready/not-a-real-token");
  await expect(page.getByRole("heading", { name: /readiness link isn.t available/ })).toBeVisible();
});
