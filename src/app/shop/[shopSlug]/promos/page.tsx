import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { Pager } from "@/components/Pager";
import { PaymentsConnectCta } from "@/components/PaymentsConnectCta";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import type { BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FieldErrorFocus } from "@/components/ui/FieldErrorFocus";
import { controlClass, Field, FieldActions, FieldGrid, FormStatus } from "@/components/ui/form";
import { GroupLabel } from "@/components/ui/ledger";
import { canPersonManagePaymentSettings } from "@/db/authz";
import { listShopPromoCodes } from "@/db/shop-promos";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { listOutstandingLastMinutePromos } from "@/db/trip-promos";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { timeZoneLabel } from "@/i18n/timezone-labels";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz } from "@/lib/format";
import {
  PROMO_DISCOUNT_MAX,
  PROMO_DISCOUNT_MIN,
  type PromoLedgerGroup,
  promoLedgerGroup,
} from "@/lib/promo-codes";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import {
  PromoCodeLedger,
  type PromoCodeRow,
  TripDealLedger,
  type TripDealRow,
} from "./_components/PromoLedger";
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

/** The shelf words, one per group `promoLedgerGroup` can return. */
const GROUP_KEYS: Record<PromoLedgerGroup, StaffMessageKey> = {
  live: "promos.group.live",
  scheduled: "promos.group.scheduled",
  ended: "promos.group.ended",
};

/**
 * The badge a code wears, or nothing.
 *
 * Only the exceptional statuses are here (ADR
 * 20260827-clearwater-surface-language, decision 3 — a badge marks the
 * exception, never the expected). Whether a code is live, waiting to start or
 * over is its *window*, which the shelf it sits on already says once for the
 * whole run; "Live" and "Not live right now" were pills repeating a fact the
 * group header now owns, and both keys retired with them.
 *
 * All three keep the neutral tone the shipped page gave them. Slice 9g is a
 * recomposition and not a re-toning: a `failed` code arguably wants danger
 * ink, but that is a decision about what a broken code *is*, and it belongs
 * with whoever makes it deliberately rather than arriving as a side effect of
 * moving the window word to a heading. The row's own acts — Try again, Delete
 * — sit beside every one of these and say what to do about it.
 */
const STATUS_BADGES: Record<string, { tone: BadgeTone; key: StaffMessageKey }> = {
  failed: { tone: "neutral", key: "promos.status.failed" },
  pending: { tone: "neutral", key: "promos.status.pending" },
  disabled: { tone: "neutral", key: "promos.status.disabled" },
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
    listShopPromoCodes(db, session.user.shopId, {
      page: Number.parseInt(page ?? "", 10),
      now,
    }),
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

  /**
   * One code's row, already worded. The shelf comes off `promoLedgerGroup`
   * against the same `now` the query sorted by, so the heading a code renders
   * under and the run it was sorted into can never disagree.
   */
  const codeRows: PromoCodeRow[] = promos.map((promo) => {
    const badge = STATUS_BADGES[promo.status];
    const switchable = promo.status === "active" || promo.status === "disabled";
    return {
      id: promo.id,
      group: promoLedgerGroup(promo, now),
      code: promo.code,
      discount: t("promos.discountOff", { percent: promo.discountPercent }),
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
      ].join(" · "),
      actions: switchable ? (
        <form action={setPromoEnabledAction}>
          <input type="hidden" name="promoId" value={promo.id} />
          <input type="hidden" name="enable" value={String(promo.status !== "active")} />
          <SubmitButton
            pendingLabel={t("promos.saving")}
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
              pendingLabel={t("promos.deleting")}
              className={buttonClass({ variant: "danger", size: "sm" })}
            >
              {t("promos.delete")}
            </SubmitButton>
          </form>
        </div>
      ),
    };
  });

  const dealRows: TripDealRow[] = tripDeals.map((deal) => ({
    id: deal.id,
    code: deal.code,
    discount: t("promos.discountOff", { percent: deal.discountPercent }),
    tripTitle: deal.tripTitle,
    href: `/shop/${shopSlug}/trips/${deal.tripId}#last-minute-deal`,
    facts: [
      t("promos.tripDeals.expiresAt", {
        date: formatDateTimeTz(deal.expiresAt, locale, timezone),
      }),
      t("promos.tripDeals.recipients", { count: deal.recipientCount }),
    ].join(" · "),
  }));

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
        eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.promoCodes)}
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

      {promos.length === 0 ? (
        <EmptyState
          title={t("promos.empty.heading")}
          body={t("promos.empty.detail")}
          action={
            <a href="#new-code" className={buttonClass({ className: "mt-4" })}>
              {t("promos.empty.action")}
            </a>
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
            copiedLabel: t("promos.copyCodeCopied"),
            failedLabel: t("promos.copyCodeFailed"),
          }}
        />
      )}
      <Pager
        page={promoPage.page}
        pageCount={promoPage.pageCount}
        href={promosHref}
        total={t("promos.pagination.total", { count: promoPage.total })}
        t={t}
        className="mt-4"
      />

      {/* One heading over both branches — the list and its empty state stand
          under the same words, so neither renders a second spelling of them. */}
      <GroupLabel as="h2" id="trip-deals" className="mt-10">
        {t("promos.tripDeals.heading")}
      </GroupLabel>
      <p className="mt-1 text-sm text-muted">{t("promos.tripDeals.description")}</p>
      {tripDeals.length === 0 ? (
        // A trip deal is sent from a departure, never from here, so the door is
        // the board — the line above already says so; this is the way there.
        <EmptyState
          titleAs="h3"
          title={t("promos.tripDeals.empty")}
          action={
            <Link
              href={`/shop/${shopSlug}/schedule/board`}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-4" })}
            >
              {t("promos.tripDeals.emptyAction")}
            </Link>
          }
          className="mt-3"
        />
      ) : (
        <TripDealLedger className="mt-3" labelledBy="trip-deals" rows={dealRows} />
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
