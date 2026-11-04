/**
 * **A fact that cannot be written says why**, and the test door
 * (`/api/test/shop`) answers with it: the code, the HTTP status, and whatever
 * detail names the row that stood in the way. A capture that asked for a state
 * and quietly got a different one is worse than a red spec naming the reason.
 *
 * `not_available` is the one refusal every `/api/test/*` route answers with
 * (issue #2751); a fact that throws it is answered exactly as the demo-tenant
 * gate is, so the caller cannot tell the two apart.
 */
export class FactRefused extends Error {
  constructor(
    readonly code: string,
    readonly status: 404 | 409 = 409,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(`fact refused: ${code}`);
    this.name = "FactRefused";
  }
}
