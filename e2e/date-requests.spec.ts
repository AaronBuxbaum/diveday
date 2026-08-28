import { expect, test } from "./fixtures";
import { signInAsOwner } from "./helpers";

/**
 * Asking for a day that is not on the board, end to end: a diver sends the
 * request from the shop's own schedule page, and staff read it on
 * /shop/<shop>/requests grouped under the date they named.
 *
 * The dates are the point of the flow. A request that names one lands in that
 * day's group; the second diver here names the same day as their *alternate*,
 * which keeps both requests in the group while the individual rows retain
 * their preferred/alternate explanation.
 *
 * The day group owns the count and the act (ADR 20260827-people-not-lists,
 * decision 5), so "how many groups could make the 6th?" is read off that
 * group's own heading rather than off a line repeated inside it.
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
  const dateRequest = page.locator("#request-a-date");
  await expect(
    dateRequest.getByRole("heading", { name: "Nothing on a date that works?" }),
  ).toBeVisible();
  await dateRequest.locator("summary").click();

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
  await page.locator("#request-a-date summary").click();
  await page.getByLabel("What would you like to dive?").fill("A shallow reef morning");
  await page.getByLabel("Your email").fill("reef.fan.e2e@example.com");
  await page.getByLabel("Where you are up to").selectOption("lapsed");
  await page.getByLabel("Date you’d like").fill(ALTERNATE);
  await page.getByLabel("Or this date").fill(PREFERRED);
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.getByText("Inquiry sent")).toBeVisible();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/requests");
  await expect(page.getByRole("heading", { name: "Requested dates" })).toBeVisible();

  // Both date groups carry both requests, while each row retains the
  // preferred/alternate detail that explains why it is present. Scoped by each
  // group's own accessible name, never by the date *text*: a fallback inside
  // one group names the other group's date, so a hasText filter matches both
  // sections. Case-insensitive because the group label is set in small caps.
  const dayGroup = (date: string) =>
    page.getByRole("region", { name: new RegExp(`^${date} —`, "i") });
  const firstDay = dayGroup("Mar 6, 2027");
  // The group header owns the shared facts: how many groups could make the day
  // and roughly how many divers that is. No row repeats them.
  await expect(firstDay.getByRole("heading", { level: 2 })).toHaveText(/2 groups · 2 divers/i);
  await expect(firstDay.getByText("Wants to dive: Two dives on the Duane")).toBeVisible();
  // The group that named the 13th first is here as a fallback, and says so — in
  // the row's own words rather than in a badge on a tinted card.
  await expect(firstDay.getByText("Wants to dive: A shallow reef morning")).toBeVisible();
  await expect(firstDay.getByText(/First choice Mar 13, 2027/)).toBeVisible();

  const secondDay = dayGroup("Mar 13, 2027");
  await expect(secondDay.getByRole("heading", { level: 2 })).toHaveText(/2 groups · 2 divers/i);

  // The act the count exists for: the schedule builder, opened on that day.
  await expect(firstDay.getByRole("link", { name: "Add a departure" })).toHaveAttribute(
    "href",
    new RegExp(`/shop/blue-mantis/schedule/board\\?add=full&date=${PREFERRED}(?:&|$)`),
  );
});

test("a request with no date at all sits in its own group at the foot", async ({ page }) => {
  await page.goto("/s/blue-mantis");
  await page.locator("#request-a-date summary").click();
  await page.getByLabel("What would you like to dive?").fill("Whatever runs in October");
  await page.getByLabel("Your phone").fill("+1 305 555 0777");
  await page.getByLabel("Where you are up to").selectOption("never");
  await page.getByLabel("When suits you").fill("Some week in October, flights not booked");
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.getByText("Inquiry sent")).toBeVisible();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/requests");
  const noDate = page.getByRole("region", { name: /^No date named/i });
  await expect(noDate.getByText("Wants to dive: Whatever runs in October")).toBeVisible();
  // A tail with a count and no act: there is no day here to put a boat on.
  await expect(noDate.getByRole("link", { name: "Add a departure" })).toHaveCount(0);
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

/**
 * The board's request-plan panel is the one surface where staff copy is
 * composed on the *client* from a template the server handed over unformatted,
 * and until issue #606 nothing anywhere rendered it: the crew line carried an
 * ICU plural fetched with a formatting translator, which threw on every board
 * render outside production and printed its own source in production. Both
 * failures are invisible to a spec that only checks the link's href, so this
 * one follows the link and reads the paragraph.
 */
test("the builder opened from a day's requests reads as finished sentences", async ({ page }) => {
  test.setTimeout(45_000);

  await page.goto("/s/blue-mantis");
  await page.locator("#request-a-date summary").click();
  await page.getByLabel("What would you like to dive?").fill("A drift along the wall");
  await page.getByLabel("Your name").fill("Nadia Okonkwo");
  await page.getByLabel("Your email").fill("drift.fan.e2e@example.com");
  await page.getByLabel("Where you are up to").selectOption("certified");
  await page.getByLabel("Date you’d like").fill(PREFERRED);
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await expect(page.getByText("Inquiry sent")).toBeVisible();

  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/requests");
  const day = page.getByRole("region", { name: /^Mar 6, 2027 —/i });
  await day.getByRole("link", { name: "Add a departure" }).click();

  const plan = page.getByRole("group", { name: "Starting from requests" });
  await expect(plan).toBeVisible();

  // The lead is named and counted, and the crew line is a sentence rather than
  // the ICU template that used to survive to the screen.
  await expect(plan.getByText("Nadia Okonkwo (1 diver)")).toBeVisible();
  await expect(plan.getByText(/^Bring 1 divemaster — your \d+:1 target\.$/)).toBeVisible();
  expect(await plan.innerText()).not.toContain("{");
});
