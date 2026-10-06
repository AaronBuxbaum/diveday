import { nowMs } from "./clock";
import {
  checkRateLimit,
  RATE_LIMITS,
  type RateLimitConfig,
  type RateLimitStore,
  rateLimitKey,
} from "./rate-limit";
import { type AnonymousTextRefusal, anonymousTextRecipient } from "./self-registration";

/** Whether a counter-QR registration's release goes out, or the code for why not. */
export type SelfRegistrationDelivery =
  | "send"
  | "rate_limited"
  /** The shop's daily text cap is spent: a burst worth a look, logged at warn. */
  | "shop_text_cap"
  | "no_contact"
  | AnonymousTextRefusal;

/**
 * **Whether the counter QR sends this registrant their release** (issues #1236,
 * #2092; security review 2026-10-06).
 *
 * Every answer but `"send"` drops the send and keeps the registration: the
 * diver is on file either way, and the shop can send the release itself. The
 * codes are what the action logs, beside the shop id and nothing else.
 *
 * - **Email**: one bucket per address, scoped to the shop, so the QR cannot be
 *   pointed at a stranger's inbox.
 * - **Text**, for a diver who gave only a phone: billed to the shop per
 *   message, so first the gate (`anonymousTextRecipient`: the shop's own
 *   calling code, never a demo shop), then a bucket per number in E.164 shared
 *   by every shop, then the shop's daily cap. The number is checked before the
 *   shop, so a number already refused never spends one of the shop's texts.
 */
export async function selfRegistrationReleaseDelivery(
  shop: { id: string; addressCountry: string | null; isDemo: boolean },
  contact: { email: string | null; phone: string | null },
  options: { now?: number; store?: RateLimitStore } = {},
): Promise<SelfRegistrationDelivery> {
  const now = options.now ?? nowMs();
  // An undefined store falls through to `checkRateLimit`'s own default.
  const take = (key: string, config: RateLimitConfig) =>
    checkRateLimit(key, config, now, options.store);

  if (contact.email) {
    const result = await take(
      rateLimitKey("self-register-email", shop.id, contact.email),
      RATE_LIMITS.selfRegisterEmailByRecipient,
    );
    return result.allowed ? "send" : "rate_limited";
  }
  if (!contact.phone?.trim()) return "no_contact";

  const text = anonymousTextRecipient(contact.phone, shop);
  if (text.refused) return text.refused;
  const byNumber = await take(
    rateLimitKey("self-register-text", text.recipient),
    RATE_LIMITS.selfRegisterTextByRecipient,
  );
  if (!byNumber.allowed) return "rate_limited";
  const byShop = await take(
    rateLimitKey("self-register-text-shop", shop.id),
    RATE_LIMITS.selfRegisterTextByShop,
  );
  return byShop.allowed ? "send" : "shop_text_cap";
}
