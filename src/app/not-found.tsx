import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";

/**
 * The app-wide backstop for `notFound()` — a stale email link, a typo'd URL,
 * or a cancelled/deleted record now resolves here instead of Next's unstyled
 * English default. A plain Server Component (not `error.tsx`, which must be a
 * Client Component), so it renders for the visitor's negotiated locale like
 * every other page rather than picking a fixed one.
 */
export default async function NotFound() {
  const t = diverTranslator(await requestLocale());
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-sm font-medium tracking-widest text-primary uppercase">DiveDay</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance">
        {t("notFound.heading")}
      </h1>
      <p className="mt-3 text-muted">{t("notFound.body")}</p>
      <Link href="/" className={buttonClass({ className: "mt-6" })}>
        {t("notFound.backHome")}
      </Link>
    </main>
  );
}
