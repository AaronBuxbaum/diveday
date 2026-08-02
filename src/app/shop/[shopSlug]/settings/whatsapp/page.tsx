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
import { toDiverLocale } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import {
  DEFAULT_WHATSAPP_TEMPLATE_NAME,
  META_TEMPLATE_LANGUAGES,
  metaLanguageCode,
} from "@/lib/notifications/whatsapp";
import { secretKeyFromEnvironment } from "@/lib/secret-box";
import { requireStaffSession } from "@/lib/session";
import { connectWhatsAppAction, disconnectWhatsAppAction, testWhatsAppAction } from "./actions";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

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
} as const;

type NoticeCode = keyof typeof NOTICE_TONE;

function noticeFrom(value: string | undefined): NoticeCode | null {
  return value && value in NOTICE_TONE ? (value as NoticeCode) : null;
}

/**
 * Where a shop plugs in its own WhatsApp Business number (docs ADR
 * 20260802-whatsapp-cloud-api-per-shop). With one connected, the courtesy text
 * that rides along with a trip reminder or recap comes from the shop's own
 * number instead of a platform short code — which is the entire point: a diver
 * who gets a message the night before a dive should recognise who it's from.
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
  // beside — the credential here can send as the business.
  const allowed = await canPersonManageMessagingSettings(
    db,
    session.user.shopId,
    session.user.personId,
  );
  if (!allowed) {
    redirect(`/shop/${session.user.shopSlug}/settings?notice=not_authorized`);
  }

  const account = await getShopWhatsAppAccount(db, session.user.shopId);
  // Surfaced rather than discovered on first send: with no sealing key there is
  // nowhere safe to put a token, and the shop should learn that before typing one.
  const keyReady = secretKeyFromEnvironment().status === "ok";
  const suggestedLanguage = metaLanguageCode(toDiverLocale(shop.defaultLocale));

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

      {!keyReady ? (
        <p className="mb-6 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          {t("whatsapp.notice.encryptionUnavailable")}
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
              <dt className="text-muted">{t("whatsapp.status.token")}</dt>
              {/* The hint, never the token — a settings page that could show it
                  would put it in a screenshot the first time someone asked for help. */}
              <dd>{t("whatsapp.status.tokenEnding", { last4: account.accessTokenHint })}</dd>
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
        <p className="mt-3 rounded-lg border border-border bg-surface-sunken p-3 font-mono text-xs">
          {t("whatsapp.setup.templateBody")}
        </p>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h3 className="font-medium">
          {account ? t("whatsapp.connect.updateHeading") : t("whatsapp.connect.heading")}
        </h3>
        <p className="mt-1 text-sm text-muted">{t("whatsapp.connect.description")}</p>
        <FieldGrid as="form" action={connectWhatsAppAction} columns={2} className="mt-4">
          <Field
            label={t("whatsapp.connect.phoneNumberId")}
            description={t("whatsapp.connect.phoneNumberIdDescription")}
          >
            <input
              name="phoneNumberId"
              className={controlClass}
              defaultValue={account?.phoneNumberId ?? ""}
              inputMode="numeric"
              required
            />
          </Field>
          <Field
            label={t("whatsapp.connect.displayPhoneNumber")}
            hint={t("whatsapp.connect.optionalHint")}
            description={t("whatsapp.connect.displayPhoneNumberDescription")}
          >
            <input
              name="displayPhoneNumber"
              className={controlClass}
              defaultValue={account?.displayPhoneNumber ?? ""}
            />
          </Field>
          <Field
            label={t("whatsapp.connect.accessToken")}
            description={
              account
                ? t("whatsapp.connect.accessTokenReplaceDescription")
                : t("whatsapp.connect.accessTokenDescription")
            }
          >
            {/* Never pre-filled: the stored token is sealed and deliberately
                unreadable, so a re-connect always re-states it. */}
            <input name="accessToken" type="password" className={controlClass} required />
          </Field>
          <Field
            label={t("whatsapp.connect.wabaId")}
            hint={t("whatsapp.connect.optionalHint")}
            description={t("whatsapp.connect.wabaIdDescription")}
          >
            <input name="wabaId" className={controlClass} defaultValue={account?.wabaId ?? ""} />
          </Field>
          <Field
            label={t("whatsapp.connect.templateName")}
            description={t("whatsapp.connect.templateNameDescription")}
          >
            <input
              name="templateName"
              className={controlClass}
              defaultValue={account?.templateName ?? DEFAULT_WHATSAPP_TEMPLATE_NAME}
              required
            />
          </Field>
          <Field
            label={t("whatsapp.connect.templateLanguage")}
            description={t("whatsapp.connect.templateLanguageDescription")}
          >
            <select
              name="templateLanguage"
              className={controlClass}
              defaultValue={account?.templateLanguage ?? suggestedLanguage}
            >
              {META_TEMPLATE_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>
          <FieldActions className="sm:col-span-2">
            <SubmitButton pendingLabel={t("whatsapp.connect.submitting")} className={buttonClass()}>
              {account ? t("whatsapp.connect.update") : t("whatsapp.connect.submit")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
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
