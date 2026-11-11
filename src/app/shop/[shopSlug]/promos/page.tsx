import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { Pager, staffPagerWords } from "@/components/Pager";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import {
  controlClass,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
} from "@/components/ui/form";
import {
  canAcceptPayments,
  canPersonManagePaymentSettings,
  getPromosPage,
} from "@/features/promos-page";
import { requireShopSurface } from "@/features/session";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { timeZoneLabel } from "@/i18n/timezone-labels";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { PROMO_DISCOUNT_MAX, PROMO_DISCOUNT_MIN, promoLedgerGroup } from "@/lib/promo-codes";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { StaffSectionTabs } from "../_components/StaffSectionTabs";
import { DivePackagesSection, TripDealsSection } from "./_components/DealsAndPackages";
import { PromoConnectNotice } from "./_components/PromoConnectNotice";
import { PromoDiscountFields, promoDiscountText } from "./_components/PromoDiscountFields";
import { PromoCodeLedger, type PromoCodeRow } from "./_components/PromoLedger";
import { codeOutcomeFact, tripDealRows } from "./_components/promo-outcomes";
import {
  CREATE_FORM_NOTICES,
  GROUP_KEYS,
  NOTICE_FIELD,
  NOTICES,
  SCOPE_KEYS,
  STATUS_BADGES,
} from "./_components/promo-page-copy";
import {
  createPromoAction,
  deletePromoAction,
  restorePromoAction,
  retryPromoAction,
  setPromoEnabledAction,
} from "./actions";

// `instant = true` asserts that navigating *into* this page paints immediately — this segment's
// `loading.tsx`, with no request read above it. Since the staff shell became synchronous (issue
// 1446) that holds for a cold, direct visit too: the shell's session, shop row and nav stream in
// beside the page from `ShopChrome` rather than above it, so the route gets a static shell and its
// own reads are the only ones the reader waits on. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Promo codes — DiveDay",
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
    undoDiscount?: string;
    undoDiscountKind?: string;
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
    undoDiscount,
    undoDiscountKind,
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
  // **Three prices, three switches** (the Features page): codes, the
  // last-minute list's deals and dive packages. The tab shows the ones that
  // are on, and with all three off a direct URL lands on Orders. Nothing is
  // deleted: a code switched off with the feature waits for it.
  const codesOn = shop.promoCodesEnabled;
  const dealsOn = shop.lastMinuteListEnabled;
  const packagesOn = shop.divePackagesEnabled;
  if (!codesOn && !dealsOn && !packagesOn) redirect(shopPath(shopSlug, "orders"));

  const now = nowDate();
  // A non-numeric or missing `?page=`/`?dealsPage=` reads as page 1; each
  // query clamps it into range, so a bookmarked page past the end of either
  // list lands on that list's last real page.
  const { promoPage, stripeAccount, dealPage, outcomes } = await getPromosPage(
    db,
    session.user.shopId,
    {
      now,
      page: Number.parseInt(page ?? "", 10),
      dealsPage: Number.parseInt(dealsPage ?? "", 10),
    },
  );
  const { promos } = promoPage;
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
  const [connected, banner] = [canAcceptPayments(stripeAccount), noticeFromParam(notice, NOTICES)];
  // Three homes, decided once: a field in the new-code form, that form's
  // action row, or the page. Nothing lands in more than one.
  // `noticeFromParam`, not `NOTICE_FIELD[notice]`: `?notice=` is
  // attacker-supplied and a bare index walks off `Object.prototype`
  // (src/lib/staff-notices.ts).
  const noticeField = noticeFromParam(notice, NOTICE_FIELD);
  const createStatus = notice && CREATE_FORM_NOTICES.has(notice) ? banner : undefined;
  const pageBanner = noticeField || createStatus ? undefined : banner;
  /** This box's refusal, already worded — or nothing, when the refusal was elsewhere. */
  const fieldError = (field: "code" | "discount" | "startsAt") =>
    noticeField === field && banner
      ? banner.key === "promos.notice.invalidDiscount"
        ? t(banner.key, { min: PROMO_DISCOUNT_MIN, max: PROMO_DISCOUNT_MAX })
        : t(banner.key)
      : undefined;
  const locale = await requestLocale(shop?.defaultLocale);
  const t = staffTranslator(locale);
  const timezone = shop?.timezone ?? "UTC";
  const currency = toShopCurrency(shop?.currency);

  /**
   * One code's row, already worded. The shelf comes off `promoLedgerGroup`
   * against the same `now` the query sorted by, so the heading a code renders
   * under and the run it was sorted into can never disagree.
   */
  const codeRows: PromoCodeRow[] = promos.map((promo) => {
    const badge = STATUS_BADGES[promo.status];
    const group = promoLedgerGroup(promo, now);
    // **Nothing to switch on a code that is over.** "Switch off" stood on every
    // row of the Ended shelf, offering to stop something the heading directly
    // above had already said had stopped — a code past its window, or with its
    // last redemption spent, is not redeemable whatever this flag says. An
    // ended code is a record; the shelf it sits on is the whole of what there
    // is to know about it.
    const switchable =
      (promo.status === "active" || promo.status === "disabled") && group !== "ended";
    return {
      id: promo.id,
      group,
      code: promo.code,
      discount: promoDiscountText(t, promo, currency, locale),
      ...(badge ? { badge: { tone: badge.tone, word: t(badge.key) } } : {}),
      description: promo.description,
      // One line, three facts: what it buys, the window it buys in, and what
      // it has spent. The window half stays a statement about the *window* —
      // it read "live now" once, which an expired code rendered directly under
      // a "Not live right now" badge as "live now · until Aug 1".
      facts: [
        t(SCOPE_KEYS[promo.scope]),
        promo.startsAt
          ? t("promos.fromDate", { date: formatDateTimeTz(promo.startsAt, locale, timezone) })
          : t("promos.noStartDate"),
        promo.expiresAt
          ? t("promos.untilDate", { date: formatDateTimeTz(promo.expiresAt, locale, timezone) })
          : t("promos.noEndDate"),
        promo.maxRedemptions === null
          ? t("promos.redeemedNoCap", { count: promo.timesRedeemed })
          : t("promos.redeemedWithCap", {
              count: promo.timesRedeemed,
              max: promo.maxRedemptions,
            }),
        codeOutcomeFact(outcomes.codes.get(promo.id), t, currency, locale),
      ].filter((fact): fact is string => fact !== null),
      ...(switchable || promo.status === "pending" || promo.status === "failed"
        ? {
            actions: switchable ? (
              <form action={setPromoEnabledAction}>
                <input type="hidden" name="promoId" value={promo.id} />
                <input type="hidden" name="enable" value={String(promo.status !== "active")} />
                <SubmitButton
                  pendingLabel={t("words.busy.saving")}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {promo.status === "active" ? t("promos.switchOff") : t("promos.switchOn")}
                </SubmitButton>
              </form>
            ) : (
              // `pending` and `failed` are the two states with no Stripe objects
              // behind them: there is nothing to switch, only to retry or clear.
              <div className="flex flex-wrap items-center gap-2">
                {promo.status === "failed" ? (
                  <form action={retryPromoAction}>
                    <input type="hidden" name="promoId" value={promo.id} />
                    <SubmitButton
                      pendingLabel={t("promos.retrying")}
                      className={buttonClass({ variant: "secondary", size: "sm" })}
                    >
                      {t("promos.retry")}
                    </SubmitButton>
                  </form>
                ) : null}
                <form action={deletePromoAction}>
                  <input type="hidden" name="promoId" value={promo.id} />
                  <SubmitButton
                    pendingLabel={t("words.busy.deleting")}
                    className={buttonClass({ variant: "danger", size: "sm" })}
                  >
                    {t("promos.delete")}
                  </SubmitButton>
                </form>
              </div>
            ),
          }
        : {}),
    };
  });

  const dealRows = tripDealRows({
    deals: dealPage.deals,
    outcomes: outcomes.deals,
    shopSlug,
    t,
    currency,
    locale,
    timezone,
  });
  return (
    <StaffPage width="full">
      <FlashParams
        params={[
          "notice",
          "undoCode",
          "undoDescription",
          "undoDiscount",
          "undoDiscountKind",
          "undoScope",
          "undoStartsAt",
          "undoExpiresAt",
          "undoMaxRedemptions",
        ]}
      />
      <ShopPageHeader title={t("shared.shopSections.money")} />
      <StaffSectionTabs
        section="money"
        current="promoCodes"
        roles={session.user.roles}
        shop={shop}
        t={t}
      />

      {notice === "deleted" && undoCode && undoDiscount && undoScope ? (
        <UndoToast
          message={t("promos.notice.deletedToast")}
          action={restorePromoAction}
          fields={{
            code: undoCode,
            discount: undoDiscount,
            discountKind: undoDiscountKind === "amount" ? "amount" : "percent",
            scope: undoScope,
            description: undoDescription ?? "",
            maxRedemptions: undoMaxRedemptions ?? "",
            ...(undoStartsAt ? { startsAt: undoStartsAt } : {}),
            ...(undoExpiresAt ? { expiresAt: undoExpiresAt } : {}),
          }}
          pendingLabel={t("words.busy.undoing")}
          undoLabel={t("shared.undoToast.undo")}
          dismissLabel={t("shared.undoToast.dismiss")}
        />
      ) : pageBanner ? (
        <StaffNoticeBanner tone={pageBanner.tone}>{t(pageBanner.key)}</StaffNoticeBanner>
      ) : null}
      {/* **A form that cannot submit does not stand open**: unconnected, the
          notice stands in for the composer, here when there are no codes and
          inside "New code" when there are (`PromoConnectNotice`). */}
      {!codesOn || connected || promoPage.total > 0 || shop.isDemo ? null : (
        <PromoConnectNotice t={t} shopSlug={shopSlug} className="mb-6" />
      )}

      {/* **And when it can submit, it is a door rather than a standing form.**
          Reading the ledger is daily; writing a code is a few times a season,
          so the seven fields wait behind one `secondary` control and the list
          leads the page (principle 8, "collapse the rare path").

          `AutoOpenDetails` because the anchor has to keep working from three
          places: the empty state's own button, a `?notice=` the create action
          bounced back with a refusal on one of these boxes, and any bookmark of
          `#new-code`. A client navigation to a fragment never runs the
          browser's own reveal, so a plain `<details>` would arrive collapsed
          with the refusal inside it. */}
      {codesOn ? (
        <AutoOpenDetails
          id="new-code"
          openOnHash="new-code"
          open={Boolean(createStatus || noticeField)}
          className="group/new-code mt-8 scroll-mt-24"
        >
          <summary
            className={`${buttonClass({ variant: "secondary" })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
          >
            {t("promos.newCode.heading")}
            {/* The disclosure caret, not the navigate chevron: which way it
                points is what says "this opens here" rather than "this leaves"
                (docs/design/settled-questions.md). */}
            <DisclosureCaret className="group-open/new-code:rotate-90" />
          </summary>
          {connected ? null : <PromoConnectNotice t={t} shopSlug={shopSlug} className="mt-4" />}
          {connected ? (
            <SectionCard className="mt-4" padding="lg" description={t("promos.newCode.detail")}>
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
                <Field label={t("promos.fields.goodFor")}>
                  <select name="scope" defaultValue="all" className={controlClass}>
                    {Object.entries(SCOPE_KEYS).map(([value, key]) => (
                      <option key={value} value={value}>
                        {t(key)}
                      </option>
                    ))}
                  </select>
                </Field>
                <PromoDiscountFields
                  t={t}
                  currency={currency}
                  locale={locale}
                  error={fieldError("discount")}
                />
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
                  <DateField name="startsAt" type="datetime-local" />
                </Field>
                <Field label={t("promos.fields.expires")} hint={t("promos.fields.expiresHint")}>
                  <DateField name="expiresAt" type="datetime-local" />
                </Field>
                {/* The human zone name, never the raw IANA id — "America/New_York"
              with its underscore is implementation surfacing (principle 4). */}
                <p className="-mt-2 text-xs text-muted sm:col-span-2">
                  {t("promos.fields.timezoneHint", {
                    timezone: timeZoneLabel(now, locale, timezone),
                  })}
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
          ) : null}
        </AutoOpenDetails>
      ) : null}

      {!codesOn ? null : promos.length === 0 ? (
        <EmptyState
          title={t("promos.empty.heading")}
          body={t("promos.empty.detail")}
          /* No door to a composer that is not on the page: with Stripe
             unconnected the banner above is the only next move there is. */
          action={
            connected ? (
              <a href="#new-code" className={buttonClass()}>
                {t("promos.empty.action")}
              </a>
            ) : null
          }
          className="mt-8"
        />
      ) : (
        <PromoCodeLedger
          className="mt-10"
          rows={codeRows}
          labels={{
            live: t(GROUP_KEYS.live),
            scheduled: t(GROUP_KEYS.scheduled),
            ended: t(GROUP_KEYS.ended),
          }}
          copy={{
            copyLabel: t("promos.copyCode"),
            copiedLabel: t("words.did.copied"),
            failedLabel: t("promos.copyCodeFailed"),
          }}
        />
      )}
      {codesOn ? (
        <Pager
          page={promoPage.page}
          pageCount={promoPage.pageCount}
          href={promosHref}
          total={t("promos.pagination.total", { count: promoPage.total })}
          words={staffPagerWords(t)}
        />
      ) : null}

      {dealsOn ? (
        <TripDealsSection
          t={t}
          shopSlug={shopSlug}
          rows={dealRows}
          page={dealPage}
          href={dealsHref}
        />
      ) : null}
      {packagesOn ? <DivePackagesSection {...{ db, shop, t, notice, locale }} /> : null}
    </StaffPage>
  );
}
