import { and, desc, eq, isNull } from "drizzle-orm";
import { canManageShopSettings } from "@/lib/authz";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import { normalizeDisplayLabel } from "@/lib/display-tokens";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { displayTokens, shops } from "./schema";

/**
 * **Display links: the credential behind `/board/[token]`** (issue #1426).
 *
 * One writer that mints, one that revokes, and a verify path the board calls
 * on every render. The raw token is returned exactly once, from `issue`, and
 * only its SHA-256 is stored — a reader of the database comes away with
 * nothing that opens a board (`src/lib/bearer-tokens.ts`).
 *
 * Authorization is re-derived at issue time from live roles rather than
 * trusted from the caller: a display link is shop policy (a public screen in
 * the shop's own room), so it is owner/manager work like every other row on
 * the settings hub. Verification deliberately checks nothing about the
 * *person* who made the link — a screen on the wall must not go blank because
 * the manager who set it up left the shop. Revocation is the one door.
 */

export type IssuedDisplayToken = { id: string; token: string; label: string; showNames: boolean };

export type IssueDisplayTokenOutcome =
  | { ok: true; issued: IssuedDisplayToken }
  | { ok: false; reason: "not_authorized" | "invalid_label" };

export async function issueDisplayToken(
  db: AppDb,
  input: { shopId: string; personId: string; label: unknown; showNames: boolean; now?: Date },
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
        showNames: input.showNames,
        createdByPersonId: input.personId,
        createdAt: now,
      })
      .returning({ id: displayTokens.id });
    if (!row) return { ok: false, reason: "not_authorized" };
    return { ok: true, issued: { id: row.id, token, label, showNames: input.showNames } };
  });
}

/**
 * What a verified token grants: which shop's day, and whether the crew line
 * is shown. Deliberately nothing else — no label, no author — so the page
 * cannot print what it was never meant to know.
 */
export type DisplayTokenContext = { id: string; shopId: string; showNames: boolean };

/**
 * `null` for an unknown token and for a revoked one alike; the board answers
 * both with the same 404, and a screen shows the status code to nobody.
 */
export async function verifyDisplayToken(
  db: DbExecutor,
  input: { token: string },
): Promise<DisplayTokenContext | null> {
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
        isNull(displayTokens.revokedAt),
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
  showNames: boolean;
  createdAt: Date;
  lastShownAt: Date | null;
};

/** The shop's live links, newest first, for the settings page. */
export async function listDisplayTokens(
  db: DbExecutor,
  input: { shopId: string },
): Promise<DisplayTokenSummary[]> {
  return db
    .select({
      id: displayTokens.id,
      label: displayTokens.label,
      showNames: displayTokens.showNames,
      createdAt: displayTokens.createdAt,
      lastShownAt: displayTokens.lastShownAt,
    })
    .from(displayTokens)
    .where(and(eq(displayTokens.shopId, input.shopId), isNull(displayTokens.revokedAt)))
    .orderBy(desc(displayTokens.createdAt), desc(displayTokens.id));
}

/**
 * Turns a link off. Shop-scoped in the predicate, so an id from another shop
 * revokes nothing, and idempotent: revoking a revoked link is `false`, not an
 * error. Revoking is the row's soft delete — `revoked_at` stays, the row
 * stays, and the board stops answering on the next refresh.
 */
export async function revokeDisplayToken(
  db: AppDb,
  input: { shopId: string; id: string; now?: Date },
): Promise<boolean> {
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
