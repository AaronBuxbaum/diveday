/**
 * **The `<h1>` spelling for every page a person arrives at from a link.**
 *
 * ADR 20260827-the-divers-thread, decision 1: the thread's four bearer pages,
 * the eight doors (`EntryShell`), the terminal outcomes (`EntryDone`), the two
 * 404s and the eleven error boundaries all say the page's name at one size.
 * Before this constant they said it at three — `text-3xl font-semibold` on the
 * token pages, `text-2xl`/`text-3xl` forked by width in `EntryShell`,
 * `text-2xl` on the 404s and the boundaries — so a diver walking their own
 * thread watched the title change weight between the link they tapped and the
 * page it landed on.
 *
 * A leaf module with no imports, deliberately: `ErrorPage` is a Client
 * Component, and the eyebrow's twin constant (`EYEBROW_CLASS`) lives in
 * `ShopPageHeader.tsx` beside the header that owns it — a module carrying
 * `next/link` and the card shell, which reaching for from the client would
 * pull the whole of it into the browser bundle for one string.
 *
 * `text-balance` is not baked in: it belongs to titles that wrap (a trip name),
 * not to the ones that don't, and each shell decides.
 */
export const SHELL_TITLE_CLASS = "text-3xl font-bold tracking-tight";
