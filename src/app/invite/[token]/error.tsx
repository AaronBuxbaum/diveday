"use client";

import { useTranslations } from "next-intl";
import { ErrorPage } from "@/components/ErrorPage";

/**
 * A backstop for the team-invite link — a one-tap page a new hire opens
 * straight from an email, often on day one with no other context for the
 * app. A render error here should offer one clear "Try again," not a raw
 * stack trace on a link they can't easily get back to.
 *
 * This route is reached by a staff member but renders from the *diver*
 * bundle, the same as its `page.tsx` — an invitee has no session and no shop
 * yet, so there is nothing staff-shaped to translate against (ADR
 * 20260803-error-boundary-copy-bridge).
 */
export default function InviteError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errorBoundary");
  return (
    <ErrorPage title={t("title")} body={t("bodyDone")} resetLabel={t("tryAgain")} onReset={reset} />
  );
}
