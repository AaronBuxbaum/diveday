import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/app/_components/MarketingNav";
import { EntryDone, EntryShell } from "@/components/account/EntryShell";
import { MarketingFooter } from "@/components/MarketingFooter";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { requestPasswordReset } from "./actions";

export const metadata: Metadata = {
  title: "Reset your password — DiveDay",
  robots: { index: false, follow: false },
};

// `instant = true`: this route has a real static shell. Every request-scoped
// read below sits inside this segment's `loading.tsx` boundary, so the frame
// paints without waiting on the request and the data streams into it —
// and `next build` fails if that ever stops being true.
// See ADR 20260804-instant-navigation.
export const instant = true;

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  const t = diverTranslator(await requestLocale());

  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav />
      {sent ? (
        // The send is the whole outcome — the page has nothing left to ask,
        // so it reads as a terminal state rather than a form with a banner.
        <EntryDone
          glyph="📬"
          title={t("account.forgotPassword.sentTitle")}
          text={t("account.forgotPassword.sent")}
          action={
            <Link href="/sign-in" className="font-medium text-primary hover:underline">
              {t("account.common.backToSignIn")}
            </Link>
          }
        />
      ) : (
        <EntryShell
          title={t("account.forgotPassword.title")}
          description={t("account.forgotPassword.description")}
          footer={
            <p>
              <Link href="/sign-in" className="font-medium text-primary hover:underline">
                {t("account.common.backToSignIn")}
              </Link>
            </p>
          }
        >
          <form action={requestPasswordReset} className="flex flex-col gap-4">
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
            <SubmitButton
              pendingLabel={t("account.forgotPassword.sending")}
              className={buttonClass()}
            >
              {t("account.forgotPassword.submit")}
            </SubmitButton>
          </form>
        </EntryShell>
      )}
      <MarketingFooter />
    </div>
  );
}
