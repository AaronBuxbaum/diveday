import type { Metadata } from "next";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { canPersonManageMessagingSettings } from "@/db/authz";
import { getShopWhatsAppAccount } from "@/db/whatsapp-accounts";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { whatsAppSignupConfigFromEnvironment } from "@/lib/notifications/whatsapp-signup";
import { secretKeyFromEnvironment } from "@/lib/secret-box";
import { requireShopSurface } from "@/lib/session";
import {
  completeWhatsAppSignupAction,
  disconnectWhatsAppAction,
  testWhatsAppAction,
} from "./actions";
import { EmbeddedSignupButton } from "./EmbeddedSignupButton";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English (ADR 20260729-diver-copy-localization). */
export const metadata: Metadata = { title: "WhatsApp — DiveDay" };

// Every key here is also a `whatsapp.notice.<code>` key in the staff bundle —
// the banner below looks the words up by the code itself — so the two are
// renamed together or the banner renders nothing (src/lib/staff-notices.ts).
const NOTICE_TONE = {
  connected: "success",
  disconnected: "success",
  tested: "success",
  "test-failed": "danger",
  invalid: "danger",
  "not-authorized": "danger",
  "no-account": "danger",
  "encryption-key-unset": "danger",
  "encryption-key-invalid": "danger",
  "signup-unavailable": "danger",
  "signup-failed-exchange": "danger",
  "signup-failed-register": "danger",
  "signup-failed-subscribe": "danger",
  "signup-failed-template": "danger",
} as const;

type NoticeCode = keyof typeof NOTICE_TONE;

function noticeFrom(value: string | undefined): NoticeCode | null {
  return value && value in NOTICE_TONE ? (value as NoticeCode) : null;
}

/**
 * Where a shop connects its own WhatsApp Business number (docs ADR
 * 20260802-whatsapp-embedded-signup). With one connected, the courtesy text
 * riding along with a trip reminder or recap comes from the shop's own number
 * instead of a platform short code — which is the point: a diver who gets a
 * message the night before a dive should recognise who it is from.
 *
 * Connecting happens entirely inside Meta's own hosted Embedded Signup popup;
 * DiveDay never asks a shop to paste a credential. That flow requires Meta to
 * approve DiveDay's app first, so until `META_*` is configured the page states
 * plainly that it is coming rather than offering a button that cannot work.
 */
export default async function WhatsAppSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  // Re-checked against live roles, exactly like the payment settings this sits
  // beside — the connection it creates can send as the business.
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageMessagingSettings,
    refusal: { notice: "whatsapp-not-authorized" },
  });

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const { notice } = await searchParams;
  const banner = noticeFrom(notice);

  const account = await getShopWhatsAppAccount(db, session.user.shopId);
  const signupConfig = whatsAppSignupConfigFromEnvironment();
  // Both must hold before a shop can connect: Meta's approval of DiveDay's app,
  // and somewhere safe to seal the token that comes back.
  const canConnect = signupConfig !== null && secretKeyFromEnvironment().status === "ok";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("whatsapp.eyebrow")}
        eyebrowHref={`/shop/${session.user.shopSlug}/settings`}
        title={t("whatsapp.title")}
        description={t("whatsapp.description")}
      />

      {/* Top of the page, before anything else: a shop should learn this is not
          yet switchable on before reading how it works. */}
      {!canConnect ? (
        <section className="mb-6 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <h2 className="font-medium">{t("whatsapp.comingSoon.heading")}</h2>
          <p className="mt-1 text-sm">{t("whatsapp.comingSoon.body")}</p>
        </section>
      ) : null}

      {banner ? (
        <p
          className={`mb-6 rounded-lg border p-3 text-sm ${
            NOTICE_TONE[banner] === "success"
              ? "border-success/40 bg-success/10 text-foreground"
              : "border-danger/40 bg-danger/10 text-foreground"
          }`}
          // A refused connection has to interrupt rather than queue behind
          // whatever a screen reader is already reading — same tone→role rule
          // as `noticeRole` (src/lib/staff-notices.ts), which this hand-rolled
          // banner predates.
          role={NOTICE_TONE[banner] === "danger" ? "alert" : "status"}
        >
          {t(`whatsapp.notice.${banner}`)}
        </p>
      ) : null}

      {/* Section rhythm belongs to the page, not to each section: one
          `space-y-10` here, and no `mt-*` on any card
          (docs/design/forms-and-controls.md). */}
      <div className="space-y-10">
        <SectionCard
          padding="lg"
          title={
            account
              ? t("whatsapp.status.connectedHeading")
              : t("whatsapp.status.notConnectedHeading")
          }
          actions={
            account ? (
              <Badge tone={account.verifiedAt ? "success" : "neutral"}>
                {account.verifiedAt ? t("whatsapp.status.verified") : t("whatsapp.status.untested")}
              </Badge>
            ) : null
          }
        >
          {account ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted">{t("whatsapp.status.number")}</dt>
                <dd>{account.displayPhoneNumber ?? account.phoneNumberId}</dd>
              </div>
              <div>
                <dt className="text-muted">{t("whatsapp.status.template")}</dt>
                <dd>
                  {account.templateName} ({account.templateLanguage})
                </dd>
              </div>
              <div>
                <dt className="text-muted">{t("whatsapp.status.connectedAt")}</dt>
                <dd>{formatDateTimeTz(account.connectedAt, locale, shop.timezone)}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted">{t("whatsapp.status.notConnectedDescription")}</p>
          )}
        </SectionCard>

        <SectionCard
          padding="lg"
          title={t("whatsapp.setup.heading")}
          description={t("whatsapp.setup.description")}
        >
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>{t("whatsapp.setup.step1")}</li>
            <li>{t("whatsapp.setup.step2")}</li>
            <li>{t("whatsapp.setup.step3")}</li>
          </ol>

          <div className="mt-5">
            {canConnect && signupConfig ? (
              <EmbeddedSignupButton
                appId={signupConfig.appId}
                configId={signupConfig.configId}
                action={completeWhatsAppSignupAction}
                copy={{
                  connect: account ? t("whatsapp.signup.reconnect") : t("whatsapp.signup.connect"),
                  connecting: t("whatsapp.signup.connecting"),
                  cancelled: t("whatsapp.signup.cancelled"),
                  blocked: t("whatsapp.signup.blocked"),
                }}
              />
            ) : (
              <button type="button" disabled className={buttonClass()}>
                {t("whatsapp.signup.connect")}
              </button>
            )}
          </div>
        </SectionCard>

        {account ? (
          <>
            <SectionCard
              padding="lg"
              title={t("whatsapp.test.heading")}
              description={t("whatsapp.test.description")}
            >
              <FieldGrid as="form" action={testWhatsAppAction}>
                <Field
                  label={t("whatsapp.test.phone")}
                  description={t("whatsapp.test.phoneDescription")}
                >
                  <input
                    name="testPhone"
                    className={controlClass}
                    placeholder="+13055551234"
                    required
                  />
                </Field>
                <FieldActions>
                  <SubmitButton
                    pendingLabel={t("whatsapp.test.submitting")}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("whatsapp.test.submit")}
                  </SubmitButton>
                </FieldActions>
              </FieldGrid>
            </SectionCard>

            <SectionCard
              padding="lg"
              title={t("whatsapp.disconnect.heading")}
              description={t("whatsapp.disconnect.description")}
            >
              <form action={disconnectWhatsAppAction}>
                <SubmitButton
                  pendingLabel={t("whatsapp.disconnect.submitting")}
                  className={buttonClass({ variant: "danger" })}
                >
                  {t("whatsapp.disconnect.submit")}
                </SubmitButton>
              </form>
            </SectionCard>
          </>
        ) : null}
      </div>
    </main>
  );
}
