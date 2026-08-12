"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/i18n/locale-cookie";
import { isDiverLocale } from "@/i18n/settings";

/**
 * Remember the language this reader picked.
 *
 * Lives in `src/app/actions/` because it genuinely is used across pages — the
 * language switcher rides in the staff header, so every `/shop/**` route
 * carries it, and both doors on that header (the shop-name menu and the
 * command palette) call this one implementation.
 *
 * A Server Action rather than a GET route on purpose: a link that changes
 * stored state is a link a preloader, a scanner, or a link-preview fetch can
 * follow on the reader's behalf, and Next's action endpoint is same-origin and
 * POST-only. Nothing here is authorization-sensitive — the worst a forged call
 * achieves is rendering the app in Spanish — but there is no reason to build
 * the weaker version.
 *
 * An unsupported value is ignored rather than stored: the only bundles that
 * exist are `DIVER_LOCALES`, and a cookie naming any other tag would leave
 * every page falling back on every render for as long as it lived.
 * `src/i18n/request.ts` re-checks it on read anyway, because a cookie is
 * client-held state and its writer is never the only thing standing between it
 * and a page.
 */
export async function setLocaleAction(locale: string): Promise<void> {
  if (!isDiverLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    // Nothing in the browser reads this — the words are chosen during the
    // server render — so it has no business being script-readable.
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  // Every rendered page holds words in the old language, and the words are
  // chosen on the server, so nothing short of the whole tree is stale.
  revalidatePath("/", "layout");
}
