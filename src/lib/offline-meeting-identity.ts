import { authSecret } from "./auth-secret";
import { offlineReceiptSecrets } from "./offline-receipt-secrets";
import { deriveLabelKey, signPayload, tagMatches } from "./signed-token";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Scope = {
  shopId: string;
  tripId: string;
  snapshotId: string;
  meetingDay: number;
  scheduleGeneration: number;
  datasetIncarnation: string;
};
function valid(scope: Scope): boolean {
  return (
    UUID.test(scope.shopId) &&
    UUID.test(scope.tripId) &&
    UUID.test(scope.snapshotId) &&
    UUID.test(scope.datasetIncarnation) &&
    Number.isSafeInteger(scope.meetingDay) &&
    scope.meetingDay >= 0 &&
    scope.meetingDay <= 1000 &&
    Number.isSafeInteger(scope.scheduleGeneration) &&
    scope.scheduleGeneration >= 0 &&
    scope.scheduleGeneration <= 2_147_483_647
  );
}
function signature(
  scope: Scope,
  meetingId: string,
  starts: string,
  ends: string,
  secret = authSecret,
): string {
  if (!secret) throw new Error("AUTH_SECRET is required to sign offline meeting identities");
  const key = deriveLabelKey(secret, "diveday-offline-meeting-identity-v2");
  return signPayload(
    key,
    JSON.stringify([
      scope.shopId,
      scope.tripId,
      scope.snapshotId,
      scope.meetingDay,
      scope.scheduleGeneration,
      scope.datasetIncarnation,
      meetingId,
      starts,
      ends,
    ]),
  );
}

/** Bind one captured ordinal and persistent meeting identity to a specific copy. */
export function signOfflineMeetingIdentity(
  input: Scope & { meetingId: string; startsAt: Date; endsAt: Date },
): string {
  const starts = input.startsAt.getTime().toString(36);
  const ends = input.endsAt.getTime().toString(36);
  if (
    !valid(input) ||
    !UUID.test(input.meetingId) ||
    !Number.isFinite(input.startsAt.getTime()) ||
    !Number.isFinite(input.endsAt.getTime()) ||
    input.endsAt <= input.startsAt
  )
    throw new Error("Invalid offline meeting identity");
  return `${input.meetingId}.${input.meetingDay}.${starts}.${ends}.${input.scheduleGeneration}.${signature(input, input.meetingId, starts, ends)}`;
}

/** Invalid, foreign or missing proofs never establish which meeting a tap named. */
export function verifyOfflineMeetingIdentity(
  input: Scope & { token: string | null | undefined },
): { meetingId: string; startsAt: number; endsAt: number } | null {
  if (!valid(input) || !input.token || input.token.length > 128) return null;
  const parts = input.token.split(".");
  if (parts.length !== 6) return null;
  const [meetingId, day, starts, ends, generation, tag] = parts;
  if (!meetingId || !UUID.test(meetingId) || day !== String(input.meetingDay) || !tag) return null;
  if (generation !== String(input.scheduleGeneration)) return null;
  if (!starts || !ends || !/^-?[0-9a-z]+$/.test(starts) || !/^-?[0-9a-z]+$/.test(ends)) return null;
  const startsAt = Number.parseInt(starts, 36);
  const endsAt = Number.parseInt(ends, 36);
  if (
    !Number.isSafeInteger(startsAt) ||
    !Number.isSafeInteger(endsAt) ||
    startsAt.toString(36) !== starts ||
    endsAt.toString(36) !== ends ||
    !Number.isFinite(new Date(startsAt).getTime()) ||
    !Number.isFinite(new Date(endsAt).getTime()) ||
    endsAt <= startsAt
  )
    return null;
  return offlineReceiptSecrets().some((secret) =>
    tagMatches(tag, () => signature(input, meetingId, starts, ends, secret)),
  )
    ? { meetingId, startsAt, endsAt }
    : null;
}
