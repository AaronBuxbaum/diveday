import { createHash } from "node:crypto";

/**
 * **`account_sessions.token` holds a SHA-256 of the session token, never the
 * token** (code review 2026-10-11, item 40).
 *
 * better-auth mints the token, writes it through its database adapter and
 * reads sessions back by it. This wraps that adapter so the `session` model's
 * `token` is hashed on the way in, on every write and in every `where`, and
 * the raw value better-auth asked about is put back on what it reads, so
 * better-auth itself (the cookie it sets, the cookie cache, the sliding
 * refresh) never sees a digest. The database never sees the raw value. Every
 * other model passes straight through. This is the same at-rest promise
 * `account_tokens.token_hash` (src/lib/account-tokens.ts) and the booking
 * links already make.
 *
 * **One limit, on purpose.** A read that does not name the token (better-auth's
 * `listSessions`, by user) can only hand back the digest, since the raw value
 * exists nowhere to restore it from; so better-auth's own "revoke other
 * sessions" and "revoke by token from a list" would miss. DiveDay uses
 * neither: the security settings page revokes by session id
 * (`src/db/account-security.ts`), and every other sign-out path deletes by
 * account; those endpoints are disabled and no source may call them
 * (`DIGEST_BLIND_SESSION_PATHS`, src/lib/auth.ts). A digest is never accepted as a token, so this can only fail
 * closed: a `where` value is always hashed, never trusted as "already hashed".
 */

/** The digest stored for a raw session token: lowercase hex SHA-256. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const SESSION_MODEL = "session";
const TOKEN_FIELD = "token";

type WhereClause = { field: string; value: unknown; operator?: string; [key: string]: unknown };
type ModelCall = {
  model: string;
  where?: WhereClause[];
  data?: Record<string, unknown>;
  update?: Record<string, unknown>;
  [key: string]: unknown;
};

/** Raw token for each digest a call named, so a row read back can be given its raw token. */
type Restore = Map<string, string>;

function hashValue(value: unknown, restore: Restore): unknown {
  if (typeof value === "string") {
    const digest = hashSessionToken(value);
    restore.set(digest, value);
    return digest;
  }
  if (Array.isArray(value)) return value.map((item) => hashValue(item, restore));
  return value;
}

/** The call with every session-token value hashed, and the digests it named. */
function hashCall(call: ModelCall): { call: ModelCall; restore: Restore } {
  const restore: Restore = new Map();
  if (call?.model !== SESSION_MODEL) return { call, restore };
  const next: ModelCall = { ...call };
  if (Array.isArray(call.where)) {
    next.where = call.where.map((clause) =>
      clause.field === TOKEN_FIELD
        ? { ...clause, value: hashValue(clause.value, restore) }
        : clause,
    );
  }
  for (const key of ["data", "update"] as const) {
    const fields = call[key];
    if (fields && typeof fields === "object" && TOKEN_FIELD in fields) {
      next[key] = { ...fields, [TOKEN_FIELD]: hashValue(fields[TOKEN_FIELD], restore) };
    }
  }
  return { call: next, restore };
}

function restoreRow(row: unknown, restore: Restore): unknown {
  if (!row || typeof row !== "object" || restore.size === 0) return row;
  const token = (row as Record<string, unknown>)[TOKEN_FIELD];
  if (typeof token !== "string") return row;
  const raw = restore.get(token);
  return raw === undefined ? row : { ...(row as Record<string, unknown>), [TOKEN_FIELD]: raw };
}

function restoreResult(result: unknown, restore: Restore): unknown {
  return Array.isArray(result)
    ? result.map((row) => restoreRow(row, restore))
    : restoreRow(result, restore);
}

/**
 * `adapter` with the session model's token hashed at rest. Every method that
 * takes a model call is wrapped, so a method better-auth adds later is covered
 * too; `transaction` hands its callback a wrapped adapter as well.
 */
export function withHashedSessionTokens<A extends object>(adapter: A): A {
  return new Proxy(adapter, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (typeof member !== "function") return member;
      if (property === "transaction") {
        return (callback: (trx: object) => Promise<unknown>) =>
          member.call(target, (trx: object) => callback(withHashedSessionTokens(trx)));
      }
      return (first: unknown, ...rest: unknown[]) => {
        if (!first || typeof first !== "object" || !("model" in first)) {
          return member.call(target, first, ...rest);
        }
        const { call, restore } = hashCall(first as ModelCall);
        const result = member.call(target, call, ...rest);
        return result instanceof Promise
          ? result.then((value) => restoreResult(value, restore))
          : restoreResult(result, restore);
      };
    },
  });
}
