import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { getDb } from "@/db/client";
import {
  canAcceptPayments,
  disconnectShopStripeAccount,
  getShopStripeAccount,
  refreshShopStripeAccountStatus,
} from "@/db/stripe-accounts";
import { connectProviderFromEnvironment } from "@/lib/payments/connect";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Payments — Scuba" };

const NOTICES: Record<string, { tone: "success" | "danger" | "warning"; text: string }> = {
  connected: { tone: "success", text: "Stripe account connected." },
  connect_failed: {
    tone: "danger",
    text: "The Stripe connection didn't complete. Try connecting again.",
  },
  not_configured: {
    tone: "warning",
    text: "Stripe Connect isn't configured yet — an operator needs to set STRIPE_SECRET_KEY, STRIPE_CONNECT_CLIENT_ID, and APP_HOST.",
  },
  disconnected: { tone: "success", text: "Stripe account disconnected." },
  refreshed: { tone: "success", text: "Payment status refreshed from Stripe." },
};

async function disconnectAction() {
  "use server";
  const session = await requireStaffSession();
  const db = await getDb();
  const account = await getShopStripeAccount(db, session.user.shopId);
  if (account && !account.disconnectedAt) {
    const provider = connectProviderFromEnvironment();
    await provider.deauthorize(account.stripeAccountId);
    await disconnectShopStripeAccount(db, account.stripeAccountId);
  }
  redirect(`/shop/${session.user.shopSlug}/settings/payments?notice=disconnected`);
}

async function refreshAction() {
  "use server";
  const session = await requireStaffSession();
  const db = await getDb();
  const account = await getShopStripeAccount(db, session.user.shopId);
  if (account) {
    const provider = connectProviderFromEnvironment();
    const status = await provider.retrieveAccountStatus(account.stripeAccountId);
    await refreshShopStripeAccountStatus(db, account.stripeAccountId, status);
  }
  redirect(`/shop/${session.user.shopSlug}/settings/payments?notice=refreshed`);
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span>{label}</span>
      <span
        className={
          ok
            ? "inline-block rounded-full bg-success/10 px-3 py-1 font-medium text-success"
            : "inline-block rounded-full bg-warning/10 px-3 py-1 font-medium text-warning"
        }
      >
        {ok ? "Yes" : "Not yet"}
      </span>
    </li>
  );
}

export default async function PaymentsSettingsPage({
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
  const account = await getShopStripeAccount(db, session.user.shopId);
  const ready = canAcceptPayments(account);
  const connectConfigured = Boolean(
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_CONNECT_CLIENT_ID && process.env.APP_HOST,
  );
  const banner = notice ? NOTICES[notice] : undefined;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-16">
      <FlashParams params={["notice"]} />
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-widest text-primary uppercase">Settings</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Payments</h1>
          <p className="mt-1 text-muted">
            Connect your own Stripe account so orders and invoices are paid straight into it.
          </p>
        </div>
        <Link
          href={`/shop/${shopSlug}`}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
        >
          Back
        </Link>
      </div>

      {banner ? (
        <p
          role="status"
          className={`mb-6 rounded-lg px-4 py-3 text-sm font-medium ${
            banner.tone === "success"
              ? "bg-success/10 text-success"
              : banner.tone === "danger"
                ? "bg-danger/10 text-danger"
                : "bg-warning/10 text-warning"
          }`}
        >
          {banner.text}
        </p>
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-6">
        {!account ? (
          <div>
            <h2 className="font-medium">No Stripe account connected</h2>
            <p className="mt-1 text-sm text-muted">
              Connect a Stripe account you own — Scuba never touches your money, and payments for
              orders and invoices go straight into your own Stripe balance.
            </p>
            {connectConfigured ? (
              <Link
                href={`/shop/${shopSlug}/settings/payments/connect`}
                className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
              >
                Connect Stripe
              </Link>
            ) : (
              <p className="mt-4 rounded-lg bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
                Stripe Connect isn't configured for this environment yet.
              </p>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-medium">
                {account.disconnectedAt
                  ? "Stripe account disconnected"
                  : "Stripe account connected"}
              </h2>
              <span
                className={
                  ready
                    ? "inline-block rounded-full bg-success/10 px-3 py-1 text-sm font-medium text-success"
                    : "inline-block rounded-full bg-warning/10 px-3 py-1 text-sm font-medium text-warning"
                }
              >
                {ready ? "Ready for payments" : "Not ready yet"}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">
              Account ending in {account.stripeAccountId.slice(-6)}
            </p>
            <ul className="mt-4 divide-y divide-border">
              <StatusRow label="Charges enabled" ok={account.chargesEnabled} />
              <StatusRow label="Payouts enabled" ok={account.payoutsEnabled} />
              <StatusRow label="Onboarding details submitted" ok={account.detailsSubmitted} />
            </ul>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {account.disconnectedAt ? (
                connectConfigured ? (
                  <Link
                    href={`/shop/${shopSlug}/settings/payments/connect`}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover"
                  >
                    Reconnect Stripe
                  </Link>
                ) : null
              ) : (
                <>
                  <form action={refreshAction}>
                    <button
                      type="submit"
                      className="min-h-11 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition-colors duration-200 hover:bg-surface-sunken"
                    >
                      Refresh status
                    </button>
                  </form>
                  <form action={disconnectAction}>
                    <button
                      type="submit"
                      className="min-h-11 rounded-lg border border-danger/40 bg-surface px-4 py-2 text-sm font-medium text-danger transition-colors duration-200 hover:bg-danger/10"
                    >
                      Disconnect
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
