import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { canPersonManagePaymentSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { listShopPromoCodes } from "@/db/shop-promos";
import { getShopById } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { nowDate } from "@/lib/clock";
import { formatDateTimeTz } from "@/lib/format";
import { isPromoRedeemable, PROMO_DISCOUNT_MAX, PROMO_DISCOUNT_MIN } from "@/lib/promo-codes";
import { requireStaffSession } from "@/lib/session";
import { createPromoAction, setPromoEnabledAction } from "./actions";

export const metadata: Metadata = {
  title: "Promo codes — DiveDay",
};

const NOTICES: Record<string, { tone: "success" | "danger" | "warning"; text: string }> = {
  created: { tone: "success", text: "Code created and live on your Stripe account." },
  enabled: { tone: "success", text: "Code switched on." },
  disabled: { tone: "success", text: "Code switched off — it stops discounting immediately." },
  invalid: { tone: "danger", text: "Check the code, discount, and dates and try again." },
  invalid_code: {
    tone: "danger",
    text: "A code can use letters, numbers, hyphens, and underscores only.",
  },
  invalid_discount: {
    tone: "danger",
    text: `Pick a discount between ${PROMO_DISCOUNT_MIN}% and ${PROMO_DISCOUNT_MAX}%.`,
  },
  invalid_window: { tone: "danger", text: "The end date has to come after the start date." },
  duplicate: { tone: "danger", text: "You already have a code with that text." },
  not_connected: {
    tone: "warning",
    text: "Connect your Stripe account in Settings first — a code is created on your own account.",
  },
  stripe_failed: {
    tone: "danger",
    text: "Stripe didn't create that code. It's saved as failed here and can't discount anything; try again.",
  },
  not_authorized: {
    tone: "danger",
    text: "Promo codes discount real money, so they're limited to owners and managers.",
  },
};

const SCOPE_LABELS = {
  all: "Trips and courses",
  trips: "Trips only",
  courses: "Courses only",
} as const;

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
  if (!allowed) redirect(`/shop/${shopSlug}/settings?notice=not_authorized`);

  const [shop, promos, stripeAccount] = await Promise.all([
    getShopById(db, session.user.shopId),
    listShopPromoCodes(db, session.user.shopId),
    getShopStripeAccount(db, session.user.shopId),
  ]);
  const connected = canAcceptPayments(stripeAccount);
  const banner = notice ? NOTICES[notice] : undefined;
  const locale = shop?.defaultLocale ?? "en-US";
  const timezone = shop?.timezone ?? "UTC";
  const now = nowDate();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow="Promo codes"
        title="Discounts a diver can type"
        description="A code works across your whole schedule, unlike the one-trip deal you send from a departure's page. DiveDay creates it on your own Stripe account, and Stripe enforces the expiry and the redemption cap when the diver pays."
      />

      {banner ? (
        <div className="mb-6">
          <ShopNotice tone={banner.tone} role={banner.tone === "danger" ? "alert" : "status"}>
            {banner.text}
          </ShopNotice>
        </div>
      ) : null}

      {connected ? null : (
        <div className="mb-6">
          <ShopNotice tone="warning" role="status">
            Connect your Stripe account in{" "}
            <Link href={`/shop/${shopSlug}/settings`} className="font-semibold underline">
              Settings
            </Link>{" "}
            before creating a code — the coupon lives on your account, not DiveDay&apos;s.
          </ShopNotice>
        </div>
      )}

      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="font-medium">New code</h2>
        <p className="mt-1 text-sm text-muted">
          Divers type this at checkout. Leave the dates or the cap empty for no limit.
        </p>
        <FieldGrid as="form" action={createPromoAction} columns={2} className="mt-4">
          <Field label="Code" hint="letters, numbers, - and _">
            <input
              name="code"
              required
              maxLength={40}
              placeholder="REEF20"
              autoComplete="off"
              className={`${controlClass} uppercase`}
            />
          </Field>
          <Field label="Discount" hint="percent off">
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
          <Field label="Good for">
            <select name="scope" defaultValue="all" className={controlClass}>
              {Object.entries(SCOPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Redemption cap" hint="(optional)">
            <input
              name="maxRedemptions"
              type="number"
              min={1}
              placeholder="Unlimited"
              className={controlClass}
            />
          </Field>
          <Field label="Starts" hint="(optional)">
            <input name="startsAt" type="datetime-local" className={controlClass} />
          </Field>
          <Field label="Expires" hint="(optional)">
            <input name="expiresAt" type="datetime-local" className={controlClass} />
          </Field>
          <Field label="What it's for" hint="(optional — your note, never shown to divers)">
            <input
              name="description"
              maxLength={200}
              placeholder="Autumn returning-diver push"
              className={controlClass}
            />
          </Field>
          <FieldActions>
            <SubmitButton pendingLabel="Creating…" className={buttonClass()}>
              Create code
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </section>

      <h2 className="mt-8 font-medium">Your codes</h2>
      {promos.length === 0 ? (
        <EmptyState>
          <h3 className="font-medium">No codes yet</h3>
          <p className="mt-1 text-sm text-muted">
            Create one above, or send a one-trip deal from a departure&apos;s page when a boat needs
            filling.
          </p>
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
                    <span className="text-sm font-medium text-primary tabular-nums">
                      {promo.discountPercent}% off
                    </span>
                    <Badge tone={live ? "success" : "neutral"}>
                      {promo.status === "failed"
                        ? "Failed at Stripe"
                        : promo.status === "pending"
                          ? "Never finished"
                          : live
                            ? "Live"
                            : promo.status === "disabled"
                              ? "Switched off"
                              : "Not live right now"}
                    </Badge>
                  </div>
                  {promo.description ? (
                    <p className="mt-1 text-sm text-muted">{promo.description}</p>
                  ) : null}
                  <p className="mt-2 text-sm text-muted">
                    {SCOPE_LABELS[promo.scope]} ·{" "}
                    {promo.startsAt
                      ? `from ${formatDateTimeTz(promo.startsAt, locale, timezone)}`
                      : "live now"}{" "}
                    ·{" "}
                    {promo.expiresAt
                      ? `until ${formatDateTimeTz(promo.expiresAt, locale, timezone)}`
                      : "no end date"}
                  </p>
                  <p className="mt-1 text-sm text-muted tabular-nums">
                    Redeemed {promo.timesRedeemed}
                    {promo.maxRedemptions === null ? "" : ` of ${promo.maxRedemptions}`} time
                    {promo.timesRedeemed === 1 ? "" : "s"}
                  </p>
                </div>
                {switchable ? (
                  <form action={setPromoEnabledAction} className="shrink-0">
                    <input type="hidden" name="promoId" value={promo.id} />
                    <input type="hidden" name="enable" value={String(promo.status !== "active")} />
                    <SubmitButton
                      pendingLabel="Saving…"
                      className={buttonClass(
                        promo.status === "active"
                          ? { variant: "secondary", className: "text-foreground" }
                          : {},
                      )}
                    >
                      {promo.status === "active" ? "Switch off" : "Switch on"}
                    </SubmitButton>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
