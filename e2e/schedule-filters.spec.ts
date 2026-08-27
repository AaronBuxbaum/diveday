import { expect, READ_ONLY, test } from "./fixtures";

/**
 * READ_ONLY holds here: the trip-type, has-space, paging and month controls all read
 * back out of the URL. Nothing on the public schedule writes.
 */

test("the schedule's trip-type and has-space filters narrow the list, server-rendered", {
  tag: READ_ONLY,
}, async ({ page }) => {
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

test("no control comes or goes from the filter row while it hydrates", { tag: READ_ONLY }, async ({
  page,
}) => {
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
  //
  // Sampled only while the row is *visible*, which is the third timing artifact
  // this test has had to shed. The HTML parser builds the form left to right,
  // and `tripType` is the first of its two controls, so there is a frame where
  // the DOM holds a form with one control in it — CI caught exactly that and
  // reported `[1, 2]`. It is not a control coming or going: until the inline
  // script relocates it, the whole subtree sits inside `<div hidden id="S:…">`,
  // so every half-built state of it is behind that `hidden` and no diver ever
  // sees one (ADR 20260812-javascript-is-required). Skipping the hidden frames
  // costs the test nothing it was guarding — hydration mutates the *relocated*
  // DOM, so both regressions in the history above still fail here.
  await page.addInitScript(() => {
    const w = window as unknown as { __filterSamples: Array<[number, boolean]> };
    w.__filterSamples = [];
    const sample = () => {
      // Found through its own `<select>`, never `document.querySelector("form")`
      // — this page carries more than one form, they stream in in an order
      // nothing guarantees, and "the first form in the DOM" is therefore a
      // different element from one frame to the next. That is what made the
      // first version of this test pass alone and fail under parallel workers.
      const form = document.querySelector('select[name="tripType"]')?.closest("form");
      if (form && !form.closest("[hidden]")) {
        const count = form.querySelectorAll("button, input, select, textarea").length;
        // Recorded alongside the count so the assertions below can prove the
        // sampler was running *across* the hydration window rather than only
        // after it — a sampler that woke up late would report a stable row for
        // the most boring of reasons.
        const live = form.querySelector("[data-hydrated]") !== null;
        const last = w.__filterSamples.at(-1);
        if (!last || last[0] !== count || last[1] !== live) w.__filterSamples.push([count, live]);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto("/s/blue-mantis");

  // The filters are live, so the hydration window has closed and the sampler
  // above ran across all of it.
  await expect(page.getByLabel("Trip type")).toHaveAttribute("data-hydrated", "true");
  const samples = await page.evaluate(
    () => (window as unknown as { __filterSamples: Array<[number, boolean]> }).__filterSamples,
  );
  // The sampler saw the row before it went live, so the window it reports on is
  // the one that matters. Without this, everything below passes vacuously on a
  // machine where the first visible frame is already hydrated.
  expect(samples[0]?.[1]).toBe(false);

  // One count for the whole window, and it is the two filters and nothing else.
  // (The sampler only records changes, so a stable row is exactly one entry;
  // asserting the value rather than just the length is what stops an empty or
  // never-found form passing as "never changed".)
  // Three, since issue #696 added the "what can you dive?" select beside the two.
  // The fourth control — "Hide what needs more" — renders only once a level is
  // stated, and that is a *URL* condition rather than a hydration one, so it is
  // present in the first paint of a page carrying `?canDive=` and absent from
  // every frame of this one. It is exactly the distinction this test is for.
  expect([...new Set(samples.map(([count]) => count))]).toEqual([3]);

  // And no Apply button at any point, for any reader.
  await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);
});

test("paging and month arrows keep the filters a diver applied", { tag: READ_ONLY }, async ({
  page,
}) => {
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

/**
 * Issue #696. The filters asked what the *list* is (trip type, has space) and
 * never the one thing the reader knows about themselves. DiveDay composes every
 * departure's gate already; this lets a diver say their level and see which
 * departures it opens.
 *
 * **Marked, not hidden, by default** -- a shop will take an Open Water diver on
 * an Advanced charter as a guided dive or sell them the specialty, so a filter
 * that silently removed those trips would cost the shop the sale. Hiding is a
 * second, opt-in control.
 *
 * The two departures this leans on are both on the first page of the default
 * view and both carry their gate from a *site*, so the assertion is about the
 * composed requirement rather than a hand-set trip field: the Duane charter asks
 * Advanced Open Water, the reef charter asks Open Water.
 */
test("stating a certification level marks the departures above it without removing them", {
  tag: READ_ONLY,
}, async ({ page }) => {
  // Six server round trips on one page -- four filter applications, a reload and
  // the initial load. Same aggregate-cost reasoning as the trip-type test above.
  test.setTimeout(45_000);
  await page.goto("/s/blue-mantis");
  const list = page.locator("form + ul");
  const advanced = list.getByRole("listitem").filter({ hasText: "Deep Wreck Charter — the Duane" });
  const reef = list.getByRole("listitem").filter({ hasText: "Two-Tank Reef — Molasses & French" });
  await expect(advanced).toHaveCount(1);
  await expect(reef).toHaveCount(1);
  // Unsaid by default: nothing is marked until the reader answers.
  await expect(page.getByText("Above your level")).toHaveCount(0);

  await expect(page.getByLabel("Trip type")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("What can you dive?").selectOption("open_water");
  await expect(page).toHaveURL(/canDive=open_water/);

  // Still on the list, and now saying why it is dimmed. The reef charter, which
  // an Open Water diver does meet, is untouched.
  await expect(advanced).toHaveCount(1);
  await expect(advanced.getByText("Above your level")).toBeVisible();
  await expect(reef.getByText("Above your level")).toHaveCount(0);
  // Said once above the list, with its count, rather than repeated per card.
  await expect(page.getByText(/asks? for more than Open Water/)).toBeVisible();

  // Saying a higher level opens them: the same page, nothing marked.
  await page.getByLabel("What can you dive?").selectOption("advanced_open_water");
  await expect(page).toHaveURL(/canDive=advanced_open_water/);
  await expect(advanced).toHaveCount(1);
  await expect(page.getByText("Above your level")).toHaveCount(0);

  // The shorter list is opt-in, and only offered once a level is stated.
  await page.getByLabel("What can you dive?").selectOption("open_water");
  await expect(page).toHaveURL(/canDive=open_water/);
  await page.getByLabel("Hide what needs more").check();
  await expect(page).toHaveURL(/hideAbove=1/);
  await expect(advanced).toHaveCount(0);
  await expect(reef).toHaveCount(1);

  // A full reload keeps both -- they are query params, not client state.
  await page.reload();
  await expect(page.getByLabel("What can you dive?")).toHaveValue("open_water");
  await expect(page.getByLabel("Hide what needs more")).toBeChecked();
});

/**
 * The hard constraint on this filter: it is a *stated preference* and never a
 * gate. A casual tap in a filter row must not become evidence the readiness
 * engine reasons about, so it is not persisted and never reaches the booking
 * form (ADR 20260814-self-declared-cards).
 *
 * **What this asserts changed on 2026-08-27, and the rule did not.** The form
 * used to carry its own per-diver certification select, so the guarantee was
 * checked by finding that select and reading it back empty. The anonymous
 * booking form now asks nothing about anyone's diving at all — the question
 * moved to `/ready/<token>`, which asks the diver whose booking it is rather
 * than whoever filled the form (`BookingPartyFields`'s own doc comment). So the
 * check is now the stronger one the move earned: no certification control
 * exists here for a filter value to reach, and re-adding one to the anonymous
 * form fails this test.
 *
 * The booking form's own submit is asserted visible first, so the absence below
 * is this form's silence rather than a page that never rendered.
 */
test("the stated level never reaches the booking form", { tag: READ_ONLY }, async ({ page }) => {
  await page.goto("/s/blue-mantis");
  await expect(page.getByLabel("Trip type")).toHaveAttribute("data-hydrated", "true");
  await page.getByLabel("What can you dive?").selectOption("rescue");
  await expect(page).toHaveURL(/canDive=rescue/);

  await page
    .locator("form + ul")
    .getByRole("listitem")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .first()
    .click();
  await expect(page).toHaveURL(/\/trips\//);

  const booking = page.getByRole("region", { name: "Grab a spot" });
  await expect(booking.getByRole("button", { name: "Book these spots" })).toBeVisible();
  await expect(booking.getByLabel(/Certification level/)).toHaveCount(0);
});
