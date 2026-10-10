import { and, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import type { CourtesyProvider } from "@/lib/notifications/courtesy";
import {
  type WhatsAppCredentials,
  type WhatsAppProviderOptions,
  type WhatsAppTextSender,
  whatsAppProvider,
  whatsAppTextSender,
} from "@/lib/notifications/whatsapp";
import { openSecret, type SecretKey, sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import type { AppDb, DbExecutor } from "./client";
import { violatesUniqueIndex } from "./query-helpers";
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

/**
 * Why a connection was not stored. The key refusals are about DiveDay's own
 * configuration; `waba_already_connected` is about another shop — the WABA this
 * one is trying to claim is the tenant key inbound events are routed on, and one
 * WABA resolves to one shop or to none (see {@link shopIdForWhatsAppWaba}).
 */
export type WhatsAppConnectRefusal = WhatsAppKeyRefusal | "waba_already_connected";

/**
 * The unique index that makes a WABA resolve to one shop; named so its 23505 can be told apart.
 *
 * It keeps the table right and nothing else: a Connect it refuses has already
 * registered a number at Meta. The signup runs under {@link claimWhatsAppWaba}'s
 * advisory lock on the WABA, whose scope is stated there (issue #1769).
 */
const WABA_UNIQUE_INDEX = "shop_whatsapp_accounts_waba_unique";

export type ConnectWhatsAppInput = {
  shopId: string;
  phoneNumberId: string;
  /** Plaintext, straight from the staff form; sealed before it reaches a column. */
  accessToken: string;
  templateName: string;
  templateLanguage: string;
  displayPhoneNumber?: string | null;
  wabaId?: string | null;
  /**
   * Sealed alongside the token; needed only to re-register the number with Meta.
   * Omit (or null) on a reconnect — the stored PIN is then left exactly as it
   * was, because it is the only copy of the value the number is bound to.
   */
  registrationPin?: string | null;
  now?: Date;
};

export type ConnectWhatsAppResult =
  | { status: "connected"; account: ShopWhatsappAccount }
  | { status: "refused"; reason: WhatsAppConnectRefusal };

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

/**
 * **The `template_name` of a row whose signup stopped after registering the
 * number** (issue #1769, security re-review).
 *
 * Once Meta's register call has been made, the number may be bound to the PIN
 * it carried, so that PIN must be kept even if subscribe or the template then
 * fails — otherwise the next Connect mints a fresh one and Meta answers 133005.
 * Such a row is *parked*: it holds the sealed PIN and claims the WABA, and every
 * reader treats it as not connected (no sender, no account on the settings
 * page). An empty template name is the marker because it is the honest state —
 * no template has been provisioned — and nothing can send without one.
 *
 * A marker in an existing column rather than a column of its own, because this
 * layer may not change the schema; a `setup_completed_at` column is the
 * cleaner home for the same fact.
 */
export const SETUP_INCOMPLETE_TEMPLATE = "";

/** Whether a stored row finished signup, rather than being parked to keep its PIN. */
export function isWhatsAppSetupComplete(account: Pick<ShopWhatsappAccount, "templateName">) {
  return account.templateName !== SETUP_INCOMPLETE_TEMPLATE;
}

/**
 * The shop's connected WhatsApp account, or null — including for a row parked
 * mid-signup ({@link SETUP_INCOMPLETE_TEMPLATE}), which is not connected.
 */
export async function getShopWhatsAppAccount(
  db: DbExecutor,
  shopId: string,
): Promise<ShopWhatsappAccount | null> {
  const row = await getShopWhatsAppRegistration(db, shopId);
  return row && isWhatsAppSetupComplete(row) ? row : null;
}

/**
 * The shop's stored row whether or not signup finished — for the signup flow
 * alone, which needs a parked row's PIN back.
 */
export async function getShopWhatsAppRegistration(
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
 * The PIN a stored row's number was registered with, or null when there is
 * none or it cannot be opened. Only the signup flow asks: re-registering a
 * parked number must send Meta the PIN it already holds.
 */
export function openRegistrationPin(
  account: Pick<ShopWhatsappAccount, "registrationPinSealed">,
  options: WhatsAppSenderOptions = {},
): string | null {
  const key = resolveKey(options);
  if (typeof key === "string" || !account.registrationPinSealed) return null;
  return openSecret(account.registrationPinSealed, key);
}

/**
 * The shop a WhatsApp Business Account belongs to, or null when no single shop
 * does.
 *
 * This is the tenant key for inbound delivery events: Meta names the WABA in
 * `entry[].id`, and scoping the update to the shop it resolves to is what stops
 * a delivery outcome being applied across a multi-tenant table on a provider
 * message id alone.
 *
 * Two rows asked for, one expected — the belt to the constraint's braces.
 * `shop_whatsapp_accounts_waba_unique` is what makes the second row impossible
 * (issue #1715), so this branch is unreachable while the index stands, and it
 * stays anyway: the cost of asking for one extra row is nothing, and the cost of
 * guessing is a reply keyword — a cancellation — applied to the wrong shop's
 * booking, silently. There is no honest answer to pick when two rows come back,
 * so pick none and say so loudly; the webhook already drops what it cannot
 * place. Dropping the index without noticing this is the failure it guards.
 */
export async function shopIdForWhatsAppWaba(
  db: DbExecutor,
  wabaId: string,
): Promise<string | null> {
  const rows = await db
    .select({ shopId: shopWhatsappAccounts.shopId })
    .from(shopWhatsappAccounts)
    .where(eq(shopWhatsappAccounts.wabaId, wabaId))
    .limit(2);
  if (rows.length > 1) {
    // Ids, never the WABA or the sender — the same posture as the webhook route.
    log("whatsapp_account.ambiguous_waba", "error", {
      shopIds: rows.map((row) => row.shopId).join(" "),
    });
    return null;
  }
  return rows[0]?.shopId ?? null;
}

/**
 * Connect (or re-connect) a shop's WhatsApp sender. Upsert rather than
 * insert-or-fail: rotating a token or fixing a mistyped template name is the
 * same gesture as connecting for the first time, and forcing a disconnect in
 * between would blank the channel for no reason.
 *
 * The one thing it will not do is take a WABA another shop already holds. That
 * is the trap in an upsert whose whole design is "never fail, just overwrite":
 * `onConflictDoUpdate` handles a collision on `shop_id` and nothing else, so a
 * WABA collision arrives as a raw 23505 from
 * `shop_whatsapp_accounts_waba_unique`. Caught by that index's name rather than
 * by message text or a bare code, so an unrelated constraint failure is never
 * reported to a staffer as "already connected to another shop".
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
    templateName: input.templateName.trim(),
    templateLanguage: input.templateLanguage.trim(),
    updatedAt: now,
  };
  // Written only when there is a PIN to write. A reconnect skips registration
  // and passes none, and overwriting the column then would replace the number's
  // real PIN with one Meta has never seen — destroying the only copy of the
  // value the column exists to preserve.
  const pin = input.registrationPin?.trim()
    ? { registrationPinSealed: sealSecret(input.registrationPin.trim(), key) }
    : {};
  try {
    // In its own savepoint (a transaction when `db` is not one), so a WABA
    // collision rolls back only this insert. Under `claimWhatsAppWaba` the
    // caller's transaction is still open, and a bare 23505 there would abort
    // it and turn the worded refusal into "current transaction is aborted".
    const account = await db.transaction(async (savepoint) => {
      const [row] = await savepoint
        .insert(shopWhatsappAccounts)
        .values({ ...values, ...pin, connectedAt: now })
        .onConflictDoUpdate({
          target: shopWhatsappAccounts.shopId,
          // `connectedAt` deliberately survives a re-connect — it is when this shop
          // first switched WhatsApp on, not when it last rotated a token.
          // `verifiedAt` deliberately does not: new credentials are unproven until
          // a fresh test send proves them.
          set: { ...values, ...pin, verifiedAt: null },
        })
        .returning();
      return row;
    });
    return { status: "connected", account };
  } catch (error) {
    if (violatesUniqueIndex(error, WABA_UNIQUE_INDEX)) {
      return { status: "refused", reason: "waba_already_connected" };
    }
    throw error;
  }
}

export type WhatsAppWabaClaim<T> =
  | { status: "held_elsewhere" }
  | { status: "busy" }
  | { status: "claimed"; value: T };

/**
 * The bounds the claim transaction runs under, set with `set local` so they
 * end with it. `lock_timeout` and `statement_timeout` bound any one statement;
 * `idle_in_transaction_session_timeout` bounds the gaps between them, which is
 * where the Graph calls sit. Three calls of at most `GRAPH_REQUEST_TIMEOUT_MS`
 * (10 s) each fit inside it; a request that hangs past it loses its connection
 * and its lock, never the pool.
 */
const CLAIM_BOUNDS = [
  sql`set local lock_timeout = '5s'`,
  sql`set local statement_timeout = '15s'`,
  sql`set local idle_in_transaction_session_timeout = '45s'`,
];

/** Rows out of a `tx.execute` result, whichever shape the driver returned. */
function executedRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

async function tryTransactionLock(tx: DbExecutor, key: string): Promise<boolean> {
  const result = await tx.execute(
    sql`select pg_try_advisory_xact_lock(hashtext(${key})) as locked`,
  );
  return executedRows<{ locked: boolean }>(result)[0]?.locked === true;
}

/**
 * **Run one shop's WhatsApp Connect with the WABA to itself** (issue #1769,
 * H-83).
 *
 * `shop_whatsapp_accounts_waba_unique` keeps the table right, but the table is
 * not the only state: registering a number at Meta mints a PIN, and a Connect
 * whose row the index then refuses has already bound the number to a PIN
 * DiveDay throws away. Recovery for that runs through Meta support, not here.
 * Two staffers pressing Connect within the length of a Meta round trip both
 * passed an unlocked pre-check, both registered, and one lost.
 *
 * So the holder check, `work` (steps 2–4 at Meta) and the insert run in one
 * transaction holding two advisory locks, and a Connect that cannot take them
 * is refused at once (`busy`) rather than queued. Refusing instead of waiting
 * is the point (security review, #1769): a waiter holds a pooled connection
 * for as long as the holder's Meta calls take, so a handful of posts would
 * empty an instance's pool. The busy Connect has registered nothing; pressing
 * Connect again once the first finishes reads the first one's row.
 *
 * **Scope of the locks.** Shop first, then WABA, always in that order so two
 * Connects can never each hold the lock the other wants:
 *
 * - `hashtext('whatsapp-shop:' || shopId)` — one Connect per shop at a time,
 *   so the same shop pressing Connect twice with two different WABAs cannot
 *   register two numbers and keep one.
 * - `hashtext('whatsapp-waba:' || wabaId)` — one Connect per WABA at a time,
 *   across shops.
 *
 * A hash collision costs a spurious `busy`, never a wrong answer, because the
 * refusal that matters is the row read under the lock. They are *transaction*
 * locks: they end with the transaction, so a request that throws or a
 * connection that drops releases them, and nothing is reserved that a crash
 * could leave behind. The transaction also runs under {@link CLAIM_BOUNDS}.
 *
 * `work` gets the transaction and must write through it; it must not redirect
 * (a thrown redirect would roll the row back). Answer with its value and let
 * the caller redirect afterwards. Do the code exchange *before* calling this:
 * it changes nothing at Meta, so it needs no lock and no open transaction.
 */
/**
 * **How long a parked row may hold a WABA against another shop** (issue #2194).
 *
 * A parked row ({@link SETUP_INCOMPLETE_TEMPLATE}) claims its WABA exactly as a
 * connected one does, and nobody can see it: the shop that abandoned the
 * Connect has no connected account to disconnect. Past this age, measured from
 * its `updated_at` (every Connect attempt rewrites it), another shop's claim on
 * the same WABA deletes it inside {@link claimWhatsAppWaba}. A week keeps the
 * PIN for a shop that is still finishing its own setup.
 */
export const PARKED_REGISTRATION_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export async function claimWhatsAppWaba<T>(
  db: AppDb,
  input: { shopId: string; wabaId: string },
  work: (tx: DbExecutor) => Promise<T>,
): Promise<WhatsAppWabaClaim<T>> {
  return db.transaction(async (tx): Promise<WhatsAppWabaClaim<T>> => {
    for (const bound of CLAIM_BOUNDS) await tx.execute(bound);
    if (!(await tryTransactionLock(tx, `whatsapp-shop:${input.shopId}`))) return { status: "busy" };
    if (!(await tryTransactionLock(tx, `whatsapp-waba:${input.wabaId}`))) return { status: "busy" };
    // Under the WABA lock, so no other Connect can be finishing that row now.
    const released = await tx
      .delete(shopWhatsappAccounts)
      .where(
        and(
          eq(shopWhatsappAccounts.wabaId, input.wabaId),
          ne(shopWhatsappAccounts.shopId, input.shopId),
          eq(shopWhatsappAccounts.templateName, SETUP_INCOMPLETE_TEMPLATE),
          isNull(shopWhatsappAccounts.verifiedAt),
          lt(
            shopWhatsappAccounts.updatedAt,
            new Date(nowDate().getTime() - PARKED_REGISTRATION_STALE_MS),
          ),
        ),
      )
      .returning({ shopId: shopWhatsappAccounts.shopId });
    for (const row of released) {
      // Ids only, never the WABA — the same posture as the webhook route.
      log("whatsapp_account.stale_parked_released", "warn", {
        shopId: row.shopId,
        claimingShopId: input.shopId,
      });
    }
    const holder = await shopIdForWhatsAppWaba(tx, input.wabaId);
    if (holder && holder !== input.shopId) return { status: "held_elsewhere" };
    return { status: "claimed", value: await work(tx) };
  });
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
 * no key configured, or a key that no longer matches what sealed this row — or
 * the row is parked mid-signup ({@link SETUP_INCOMPLETE_TEMPLATE}).
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
  if (!isWhatsAppSetupComplete(account)) return null;
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

/**
 * The free-text sender for one shop's account — what a typed reply goes out
 * through (ADR 20260907-two-way-inbox). Same key rule, same null for a shop
 * with no usable WhatsApp; the caller has already checked the 24-hour window.
 */
export function whatsAppTextSenderForAccount(
  account: ShopWhatsappAccount,
  options: WhatsAppSenderOptions = {},
): WhatsAppTextSender | null {
  if (!isWhatsAppSetupComplete(account)) return null;
  const key = resolveKey(options);
  if (typeof key === "string") return null;
  const accessToken = openSecret(account.accessTokenSealed, key);
  if (!accessToken) return null;
  return whatsAppTextSender(
    { phoneNumberId: account.phoneNumberId, accessToken },
    options.fetchImpl ?? fetch,
    options.providerOptions,
  );
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
