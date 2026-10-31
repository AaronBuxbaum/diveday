import { nowMs } from "./clock";
import { toE164 } from "./phone";
import { canReceiveText, homeNumberingArea } from "./phone-line-type";
import {
  checkRateLimit,
  RATE_LIMITS,
  type RateLimitConfig,
  type RateLimitStore,
  rateLimitKey,
} from "./rate-limit";

/**
 * Why an anonymous registrant's release will not go out by text, or null when
 * it may.
 */
export type AnonymousTextRefusal =
  | "demo_shop"
  | "unreadable_number"
  | "foreign_number"
  /** A `+1` number outside the shop's own NANP country, or in none (issue #2151). */
  | "foreign_area_code";

/**
 * **The one number the counter QR will text, or why not** (issue #2092,
 * security review 2026-10-06).
 *
 * The QR is anonymous, and a text costs the shop money per message, more for a
 * premium international route. Without a gate the form is an SMS-pumping
 * endpoint: type any number, and the shop's sender texts it. So the anonymous
 * path texts only a number in the shop's **own** country (its calling code),
 * read the way the row stores it (`toE164`), and never from a demo shop. A
 * refused number is still stored; the shop can send the release itself.
 *
 * For a `+1` shop the calling code is not enough: it is shared by the US,
 * Canada and the Caribbean, where premium routes live. So the area code must
 * be one of the shop's own country's (`homeNumberingArea`, issue #2151).
 * Staff-initiated texts are not gated here: a person chose that recipient.
 */
export function anonymousTextRecipient(
  phone: string | null | undefined,
  shop: { addressCountry: string | null; isDemo: boolean },
):
  | { recipient: string; refused?: undefined }
  | { recipient?: undefined; refused: AnonymousTextRefusal } {
  if (shop.isDemo) return { refused: "demo_shop" };
  const e164 = toE164(phone, shop.addressCountry);
  if (!e164) return { refused: "unreadable_number" };
  const area = homeNumberingArea(e164, shop.addressCountry);
  if (area === "foreign_code") return { refused: "foreign_number" };
  if (area === "foreign_area_code") return { refused: "foreign_area_code" };
  return { recipient: e164 };
}

/** Whether a counter-QR registration's release goes out, or the code for why not. */
export type SelfRegistrationDelivery =
  | "send"
  | "rate_limited"
  /** The shop's daily text cap is spent: a burst worth a look, logged at warn. */
  | "shop_text_cap"
  | "no_contact"
  /** A home number on a line that is not a mobile: premium, shared-cost, a landline (issue #2289). */
  | "not_mobile"
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
 *   calling code, never a demo shop), then the line type (`canReceiveText`:
 *   a mobile line, never a premium range or a landline, issue #2289), then a
 *   bucket per number in E.164 shared
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
  if (!canReceiveText(text.recipient)) return "not_mobile";
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
