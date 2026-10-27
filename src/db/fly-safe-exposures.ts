import { openSecret, sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";

/** A numeric reminder exposure; no recipient is recoverable for legacy records. */
export type FlySafeExposure = {
  id: string;
  email: string | null;
  hours: number;
  correctionId: string | null;
  corrected: boolean;
  /** True only after the provider reports acceptance. */
  accepted: boolean;
};

export function openFlySafeExposures(
  sealed: string,
  shopId: string,
  bookingId: string,
): FlySafeExposure[] | null {
  const key = secretKeyFromEnvironment();
  if (key.status !== "ok") return null;
  const plaintext = openSecret(sealed, key.key);
  if (!plaintext) return null;
  try {
    const value: unknown = JSON.parse(plaintext);
    if (
      !value ||
      typeof value !== "object" ||
      !("shopId" in value) ||
      !("bookingId" in value) ||
      value.shopId !== shopId ||
      value.bookingId !== bookingId ||
      !("exposures" in value) ||
      !Array.isArray(value.exposures)
    )
      return null;
    const entries: unknown[] = value.exposures;
    if (
      !entries.every(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          "id" in entry &&
          typeof entry.id === "string" &&
          "email" in entry &&
          (entry.email === null || typeof entry.email === "string") &&
          "hours" in entry &&
          typeof entry.hours === "number" &&
          "correctionId" in entry &&
          (entry.correctionId === null || typeof entry.correctionId === "string") &&
          "corrected" in entry &&
          typeof entry.corrected === "boolean" &&
          "accepted" in entry &&
          typeof entry.accepted === "boolean",
      )
    )
      return null;
    return entries as FlySafeExposure[];
  } catch {
    return null;
  }
}

export function sealFlySafeExposures(
  entries: FlySafeExposure[],
  shopId: string,
  bookingId: string,
): string | null {
  const key = secretKeyFromEnvironment();
  return key.status === "ok"
    ? sealSecret(JSON.stringify({ shopId, bookingId, exposures: entries }), key.key)
    : null;
}
