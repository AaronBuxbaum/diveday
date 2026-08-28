import { headers } from "next/headers";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { REQUEST_PATH_HEADER } from "@/lib/embed-routes";
import { publicSchedulePath, shopSlugFromPublicPath } from "@/lib/public-routes";

/**
 * **A dead link inside a shop's namespace stays inside that shop.**
 *
 * Every `notFound()` under `/s/**` used to land on `src/app/not-found.tsx` —
 * the app-wide backstop, which renders no shop chrome, says `DIVEDAY` in the
 * one word above the heading, and offers a single button to `/`, DiveDay's
 * *sales* homepage. A diver who tapped a last-season link for a reef trip was
 * handed "Run the whole dive day" and "Start a trial" (issue #765). Stale
 * links outlive the departures they point at, so that was the single most
 * likely first impression a diver would ever have of a DiveDay shop.
 *
 * This file changes nothing but which boundary catches it: Next renders the
 * nearest `not-found.tsx`, so the shop's own header, nav and footer come from
 * `layout.tsx` exactly as on any other page here, and the only thing left to
 * write is one accurate sentence and one link back to the board. The root file
 * is untouched and still right for a URL that names no shop.
 *
 * **The slug comes from the request, because this file is handed no `params`**
 * — Next passes `not-found.tsx` no props at all. `REQUEST_PATH_HEADER` is
 * stamped and unconditionally overwritten by `src/proxy.ts` on every proxied
 * request, and `shopSlugFromPublicPath` holds what it finds to the slug
 * charset, so an unreadable path costs the link rather than producing a wrong
 * one. Async at the top level rather than `<Suspense>`-wrapped like the root
 * file: this renders *inside* the segment's own `loading.tsx` boundary, which
 * is already holding the page's shape, so there is no static shell here to
 * protect and a second fallback would only be a second thing to look at.
 */
export default async function PublicShopNotFound() {
  const slug = shopSlugFromPublicPath((await headers()).get(REQUEST_PATH_HEADER));
  const t = diverTranslator(await requestLocale());
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <h1 className={`${SHELL_TITLE_CLASS} text-balance`}>{t("notFound.shop.heading")}</h1>
      {/* No sentence under the heading. The root 404's "check the address" is
          advice for someone who typed a URL, and almost nobody arrives here
          that way; the button below is the whole of what to do next
          (principle 4, and the copy-restraint skill's first deletion). */}
      {slug ? (
        <Link href={publicSchedulePath(slug)} className={buttonClass({ className: "mt-6" })}>
          {t("notFound.shop.action")}
        </Link>
      ) : null}
    </main>
  );
}
