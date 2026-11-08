import type { Metadata } from "next";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import {
  billingConfigFromEnvironment,
  percentBillingFromEnvironment,
  planCopyParams,
  planMoney,
} from "@/features/billing";
import {
  canPersonManageBilling,
  getBillingPage,
  getBillingPercentMonth,
  holdsLiveSubscription,
  shopPricing,
  subscriptionSnapshot,
} from "@/features/billing-page";
import { pricingConfig } from "@/features/pricing-flags";
import { requireShopSurface } from "@/features/session";
import { trialDaysRemaining, trialEndsAt } from "@/features/trial";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { percentFeeCents } from "@/lib/billing/pricing-plans";
import { type BillingStatus, billingStanding, freeTimeEndsAt } from "@/lib/billing/standing";
import { formatCalendarDate, formatCalendarMonth } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatDateWithYear, formatMoneyCents } from "@/lib/format";
import { noticeFromParam } from "@/lib/staff-notices";
import { shopMonthBounds, utcToWallTime } from "@/lib/zoned";
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
  const { subscription: row } = await getBillingPage(db, shop.id);
  const now = nowDate();
  // Resolve the configured offer, preserving this shop’s subscription terms.
  // Percentage billing also requires its metered price and meter.
  const terms = shopPricing(row, pricingConfig());
  const percentPlan = terms.plan === "percent_of_volume";
  const billingOn = billingConfigFromEnvironment() !== null;
  const configured = billingOn && (!percentPlan || percentBillingFromEnvironment() !== null);
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
      : billingOn
        ? t("billing.plan.percentNotConfigured")
        : t("billing.notConfigured");

  // The percent plan's running month and its last closed one, in the shop's zone.
  const money = (cents: number) => formatMoneyCents(cents, "usd", locale);
  let percentFacts: {
    volumeCents: number;
    feeCents: number;
    last: { month: string; volumeCents: number; feeCents: number } | null;
  } | null = null;
  if (percentPlan && !shop.isDemo) {
    const wall = utcToWallTime(now, shop.timezone);
    const month = { year: wall.year, month: wall.month };
    const { volumeCents, statement } = await getBillingPercentMonth(
      db,
      shop.id,
      month,
      shop.timezone,
      freeTimeEndsAt({
        now: shopMonthBounds(month, shop.timezone).from,
        timeZone: shop.timezone,
        trialEndsAt: trialEndsAt(shop.createdAt),
        freeTermEndsOn: row?.freeTermEndsOn ?? null,
      }),
    );
    percentFacts = {
      volumeCents,
      feeCents: percentFeeCents(volumeCents, terms.basisPoints),
      last: statement
        ? {
            month: formatCalendarMonth(statement.month, locale),
            volumeCents: statement.volumeCents,
            feeCents: statement.feeCents,
          }
        : null,
    };
  }
  const canAct = configured && !shop.isDemo;
  const canCancel = standing.hasSubscription && standing.nextChargeAt !== null;
  // Which button, decided on the row as the actions decide it: a subscription
  // that has not ended — even one whose status Stripe has not sent yet — is
  // managed in the Portal, never added to.
  const live = holdsLiveSubscription(row);
  // Back from Checkout before its webhook, or linked with no status yet: say
  // Stripe is still confirming instead of offering the card button again.
  const awaitingStripe =
    canAct &&
    ((notice === "card-added" && !standing.hasSubscription) ||
      (row?.stripeSubscriptionId != null && row.stripeStatus === null));

  return (
    <main className={settingsPaneClass()}>
      <FlashParams params={["notice"]} />
      <ShopPageHeader eyebrow={t("settings.main.eyebrow")} title={t("billing.title")} />
      {banner ? <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner> : null}

      <SectionCard
        padding="lg"
        title={t("billing.plan.heading")}
        description={description}
        actions={
          shop.isDemo ? null : <Badge tone={STATUS_TONE[standing.status]}>{statusText}</Badge>
        }
      >
        <p className="text-sm">
          {percentPlan
            ? t("billing.plan.percentPrice", planCopyParams(terms, locale))
            : t("billing.plan.price", { price: planMoney(terms.monthlyCents, locale) })}
        </p>
        {percentFacts ? (
          <div className="mt-4 space-y-3 text-sm">
            {[
              { heading: t("billing.plan.thisMonth"), ...percentFacts },
              ...(percentFacts.last
                ? [
                    {
                      heading: t("billing.plan.lastMonth", { month: percentFacts.last.month }),
                      ...percentFacts.last,
                    },
                  ]
                : []),
            ].map((fact) => (
              <div key={fact.heading}>
                <p className="font-medium">{fact.heading}</p>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
                  <dt className="text-muted">{t("billing.plan.volume")}</dt>
                  <dd>{money(fact.volumeCents)}</dd>
                  <dt className="text-muted">{t("billing.plan.fee")}</dt>
                  <dd>{money(fact.feeCents)}</dd>
                </dl>
              </div>
            ))}
          </div>
        ) : null}
        {dateFact && !shop.isDemo ? (
          <dl className="mt-3 text-sm">
            <dt className="text-muted">{dateFact.label}</dt>
            <dd>{dateFact.value}</dd>
          </dl>
        ) : null}

        {standing.status === "past_due" ? (
          <p className="mt-4 text-sm text-danger">{t("billing.pastDue")}</p>
        ) : null}

        {awaitingStripe ? <p className="mt-6 text-sm text-muted">{t("billing.waiting")}</p> : null}

        {canAct && !awaitingStripe && !live ? (
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

        {canAct && !awaitingStripe && live ? (
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
