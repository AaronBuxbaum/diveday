import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow } from "./helpers";

test("an uncertified visitor can enroll in an instructor-staffed Discover Scuba session and save rental preferences", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page.getByRole("link", { name: /Discover Scuba — Pool & Reef/ }).click();
  await expect(page.getByText("Course session · Discover Scuba Diving")).toBeVisible();

  // The booking form is controlled, so wait for hydration before typing.
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name").fill("Nora Quinn");
  await page.getByLabel("Email").fill("nora@example.com");
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page.getByRole("heading", { name: /You're on the boat, Nora/ })).toBeVisible();

  await page.getByLabel("BCD size").selectOption("L");
  await page.getByLabel("Wetsuit size").selectOption("XL");
  await page.getByRole("button", { name: "Save rental fit" }).click();
  await expect(page.getByRole("status")).toContainText("The crew will see this when they pack");
});

test.describe("staff", () => {
  signedInAsOwner();

  test("staff set course pricing on the page and hide the course from scheduling", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/courses");
    const row = page.getByRole("listitem").filter({ hasText: "Discover Scuba Diving" });
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/courses\/discover-scuba-diving\/edit/);

    // Pricing now lives on the course page, beside the copy it prices.
    await page.getByLabel("Instruction fee").fill("149.00");
    await page.getByLabel("e-Learning fee").fill("100.00");
    await page.getByRole("button", { name: "Save course page" }).click();
    await expect(page.getByRole("status")).toContainText("Course page saved");

    // The two items are billed separately, so the public page states the single
    // payment the diver makes for both.
    await page.goto("/shop/blue-mantis/courses/discover-scuba-diving");
    await expect(page.getByText("$249")).toBeVisible();

    // Back on the roster, the eye toggle hides the course from scheduling lists.
    // No banner and no navigation — the icon and the "Hidden" badge update in
    // place, which is also what keeps the click from jumping the page.
    await page.goto("/shop/blue-mantis/courses");
    await page.getByRole("button", { name: "Hide Discover Scuba Diving" }).click();
    const row2 = page.getByRole("listitem").filter({ hasText: "Discover Scuba Diving" });
    await expect(row2.getByText("Hidden")).toBeVisible();
    await expect(row2.getByRole("button", { name: "Show Discover Scuba Diving" })).toBeVisible();
  });

  test("staff edit a seeded course page, toggle it live, and a signed-out diver reads it", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/courses");
    // Every course ships pre-filled and visible — there is no catalog to import
    // from. Open Rescue Diver straight from the roster. Match the title exactly:
    // the Divemaster row names "Rescue Diver or higher" in its prerequisite line.
    const row = page
      .getByRole("listitem")
      .filter({ has: page.getByText("Rescue Diver", { exact: true }) });
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/courses\/rescue-diver\/edit/);

    const dayPlan = page.getByLabel("Day plan");
    await dayPlan.fill(`${await dayPlan.inputValue()}\n\nDay 4 — 9:00am–noon\nScenario retest`);
    await page.getByLabel("FAQ").fill("Do I need my own gear?\nNo — we provide everything.");
    await page.getByRole("button", { name: "Save course page" }).click();
    await expect(page.getByRole("status")).toContainText("Course page saved");

    // Hide takes the page down; Show brings it back.
    await page.getByRole("button", { name: "Hide" }).click();
    await expect(page.getByRole("status")).toContainText("hidden");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page.getByRole("status")).toContainText("live");

    // A diver arrives with no session at all.
    await page.context().clearCookies();
    await page.goto("/shop/blue-mantis/courses/rescue-diver");
    await expect(page.getByRole("heading", { name: "Rescue Diver", level: 1 })).toBeVisible();
    // Admission is stated once, in the block that also owns the shop's own
    // prerequisite prose — labelled separately so the two can never be read as
    // one continuous claim. The spec chips carry logistics only.
    const admission = page.getByRole("region", { name: "Who can enroll" });
    await expect(admission.getByText("Advanced Open Water or higher")).toBeVisible();
    await expect(admission.getByRole("heading", { name: "From the shop" })).toBeVisible();
    await expect(page.getByLabel("At a glance")).not.toContainText("Advanced Open Water or higher");
    await expect(page.getByRole("heading", { name: "Day 4" })).toBeVisible();
    await expect(page.getByText("Do I need my own gear?")).toBeVisible();

    // The staff pages above and below it stay closed to that same visitor.
    await page.goto("/shop/blue-mantis/courses/rescue-diver/edit");
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/shop/blue-mantis/courses");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("oversize and over-limit course photos are rejected client-side (CR-011)", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/courses");
    const row = page.getByRole("listitem").filter({ hasText: "Discover Scuba Diving" });
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/courses\/discover-scuba-diving\/edit/);

    const heroInput = page.locator('input[name="heroImageFile"]');
    await heroInput.setInputFiles({
      name: "hero.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(6 * 1024 * 1024), // over the 5 MB course-photo limit
    });
    await expect(page.getByRole("alert").filter({ hasText: "over 5 MB" })).toBeVisible();
    await expect(heroInput).toHaveValue("");

    // The gallery accepts new photos in small batches (next.config.ts's Server
    // Actions body limit is sized for that batch, not an unbounded multi-file
    // body) — picking more than the batch cap at once is rejected the same way.
    const galleryInput = page.locator('input[name="galleryImageFiles"]');
    await galleryInput.setInputFiles([
      { name: "one.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(1024) },
      { name: "two.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(1024) },
      { name: "three.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(1024) },
    ]);
    await expect(
      page.getByRole("alert").filter({ hasText: "up to 2 photos at a time" }),
    ).toBeVisible();
    await expect(galleryInput).toHaveValue("");
  });

  test("a diver books a course session from its public page", async ({ page }) => {
    // Schedule this run's own session rather than spending a seeded seat: the e2e
    // database persists across runs, so a test that books the demo session works
    // exactly six times and then fails as "full".
    const sessionTitle = `Open Water Diver — session ${e2eNow().getTime()}`;
    await page.goto("/shop/blue-mantis/trips/new");
    await page.getByLabel("Course").selectOption({ label: "Open Water Diver" });
    await page.getByLabel("Title").fill(sessionTitle);
    await page.getByLabel("Date").fill(daysFromNow(21));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("17:00");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible(); // created banner ⇒ the redirect settled

    // A course session refuses bookings until an instructor is on its crew — the
    // rule that makes this flow safe, and the reason the seeded session works.
    await page.goto("/shop/blue-mantis/schedule");
    await page.getByRole("link", { name: new RegExp(sessionTitle) }).click();
    await expect(
      page.getByText("cannot take bookings until one assigned crew member has the instructor role"),
    ).toBeVisible();
    await page.getByLabel(/Marcus Webb/).check();
    await page.getByRole("button", { name: "Save crew" }).click();
    await expect(
      page.getByText("cannot take bookings until one assigned crew member has the instructor role"),
    ).toBeHidden();

    await page.context().clearCookies();
    await page.goto("/shop/blue-mantis/courses/open-water-diver");
    await expect(page.getByRole("heading", { name: "Upcoming dates" })).toBeVisible();
    // Sessions are listed soonest first, so the one just scheduled 21 days out is
    // the last — and the only one this test may consume a seat from.
    await page.getByRole("link", { name: "Book this date" }).last().click();
    await expect(page.getByText("Course session · Open Water Diver")).toBeVisible();

    // The booking form is controlled, so wait for hydration before typing.
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    const diver = `Ravi ${e2eNow().getTime()}`;
    await page.getByLabel("Name").fill(diver);
    await page.getByLabel("Email").fill(`ravi-${e2eNow().getTime()}@example.com`);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    await expect(page.getByRole("heading", { name: /You're on the boat, Ravi/ })).toBeVisible();
  });

  // PADI's published entry-level in-water ratio (H-08, src/lib/course-ratios.ts):
  // a solo instructor seats at most 8 students, independent of the trip's own
  // stated capacity. Set the trip's capacity well above 8 so the ratio — not
  // capacity — is what blocks the 9th booking.
  test("a solo-instructor course session refuses a booking past the 8-seat ratio", async ({
    page,
  }) => {
    const sessionTitle = `Ratio test session ${e2eNow().getTime()}`;
    await page.goto("/shop/blue-mantis/trips/new");
    await page.getByLabel("Course").selectOption({ label: "Open Water Diver" });
    await page.getByLabel("Title").fill(sessionTitle);
    await page.getByLabel("Date").fill(daysFromNow(22));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("17:00");
    await page.getByLabel("Capacity").fill("12");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible();

    await page.goto("/shop/blue-mantis/schedule");
    await page.getByRole("link", { name: new RegExp(sessionTitle) }).click();
    await page.getByLabel(/Marcus Webb/).check(); // the seeded instructor
    await page.getByRole("button", { name: "Save crew" }).click();
    await expect(page.getByRole("status")).toContainText("Crew updated");
    const tripUrl = page.url();

    await page.context().clearCookies();
    const stamp = e2eNow().getTime();
    const bookSlots = async (count: number, offset: number) => {
      await page.goto(tripUrl.replace("/trips/", "/schedule/"));
      const partySize = page.getByLabel("Number of divers");
      await expect(partySize).toHaveAttribute("data-hydrated", "true");
      await partySize.selectOption(String(count));
      for (let i = 0; i < count; i++) {
        const label = offset + i;
        const nameField =
          i === 0
            ? page.getByLabel("Name", { exact: true })
            : page.getByLabel(`Diver ${i + 1} name`);
        const emailField =
          i === 0
            ? page.getByLabel("Email", { exact: true })
            : page.getByLabel(`Diver ${i + 1} email`);
        await nameField.fill(`Ratio Diver ${label}`);
        await emailField.fill(`ratio-${stamp}-${label}@example.com`);
      }
      await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
      await expect(page.getByRole("heading", { name: /You're on the boat/ })).toBeVisible();
    };

    // Two party bookings fill the 8-seat ratio (6 + 2); the trip's own
    // capacity (12) still has four seats open.
    await bookSlots(6, 0);
    await bookSlots(2, 6);

    // The 9th diver hits the ratio, not capacity.
    await page.goto(tripUrl.replace("/trips/", "/schedule/"));
    // The booking form is controlled, so wait for hydration before typing.
    await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
    await page.getByLabel("Name", { exact: true }).fill(`Ratio Diver ${stamp}-9`);
    await page.getByLabel("Email", { exact: true }).fill(`ratio-${stamp}-9@example.com`);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    await expect(
      page.getByText("This session is at its instructor-to-student ratio limit"),
    ).toBeVisible();
  });
});

test("a diver with no workable date gets a written email instead of a dead end", async ({
  page,
}) => {
  // Signed out: this is the composer a prospective diver meets, not staff.
  await page.goto("/shop/blue-mantis/courses/open-water-diver");

  const inquiry = page.getByRole("region", { name: "Get in touch" });
  await inquiry.scrollIntoViewIfNeeded();
  await page.getByLabel("Your name").fill("Mira Delgado");
  await page.getByLabel("How many divers").fill("3");
  await page.getByLabel("When suits you").fill("the week of 12 August");
  await page.getByLabel("Where you are up to").selectOption("I have never dived before");
  await page.getByLabel("Anything else").fill("We are ashore only on the Tuesday.");

  // The preview is the promise: what the diver reads here is exactly what the
  // mail client will be handed.
  const preview = inquiry.getByRole("region", { name: "Your message so far" });
  await expect(preview.getByText("Course inquiry: Open Water Diver")).toBeVisible();
  await expect(preview.getByText("How many divers: 3")).toBeVisible();
  await expect(preview.getByText("When: the week of 12 August")).toBeVisible();
  await expect(preview.getByText("We are ashore only on the Tuesday.")).toBeVisible();

  const mailto = await page
    .getByRole("link", { name: "Open in your email app" })
    .getAttribute("href");
  const url = new URL(mailto ?? "");
  expect(url.protocol).toBe("mailto:");
  expect(decodeURIComponent(url.pathname)).toBe("hello@bluemantis.example");
  const params = new URLSearchParams(url.search);
  expect(params.get("subject")).toBe("Course inquiry: Open Water Diver");
  expect(params.get("body")).toContain("Experience so far: I have never dived before");
  expect(params.get("body")).toContain("Mira Delgado");
});
