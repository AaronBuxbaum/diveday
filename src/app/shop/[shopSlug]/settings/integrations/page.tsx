import type { Metadata } from "next";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { canPersonManageShopSettings } from "@/db/authz";
import {
  listIntegrationSummaries,
  quickBooksConfigFromEnvironment,
  shopifyConfigFromEnvironment,
} from "@/features/integrations";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { secretKeyFromEnvironment } from "@/lib/secret-box";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import {
  disconnectIntegrationAction,
  saveZapierIntegrationAction,
  startQuickBooksConnectionAction,
  startShopifyConnectionAction,
  syncShopifyCatalogAction,
  testZapierIntegrationAction,
  updateQuickBooksSettingsAction,
  updateZapierEventsAction,
} from "./actions";

export const instant = true;
export const metadata: Metadata = { title: "Integrations — DiveDay" };

const EVENT_OPTIONS = [
  { value: "order.created", label: "integrations.common.orderCreated" },
  { value: "order.paid", label: "integrations.common.orderPaid" },
  { value: "order.refunded", label: "integrations.common.orderRefunded" },
] as const;

type EventLabelKey = (typeof EVENT_OPTIONS)[number]["label"];

function noticeMessages(t: StaffTranslator) {
  return {
    connected: { tone: "success" as const, text: t("integrations.notice.connected") },
    saved: { tone: "success" as const, text: t("integrations.notice.saved") },
    disconnected: { tone: "success" as const, text: t("integrations.notice.disconnected") },
    "sync-complete": {
      tone: "success" as const,
      text: t("integrations.notice.sync-complete", { count: 0 }),
    },
    "test-sent": { tone: "success" as const, text: t("integrations.notice.test-sent") },
    invalid: { tone: "danger" as const, text: t("integrations.notice.invalid") },
    "not-configured": { tone: "warning" as const, text: t("integrations.notice.not-configured") },
    "not-authorized": { tone: "danger" as const, text: t("integrations.notice.not-authorized") },
    failed: { tone: "danger" as const, text: t("integrations.notice.failed") },
    "encryption-key-unset": {
      tone: "danger" as const,
      text: t("integrations.notice.encryption-key-unset"),
    },
    "encryption-key-invalid": {
      tone: "danger" as const,
      text: t("integrations.notice.encryption-key-invalid"),
    },
  };
}

function EventCheckboxes({ t, selected }: { t: StaffTranslator; selected: readonly string[] }) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-3">
      <legend className="mb-2 text-sm font-medium">
        {t("integrations.common.selectedEvents")}
      </legend>
      {EVENT_OPTIONS.map((event) => (
        <label
          key={event.value}
          className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm"
        >
          <input
            type="checkbox"
            name="eventType"
            value={event.value}
            defaultChecked={selected.includes(event.value)}
          />
          {t(event.label as EventLabelKey)}
        </label>
      ))}
    </fieldset>
  );
}

function statusBadge(t: StaffTranslator, row: { status: string } | undefined) {
  if (!row) return <Badge tone="neutral">{t("integrations.status.notConnected")}</Badge>;
  if (row.status === "error") return <Badge tone="danger">{t("integrations.status.error")}</Badge>;
  return <Badge tone="success">{t("integrations.status.connected")}</Badge>;
}

function ConnectedMeta({
  t,
  row,
  locale,
  timezone,
}: {
  t: StaffTranslator;
  row: {
    externalAccountId: string | null;
    externalLabel: string | null;
    connectedAt: Date;
    lastSyncedAt: Date | null;
  };
  locale: string;
  timezone: string;
}) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted">{t("integrations.status.account")}</dt>
        <dd>{row.externalLabel ?? row.externalAccountId ?? "—"}</dd>
      </div>
      <div>
        <dt className="text-muted">{t("integrations.status.connectedAt")}</dt>
        <dd>{formatDateTimeTz(row.connectedAt, locale, timezone)}</dd>
      </div>
      {row.lastSyncedAt ? (
        <div>
          <dt className="text-muted">{t("integrations.status.lastSynced")}</dt>
          <dd>{formatDateTimeTz(row.lastSyncedAt, locale, timezone)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function DisconnectForm({
  provider,
  t,
}: {
  provider: "shopify" | "quickbooks" | "zapier";
  t: StaffTranslator;
}) {
  return (
    <form action={disconnectIntegrationAction}>
      <input type="hidden" name="provider" value={provider} />
      <SubmitButton
        pendingLabel={t("integrations.common.disconnecting")}
        className={buttonClass({ variant: "danger", size: "sm" })}
      >
        {t("integrations.common.disconnect")}
      </SubmitButton>
    </form>
  );
}

export default async function IntegrationsSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; count?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice, count } = await searchParams;
  const { db, session, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "integrations-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const summaries = await listIntegrationSummaries(db, shop.id);
  const shopify = summaries.find((row) => row.provider === "shopify");
  const quickbooks = summaries.find((row) => row.provider === "quickbooks");
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

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("integrations.eyebrow")}
        eyebrowHref={`/shop/${session.user.shopSlug}/settings`}
        title={t("integrations.title")}
        description={t("integrations.description")}
      />
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
                  disabled={!shopifyConfigured}
                >
                  {shopifyConfigured
                    ? t("integrations.shopify.connect")
                    : t("integrations.common.notConfigured")}
                </SubmitButton>
              </FieldActions>
              {!shopifyConfigured ? (
                <p className="text-sm text-muted">{t("integrations.common.comingSoon")}</p>
              ) : null}
            </FieldGrid>
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
          ) : (
            <form action={startQuickBooksConnectionAction}>
              <SubmitButton
                pendingLabel={t("integrations.common.connect")}
                className={buttonClass()}
                disabled={!quickbooksConfigured}
              >
                {quickbooksConfigured
                  ? t("integrations.quickbooks.connect")
                  : t("integrations.common.notConfigured")}
              </SubmitButton>
              {!quickbooksConfigured ? (
                <p className="mt-3 text-sm text-muted">{t("integrations.common.comingSoon")}</p>
              ) : null}
            </form>
          )}
        </SectionCard>

        <SectionCard
          padding="lg"
          title={t("integrations.zapier.name")}
          description={t("integrations.zapier.description")}
          actions={statusBadge(t, zapier)}
        >
          {zapier ? (
            <div className="space-y-5">
              <ConnectedMeta t={t} row={zapier} locale={locale} timezone={shop.timezone} />
              <p className="text-sm text-muted">{t("integrations.zapier.eventsDescription")}</p>
              <FieldGrid as="form" action={updateZapierEventsAction}>
                <EventCheckboxes t={t} selected={zapier.settings.eventTypes ?? []} />
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
                <form action={testZapierIntegrationAction}>
                  <SubmitButton
                    pendingLabel={t("integrations.zapier.testing")}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("integrations.zapier.test")}
                  </SubmitButton>
                </form>
                <DisconnectForm provider="zapier" t={t} />
              </div>
            </div>
          ) : (
            <FieldGrid as="form" action={saveZapierIntegrationAction}>
              <Field
                label={t("integrations.zapier.webhookLabel")}
                description={t("integrations.zapier.webhookDescription")}
              >
                <input
                  name="webhookUrl"
                  className={controlClass}
                  placeholder={t("integrations.zapier.webhookPlaceholder")}
                  required
                />
              </Field>
              <EventCheckboxes t={t} selected={EVENT_OPTIONS.map((event) => event.value)} />
              <FieldActions>
                <SubmitButton
                  pendingLabel={t("integrations.common.connect")}
                  className={buttonClass()}
                  disabled={!zapierConfigured}
                >
                  {zapierConfigured
                    ? t("integrations.zapier.connect")
                    : t("integrations.common.notConfigured")}
                </SubmitButton>
              </FieldActions>
              {!zapierConfigured ? (
                <p className="text-sm text-muted">{t("integrations.common.comingSoon")}</p>
              ) : null}
            </FieldGrid>
          )}
        </SectionCard>
      </div>
    </main>
  );
}
