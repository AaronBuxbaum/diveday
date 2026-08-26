import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, FormStatus } from "@/components/ui/form";
import { canPersonRefund } from "@/db/authz";
import { getDb } from "@/db/client";
import { getOrder, refreshOrderStatus, refundOrder, voidOrder } from "@/db/orders";
import type { OrderStatus } from "@/db/schema";
import { getShopById } from "@/db/shops";
import { ORDER_STATUS_TONES } from "@/i18n/order-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { currencySymbol, majorToMinor, minorToMajor } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireShopSurface, requireStaffSession } from "@/lib/session";
import { type NoticeTone, noticeFromParam, noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Order — DiveDay" };

/**
 * Keyed by the enum rather than by `string`, so a status added to the column
 * is a compile error here instead of a page rendering the raw value.
 *
 * It was `Record<string, …>` until `partly_refunded` arrived and this heading
 * read literally "partly_refunded" to the shop (issue #699) — the lookup falls
 * through to the enum value, which looks like data and reads like a bug. The
 * sibling map on the Orders index and `ORDER_STATUS_KEYS` in
 * `src/i18n/order-labels.ts` are the same shape for the same reason.
 */
const STATUS_KEYS: Record<OrderStatus, StaffMessageKey> = {
  open: "orders.detail.status.open",
  paid: "orders.detail.status.paid",
  void: "orders.detail.status.void",
  uncollectible: "orders.detail.status.uncollectible",
  partly_refunded: "orders.detail.status.partlyRefunded",
  refunded: "orders.detail.status.refunded",
};

const KIND_KEYS: Record<string, StaffMessageKey> = {
  trip_fee: "orders.detail.kind.trip_fee",
  course_fee: "orders.detail.kind.course_fee",
  rental: "orders.detail.kind.rental",
  nitrox: "orders.detail.kind.nitrox",
  deposit: "orders.detail.kind.deposit",
  merchandise: "orders.detail.kind.merchandise",
  other: "orders.detail.kind.other",
};

/**
 * Demo shops carry seeded orders whose Stripe invoice ids are fabricated (the
 * demo never connects a real Stripe account). Refresh / void / refund all reach
 * out to Stripe with those ids and would error against live platform
 * credentials, so on a demo shop these actions are refused before any Stripe
 * call — and the buttons are rendered disabled to match (src/db/seed.ts).
 */
// i18n-exempt: scanner false positive — the copy scanner reads the `>` closing this generic as JSX and treats the rest of the signature as a text node; it is code, not copy.
async function isDemoShop(db: Awaited<ReturnType<typeof getDb>>, shopId: string): Promise<boolean> {
  const shop = await getShopById(db, shopId);
  return shop?.isDemo ?? false;
}

/**
 * Every action on this page narrows the posted `orderId` with `uuidParam`
 * before it can reach `eq(orders.id, $1)`.
 *
 * Postgres raises on a malformed uuid literal rather than returning no rows,
 * so a hand-posted `orderId=abc` was an unhandled **500** where each action's
 * own `not_found` refusal belongs two lines later — the same failure the
 * dynamic-segment guard (`scripts/check-uuid-segments.mjs`) exists to stop on
 * routes, on a surface that moves money. The sibling refund door in
 * `divers/[personId]/actions.ts` already did this; here the money action was
 * the outlier (issue #699 security review).
 */
async function refreshAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const orderId = uuidParam(String(formData.get("orderId") ?? "")) ?? "";
  const db = await getDb();
  const back = shopPath(session.user.shopSlug, "orders", orderId);
  if (await isDemoShop(db, session.user.shopId)) {
    revalidateAndRedirect(back, noticeUrl(back, "demo-disabled"));
    return;
  }
  const updated = orderId ? await refreshOrderStatus(db, session.user.shopId, orderId) : null;
  revalidateAndRedirect(back, noticeUrl(back, updated ? "refreshed" : "refresh-failed"));
}

async function voidAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const orderId = uuidParam(String(formData.get("orderId") ?? "")) ?? "";
  const db = await getDb();
  const back = shopPath(session.user.shopSlug, "orders", orderId);
  if (await isDemoShop(db, session.user.shopId)) {
    revalidateAndRedirect(back, noticeUrl(back, "demo-disabled"));
    return;
  }
  const updated = orderId ? await voidOrder(db, session.user.shopId, orderId) : null;
  revalidateAndRedirect(back, noticeUrl(back, updated ? "voided" : "void-failed"));
}

async function refundAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const orderId = uuidParam(String(formData.get("orderId") ?? "")) ?? "";
  const db = await getDb();
  const back = shopPath(session.user.shopSlug, "orders", orderId);
  // Money leaving the account is owner/manager work, re-checked against live
  // roles (H-14, ADR 20260724-role-authorization).
  if (!(await canPersonRefund(db, session.user.shopId, session.user.personId))) {
    revalidateAndRedirect(back, noticeUrl(back, "not-authorized"));
    return;
  }
  if (await isDemoShop(db, session.user.shopId)) {
    revalidateAndRedirect(back, noticeUrl(back, "demo-disabled"));
    return;
  }
  // **What to send back.** The field carries major units because that is what
  // a staffer types; the domain works in minor ones. An empty field means the
  // whole remaining balance, which is what this button did before it could do
  // anything else — so a shop that never touches the amount sees no change at
  // all (issue #699).
  //
  // **The currency comes off the order, never off the form.** `majorToMinor`
  // scales by that currency's own minor units — two digits for USD, none for
  // JPY, three for BHD — so a hand-posted `currency` would silently multiply
  // or divide what the staffer typed by a thousand. The order row is the only
  // thing that knows what it was charged in, and it is read here under the
  // session's own `shopId` rather than accepted from the request.
  //
  // The typed figure is a *request*, never a bound: `refundOrder` re-reads the
  // order under its own `FOR UPDATE` lock and refuses anything above what that
  // row still holds, so the `max` on the input below is a convenience for the
  // person and nothing more. A hand-posted form gets `invalid_amount`.
  const typedAmount = String(formData.get("amountMajor") ?? "").trim();
  const existing = orderId ? await getOrder(db, session.user.shopId, orderId) : null;
  if (typedAmount && (!existing || !Number.isFinite(Number(typedAmount)))) {
    revalidateAndRedirect(back, noticeUrl(back, "refund-invalid-amount"));
    return;
  }
  const requestedCents =
    typedAmount && existing
      ? majorToMinor(Number(typedAmount), existing.order.currency)
      : undefined;
  // A code, never a sentence — `refundOrder` says *why* it did not move money
  // and this picks the words (docs ADR 20260731-domain-layer-copy-leaks).
  // `in_progress` is its own notice on purpose: the honest answer to a
  // double-tapped button is "the first one is still running", not "it failed",
  // which would send staff back to press it again (PAY-L3).
  const outcome = orderId
    ? await refundOrder(db, session.user.shopId, orderId, undefined, {
        amountCents: requestedCents,
      })
    : ({ status: "not_found" } as const);
  const notice =
    outcome.status === "refunded"
      ? outcome.order.status === "partly_refunded"
        ? "partly-refunded"
        : "refunded"
      : outcome.status === "in_progress"
        ? "refund-in-progress"
        : outcome.status === "invalid_amount"
          ? "refund-invalid-amount"
          : // Stripe already moved money on an earlier attempt whose local
            // write never landed. Pressing again would reverse more, so this
            // says so and points at the stuck-operations panel instead.
            outcome.status === "needs_reconciliation"
            ? "refund-needs-reconciliation"
            : "refund-failed";
  revalidateAndRedirect(back, noticeUrl(back, notice));
}

// A notice query param maps to a message key, never to a sentence — the words
// come from the staff bundle at render time (docs ADR 20260730-staff-copy-localization).
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  refreshed: { tone: "success", key: "orders.detail.notice.refreshed" },
  "refresh-failed": { tone: "danger", key: "orders.detail.notice.refreshFailed" },
  voided: { tone: "success", key: "orders.detail.notice.voided" },
  "void-failed": { tone: "danger", key: "orders.detail.notice.voidFailed" },
  refunded: { tone: "success", key: "orders.detail.notice.refunded" },
  "partly-refunded": { tone: "success", key: "orders.detail.notice.partlyRefunded" },
  "refund-invalid-amount": { tone: "danger", key: "orders.detail.notice.refundInvalidAmount" },
  "refund-failed": { tone: "danger", key: "orders.detail.notice.refundFailed" },
  "refund-in-progress": { tone: "warning", key: "orders.detail.notice.refundInProgress" },
  "refund-needs-reconciliation": {
    tone: "warning",
    key: "orders.detail.notice.refundNeedsReconciliation",
  },
  "not-authorized": { tone: "danger", key: "orders.detail.notice.notAuthorized" },
  "demo-disabled": { tone: "neutral", key: "orders.detail.notice.demoDisabled" },
};

/** A greyed-out stand-in for a Stripe action a demo shop can't perform. */
function DisabledDemoButton({
  label,
  hint,
  variant,
}: {
  label: string;
  hint: string;
  variant: "secondary" | "danger";
}) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={hint}
      className={buttonClass({
        variant,
        className: "cursor-not-allowed opacity-50",
      })}
    >
      {label}
    </button>
  );
}

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug, id } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(id)) notFound();
  const { notice } = await searchParams;
  // One shop read for both the demo guard and the timezone the order's date is
  // written in — a money screen should say "3 Aug" in the shop's own day, not
  // the server's.
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const order = await getOrder(db, shop.id, id);
  if (!order) notFound();
  const demo = shop.isDemo ?? false;
  const timezone = shop.timezone ?? "UTC";
  // Refunds are owner/manager only (H-14, ADR 20260724-role-authorization);
  // hide the control from other staff. refundAction re-checks regardless.
  const canRefund = await canPersonRefund(db, shop.id, session.user.personId);
  // What is left to give back, as a number a person types. Read off the order
  // rather than its total, so a second partial refund offers the remainder
  // instead of re-offering the whole charge (issue #699).
  const refundableMajor = minorToMajor(order.order.amountPaidCents, order.order.currency);
  // Built above the JSX rather than nested in it: `check:copy` reads a ternary
  // chain inside an element as prose, and with the demo branch this one is
  // three deep (same reason `PublicShopChrome`'s address node is hoisted).
  const canOfferRefund =
    canRefund &&
    (order.order.status === "paid" || order.order.status === "partly_refunded") &&
    order.order.amountPaidCents > 0;
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const demoActionHint = t("orders.detail.demoActionHint");
  const banner = noticeFromParam(notice, NOTICES);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("orders.detail.eyebrow")}
        title={order.person.fullName}
        description={order.order.description || t("orders.detail.fallbackDescription")}
        meta={
          // When it was raised, and by whom. Both were missing entirely: the
          // orders index shows a date column, and losing it on the way into the
          // one order you opened is exactly the detail a refund argument turns
          // on. `created_by_person_id` was already stored — nothing new is kept.
          <p className="text-sm text-muted">
            {t("orders.detail.raisedOn", {
              date: formatShortDate(order.order.createdAt, locale, timezone),
            })}
            {order.createdBy
              ? ` · ${t("orders.detail.createdBy", { name: order.createdBy.fullName })}`
              : ""}
          </p>
        }
        actions={
          // Two different journeys, so two doors rather than one guess: staff
          // arrive here from the diver's record *and* from the Orders index,
          // Reports' revenue card, and the command palette. Whichever way you
          // came, the other is one click, not browser-back.
          <>
            <Link
              href={`/shop/${shopSlug}/orders`}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("orders.detail.backToOrders")}
            </Link>
            <Link
              href={`/shop/${shopSlug}/divers/${order.person.id}`}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("orders.detail.backToDiver")}
            </Link>
          </>
        }
      />

      {notice === "not-authorized" && banner ? (
        // The one genuinely page-level code: a staffer without refund rights
        // never sees the button that would have answered it.
        <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner>
      ) : null}

      {/* `padding="lg"`: the receipt is a card someone works *inside* —
          Refresh, Void and Refund all live in it. No `title`; the page header
          above already names the order, and the status badge is the heading
          row's whole content. */}
      <SectionCard padding="lg">
        <div className="flex items-center justify-between gap-3">
          {/* This page is *about* one order, so every status earns its badge —
              including `paid`, which the index deliberately leaves off a
              column of 50 rows. Same map, opposite call, both stated. */}
          <Badge tone={ORDER_STATUS_TONES[order.order.status] ?? "neutral"}>
            {STATUS_KEYS[order.order.status]
              ? t(STATUS_KEYS[order.order.status])
              : order.order.status}
          </Badge>
          <span className="text-lg font-semibold tabular-nums">
            {formatMoneyCents(order.order.totalCents, order.order.currency, locale)}
          </span>
        </div>

        {/* **What came back, and what is still here.** A `Partly refunded`
            badge above a total is not a fact a shop can act on: it says money
            moved without saying how much, so $10 back on $240 and $230 back on
            $240 render identically. `refunded_cents` and `amount_paid_cents`
            carry the whole story in the row — they were simply never put on
            the screen (issue #699; found by looking at the new capture).
            Only on an order that has actually given something back, so a plain
            paid order gains no line. */}
        {order.order.refundedCents > 0 ? (
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted">{t("orders.detail.refundedSoFar")}</dt>
              <dd className="font-medium tabular-nums">
                {formatMoneyCents(order.order.refundedCents, order.order.currency, locale)}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">{t("orders.detail.stillHeld")}</dt>
              <dd className="font-medium tabular-nums">
                {formatMoneyCents(order.order.amountPaidCents, order.order.currency, locale)}
              </dd>
            </div>
          </dl>
        ) : null}

        <ul className="mt-4 divide-y divide-border">
          {order.lineItems.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>
                {item.description}{" "}
                <span className="text-muted">
                  ({KIND_KEYS[item.kind] ? t(KIND_KEYS[item.kind]) : item.kind}
                  {item.quantity > 1 ? ` × ${item.quantity}` : ""})
                </span>
              </span>
              <span className="tabular-nums">
                {formatMoneyCents(
                  item.unitAmountCents * item.quantity,
                  order.order.currency,
                  locale,
                )}
              </span>
            </li>
          ))}
        </ul>

        {order.order.taxCents > 0 ? (
          <dl className="mt-3 flex justify-end gap-2 text-sm">
            <dt className="text-muted">{t("orders.detail.tax")}</dt>
            <dd className="font-medium tabular-nums">
              {formatMoneyCents(order.order.taxCents, order.order.currency, locale)}
            </dd>
          </dl>
        ) : null}

        {order.order.hostedInvoiceUrl ? (
          <p className="mt-4 text-sm">
            <a
              href={order.order.hostedInvoiceUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline"
            >
              {t("orders.detail.openInvoice")}
            </a>{" "}
            {t("orders.detail.openInvoiceHint")}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {order.order.status === "open" ? (
            demo ? (
              <>
                <DisabledDemoButton
                  label={t("orders.detail.refreshStatus")}
                  hint={demoActionHint}
                  variant="secondary"
                />
                <DisabledDemoButton
                  label={t("orders.detail.voidOrder")}
                  hint={demoActionHint}
                  variant="danger"
                />
              </>
            ) : (
              <>
                <form action={refreshAction}>
                  <input type="hidden" name="orderId" value={order.order.id} />
                  <SubmitButton
                    pendingLabel={t("orders.detail.refreshing")}
                    className={buttonClass({ variant: "secondary" })}
                  >
                    {t("orders.detail.refreshStatus")}
                  </SubmitButton>
                </form>
                <form action={voidAction}>
                  <input type="hidden" name="orderId" value={order.order.id} />
                  <SubmitButton
                    pendingLabel={t("orders.detail.voiding")}
                    className={buttonClass({ variant: "danger" })}
                  >
                    {t("orders.detail.voidOrder")}
                  </SubmitButton>
                </form>
              </>
            )
          ) : null}
          {canOfferRefund ? (
            demo ? (
              <DisabledDemoButton
                label={t("orders.detail.refundPayment")}
                hint={demoActionHint}
                variant="danger"
              />
            ) : (
              /* **The amount is a field, not a decision made for the shop.**
                 It arrives holding the whole remaining balance, so the old
                 one-tap full refund is still one tap; the four things a shop
                 actually does with money it is holding — a policy step rather
                 than a cliff, keeping a non-refundable fee, releasing one
                 diver out of a party on a shared checkout, and the goodwill
                 half-refund after weather cuts a boat short — are the reason
                 it can be edited at all (issue #699).

                 `max` is the balance and `step` the currency's own minor unit,
                 so the browser catches the ordinary slip. It is a courtesy,
                 never the gate: `refundOrder` re-reads the row under its own
                 lock and Stripe refuses an over-refund behind that. */
              <form action={refundAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="orderId" value={order.order.id} />
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">
                    {t("orders.detail.refundAmountLabel", {
                      currency: currencySymbol(order.order.currency, locale),
                    })}
                  </span>
                  <input
                    type="number"
                    name="amountMajor"
                    inputMode="decimal"
                    min={minorToMajor(1, order.order.currency)}
                    max={refundableMajor}
                    step={minorToMajor(1, order.order.currency)}
                    defaultValue={refundableMajor}
                    className={`${controlClass} w-32 text-sm tabular-nums`}
                  />
                </label>
                <SubmitButton
                  pendingLabel={t("orders.detail.refunding")}
                  className={buttonClass({ variant: "danger" })}
                >
                  {t("orders.detail.refundPayment")}
                </SubmitButton>
              </form>
            )
          ) : null}
        </div>
        {/* What Refresh / Void / Refund just did, beside those buttons rather
            than in a banner above the line items. An unrecognised code renders
            the neutral fallback sentence, never the raw query value:
            `?notice=` is attacker-craftable, and this is a money screen — a
            hostile link must not be able to paint its own words into a
            success-green message (same rule as orders/new's fallback). */}
        <FormStatus tone={banner?.tone ?? "neutral"} className="mt-2">
          {notice && notice !== "not-authorized"
            ? banner
              ? t(banner.key)
              : t("orders.detail.notice.fallback")
            : undefined}
        </FormStatus>
        {demo && (order.order.status === "open" || order.order.status === "paid") ? (
          <p className="mt-2 text-xs text-muted">{demoActionHint}</p>
        ) : null}
      </SectionCard>
    </main>
  );
}
