"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getShopById, setShopPassThroughFee, setShopTaxEnabled } from "@/db/shops";
import {
  disconnectShopStripeAccount,
  getShopStripeAccount,
  refreshShopStripeAccountStatus,
} from "@/db/stripe-accounts";
import { majorToMinor, maxPriceMajor } from "@/lib/money";
import { revalidateAndRedirect } from "@/lib/navigation";
import { parsePassThroughFee } from "@/lib/pass-through-fee";
import { connectProviderFromEnvironment } from "@/lib/payments/connect";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { paymentSettingsBlock, settingsBlock } from "./action-helpers";

/** Saves the owner/manager's opt-in for Stripe Tax on future payments. */
export async function saveTaxAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await paymentSettingsBlock(session);
  const value = formData.get("taxEnabled");
  if (value !== null && value !== "on") {
    redirect(noticeUrl(settings, "tax-invalid", { saved: "tax" }));
  }
  await setShopTaxEnabled(await getDb(), session.user.shopId, value === "on");
  revalidateAndRedirect(settings, noticeUrl(settings, "tax-saved", { saved: "tax" }));
}

/** Saves the optional per-diver marine-park or conservation pass-through fee. */
export async function savePassThroughFeeAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await paymentSettingsBlock(session);
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  const name = String(formData.get("passThroughName") ?? "").trim();
  const amount = String(formData.get("passThroughAmount") ?? "").trim();
  if (!shop) redirect(noticeUrl(settings, "pass-through-invalid", { saved: "passThrough" }));
  if (!name && !amount) {
    await setShopPassThroughFee(db, session.user.shopId, null);
    revalidateAndRedirect(
      settings,
      noticeUrl(settings, "pass-through-saved", { saved: "passThrough" }),
    );
  }
  const parsedAmount = Number(amount);
  const amountCents = majorToMinor(parsedAmount, shop.currency);
  if (
    !name ||
    !Number.isFinite(parsedAmount) ||
    parsedAmount <= 0 ||
    parsedAmount > maxPriceMajor(shop.currency) ||
    !parsePassThroughFee({ name, amountCents })
  ) {
    redirect(noticeUrl(settings, "pass-through-invalid", { saved: "passThrough" }));
  }
  await setShopPassThroughFee(db, session.user.shopId, {
    name: name.slice(0, 120),
    amountCents,
  });
  revalidateAndRedirect(
    settings,
    noticeUrl(settings, "pass-through-saved", { saved: "passThrough" }),
  );
}

/**
 * A demo shop's Stripe connection is configuration, not a setting (ADR
 * 20261009-demo-test-mode-payments): the canonical demo holds DiveDay's own
 * test-mode account, and anyone can be its owner. Disconnecting would
 * deauthorize that account from the platform for every visitor, and a refresh
 * would read it with the live key. So neither runs on a demo shop.
 */
async function demoStripeBlock(
  db: Awaited<ReturnType<typeof getDb>>,
  session: { user: { shopId: string; shopSlug: string } },
): Promise<void> {
  const shop = await getShopById(db, session.user.shopId);
  if (!shop?.isDemo) return;
  const settings = shopPath(session.user.shopSlug, "settings");
  revalidateAndRedirect(settings, noticeUrl(settings, "demo-stripe", { saved: "stripe" }));
}

export async function disconnectAction() {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  await paymentSettingsBlock(session);
  const db = await getDb();
  await demoStripeBlock(db, session);
  const account = await getShopStripeAccount(db, session.user.shopId);
  if (account && !account.disconnectedAt) {
    const provider = connectProviderFromEnvironment();
    await provider.deauthorize(account.stripeAccountId);
    await disconnectShopStripeAccount(db, account.stripeAccountId);
  }
  revalidateAndRedirect(settings, noticeUrl(settings, "disconnected", { saved: "stripe" }));
}

export async function refreshAction() {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);
  await paymentSettingsBlock(session);
  const db = await getDb();
  await demoStripeBlock(db, session);
  const account = await getShopStripeAccount(db, session.user.shopId);
  if (account) {
    const provider = connectProviderFromEnvironment();
    const status = await provider.retrieveAccountStatus(account.stripeAccountId);
    await refreshShopStripeAccountStatus(db, account.stripeAccountId, status);
  }
  revalidateAndRedirect(settings, noticeUrl(settings, "refreshed", { saved: "stripe" }));
}
