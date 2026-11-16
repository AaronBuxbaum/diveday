/**
 * The `?agency=` a diver asked for, as one lowercase word or nothing. Next hands
 * a repeated param (`?agency=a&agency=b`) over as an array, and the page's
 * type says string, so the first value wins instead of a 500.
 */
export function requestedAgencyFrom(raw: string | string[] | undefined): string | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const text = first?.trim().toLowerCase();
  return text || undefined;
}
