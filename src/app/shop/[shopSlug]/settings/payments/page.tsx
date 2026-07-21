import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { FlashParams } from "@/components/FlashParams";
import { ShopNotice, ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import { getShopById, setShopContact, setShopPackingList } from "@/db/shops";
import {
  canAcceptPayments,
  disconnectShopStripeAccount,
  getShopStripeAccount,
  refreshShopStripeAccountStatus,
} from "@/db/stripe-accounts";
import { revalidateAndRedirect } from "@/lib/navigation";
import { connectProviderFromEnvironment } from "@/lib/payments/connect";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Shop settings — DiveDay" };

const NOTICE_MESSAGES: Record<string, { tone: "success" | "danger" | "warning"; text: string }> = {
  packing_saved: { tone: "success", text: "Packing checklist saved for every trip." },
  packing_invalid: { tone: "danger", text: "Add between one and twelve packing items." },
  contact_saved: { tone: "success", text: "Contact details saved." },
  contact_invalid: {
    tone: "danger",
    text: "Use a complete email address, or empty the box to take it off your public pages.",
  },
  connected: { tone: "success", text: "Stripe account connected." },
  connect_failed: {
    tone: "danger",
    text: "The Stripe connection didn't complete. Try connecting again.",
  },
  not_configured: {
    tone: "warning",
    text: "Online payments aren't switched on for this DiveDay setup yet. Whoever runs your DiveDay hosting needs to finish the Stripe configuration first.",
  },
  disconnected: { tone: "success", text: "Stripe account disconnected." },
  refreshed: { tone: "success", text: "Payment status refreshed from Stripe." },
};

const contactSchema = z.object({
  // Empty clears the field; anything else must be a real address, because this
  // one is printed on a public page for divers to write to.
  contactEmail: z.union([z.literal(""), z.email().max(200)]),
  contactPhone: z.string().trim().max(40),
});

async function savePackingAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const packingList = String(formData.get("packingList") ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  if (
    packingList.length < 1 ||
    packingList.length > 12 ||
    packingList.some((item) => item.length > 100)
  ) {
    redirect(`/shop/${session.user.shopSlug}/settings/payments?notice=packing_invalid`);
  }
  await setShopPackingList(await getDb(), session.user.shopId, packingList);
  revalidateAndRedirect(
    `/shop/${session.user.shopSlug}/settings/payments`,
    `/shop/${session.user.shopSlug}/settings/payments?notice=packing_saved`,
  );
}

/**
 * The address a diver who is not booking yet writes to. Published, so an empty
 * box is a real answer — it takes the "Get in touch" composer off the shop's
 * course pages rather than publishing a blank contact.
 */
async function saveContactAction(formData: FormData) {
  "use server";
  const session = await requireStaffSession();
  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  const settings = `/shop/${session.user.shopSlug}/settings/payments`;
  if (!parsed.success) redirect(`${settings}?notice=contact_invalid`);
  await setShopContact(await getDb(), session.user.shopId, parsed.data);
  revalidateAndRedirect(settings, `${settings}?notice=contact_saved`);
}

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
  revalidateAndRedirect(
    `/shop/${session.user.shopSlug}/settings/payments`,
    `/shop/${session.user.shopSlug}/settings/payments?notice=disconnected`,
  );
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
  revalidateAndRedirect(
    `/shop/${session.user.shopSlug}/settings/payments`,
    `/shop/${session.user.shopSlug}/settings/payments?notice=refreshed`,
  );
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
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect("/");
  const account = await getShopStripeAccount(db, session.user.shopId);
  const ready = canAcceptPayments(account);
  const connectConfigured = Boolean(
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_CONNECT_CLIENT_ID && process.env.APP_HOST,
  );
  const banner = notice ? NOTICE_MESSAGES[notice] : undefined;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow="Shop"
        title="Shop settings"
        description="One-time and occasional shop configuration lives here, including the Stripe account that receives invoices and payments."
      />

      {banner ? (
        <div className="mb-6">
          <ShopNotice tone={banner.tone} role={banner.tone === "danger" ? "alert" : "status"}>
            {banner.text}
          </ShopNotice>
        </div>
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="font-medium">Public contact details</h2>
        <p className="mt-1 text-sm text-muted">
          Printed on your course pages, where a diver who cannot find a date gets a ready-written
          email to send you. Use a front-desk address the whole team reads, not a personal one.
          Empty the email box to take the form down.
        </p>
        <FieldGrid as="form" action={saveContactAction} columns={2} className="mt-4">
          <Field label="Contact email">
            <input
              name="contactEmail"
              type="email"
              maxLength={200}
              autoComplete="email"
              defaultValue={shop.contactEmail ?? ""}
              placeholder="hello@yourshop.com"
              className={controlClass}
            />
          </Field>
          <Field label="Contact phone" hint="(optional)">
            <input
              name="contactPhone"
              type="tel"
              maxLength={40}
              autoComplete="tel"
              defaultValue={shop.contactPhone ?? ""}
              placeholder="+1 305 555 0134"
              className={controlClass}
            />
          </Field>
          <FieldActions>
            <SubmitButton pendingLabel="Saving…" className={buttonClass()}>
              Save contact details
            </SubmitButton>
          </FieldActions>
        </FieldGrid>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h2 className="font-medium">Trip packing checklist</h2>
        <p className="mt-1 text-sm text-muted">
          One item per line. Divers see this same concise list on every trip.
        </p>
        <form action={savePackingAction} className="mt-4">
          <textarea
            name="packingList"
            rows={6}
            maxLength={1212}
            defaultValue={shop.packingList.join("\n")}
            className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-base"
          />
          <SubmitButton pendingLabel="Saving…" className={buttonClass({ className: "mt-3" })}>
            Save packing checklist
          </SubmitButton>
        </form>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-6">
        {!account ? (
          <div>
            <h2 className="font-medium">No Stripe account connected</h2>
            <p className="mt-1 text-sm text-muted">
              Connect a Stripe account you own — DiveDay never touches your money, and payments for
              orders and invoices go straight into your own Stripe balance.
            </p>
            {connectConfigured ? (
              <Link
                href={`/shop/${shopSlug}/settings/payments/connect`}
                className={buttonClass({ className: "mt-4" })}
              >
                Connect Stripe
              </Link>
            ) : (
              <p className="mt-4 rounded-lg bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
                Online payments aren't switched on for this DiveDay setup yet — ask whoever runs
                your hosting to finish the Stripe configuration.
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
                    className={buttonClass()}
                  >
                    Reconnect Stripe
                  </Link>
                ) : null
              ) : (
                <>
                  <form action={refreshAction}>
                    <SubmitButton
                      pendingLabel="Refreshing…"
                      className={buttonClass({
                        variant: "secondary",
                        className: "text-foreground",
                      })}
                    >
                      Refresh status
                    </SubmitButton>
                  </form>
                  <form action={disconnectAction}>
                    <SubmitButton
                      pendingLabel="Disconnecting…"
                      className={buttonClass({ variant: "danger" })}
                    >
                      Disconnect
                    </SubmitButton>
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
