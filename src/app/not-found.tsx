import { headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import {
  PublicShopBrand,
  PublicShopChrome,
  PublicShopChromePlaceholder,
  PublicShopFooterSection,
} from "@/app/s/[shopSlug]/_components/PublicShopShell";
import { EYEBROW_CLASS } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { REFUSED_SHOP_SLUG_HEADER } from "@/lib/embed-routes";
import { publicSchedulePath, shopSlugFromPublicPath } from "@/lib/public-routes";

/**
 * The app-wide backstop for `notFound()` — a stale email link, a typo'd URL,
 * or a cancelled/deleted record now resolves here instead of Next's unstyled
 * English default. A plain Server Component (not `error.tsx`, which must be a
 * Client Component), so it renders for the visitor's negotiated locale like
 * every other page rather than picking a fixed one.
 *
 * Under Cache Components, `/_not-found` must still produce a static App
 * Shell (it's a framework-synthesized route Next prerenders up front), so
 * every request-scoped read is isolated behind the `<Suspense>` below instead
 * of running in this component — the shell prerenders, and only the decision
 * about which refusal this is, and the words it is written in, stream in at
 * request time.
 *
 * **Two refusals live here, and the proxy says which.** Since the public
 * namespace started refusing dead URLs at the edge (ADR
 * 20260912-the-public-namespace-refuses-at-the-edge), a diver's dead shop link
 * no longer reaches `src/app/s/[shopSlug]/not-found.tsx` at all: the status
 * has to be decided before anything streams, so `src/proxy.ts` rewrites the
 * request to `/_not-found`, which renders under the *root* layout where the
 * shop's segment layout never runs. Issue #765's rule survives that move by
 * being enforced here instead — when `REFUSED_SHOP_SLUG_HEADER` names a shop
 * the proxy actually found, this file composes that shop's own brand, header,
 * nav and footer around a refusal that points back at its board, and DiveDay's
 * *sales* door is not offered to a diver at all.
 *
 * **The bearer-token routes deliberately have no boundary of their own.**
 * Issue #765 gave `/s/**` one because DiveDay's homepage is a *software
 * sales* page and a diver on a stale shop link deserves that shop's board
 * instead; it left the same question open for `/waivers/[token]`,
 * `/ready/[token]` and `/recap/[token]`, and #914 answered it: no. The
 * mechanism cannot transfer — a capability URL names no shop, and resolving
 * a token that has already been refused in order to brand its refusal is the
 * widening `docs/engineering/capability-telemetry-runbook.md` exists to
 * prevent. It also turns out not to be needed: every dead, expired, revoked
 * or forged token in those routes already ends in that route's own
 * expired-link card, in the reader's own language, and two of the three
 * offer a button that mails a fresh link; each has its own `error.tsx`
 * besides. Nothing carrying a token arrives here. What does arrive is URL
 * *shapes* that never matched `[token]` at all — the bare prefix, and a path
 * with an extra segment — and those name neither a shop nor a booking, which
 * leaves "back to the homepage" as the only destination anyone can honestly
 * offer them. `capability-refusals.test.ts` holds the first half of that to
 * the filesystem, so a capability route added later cannot quietly opt out.
 */
export default function NotFound() {
  return (
    <Suspense fallback={<DiveDayNotFound locale={DEFAULT_DIVER_LOCALE} isShell />}>
      <RequestScopedNotFound />
    </Suspense>
  );
}

/**
 * The header is read rather than the pathname: `REQUEST_PATH_HEADER` beside it
 * would yield a slug too, but only one the URL *claimed*. Handing a diver a
 * button to a schedule that is itself a 404 is a worse landing than DiveDay's
 * own, so the frame goes up only for a shop `src/proxy.ts` looked up and
 * found.
 */
async function RequestScopedNotFound() {
  const shopSlug = refusedShopSlug((await headers()).get(REFUSED_SHOP_SLUG_HEADER));
  const locale = await requestLocale();
  if (!shopSlug) return <DiveDayNotFound locale={locale} />;
  return <ShopFramedNotFound shopSlug={shopSlug} locale={locale} />;
}

/**
 * The stamped slug, held to the same charset every other reader of a
 * proxy-stamped slug is held to. `shopSlugFromPublicPath` is where that rule
 * is written down and it takes a pathname, so the value is put back into the
 * path it would build and read out again — the round trip *is* the check. The
 * proxy overwrites this header on every request it sees, but its matcher
 * carries a static-asset escape hatch, so a reader here still treats the value
 * as a claim: anything but a slug costs the frame rather than producing a
 * wrong one.
 */
function refusedShopSlug(value: string | null): string | null {
  return value ? shopSlugFromPublicPath(publicSchedulePath(value)) : null;
}

type Locale = Parameters<typeof diverTranslator>[0];

/**
 * DiveDay's own refusal, for a URL that names no shop — and the static shell
 * of this route, which is why `isShell` marks it. `capture()` in
 * `e2e/visual.spec.ts` waits for every `[data-suspense-placeholder]` to leave
 * the page before it shoots, so the marker is what stops a visual run
 * photographing this standing in for the shop's frame.
 */
function DiveDayNotFound({ locale, isShell }: { locale: Locale; isShell?: boolean }) {
  const t = diverTranslator(locale);
  return (
    <main
      className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-16 text-center"
      data-suspense-placeholder={isShell ? "" : undefined}
    >
      <p className={EYEBROW_CLASS}>DiveDay</p>
      <h1 className={`mt-2 ${SHELL_TITLE_CLASS} text-balance`}>{t("notFound.heading")}</h1>
      <p className="mt-3 text-muted">{t("notFound.body")}</p>
      <Link href="/" className={buttonClass({ className: "mt-6" })}>
        {t("notFound.backHome")}
      </Link>
    </main>
  );
}

/**
 * The same frame `src/app/s/[shopSlug]/layout.tsx` puts around every live page
 * in that namespace, composed here because the refusal never reaches it: the
 * three streamed chrome components in the order the layout renders them, and
 * the `#public-shop-main-content` target their skip link points at. That
 * target is the half a move like this loses silently — `PublicShopChrome`
 * brings its own `SkipLink` but the landmark it names lives in the layout's
 * JSX, and an axe scan of this page is what would find it missing
 * (`e2e/a11y.spec.ts`).
 *
 * The body is `src/app/s/[shopSlug]/not-found.tsx`'s, word for word and class
 * for class, so the two paths a diver can reach a shop's 404 by — this one,
 * and a `notFound()` the edge could not pre-empt — look the same.
 */
function ShopFramedNotFound({ shopSlug, locale }: { shopSlug: string; locale: Locale }) {
  const params = Promise.resolve({ shopSlug });
  const t = diverTranslator(locale);
  return (
    <>
      <Suspense fallback={null}>
        <PublicShopBrand params={params} />
      </Suspense>
      <Suspense
        fallback={<PublicShopChromePlaceholder label={diverTranslator(DEFAULT_DIVER_LOCALE)} />}
      >
        <PublicShopChrome params={params} />
      </Suspense>
      <div id="public-shop-main-content" tabIndex={-1} className="flex-1 outline-none">
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <h1 className={`${SHELL_TITLE_CLASS} text-balance`}>{t("notFound.shop.heading")}</h1>
          {/* No sentence under the heading, for the reason the segment file
              gives: the root 404's "check the address" is advice for someone
              who typed a URL, and almost nobody arrives here that way. */}
          <Link href={publicSchedulePath(shopSlug)} className={buttonClass({ className: "mt-6" })}>
            {t("notFound.shop.action")}
          </Link>
        </main>
      </div>
      <Suspense fallback={null}>
        <PublicShopFooterSection params={params} />
      </Suspense>
    </>
  );
}
