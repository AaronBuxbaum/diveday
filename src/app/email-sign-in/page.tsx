import type { Metadata } from "next";
import Link from "next/link";
import { EntryDone, EntryShell } from "@/components/account/EntryShell";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { requestMagicSignIn } from "./actions";

export const metadata: Metadata = {
  title: "Get a magic link — DiveDay",
  robots: { index: false, follow: false },
};

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

export default async function EmailSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;
  const t = diverTranslator(await requestLocale());

  return (
    <div className="flex flex-1 flex-col">
      {sent ? (
        // The send is the whole outcome — the page has nothing left to ask,
        // so it reads as a terminal state rather than a form with a banner.
        <EntryDone
          wordmark
          homeLink
          glyph="sent"
          title={t("account.magicSignIn.sentTitle")}
          text={t("account.magicSignIn.sent")}
          action={
            <Link href="/sign-in" className="font-medium text-primary hover:underline">
              {t("account.common.backToSignIn")}
            </Link>
          }
        />
      ) : (
        <EntryShell
          wordmark
          homeLink
          title={t("account.magicSignIn.title")}
          description={t("account.magicSignIn.description")}
          footer={
            <p>
              <Link href="/sign-in" className="font-medium text-primary hover:underline">
                {t("account.common.backToSignIn")}
              </Link>
            </p>
          }
        >
          <form action={requestMagicSignIn} className="flex flex-col gap-4">
            {error && <FormStatus tone="danger">{t("account.magicSignIn.error")}</FormStatus>}
            <FieldGrid columns={1} className="gap-y-4">
              <Field label={t("account.common.email")}>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className={controlClass}
                />
              </Field>
            </FieldGrid>
            <SubmitButton pendingLabel={t("words.busy.sending")} className={buttonClass()}>
              {t("account.magicSignIn.submit")}
            </SubmitButton>
          </form>
        </EntryShell>
      )}
    </div>
  );
}
