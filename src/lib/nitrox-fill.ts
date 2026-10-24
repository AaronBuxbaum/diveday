/**
 * **How a shop fills nitrox** (issue 3004, Aaron 2026-10-24), which decides
 * when Rent out says a tank's oxygen cleaning is missing. `blending`
 * (partial-pressure blending, the default) puts pure oxygen into the tank at
 * any final mix, 32 included; `membrane_premix` fills from a membrane or
 * premixed bank gas, which commonly needs no O2 cleaning at 40% or below.
 */
export const NITROX_FILL_METHODS = ["blending", "membrane_premix"] as const;

export type NitroxFillMethod = (typeof NITROX_FILL_METHODS)[number];

/** Narrows an untrusted form value to a fill method, or null. */
export function parseNitroxFillMethod(value: unknown): NitroxFillMethod | null {
  return typeof value === "string" && (NITROX_FILL_METHODS as readonly string[]).includes(value)
    ? (value as NitroxFillMethod)
    : null;
}
