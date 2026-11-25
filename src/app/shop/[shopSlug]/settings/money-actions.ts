"use server";

import { z } from "zod";
import type { AppDb } from "@/db/client";
import { getShopById, setShopBuddyCredit, setShopPassThroughFee } from "@/db/shops";
import {
  disconnectShopStripeAccount,
  getShopStripeAccount,
  refreshShopStripeAccountStatus,
} from "@/db/stripe-accounts";
import { trimmedText } from "@/features/platform/form-parse";
import { defineAction, land } from "@/features/platform/server-action";
import { majorToMinor } from "@/lib/money";
import { parsePassThroughFee } from "@/lib/pass-through-fee";
import { connectProviderFromEnvironment } from "@/lib/payments/connect";
import { validBuddyCreditCents } from "@/lib/trip-credit";
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
 * Saves the trip credit a diver earns once a friend who booked on their
 * Bring a buddy link has dived (issue #4260). Blank is zero, which gives none.
 */
export const saveBuddyCreditAction = defineAction({
  gate: [PAYMENT_SETTINGS_GATE],
  input: z.object({ buddyCreditAmount: trimmedText() }),
  async run({ db, shopId, path }, { buddyCreditAmount: amount }) {
    const settings = path("settings");
    const extra = { saved: "buddyCredit" };
    const shop = await getShopById(db, shopId);
    const major = amount ? Number(amount) : 0;
    const cents = shop && Number.isFinite(major) ? majorToMinor(major, shop.currency) : Number.NaN;
    if (!shop || !validBuddyCreditCents(cents))
      return land(settings, "buddy-credit-invalid", { extra });
    await setShopBuddyCredit(db, shopId, cents);
    return land(settings, "buddy-credit-saved", { extra });
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
