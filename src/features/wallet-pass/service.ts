import { and, eq, gt, isNull } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { boundLockWaits } from "@/db/lock-bounds";
import { walletPasses, walletPassRegistrations } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { uuidParam } from "@/lib/uuid";
import { applePassBytes } from "./apple";
import { appleCredentials, configuredWalletPlatforms } from "./config";
import { passTokenMatches } from "./rules";

type PassIdentity = { passTypeIdentifier: string; serialNumber: string; token: string };
type Registration = PassIdentity & { deviceLibraryIdentifier: string };

async function authorizedPass(db: DbExecutor, input: PassIdentity) {
  if (
    !configuredWalletPlatforms().includes("apple") ||
    input.passTypeIdentifier !== appleCredentials()?.passTypeIdentifier ||
    !uuidParam(input.serialNumber)
  )
    return 404 as const;
  const [row] = await db
    .select()
    .from(walletPasses)
    .where(
      and(
        eq(walletPasses.id, input.serialNumber),
        eq(walletPasses.platform, "apple"),
        isNull(walletPasses.deletedAt),
      ),
    )
    .for("share");
  if (!row) return 404 as const;
  if (!row.authenticationTokenHash || !passTokenMatches(input.token, row.authenticationTokenHash))
    return 401 as const;
  return row;
}

export const applePassService = {
  async register(
    db: DbExecutor,
    input: Registration & { pushToken: string },
  ): Promise<201 | 200 | 401 | 404> {
    return db.transaction(async (tx) => {
      await boundLockWaits(tx);
      const pass = await authorizedPass(tx, input);
      if (typeof pass === "number") return pass;
      const [inserted] = await tx
        .insert(walletPassRegistrations)
        .values({
          shopId: pass.shopId,
          passId: pass.id,
          deviceLibraryIdentifier: input.deviceLibraryIdentifier,
          pushToken: input.pushToken,
        })
        .onConflictDoNothing()
        .returning({ id: walletPassRegistrations.id });
      if (inserted) return 201;
      await tx
        .update(walletPassRegistrations)
        .set({ pushToken: input.pushToken })
        .where(
          and(
            eq(walletPassRegistrations.passId, pass.id),
            eq(walletPassRegistrations.deviceLibraryIdentifier, input.deviceLibraryIdentifier),
            isNull(walletPassRegistrations.deletedAt),
          ),
        );
      return 200;
    });
  },
  async unregister(db: DbExecutor, input: Registration): Promise<200 | 401 | 404> {
    return db.transaction(async (tx) => {
      await boundLockWaits(tx);
      const pass = await authorizedPass(tx, input);
      if (typeof pass === "number") return pass;
      await tx
        .update(walletPassRegistrations)
        .set({ deletedAt: nowDate() })
        .where(
          and(
            eq(walletPassRegistrations.passId, pass.id),
            eq(walletPassRegistrations.deviceLibraryIdentifier, input.deviceLibraryIdentifier),
            isNull(walletPassRegistrations.deletedAt),
          ),
        );
      return 200;
    });
  },
  // Apple's serial-list request has no Authorization header (PassKit protocol).
  // The unguessable device identifier scopes it to existing registrations only.
  async updatedSince(
    db: DbExecutor,
    input: {
      deviceLibraryIdentifier: string;
      passTypeIdentifier: string;
      passesUpdatedSince?: string;
    },
  ) {
    if (
      !configuredWalletPlatforms().includes("apple") ||
      input.passTypeIdentifier !== appleCredentials()?.passTypeIdentifier
    )
      return 204 as const;
    const since = input.passesUpdatedSince ? new Date(input.passesUpdatedSince) : null;
    if (since && !Number.isFinite(since.getTime())) return 204 as const;
    const rows = await db
      .select({ id: walletPasses.id, updatedAt: walletPasses.updatedAt })
      .from(walletPasses)
      .innerJoin(
        walletPassRegistrations,
        and(
          eq(walletPassRegistrations.passId, walletPasses.id),
          eq(walletPassRegistrations.shopId, walletPasses.shopId),
        ),
      )
      .where(
        and(
          eq(walletPassRegistrations.deviceLibraryIdentifier, input.deviceLibraryIdentifier),
          eq(walletPasses.platform, "apple"),
          isNull(walletPasses.deletedAt),
          isNull(walletPassRegistrations.deletedAt),
          since ? gt(walletPasses.updatedAt, since) : undefined,
        ),
      );
    if (!rows.length) return 204 as const;
    return {
      serialNumbers: rows.map((row) => row.id),
      lastUpdated: new Date(Math.max(...rows.map((row) => row.updatedAt.getTime()))).toISOString(),
    };
  },
  async latest(db: DbExecutor, input: PassIdentity & { ifModifiedSince?: Date }) {
    return db.transaction(async (tx) => {
      await boundLockWaits(tx);
      const pass = await authorizedPass(tx, input);
      if (typeof pass === "number") return pass;
      // Never call a newer snapshot unchanged merely because both writes share an HTTP-date second.
      if (input.ifModifiedSince && pass.updatedAt.getTime() <= input.ifModifiedSince.getTime())
        return 304 as const;
      // Echo the authenticated credential, so rotating AUTH_SECRET does not strand installed passes.
      return {
        bytes: applePassBytes(pass.id, pass.contentJson, input.token),
        lastModified: pass.updatedAt,
      };
    });
  },
};
