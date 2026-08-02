import { eq, inArray } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { CourtesyProvider } from "@/lib/notifications/courtesy";
import {
  type WhatsAppCredentials,
  type WhatsAppProviderOptions,
  whatsAppProvider,
} from "@/lib/notifications/whatsapp";
import {
  openSecret,
  type SecretKey,
  sealSecret,
  secretHint,
  secretKeyFromEnvironment,
} from "@/lib/secret-box";
import type { DbExecutor } from "./client";
import type { ShopWhatsappAccount } from "./schema";
import { shopWhatsappAccounts } from "./schema";

/**
 * The store behind a shop's own WhatsApp sender (docs ADR
 * 20260802-whatsapp-cloud-api-per-shop).
 *
 * Its whole job is to keep the shop's Meta access token sealed everywhere
 * except the instant a message is sent. Nothing here ever returns the plaintext
 * token to a caller — the only way out of this module is a ready-made
 * {@link CourtesyProvider} that has already closed over it. A settings page
 * that could read the token back would put it in a server response, a log line,
 * and eventually a screenshot.
 *
 * Returns codes, never sentences; the UI picks the words (ADR
 * 20260731-domain-layer-copy-leaks).
 */

export type WhatsAppKeyRefusal = "encryption_key_unset" | "encryption_key_invalid";

export type ConnectWhatsAppInput = {
  shopId: string;
  phoneNumberId: string;
  /** Plaintext, straight from the staff form; sealed before it reaches a column. */
  accessToken: string;
  templateName: string;
  templateLanguage: string;
  displayPhoneNumber?: string | null;
  wabaId?: string | null;
  /** Sealed alongside the token; needed only to re-register the number with Meta. */
  registrationPin?: string | null;
  now?: Date;
};

export type ConnectWhatsAppResult =
  | { status: "connected"; account: ShopWhatsappAccount }
  | { status: "refused"; reason: WhatsAppKeyRefusal };

/** Options exist so tests can supply a key and a fake fetch without touching the environment. */
export type WhatsAppSenderOptions = {
  key?: SecretKey | null;
  fetchImpl?: typeof fetch;
  providerOptions?: WhatsAppProviderOptions;
};

/**
 * The sealing key, or the reason there isn't one. A missing key is a refusal
 * rather than a silent no-op: a shop pressing "Connect" deserves to be told
 * that DiveDay is not configured to hold a credential safely, instead of
 * watching the form appear to succeed and the channel never work.
 */
function resolveKey(options: WhatsAppSenderOptions): SecretKey | WhatsAppKeyRefusal {
  if (options.key) return options.key;
  if (options.key === null) return "encryption_key_unset";
  const result = secretKeyFromEnvironment();
  if (result.status === "ok") return result.key;
  return result.status === "unset" ? "encryption_key_unset" : "encryption_key_invalid";
}

export async function getShopWhatsAppAccount(
  db: DbExecutor,
  shopId: string,
): Promise<ShopWhatsappAccount | null> {
  const [row] = await db
    .select()
    .from(shopWhatsappAccounts)
    .where(eq(shopWhatsappAccounts.shopId, shopId))
    .limit(1);
  return row ?? null;
}

/**
 * Connect (or re-connect) a shop's WhatsApp sender. Upsert rather than
 * insert-or-fail: rotating a token or fixing a mistyped template name is the
 * same gesture as connecting for the first time, and forcing a disconnect in
 * between would blank the channel for no reason.
 */
export async function connectShopWhatsAppAccount(
  db: DbExecutor,
  input: ConnectWhatsAppInput,
  options: WhatsAppSenderOptions = {},
): Promise<ConnectWhatsAppResult> {
  const key = resolveKey(options);
  if (typeof key === "string") return { status: "refused", reason: key };

  const now = input.now ?? nowDate();
  const values = {
    shopId: input.shopId,
    phoneNumberId: input.phoneNumberId.trim(),
    displayPhoneNumber: input.displayPhoneNumber?.trim() || null,
    wabaId: input.wabaId?.trim() || null,
    accessTokenSealed: sealSecret(input.accessToken.trim(), key),
    accessTokenHint: secretHint(input.accessToken),
    registrationPinSealed: input.registrationPin
      ? sealSecret(input.registrationPin.trim(), key)
      : null,
    templateName: input.templateName.trim(),
    templateLanguage: input.templateLanguage.trim(),
    updatedAt: now,
  };
  const [account] = await db
    .insert(shopWhatsappAccounts)
    .values({ ...values, connectedAt: now })
    .onConflictDoUpdate({
      target: shopWhatsappAccounts.shopId,
      // `connectedAt` deliberately survives a re-connect — it is when this shop
      // first switched WhatsApp on, not when it last rotated a token.
      // `verifiedAt` deliberately does not: new credentials are unproven until
      // a fresh test send proves them.
      set: { ...values, verifiedAt: null },
    })
    .returning();
  return { status: "connected", account };
}

/** Disconnect by deleting the row — holding a live credential a shop revoked serves nobody. */
export async function disconnectShopWhatsAppAccount(
  db: DbExecutor,
  shopId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(shopWhatsappAccounts)
    .where(eq(shopWhatsappAccounts.shopId, shopId))
    .returning({ shopId: shopWhatsappAccounts.shopId });
  return deleted.length > 0;
}

/** Record that a test send actually reached Meta, so staff see proven rather than merely saved. */
export async function markShopWhatsAppVerified(
  db: DbExecutor,
  shopId: string,
  now: Date = nowDate(),
): Promise<void> {
  await db
    .update(shopWhatsappAccounts)
    .set({ verifiedAt: now, updatedAt: now })
    .where(eq(shopWhatsappAccounts.shopId, shopId));
}

/**
 * A sender for one stored row, or null when the credential cannot be opened —
 * no key configured, or a key that no longer matches what sealed this row.
 *
 * Null rather than a throw, because every caller's honest response is the same:
 * this shop has no usable WhatsApp, so use SMS. A key rotated without
 * re-sealing takes the channel down to SMS instead of taking the reminder cron
 * down with it.
 */
export function whatsAppProviderForAccount(
  account: ShopWhatsappAccount,
  options: WhatsAppSenderOptions = {},
): CourtesyProvider | null {
  const key = resolveKey(options);
  if (typeof key === "string") return null;
  const accessToken = openSecret(account.accessTokenSealed, key);
  if (!accessToken) return null;
  const credentials: WhatsAppCredentials = {
    phoneNumberId: account.phoneNumberId,
    accessToken,
    templateName: account.templateName,
    templateLanguage: account.templateLanguage,
  };
  return whatsAppProvider(credentials, options.fetchImpl ?? fetch, options.providerOptions);
}

export async function whatsAppProviderForShop(
  db: DbExecutor,
  shopId: string,
  options: WhatsAppSenderOptions = {},
): Promise<CourtesyProvider | null> {
  const account = await getShopWhatsAppAccount(db, shopId);
  return account ? whatsAppProviderForAccount(account, options) : null;
}

/**
 * Senders for many shops at once, keyed by shop id.
 *
 * The reminder and recap crons scan every shop in one pass, so resolving a
 * sender per booking would be an N+1 against a table that fits in one query.
 * Shops with no row (or an unopenable one) are simply absent from the map,
 * which is exactly what `sendCourtesyMessage` reads as "not connected".
 */
export async function whatsAppProvidersForShops(
  db: DbExecutor,
  shopIds: readonly string[],
  options: WhatsAppSenderOptions = {},
): Promise<Map<string, CourtesyProvider>> {
  const senders = new Map<string, CourtesyProvider>();
  const unique = [...new Set(shopIds)];
  if (unique.length === 0) return senders;
  const rows = await db
    .select()
    .from(shopWhatsappAccounts)
    .where(inArray(shopWhatsappAccounts.shopId, unique));
  for (const row of rows) {
    const provider = whatsAppProviderForAccount(row, options);
    if (provider) senders.set(row.shopId, provider);
  }
  return senders;
}
