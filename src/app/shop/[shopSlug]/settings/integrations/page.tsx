import type { Metadata } from "next";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import {
  getIntegrationSettingsPage,
  INTEGRATION_SETTINGS_GATE,
  quickBooksConfigFromEnvironment,
  shopifyConfigFromEnvironment,
  squareConfigFromEnvironment,
  squareLocationsForShop,
} from "@/features/integrations";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { ownerOrManagerWords, sayWords } from "@/i18n/shared-sentences";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { secretKeyFromEnvironment } from "@/lib/secret-box";
import { type NoticeMessages, noticeFromParam } from "@/lib/staff-notices";
import { DataTabs } from "../_components/DataTabs";
import { settingsPaneClass } from "../_components/settings-pane";
import {
  startQuickBooksConnectionAction,
  startShopifyConnectionAction,
  syncShopifyCatalogAction,
  updateQuickBooksSettingsAction,
} from "./actions";
import { EarlierCheckoutsCard } from "./EarlierCheckoutsCard";
import { ConnectedMeta, DisconnectForm, describedWithStatus } from "./integration-parts";
import { SquareCard } from "./SquareCard";
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
  const { db, session, shop } = await requireShopSurface(shopSlug, INTEGRATION_SETTINGS_GATE);
  const { summaries, ownerBackfill } = await getIntegrationSettingsPage(
    db,
    shop.id,
    session.user.personId,
  );
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const shopify = summaries.find((row) => row.provider === "shopify");
  const quickbooks = summaries.find((row) => row.provider === "quickbooks");
  const square = summaries.find((row) => row.provider === "square");
  const squareConfigured = Boolean(
    squareConfigFromEnvironment() && secretKeyFromEnvironment().status === "ok" && !shop.isDemo,
  );
  const squareLocations =
    square && squareConfigured
      ? await squareLocationsForShop(db, shop.id, session.user.personId)
      : null;
  const zapier = summaries.find((row) => row.provider === "zapier");
  const notices = noticeMessages(t);
  const banner = noticeFromParam(notice, notices);
  const shopifyConfigured = Boolean(
    shopifyConfigFromEnvironment() && secretKeyFromEnvironment().status === "ok",
  );
  const quickbooksConfigured = Boolean(
    quickBooksConfigFromEnvironment() && secretKeyFromEnvironment().status === "ok",
  );
  const zapierConfigured = secretKeyFromEnvironment().status === "ok";
  const syncBanner =
    notice === "sync-complete" && count
      ? {
          ...notices["sync-complete"],
          text: t("integrations.notice.sync-complete", { count: Number(count) }),
        }
      : banner;

  // A card only for what this build can connect, or what is already
  // connected (visual review 2026-10-24, A20); the rest is one line at the foot.
  const showShopify = Boolean(shopify) || shopifyConfigured;
  const showQuickbooks = Boolean(quickbooks) || quickbooksConfigured;
  const showZapier = Boolean(zapier) || zapierConfigured;
  const comingLater = !showShopify || !showQuickbooks || !showZapier;

  return (
    <main className={settingsPaneClass()}>
      <ShopPageHeader eyebrow={t("settings.main.eyebrow")} title={t("settings.data.title")} />
      <DataTabs t={t} shopSlug={session.user.shopSlug} current="integrations" />
      {syncBanner ? (
        <StaffNoticeBanner tone={syncBanner.tone}>{syncBanner.text}</StaffNoticeBanner>
      ) : null}

      <div className="space-y-10">
        <SquareCard row={square} locations={squareLocations} t={t} configured={squareConfigured} />
        {showShopify ? (
          <SectionCard
            padding="lg"
            title={t("integrations.shopify.name")}
            description={describedWithStatus(t, t("integrations.shopify.description"), shopify)}
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
            ) : (
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
            )}
          </SectionCard>
        ) : null}

        {showQuickbooks ? (
          <SectionCard
            padding="lg"
            title={t("integrations.quickbooks.name")}
            description={describedWithStatus(
              t,
              t("integrations.quickbooks.description"),
              quickbooks,
            )}
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
                      pendingLabel={t("words.busy.saving")}
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
            ) : (
              <form action={startQuickBooksConnectionAction}>
                <SubmitButton
                  pendingLabel={t("integrations.common.connect")}
                  className={buttonClass()}
                >
                  {t("integrations.quickbooks.connect")}
                </SubmitButton>
              </form>
            )}
          </SectionCard>
        ) : null}

        {showZapier ? (
          <ZapierCard t={t} zapier={zapier} locale={locale} timezone={shop.timezone} />
        ) : null}

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

        {comingLater ? (
          <p className="text-sm text-muted">
            {t("integrations.common.notAvailableAsk", { email: SUPPORT_EMAIL })}
          </p>
        ) : null}
      </div>
    </main>
  );
}
