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
  // Changing a filter applies itself once hydrated. The Apply button is the
  // no-JS fallback and never renders for this reader at all — it lives inside
  // `<noscript>`, which a scripting-enabled browser keeps as text (the test
  // below pins that).
  await expect(page.getByLabel("Trip type")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Trip type").selectOption("course");
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
  await expect(page.getByLabel("Trip type")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("Has space").check();
  await expect(page).toHaveURL(/tripType=course/);
  await expect(page).toHaveURL(/hasSpace=1/);
});

test("the Apply button never gets a box for a diver with JavaScript", async ({ page }) => {
  // Apply is the no-JS fallback, and it used to be *removed* on hydration — so
  // every real visitor watched it render and then vanish a beat later, a small
  // horizontal shift beside "Has space" that phone screenshots kept catching
  // mid-flight. It now lives in `<noscript>`, which fixes that by leaning on
  // something subtle enough to be worth pinning down: a browser with scripting
  // enabled parses `<noscript>` content as a single *text node*, so the markup
  // never becomes elements and React does not hydrate into it.
  //
  // That property is load-bearing and invisible in the source — ScheduleFilters
  // states it in a comment and nothing else checks it. If React ever started
  // hydrating those children, the button would come back as a live element and
  // the flash would return, silently. Hence this test.
  //
  // Sampled every frame from before hydration, not asserted on the settled
  // page: a settled-page check passes just as happily against the old
  // remove-on-hydrate behaviour, which is precisely what is being guarded.
  await page.addInitScript(() => {
    const w = window as unknown as { __applyEverBoxed: boolean };
    w.__applyEverBoxed = false;
    const sample = () => {
      for (const el of document.querySelectorAll("noscript, noscript *")) {
        if (el.getBoundingClientRect().height > 0) w.__applyEverBoxed = true;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto("/s/blue-mantis");

  // The filters are live — so the window in which the old button would have
  // been removed has closed, and the sampler above ran across all of it.
  await expect(page.getByLabel("Trip type")).toHaveAttribute("data-hydrated", "true");
  expect(
    await page.evaluate(
      () => (window as unknown as { __applyEverBoxed: boolean }).__applyEverBoxed,
    ),
  ).toBe(false);

  // The button is text inside <noscript>, not an element: no accessible button
  // to find, and nothing parsed into child elements.
  await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector("noscript")?.children.length ?? -1)).toBe(
    0,
  );
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
