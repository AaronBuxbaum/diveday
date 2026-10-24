import type { Metadata } from "next";
import { connection } from "next/server";
import { EntryDone, EntryShell } from "@/components/account/EntryShell";
import { DeadLink } from "@/components/DeadLink";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import {
  checkBookkeeperConfirmation,
  isBookkeeperToken,
  wasBookkeeperConfirmed,
} from "@/db/bookkeeper";
import { getDb } from "@/db/client";
import {
  checkShopContactEmailConfirmation,
  wasShopContactEmailConfirmed,
} from "@/db/shop-contact-email";
import {
  checkShoreAlertConfirmation,
  isShoreAlertToken,
  wasShoreAlertConfirmed,
} from "@/db/shore-alert-tokens";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { nowDate } from "@/lib/clock";
import { confirmContactEmail } from "./actions";

export const metadata: Metadata = {
  title: "Confirm this address — DiveDay",
  robots: { index: false, follow: false },
};

/**
 * Where the shop's front desk lands from the confirmation email (issue #1288).
 * Deliberately does not confirm on the bare GET: a corporate link pre-scanner
 * fetching this URL would otherwise burn the one-time token before anyone
 * clicked (same reasoning as `/verify/[token]`). The button's own submit is
 * what consumes it, and the success state is read back from the token row --
 * never from a query flag a caller could forge.
 *
 * The same page confirms a shore contact's address (H-118): the link a shop's
 * saved shore address receives before any roll-call alert goes to it. Its
 * token lives in its own table, so the page tries the front desk's resolvers
 * and then the shore contact's, as `/unsubscribe/[token]` does for its kinds.
 * The bookkeeper's link (item 35, security review B1) is the third: the
 * month-end files go nowhere until the inbox they go to says yes here.
 */
// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

export default async function ConfirmContactPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await connection();
  const { token } = await params;
  const db = await getDb();
  const t = diverTranslator(await requestLocale());

  const confirmed = await wasShopContactEmailConfirmed(db, { token });
  if (confirmed) {
    return (
      <EntryDone
        glyph="done"
        title={t("contactConfirm.confirmedTitle")}
        text={t("contactConfirm.confirmedText", { shopName: confirmed.shopName })}
      />
    );
  }

  const check = await checkShopContactEmailConfirmation(db, { token });
  if (!check) return <ShoreConfirmation token={token} t={t} />;

  // One question, one button — a panel around a single control is chrome
  // (docs/design/principles.md #10), so the shell renders none.
  return (
    <EntryShell
      wordmark
      panel={false}
      title={t("contactConfirm.title", { shopName: check.shopName })}
      description={t("contactConfirm.description", {
        shopName: check.shopName,
        email: check.email,
      })}
    >
      <form action={confirmContactEmail.bind(null, token)}>
        <SubmitButton pendingLabel={t("contactConfirm.confirming")} className={buttonClass()}>
          {t("contactConfirm.submit")}
        </SubmitButton>
      </form>
    </EntryShell>
  );
}

/** The shore contact's link (H-118): the same three states, in its own words. */
async function ShoreConfirmation({
  token,
  t,
}: {
  token: string;
  t: ReturnType<typeof diverTranslator>;
}) {
  const db = await getDb();
  const confirmed = await wasShoreAlertConfirmed(db, { token });
  if (confirmed) {
    return (
      <EntryDone
        glyph="done"
        title={t("shoreConfirm.confirmedTitle", { shopName: confirmed.shopName })}
        text={t("shoreConfirm.confirmedText", { shopName: confirmed.shopName })}
      />
    );
  }
  const check = await checkShoreAlertConfirmation(db, { token });
  if (!check) {
    const shore = await isShoreAlertToken(db, { token });
    if (!shore) return <BookkeeperConfirmation token={token} t={t} />;
    return <DeadLink t={t} next={t("shoreConfirm.unavailableText")} diveDayDoor={false} />;
  }
  return (
    <EntryShell
      wordmark
      panel={false}
      title={t("shoreConfirm.title", { shopName: check.shopName })}
      description={t("shoreConfirm.description", {
        shopName: check.shopName,
        email: check.email,
      })}
    >
      <form action={confirmContactEmail.bind(null, token)}>
        <SubmitButton pendingLabel={t("shoreConfirm.confirming")} className={buttonClass()}>
          {t("shoreConfirm.submit")}
        </SubmitButton>
      </form>
    </EntryShell>
  );
}

/** The bookkeeper's link (item 35, security review B1): the same three states. */
async function BookkeeperConfirmation({
  token,
  t,
}: {
  token: string;
  t: ReturnType<typeof diverTranslator>;
}) {
  const db = await getDb();
  const confirmed = await wasBookkeeperConfirmed(db, { token });
  if (confirmed) {
    return (
      <EntryDone
        glyph="done"
        title={t("bookkeeperConfirm.confirmedTitle")}
        text={t("bookkeeperConfirm.confirmedText", { shopName: confirmed.shopName })}
      />
    );
  }
  const check = await checkBookkeeperConfirmation(db, { token, now: nowDate() });
  if (!check) {
    const bookkeeper = await isBookkeeperToken(db, { token });
    return (
      <DeadLink
        t={t}
        next={t(
          bookkeeper ? "bookkeeperConfirm.unavailableText" : "contactConfirm.unavailableText",
        )}
        diveDayDoor={false}
      />
    );
  }
  return (
    <EntryShell
      wordmark
      panel={false}
      title={t("bookkeeperConfirm.title", { shopName: check.shopName })}
      description={t("bookkeeperConfirm.description", {
        shopName: check.shopName,
        email: check.email,
      })}
    >
      <form action={confirmContactEmail.bind(null, token)}>
        <SubmitButton pendingLabel={t("bookkeeperConfirm.confirming")} className={buttonClass()}>
          {t("bookkeeperConfirm.submit")}
        </SubmitButton>
      </form>
    </EntryShell>
  );
}
