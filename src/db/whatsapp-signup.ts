import {
  type CourtesyTemplateCopy,
  exchangeSignupCode,
  finishEmbeddedSignup,
  generateRegistrationPin,
  type SignupStep,
  type WhatsAppSignupConfig,
} from "@/lib/notifications/whatsapp-signup";
import type { AppDb } from "./client";
import {
  claimWhatsAppWaba,
  connectShopWhatsAppAccount,
  getShopWhatsAppAccount,
  type WhatsAppConnectRefusal,
  type WhatsAppSenderOptions,
} from "./whatsapp-accounts";

export type WhatsAppSignupInput = {
  shopId: string;
  /** Meta's one-time authorization code, from the Embedded Signup popup. */
  code: string;
  wabaId: string;
  phoneNumberId: string;
  templateName: string;
  templateLanguage: string;
  templateCopy: CourtesyTemplateCopy;
};

/** How a Connect ended, as a code; the settings page picks the words. */
export type WhatsAppSignupOutcome =
  | "connected"
  | "signup_busy"
  | `signup_failed_${SignupStep}`
  | WhatsAppConnectRefusal;

export type WhatsAppSignupDeps = {
  fetchImpl?: typeof fetch;
  /** Injectable so tests can see whether a PIN was ever minted. */
  newPin?: () => string;
  sender?: WhatsAppSenderOptions;
};

/**
 * **Finish an Embedded Signup, in the one order that is safe** (issues #1766
 * and #1769).
 *
 * 1. **Exchange the code**, with no lock and no transaction open. It changes
 *    nothing at Meta, so there is nothing to serialize, and a junk code fails
 *    here — before anyone learns whether another DiveDay shop holds the WABA.
 *    That ordering is what closes #1766's existence oracle: the answer now
 *    costs a valid Meta authorization code for that account.
 * 2. **Claim** the shop and the WABA (`claimWhatsAppWaba`): a Connect already
 *    in flight for either is refused as `signup_busy` without waiting, and a
 *    WABA another shop holds is refused as `waba_already_connected`. Both
 *    refusals happen before any number is registered, so no PIN is minted for
 *    a row that would then be refused.
 * 3. **Under the claim**: register (only a number this shop has not already
 *    registered), subscribe, provision the template, and store the row.
 */
export async function completeWhatsAppSignup(
  db: AppDb,
  input: WhatsAppSignupInput,
  config: WhatsAppSignupConfig,
  deps: WhatsAppSignupDeps = {},
): Promise<WhatsAppSignupOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const exchanged = await exchangeSignupCode(input.code, config, fetchImpl);
  if (exchanged.status === "failed") return "signup_failed_exchange";

  const claim = await claimWhatsAppWaba(
    db,
    { shopId: input.shopId, wabaId: input.wabaId },
    async (tx): Promise<WhatsAppSignupOutcome> => {
      // Register only a number DiveDay has not registered before. A stored row
      // for this same phone number id means registration already succeeded
      // once, and Meta binds a number to its first PIN — so re-registering
      // with a fresh one fails with a PIN mismatch and walks the number toward
      // a guess lockout. Null tells the signup flow to skip that step and leave
      // the stored PIN alone.
      const existing = await getShopWhatsAppAccount(tx, input.shopId);
      const alreadyRegistered = existing?.phoneNumberId === input.phoneNumberId;
      const registrationPin = alreadyRegistered ? null : (deps.newPin ?? generateRegistrationPin)();

      const finished = await finishEmbeddedSignup(
        {
          wabaId: input.wabaId,
          phoneNumberId: input.phoneNumberId,
          templateName: input.templateName,
          templateLanguage: input.templateLanguage,
          templateCopy: input.templateCopy,
          registrationPin,
          accessToken: exchanged.accessToken,
        },
        fetchImpl,
      );
      if (finished.status === "failed") return `signup_failed_${finished.step}`;

      const stored = await connectShopWhatsAppAccount(
        tx,
        {
          shopId: input.shopId,
          phoneNumberId: input.phoneNumberId,
          wabaId: input.wabaId,
          accessToken: finished.accessToken,
          templateName: input.templateName,
          templateLanguage: input.templateLanguage,
          registrationPin,
        },
        deps.sender,
      );
      return stored.status === "refused" ? stored.reason : "connected";
    },
  );
  if (claim.status === "busy") return "signup_busy";
  if (claim.status === "held_elsewhere") return "waba_already_connected";
  return claim.value;
}
