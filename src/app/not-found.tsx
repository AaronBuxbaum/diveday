import Link from "next/link";
import { Suspense } from "react";
import { EYEBROW_CLASS } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";

/**
 * The app-wide backstop for `notFound()` — a stale email link, a typo'd URL,
 * or a cancelled/deleted record now resolves here instead of Next's unstyled
 * English default. A plain Server Component (not `error.tsx`, which must be a
 * Client Component), so it renders for the visitor's negotiated locale like
 * every other page rather than picking a fixed one.
 *
 * Under Cache Components, `/_not-found` must still produce a static App
 * Shell (it's a framework-synthesized route Next prerenders up front), so
 * the `requestLocale()` read (backed by `headers()`) is isolated to a small
 * `<Suspense>`-wrapped child instead of the top-level component — the shell
 * (layout, copy structure) prerenders, and only the localized text streams
 * in at request time.
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
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p className={EYEBROW_CLASS}>DiveDay</p>
      <Suspense fallback={<NotFoundCopy locale={DEFAULT_DIVER_LOCALE} />}>
        <LocalizedNotFoundCopy />
      </Suspense>
    </main>
  );
}

async function LocalizedNotFoundCopy() {
  const locale = await requestLocale();
  return <NotFoundCopy locale={locale} />;
}

function NotFoundCopy({ locale }: { locale: Parameters<typeof diverTranslator>[0] }) {
  const t = diverTranslator(locale);
  return (
    <>
      <h1 className={`mt-2 ${SHELL_TITLE_CLASS} text-balance`}>{t("notFound.heading")}</h1>
      <p className="mt-3 text-muted">{t("notFound.body")}</p>
      <Link href="/" className={buttonClass({ className: "mt-6" })}>
        {t("notFound.backHome")}
      </Link>
    </>
  );
}
