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
  // dives are gone. Changing a filter applies itself once hydrated; there is
  // no Apply button for anyone (ADR 20260812-javascript-is-required).
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

  // A full document reload keeps the filter selected — it's a query param, not
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

test("no control comes or goes from the filter row while it hydrates", async ({ page }) => {
  // The property, stated as a diver experiences it: the filter row a diver sees
  // on paint is the filter row they still see once it goes live. Nothing
  // appears, nothing disappears under a thumb already moving toward "Has
  // space".
  //
  // This has regressed twice, in opposite directions. An Apply button that
  // rendered for everyone and was *removed* on hydration made every visitor
  // watch it flash out — a horizontal shift that phone screenshots kept
  // catching mid-flight. Moving it into `<noscript>` fixed the flash by leaning
  // on a subtle React property, and hid a second problem behind it: the button
  // was unreachable for the JS-less reader it existed for, because this page
  // streams inside a hidden div that only an inline script relocates. It is now
  // gone entirely (ADR 20260812-javascript-is-required).
  //
  // Guarding the row's *inventory* rather than the button is what survives that
  // history: any future control that renders conditionally on hydration fails
  // this, whatever mechanism it reaches for.
  //
  // Counted, deliberately, rather than measured. The first shape of this test
  // sampled the form's bounding box and failed on CI with `["0x0", "1104x68"]`
  // — the sampler catching the page's own streaming, because until the inline
  // script relocates it the form sits inside `<div hidden id="S:…">` and so
  // measures 0x0 (the same mechanism that makes this page a permanent skeleton
  // without JavaScript — ADR 20260812-javascript-is-required). Whether the
  // first frame lands before or after that relocation is pure load timing: it
  // landed after on a developer machine and before on a CI runner. Filtering
  // zero-area samples fixes that one case and leaves another — a scrollbar
  // appearing as the list streams in changes the row's width too, and neither
  // is a control coming or going. A count moves if and only if the thing under
  // test happens.
  //
  // Sampled every frame from before hydration rather than asserted on the
  // settled page — a settled-page check passes just as happily against a
  // control that flashed and left, which is precisely what is being guarded.
  await page.addInitScript(() => {
    const w = window as unknown as { __filterControls: number[] };
    w.__filterControls = [];
    const sample = () => {
      // Found through its own `<select>`, never `document.querySelector("form")`
      // — this page carries more than one form, they stream in in an order
      // nothing guarantees, and "the first form in the DOM" is therefore a
      // different element from one frame to the next. That is what made the
      // first version of this test pass alone and fail under parallel workers.
      const form = document.querySelector('select[name="tripType"]')?.closest("form");
      if (form) {
        const count = form.querySelectorAll("button, input, select, textarea").length;
        if (w.__filterControls.at(-1) !== count) w.__filterControls.push(count);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto("/s/blue-mantis");

  // The filters are live, so the hydration window has closed and the sampler
  // above ran across all of it.
  await expect(page.getByLabel("Trip type")).toHaveAttribute("data-hydrated", "true");
  const counts = await page.evaluate(
    () => (window as unknown as { __filterControls: number[] }).__filterControls,
  );
  // One count for the whole window, and it is the two filters and nothing else.
  // (The sampler only records changes, so a stable row is exactly one entry;
  // asserting the value rather than just the length is what stops an empty or
  // never-found form passing as "never changed".)
  expect(counts).toEqual([2]);

  // And no Apply button at any point, for any reader.
  await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);
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
