import type { Metadata } from "next";
import { connection } from "next/server";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { resolveCourtesyEmailUnsubscribeToken } from "@/db/courtesy-email";
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
 *
 * One route serves two independent token kinds — a last-minute-list entry's
 * opt-out and a person's courtesy-email opt-out (Leo — self-serve email
 * unsubscribe) — since both are the same "tap once to stop these emails"
 * shape and a diver clicking an email footer link shouldn't need to know
 * which internal mechanism sent it. Each token hash lives in its own table,
 * so trying both resolvers in turn is a cheap, unambiguous lookup.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const db = await getDb();
  const t = diverTranslator(await requestLocale());

  const lastMinute = await resolveLastMinuteListUnsubscribeToken(db, token);
  if (lastMinute) {
    if (lastMinute.alreadyUnsubscribed) {
      return (
        <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
          <section className="rounded-2xl border border-border bg-surface p-7 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("lastMinute.unsubscribe.confirmedTitle")}
            </h1>
            <p className="mt-3 text-muted">
              {t("lastMinute.unsubscribe.confirmedText", { shopName: lastMinute.shopName })}
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
            {t("lastMinute.unsubscribe.description", { shopName: lastMinute.shopName })}
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

  const courtesy = await resolveCourtesyEmailUnsubscribeToken(db, token);
  if (courtesy) {
    if (courtesy.alreadyOptedOut) {
      return (
        <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
          <section className="rounded-2xl border border-border bg-surface p-7 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("courtesyEmailUnsubscribe.confirmedTitle")}
            </h1>
            <p className="mt-3 text-muted">
              {t("courtesyEmailUnsubscribe.confirmedText", { shopName: courtesy.shopName })}
            </p>
          </section>
        </main>
      );
    }
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
        <section className="rounded-2xl border border-border bg-surface p-7 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("courtesyEmailUnsubscribe.title")}
          </h1>
          <p className="mt-3 text-muted">
            {t("courtesyEmailUnsubscribe.description", { shopName: courtesy.shopName })}
          </p>
          <form action={confirmUnsubscribe.bind(null, token)} className="mt-5">
            <SubmitButton
              pendingLabel={t("courtesyEmailUnsubscribe.submitting")}
              className={buttonClass()}
            >
              {t("courtesyEmailUnsubscribe.submit")}
            </SubmitButton>
          </form>
        </section>
      </main>
    );
  }

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
