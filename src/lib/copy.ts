import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";

/**
 * A sentence the domain layer decided on but did not word: a staff bundle key and
 * the values it interpolates. `src/lib` and `src/db` hand these back, and the
 * renderer that owns the locale (the page, the message or the file) resolves one with
 * `resolveCopy`. That is how a domain function says "Send waiver" without importing
 * a translator (issue #2772, `pnpm check:architecture`).
 *
 * Types only from `src/i18n`: the translator arrives as an argument.
 */
export type Copy = {
  key: StaffMessageKey;
  params?: Record<string, string | number>;
};

export function resolveCopy(t: StaffTranslator, copy: Copy): string {
  // The key is a union, so the translator wants the intersection of every key's values; the
  // bundle's own ICU check (`pnpm check:locale`) is what vouches that params match the key.
  return t(copy.key, copy.params as never);
}
