/**
 * **A production deploy whose sealing keys cannot open the stored secrets stops here** (issue #2999).
 *
 *   pnpm exec tsx scripts/check-sealing-keys.ts
 *
 * `scripts/vercel-build.mjs` runs it on a production build after `db:migrate` and before
 * `pnpm build`, so a refused deploy never serves and the previous one keeps its alias.
 * `scripts/check-env.mjs` has already refused a malformed or missing `SECRET_ENCRYPTION_KEY`; what
 * only the stored data can show is a well-formed wrong key: a rotation that did not move the old
 * value to `SECRET_ENCRYPTION_KEY_PREVIOUS`, or a wrong `SECRET_ENCRYPTION_KEY_PREVIOUS`. Either
 * one locks out every staffer with two-factor sign-in, because their secrets no longer open.
 *
 * It trial-opens every enabled two-factor secret and compares each recovery-code key fingerprint
 * with the pair (`keyringOpensStored`, src/lib/secret-box.ts). It reads and never writes, and it
 * prints the variables' names and a count of accounts: never a key, a fingerprint, an account or a
 * secret. Reasoning and the rotation steps: docs/engineering/infrastructure-runbook.md, "Rotating
 * the secret-sealing key".
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { storedSealings } from "@/db/account-security";
import type { AppDb } from "@/db/client";
import { withExplicitSslMode } from "@/db/connection-string";
import {
  keyringOpensStored,
  PREVIOUS_SECRET_KEY_VARIABLE,
  SECRET_KEY_VARIABLE,
  secretKeyFromEnvironment,
} from "@/lib/secret-box";

const NAME = "check-sealing-keys";

async function main(): Promise<number> {
  const key = secretKeyFromEnvironment();
  // Unset or malformed is check-env's to refuse, and it already ran; nothing here can open anything.
  if (key.status !== "ok") {
    console.log(`${NAME}: no usable ${SECRET_KEY_VARIABLE}; skipped (check-env reports it).`);
    return 0;
  }
  const url = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error(
      `${NAME}: FAILED. DATABASE_URL is not set, so the stored secrets cannot be read.`,
    );
    return 1;
  }
  // One connection, short-lived: this is a check, not a server.
  const pool = new Pool({ connectionString: withExplicitSslMode(url), max: 1 });
  pool.on("error", (error) => {
    console.error(`${NAME}: pool ${redacted(error)}.`);
  });
  const db = drizzle({ client: pool }) as unknown as AppDb;
  try {
    const result = keyringOpensStored(key.key, await storedSealings(db));
    if (result.status === "ok") {
      console.log(`${NAME}: the sealing keys open all ${result.checked} two-factor account(s).`);
      return 0;
    }
    const accounts = `${result.lockedOut} of ${result.checked} two-factor account(s)`;
    console.error(
      result.reason === "previous_missing"
        ? `${NAME}: FAILED. ${SECRET_KEY_VARIABLE} cannot open ${accounts}, and ${PREVIOUS_SECRET_KEY_VARIABLE} is not set. Either the key was rotated without moving the old value to ${PREVIOUS_SECRET_KEY_VARIABLE}, or the old key was retired while accounts still need it. Set ${PREVIOUS_SECRET_KEY_VARIABLE} to the old key on the Vercel project and redeploy; nobody can sign in with two-factor until then.`
        : `${NAME}: FAILED. Neither ${SECRET_KEY_VARIABLE} nor ${PREVIOUS_SECRET_KEY_VARIABLE} opens ${accounts}, so ${PREVIOUS_SECRET_KEY_VARIABLE} is probably not the key it replaced. Set it to the old ${SECRET_KEY_VARIABLE} on the Vercel project and redeploy.`,
    );
    return 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** The name and code only: a pg error message can quote a row. */
function redacted(error: unknown): string {
  // drizzle wraps the driver's error, so its SQLSTATE is on the cause.
  const failure = error as { code?: unknown; cause?: { code?: unknown } } | undefined;
  const code = failure?.code ?? failure?.cause?.code;
  return `${(error as Error | undefined)?.name ?? "an error"}${typeof code === "string" ? ` (${code})` : ""}`;
}

function fail(error: unknown): never {
  console.error(`${NAME}: FAILED with ${redacted(error)}.`);
  process.exit(1);
}

process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
main().then((code) => process.exit(code), fail);
