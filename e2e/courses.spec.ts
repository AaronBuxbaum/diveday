import { expect, signedInAsOwner, test } from "./fixtures";
import { acceptAgeAttestation, daysFromNow, e2eNow, findTripOnBoard } from "./helpers";

test("an uncertified visitor can enroll in an instructor-staffed Discover Scuba session and save rental preferences", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page.getByRole("link", { name: /Discover Scuba — Pool & Reef/ }).click();
  // Wait for the navigation before asserting on text. `click()` returns as soon
  // as the click is dispatched, so the next assertion can still run against the
  // schedule — where "Course session · Discover Scuba Diving" appears once per
  // seeded session. A strict-mode violation is thrown immediately rather than
  // retried, so that race fails the test outright instead of settling.
  await expect(page).toHaveURL(/\/schedule\/[0-9a-f-]{36}/);
  await expect(page.getByText("Course session · Discover Scuba Diving")).toBeVisible();
  // The course session line links out to the course page (a crawlable
  // inbound link for SEO), mirroring the link the schedule list already
  // carries — never just a bare name.
  const courseLink = page.getByRole("link", { name: "Discover Scuba Diving" });
  await expect(courseLink).toHaveAttribute("href", /\/courses\//);
  await expect(courseLink).toHaveAttribute(
    "href",
    "/shop/blue-mantis/courses/discover-scuba-diving",
  );
  await expect(page.getByText("Giving this dive as a gift?")).toBeVisible();
  await expect(page.getByRole("link", { name: "Add to calendar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share with a buddy" })).toBeVisible();
  const calendar = await page.request.get(`${new URL(page.url()).pathname}/calendar`);
  expect(calendar.ok()).toBe(true);
  expect(calendar.headers()["content-type"]).toContain("text/calendar");
  expect(await calendar.text()).toContain("BEGIN:VCALENDAR");

  // The booking form is controlled, so wait for hydration before typing.
  await expect(page.getByLabel("Number of divers")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Name").fill("Nora Quinn");
  await page.getByLabel("Email").fill("nora@example.com");
  await acceptAgeAttestation(page);
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page.getByRole("heading", { name: /You’re on the boat, Nora/ })).toBeVisible();

  await page.getByLabel("BCD size").selectOption("L");
  await page.getByLabel("Wetsuit size").selectOption("XL");
  await page.getByRole("button", { name: "Save rental fit" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "The crew will see this when they pack" }),
  ).toBeVisible();
});

test("a regular fun-dive trip does not show the taster-session gift nudge", async ({ page }) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link", { name: "Two-Tank Reef — Molasses & French" })
    .click();
  await expect(page).toHaveURL(/\/schedule\/[0-9a-f-]{36}/);
  await expect(page.getByText("Giving this dive as a gift?")).not.toBeVisible();
});

test("a signed-out visitor browses the public course catalog to certification paths, with the editor still gated", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/courses");
  await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Open Water Diver", exact: true }),
  ).toBeVisible();
  // No staff affordance renders at all — not disabled, absent (AGENTS.md
  // hard rule: gate by not rendering).
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Hide|^Show/ })).toHaveCount(0);

  await page
    .getByRole("link", { name: "Not sure where to start? See certification paths" })
    .click();
  await expect(page).toHaveURL(/\/courses\/paths$/);
  await expect(page.getByRole("heading", { level: 1, name: "Certification paths" })).toBeVisible();
  const seededPath = page.getByRole("link", { name: "From first breath to Rescue Diver" });
  await expect(seededPath).toBeVisible();
  await expect(page.getByLabel("Path name")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create path" })).toHaveCount(0);

  await seededPath.click();
  await expect(page).toHaveURL(/\/courses\/paths\/from-first-breath-to-rescue-diver$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "From first breath to Rescue Diver" }),
  ).toBeVisible();
  const steps = page.getByRole("list");
  await expect(steps.getByRole("link", { name: "Discover Scuba Diving" })).toBeVisible();
  await expect(steps.getByRole("link", { name: "Rescue Diver" })).toBeVisible();
  // No path editor surfaces for a signed-out visitor.
  await expect(page.getByRole("checkbox", { name: /Offer this path/ })).toHaveCount(0);
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
    await expect(row.getByRole("link", { name: "Preview Discover Scuba Diving" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/courses/discover-scuba-diving",
    );
    await row.getByRole("button", { name: "Hide Discover Scuba Diving" }).click();
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

    await page.getByRole("button", { name: "Add day" }).click();
    await page.getByLabel("Day 4 title").fill("Day 4");
    await page.getByLabel("Day 4 start time").fill("09:00");
    await page.getByLabel("Day 4 end time").fill("12:00");
    await page.getByRole("button", { name: "Add item" }).last().click();
    await page.getByLabel("Day 4 item 1", { exact: true }).fill("Scenario retest");
    await page.getByLabel("FAQ").fill("Do I need my own gear?\nNo — we provide everything.");
    // Off by default on a real certification course; the checkbox persists
    // through a save/reload the same as every other field on this form.
    const introCheckbox = page.getByRole("checkbox", { name: /taster session/ });
    await expect(introCheckbox).not.toBeChecked();
    await introCheckbox.check();
    await page.getByRole("button", { name: "Save course page" }).click();
    await expect(page.getByRole("status")).toContainText("Course page saved");
    await expect(page.getByRole("checkbox", { name: /taster session/ })).toBeChecked();

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

    // The editor stays closed to that same visitor. The catalog index above it
    // is a public page now (task 2) — it renders the catalog rather than
    // bouncing to sign-in, and carries no edit affordance.
    await page.goto("/shop/blue-mantis/courses/rescue-diver/edit");
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/shop/blue-mantis/courses/new");
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/shop/blue-mantis/courses");
    await expect(page).not.toHaveURL(/\/sign-in/);
    await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
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
    // Keep the test-created class clear of the seeded Deep Diver session,
    // which spans into day 21 and intentionally exercises crew overlap rules.
    await page.getByLabel("Date").fill(daysFromNow(24));
    await page.getByLabel("Departs").fill("08:00");
    await page.getByLabel("Returns").fill("17:00");
    await page.getByRole("button", { name: "Put it on the board" }).click();
    await expect(page.getByRole("status")).toBeVisible(); // created banner ⇒ the redirect settled

    // A course session refuses bookings until an instructor is on its crew — the
    // rule that makes this flow safe, and the reason the seeded session works.
    // Anchored to the full accessible name: an unpriced trip's card also
    // carries a "Set a price for {title}, ..." link whose name contains the
    // session title as a substring, so an unanchored pattern matches both.
    await (await findTripOnBoard(page, "blue-mantis", new RegExp(`^${sessionTitle}$`))).click();
    await expect(
      page.getByText("cannot take bookings until one assigned crew member has the instructor role"),
    ).toBeVisible();
    // Per-person assign, the same mutation Today's departure board uses
    // (Lens 17 task 139) — not a checkbox roster with a single submit.
    await page.getByLabel("Assign crew").selectOption({ label: "Marcus Webb" });
    await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();
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
    await acceptAgeAttestation(page);
    await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
    await expect(page.getByRole("heading", { name: /You’re on the boat, Ravi/ })).toBeVisible();
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

    // Anchored to the full accessible name: an unpriced trip's card also
    // carries a "Set a price for {title}, ..." link whose name contains the
    // session title as a substring, so an unanchored pattern matches both.
    await (await findTripOnBoard(page, "blue-mantis", new RegExp(`^${sessionTitle}$`))).click();
    await page.getByLabel("Assign crew").selectOption({ label: "Marcus Webb" }); // the seeded instructor
    await expect(page.getByRole("button", { name: "Unassign Marcus Webb" })).toBeVisible();
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
      await acceptAgeAttestation(page);
      await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
      await expect(page.getByRole("heading", { name: /You’re on the boat/ })).toBeVisible();
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
    await acceptAgeAttestation(page);
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
  // The option's value is now the code ("never"), not its rendered label —
  // src/lib/course-inquiry.ts returns codes, and the diver bundle supplies
  // the sentence.
  await page.getByLabel("Where you are up to").selectOption("never");
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
  expect(decodeURIComponent(url.pathname)).toBe("hello@demo.invalid");
  const params = new URLSearchParams(url.search);
  expect(params.get("subject")).toBe("Course inquiry: Open Water Diver");
  expect(params.get("body")).toContain("Experience so far: I have never dived before");
  expect(params.get("body")).toContain("Mira Delgado");
});

test("a blank inquiry is rejected, not defaulted — experience is required (task 8)", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/courses/open-water-diver");
  const inquiry = page.getByRole("region", { name: "Get in touch" });
  await inquiry.scrollIntoViewIfNeeded();

  // No experience picked: every path the composer offers refuses to go
  // through, not just the one a diver happens to reach for first.
  await inquiry.getByRole("button", { name: "Send inquiry" }).click();
  await expect(inquiry.getByText("Let us know where you are up to before sending.")).toBeVisible();
  await expect(inquiry.getByText("Inquiry sent")).toHaveCount(0);

  await inquiry.getByRole("link", { name: "Open in your email app" }).click();
  await expect(inquiry.getByText("Let us know where you are up to before sending.")).toBeVisible();
});

test("a diver's inquiry is recorded server-side and the shop's details stay reachable after sending", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/courses/open-water-diver");
  const inquiry = page.getByRole("region", { name: "Get in touch" });
  await inquiry.scrollIntoViewIfNeeded();
  await page.getByLabel("Your name").fill("Sena Okafor");
  await page.getByLabel("Your email").fill("sena.okafor.e2e@example.com");
  await page.getByLabel("Your phone").fill("+1 305 555 0199");
  await page.getByLabel("Where you are up to").selectOption("certified");

  await inquiry.getByRole("button", { name: "Send inquiry" }).click();

  // The composer collapses into a confirmation — task 7's server-recorded
  // send, not just the mailto fallback — and still leaves the shop's own
  // contact details on screen underneath it.
  await expect(inquiry.getByText("Inquiry sent")).toBeVisible();
  await expect(inquiry.getByText("hello@demo.invalid")).toBeVisible();
});
