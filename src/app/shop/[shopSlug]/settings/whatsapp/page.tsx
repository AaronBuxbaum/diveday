import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { canPersonManageMessagingSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { getShopWhatsAppAccount } from "@/db/whatsapp-accounts";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { whatsAppSignupConfigFromEnvironment } from "@/lib/notifications/whatsapp-signup";
import { secretKeyFromEnvironment } from "@/lib/secret-box";
import { requireStaffSession } from "@/lib/session";
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

const NOTICE_TONE = {
  connected: "success",
  disconnected: "success",
  tested: "success",
  test_failed: "danger",
  invalid: "danger",
  not_authorized: "danger",
  no_account: "danger",
  encryption_key_unset: "danger",
  encryption_key_invalid: "danger",
  signup_unavailable: "danger",
  signup_failed_exchange: "danger",
  signup_failed_register: "danger",
  signup_failed_subscribe: "danger",
  signup_failed_template: "danger",
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
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect("/");

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const { notice } = await searchParams;
  const banner = noticeFrom(notice);

  // Re-checked against live roles, exactly like the payment settings this sits
  // beside — the connection it creates can send as the business.
  const allowed = await canPersonManageMessagingSettings(
    db,
    session.user.shopId,
    session.user.personId,
  );
  if (!allowed) {
    redirect(`/shop/${session.user.shopSlug}/settings?notice=whatsapp_not_authorized`);
  }

  const account = await getShopWhatsAppAccount(db, session.user.shopId);
  const signupConfig = whatsAppSignupConfigFromEnvironment();
  // Both must hold before a shop can connect: Meta's approval of DiveDay's app,
  // and somewhere safe to seal the token that comes back.
  const canConnect = signupConfig !== null && secretKeyFromEnvironment().status === "ok";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("whatsapp.eyebrow")}
        title={t("whatsapp.title")}
        description={t("whatsapp.description")}
        actions={
          <Link
            href={`/shop/${session.user.shopSlug}/settings`}
            className={buttonClass({ variant: "secondary", className: "text-foreground" })}
          >
            {t("settings.main.backToSettings")}
          </Link>
        }
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
          role="status"
        >
          {t(`whatsapp.notice.${banner}`)}
        </p>
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">
            {account
              ? t("whatsapp.status.connectedHeading")
              : t("whatsapp.status.notConnectedHeading")}
          </h3>
          {account ? (
            <Badge tone={account.verifiedAt ? "success" : "neutral"}>
              {account.verifiedAt ? t("whatsapp.status.verified") : t("whatsapp.status.untested")}
            </Badge>
          ) : null}
        </div>

        {account ? (
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
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
          <p className="mt-2 text-sm text-muted">{t("whatsapp.status.notConnectedDescription")}</p>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h3 className="font-medium">{t("whatsapp.setup.heading")}</h3>
        <p className="mt-1 text-sm text-muted">{t("whatsapp.setup.description")}</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
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
      </section>

      {account ? (
        <>
          <section className="mt-6 rounded-lg border border-border bg-surface p-6">
            <h3 className="font-medium">{t("whatsapp.test.heading")}</h3>
            <p className="mt-1 text-sm text-muted">{t("whatsapp.test.description")}</p>
            <FieldGrid as="form" action={testWhatsAppAction} className="mt-4">
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
          </section>

          <section className="mt-6 rounded-lg border border-border bg-surface p-6">
            <h3 className="font-medium">{t("whatsapp.disconnect.heading")}</h3>
            <p className="mt-1 text-sm text-muted">{t("whatsapp.disconnect.description")}</p>
            <form action={disconnectWhatsAppAction} className="mt-4">
              <SubmitButton
                pendingLabel={t("whatsapp.disconnect.submitting")}
                className={buttonClass({ variant: "danger" })}
              >
                {t("whatsapp.disconnect.submit")}
              </SubmitButton>
            </form>
          </section>
        </>
      ) : null}
    </main>
  );
}
