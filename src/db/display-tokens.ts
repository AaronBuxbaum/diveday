import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { canManageShopSettings } from "@/lib/authz";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import { checkInLinkExpiresAt, normalizeDisplayLabel } from "@/lib/display-tokens";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { type displayTokenPurpose, displayTokens, shops } from "./schema";

/**
 * **Display links: the credential behind `/board/[token]`** (issue #1426).
 *
 * One writer that mints, one that revokes, one that renews a kiosk link's
 * expiry, and a verify path the board calls on every render. The raw token is
 * returned exactly once, from `issue`, and only its SHA-256 is stored — a
 * reader of the database comes away with nothing that opens a board
 * (`src/lib/bearer-tokens.ts`).
 *
 * Authorization is re-derived at issue time from live roles rather than
 * trusted from the caller: a display link is shop policy (a public screen in
 * the shop's own room), so it is owner/manager work like every other row on
 * the settings hub. Verification deliberately checks nothing about the
 * *person* who made the link — a screen on the wall must not go blank because
 * the manager who set it up left the shop. Revocation is the one door.
 */

/**
 * What a display link opens (N-23, N-24). Every writer and reader below takes
 * it explicitly rather than defaulting: the two purposes differ by whether the
 * surface behind the token can *write*, which is not a difference any call site
 * should be able to inherit by omission.
 */
export type DisplayTokenPurpose = (typeof displayTokenPurpose.enumValues)[number];

export type IssuedDisplayToken = {
  id: string;
  token: string;
  label: string;
  purpose: DisplayTokenPurpose;
  showNames: boolean;
};

export type IssueDisplayTokenOutcome =
  | { ok: true; issued: IssuedDisplayToken }
  | { ok: false; reason: "not_authorized" | "invalid_label" };

export async function issueDisplayToken(
  db: AppDb,
  input: {
    shopId: string;
    personId: string;
    label: unknown;
    purpose: DisplayTokenPurpose;
    showNames: boolean;
    now?: Date;
  },
): Promise<IssueDisplayTokenOutcome> {
  const label = normalizeDisplayLabel(input.label);
  if (label === null) return { ok: false, reason: "invalid_label" };
  const now = input.now ?? nowDate();
  return db.transaction(async (tx): Promise<IssueDisplayTokenOutcome> => {
    const [shop] = await tx
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.id, input.shopId))
      .limit(1);
    if (!shop) return { ok: false, reason: "not_authorized" };
    const roles = await loadActiveStaffRoles(tx, input.shopId, input.personId);
    if (!roles || !canManageShopSettings(roles)) return { ok: false, reason: "not_authorized" };

    const token = createBearerToken();
    const [row] = await tx
      .insert(displayTokens)
      .values({
        shopId: input.shopId,
        tokenHash: hashBearerToken(token),
        label,
        purpose: input.purpose,
        showNames: input.showNames,
        createdByPersonId: input.personId,
        createdAt: now,
        // Derived from `purpose` here, never from an argument: a caller that
        // could ask for "no expiry" would be a way to mint a kiosk link that
        // outlives the tablet (issue #1609). A board link gets null, which is
        // what the column means by "never".
        expiresAt: input.purpose === "check_in" ? checkInLinkExpiresAt(now) : null,
      })
      .returning({ id: displayTokens.id });
    if (!row) return { ok: false, reason: "not_authorized" };
    return {
      ok: true,
      issued: {
        id: row.id,
        token,
        label,
        purpose: input.purpose,
        showNames: input.showNames,
      },
    };
  });
}

/**
 * What a verified token grants: which shop's day, and whether the crew line
 * is shown. Deliberately nothing else — no label, no author — so the page
 * cannot print what it was never meant to know.
 */
export type DisplayTokenContext = { id: string; shopId: string; showNames: boolean };

/**
 * `null` for an unknown token, for a revoked one, for one whose expiry has
 * passed, **and for a live token minted for the other purpose** — all four
 * alike, so a holder cannot tell "never ours" from "revoked this morning" from
 * "expired in March" from "that is the board's link, not the kiosk's". The
 * surfaces answer every one of them with the same refusal card.
 *
 * A null `expires_at` is a live row: that is every board link, and every row
 * that predates the column (issue #1609).
 *
 * The purpose is matched in the predicate rather than compared afterwards,
 * which is what makes forgetting it a **type** error at every call site rather
 * than a widened credential. A board link opening the kiosk would mean that
 * handing someone the URL for a TV also handed them a surface that can move a
 * booking's status; the shop granted a screen, not a write.
 */
export async function verifyDisplayToken(
  db: DbExecutor,
  input: { token: string; purpose: DisplayTokenPurpose; now?: Date },
): Promise<DisplayTokenContext | null> {
  const now = input.now ?? nowDate();
  const [row] = await db
    .select({
      id: displayTokens.id,
      shopId: displayTokens.shopId,
      showNames: displayTokens.showNames,
    })
    .from(displayTokens)
    .where(
      and(
        eq(displayTokens.tokenHash, hashBearerToken(input.token)),
        eq(displayTokens.purpose, input.purpose),
        isNull(displayTokens.revokedAt),
        or(isNull(displayTokens.expiresAt), gt(displayTokens.expiresAt, now)),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Stamps a render, so the settings page can tell a screen that is showing
 * from a link nobody pasted anywhere. Coarse on purpose: the board refreshes
 * every minute and the stamp is read by a human, so a write per render is the
 * whole cost and there is nothing to gain by being finer.
 */
export async function touchDisplayToken(
  db: AppDb,
  input: { id: string; now?: Date },
): Promise<void> {
  await db
    .update(displayTokens)
    .set({ lastShownAt: input.now ?? nowDate() })
    .where(eq(displayTokens.id, input.id));
}

export type DisplayTokenSummary = {
  id: string;
  label: string;
  purpose: DisplayTokenPurpose;
  showNames: boolean;
  createdAt: Date;
  lastShownAt: Date | null;
  /** Null for a board link, which never expires. */
  expiresAt: Date | null;
};

/**
 * The shop's links, newest first, for the settings page.
 *
 * Deliberately still lists a link whose expiry has passed: a manager has to be
 * able to find the kiosk that stopped working and renew it, and an expired row
 * that vanished would look like a link somebody else revoked. Revocation stays
 * the only thing that takes a row off this list (issue #1609).
 */
export async function listDisplayTokens(
  db: DbExecutor,
  input: { shopId: string },
): Promise<DisplayTokenSummary[]> {
  return db
    .select({
      id: displayTokens.id,
      label: displayTokens.label,
      purpose: displayTokens.purpose,
      showNames: displayTokens.showNames,
      createdAt: displayTokens.createdAt,
      lastShownAt: displayTokens.lastShownAt,
      expiresAt: displayTokens.expiresAt,
    })
    .from(displayTokens)
    .where(and(eq(displayTokens.shopId, input.shopId), isNull(displayTokens.revokedAt)))
    .orderBy(desc(displayTokens.createdAt), desc(displayTokens.id));
}

/**
 * Turns a link off. The same live owner/manager gate as `issueDisplayToken`,
 * re-derived here rather than trusted from the page: a server action is a
 * POST endpoint whether or not the settings page rendered a button, and a
 * crew member must not be able to darken the lobby screen (security review,
 * 2026-09-07). Shop-scoped in the predicate, so an id from another shop
 * revokes nothing, and idempotent: revoking a revoked link is `false`, not
 * an error. Revoking is the row's soft delete — `revoked_at` stays, the row
 * stays, and the board stops showing the day on the next refresh.
 */
export async function revokeDisplayToken(
  db: AppDb,
  input: { shopId: string; personId: string; id: string; now?: Date },
): Promise<boolean> {
  const roles = await loadActiveStaffRoles(db, input.shopId, input.personId);
  if (!roles || !canManageShopSettings(roles)) return false;
  const rows = await db
    .update(displayTokens)
    .set({ revokedAt: input.now ?? nowDate() })
    .where(
      and(
        eq(displayTokens.id, input.id),
        eq(displayTokens.shopId, input.shopId),
        isNull(displayTokens.revokedAt),
      ),
    )
    .returning({ id: displayTokens.id });
  return rows.length > 0;
}

/**
 * **Pushes a check-in link's expiry out by a full lifetime** (issue #1609).
 *
 * The same live owner/manager gate as `revokeDisplayToken`, re-derived here
 * and not trusted from the page that drew the button: this is a full-lifetime
 * reset on a bearer credential that can *write*, so a crew member reaching the
 * server action through a stale tab is refused at the writer.
 *
 * Shop-scoped in the predicate, so another tenant's id renews nothing. Only a
 * `check_in` row, because a board link has no expiry to move, and only a live
 * one — renewing a revoked link would be un-revoking it through a door that
 * does not say so.
 */
export async function renewDisplayToken(
  db: AppDb,
  input: { shopId: string; personId: string; id: string; now?: Date },
): Promise<boolean> {
  const roles = await loadActiveStaffRoles(db, input.shopId, input.personId);
  if (!roles || !canManageShopSettings(roles)) return false;
  const rows = await db
    .update(displayTokens)
    .set({ expiresAt: checkInLinkExpiresAt(input.now ?? nowDate()) })
    .where(
      and(
        eq(displayTokens.id, input.id),
        eq(displayTokens.shopId, input.shopId),
        eq(displayTokens.purpose, "check_in"),
        isNull(displayTokens.revokedAt),
      ),
    )
    .returning({ id: displayTokens.id });
  return rows.length > 0;
}
