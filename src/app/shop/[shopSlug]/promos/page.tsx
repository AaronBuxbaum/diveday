import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Copyable } from "@/components/Copyable";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { canPersonManagePaymentSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { listShopPromoCodes } from "@/db/shop-promos";
import { getShopById } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { listOutstandingLastMinutePromos } from "@/db/trip-promos";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz } from "@/lib/format";
import { isPromoRedeemable, PROMO_DISCOUNT_MAX, PROMO_DISCOUNT_MIN } from "@/lib/promo-codes";
import { requireStaffSession } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import {
  createPromoAction,
  deletePromoAction,
  retryPromoAction,
  setPromoEnabledAction,
} from "./actions";

export const metadata: Metadata = {
  title: "Promo codes — DiveDay",
};

// A notice query param maps to a message key, never to a sentence — the words
// come from the staff bundle at render time (docs ADR 20260730-staff-copy-localization).
const NOTICES: Record<string, { tone: "success" | "danger" | "warning"; key: StaffMessageKey }> = {
  created: { tone: "success", key: "promos.notice.created" },
  enabled: { tone: "success", key: "promos.notice.enabled" },
  disabled: { tone: "success", key: "promos.notice.disabled" },
  deleted: { tone: "success", key: "promos.notice.deleted" },
  invalid: { tone: "danger", key: "promos.notice.invalid" },
  invalid_code: { tone: "danger", key: "promos.notice.invalidCode" },
  invalid_discount: { tone: "danger", key: "promos.notice.invalidDiscount" },
  invalid_window: { tone: "danger", key: "promos.notice.invalidWindow" },
  duplicate: { tone: "danger", key: "promos.notice.duplicate" },
  not_connected: { tone: "warning", key: "promos.notice.notConnected" },
  stripe_failed: { tone: "danger", key: "promos.notice.stripeFailed" },
  not_authorized: { tone: "danger", key: "promos.notice.notAuthorized" },
};

const SCOPE_KEYS: Record<"all" | "trips" | "courses", StaffMessageKey> = {
  all: "promos.scope.all",
  trips: "promos.scope.trips",
  courses: "promos.scope.courses",
};

export default async function PromosPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const allowed = await canPersonManagePaymentSettings(
    db,
    session.user.shopId,
    session.user.personId,
  );
  // Still lands on Settings (Promos itself is owner/manager-only content, so
  // redirecting back to Promos with its own notice would just refuse again)
  // but with its own notice code, so Settings renders the promo-specific
  // explanation (`promos.notice.notAuthorized`) rather than reusing its own
  // `not_authorized` code, which is the *rentals* section's message (task 82,
  // UX persona 11 "Kai") — a diver-facing "why was I bounced here" answer,
  // not a message about a different surface they never asked for.
  if (!allowed) redirect(`/shop/${shopSlug}/settings?notice=promos_not_authorized`);

  const [shop, promos, stripeAccount, tripDeals] = await Promise.all([
    getShopById(db, session.user.shopId),
    listShopPromoCodes(db, session.user.shopId),
    getShopStripeAccount(db, session.user.shopId),
    listOutstandingLastMinutePromos(db, session.user.shopId),
  ]);
  const connected = canAcceptPayments(stripeAccount);
  const banner = noticeFromParam(notice, NOTICES);
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  const timezone = shop?.timezone ?? "UTC";
  const now = nowDate();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("promos.eyebrow")}
        title={t("promos.title")}
        description={t("promos.description")}
      />

      {banner ? (
        <StaffNoticeBanner tone={banner.tone}>
          {banner.key === "promos.notice.invalidDiscount"
            ? t(banner.key, { min: PROMO_DISCOUNT_MIN, max: PROMO_DISCOUNT_MAX })
            : t(banner.key)}
        </StaffNoticeBanner>
      ) : null}

      {connected ? null : (
        <div className="mb-6">
          <ShopNotice tone="warning" role="status">
            {t.rich("promos.connectBanner", {
              settingsLink: (chunks) => (
                <Link href={`/shop/${shopSlug}/settings`} className="font-semibold underline">
                  {chunks}
                </Link>
              ),
            })}
          </ShopNotice>
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="font-medium">{t("promos.newCode.heading")}</h2>
        <p className="mt-1 text-sm text-muted">{t("promos.newCode.detail")}</p>
        <FieldGrid as="form" action={createPromoAction} columns={2} className="mt-4">
          <Field label={t("promos.fields.code")} hint={t("promos.fields.codeHint")}>
            <input
              name="code"
              required
              maxLength={40}
              placeholder={t("promos.fields.codePlaceholder")}
              autoComplete="off"
              className={`${controlClass} uppercase`}
            />
          </Field>
          <Field label={t("promos.fields.discount")} hint={t("promos.fields.discountHint")}>
            <input
              name="discountPercent"
              type="number"
              required
              min={PROMO_DISCOUNT_MIN}
              max={PROMO_DISCOUNT_MAX}
              defaultValue={10}
              className={controlClass}
            />
          </Field>
          <Field label={t("promos.fields.goodFor")}>
            <select name="scope" defaultValue="all" className={controlClass}>
              {Object.entries(SCOPE_KEYS).map(([value, key]) => (
                <option key={value} value={value}>
                  {t(key)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t("promos.fields.redemptionCap")}
            hint={t("promos.fields.redemptionCapHint")}
          >
            <input
              name="maxRedemptions"
              type="number"
              min={1}
              placeholder={t("promos.fields.redemptionCapPlaceholder")}
              className={controlClass}
            />
          </Field>
          <Field label={t("promos.fields.starts")} hint={t("promos.fields.startsHint")}>
            <input name="startsAt" type="datetime-local" className={controlClass} />
          </Field>
          <Field label={t("promos.fields.expires")} hint={t("promos.fields.expiresHint")}>
            <input name="expiresAt" type="datetime-local" className={controlClass} />
          </Field>
          <p className="-mt-2 text-xs text-muted sm:col-span-2">
            {t("promos.fields.timezoneHint", { timezone })}
          </p>
          <Field label={t("promos.fields.whatFor")} hint={t("promos.fields.whatForHint")}>
            <input
              name="description"
              maxLength={200}
              placeholder={t("promos.fields.whatForPlaceholder")}
              className={controlClass}
            />
          </Field>
          <FieldActions>
            <SubmitButton pendingLabel={t("promos.creating")} className={buttonClass()}>
              {t("promos.createCode")}
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </section>

      <h2 className="mt-8 font-medium">{t("promos.yourCodes")}</h2>
      {promos.length === 0 ? (
        <EmptyState>
          <h3 className="font-medium">{t("promos.empty.heading")}</h3>
          <p className="mt-1 text-sm text-muted">{t("promos.empty.detail")}</p>
        </EmptyState>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {promos.map((promo) => {
            // "Live" is the same predicate the booking form applies, so this
            // badge can never say a code works when checkout would refuse it.
            const live = isPromoRedeemable(
              promo,
              promo.scope === "courses" ? "course" : "trip",
              now,
            );
            const switchable = promo.status === "active" || promo.status === "disabled";
            return (
              <li
                key={promo.id}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 sm:flex-row sm:items-start"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-base font-semibold">{promo.code}</span>
                    <Copyable
                      layout="inline"
                      value={promo.code}
                      copyLabel={t("promos.copyCode")}
                      copiedLabel={t("promos.copyCodeCopied")}
                      failedLabel={t("promos.copyCodeFailed")}
                    />
                    <span className="text-sm font-medium text-primary tabular-nums">
                      {t("promos.discountOff", { percent: promo.discountPercent })}
                    </span>
                    <Badge tone={live ? "success" : "neutral"}>
                      {promo.status === "failed"
                        ? t("promos.status.failed")
                        : promo.status === "pending"
                          ? t("promos.status.pending")
                          : live
                            ? t("promos.status.live")
                            : promo.status === "disabled"
                              ? t("promos.status.disabled")
                              : t("promos.status.notLive")}
                    </Badge>
                  </div>
                  {promo.description ? (
                    <p className="mt-1 text-sm text-muted">{promo.description}</p>
                  ) : null}
                  <p className="mt-2 text-sm text-muted">
                    {t(SCOPE_KEYS[promo.scope])} ·{" "}
                    {promo.startsAt
                      ? t("promos.fromDate", {
                          date: formatDateTimeTz(promo.startsAt, locale, timezone),
                        })
                      : t("promos.liveNow")}{" "}
                    ·{" "}
                    {promo.expiresAt
                      ? t("promos.untilDate", {
                          date: formatDateTimeTz(promo.expiresAt, locale, timezone),
                        })
                      : t("promos.noEndDate")}
                  </p>
                  <p className="mt-1 text-sm text-muted tabular-nums">
                    {promo.maxRedemptions === null
                      ? t("promos.redeemedNoCap", { count: promo.timesRedeemed })
                      : t("promos.redeemedWithCap", {
                          count: promo.timesRedeemed,
                          max: promo.maxRedemptions,
                        })}
                  </p>
                </div>
                {switchable ? (
                  <form action={setPromoEnabledAction} className="shrink-0">
                    <input type="hidden" name="promoId" value={promo.id} />
                    <input type="hidden" name="enable" value={String(promo.status !== "active")} />
                    <SubmitButton
                      pendingLabel={t("promos.saving")}
                      className={buttonClass(
                        promo.status === "active"
                          ? { variant: "secondary", className: "text-foreground" }
                          : {},
                      )}
                    >
                      {promo.status === "active" ? t("promos.switchOff") : t("promos.switchOn")}
                    </SubmitButton>
                  </form>
                ) : null}
                {promo.status === "failed" || promo.status === "pending" ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {promo.status === "failed" ? (
                      <form action={retryPromoAction}>
                        <input type="hidden" name="promoId" value={promo.id} />
                        <SubmitButton
                          pendingLabel={t("promos.retrying")}
                          className={buttonClass({
                            variant: "secondary",
                            className: "text-foreground",
                          })}
                        >
                          {t("promos.retry")}
                        </SubmitButton>
                      </form>
                    ) : null}
                    <form action={deletePromoAction}>
                      <input type="hidden" name="promoId" value={promo.id} />
                      <SubmitButton
                        pendingLabel={t("promos.deleting")}
                        confirmMessage={t("promos.deleteConfirm", { code: promo.code })}
                        className={buttonClass({ variant: "danger" })}
                      >
                        {t("promos.delete")}
                      </SubmitButton>
                    </form>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="mt-10 font-medium">{t("promos.tripDeals.heading")}</h2>
      <p className="mt-1 text-sm text-muted">{t("promos.tripDeals.description")}</p>
      {tripDeals.length === 0 ? (
        <EmptyState className="mt-3">
          <p className="text-sm text-muted">{t("promos.tripDeals.empty")}</p>
        </EmptyState>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {tripDeals.map((deal) => (
            <li
              key={deal.id}
              className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-5"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-primary tabular-nums">
                  {t("promos.discountOff", { percent: deal.discountPercent })}
                </span>
                <span className="font-mono text-base font-semibold">{deal.code}</span>
              </div>
              <Link
                href={`/shop/${shopSlug}/trips/${deal.tripId}#last-minute-deal`}
                className="font-medium underline underline-offset-2"
              >
                {deal.tripTitle}
              </Link>
              <p className="text-sm text-muted">
                {t("promos.tripDeals.expiresAt", {
                  date: formatDateTimeTz(deal.expiresAt, locale, timezone),
                })}{" "}
                · {t("promos.tripDeals.recipients", { count: deal.recipientCount })}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">{t("promos.tripDeals.rangeNote")}</p>
    </main>
  );
}
