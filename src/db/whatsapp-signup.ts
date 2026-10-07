import {
  type CourtesyTemplateCopy,
  confirmWabaAccess,
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
  getShopWhatsAppRegistration,
  isWhatsAppSetupComplete,
  openRegistrationPin,
  SETUP_INCOMPLETE_TEMPLATE,
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
 * Whether a failed signup may have left the number registered at Meta with the
 * PIN it sent. Subscribe and template come after a register that succeeded; a
 * register that timed out or lost its connection may have completed at Meta
 * after DiveDay stopped listening. A register Meta answered with an error bound
 * nothing.
 */
function registerMayHaveBound(failure: { step: SignupStep; errorCode?: string }): boolean {
  if (failure.step === "subscribe" || failure.step === "template") return true;
  return (
    failure.step === "register" &&
    (failure.errorCode === "timeout" || failure.errorCode === "network_error")
  );
}

/**
 * **Finish an Embedded Signup, in the one order that is safe** (issues #1766
 * and #1769).
 *
 * 1. **Exchange the code** and **read the posted WABA with the token it
 *    returns**, with no lock and no transaction open. Neither changes anything
 *    at Meta. A junk code, or a token whose business cannot see the WABA id
 *    posted beside it, fails here as `signup_failed_exchange` — before anyone
 *    learns whether another DiveDay shop holds that WABA. That is what closes
 *    #1766's existence oracle: the answer now costs access, at Meta, to the
 *    account being asked about.
 * 2. **Claim** the shop and the WABA (`claimWhatsAppWaba`): a Connect already
 *    in flight for either is refused as `signup_busy` without waiting, and a
 *    WABA another shop holds is refused as `waba_already_connected`. Both
 *    refusals happen before any number is registered, so no PIN is minted for
 *    a row that would then be refused.
 * 3. **Under the claim**: register (only a number this shop has not already
 *    finished registering), subscribe, provision the template, and store the
 *    row.
 *
 * **A PIN sent to Meta is never thrown away.** Once register has been tried
 * with a PIN, the number may be bound to it, so a later failure (subscribe,
 * template, or a register that timed out) still stores the row — parked, with
 * the sealed PIN and no template ({@link SETUP_INCOMPLETE_TEMPLATE}), which
 * every reader treats as not connected. The next Connect for the same number
 * sends that stored PIN instead of minting a new one, which Meta would refuse
 * with 133005. Parking replaces whatever row the shop had: a shop moving to a
 * new number has already registered it, and that number's PIN is the one
 * worth keeping.
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
  const access = await confirmWabaAccess(input.wabaId, exchanged.accessToken, fetchImpl);
  if (access.status === "failed") return "signup_failed_exchange";

  const claim = await claimWhatsAppWaba(
    db,
    { shopId: input.shopId, wabaId: input.wabaId },
    async (tx): Promise<WhatsAppSignupOutcome> => {
      // A finished row for this same phone number id means registration
      // already succeeded once, and Meta binds a number to its first PIN — so
      // re-registering with a fresh one fails with a PIN mismatch and walks the
      // number toward a guess lockout. Null tells the signup flow to skip that
      // step and leave the stored PIN alone. A *parked* row for the same number
      // registers again with the PIN it kept.
      const existing = await getShopWhatsAppRegistration(tx, input.shopId);
      const sameNumber = existing?.phoneNumberId === input.phoneNumberId;
      const registrationPin =
        existing && sameNumber
          ? isWhatsAppSetupComplete(existing)
            ? null
            : (openRegistrationPin(existing, deps.sender) ??
              (deps.newPin ?? generateRegistrationPin)())
          : (deps.newPin ?? generateRegistrationPin)();

      const row = {
        shopId: input.shopId,
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId,
        templateLanguage: input.templateLanguage,
        registrationPin,
      };
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
      if (finished.status === "failed") {
        if (registrationPin !== null && registerMayHaveBound(finished)) {
          await connectShopWhatsAppAccount(
            tx,
            {
              ...row,
              accessToken: exchanged.accessToken,
              templateName: SETUP_INCOMPLETE_TEMPLATE,
            },
            deps.sender,
          );
        }
        return `signup_failed_${finished.step}`;
      }

      const stored = await connectShopWhatsAppAccount(
        tx,
        { ...row, accessToken: finished.accessToken, templateName: input.templateName },
        deps.sender,
      );
      return stored.status === "refused" ? stored.reason : "connected";
    },
  );
  if (claim.status === "busy") return "signup_busy";
  if (claim.status === "held_elsewhere") return "waba_already_connected";
  return claim.value;
}
