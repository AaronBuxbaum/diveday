import { expect, READ_ONLY, test } from "./fixtures";
import { signInAsOwner } from "./helpers";

/**
 * READ_ONLY holds here: the language choice is the `diveday_locale` cookie
 * (`setLocaleAction`, src/app/actions/set-locale.ts) — it writes no `people.locale`
 * and touches no row at all.
 */

/**
 * A reader picks their own language (ADR 20260812-reader-chosen-language).
 *
 * DiveDay used to negotiate from `Accept-Language` alone and offer nothing —
 * so a diver on a borrowed phone, and a staffer whose laptop somebody else set
 * up, both read a language they may not and could do nothing about it. The
 * choice is a cookie, so it survives navigation and outlives the tab, and it
 * never forks a URL: the shop's schedule keeps exactly one address in either
 * language.
 *
 * Each option is its own language's name for itself — "English", "Español" —
 * because the reader reaching for this control is by definition the one who
 * cannot read the label above it. Sentence-cased on the control even though
 * Spanish writes the language lowercase mid-sentence (src/i18n/language-labels.ts).
 */

test("a diver switches a shop's public pages into Spanish, and it survives navigation", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/s/blue-mantis");
  const header = page.getByRole("banner");
  // A picker, not a swap. The header used to render the alternatives alone —
  // one button reading "Español" — which cannot say which language you are in
  // and has no honest rendering at three languages. The trigger names the one
  // in force; the panel lists every language DiveDay carries, the current one
  // marked (`LanguagePicker`).
  await expect(header.getByRole("button", { name: "Change language" })).toContainText("English");

  await header.getByRole("button", { name: "Change language" }).click();
  // The language in force is *in* the list, marked. Without this a regression
  // that went back to filtering it out would still pass every other assertion
  // here — the alternative stays selectable in both directions either way.
  await expect(header.getByRole("button", { name: "English" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await header.getByRole("button", { name: "Español" }).click();

  // The words change; the address does not.
  // The schedule section is an `h2` now: slice 6i gave the `h1` to the
  // shop's own name, which is a proper noun and reads the same in every
  // language. `schedule.title` is still the translated proof.
  await expect(page.getByRole("heading", { level: 2, name: "Calendario" })).toBeVisible();
  await expect(page).toHaveURL("/s/blue-mantis");
  await expect(header.getByRole("button", { name: "Cambiar de idioma" })).toContainText("Español");

  // A cookie, not page state: a fresh load of a different public page is still
  // Spanish, which is the whole difference from a switcher that forgets.
  await page.goto("/s/blue-mantis/courses");
  await expect(page.getByRole("heading", { level: 1, name: "Cursos" })).toBeVisible();

  // …and back, from the same control, which offers every language either way
  // round rather than only the other one.
  await page.getByRole("banner").getByRole("button", { name: "Cambiar de idioma" }).click();
  await expect(page.getByRole("banner").getByRole("button", { name: "Español" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.getByRole("banner").getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
});

test.describe("staff", () => {
  test("a staffer switches the back office from the shop's own name, and from Search", {
    tag: READ_ONLY,
  }, async ({ page }) => {
    await signInAsOwner(page);
    await page.goto("/shop/blue-mantis/reviews");

    // Door one: behind the shop's name, filed with the other controls that are
    // about this person on this device rather than about the dive day.
    await page.locator("[data-identity-menu]").click();
    await page.getByRole("button", { name: "Español" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Lo que dicen los buceadores" }),
    ).toBeVisible();

    // Door two: the command palette, which is where a staffer who is already
    // typing looks for anything at all. Offered only in the languages *not* in
    // force — a row that changes nothing is not a command.
    await page.getByRole("button", { name: "Buscar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("option", { name: "Español" })).toHaveCount(0);
    await dialog.getByRole("option", { name: "English" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "What divers said" })).toBeVisible();
  });
});
