import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { lockBoardingCertificationEvidence } from "@/db/boarding-certification-snapshot";
import type { AppDb, DbExecutor } from "@/db/client";
import { bookings, walletPasses, walletPassRegistrations } from "@/db/schema";
import { hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import type { PassContent, WalletPlatform } from "@/lib/wallet-passes";
import { pushAppleDevice } from "./apns";
import { applePassBytes } from "./apple";
import { configuredWalletPlatforms, googleCredentials } from "./config";
import { readPassContent } from "./content";
import { ensureGoogleClass, googlePassSaveUrl, pushGoogleObject } from "./google";
import { passAuthenticationToken, passContentHash, passTokenMatches } from "./rules";

type PassRow = typeof walletPasses.$inferSelect;
export type IssuedWalletPass = PassRow;

export async function issueWalletPass(
  db: AppDb,
  input: { shopId: string; bookingId: string; platform: WalletPlatform; locale: string },
): Promise<IssuedWalletPass | null> {
  if (!configuredWalletPlatforms().includes(input.platform)) return null;
  const row = await db.transaction(async (tx) => {
    await lockBoardingCertificationEvidence(tx, input.shopId, "boarding");
    const source = await readPassContent(tx, input.shopId, input.bookingId, input.locale);
    if (!source?.enabled || source.erased || source.content.voided) return null;
    const [existing] = await tx
      .select()
      .from(walletPasses)
      .where(
        and(
          eq(walletPasses.bookingId, input.bookingId),
          eq(walletPasses.shopId, input.shopId),
          eq(walletPasses.platform, input.platform),
          isNull(walletPasses.deletedAt),
        ),
      );
    if (existing) {
      if (
        existing.platform !== "apple" ||
        (existing.authenticationTokenHash &&
          passTokenMatches(passAuthenticationToken(existing.id), existing.authenticationTokenHash))
      )
        return existing;
      // A new AUTH_SECRET cannot recover the previous bearer secret. Re-adding
      // replaces that pass; existing installations work until this explicit reissue.
      await tx
        .update(walletPasses)
        .set({ deletedAt: nowDate(), voidedAt: nowDate() })
        .where(eq(walletPasses.id, existing.id));
      await tx
        .update(walletPassRegistrations)
        .set({ deletedAt: nowDate() })
        .where(
          and(
            eq(walletPassRegistrations.passId, existing.id),
            isNull(walletPassRegistrations.deletedAt),
          ),
        );
    }
    const id = randomUUID();
    const values = {
      id,
      shopId: input.shopId,
      bookingId: input.bookingId,
      platform: input.platform,
      locale: input.locale,
      authenticationTokenHash:
        input.platform === "apple" ? hashBearerToken(passAuthenticationToken(id)) : null,
      googleObjectId: input.platform === "google" ? `${googleCredentials()?.issuerId}.${id}` : null,
      contentJson: source.content,
      contentHash: passContentHash(source.content),
    };
    const [issued] = await tx.insert(walletPasses).values(values).onConflictDoNothing().returning();
    if (issued) {
      log("wallet_pass.issued", "info", { passId: id, platform: input.platform });
      return issued;
    }
    const [raced] = await tx
      .select()
      .from(walletPasses)
      .where(
        and(
          eq(walletPasses.bookingId, input.bookingId),
          eq(walletPasses.shopId, input.shopId),
          eq(walletPasses.platform, input.platform),
          isNull(walletPasses.deletedAt),
        ),
      );
    return raced ?? null;
  });
  return row;
}

/** Rendering reads the cron's snapshot, never a live request-time reconstruction. */
export async function renderApplePass(db: DbExecutor, passId: string) {
  const [row] = await db
    .select()
    .from(walletPasses)
    .where(
      and(
        eq(walletPasses.id, passId),
        eq(walletPasses.platform, "apple"),
        isNull(walletPasses.deletedAt),
      ),
    );
  if (!row) return null;
  return { bytes: applePassBytes(row.id, row.contentJson), lastModified: row.updatedAt };
}

export async function googleSaveUrl(db: DbExecutor, passId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(walletPasses)
    .where(
      and(
        eq(walletPasses.id, passId),
        eq(walletPasses.platform, "google"),
        isNull(walletPasses.deletedAt),
      ),
    );
  if (!row?.googleObjectId) return null;
  await ensureGoogleClass();
  return googlePassSaveUrl(row.googleObjectId, row.contentJson, row.issuedAt, row.locale);
}

type PushProviders = { apple: typeof pushAppleDevice; google: typeof pushGoogleObject };

/** A bounded fair scan. Provider failure never rolls back content; its old delivery stamp permits retry. */
export async function pushChangedWalletPasses(
  db: AppDb,
  opts: { now?: Date; limit?: number; providers?: PushProviders } = {},
) {
  const platforms = configuredWalletPlatforms();
  const summary = { examined: 0, pushed: 0, failed: 0 };
  if (!platforms.length) return summary;
  const now = opts.now ?? nowDate();
  const providers = opts.providers ?? { apple: pushAppleDevice, google: pushGoogleObject };
  const rows = await db
    .select()
    .from(walletPasses)
    .where(
      and(
        inArray(walletPasses.platform, [...platforms]),
        or(
          sql`(${walletPasses.contentJson}->>'expirationDate')::timestamptz > ${now}`,
          sql`${walletPasses.lastPushedAt} is null or ${walletPasses.lastPushedAt} < ${walletPasses.updatedAt}`,
        ),
        or(
          isNull(walletPasses.deletedAt),
          sql`${walletPasses.lastPushedAt} is null or ${walletPasses.lastPushedAt} < ${walletPasses.updatedAt}`,
        ),
      ),
    )
    // diveday:allow-time-id-order: scheduler fairness only; this list is never shown.
    .orderBy(sql`${walletPasses.lastCheckedAt} asc nulls first`, asc(walletPasses.id))
    .limit(Math.max(1, Math.min(opts.limit ?? 100, 500)));
  const started = performance.now();
  for (const candidate of rows) {
    if (performance.now() - started >= 30_000) break;
    summary.examined++;
    try {
      const outcome = await db.transaction(async (tx) => {
        await lockBoardingCertificationEvidence(tx, candidate.shopId, "boarding");
        const source = await readPassContent(
          tx,
          candidate.shopId,
          candidate.bookingId,
          candidate.locale,
          now,
        );
        if (!source) return "unchanged";
        // Person-first (readPassContent), then pass, matches erasure and serializes repeated crons.
        const [row] = await tx
          .select()
          .from(walletPasses)
          .where(and(eq(walletPasses.id, candidate.id), eq(walletPasses.shopId, candidate.shopId)))
          .for("update");
        if (!row) return "unchanged";
        const content = row.deletedAt ? row.contentJson : source.content;
        const hash = passContentHash(content);
        const moved = hash !== row.contentHash;
        // Earlier-started scans and same-tick writes must stay ahead of content and delivery tags.
        const updatedAt = moved
          ? new Date(
              Math.max(
                now.getTime(),
                row.updatedAt.getTime() + 1,
                (row.lastPushedAt?.getTime() ?? 0) + 1,
              ),
            )
          : row.updatedAt;
        await tx
          .update(walletPasses)
          .set({
            contentJson: content,
            contentHash: hash,
            updatedAt,
            lastCheckedAt: now,
            voidedAt: content.voided ? (row.voidedAt ?? now) : null,
          })
          .where(eq(walletPasses.id, row.id));
        if (!moved && row.lastPushedAt && row.lastPushedAt >= updatedAt) return "unchanged";
        if (row.platform === "apple") {
          const registrations = await tx
            .select()
            .from(walletPassRegistrations)
            .where(
              and(
                eq(walletPassRegistrations.passId, row.id),
                eq(walletPassRegistrations.shopId, row.shopId),
                isNull(walletPassRegistrations.deletedAt),
              ),
            );
          let deliveryFailed = false;
          for (const registration of registrations) {
            let status: number;
            try {
              status = await providers.apple(registration.pushToken);
            } catch {
              // Keep notifying other devices, then commit content and any retired registrations.
              deliveryFailed = true;
              continue;
            }
            if (status === 410)
              await tx
                .update(walletPassRegistrations)
                .set({ deletedAt: now })
                .where(eq(walletPassRegistrations.id, registration.id));
            else if (status < 200 || status >= 300) deliveryFailed = true;
          }
          if (deliveryFailed) return "failed";
        } else if (row.googleObjectId) {
          try {
            await providers.google(row.googleObjectId, content, row.issuedAt, row.locale);
          } catch {
            return "failed";
          }
        }
        await tx
          .update(walletPasses)
          .set({ lastPushedAt: new Date(Math.max(now.getTime(), updatedAt.getTime())) })
          .where(eq(walletPasses.id, row.id));
        return "pushed";
      });
      if (outcome === "failed") {
        summary.failed++;
        log("wallet_pass.push_failed", "error", {
          passId: candidate.id,
          platform: candidate.platform,
        });
      } else if (outcome === "pushed") {
        summary.pushed++;
        log("wallet_pass.pushed", "info", { passId: candidate.id, platform: candidate.platform });
      }
    } catch {
      summary.failed++;
      // A signing/network exception can quote key material or provider device tokens. No raw errors.
      await db
        .update(walletPasses)
        .set({ lastCheckedAt: now })
        .where(eq(walletPasses.id, candidate.id));
      log("wallet_pass.push_failed", "error", {
        passId: candidate.id,
        platform: candidate.platform,
      });
    }
  }
  return summary;
}

/**
 * Erasure clears every generated crew field in this tenant, including expired snapshots.
 * Public aliases may already be gone after staff removal, so never guess from the current name.
 * The erasure caller holds the rewrite fence; issue/cron hold its shared side before row locks.
 */
export async function voidWalletPassesForPerson(
  tx: DbExecutor,
  input: { shopId: string; personId: string },
): Promise<void> {
  const ownedBookingRows = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.shopId, input.shopId), eq(bookings.personId, input.personId)));
  const ownedBookings = new Set(ownedBookingRows.map((row) => row.id));
  const rows = await tx
    .select()
    .from(walletPasses)
    .where(
      and(
        eq(walletPasses.shopId, input.shopId),
        or(
          inArray(walletPasses.bookingId, [...ownedBookings]),
          sql`${walletPasses.contentJson}->'backFields' @> '[{"key":"crew"}]'::jsonb`,
        ),
      ),
    );
  const now = nowDate();
  for (const row of rows) {
    const owned = ownedBookings.has(row.bookingId);
    const content: PassContent = {
      ...row.contentJson,
      voided: owned || row.contentJson.voided,
      auxiliaryFields: owned
        ? row.contentJson.auxiliaryFields.filter((field) => field.key !== "diver")
        : row.contentJson.auxiliaryFields,
      backFields: row.contentJson.backFields.filter((field) => field.key !== "crew"),
    };
    await tx
      .update(walletPasses)
      .set({
        contentJson: content,
        contentHash: passContentHash(content),
        updatedAt: new Date(Math.max(now.getTime(), row.updatedAt.getTime() + 1)),
        // A pending scrub must be delivered even when the pass is already expired.
        lastPushedAt: null,
        voidedAt: owned ? now : row.voidedAt,
        deletedAt: owned ? now : row.deletedAt,
      })
      .where(and(eq(walletPasses.id, row.id), eq(walletPasses.shopId, input.shopId)));
    if (owned)
      await tx
        .update(walletPassRegistrations)
        .set({ deletedAt: now })
        .where(
          and(
            eq(walletPassRegistrations.passId, row.id),
            eq(walletPassRegistrations.shopId, input.shopId),
            isNull(walletPassRegistrations.deletedAt),
          ),
        );
  }
}
