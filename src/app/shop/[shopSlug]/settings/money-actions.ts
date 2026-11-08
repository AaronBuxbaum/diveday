"use server";

import { z } from "zod";
import type { AppDb } from "@/db/client";
import { getShopById, setShopPassThroughFee } from "@/db/shops";
import {
  disconnectShopStripeAccount,
  getShopStripeAccount,
  refreshShopStripeAccountStatus,
} from "@/db/stripe-accounts";
import { trimmedText } from "@/features/form-parse";
import { defineAction, land } from "@/features/server-action";
import { majorToMinor } from "@/lib/money";
import { parsePassThroughFee } from "@/lib/pass-through-fee";
import { connectProviderFromEnvironment } from "@/lib/payments/connect";
import { PAYMENT_SETTINGS_GATE, SETTINGS_AND_PAYMENT_GATES } from "./action-gates";

const passThroughForm = z.object({
  passThroughName: trimmedText(),
  passThroughAmount: trimmedText(),
});

/** Saves the optional per-diver marine-park or conservation pass-through fee. */
export const savePassThroughFeeAction = defineAction({
  gate: [PAYMENT_SETTINGS_GATE],
  input: passThroughForm,
  async run({ db, shopId, path }, { passThroughName: name, passThroughAmount: amount }) {
    const settings = path("settings");
    const extra = { saved: "passThrough" };
    const shop = await getShopById(db, shopId);
    if (!shop) return land(settings, "pass-through-invalid", { extra });
    if (!name && !amount) {
      await setShopPassThroughFee(db, shopId, null);
      return land(settings, "pass-through-saved", { extra });
    }
    const amountCents = majorToMinor(Number(amount), shop.currency);
    const fee = parsePassThroughFee({ name, amountCents });
    if (!fee) return land(settings, "pass-through-invalid", { extra });
    await setShopPassThroughFee(db, shopId, fee);
    return land(settings, "pass-through-saved", { extra });
  },
});

/**
 * A demo shop's Stripe connection is configuration, not a setting (ADR
 * 20261009-demo-test-mode-payments): the canonical demo holds DiveDay's own
 * test-mode account, and anyone can be its owner. Disconnecting would
 * deauthorize that account from the platform for every visitor, and a refresh
 * would read it with the live key. So neither runs on a demo shop.
 */
async function isDemoShop(db: AppDb, shopId: string): Promise<boolean> {
  return (await getShopById(db, shopId))?.isDemo === true;
}

export const disconnectAction = defineAction({
  gate: SETTINGS_AND_PAYMENT_GATES,
  async run({ db, shopId, path }) {
    const settings = path("settings");
    const extra = { saved: "stripe" };
    if (await isDemoShop(db, shopId)) return land(settings, "demo-stripe", { extra });
    const account = await getShopStripeAccount(db, shopId);
    if (account && !account.disconnectedAt) {
      const provider = connectProviderFromEnvironment();
      await provider.deauthorize(account.stripeAccountId);
      await disconnectShopStripeAccount(db, account.stripeAccountId);
    }
    return land(settings, "disconnected", { extra });
  },
});

export const refreshAction = defineAction({
  gate: SETTINGS_AND_PAYMENT_GATES,
  async run({ db, shopId, path }) {
    const settings = path("settings");
    const extra = { saved: "stripe" };
    if (await isDemoShop(db, shopId)) return land(settings, "demo-stripe", { extra });
    const account = await getShopStripeAccount(db, shopId);
    if (account) {
      const provider = connectProviderFromEnvironment();
      const status = await provider.retrieveAccountStatus(account.stripeAccountId);
      await refreshShopStripeAccountStatus(db, account.stripeAccountId, status);
    }
    return land(settings, "refreshed", { extra });
  },
});
