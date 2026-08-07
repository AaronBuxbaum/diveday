// Every test in this file only reads — no writes, so it opts out of the per-test demo reset.
import { expect, readOnlyTest as test } from "./fixtures";

test("the schedule's trip-type and has-space filters narrow the list, server-rendered", async ({
  page,
}) => {
  await page.goto("/s/blue-mantis");
  // The filter <form> is immediately followed by the trip <ul> whenever there
  // are trips to show — scoping to that keeps this locator off the calendar's
  // own per-day lists and any other list on the page.
  const list = page.locator("form + ul");
  await expect(list.getByRole("listitem")).not.toHaveCount(0);
  // The unfiltered page mixes both kinds — the seeded reef charter is the
  // fun dive the course filter must remove. (Not a count comparison: both
  // views can fill a whole keyset page, and a full page filtered against a
  // full page proves nothing.)
  await expect(
    list.getByRole("listitem").filter({ hasText: "Two-Tank Reef — Molasses & French" }),
  ).toHaveCount(1);

  // Course-only: every visible row now names a course session, and the fun
  // dives are gone.
  await page.getByLabel("Trip type").selectOption("course");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/tripType=course/);
  const courseRows = list.getByRole("listitem");
  await expect(courseRows).not.toHaveCount(0);
  await expect(
    list.getByRole("listitem").filter({ hasText: "Two-Tank Reef — Molasses & French" }),
  ).toHaveCount(0);
  const courseCount = await courseRows.count();
  for (let i = 0; i < courseCount; i++) {
    await expect(courseRows.nth(i).getByText("Course session ·")).toBeVisible();
  }

  // A no-JS reload keeps the filter selected — it's a query param, not
  // client-only state.
  await page.reload();
  await expect(page.getByLabel("Trip type")).toHaveValue("course");

  // Combine with "has space": the seed has a sold-out course session, so this
  // narrows further still.
  await page.getByLabel("Has space").check();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/tripType=course/);
  await expect(page).toHaveURL(/hasSpace=1/);
});

test("paging and month arrows keep the filters a diver applied", async ({ page }) => {
  // Regression: the pager and month-arrow links rebuilt their query from
  // scratch and dropped `hasSpace`/`tripType`, so tapping "Show later" handed
  // back the full unfiltered list with the checkbox silently reset.
  await page.goto("/s/blue-mantis?hasSpace=1");
  const later = page.getByRole("link", { name: "Show later departures" });
  await expect(later).toHaveAttribute("href", /hasSpace=1/);

  // Deeper pages offer the way back — earlier, and straight to the start —
  // and both of those keep the view too.
  await later.click();
  await expect(page).toHaveURL(/after=/);
  await expect(page.getByRole("link", { name: "Show earlier departures" })).toHaveAttribute(
    "href",
    /hasSpace=1/,
  );
  await expect(page.getByRole("link", { name: "← Back to the next departure" })).toHaveAttribute(
    "href",
    /hasSpace=1/,
  );

  // The month rail's arrows re-render the same page (the list is bounded by
  // the filters), so they carry the whole view as well.
  await page.goto("/s/blue-mantis?hasSpace=1&tripType=fun_dive");
  const nextMonth = page.getByRole("link", { name: "Next month" });
  await expect(nextMonth).toHaveAttribute("href", /hasSpace=1/);
  await expect(nextMonth).toHaveAttribute("href", /tripType=fun_dive/);
});
