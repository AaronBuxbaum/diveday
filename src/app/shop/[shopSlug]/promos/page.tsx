import type { Metadata } from "next";
import Link from "next/link";
import { Copyable } from "@/components/Copyable";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { Pager } from "@/components/Pager";
import { PaymentsConnectCta } from "@/components/PaymentsConnectCta";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "@/components/ui/form";
import { canPersonManagePaymentSettings } from "@/db/authz";
import { listShopPromoCodes } from "@/db/shop-promos";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { listOutstandingLastMinutePromos } from "@/db/trip-promos";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { timeZoneLabel } from "@/i18n/timezone-labels";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz } from "@/lib/format";
import { isPromoRedeemable, PROMO_DISCOUNT_MAX, PROMO_DISCOUNT_MIN } from "@/lib/promo-codes";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import {
  createPromoAction,
  deletePromoAction,
  restorePromoAction,
  retryPromoAction,
  setPromoEnabledAction,
} from "./actions";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

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
  "invalid-code": { tone: "danger", key: "promos.notice.invalidCode" },
  "invalid-discount": { tone: "danger", key: "promos.notice.invalidDiscount" },
  "invalid-window": { tone: "danger", key: "promos.notice.invalidWindow" },
  duplicate: { tone: "danger", key: "promos.notice.duplicate" },
  "not-connected": { tone: "warning", key: "promos.notice.notConnected" },
  "stripe-failed": { tone: "danger", key: "promos.notice.stripeFailed" },
  "not-authorized": { tone: "danger", key: "promos.notice.notAuthorized" },
  restored: { tone: "success", key: "promos.notice.restored" },
  "restore-failed": { tone: "danger", key: "promos.notice.restoreFailed" },
};

/**
 * The refusals that belong on one box in the new-code form, not in a banner
 * above it. `Field`'s `error` renders each under its own control and wires the
 * `aria-invalid`/`aria-describedby` pair; `FieldErrorFocus` then puts the
 * cursor on the first one, so "that discount is out of range" arrives *on the
 * discount box* rather than four fields above it.
 */
const NOTICE_FIELD: Record<string, "code" | "discountPercent" | "startsAt"> = {
  "invalid-code": "code",
  duplicate: "code",
  "invalid-discount": "discountPercent",
  "invalid-window": "startsAt",
};

/**
 * The rest of what the new-code form can say. Everything not listed here or in
 * `NOTICE_FIELD` is about the *list* below the form — a code enabled, deleted,
 * restored — and keeps the page-level banner.
 */
const CREATE_FORM_NOTICES = new Set(["created", "invalid", "not-connected", "stripe-failed"]);

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
  searchParams: Promise<{
    notice?: string;
    undoCode?: string;
    undoDescription?: string;
    undoDiscountPercent?: string;
    undoScope?: string;
    undoStartsAt?: string;
    undoExpiresAt?: string;
    undoMaxRedemptions?: string;
    page?: string;
    dealsPage?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const {
    notice,
    undoCode,
    undoDescription,
    undoDiscountPercent,
    undoScope,
    undoStartsAt,
    undoExpiresAt,
    undoMaxRedemptions,
    page,
    dealsPage,
  } = await searchParams;
  // Lands on Today, with its own notice code so the reader gets the
  // promo-specific explanation (`promos.notice.notAuthorized`) rather than a
  // message about a different surface they never asked for (task 82, UX
  // persona 11 "Kai"). It used to land on Settings, as the nearest surface
  // that could explain it; Settings is owner/manager work now and takes the
  // same gate this one just failed, so that landing became a second bounce
  // that dropped the reason on the floor.
  const { session, db, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManagePaymentSettings,
    refusal: { notice: "promos-not-authorized" },
  });

  const now = nowDate();
  const [promoPage, stripeAccount, dealPage] = await Promise.all([
    // A non-numeric or missing `?page=`/`?dealsPage=` reads as page 1; each
    // query clamps it into range, so a bookmarked page past the end of either
    // list lands on that list's last real page.
    listShopPromoCodes(db, session.user.shopId, { page: Number.parseInt(page ?? "", 10) }),
    getShopStripeAccount(db, session.user.shopId),
    listOutstandingLastMinutePromos(db, session.user.shopId, now, {
      page: Number.parseInt(dealsPage ?? "", 10),
    }),
  ]);
  const { promos } = promoPage;
  const { deals: tripDeals } = dealPage;
  const base = shopPath(shopSlug, "promos");
  // The two lists page independently, so moving one must carry the other's
  // page along rather than resetting it back to its own first page.
  const pairedHref = (own: "page" | "dealsPage", target: number) => {
    const other = own === "page" ? dealsPage : page;
    const otherKey = own === "page" ? "dealsPage" : "page";
    const query = new URLSearchParams();
    if (target > 1) query.set(own, String(target));
    if (other) query.set(otherKey, other);
    const search = query.toString();
    return search ? `${base}?${search}` : base;
  };
  const promosHref = (target: number) => pairedHref("page", target);
  const dealsHref = (target: number) => pairedHref("dealsPage", target);
  const connected = canAcceptPayments(stripeAccount);
  const banner = noticeFromParam(notice, NOTICES);
  // Three homes, decided once: a field in the new-code form, that form's
  // action row, or the page. Nothing lands in more than one.
  // `noticeFromParam`, not `NOTICE_FIELD[notice]`: `?notice=` is
  // attacker-supplied and a bare index walks off `Object.prototype`
  // (src/lib/staff-notices.ts).
  const noticeField = noticeFromParam(notice, NOTICE_FIELD);
  const createStatus = notice && CREATE_FORM_NOTICES.has(notice) ? banner : undefined;
  const pageBanner = noticeField || createStatus ? undefined : banner;
  /** This box's refusal, already worded — or nothing, when the refusal was elsewhere. */
  const fieldError = (field: "code" | "discountPercent" | "startsAt") =>
    noticeField === field && banner
      ? banner.key === "promos.notice.invalidDiscount"
        ? t(banner.key, { min: PROMO_DISCOUNT_MIN, max: PROMO_DISCOUNT_MAX })
        : t(banner.key)
      : undefined;
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  const timezone = shop?.timezone ?? "UTC";

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams
        params={[
          "notice",
          "undoCode",
          "undoDescription",
          "undoDiscountPercent",
          "undoScope",
          "undoStartsAt",
          "undoExpiresAt",
          "undoMaxRedemptions",
        ]}
      />
      <ShopPageHeader
        eyebrow={t("promos.eyebrow")}
        title={t("promos.title")}
        description={t("promos.description")}
      />

      {notice === "deleted" && undoCode && undoDiscountPercent && undoScope ? (
        <UndoToast
          message={t("promos.notice.deletedToast")}
          action={restorePromoAction}
          fields={{
            code: undoCode,
            discountPercent: undoDiscountPercent,
            scope: undoScope,
            description: undoDescription ?? "",
            maxRedemptions: undoMaxRedemptions ?? "",
            ...(undoStartsAt ? { startsAt: undoStartsAt } : {}),
            ...(undoExpiresAt ? { expiresAt: undoExpiresAt } : {}),
          }}
          pendingLabel={t("shared.undoToast.pendingLabel")}
          undoLabel={t("shared.undoToast.undo")}
        />
      ) : pageBanner ? (
        <StaffNoticeBanner tone={pageBanner.tone}>{t(pageBanner.key)}</StaffNoticeBanner>
      ) : null}

      {connected ? null : (
        <PaymentsConnectCta
          variant="banner"
          message={t.rich("promos.connectBanner", {
            settingsLink: (chunks) => (
              <Link href={`/shop/${shopSlug}/settings`} className="font-semibold underline">
                {chunks}
              </Link>
            ),
          })}
        />
      )}

      {/* The target the empty state below jumps to — a plain in-page anchor,
          so nothing re-renders and the form keeps whatever is typed in it. */}
      <SectionCard
        id="new-code"
        className="scroll-mt-24"
        padding="lg"
        title={t("promos.newCode.heading")}
        description={t("promos.newCode.detail")}
      >
        <FieldGrid as="form" action={createPromoAction} columns={2}>
          <Field
            label={t("promos.fields.code")}
            hint={t("promos.fields.codeHint")}
            error={fieldError("code")}
          >
            <input
              name="code"
              required
              maxLength={40}
              placeholder={t("promos.fields.codePlaceholder")}
              autoComplete="off"
              className={`${controlClass} uppercase`}
            />
          </Field>
          <Field
            label={t("promos.fields.discount")}
            hint={t("promos.fields.discountHint")}
            error={fieldError("discountPercent")}
          >
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
          <Field
            label={t("promos.fields.starts")}
            hint={t("promos.fields.startsHint")}
            error={fieldError("startsAt")}
          >
            <input name="startsAt" type="datetime-local" className={controlClass} />
          </Field>
          <Field label={t("promos.fields.expires")} hint={t("promos.fields.expiresHint")}>
            <input name="expiresAt" type="datetime-local" className={controlClass} />
          </Field>
          {/* The human zone name, never the raw IANA id — "America/New_York"
              with its underscore is implementation surfacing (principle 4). */}
          <p className="-mt-2 text-xs text-muted sm:col-span-2">
            {t("promos.fields.timezoneHint", { timezone: timeZoneLabel(now, locale, timezone) })}
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
            <FormStatus tone={createStatus?.tone}>
              {createStatus ? t(createStatus.key) : undefined}
            </FormStatus>
          </FieldActions>
          {/* Keyed on the notice so an identical repeat refusal still re-fires
              the focus move — the effect is otherwise skipped on a re-render
              that changed nothing it depends on. */}
          <FieldErrorFocus key={notice} scope="new-code" />
        </FieldGrid>
      </SectionCard>

      <h2 className="mt-8 text-lg font-semibold">{t("promos.yourCodes")}</h2>
      {promos.length === 0 ? (
        <EmptyState>
          <h3 className="font-medium">{t("promos.empty.heading")}</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">{t("promos.empty.detail")}</p>
          {/* "Create one above" is a direction, not a door. This is the door. */}
          <a href="#new-code" className={buttonClass({ className: "mt-4" })}>
            {t("promos.empty.action")}
          </a>
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
              <SectionCard
                as="li"
                key={promo.id}
                padding="lg"
                className="list-none flex flex-col gap-3 sm:flex-row sm:items-start"
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
                  {/* This line describes the code's *window*, so the "no start
                      date" half has to stay a statement about the window, not
                      about whether the code is live — it used to read "live
                      now", which an expired code rendered directly under a
                      "Not live right now" badge as "live now · until Aug 1". */}
                  <p className="mt-2 text-sm text-muted">
                    {t(SCOPE_KEYS[promo.scope])} ·{" "}
                    {promo.startsAt
                      ? t("promos.fromDate", {
                          date: formatDateTimeTz(promo.startsAt, locale, timezone),
                        })
                      : t("promos.noStartDate")}{" "}
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
                        promo.status === "active" ? { variant: "secondary" } : {},
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
                        className={buttonClass({ variant: "danger" })}
                      >
                        {t("promos.delete")}
                      </SubmitButton>
                    </form>
                  </div>
                ) : null}
              </SectionCard>
            );
          })}
        </ul>
      )}
      <Pager
        page={promoPage.page}
        pageCount={promoPage.pageCount}
        href={promosHref}
        total={t("promos.pagination.total", { count: promoPage.total })}
        t={t}
        className="mt-4"
      />

      <h2 className="mt-10 text-lg font-semibold">{t("promos.tripDeals.heading")}</h2>
      <p className="mt-1 text-sm text-muted">{t("promos.tripDeals.description")}</p>
      {tripDeals.length === 0 ? (
        // A trip deal is sent from a departure, never from here, so the door is
        // the board — the copy above already says so; this is the way there.
        <EmptyState className="mt-3">
          <p className="mx-auto max-w-md text-sm text-muted">{t("promos.tripDeals.empty")}</p>
          <Link
            href={`/shop/${shopSlug}/schedule/board`}
            className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
          >
            {t("promos.tripDeals.emptyAction")}
          </Link>
        </EmptyState>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {tripDeals.map((deal) => (
            <SectionCard
              as="li"
              key={deal.id}
              padding="lg"
              className="list-none flex flex-col gap-1"
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
            </SectionCard>
          ))}
        </ul>
      )}
      <Pager
        page={dealPage.page}
        pageCount={dealPage.pageCount}
        href={dealsHref}
        total={t("promos.tripDeals.pagination.total", { count: dealPage.total })}
        t={t}
        className="mt-4"
      />
    </main>
  );
}
