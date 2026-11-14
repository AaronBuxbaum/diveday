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
  // The page heading is the translated schedule title.
  await expect(page.getByRole("heading", { level: 1, name: "Calendario" })).toBeVisible();
  await expect(page).toHaveURL("/s/blue-mantis");
  await expect(header.getByRole("button", { name: "Cambiar de idioma" })).toContainText("Español");

  // A cookie, not page state: a fresh load of a different public page is still
  // Spanish, which is the whole difference from a switcher that forgets.
  // TEMPORARY: record menu event/state changes, never page text or URLs.
  await page.addInitScript(() => {
    const events: string[] = [];
    const ids = new WeakMap<Element, number>();
    let nextId = 0;
    const id = (node: Element) => {
      if (!ids.has(node)) ids.set(node, ++nextId);
      return ids.get(node);
    };
    const note = (kind: string, clicked?: Element | null) => {
      const trigger = document.querySelector('header button[aria-label="Cambiar de idioma"]');
      const menu = document.querySelector("[data-language-menu]");
      events.push(
        `${Math.round(performance.now())} ${kind} trigger=${trigger ? id(trigger) : 0} clicked=${clicked ? id(clicked) : 0} expanded=${trigger?.getAttribute("aria-expanded") === "true"} hydrated=${trigger?.getAttribute("data-language-probe-hydrated") === "true"} handled=${Number(trigger?.getAttribute("data-language-probe-clicked") ?? 0)} menu=${!!menu}`,
      );
      if (events.length > 100) events.shift();
    };
    for (const phase of [true, false])
      document.addEventListener(
        "click",
        (event) => {
          const target = event.target instanceof Element ? event.target.closest("button") : null;
          if (target?.getAttribute("aria-label") === "Cambiar de idioma")
            note(
              `click-${phase ? "capture" : "bubble"}-prevented=${event.defaultPrevented}`,
              target,
            );
        },
        phase,
      );
    new MutationObserver((changes) => {
      if (
        changes.some(
          (change) =>
            change.target instanceof Element &&
            ((change.type === "childList" && !!change.target.closest("header")) ||
              change.target.getAttribute("aria-label") === "Cambiar de idioma"),
        )
      )
        note("mutation");
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "aria-expanded",
        "data-language-probe-hydrated",
        "data-language-probe-clicked",
      ],
    });
    (window as Window & { __languageDebug?: string[] }).__languageDebug = events;
  });
  await page.goto("/s/blue-mantis/courses");
  await expect(page.getByRole("heading", { level: 1, name: "Cursos" })).toBeVisible();

  // …and back, from the same control, which offers every language either way
  // round rather than only the other one.
  await page.getByRole("banner").getByRole("button", { name: "Cambiar de idioma" }).click();
  try {
    await expect(page.getByRole("banner").getByRole("button", { name: "Español" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  } catch (error) {
    const events = await page
      .evaluate(() => (window as Window & { __languageDebug?: string[] }).__languageDebug ?? [])
      .catch(() => []);
    process.stderr.write(`TEMPORARY language menu events: ${JSON.stringify(events)}\n`);
    throw error;
  }
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
    await expect(page.getByRole("heading", { level: 1, name: "Mensajes" })).toBeVisible();

    // Door two: the command palette, which is where a staffer who is already
    // typing looks for anything at all. Offered only in the languages *not* in
    // force — a row that changes nothing is not a command.
    await page.getByRole("button", { name: "Buscar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("option", { name: "Español" })).toHaveCount(0);
    await dialog.getByRole("option", { name: "English" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  });
});
