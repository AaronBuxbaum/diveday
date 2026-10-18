import type { Metadata } from "next";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { canPersonBackfillIntegrations, canPersonManageShopSettings } from "@/db/authz";
import {
  listIntegrationSummaries,
  quickBooksConfigFromEnvironment,
  shopifyConfigFromEnvironment,
  xeroConfigFromEnvironment,
} from "@/features/integrations";
import { requestLocale } from "@/i18n/request";
import { ownerOrManagerWords, sayWords } from "@/i18n/shared-sentences";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { secretKeyFromEnvironment } from "@/lib/secret-box";
import { requireShopSurface } from "@/lib/session";
import { type NoticeMessages, noticeFromParam } from "@/lib/staff-notices";
import { DataTabs } from "../_components/DataTabs";
import { settingsPaneClass } from "../_components/settings-pane";
import {
  startQuickBooksConnectionAction,
  startShopifyConnectionAction,
  startXeroConnectionAction,
  syncShopifyCatalogAction,
  updateQuickBooksSettingsAction,
  updateXeroSettingsAction,
} from "./actions";
import { EarlierCheckoutsCard } from "./EarlierCheckoutsCard";
import { ConnectedMeta, DisconnectForm, NotAvailable, statusBadge } from "./integration-parts";
import { ZapierCard } from "./ZapierCard";

export const instant = true;
export const metadata: Metadata = { title: "Integrations — DiveDay" };

function noticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    connected: { tone: "success", text: t("integrations.notice.connected") },
    saved: { tone: "success", text: t("integrations.notice.saved") },
    disconnected: { tone: "success", text: t("integrations.notice.disconnected") },
    "sync-complete": {
      tone: "success",
      text: t("integrations.notice.sync-complete", { count: 0 }),
    },
    "test-sent": { tone: "success", text: t("integrations.notice.test-sent") },
    invalid: { tone: "danger", text: t("integrations.notice.invalid") },
    "not-configured": { tone: "warning", text: t("integrations.notice.not-configured") },
    "not-authorized": { tone: "danger", text: sayWords(t, ownerOrManagerWords("integrations")) },
    failed: { tone: "danger", text: t("integrations.notice.failed") },
    "encryption-key-unset": {
      tone: "danger",
      text: t("integrations.notice.encryption-key-unset"),
    },
    "encryption-key-invalid": {
      tone: "danger",
      text: t("integrations.notice.encryption-key-invalid"),
    },
  };
}

export default async function IntegrationsSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; count?: string; backfill?: string; since?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice, count, backfill, since } = await searchParams;
  const { db, session, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "integrations-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const summaries = await listIntegrationSummaries(db, shop.id);
  const ownerBackfill = await canPersonBackfillIntegrations(db, shop.id, session.user.personId);
  const shopify = summaries.find((row) => row.provider === "shopify");
  const quickbooks = summaries.find((row) => row.provider === "quickbooks");
  const xero = summaries.find((row) => row.provider === "xero");
  const zapier = summaries.find((row) => row.provider === "zapier");
  const notices = noticeMessages(t);
  const banner = noticeFromParam(notice, notices);
  const shopifyConfigured = Boolean(
    shopifyConfigFromEnvironment() && secretKeyFromEnvironment().status === "ok",
  );
  const quickbooksConfigured = Boolean(
    quickBooksConfigFromEnvironment() && secretKeyFromEnvironment().status === "ok",
  );
  const xeroConfigured = Boolean(
    xeroConfigFromEnvironment() && secretKeyFromEnvironment().status === "ok",
  );
  const zapierConfigured = secretKeyFromEnvironment().status === "ok";
  const syncBanner =
    notice === "sync-complete" && count
      ? {
          ...notices["sync-complete"],
          text: t("integrations.notice.sync-complete", { count: Number(count) }),
        }
      : banner;

  const unavailable = [
    !shopify && !shopifyConfigured,
    !quickbooks && !quickbooksConfigured,
    !xero && !xeroConfigured,
    !zapier && !zapierConfigured,
  ].filter(Boolean).length;
  const askOnce = unavailable > 1;

  return (
    <main className={settingsPaneClass()}>
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${session.user.shopSlug}/settings`}
        title={t("settings.data.title")}
        meta={
          askOnce ? (
            <p className="text-sm text-muted">
              {t("integrations.common.notAvailableAsk", { email: SUPPORT_EMAIL })}
            </p>
          ) : undefined
        }
      />
      <DataTabs t={t} shopSlug={session.user.shopSlug} current="integrations" />
      {syncBanner ? (
        <StaffNoticeBanner tone={syncBanner.tone}>{syncBanner.text}</StaffNoticeBanner>
      ) : null}

      <div className="space-y-10">
        <SectionCard
          padding="lg"
          title={t("integrations.shopify.name")}
          description={t("integrations.shopify.description")}
          actions={statusBadge(t, shopify)}
        >
          {shopify ? (
            <div className="space-y-5">
              <ConnectedMeta t={t} row={shopify} locale={locale} timezone={shop.timezone} />
              <p className="text-sm text-muted">{t("integrations.shopify.syncDescription")}</p>
              <div className="flex flex-wrap items-center gap-3">
                <form action={syncShopifyCatalogAction}>
                  <SubmitButton
                    pendingLabel={t("integrations.shopify.syncing")}
                    className={buttonClass({ variant: "secondary" })}
                    disabled={!shopifyConfigured}
                  >
                    {t("integrations.shopify.sync")}
                  </SubmitButton>
                </form>
                <DisconnectForm provider="shopify" t={t} />
              </div>
            </div>
          ) : shopifyConfigured ? (
            <FieldGrid as="form" action={startShopifyConnectionAction}>
              <Field
                label={t("integrations.shopify.domainLabel")}
                description={t("integrations.shopify.domainDescription")}
              >
                <input
                  name="shopDomain"
                  className={controlClass}
                  placeholder={t("integrations.shopify.domainPlaceholder")}
                  required
                />
              </Field>
              <FieldActions>
                <SubmitButton
                  pendingLabel={t("integrations.common.connect")}
                  className={buttonClass()}
                >
                  {t("integrations.shopify.connect")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
          ) : (
            <NotAvailable t={t} askedAbove={askOnce} />
          )}
        </SectionCard>

        <SectionCard
          padding="lg"
          title={t("integrations.quickbooks.name")}
          description={t("integrations.quickbooks.description")}
          actions={statusBadge(t, quickbooks)}
        >
          {quickbooks ? (
            <div className="space-y-5">
              <ConnectedMeta t={t} row={quickbooks} locale={locale} timezone={shop.timezone} />
              <p className="text-sm text-muted">{t("integrations.quickbooks.setupRequired")}</p>
              <FieldGrid as="form" action={updateQuickBooksSettingsAction}>
                <Field
                  label={t("integrations.quickbooks.incomeAccountLabel")}
                  description={t("integrations.quickbooks.incomeAccountDescription")}
                >
                  <input
                    name="incomeAccountId"
                    className={controlClass}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder={t("integrations.quickbooks.incomeAccountPlaceholder")}
                    defaultValue={quickbooks.settings.incomeAccountId ?? ""}
                  />
                </Field>
                <FieldActions>
                  <SubmitButton
                    pendingLabel={t("integrations.common.saving")}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("integrations.common.save")}
                  </SubmitButton>
                </FieldActions>
              </FieldGrid>
              <div className="flex flex-wrap items-center gap-3">
                <form action={startQuickBooksConnectionAction}>
                  <SubmitButton
                    pendingLabel={t("integrations.common.reconnect")}
                    className={buttonClass({ variant: "secondary" })}
                    disabled={!quickbooksConfigured}
                  >
                    {t("integrations.common.reconnect")}
                  </SubmitButton>
                </form>
                <DisconnectForm provider="quickbooks" t={t} />
              </div>
            </div>
          ) : quickbooksConfigured ? (
            <form action={startQuickBooksConnectionAction}>
              <SubmitButton
                pendingLabel={t("integrations.common.connect")}
                className={buttonClass()}
              >
                {t("integrations.quickbooks.connect")}
              </SubmitButton>
            </form>
          ) : (
            <NotAvailable t={t} askedAbove={askOnce} />
          )}
        </SectionCard>

        <SectionCard
          padding="lg"
          title={t("integrations.xero.name")}
          description={t("integrations.xero.description")}
          actions={statusBadge(t, xero)}
        >
          {xero ? (
            <div className="space-y-5">
              <ConnectedMeta t={t} row={xero} locale={locale} timezone={shop.timezone} />
              <p className="text-sm text-muted">{t("integrations.xero.setupRequired")}</p>
              <FieldGrid as="form" action={updateXeroSettingsAction}>
                <Field
                  label={t("integrations.xero.salesAccountLabel")}
                  description={t("integrations.xero.salesAccountDescription")}
                >
                  <input
                    name="salesAccountCode"
                    className={controlClass}
                    maxLength={10}
                    placeholder={t("integrations.xero.salesAccountPlaceholder")}
                    defaultValue={xero.settings.salesAccountCode ?? ""}
                  />
                </Field>
                <Field
                  label={t("integrations.xero.bankAccountLabel")}
                  description={t("integrations.xero.bankAccountDescription")}
                >
                  <input
                    name="bankAccountCode"
                    className={controlClass}
                    maxLength={10}
                    placeholder={t("integrations.xero.bankAccountPlaceholder")}
                    defaultValue={xero.settings.bankAccountCode ?? ""}
                  />
                </Field>
                <FieldActions>
                  <SubmitButton
                    pendingLabel={t("integrations.common.saving")}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("integrations.common.save")}
                  </SubmitButton>
                </FieldActions>
              </FieldGrid>
              <div className="flex flex-wrap items-center gap-3">
                <form action={startXeroConnectionAction}>
                  <SubmitButton
                    pendingLabel={t("integrations.common.reconnect")}
                    className={buttonClass({ variant: "secondary" })}
                    disabled={!xeroConfigured}
                  >
                    {t("integrations.common.reconnect")}
                  </SubmitButton>
                </form>
                <DisconnectForm provider="xero" t={t} />
              </div>
            </div>
          ) : xeroConfigured ? (
            <form action={startXeroConnectionAction}>
              <SubmitButton
                pendingLabel={t("integrations.common.connect")}
                className={buttonClass()}
              >
                {t("integrations.xero.connect")}
              </SubmitButton>
            </form>
          ) : (
            <NotAvailable t={t} askedAbove={askOnce} />
          )}
        </SectionCard>

        <ZapierCard
          t={t}
          zapier={zapier}
          configured={zapierConfigured}
          askOnce={askOnce}
          locale={locale}
          timezone={shop.timezone}
        />

        {ownerBackfill ? (
          <EarlierCheckoutsCard
            db={db}
            shopId={shop.id}
            timezone={shop.timezone}
            locale={locale}
            t={t}
            integrations={summaries}
            backfill={backfill}
            since={since}
            notice={notice}
            count={count}
          />
        ) : null}
      </div>
    </main>
  );
}
