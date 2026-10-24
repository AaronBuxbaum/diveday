/**
 * **The shop's one page width** (visual review 2026-10-24, B36): the header
 * and the footer the shell draws (`PublicShopShell`, `PublicShopChrome`) stand
 * at `max-w-6xl`, and so does every page's `<main>` between them. The course
 * index stood at `max-w-3xl` and a course at `max-w-4xl`, so the page's left
 * edge moved under a header that did not. Prose inside keeps its own reading
 * measure; the page does not.
 */
export const SHOP_MAIN_CLASS = "mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10";
