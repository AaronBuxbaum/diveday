/**
 * Resolve a compiled default and environment override with three distinct
 * cases:
 *
 * | Override | Result |
 * | --- | --- |
 * | absent | the compiled default |
 * | non-empty | the trimmed override |
 * | empty or whitespace | `undefined` (explicitly off) |
 *
 * In particular, an empty telemetry override must stay off in test builds;
 * `||` would restore the compiled DSN and send test errors to production.
 */

/**
 * Resolve one value from its override and its compiled default.
 *
 * Returns `undefined` only for an explicit empty override, which every caller
 * must treat the same way it treats a value that was never configured.
 */
export function configuredValue(
  override: string | undefined,
  fallback: string,
): string | undefined {
  if (override === undefined) return fallback;
  const trimmed = override.trim();
  return trimmed === "" ? undefined : trimmed;
}
