import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { PrintButton } from "@/components/PrintButton";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, FormStatus } from "@/components/ui/form";
import { FIGURE_INLINE_CLASS } from "@/components/ui/typography";
import { canPersonManageOrders, canPersonRefund } from "@/db/authz";
import { getOrder } from "@/db/orders";
import type { OrderStatus } from "@/db/schema";
import { ORDER_STATUS_TONES } from "@/i18n/order-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents } from "@/lib/format";
import { currencySymbol, minorToMajor } from "@/lib/money";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { type NoticeTone, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { PaidAtCounterLine, VoidCounterOrderForm } from "./_components/CounterPayment";
import { DisabledDemoButton } from "./_components/DisabledDemoButton";
import { OrderDisputeBanner, OrderMeta } from "./_components/OrderMeta";
import { refreshAction, refundAction, voidAction } from "./actions";
import { loadOrderHeader } from "./order-header";

// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
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

// A notice query param maps to a message key, never to a sentence — the words
// come from the staff bundle at render time (docs ADR 20260730-staff-copy-localization).
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  refreshed: { tone: "success", key: "orders.detail.notice.refreshed" },
  "refresh-failed": { tone: "danger", key: "orders.detail.notice.refreshFailed" },
  voided: { tone: "success", key: "orders.detail.notice.voided" },
  "void-failed": { tone: "danger", key: "orders.detail.notice.voidFailed" },
  "void-not-authorized": { tone: "danger", key: "orders.detail.notice.voidNotAuthorized" },
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
  const [canRefund, header] = await Promise.all([
    canPersonRefund(db, shop.id, session.user.personId),
    loadOrderHeader(db, {
      shopId: shop.id,
      orderId: order.order.id,
      personId: session.user.personId,
    }),
  ]);
  // Money taken at the counter, in cash or on the shop's own card machine (ADR
  // 20261009-counter-payments). It has no Stripe invoice, so none of the
  // Stripe controls below apply; an owner or manager can void it instead.
  const counterCollection =
    order.order.collection === "stripe_invoice" ? null : order.order.collection;
  const canVoidCounter =
    counterCollection !== null &&
    order.order.status === "paid" &&
    (await canPersonManageOrders(db, shop.id, session.user.personId));
  // What is left to give back, as a number a person types. Read off the order
  // rather than its total, so a second partial refund offers the remainder
  // instead of re-offering the whole charge (issue #699).
  const refundableMajor = minorToMajor(order.order.amountPaidCents, order.order.currency);
  // Built above the JSX rather than nested in it: `check:copy` reads a ternary
  // chain inside an element as prose, and with the demo branch this one is
  // three deep (same reason `PublicShopChrome`'s address node is hoisted).
  const canOfferRefund =
    canRefund &&
    counterCollection === null &&
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
        eyebrow={t(STAFF_DESTINATION_LABEL_KEYS.orders)}
        eyebrowHref={shopPath(shopSlug, "orders")}
        title={order.person.fullName}
        description={order.order.description || t("orders.detail.fallbackDescription")}
        // A diver who paid at the counter and asks for something on paper.
        actions={<PrintButton label={t("print.sheet.door")} quiet />}
        meta={
          <OrderMeta
            order={order.order}
            personId={order.person.id}
            createdBy={{ name: order.createdBy?.fullName ?? null, online: order.boughtOnline }}
            rentalTicketId={header.rentalTicketId}
            shopSlug={shopSlug}
            locale={locale}
            timezone={timezone}
            t={t}
          />
        }
      />

      {notice === "not-authorized" && banner ? (
        // The one genuinely page-level code: a staffer without refund rights
        // never sees the button that would have answered it.
        <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner>
      ) : null}
      <OrderDisputeBanner dispute={header.dispute} timezone={timezone} locale={locale} t={t} />
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
          <span className={FIGURE_INLINE_CLASS}>
            {formatMoneyCents(order.order.totalCents, order.order.currency, locale)}
          </span>
        </div>

        {counterCollection && order.order.paidAt ? (
          <PaidAtCounterLine
            collection={counterCollection}
            paidAt={order.order.paidAt}
            locale={locale}
            timezone={timezone}
            t={t}
          />
        ) : null}

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

        {/* `items-baseline`: a description is free text, the one thing on
            the row that wraps, and centred the price floated between its two
            lines instead of on the one that names the item (K-575). Both
            sides are `text-sm`, so a one-line row sits as it always did.
            `min-w-0` lets the description shrink below its longest word, so
            `break-words` lets that word break: a SKU or a pasted URL would
            otherwise paint over the price. The price never shrinks. */}
        <ul className="mt-4 divide-y divide-border">
          {order.lineItems.map((item) => (
            <li key={item.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 break-words">
                {item.description}{" "}
                <span className="text-muted">
                  ({KIND_KEYS[item.kind] ? t(KIND_KEYS[item.kind]) : item.kind}
                  {item.quantity > 1 ? ` × ${item.quantity}` : ""})
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
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

        {counterCollection === null && order.order.hostedInvoiceUrl ? (
          <p className="mt-4 text-sm print:hidden">
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

        {/* Off the paper: a printed order is the diver's copy of what they
            paid, and Refresh, Void and Refund are the shop's taps. */}
        <div className="mt-6 flex flex-wrap items-center gap-3 print:hidden">
          {canVoidCounter ? <VoidCounterOrderForm orderId={order.order.id} t={t} /> : null}
          {order.order.status === "open" && counterCollection === null ? (
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
                 lock and Stripe refuses an over-refund behind that.

                 The box is 48px, like every text control, level with the `md`
                 danger button; at 44px it stood 4px below the button's top in
                 this `items-end` row (K-10). Its
                 width is the wrapper's, since `controlClass` already carries
                 `w-full` and two widths resolve by stylesheet order. */
              <form action={refundAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="orderId" value={order.order.id} />
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">
                    {t("orders.detail.refundAmountLabel", {
                      currency: currencySymbol(order.order.currency, locale),
                    })}
                  </span>
                  <span className="w-32">
                    <input
                      type="number"
                      name="amountMajor"
                      inputMode="decimal"
                      min={minorToMajor(1, order.order.currency)}
                      max={refundableMajor}
                      step={minorToMajor(1, order.order.currency)}
                      defaultValue={refundableMajor}
                      className={`${controlClass} tabular-nums`}
                    />
                  </span>
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
        <FormStatus tone={banner?.tone ?? "neutral"} className="mt-2 print:hidden">
          {notice && notice !== "not-authorized"
            ? banner
              ? t(banner.key)
              : t("orders.detail.notice.fallback")
            : undefined}
        </FormStatus>
        {/* Only beside a disabled button it explains: a paid order this
            person cannot refund shows no button, so it gets no reason either. */}
        {demo && (order.order.status === "open" || canOfferRefund) ? (
          <p className="mt-2 text-xs text-muted">{demoActionHint}</p>
        ) : null}
      </SectionCard>
    </main>
  );
}
