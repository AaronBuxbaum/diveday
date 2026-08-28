import type { Metadata } from "next";
import { connection } from "next/server";
import { EntryDone, EntryShell } from "@/components/account/EntryShell";
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
// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

/** The one ask, both token kinds: a title, the shop it's about, one button. */
function ConfirmUnsubscribe({
  title,
  description,
  submitLabel,
  pendingLabel,
  token,
}: {
  title: string;
  description: string;
  submitLabel: string;
  pendingLabel: string;
  token: string;
}) {
  // A single button needs no panel around it (docs/design/principles.md #10).
  return (
    <EntryShell wordmark panel={false} title={title} description={description}>
      <form action={confirmUnsubscribe.bind(null, token)}>
        <SubmitButton pendingLabel={pendingLabel} className={buttonClass()}>
          {submitLabel}
        </SubmitButton>
      </form>
    </EntryShell>
  );
}

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const db = await getDb();
  const t = diverTranslator(await requestLocale());

  const lastMinute = await resolveLastMinuteListUnsubscribeToken(db, token);
  if (lastMinute) {
    if (lastMinute.alreadyUnsubscribed) {
      return (
        <EntryDone
          glyph="quiet"
          title={t("lastMinute.unsubscribe.confirmedTitle")}
          text={t("lastMinute.unsubscribe.confirmedText", { shopName: lastMinute.shopName })}
        />
      );
    }
    return (
      <ConfirmUnsubscribe
        title={t("lastMinute.unsubscribe.title")}
        description={t("lastMinute.unsubscribe.description", { shopName: lastMinute.shopName })}
        submitLabel={t("lastMinute.unsubscribe.submit")}
        pendingLabel={t("lastMinute.unsubscribe.submitting")}
        token={token}
      />
    );
  }

  const courtesy = await resolveCourtesyEmailUnsubscribeToken(db, token);
  if (courtesy) {
    if (courtesy.alreadyOptedOut) {
      return (
        <EntryDone
          glyph="quiet"
          title={t("courtesyEmailUnsubscribe.confirmedTitle")}
          text={t("courtesyEmailUnsubscribe.confirmedText", { shopName: courtesy.shopName })}
        />
      );
    }
    return (
      <ConfirmUnsubscribe
        title={t("courtesyEmailUnsubscribe.title")}
        description={t("courtesyEmailUnsubscribe.description", { shopName: courtesy.shopName })}
        submitLabel={t("courtesyEmailUnsubscribe.submit")}
        pendingLabel={t("courtesyEmailUnsubscribe.submitting")}
        token={token}
      />
    );
  }

  return (
    <EntryDone
      glyph="expired"
      title={t("lastMinute.unsubscribe.unavailableTitle")}
      text={t("lastMinute.unsubscribe.unavailableText")}
    />
  );
}
