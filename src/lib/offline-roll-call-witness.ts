import { authSecret } from "./auth-secret";
import { rollCallEvidenceIdPattern } from "./roll-call-causality";
import { runtimeMode } from "./runtime-mode";
import { deriveLabelKey, signPayload, tagMatches } from "./signed-token";

type Scope = {
  shopId: string;
  tripId: string;
  snapshotId: string;
  subjectKind: "seat" | "crew";
  subjectId: string;
  checkpoint: string;
  meetingDay: number;
};
type Witness = {
  meetingGeneration: number;
  assignmentGeneration: number;
  frontier: string[];
  originalPersonId?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normal runtimes always validate witnesses; test fixtures can opt in independently. */
export function offlineRollCallWitnessEnabled(): boolean {
  return (
    (process.env.NODE_ENV !== "test" && !runtimeMode().e2eHarness) ||
    process.env.DIVEDAY_OFFLINE_ROLL_CALL_WITNESS === "1"
  );
}

function validScope(scope: Scope): boolean {
  return (
    [scope.shopId, scope.tripId, scope.snapshotId, scope.subjectId].every((id) => uuid.test(id)) &&
    (scope.subjectKind === "seat" || scope.subjectKind === "crew") &&
    /^(?:departure|after_dive_[1-6])$/.test(scope.checkpoint) &&
    Number.isSafeInteger(scope.meetingDay) &&
    scope.meetingDay >= 0
  );
}
function validGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function canonicalFrontier(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > 200 ||
    !value.every((id) => typeof id === "string" && rollCallEvidenceIdPattern.test(id))
  )
    return null;
  return [...new Set(value.map((id: string) => id.toLowerCase()))].sort();
}
function signature(scope: Scope, body: string): string {
  if (!authSecret) throw new Error("AUTH_SECRET is required to sign offline roll-call witnesses");
  return signPayload(
    deriveLabelKey(authSecret, "diveday-offline-roll-call-witness-v1"),
    JSON.stringify([
      scope.shopId.toLowerCase(),
      scope.tripId.toLowerCase(),
      scope.snapshotId.toLowerCase(),
      scope.subjectKind,
      scope.subjectId.toLowerCase(),
      scope.checkpoint,
      scope.meetingDay,
      body,
    ]),
  );
}

/** Sign a scoped snapshot observation. This is evidence, not authorization to write. */
export function signRollCallWitness(input: Scope & Witness): string {
  const frontier = canonicalFrontier(input.frontier);
  if (
    !validScope(input) ||
    !validGeneration(input.meetingGeneration) ||
    !validGeneration(input.assignmentGeneration) ||
    !frontier ||
    (input.originalPersonId !== undefined && !uuid.test(input.originalPersonId))
  )
    throw new Error("Invalid roll-call witness");
  const body = Buffer.from(
    JSON.stringify(
      input.originalPersonId
        ? [
            input.meetingGeneration,
            input.assignmentGeneration,
            frontier,
            input.originalPersonId.toLowerCase(),
          ]
        : [input.meetingGeneration, input.assignmentGeneration, frontier],
    ),
  ).toString("base64url");
  return `${body}.${signature(input, body)}`;
}

/** Verify against server-derived scope. Neither device clocks nor editable fields establish it. */
export function verifyRollCallWitness(
  token: string | null | undefined,
  scope: Scope,
): Witness | null {
  if (!token || token.length > 16000 || !validScope(scope)) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, tag] = parts;
  if (
    !body ||
    !tag ||
    !/^[A-Za-z0-9_-]+$/.test(body) ||
    !tagMatches(tag, () => signature(scope, body))
  )
    return null;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      !Array.isArray(decoded) ||
      (decoded.length !== 3 && decoded.length !== 4) ||
      !validGeneration(decoded[0]) ||
      !validGeneration(decoded[1])
    )
      return null;
    const frontier = canonicalFrontier(decoded[2]);
    if (!frontier || JSON.stringify(frontier) !== JSON.stringify(decoded[2])) return null;
    if (decoded.length === 4 && (typeof decoded[3] !== "string" || !uuid.test(decoded[3])))
      return null;
    return {
      meetingGeneration: decoded[0],
      assignmentGeneration: decoded[1],
      frontier,
      ...(decoded.length === 4 ? { originalPersonId: decoded[3] as string } : {}),
    };
  } catch {
    return null;
  }
}
