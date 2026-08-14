import { expect, test } from "./fixtures";
import { signInAsOwner } from "./helpers";

/**
 * Asking for a day that is not on the board, end to end: a diver sends the
 * request from the shop's own schedule page, and staff read it on
 * /shop/<shop>/requests grouped under the day they asked for.
 *
 * The dates are the point of the flow. A request that names one lands in that
 * day's group; the second diver here names the same day as their *alternate*,
 * which is what makes the group's headline count "people who could make this"
 * rather than "people who asked for this" — the distinction the staff page
 * renders as a firm count beside it.
 */

/** Two dates well clear of the frozen clock, so the grouping is only ours. */
const PREFERRED = "2027-03-06";
const ALTERNATE = "2027-03-13";

test("a diver asks for a date from the schedule page and staff read it grouped by day", async ({
  page,
}) => {
  // A public submit, a staff sign-in, and a second public submit in one flow —
  // the suite's default timeout is sized for a single flow, not three.
  test.setTimeout(45_000);

  await page.goto("/s/blue-mantis");
  await expect(page.getByRole("heading", { name: "Nothing on a date that works?" })).toBeVisible();

  // The request is about *something*: with no course in the URL, the form asks,
  // and refuses to send until it is answered.
  await page.getByLabel("Your email").fill("wreck.fan.e2e@example.com");
  await page.getByLabel("Where you are up to").selectOption("certified");
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.getByText("Tell us what you’d like to dive before sending.")).toBeVisible();

  await page.getByLabel("What would you like to dive?").fill("Two dives on the Duane");
  await page.getByLabel("Date you’d like").fill(PREFERRED);
  await page.getByLabel("Or this date").fill(ALTERNATE);
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.getByText("Inquiry sent")).toBeVisible();

  // A second diver whose *first* choice is the later day — so the earlier
  // group holds them only as a fallback, and the later one as a firm ask.
  await page.goto("/s/blue-mantis");
  await page.getByLabel("What would you like to dive?").fill("A shallow reef morning");
  await page.getByLabel("Your email").fill("reef.fan.e2e@example.com");
  await page.getByLabel("Where you are up to").selectOption("lapsed");
  await page.getByLabel("Date you’d like").fill(ALTERNATE);
  await page.getByLabel("Or this date").fill(PREFERRED);
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.getByText("Inquiry sent")).toBeVisible();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/requests");
  await expect(page.getByRole("heading", { name: "Dates divers asked for" })).toBeVisible();

  // Both days carry both divers — everyone who could make them — and each says
  // how many of those asked for it first.
  // Scoped by each group's own heading, never by the date *text*: a fallback
  // badge inside one group names the other group's date, so a hasText filter
  // matches both sections.
  const dayGroup = (heading: string) =>
    page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: heading }) });
  const firstDay = dayGroup("Mar 6, 2027");
  await expect(
    firstDay.getByText("2 divers could make this day · 1 asked for it first"),
  ).toBeVisible();
  await expect(firstDay.getByText("Wants to dive: Two dives on the Duane")).toBeVisible();
  // The one who named the 13th first is here as a fallback, and says so.
  await expect(firstDay.getByText("Wants to dive: A shallow reef morning")).toBeVisible();
  await expect(firstDay.getByText("First choice Mar 13, 2027")).toBeVisible();

  const secondDay = dayGroup("Mar 13, 2027");
  await expect(
    secondDay.getByText("2 divers could make this day · 1 asked for it first"),
  ).toBeVisible();

  // The act the count exists for: the schedule builder, opened on that day.
  await expect(firstDay.getByRole("link", { name: "Put a departure on this day" })).toHaveAttribute(
    "href",
    `/shop/blue-mantis/schedule/board?add=full&date=${PREFERRED}`,
  );
});

test("a request with no date at all sits in its own group at the foot", async ({ page }) => {
  await page.goto("/s/blue-mantis");
  await page.getByLabel("What would you like to dive?").fill("Whatever runs in October");
  await page.getByLabel("Your phone").fill("+1 305 555 0777");
  await page.getByLabel("Where you are up to").selectOption("never");
  await page.getByLabel("When suits you").fill("Some week in October, flights not booked");
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.getByText("Inquiry sent")).toBeVisible();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/requests");
  const noDate = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: "No date named" }) });
  await expect(noDate.getByText("Wants to dive: Whatever runs in October")).toBeVisible();
  await expect(
    noDate.getByText("When suits: Some week in October, flights not booked"),
  ).toBeVisible();
});

test("a course page's request names the course, and reaches the same list", async ({ page }) => {
  await page.goto("/s/blue-mantis/courses/open-water-diver");
  await page.getByLabel("Your email").fill("course.date.e2e@example.com");
  await page.getByLabel("Where you are up to").selectOption("never");
  await page.getByLabel("Date you’d like").fill(PREFERRED);
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.getByText("Inquiry sent")).toBeVisible();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/requests");
  await expect(page.getByText("About Open Water Diver").first()).toBeVisible();
});
