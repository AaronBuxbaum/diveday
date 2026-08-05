import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import { canPersonRefund } from "@/db/authz";
import { getDb } from "@/db/client";
import { getOrder, refreshOrderStatus, refundOrder, voidOrder } from "@/db/orders";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatMoneyCents, formatShortDate } from "@/lib/format";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Order — DiveDay" };

const STATUS_KEYS: Record<string, StaffMessageKey> = {
  open: "orders.detail.status.open",
  paid: "orders.detail.status.paid",
  void: "orders.detail.status.void",
  uncollectible: "orders.detail.status.uncollectible",
  refunded: "orders.detail.status.refunded",
};

const STATUS_TONES: Record<string, BadgeTone> = {
  paid: "success",
  open: "primary",
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

async function refreshAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const orderId = String(formData.get("orderId") ?? "");
  const db = await getDb();
  const back = `/shop/${session.user.shopSlug}/orders/${orderId}`;
  if (await isDemoShop(db, session.user.shopId)) {
    revalidateAndRedirect(back, `${back}?notice=demo_disabled`);
    return;
  }
  const updated = orderId ? await refreshOrderStatus(db, session.user.shopId, orderId) : null;
  revalidateAndRedirect(back, `${back}?notice=${updated ? "refreshed" : "refresh_failed"}`);
}

async function voidAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const orderId = String(formData.get("orderId") ?? "");
  const db = await getDb();
  const back = `/shop/${session.user.shopSlug}/orders/${orderId}`;
  if (await isDemoShop(db, session.user.shopId)) {
    revalidateAndRedirect(back, `${back}?notice=demo_disabled`);
    return;
  }
  const updated = orderId ? await voidOrder(db, session.user.shopId, orderId) : null;
  revalidateAndRedirect(back, `${back}?notice=${updated ? "voided" : "void_failed"}`);
}

async function refundAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const orderId = String(formData.get("orderId") ?? "");
  const db = await getDb();
  const back = `/shop/${session.user.shopSlug}/orders/${orderId}`;
  // Money leaving the account is owner/manager work, re-checked against live
  // roles (H-14, ADR 20260724-role-authorization).
  if (!(await canPersonRefund(db, session.user.shopId, session.user.personId))) {
    revalidateAndRedirect(back, `${back}?notice=not_authorized`);
    return;
  }
  if (await isDemoShop(db, session.user.shopId)) {
    revalidateAndRedirect(back, `${back}?notice=demo_disabled`);
    return;
  }
  const updated = orderId ? await refundOrder(db, session.user.shopId, orderId) : null;
  revalidateAndRedirect(back, `${back}?notice=${updated ? "refunded" : "refund_failed"}`);
}

// A notice query param maps to a message key, never to a sentence — the words
// come from the staff bundle at render time (docs ADR 20260730-staff-copy-localization).
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  refreshed: { tone: "success", key: "orders.detail.notice.refreshed" },
  refresh_failed: { tone: "danger", key: "orders.detail.notice.refreshFailed" },
  voided: { tone: "success", key: "orders.detail.notice.voided" },
  void_failed: { tone: "danger", key: "orders.detail.notice.voidFailed" },
  refunded: { tone: "success", key: "orders.detail.notice.refunded" },
  refund_failed: { tone: "danger", key: "orders.detail.notice.refundFailed" },
  not_authorized: { tone: "danger", key: "orders.detail.notice.notAuthorized" },
  demo_disabled: { tone: "neutral", key: "orders.detail.notice.demoDisabled" },
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
        className: `cursor-not-allowed opacity-50${variant === "secondary" ? " text-foreground" : ""}`,
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
  const session = await requireStaffSession();
  const { shopSlug, id } = await params;
  const { notice } = await searchParams;
  const db = await getDb();
  const order = await getOrder(db, session.user.shopId, id);
  if (!order) notFound();
  // One shop read for both the demo guard and the timezone the order's date is
  // written in — a money screen should say "3 Aug" in the shop's own day, not
  // the server's.
  const shop = await getShopById(db, session.user.shopId);
  const demo = shop?.isDemo ?? false;
  const timezone = shop?.timezone ?? "UTC";
  // Refunds are owner/manager only (H-14, ADR 20260724-role-authorization);
  // hide the control from other staff. refundAction re-checks regardless.
  const canRefund = await canPersonRefund(db, session.user.shopId, session.user.personId);
  const locale = await requestLocale(shop?.defaultLocale);
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
              className={buttonClass({ variant: "secondary", className: "text-foreground" })}
            >
              {t("orders.detail.backToOrders")}
            </Link>
            <Link
              href={`/shop/${shopSlug}/divers/${order.person.id}`}
              className={buttonClass({ variant: "secondary", className: "text-foreground" })}
            >
              {t("orders.detail.backToDiver")}
            </Link>
          </>
        }
      />

      {notice === "not_authorized" && banner ? (
        // The one genuinely page-level code: a staffer without refund rights
        // never sees the button that would have answered it.
        <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner>
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center justify-between gap-3">
          <Badge tone={STATUS_TONES[order.order.status] ?? "neutral"}>
            {STATUS_KEYS[order.order.status]
              ? t(STATUS_KEYS[order.order.status])
              : order.order.status}
          </Badge>
          <span className="text-lg font-semibold tabular-nums">
            {formatMoneyCents(order.order.totalCents, order.order.currency, locale)}
          </span>
        </div>

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
                    className={buttonClass({ variant: "secondary", className: "text-foreground" })}
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
          {canRefund && order.order.status === "paid" ? (
            demo ? (
              <DisabledDemoButton
                label={t("orders.detail.refundPayment")}
                hint={demoActionHint}
                variant="danger"
              />
            ) : (
              <form action={refundAction}>
                <input type="hidden" name="orderId" value={order.order.id} />
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
          {notice && notice !== "not_authorized"
            ? banner
              ? t(banner.key)
              : t("orders.detail.notice.fallback")
            : undefined}
        </FormStatus>
        {demo && (order.order.status === "open" || order.order.status === "paid") ? (
          <p className="mt-2 text-xs text-muted">{demoActionHint}</p>
        ) : null}
      </section>
    </main>
  );
}
