import type { Metadata } from "next";
import { connection } from "next/server";
import { EntryDone, EntryShell } from "@/components/account/EntryShell";
import { DeadLink } from "@/components/DeadLink";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { resolveUnsubscribeToken, type UnsubscribeKind } from "@/db/unsubscribe";
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
 * One route serves five token kinds, since each is the same "tap once to stop
 * these emails" shape and nobody clicking a footer link should need to know
 * which internal mechanism sent it. `resolveUnsubscribeToken` is the one place
 * that decides which kind a token is (issue #3659); this page only words it.
 */
// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

/** The one ask, every token kind: a title, the shop it's about, one button. */
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

type Translate = ReturnType<typeof diverTranslator>;

/**
 * The words for each kind. Every key is spelled out, never built from a prefix,
 * so the bundle-reach guard can see that each one is read.
 */
function wordsFor(t: Translate, kind: UnsubscribeKind, shopName: string) {
  switch (kind) {
    case "interest":
      return {
        confirmedTitle: t("lastMinute.unsubscribe.confirmedTitle"),
        confirmedText: t("lastMinute.unsubscribe.confirmedText", { shopName }),
        title: t("lastMinute.unsubscribe.title", { shopName }),
        description: t("lastMinute.unsubscribe.description", { shopName }),
        submit: t("lastMinute.unsubscribe.submit"),
        submitting: t("lastMinute.unsubscribe.submitting"),
      };
    case "courtesy":
      return {
        confirmedTitle: t("courtesyEmailUnsubscribe.confirmedTitle"),
        confirmedText: t("courtesyEmailUnsubscribe.confirmedText", { shopName }),
        title: t("courtesyEmailUnsubscribe.title", { shopName }),
        description: t("courtesyEmailUnsubscribe.description", { shopName }),
        submit: t("courtesyEmailUnsubscribe.submit"),
        submitting: t("courtesyEmailUnsubscribe.submitting"),
      };
    case "weeklyDigest":
      return {
        confirmedTitle: t("weeklyDigestUnsubscribe.confirmedTitle"),
        confirmedText: t("weeklyDigestUnsubscribe.confirmedText", { shopName }),
        title: t("weeklyDigestUnsubscribe.title", { shopName }),
        description: t("weeklyDigestUnsubscribe.description", { shopName }),
        submit: t("weeklyDigestUnsubscribe.submit"),
        submitting: t("weeklyDigestUnsubscribe.submitting"),
      };
    case "shoreAlert":
      return {
        confirmedTitle: t("shoreAlertStop.confirmedTitle"),
        confirmedText: t("shoreAlertStop.confirmedText", { shopName }),
        title: t("shoreAlertStop.title", { shopName }),
        description: t("shoreAlertStop.description", { shopName }),
        submit: t("shoreAlertStop.submit"),
        submitting: t("shoreAlertStop.submitting"),
      };
    case "bookkeeper":
      return {
        confirmedTitle: t("bookkeeperStop.confirmedTitle"),
        confirmedText: t("bookkeeperStop.confirmedText", { shopName }),
        title: t("bookkeeperStop.title", { shopName }),
        description: t("bookkeeperStop.description", { shopName }),
        submit: t("bookkeeperStop.submit"),
        submitting: t("bookkeeperStop.submitting"),
      };
  }
}

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const db = await getDb();
  const t = diverTranslator(await requestLocale());

  const resolved = await resolveUnsubscribeToken(db, token);
  if (!resolved) {
    return (
      <DeadLink t={t} next={t("lastMinute.unsubscribe.unavailableText")} diveDayDoor={false} />
    );
  }
  const words = wordsFor(t, resolved.kind, resolved.shopName);
  if (resolved.done) {
    return <EntryDone glyph="quiet" title={words.confirmedTitle} text={words.confirmedText} />;
  }
  return (
    <ConfirmUnsubscribe
      title={words.title}
      description={words.description}
      submitLabel={words.submit}
      pendingLabel={words.submitting}
      token={token}
    />
  );
}
