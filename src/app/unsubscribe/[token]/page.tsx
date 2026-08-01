import type { Metadata } from "next";
import { connection } from "next/server";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { resolveLastMinuteListUnsubscribeToken } from "@/db/last-minute-list";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { confirmUnsubscribe } from "./actions";

export const metadata: Metadata = {
  title: "Unsubscribe — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * Deliberately does not unsubscribe on the bare GET — a corporate link
 * pre-scanner fetching this URL would otherwise opt someone out before they
 * ever clicked (same reasoning as `/verify/[token]`). The button's own
 * submit is what mutates. State is always read fresh from the DB, never from
 * a query flag, so there is nothing here for a forged param to fake.
 */
// Bearer-token page (the URL is the capability, docs/engineering/
// capability-telemetry-runbook.md) — reads `params`/`requestLocale()`
// unguarded, genuinely request-scoped, not in scope for the "use cache"
// hoist. See the shop layout's `instant = false` comment
// (src/app/shop/[shopSlug]/layout.tsx) for what this does and doesn't do.
export const instant = false;

export default async function UnsubscribeLastMinuteDealPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connection();
  const { token } = await params;
  const db = await getDb();
  const t = diverTranslator(await requestLocale());

  const context = await resolveLastMinuteListUnsubscribeToken(db, token);
  if (!context) {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
        <section className="rounded-2xl border border-border bg-surface p-7 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("lastMinute.unsubscribe.unavailableTitle")}
          </h1>
          <p className="mt-3 text-muted">{t("lastMinute.unsubscribe.unavailableText")}</p>
        </section>
      </main>
    );
  }

  if (context.alreadyUnsubscribed) {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
        <section className="rounded-2xl border border-border bg-surface p-7 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("lastMinute.unsubscribe.confirmedTitle")}
          </h1>
          <p className="mt-3 text-muted">
            {t("lastMinute.unsubscribe.confirmedText", { shopName: context.shopName })}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <section className="rounded-2xl border border-border bg-surface p-7 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("lastMinute.unsubscribe.title")}
        </h1>
        <p className="mt-3 text-muted">
          {t("lastMinute.unsubscribe.description", { shopName: context.shopName })}
        </p>
        <form action={confirmUnsubscribe.bind(null, token)} className="mt-5">
          <SubmitButton
            pendingLabel={t("lastMinute.unsubscribe.submitting")}
            className={buttonClass()}
          >
            {t("lastMinute.unsubscribe.submit")}
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
