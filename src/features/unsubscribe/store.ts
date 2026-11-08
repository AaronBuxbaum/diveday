import { resolveBookkeeperStopToken, stopBookkeeperByToken } from "@/features/bookkeeper";
import { resolveShoreAlertStopToken, stopShoreAlertsByToken } from "@/features/shore-alert-tokens";
import {
  resolveWeeklyDigestUnsubscribeToken,
  turnOffWeeklyDigestByToken,
} from "@/features/weekly-digest";
import type { AppDb, DbExecutor } from "../../db/client";
import {
  optOutPersonFromCourtesyEmailByToken,
  resolveCourtesyEmailUnsubscribeToken,
} from "../../db/courtesy-email";
import {
  resolveInterestUnsubscribeToken,
  unsubscribeAnytimeInterestByToken,
} from "../../db/interests";

/**
 * The one resolver behind `/unsubscribe/[token]` (issue #3659).
 *
 * Five kinds of email carry an unsubscribe link: a last-minute-list
 * interest, a person's courtesy email, a staffer's Monday digest, a shop's
 * shore-alert contact and a shop's bookkeeper. Every one is a row of
 * `capabilities` under its own purpose (issue #3721), and each kind's resolver
 * reads it through `verifyCapability` with that purpose in the predicate. The
 * page, the confirm action and the RFC 8058 one-click route all ask here, and
 * only here.
 *
 * Two promises, both pinned by `unsubscribe.test.ts`:
 *  - **A token names at most one kind.** A capability row has one purpose and
 *    each resolver asks only for its own, so a token never reads as two kinds.
 *    The kind is decided once, by `resolveUnsubscribeToken`.
 *  - **Resolving never writes; applying writes only the resolved kind.**
 *    `unsubscribeByToken` runs exactly one mutator, the resolved kind's. An
 *    unknown token runs none, so a guessed string cannot reach any update.
 */
export type UnsubscribeKind =
  | "interest"
  | "courtesy"
  | "weeklyDigest"
  | "shoreAlert"
  | "bookkeeper";

export type UnsubscribeResolution = {
  kind: UnsubscribeKind;
  shopName: string;
  /** The opt-out already holds: a second click reads as done, never as a dead link. */
  done: boolean;
};

/** The first kind that owns the token, or null for anything that must read as "this link isn't available". */
export async function resolveUnsubscribeToken(
  db: DbExecutor,
  token: string,
): Promise<UnsubscribeResolution | null> {
  const interest = await resolveInterestUnsubscribeToken(db, token);
  if (interest) {
    return { kind: "interest", shopName: interest.shopName, done: interest.alreadyUnsubscribed };
  }
  const courtesy = await resolveCourtesyEmailUnsubscribeToken(db, token);
  if (courtesy) {
    return { kind: "courtesy", shopName: courtesy.shopName, done: courtesy.alreadyOptedOut };
  }
  const digest = await resolveWeeklyDigestUnsubscribeToken(db, token);
  if (digest) return { kind: "weeklyDigest", shopName: digest.shopName, done: digest.alreadyOff };
  const shore = await resolveShoreAlertStopToken(db, token);
  if (shore) return { kind: "shoreAlert", shopName: shore.shopName, done: shore.alreadyStopped };
  const bookkeeper = await resolveBookkeeperStopToken(db, token);
  if (bookkeeper) {
    return { kind: "bookkeeper", shopName: bookkeeper.shopName, done: bookkeeper.alreadyStopped };
  }
  return null;
}

/**
 * The one mutating step: resolves the token, then runs the resolved kind's own
 * idempotent mutator and nothing else. Null for an unknown token.
 */
export async function unsubscribeByToken(
  db: AppDb,
  input: { token: string; now?: Date },
): Promise<UnsubscribeResolution | null> {
  const resolved = await resolveUnsubscribeToken(db, input.token);
  if (!resolved) return null;
  switch (resolved.kind) {
    case "interest":
      await unsubscribeAnytimeInterestByToken(db, input);
      break;
    case "courtesy":
      await optOutPersonFromCourtesyEmailByToken(db, input);
      break;
    case "weeklyDigest":
      await turnOffWeeklyDigestByToken(db, { token: input.token });
      break;
    case "shoreAlert":
      await stopShoreAlertsByToken(db, input);
      break;
    case "bookkeeper":
      await stopBookkeeperByToken(db, input);
      break;
  }
  return resolved;
}
