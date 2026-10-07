import type { Metadata } from "next";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { canPersonManageBilling } from "@/db/authz";
import { getShopSubscription, subscriptionSnapshot } from "@/db/shop-subscriptions";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { type BillingStatus, billingStanding } from "@/lib/billing/standing";
import { billingConfigFromEnvironment } from "@/lib/billing/stripe-billing";
import { formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear } from "@/lib/format";
import { earlyAccessPrice } from "@/lib/marketing";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { trialDaysRemaining, trialEndsAt } from "@/lib/trial";
import { settingsPaneClass } from "../_components/settings-pane";
import { billingNoticeMessages } from "../sub-page-notices";
import { openBillingPortalAction, startBillingCheckoutAction } from "./actions";

// See the sibling settings sub-pages (ADR 20260804-instant-navigation).
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English. */
export const metadata: Metadata = { title: "Billing — DiveDay" };

const STATUS_TONE: Record<BillingStatus, BadgeTone> = {
  trialing: "primary",
  free_term: "primary",
  active: "success",
  past_due: "danger",
  canceled: "neutral",
  trial_ended: "warning",
};

const STATUS_KEY: Record<Exclude<BillingStatus, "trialing" | "free_term">, StaffMessageKey> = {
  active: "billing.status.active",
  past_due: "billing.status.pastDue",
  canceled: "billing.status.canceled",
  trial_ended: "billing.status.trialEnded",
};

/**
 * **What this shop pays DiveDay, and the one button that changes it** (ADR
 * 20261007-subscription-billing). One card: the plan, where the shop stands,
 * the next date money moves, and a door to Stripe.
 *
 * Owner only. Everything on it is read from `shop_subscriptions`, which only
 * the billing webhook writes; the button opens Checkout or the Customer
 * Portal, and Stripe does the rest, including emailing every invoice.
 *
 * Until the three `BILLING_STRIPE_*` values are set the card states that billing
 * is not on and offers no button; the plan and the trial still read true,
 * because they are DiveDay's own facts. Nothing anywhere locks or degrades on
 * what this page shows (no paywall; `isInGoodStanding` is the seam a future
 * gate would read).
 */
export default async function BillingSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const { db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageBilling,
    refusal: { notice: "billing-not-authorized" },
  });

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const banner = noticeFromParam(notice, billingNoticeMessages(t));
  const configured = billingConfigFromEnvironment() !== null;

  const row = await getShopSubscription(db, shop.id);
  const now = nowDate();
  const standing = billingStanding({
    now,
    timeZone: shop.timezone,
    trialEndsAt: trialEndsAt(shop.createdAt),
    freeTermEndsOn: row?.freeTermEndsOn ?? null,
    subscription: subscriptionSnapshot(row),
  });
  const date = (value: Date) => formatDateWithYear(value, locale, shop.timezone);

  const statusText =
    standing.status === "trialing"
      ? t("billing.status.trialing", { count: trialDaysRemaining(shop.createdAt, now) })
      : standing.status === "free_term"
        ? t("billing.status.freeTerm", {
            date: row?.freeTermEndsOn ? formatCalendarDate(row.freeTermEndsOn, locale) : "",
          })
        : t(STATUS_KEY[standing.status]);

  // The one date money next moves, or stops: a scheduled charge, an end the
  // owner chose, or — with no card yet — the day the free time runs out.
  const dateFact = standing.nextChargeAt
    ? { label: t("billing.plan.nextCharge"), value: date(standing.nextChargeAt) }
    : standing.endsAt
      ? { label: t("billing.plan.endsOn"), value: date(standing.endsAt) }
      : null;

  const description = shop.isDemo
    ? t("billing.demo")
    : configured
      ? undefined
      : t("billing.notConfigured");
  const canAct = configured && !shop.isDemo;
  const canCancel = standing.hasSubscription && standing.nextChargeAt !== null;

  return (
    <main className={settingsPaneClass()}>
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("billing.title")}
      />
      {banner ? <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner> : null}

      <SectionCard
        padding="lg"
        title={t("billing.plan.heading")}
        description={description}
        actions={
          shop.isDemo ? null : <Badge tone={STATUS_TONE[standing.status]}>{statusText}</Badge>
        }
      >
        <p className="text-sm">{t("billing.plan.price", { price: earlyAccessPrice.price })}</p>
        {dateFact && !shop.isDemo ? (
          <dl className="mt-3 text-sm">
            <dt className="text-muted">{dateFact.label}</dt>
            <dd>{dateFact.value}</dd>
          </dl>
        ) : null}

        {standing.status === "past_due" ? (
          <p className="mt-4 text-sm text-danger">{t("billing.pastDue")}</p>
        ) : null}

        {canAct && !standing.hasSubscription ? (
          <form action={startBillingCheckoutAction} className="mt-6 space-y-2">
            {standing.freeUntil ? (
              <p className="text-sm text-muted">
                {t("billing.addCard.firstCharge", { date: date(standing.freeUntil) })}
              </p>
            ) : null}
            <SubmitButton pendingLabel={t("billing.addCard.pending")} className={buttonClass()}>
              {t("billing.addCard.submit")}
            </SubmitButton>
          </form>
        ) : null}

        {canAct && standing.hasSubscription ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-muted">{t("billing.invoices")}</p>
            <div className="flex flex-wrap gap-3">
              <form action={openBillingPortalAction}>
                <input type="hidden" name="intent" value="manage" />
                <SubmitButton
                  pendingLabel={t("billing.manage.pending")}
                  className={buttonClass({ variant: "secondary" })}
                >
                  {t("billing.manage.submit")}
                </SubmitButton>
              </form>
              {canCancel ? (
                <form action={openBillingPortalAction}>
                  <input type="hidden" name="intent" value="cancel" />
                  <SubmitButton
                    pendingLabel={t("billing.cancel.pending")}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("billing.cancel.submit")}
                  </SubmitButton>
                </form>
              ) : null}
            </div>
          </div>
        ) : null}
      </SectionCard>
    </main>
  );
}
